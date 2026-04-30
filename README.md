# ShopCloud

Small e-commerce platform running on AWS. Five services behind an EKS cluster, Postgres + Redis for data, and an async pipeline that emails invoice PDFs after checkout.

## Stack

- **Backend:** FastAPI (Python 3.11)
- **Frontend:** React (TypeScript)
- **Database:** PostgreSQL (RDS, Multi-AZ)
- **Cache / sessions:** Redis (ElastiCache)
- **Auth:** Cognito (separate customer + admin pools, JWT)
- **Async:** SQS + Lambda (PDF rendering) + S3 + SES
- **Infra:** Terraform
- **Runtime:** EKS, Helm, Argo CD
- **CI/CD:** GitHub Actions → ECR → Argo CD

## Services

| Service   | What it does                                  |
|-----------|-----------------------------------------------|
| catalog   | Product listings, search                      |
| cart      | Cart state (Redis-backed)                     |
| checkout  | Orders, payment, emits invoice events to SQS  |
| auth      | Token exchange, JWT validation against Cognito|
| admin     | Internal-only admin API                       |

Each service is a FastAPI app, one container per pod, 2 replicas minimum, spread across AZs.

## Traffic paths

- **Customers:** Route 53 → CloudFront → WAF → public ALB → EKS ingress
- **Admins:** Client VPN (cert + MFA) → internal ALB (no public DNS) → admin service

## Repo layout

```
.
├── services/
│   ├── catalog/        # FastAPI service
│   ├── cart/
│   ├── checkout/
│   ├── auth/
│   └── admin/
├── web/                # React frontend
├── lambda/
│   └── invoice-pdf/    # triggered by SQS
├── infra/
│   └── terraform/      # VPC, EKS, RDS, Redis, Cognito, SQS, etc.
├── deploy/
│   ├── helm/           # per-service charts
│   └── argocd/         # app definitions
└── .github/workflows/
```

## Running locally

Each service has its own `docker-compose.yml` for dev. The whole stack comes up with:

```
docker compose -f docker-compose.dev.yml up
```

This gives you Postgres, Redis, LocalStack (for SQS/S3/SES), and all five services on their own ports. Frontend runs separately:

```
cd web
npm install
npm run dev
```

Copy `.env.example` to `.env` in each service before starting.

## Deploying

Infra changes:

```
cd infra/terraform/<module>
terraform plan
terraform apply
```

App changes go through CI — push to `main`, the image gets built and pushed to ECR, Argo CD picks up the new tag and rolls it out. No manual `kubectl apply`.

Each backend service should have its own image tag in ECR, even if the services share the same Dockerfile and codebase. That keeps rollouts and scaling isolated per service.

The repo now follows a split-Dockerfile layout: one Dockerfile per app service plus one for the web frontend. That makes the ECR images map directly to Kubernetes Deployments.

## Configuration

Secrets live in AWS Secrets Manager and are pulled into the cluster by External Secrets Operator. Non-secret config is in SSM Parameter Store. Nothing sensitive in env files or images.

Pods get AWS permissions via IRSA — each ServiceAccount is bound to a scoped IAM role. No static credentials anywhere.

## Scaling

- **HPA** on CPU/memory for every service
- **Cluster Autoscaler** adds nodes when pods pend
- **KEDA** available if we move invoice workers into the cluster later

## Regions

Primary: `eu-west-1`. Cross-region read replica in `us-east-1` for DR. Multi-region active-active is on the roadmap but not there yet — for now US customers hit the EU region via CloudFront.

## TODO

- GuardDuty + Security Hub baseline
- Prometheus + Grafana (currently only CloudWatch)
- Move to Karpenter
- Istio for mTLS between services
