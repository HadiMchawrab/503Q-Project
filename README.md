# ShopCloud

Small e-commerce platform running on AWS. Five backend services plus a separate admin console endpoint behind an EKS cluster, Postgres + Redis for data, and an async pipeline that emails invoice PDFs after checkout.

## Stack

- **Backend:** FastAPI (Python 3.11)
- **Frontend:** React (TypeScript)
- **Database:** PostgreSQL (RDS, Multi-AZ)
- **Cache / sessions:** Redis (ElastiCache)
- **Auth:** Cognito (separate customer + admin pools, JWT)
- **Async:** SQS + Lambda (PDF rendering) + S3 + SES
- **Infra:** Terraform
- **Runtime:** EKS, Kustomize
- **CI/CD:** GitHub Actions → ECR → EKS

## Services

| Service   | What it does                                  |
|-----------|-----------------------------------------------|
| catalog   | Product listings, search                      |
| cart      | Cart state (Redis-backed)                     |
| checkout  | Orders, payment, emits invoice events to SQS  |
| auth      | Token exchange, JWT validation against Cognito|
| admin     | Internal-only admin API                       |
| admin-ui  | Internal-only admin console frontend          |

Each service is a FastAPI app, one container per pod, 2 replicas minimum, spread across AZs.

## Traffic paths

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
├── web/                     # customer storefront (React)
├── admin-ui/                # internal admin console (React, served via NGINX)
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
docker compose -f docker-compose.dev.yml up
```

This builds and starts Postgres, Redis, all five backend services, the customer storefront, the admin console, and an NGINX gateway that fronts them.

Endpoints:

| URL                       | What                                       |
|---------------------------|--------------------------------------------|
| http://localhost:8080     | Gateway → storefront + `/api/*` routes     |
| http://localhost:8081     | Admin console (admin-ui)                   |
| localhost:55432           | Postgres                                   |
| localhost:6380            | Redis                                      |

Invoice/SQS/SES flow is no-op'd locally: leave `INVOICE_QUEUE_URL` empty and `checkout` skips publishing (see [shared/queue.py](shared/queue.py)). Auth falls back to local HS256 JWTs signed with `JWT_SECRET` when Cognito vars are unset.

## Deploying

Infra changes:

```
cd infra/terraform/<module>
terraform plan
terraform apply
```

App changes go through CI — push to `main`, GitHub Actions builds and pushes images to ECR, then applies the relevant Kustomize overlay under [k8s/overlays/](k8s/overlays/) against the cluster.

Each backend service has its own image tag in ECR, even though several services share the same Dockerfile pattern. That keeps rollouts and scaling isolated per service.

The customer storefront and the admin console are split into separate frontend images and endpoints. In AWS, the admin console lives behind an internal ALB reachable only through VPN ([infra/terraform/modules/vpn/](infra/terraform/modules/vpn/)).

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
