# CI/CD workflows

Two workflows, both follow the same branch model:

| Branch | Namespace | Deploy auto? | Terraform apply auto? |
|--------|-----------|--------------|------------------------|
| `dev`  | `dev`     | yes (push)   | no                     |
| `main` | `prod`    | yes (push)   | yes (push, with manual approval via the `prod` GitHub Environment) |
| any    | -         | PR builds image only, no deploy / no apply | -            |

## Files

- [deploy.yml](deploy.yml) — builds `shopcloud-app` and `admin-ui` images, pushes to ECR with the short Git SHA, then runs `kustomize build | kubectl apply` on the matching overlay.
- [terraform.yml](terraform.yml) — `terraform plan` on PRs (commented on the PR), `terraform apply` on push to `main`.

## Required prerequisites (one-time setup)

The workflows assume these exist. They are **not** created by the workflows.

### 1. AWS OIDC trust + IAM roles
Create a GitHub Actions OIDC provider in AWS, then two IAM roles:

- `shopcloud-ci-dev` — assumed when the workflow targets the `dev` namespace. Permissions: ECR push, EKS describe-cluster, S3 read on terraform state bucket, DynamoDB read on the lock table.
- `shopcloud-ci-prod` — same shape, prod scope. The terraform apply workflow uses this role too, so it additionally needs the full set of `aws_*` permissions terraform manages (VPC, EKS, RDS, etc.). You can scope this aggressively but it ends up looking close to AdministratorAccess for first-time setup.

The role trust policy must restrict by repo + branch — example for the prod role:

```json
{
  "Effect": "Allow",
  "Principal": { "Federated": "arn:aws:iam::ACCOUNT:oidc-provider/token.actions.githubusercontent.com" },
  "Action": "sts:AssumeRoleWithWebIdentity",
  "Condition": {
    "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
    "StringLike":   { "token.actions.githubusercontent.com:sub": "repo:OWNER/REPO:ref:refs/heads/main" }
  }
}
```

### 2. Repo-level GitHub Actions secrets
- `ROLE_TO_ASSUME_DEV` — full ARN of `shopcloud-ci-dev`.
- `ROLE_TO_ASSUME_PROD` — full ARN of `shopcloud-ci-prod`.
- `RDS_DB_PASSWORD` — used by `terraform.yml` as `TF_VAR_db_password`.

### 3. Repo-level GitHub Actions variables
- `ECR_REGISTRY` — e.g. `123456789012.dkr.ecr.eu-west-1.amazonaws.com`.
- `EKS_CLUSTER_NAME` — `shopcloud` (matches `module.eks.name` in terraform).

### 4. GitHub Environments
Create two environments in repo settings → Environments:
- `dev` — no required reviewers.
- `prod` — required reviewers (you, anyone else who can approve).

The deploy job declares `environment: ${{ ... }}` so prod deploys block on the manual approval gate.

### 5. Terraform remote state
Today [infra/terraform/environments/prod/main.tf](../../infra/terraform/environments/prod/main.tf) does not configure a backend — state lives on whoever's laptop ran the last `terraform apply`. CI cannot work this way. Add an S3 backend (and DynamoDB lock table) before the first CI apply:

```hcl
terraform {
  backend "s3" {
    bucket         = "shopcloud-terraform-state"
    key            = "envs/prod/terraform.tfstate"
    region         = "eu-west-1"
    dynamodb_table = "shopcloud-terraform-locks"
    encrypt        = true
  }
}
```

The bucket + lock table themselves should be provisioned out-of-band (chicken-and-egg).

### 6. ECR repositories
`terraform apply` against the prod environment creates the `shopcloud-app` and `admin-ui` repos via `module "storage"`. Run terraform once before the first deploy push or `docker push` will fail with `repository does not exist`.

## What the deploy workflow actually does

1. Resolves environment: `main` → `prod`, `dev` → `dev`, PR → build-only.
2. Builds both images, tags as `<short SHA>`.
3. On push (not PR): pushes both to ECR.
4. Resolves config from `terraform output` (queue URL, Cognito IDs, IRSA role ARN). Requires terraform state read access.
5. Runs `kustomize edit set image` to pin both image references to the SHA.
6. Runs `kustomize edit add configmap shopcloud-config --behavior=merge` with the terraform values.
7. `sed`s the IRSA role ARN into [k8s/overlays/<env>/checkout-sa-patch.yaml](../../k8s/overlays/dev/checkout-sa-patch.yaml). All these edits happen on the runner — nothing is committed back.
8. `kubectl diff` for the log, then `kubectl apply`.
9. Waits for every Deployment to roll out (5min timeout each).

## Known limitations

- **No post-deploy smoke test.** [scripts/smoke.py](../../scripts/smoke.py) only runs in local-dev mode. A k8s-aware smoke test (probe the public ALB after rollout) doesn't exist yet.
- **Dev terraform shares prod state.** When `infra/terraform/environments/dev/` is added, update both the dev branch logic in [terraform.yml](terraform.yml) and the `working-directory` expression in [deploy.yml](deploy.yml).
- **PR plan comment can be truncated** at 60k chars. Large stack plans get cut off.
