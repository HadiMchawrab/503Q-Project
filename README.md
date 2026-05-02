# ShopCloud

ShopCloud is a cloud-native e-commerce platform designed around service isolation, managed AWS infrastructure, and automated delivery. The system separates customer traffic, administrative access, transactional data, cache/session state, and asynchronous invoice processing into independently deployable components that can be operated across development and production environments.

At runtime, the platform combines five FastAPI backend services, a customer storefront, an internal admin console, PostgreSQL for durable transactional data, Redis for low-latency cart/session state, and an event-driven invoice workflow built around SQS, PDF generation, S3 storage, and SES delivery.

## Stack

- **Backend:** FastAPI microservices on Python 3.11
- **Frontend:** React / Vite storefront, served as static assets
- **Database:** PostgreSQL on Amazon RDS for orders, users, products, and inventory
- **Cache / sessions:** Redis / ElastiCache for cart persistence and fast session lookups
- **Auth:** Amazon Cognito with separate customer and administrator identity boundaries
- **Async processing:** SQS-driven invoice workflow with PDF rendering, S3 storage, and SES email delivery
- **Infrastructure:** Terraform modules for networking, compute, data, identity, messaging, and edge delivery
- **Runtime:** Amazon EKS with Kubernetes Deployments, Services, Ingress, HPA, and Kustomize overlays
- **CI/CD:** GitHub Actions → ECR → EKS

## Services

| Service   | Responsibility                                |
|-----------|-----------------------------------------------|
| catalog   | Public product discovery, category filtering, search, and inventory visibility |
| cart      | Authenticated cart state backed by Redis and validated against live catalog data |
| checkout  | Transactional order creation, stock validation, inventory decrementing, and invoice event publishing |
| auth      | Authentication configuration, local-development auth, Cognito JWT verification, and user profile mirroring |
| admin     | Internal inventory, order, and operational management API protected by admin-only authorization |
| admin-ui  | Restricted administrative console served separately from the public storefront |

Each backend service is packaged into the shared `shopcloud-app` container image and selected at runtime through a service-specific Uvicorn entrypoint. In Kubernetes, the services run as independent Deployments with their own Services, probes, resource limits, and autoscaling policies.

## Traffic paths

The public and administrative paths are intentionally separated. Customer traffic enters through the edge layer and reaches only the public API surface, while administrative workflows are routed through a private ingress path intended for VPN-connected staff. This keeps inventory and order-management operations isolated from the customer-facing storefront even though both paths ultimately target workloads running inside the same EKS platform.

The application tier follows a service-per-responsibility model: catalog handles product discovery, cart owns temporary user state, checkout owns transactional order creation, auth centralizes token validation, and admin exposes privileged operational workflows. Shared modules provide common database access, authentication helpers, Redis cart persistence, queue publishing, error handling, and service bootstrapping.

- **Customers:** Route 53 → CloudFront → WAF → public ALB → EKS ingress
- **Admins:** Client VPN (cert + MFA) → internal ALB (no public DNS) → admin service

## Repo layout

```
.
├── services/
│   ├── catalog/             # FastAPI service
│   ├── cart/
│   ├── checkout/
│   ├── auth/
│   └── admin/
├── shared/                  # shared Python modules (db, auth, queue)
├── frontend/                # customer storefront static assets (HTML/JS/CSS) — shipped to S3 + CloudFront
├── admin-ui/                # internal admin console (NGINX image, served via internal ALB)
├── gateway/                 # local dev NGINX reverse proxy
├── database/                # init.sql for local Postgres
├── lambda/
│   └── invoice_generator/   # triggered by SQS, renders PDF + emails via SES
├── infra/
│   └── terraform/           # VPC, EKS, RDS, Redis, Cognito, SQS, VPN, etc.
├── k8s/                     # Kustomize base + dev/prod overlays
└── scripts/
```

## Running locally

Copy `.env.example` to `.env` at the repo root, then bring the whole stack up with:

```
docker compose -f docker-compose.dev.yml up --build
```

This builds and starts Postgres, Redis, all five backend services, the customer storefront, the admin console, and an NGINX gateway that fronts them.

Endpoints:

| URL                       | What                                       |
|---------------------------|--------------------------------------------|
| http://localhost:8080     | Gateway → storefront + `/api/*` routes     |
| http://localhost:8081     | Admin console (admin-ui)                   |
| localhost:55432           | Postgres                                   |
| localhost:6380            | Redis                                      |

Invoice/SQS/SES flow is no-op'd locally: leave `INVOICE_QUEUE_URL` empty and `checkout` skips publishing (see [shared/queue.py](shared/queue.py)). Auth requires Cognito — set `COGNITO_USER_POOL_ID` (and/or `COGNITO_ADMIN_POOL_ID`) in `.env`; without them every authenticated request returns 500.

## Deploying

Infra changes:

```
cd infra/terraform/<module>
terraform plan
terraform apply
```

App changes go through CI — push to `main`, GitHub Actions builds and pushes images to ECR, then applies the relevant Kustomize overlay under [k8s/overlays/](k8s/overlays/) against the cluster.

All five backend services share a single image (`shopcloud-app` in ECR). Each Deployment picks its service by overriding the uvicorn entrypoint (e.g. `services.auth.main:app` in [k8s/base/auth.yaml](k8s/base/auth.yaml)). Rollouts are atomic — one image tag promotes every backend service together.

The customer storefront is plain static assets in [frontend/](frontend/) — synced to S3 by CI and served via CloudFront, with `/api/*` falling through to the public ALB. The admin console ships as its own NGINX image (`admin-ui`) and lives behind an internal ALB reachable only through VPN ([infra/terraform/modules/vpn/](infra/terraform/modules/vpn/)).

## Configuration

Secrets live in AWS Secrets Manager and are pulled into the cluster by External Secrets Operator. Non-secret config is in SSM Parameter Store. Nothing sensitive in env files or images.

Pods get AWS permissions via IRSA — each ServiceAccount is bound to a scoped IAM role. No static credentials anywhere.

## Scaling

- **HPA** on CPU/memory for every service ([k8s/base/hpa.yaml](k8s/base/hpa.yaml))
- **Cluster Autoscaler** adds nodes when pods pend
- **KEDA** scales invoice processing on SQS queue depth ([k8s/base/keda-invoice-scaler.yaml](k8s/base/keda-invoice-scaler.yaml))

## Regions

Primary: `eu-west-1`. Cross-region read replica in `us-east-1` for DR. Multi-region active-active is on the roadmap but not there yet — for now US customers hit the EU region via CloudFront.

## TODO

- GuardDuty + Security Hub baseline
- Prometheus + Grafana (currently only CloudWatch)
- Move to Karpenter
- Istio for mTLS between services
