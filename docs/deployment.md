# Deployment

End-to-end runbook for taking shopcloud from an empty AWS account to a running
production environment. Each step lists what changes in AWS, what changes in
the repo, and how to verify it before moving on.

The deployment has three layers, each depending on the one above:

```
1. AWS bootstrap   (one-time, manual — creates the foundation Terraform itself depends on)
2. Terraform       (creates VPC, EKS, RDS, ECR, SQS, IAM, Cognito, CloudFront, ...)
3. Kubernetes      (deploys app images into the EKS cluster Terraform built)
```

Layer 1 is manual and runs once per AWS account. Layers 2 and 3 are automated
by [`.github/workflows/terraform.yml`](../.github/workflows/terraform.yml) and
[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml).

---

## Step 1 — Terraform state backend

**Status: done** (executed against AWS account `621721788004`, region `eu-west-1`).

Terraform needs somewhere durable to store its state file and a way to prevent
two `terraform apply` runs from corrupting it concurrently. Both must exist
**before** the first `terraform init` because the backend is referenced from
[`backend.tf`](../infra/terraform/environments/prod/backend.tf) and Terraform
reads it before it can create anything.

### What was created

**S3 bucket — `shopcloud-tfstate-621721788004`**

| Setting | Value | Why |
|---|---|---|
| Region | `eu-west-1` | Same region as the rest of the infra. |
| Versioning | Enabled | A corrupt or accidentally-deleted state file can be rolled back to a previous version. Required for safe Terraform operation. |
| Default encryption | SSE-S3 (`AES256`) with bucket keys | State files contain RDS passwords, IAM ARNs, and other secrets — never store them unencrypted. Bucket keys reduce KMS request volume (and cost) when KMS is later enabled. |
| Public access block | All four flags `true` (`BlockPublicAcls`, `IgnorePublicAcls`, `BlockPublicPolicy`, `RestrictPublicBuckets`) | Defence-in-depth — even if a future IAM mistake granted public ACLs, the account-level block prevents the object from becoming reachable. |
| Lifecycle rules | None | State file is small; old versions are cheap and useful for recovery. |

**DynamoDB table — `shopcloud-tflock`**

| Setting | Value | Why |
|---|---|---|
| Region | `eu-west-1` | Co-located with the state bucket. |
| Partition key | `LockID` (string) | Required by Terraform's S3 backend protocol — the value Terraform writes is a hash of the state path. |
| Billing mode | `PAY_PER_REQUEST` | Lock writes are infrequent (one per `apply`); on-demand is cheaper than any provisioned floor and removes capacity tuning. |
| Tags | `Project=shopcloud`, `ManagedBy=manual-bootstrap`, `Purpose=terraform-state-lock` | `ManagedBy=manual-bootstrap` flags this as out-of-band infra — a future operator should not assume Terraform owns it. |

### Commands (for the record / for re-running in another account)

```bash
# Bucket
aws s3api create-bucket \
  --bucket shopcloud-tfstate-<account-id> \
  --region eu-west-1 \
  --create-bucket-configuration LocationConstraint=eu-west-1

aws s3api put-bucket-versioning \
  --bucket shopcloud-tfstate-<account-id> \
  --region eu-west-1 \
  --versioning-configuration Status=Enabled

aws s3api put-bucket-encryption \
  --bucket shopcloud-tfstate-<account-id> \
  --region eu-west-1 \
  --server-side-encryption-configuration \
    '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":true}]}'

aws s3api put-public-access-block \
  --bucket shopcloud-tfstate-<account-id> \
  --region eu-west-1 \
  --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

# Lock table
aws dynamodb create-table \
  --table-name shopcloud-tflock \
  --region eu-west-1 \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --tags Key=Project,Value=shopcloud \
         Key=ManagedBy,Value=manual-bootstrap \
         Key=Purpose,Value=terraform-state-lock
```

### Repo change

Added [`infra/terraform/environments/prod/backend.tf`](../infra/terraform/environments/prod/backend.tf):

```hcl
terraform {
  backend "s3" {
    bucket         = "shopcloud-tfstate-621721788004"
    key            = "prod/terraform.tfstate"
    region         = "eu-west-1"
    dynamodb_table = "shopcloud-tflock"
    encrypt        = true
  }
}
```

`key = "prod/terraform.tfstate"` reserves the top-level `prod/` prefix in the
bucket. When a dedicated `infra/terraform/environments/dev` is added later, it
should use `key = "dev/terraform.tfstate"` in the same bucket so dev and prod
state are isolated objects but share the lock table.

### Verification

```
$ aws s3api get-bucket-versioning --bucket shopcloud-tfstate-621721788004
{ "Status": "Enabled" }

$ aws s3api get-bucket-encryption --bucket shopcloud-tfstate-621721788004
SSEAlgorithm: AES256, BucketKeyEnabled: true

$ aws s3api get-public-access-block --bucket shopcloud-tfstate-621721788004
All four flags: true

$ aws dynamodb describe-table --table-name shopcloud-tflock --query 'Table.TableStatus'
ACTIVE
```

### Repo state after this step

```
infra/terraform/environments/prod/
├── backend.tf                  # NEW — points Terraform at S3 + DynamoDB
├── main.tf
├── outputs.tf
├── terraform.tfvars.example
└── variables.tf
```

No state file exists locally yet. The first `terraform init` (Step 3) will
create the state object inside the bucket on first `apply`.

### Rollback / cleanup

These are persistent foundation resources — deleting them destroys the ability
to manage every other Terraform-managed resource. Only remove after running
`terraform destroy` on every environment that uses this backend, then:

```bash
aws s3 rm s3://shopcloud-tfstate-621721788004 --recursive
# Then permanently delete versioned objects (versioning is on)
aws s3api delete-bucket --bucket shopcloud-tfstate-621721788004 --region eu-west-1
aws dynamodb delete-table --table-name shopcloud-tflock --region eu-west-1
```

---

## Step 2 — GitHub OIDC + IAM roles

**Status: done** (executed against AWS account `621721788004`).

The two GitHub Actions workflows ([`deploy.yml`](../.github/workflows/deploy.yml)
and [`terraform.yml`](../.github/workflows/terraform.yml)) authenticate to AWS
via OpenID Connect — no long-lived access keys are stored in the repo. Each
workflow run gets a short-lived JWT from GitHub, presents it to AWS STS, and
assumes a pre-created IAM role. AWS validates the JWT's signature against
GitHub's published JWKS (which is what the OIDC provider record below points
at) and, if the `sub` claim matches the role's trust policy condition, hands
back temporary credentials.

For this to work three things must exist in AWS, all of which were created
in this step:

1. An **OIDC identity provider** record pointing at GitHub's issuer URL.
2. A **prod role** trusted only when the JWT's `sub` claim matches the `main`
   branch or the `prod` Environment.
3. A **dev role** trusted only when the JWT's `sub` matches `dev` branch,
   `dev` Environment, or any pull request.

### What was created

**OIDC provider — `arn:aws:iam::621721788004:oidc-provider/token.actions.githubusercontent.com`**

| Setting | Value | Why |
|---|---|---|
| Issuer URL | `https://token.actions.githubusercontent.com` | GitHub's documented OIDC issuer. |
| Client ID list | `sts.amazonaws.com` | The audience GitHub stamps into JWTs targeting AWS — `aws-actions/configure-aws-credentials@v4` requests this audience by default. |
| Thumbprints | `6938fd4d98bab03faadb97b34396831e3780aea1`, `1c58a3a8518e8759bf075b76b750d4f2df264fcd` | GitHub's two current intermediate CA thumbprints. AWS modern regions verify the chain via the AWS-managed root list, but providing thumbprints stays compatible with older code paths and is harmless. |

Only one OIDC provider per issuer URL can exist per account, so this resource
is shared by every repo in the account that uses GitHub OIDC.

**Role — `gh-actions-shopcloud-prod`**

ARN: `arn:aws:iam::621721788004:role/gh-actions-shopcloud-prod`

| Setting | Value | Why |
|---|---|---|
| Trust policy `sub` claim must match | `repo:HadiMchawrab/503Q-Project:ref:refs/heads/main` **OR** `repo:HadiMchawrab/503Q-Project:environment:prod` | The build job runs on a push to `main` (branch-form sub); the deploy/apply jobs run under `environment: prod` (environment-form sub) after manual approval. Both must be allowed or the workflow stalls. |
| Audience condition | `aud == sts.amazonaws.com` | Defends against a token minted for a different audience being replayed here. |
| Max session duration | 1 hour | Workflows finish well inside this — short window limits blast radius if a token leaks. |
| Attached policy | `AdministratorAccess` (AWS-managed) | Terraform creates VPC, IAM, EKS, RDS, CloudFront, ACM, Cognito, Lambda, ... Building the minimal policy upfront is a yak-shave that fails iteratively on the first apply. **Tighten this after the infra exists** by inspecting CloudTrail and replacing with a custom policy. |

**Role — `gh-actions-shopcloud-dev`**

ARN: `arn:aws:iam::621721788004:role/gh-actions-shopcloud-dev`

| Setting | Value | Why |
|---|---|---|
| Trust policy `sub` claim must match | `repo:HadiMchawrab/503Q-Project:ref:refs/heads/dev` **OR** `repo:HadiMchawrab/503Q-Project:environment:dev` **OR** `repo:HadiMchawrab/503Q-Project:pull_request` | Dev workflow runs on the `dev` branch and under the `dev` Environment. PRs (build-only smoke test in [`deploy.yml`](../.github/workflows/deploy.yml)) emit the `pull_request` form. |
| Max session duration | 1 hour | Same reasoning. |
| Attached policy | Inline `shopcloud-dev-deploy` (custom) | Dev never runs `terraform apply`, so it gets a tight allowlist instead of admin. See breakdown below. |

**`shopcloud-dev-deploy` inline policy** — what it allows and why:

| Sid | Why dev needs it |
|---|---|
| `EcrPushPull` | Build and push images to ECR. `ecr:GetAuthorizationToken` is wildcarded by API contract; the layer/image actions are wildcarded because ECR repo ARNs are created by Terraform after this policy is written. |
| `EksDescribeAndConnect` | `aws eks update-kubeconfig` requires `eks:DescribeCluster`. |
| `TerraformStateRead` | The deploy workflow does `terraform output -raw …` to read queue URLs, IRSA ARNs, etc. — it must read the state object but never write it. Scoped to the tfstate bucket only. |
| `TerraformLockTable` | `terraform init` acquires/releases the lock even for read-only `output` calls. Scoped to the lock table only. |
| `FrontendBucketSync` | `aws s3 sync frontend/ s3://shopcloud-frontend-…` for the storefront. Scoped to the frontend bucket only. |
| `CloudFrontInvalidate` | After a storefront sync, invalidate the cache. |
| `ReadDbSecret` | Future use — if dev pods ever need to fetch the DB password directly (currently they get `DATABASE_URL` from Terraform output via the deploy workflow). Scoped to the `shopcloud/rds/password*` ARN only. |
| `StsCallerIdentity` | `aws sts get-caller-identity` is used as a connectivity sanity check at the top of jobs. |

What dev **cannot** do: create or modify VPCs, IAM, EKS, RDS, Cognito, Lambda;
write to the tfstate bucket; touch any S3 bucket other than the frontend one;
read any Secrets Manager secret other than the RDS password.

### Commands (for the record / for re-running in another account)

```bash
# OIDC provider
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list \
    6938fd4d98bab03faadb97b34396831e3780aea1 \
    1c58a3a8518e8759bf075b76b750d4f2df264fcd

# Prod role
aws iam create-role \
  --role-name gh-actions-shopcloud-prod \
  --assume-role-policy-document file://infra/bootstrap/trust-prod.json \
  --max-session-duration 3600 \
  --tags Key=Project,Value=shopcloud \
         Key=ManagedBy,Value=manual-bootstrap \
         Key=Environment,Value=prod

aws iam attach-role-policy \
  --role-name gh-actions-shopcloud-prod \
  --policy-arn arn:aws:iam::aws:policy/AdministratorAccess

# Dev role
aws iam create-role \
  --role-name gh-actions-shopcloud-dev \
  --assume-role-policy-document file://infra/bootstrap/trust-dev.json \
  --max-session-duration 3600 \
  --tags Key=Project,Value=shopcloud \
         Key=ManagedBy,Value=manual-bootstrap \
         Key=Environment,Value=dev

aws iam put-role-policy \
  --role-name gh-actions-shopcloud-dev \
  --policy-name shopcloud-dev-deploy \
  --policy-document file://infra/bootstrap/policy-dev.json
```

The trust and policy JSON documents are committed under
[`infra/bootstrap/`](../infra/bootstrap/) so the bootstrap can be reproduced
verbatim. They are intentionally **not** managed by Terraform — Terraform
itself depends on the prod role existing.

### Repo change

Added under [`infra/bootstrap/`](../infra/bootstrap/):

- [`trust-prod.json`](../infra/bootstrap/trust-prod.json) — prod role trust policy
- [`trust-dev.json`](../infra/bootstrap/trust-dev.json) — dev role trust policy
- [`policy-dev.json`](../infra/bootstrap/policy-dev.json) — dev role inline permissions

### Verification

```
$ aws iam list-attached-role-policies --role-name gh-actions-shopcloud-prod
AdministratorAccess  arn:aws:iam::aws:policy/AdministratorAccess

$ aws iam list-role-policies --role-name gh-actions-shopcloud-dev
shopcloud-dev-deploy
```

Real end-to-end verification only happens once GitHub repo secrets are wired
up (Step 5) and a workflow runs.

### Repo state after this step

```
infra/
├── bootstrap/                  # NEW — bootstrap inputs (not managed by Terraform)
│   ├── policy-dev.json
│   ├── trust-dev.json
│   └── trust-prod.json
└── terraform/
    └── environments/prod/
        ├── backend.tf
        ├── main.tf
        ├── outputs.tf
        ├── terraform.tfvars.example
        └── variables.tf
```

### Values to plug into GitHub later (Step 5)

These ARNs become the `ROLE_TO_ASSUME_PROD` / `ROLE_TO_ASSUME_DEV` secrets:

```
ROLE_TO_ASSUME_PROD = arn:aws:iam::621721788004:role/gh-actions-shopcloud-prod
ROLE_TO_ASSUME_DEV  = arn:aws:iam::621721788004:role/gh-actions-shopcloud-dev
```

### Rollback / cleanup

```bash
aws iam delete-role-policy   --role-name gh-actions-shopcloud-dev  --policy-name shopcloud-dev-deploy
aws iam delete-role          --role-name gh-actions-shopcloud-dev

aws iam detach-role-policy   --role-name gh-actions-shopcloud-prod --policy-arn arn:aws:iam::aws:policy/AdministratorAccess
aws iam delete-role          --role-name gh-actions-shopcloud-prod

aws iam delete-open-id-connect-provider \
  --open-id-connect-provider-arn arn:aws:iam::621721788004:oidc-provider/token.actions.githubusercontent.com
```

Only delete the OIDC provider if no other repo in this account uses it.

### Future tightening

Once Terraform has run end-to-end at least once, replace `AdministratorAccess`
on the prod role with a custom policy. The clean way:

1. Run CloudTrail's `LookupEvents` over the apply window, filter by the role's
   session principal.
2. Aggregate the `(eventSource, eventName)` tuples — that's the action set.
3. Author a managed policy with that action set, scope resources where you can
   (most VPC/IAM resource scoping has to stay `*`).
4. `aws iam attach-role-policy` the new managed policy, then detach
   `AdministratorAccess`.

## Step 3 — SES sender identity

**Status: done** (`hadi.mchawrab24@gmail.com` verified in `eu-west-1`,
`VerificationStatus: Success`).

The invoice pipeline (`checkout` -> SQS -> Lambda / `invoice-worker` pod)
finishes by sending the rendered PDF as an email through SES. SES refuses to
send "from" any address it cannot prove the sender controls, so the address
configured as `var.ses_sender` must be verified out-of-band before the first
end-to-end invoice will succeed.

### What was done

```bash
aws ses verify-email-identity \
  --email-address hadi.mchawrab24@gmail.com \
  --region eu-west-1
```

This registers the address as a verification candidate and triggers AWS to
email a single-use confirmation link (24h validity) to the inbox. The
identity stays in `Pending` until the link is clicked, then flips to
`Success`. Until then, any `SendEmail` call with that address as the From
header is rejected by SES.

### Account state and sandbox

```
$ aws ses get-account-sending-enabled --region eu-west-1
Enabled: true

$ aws ses get-send-quota --region eu-west-1
Max24HourSend:    200      # sandbox cap
MaxSendRate:      1/sec    # sandbox cap
SentLast24Hours:  0
```

The numbers above are the SES sandbox defaults: **200 emails per 24 hours,
one per second, and every recipient address must also be verified**. This is
fine for the bootstrap because we will only send to verified test addresses
during pipeline testing anyway.

To go beyond the sandbox (sending to arbitrary customer addresses, higher
rate limits) requires an AWS support ticket via the SES console, asking for
production access. Approval typically takes <24h and AWS will ask how
bounces/complaints are handled. **This step is intentionally deferred** —
not needed until real customer email is in scope.

### Deliverability caveat for `hadi.mchawrab24@gmail.com`

Gmail publishes `p=reject` DMARC for `@gmail.com`. When SES sends through
AWS IPs with a Gmail "From" address, receiving mail servers (Gmail, Outlook,
Yahoo) reject or junk the message because the sender domain (`gmail.com`)
does not authorise AWS to send on its behalf. SES itself accepts the send —
verification only proves inbox ownership — but downstream delivery is
unreliable.

Acceptable for end-to-end pipeline testing because we control the recipient
inbox in sandbox. **For real customer email, swap to an owned domain** by:

1. Verify the domain identity (`aws ses verify-domain-identity ...`) and add
   the DKIM CNAMEs AWS returns to that domain's DNS.
2. Change `var.ses_sender` in [`terraform.tfvars`](../infra/terraform/environments/prod/terraform.tfvars.example)
   to something like `invoices@yourdomain.com`.
3. `terraform apply` — the Lambda's `SES_SENDER` env var
   ([`main.tf:171`](../infra/terraform/environments/prod/main.tf#L171))
   updates in place.

### Repo change

None — SES verification is account state, not Terraform-managed. The address
becomes a Terraform input via `var.ses_sender` in
[`terraform.tfvars`](../infra/terraform/environments/prod/terraform.tfvars.example)
when Step 4 runs:

```hcl
ses_sender = "hadi.mchawrab24@gmail.com"
```

### Verification

After clicking the link in the inbox:

```
$ aws ses get-identity-verification-attributes \
    --identities hadi.mchawrab24@gmail.com \
    --region eu-west-1

VerificationStatus: Success
```

If the status is still `Pending` more than a few minutes after clicking, the
link was likely the wrong region's verification link (each AWS region runs
its own SES verifier and links are region-scoped). Re-run the
`verify-email-identity` call in `eu-west-1` and click the new link.

### Repo state after this step

Unchanged. Step 3 only touches AWS account state.

### Rollback

```bash
aws ses delete-identity \
  --identity hadi.mchawrab24@gmail.com \
  --region eu-west-1
```

Removes the identity entirely. Re-running `verify-email-identity` later
sends a fresh link.

## Step 4 — Terraform first apply

**Status: done.** All 84 planned resources created over four `terraform
apply` runs. The two `postgresql_database` resources are intentionally
disabled by `create_per_env_databases = false` and will be created
manually post-deploy (see "Per-env DB creation" below).

Final apply (Lambda + event source mapping) succeeded after the bootstrap
image was pushed to ECR. The Lambda is `Active` and running the
`shopcloud-invoice-generator:bootstrap` image — CI will overwrite this
once a Lambda build step is added to the deploy workflow.

This step is the heavy lift: it stands up everything from VPC and EKS down
to S3 and Cognito, leaving only CloudFront/storefront for Step 8 (which
needs the ALB DNS name that exists only after pods are deployed).

### Pre-apply repo prep

Before running anything, two repo changes were made:

**1. `.gitignore` hardened** for Terraform secrets/state. Root
[`.gitignore`](../.gitignore) was missing entries for `terraform.tfvars`,
`.terraform/`, and `*.tfstate*`. Added all three (a nested
[`infra/terraform/.gitignore`](../infra/terraform/.gitignore) was already
covering them inside that subtree, but the root file had nothing — belt
and suspenders).

**2. `terraform.tfvars` written** at
[`infra/terraform/environments/prod/terraform.tfvars`](../infra/terraform/environments/prod/terraform.tfvars)
(gitignored). Generated 32-char URL-safe random RDS password locally with
Python `secrets.choice` over `[A-Za-z0-9-_.~+%]` (alphabet excludes
`/`, `@`, `:`, `"`, `'`, backtick, `\`, `&`, `$`, `#` — those break
shell quoting and Postgres URL parsing). Other vars set per Step 4 plan:

```hcl
db_password                 = "<32-char generated>"
ses_sender                  = "hadi.mchawrab24@gmail.com"
public_alb_dns_name         = ""        # skips CloudFront + storefront bucket
domain_name                 = ""
hosted_zone_id              = ""
enable_cross_region_replica = false     # turn on after first apply works
enable_client_vpn           = false
```

The password is duplicated in three places after Terraform applies:
Secrets Manager (`shopcloud/rds/password`), the RDS master password, and
the local tfvars. Recoverable via
`aws secretsmanager get-secret-value --secret-id shopcloud/rds/password`
if the local copy is lost.

### `terraform init`

```
$ terraform init -input=false
```

Connected to the S3 backend (Step 1) and downloaded providers:

| Provider | Version | Purpose |
|---|---|---|
| `hashicorp/aws` | 5.100.0 | All AWS resources |
| `cyrilgdn/postgresql` | 1.26.0 | `CREATE DATABASE shopcloud_{prod,dev}` inside the RDS instance — see "create_per_env_databases" below |
| `hashicorp/tls` | 4.2.1 | Used internally by the EKS module to compute the OIDC issuer thumbprint |

A `.terraform.lock.hcl` was generated and **should** be committed (it pins
provider checksums so re-applies on different machines/runners get the
exact same provider binaries). Currently uncommitted on this branch — to
be committed alongside the other Step 4 changes.

### Pre-plan: ASCII fixes in resource descriptions

The first `terraform plan` failed immediately with:

```
Error: "description" doesn't comply with restrictions
("^[0-9A-Za-z_ .:/()#,@\\[\\]+=&;{}!$*-]*$"):
"invoice-generator Lambda → RDS Postgres"
```

AWS rejects non-ASCII characters in description fields on actual AWS
resources (security groups, CloudWatch alarms, Client VPN endpoints).
Terraform-internal `output {}` and `variable {}` description fields are
NOT subject to this — they live entirely in Terraform and never reach an
AWS API. Three real-resource descriptions had em-dashes (`—`) or arrows
(`→`):

- [`modules/lambda/main.tf:188`](../infra/terraform/modules/lambda/main.tf#L188) — `aws_security_group_rule` description
- [`modules/messaging/main.tf:28`](../infra/terraform/modules/messaging/main.tf#L28) — `aws_cloudwatch_metric_alarm` alarm_description
- [`modules/vpn/main.tf:41`](../infra/terraform/modules/vpn/main.tf#L41) — `aws_security_group` description (only triggers if `enable_client_vpn = true`, but fixed pre-emptively)

Replaced `→` with `to` and `—` with `--` in those three places.

### First plan

```
$ terraform plan -input=false -out=tfplan
Plan: 84 to add, 0 to change, 0 to destroy.
```

Resource breakdown:

| Category | Count | Notes |
|---|---|---|
| VPC + networking | 29 | 1 VPC, 1 IGW, 2 NAT + 2 EIP, 9 subnets, 5 route tables, 9 associations, 3 SGs, 1 SG rule |
| EKS | 12 | Cluster, node group, OIDC provider, 6 IAM roles, 6 attachments, 4 inline policies |
| RDS + Redis | 8 | RDS Multi-AZ, DB subnet group, ElastiCache replication group, ElastiCache subnet group, 2 SGs, 2 `postgresql_database` |
| ECR | 8 | 4 repositories + 4 lifecycle policies |
| Cognito | 6 | 2 user pools + 2 clients + 2 hosted UI domains |
| Invoice pipeline | 8 | S3 bucket + 4 settings, 2 SQS queues, Lambda, event source mapping, CloudWatch alarm |
| Secrets | 2 | Secrets Manager secret + version |
| **Total** | **84** | |

`frontend_bucket_name = ""`, `rds_replica_endpoint = ""` and no VPN
resources — correctly skipped per the tfvars.

### First apply — 80/84 created, 4 failed

```
$ terraform apply tfplan
```

Ran for ~12 minutes. Most resources created successfully. ElastiCache took
the longest (5m55s). RDS failed first:

```
Error: creating RDS DB Instance (shopcloud-postgres):
api error FreeTierRestrictionError: The specified backup retention period
exceeds the maximum available to free tier customers.
```

This account is in AWS Free Tier promotion, which caps RDS to:
- `multi_az = false` (Multi-AZ not free-tier eligible)
- `backup_retention_period = 0` (no automated backups)

The data module ([modules/data/main.tf](../infra/terraform/modules/data/main.tf))
defaulted to `multi_az = true` and `backup_retention_period = 7` — fine
on a paid account, rejected on free tier.

Because RDS failed, three downstream resources also failed: the Lambda's
`aws_security_group_rule.lambda_to_rds` (depends on RDS SG), the Lambda
function itself, and the SQS event source mapping.

### Fix #1 — free-tier-compatible RDS

Edited [modules/data/main.tf](../infra/terraform/modules/data/main.tf):

```hcl
multi_az                = false   # was: true
backup_retention_period = 0       # was: 7
```

Comment added documenting that real prod should set these back. Also
disabled `create_per_env_databases` in
[environments/prod/main.tf](../infra/terraform/environments/prod/main.tf)
because the postgres provider would try to connect to RDS from the laptop,
and RDS is in private subnets — unreachable from outside the VPC. The
`shopcloud_prod` and `shopcloud_dev` databases will be created manually
from a kubectl-exec'd pod inside the cluster (post-Step 4 task).

```hcl
module "data" {
  ...
  create_per_env_databases = false
}
```

### Second apply — RDS up, Lambda still blocked

```
$ terraform plan -out=tfplan   # delta: 3 to add, 1 to change, 0 to destroy
$ terraform apply tfplan
```

Failed almost immediately with:

```
Error: creating RDS DB Instance (shopcloud-postgres):
api error InvalidParameterCombination: Cannot find version 16.3 for postgres
```

Postgres 16.3 was retired in eu-west-1 between when this codebase was
written and now. Available 16.x patches: 16.6, 16.8, 16.9, 16.10, 16.11,
16.12, 16.13.

### Fix #2 — bump Postgres version

Edited [modules/data/main.tf:55](../infra/terraform/modules/data/main.tf#L55):

```hcl
engine_version = "16.13"   # was: "16.3"
```

16.13 is the latest 16.x patch — wire-compatible with 16.3, no schema
migration needed. Future-proofing note: AWS rotates these every 3-6
months; expect to bump again periodically.

### Third apply — RDS created, Lambda chicken-and-egg

```
$ terraform plan -out=tfplan   # 3 to add, 1 to change
$ terraform apply tfplan
```

RDS created successfully (~6 minutes). Then:

```
Error: creating Lambda Function (shopcloud-invoice-generator):
InvalidParameterValueException: Source image
621721788004.dkr.ecr.eu-west-1.amazonaws.com/shopcloud-invoice-generator:bootstrap
does not exist. Provide a valid source image.
```

The Lambda is configured as a container-image Lambda
([modules/lambda/main.tf:135](../infra/terraform/modules/lambda/main.tf#L135)
`package_type = "Image"`) pointing at `<ecr-repo>:bootstrap`. Terraform
created the ECR repo in this same apply, but no image has been pushed —
chicken-and-egg.

CI is the long-term owner of the image
([.github/workflows/deploy.yml](../.github/workflows/deploy.yml) — though
note CI does not currently build the Lambda image either, see "Open
issues" below). For first-apply unblock we push a placeholder manually.

### Fix #3 — push bootstrap image to ECR

The repo already has the real Lambda source at
[lambda/invoice_generator/](../lambda/invoice_generator/) (Dockerfile,
handler.py, requirements.txt). Build that and push as `:bootstrap`:

```powershell
# ECR auth (PowerShell pipe quirk: `aws ecr get-login-password | docker login --password-stdin`
# corrupts the password through PowerShell's UTF-16 default — capture into
# a variable first)
$pwd_str = (aws ecr get-login-password --region eu-west-1).Trim()
docker login --username AWS --password $pwd_str 621721788004.dkr.ecr.eu-west-1.amazonaws.com

docker build `
  -t 621721788004.dkr.ecr.eu-west-1.amazonaws.com/shopcloud-invoice-generator:bootstrap `
  lambda/invoice_generator

docker push 621721788004.dkr.ecr.eu-west-1.amazonaws.com/shopcloud-invoice-generator:bootstrap
```

Image size note: ~250 MB compressed (AWS Lambda Python 3.12 base ~190 MB +
boto3/psycopg/reportlab/pillow ~50 MB). One-time download; subsequent
builds reuse the cached base layer.

After the push completes, a fourth `terraform apply tfplan` will succeed
on the Lambda + event source mapping and bring the count to 84/84.

### State of AWS at this point in Step 4

Already created and tracked in Terraform state:

- VPC `10.0.0.0/16`, IGW, 2 NATs (`NAT-a`, `NAT-b`), 2 EIPs, 9 subnets
  (3 public, 3 private, 3 database), 5 route tables, 9 associations
- 3 networking SGs + 1 SG rule
- EKS cluster `shopcloud` (k8s 1.30), managed node group, OIDC provider
- 6 IAM roles (cluster, nodes, 4 IRSA), 6 attachments, 4 inline policies
- RDS Postgres (single-AZ, no backups, version 16.13) — `shopcloud-postgres`
- ElastiCache Redis replication group (multi-AZ — only RDS hits the
  free-tier wall) — `shopcloud-redis`
- 2 RDS/Redis SGs
- 4 ECR repositories (`shopcloud-app`, `admin-ui`, `invoice-worker`,
  `shopcloud-invoice-generator`) + 4 lifecycle policies
- 2 Cognito user pools (customers, admins) + 2 clients + 2 hosted UI domains
- S3 invoice bucket (`shopcloud-invoices-621721788004`) + versioning + SSE
  + public access block + lifecycle
- 2 SQS queues (main + DLQ), 1 CloudWatch alarm on the DLQ
- Secrets Manager `shopcloud/rds/password` + initial version

Pending (blocked on bootstrap image push):

- `aws_lambda_function.this` — the invoice generator
- `aws_lambda_event_source_mapping.sqs` — wires SQS to the Lambda

Skipped intentionally:

- `postgresql_database.per_env["shopcloud_{prod,dev}"]` — disabled by
  `create_per_env_databases = false`; will run from in-cluster pod
- `module.s3_frontend`, `module.edge` — gated on `public_alb_dns_name`
  (Step 8)
- `aws_db_instance.replica_us_east_1` — gated on `enable_cross_region_replica`
- `module.vpn` — gated on `enable_client_vpn`

### Repo changes for Step 4

```
.gitignore                                  EDITED — added terraform/* patterns
infra/terraform/environments/prod/
├── backend.tf                              (from Step 1)
├── terraform.tfvars                        NEW — gitignored, holds the password
├── main.tf                                 EDITED — create_per_env_databases = false
├── plan.txt / plan2.txt / plan3.txt        local artifacts (gitignored)
├── apply.log / apply2.log / apply3.log     local artifacts (gitignored)
└── tfplan                                  binary plan file (gitignored)
infra/terraform/modules/
├── data/main.tf                            EDITED — multi_az, backup_retention, engine_version
├── lambda/main.tf                          EDITED — ASCII description
├── messaging/main.tf                       EDITED — ASCII alarm_description
└── vpn/main.tf                             EDITED — ASCII description
.terraform.lock.hcl (in env/prod)           NEW — should be committed
```

### Per-env DB creation (next manual task)

The `shopcloud_prod` and `shopcloud_dev` databases inside the RDS
instance still need to be created. They were skipped during apply because
the postgres provider runs from wherever `terraform apply` runs (a laptop
outside the VPC), and RDS is in private subnets — unreachable from
outside.

The cleanest way to create them is from a one-shot pod inside the cluster
once kubeconfig is set up (Step 7+):

```bash
aws eks update-kubeconfig --name shopcloud --region eu-west-1

PASSWORD=$(aws secretsmanager get-secret-value \
  --secret-id shopcloud/rds/password \
  --query SecretString --output text)

kubectl run --rm -it psql-once --restart=Never \
  --image=postgres:16 -- \
  psql "postgresql://shopcloud:$PASSWORD@shopcloud-postgres.cjqo0amu2gx6.eu-west-1.rds.amazonaws.com:5432/shopcloud" \
  -c "CREATE DATABASE shopcloud_prod; CREATE DATABASE shopcloud_dev;"
```

The shopcloud master database (`db_name = "shopcloud"`) was created
automatically by RDS — that's what we connect to in order to issue
`CREATE DATABASE`.

### Terraform outputs (live values, current account)

For wiring into Step 5 (GitHub repo config) and beyond:

| Output | Value |
|---|---|
| `cluster_name` | `shopcloud` |
| `cluster_endpoint` | `https://830EF3E73435FF345A32CF602FC9187D.gr7.eu-west-1.eks.amazonaws.com` |
| `rds_endpoint` | `shopcloud-postgres.cjqo0amu2gx6.eu-west-1.rds.amazonaws.com` |
| `redis_endpoint` | `master.shopcloud-redis.ogcoyh.euw1.cache.amazonaws.com` |
| `invoice_queue_url` | `https://sqs.eu-west-1.amazonaws.com/621721788004/shopcloud-invoice-events` |
| `invoice_bucket_name` | `shopcloud-invoices-621721788004` |
| `invoice_lambda_ecr_url` | `621721788004.dkr.ecr.eu-west-1.amazonaws.com/shopcloud-invoice-generator` |
| `db_secret_arn` | `arn:aws:secretsmanager:eu-west-1:621721788004:secret:shopcloud/rds/password-CBsoBq` |
| `checkout_irsa_role_arn` | `arn:aws:iam::621721788004:role/shopcloud-checkout` |
| `invoice_worker_irsa_role_arn` | `arn:aws:iam::621721788004:role/shopcloud-invoice-worker` |
| `cluster_autoscaler_role_arn` | `arn:aws:iam::621721788004:role/shopcloud-cluster-autoscaler` |
| `cognito_customer_pool_id` | `eu-west-1_KEhDFvCn2` |
| `cognito_admin_pool_id` | `eu-west-1_mkqryBDYT` |
| `cognito_customer_client_id` | `6d4vv2j4eu88rcs132tkk4b77a` |
| `cognito_admin_client_id` | `75ncljb2jptcp9knv8sdle8l3m` |
| `cognito_customer_hosted_ui_domain` | `https://shopcloud-customers.auth.eu-west-1.amazoncognito.com` |
| `cognito_admin_hosted_ui_domain` | `https://shopcloud-admins.auth.eu-west-1.amazoncognito.com` |
| `frontend_bucket_name` | `""` (skipped — Step 8) |
| `cloudfront_distribution_id` | `""` (skipped — Step 8) |

ECR repos (per `ecr_repository_urls`):
- `621721788004.dkr.ecr.eu-west-1.amazonaws.com/shopcloud-app`
- `621721788004.dkr.ecr.eu-west-1.amazonaws.com/admin-ui`
- `621721788004.dkr.ecr.eu-west-1.amazonaws.com/invoice-worker`
- `621721788004.dkr.ecr.eu-west-1.amazonaws.com/shopcloud-invoice-generator`

### Open issues to address before merging Step 4 to main

1. **`.terraform.lock.hcl` is gitignored at
   [`infra/terraform/.gitignore:5`](../infra/terraform/.gitignore#L5).**
   Terraform best practice is to commit the lock file so every machine /
   CI runner uses identical provider checksums. The current setup lets
   each environment resolve provider versions independently, which is
   risky for CI reproducibility. Recommended fix: remove that line and
   force-add the file. (Not done in this session — flagged for review.)
2. **Bootstrap Lambda image is the real Dockerfile, not a placeholder.**
   When CI takes over the image lifecycle it will tag with the Git SHA,
   leaving `:bootstrap` orphaned. Either delete the `:bootstrap` tag
   manually after CI's first push, or accept it as a dead tag (ECR
   lifecycle policy will eventually clean it up).
3. **CI does not build the Lambda or invoice-worker images.**
   [.github/workflows/deploy.yml:98-119](../.github/workflows/deploy.yml#L98-L119)
   only builds `shopcloud-app` and `admin-ui`. Add a third build step for
   `lambda/invoice_generator/Dockerfile` and a fourth for
   `services/invoice_worker/Dockerfile`. Until that's in, the `bootstrap`
   tag is what the Lambda runs.
4. **Free-tier downgrades are local edits to a shared module.** A real
   prod account would want `multi_az = true` and `backup_retention = 7`.
   Either parameterize them on the module (`var.multi_az`,
   `var.backup_retention_period`) and override per-environment, or
   document that "switch to paid account" means reverting these specific
   lines.
5. **Deprecation warning on backend.** Terraform 1.14+ surfaces a warning
   that `dynamodb_table` is deprecated in favour of `use_lockfile = true`
   in [`backend.tf`](../infra/terraform/environments/prod/backend.tf).
   Cosmetic for now; bump when you next touch that file.
6. **`invoice-worker-sa-patch.yaml` IRSA ARN substitution missing in CI.**
   [.github/workflows/deploy.yml:250-251](../.github/workflows/deploy.yml#L250-L251)
   only `sed`s the checkout SA patch. The invoice-worker patch at
   [k8s/overlays/prod/invoice-worker-sa-patch.yaml:9](../k8s/overlays/prod/invoice-worker-sa-patch.yaml#L9)
   still has `REPLACE_ACCOUNT_ID` literal. Add a parallel `sed` using
   `terraform output -raw invoice_worker_irsa_role_arn`.

### Verification

After the bootstrap push and fourth apply succeed:

```
$ aws rds describe-db-instances --db-instance-identifier shopcloud-postgres \
    --query 'DBInstances[0].[DBInstanceStatus,Engine,EngineVersion,MultiAZ]' \
    --output text
available    postgres    16.13    False

$ aws lambda get-function --function-name shopcloud-invoice-generator \
    --query 'Configuration.[FunctionName,State,PackageType]' --output text
shopcloud-invoice-generator    Active    Image

$ aws eks describe-cluster --name shopcloud \
    --query 'cluster.[name,status,version]' --output text
shopcloud    ACTIVE    1.30
```

### Repo state after this step (when fully complete)

The Terraform state file in S3 (`shopcloud-tfstate-621721788004/prod/terraform.tfstate`)
will track 82 of the 84 originally planned resources (the two
`postgresql_database` resources are skipped by config, not failed). The
final two will be added to state once the per-env databases are created
manually post-Step 4 and the relevant config flag flipped back.

### Rollback / cleanup

`terraform destroy` from
[`infra/terraform/environments/prod`](../infra/terraform/environments/prod)
tears everything down. Order:

```
$ terraform destroy
```

Will take ~15 minutes (RDS deletion is the long pole). The state backend
S3 bucket and DDB table from Step 1 are NOT destroyed by this — they are
out-of-band manual resources, intentional.

## Step 5 — GitHub repo secrets, variables, and Environments

**Status: done** (configured at `https://github.com/HadiMchawrab/503Q-Project/settings`).

This step plugs the values Terraform produced (Step 4) and the IAM role
ARNs (Step 2) into GitHub so the workflows can authenticate to AWS and
target the right cluster/registry. Nothing is created in AWS — this is
pure GitHub configuration.

### Repository secrets

`Settings → Secrets and variables → Actions → Secrets`

| Name | Value | Used by |
|---|---|---|
| `ROLE_TO_ASSUME_PROD` | `arn:aws:iam::621721788004:role/gh-actions-shopcloud-prod` | Both workflows when running on `main` / `prod` env |
| `ROLE_TO_ASSUME_DEV` | `arn:aws:iam::621721788004:role/gh-actions-shopcloud-dev` | `deploy.yml` when running on `dev` / PRs |
| `RDS_DB_PASSWORD` | (the 32-char string from `terraform.tfvars`) | `terraform.yml` as `TF_VAR_db_password` ([terraform.yml:71](../.github/workflows/terraform.yml#L71), [`:120`](../.github/workflows/terraform.yml#L120)) |

**Drift warning.** `RDS_DB_PASSWORD` must match the value in the local
`terraform.tfvars` and the version stored in Secrets Manager
(`shopcloud/rds/password`). If they ever diverge, the next CI
`terraform apply` will silently rewrite the RDS master password to match
the GitHub secret. Rotate in all three places at once.

### Repository variables

`Settings → Secrets and variables → Actions → Variables`

| Name | Value | Used by |
|---|---|---|
| `ECR_REGISTRY` | `621721788004.dkr.ecr.eu-west-1.amazonaws.com` | `deploy.yml` for `docker tag` / `docker push` ([deploy.yml:104](../.github/workflows/deploy.yml#L104)) |
| `EKS_CLUSTER_NAME` | `shopcloud` | `deploy.yml` for `aws eks update-kubeconfig` ([deploy.yml:142](../.github/workflows/deploy.yml#L142)) |

Variables differ from secrets in that they are visible in workflow logs.
Both of these are non-sensitive (account ID is observable in any AWS API
call; cluster name is non-secret), so variable scope is correct.

### Environments

`Settings → Environments`

**`prod` environment:**

| Setting | Value | Why |
|---|---|---|
| Required reviewers | `HadiMchawrab` | Pauses any deploy or `terraform apply` targeting prod until manually approved. The `prod` GitHub Environment is what `terraform.yml`'s apply job ([terraform.yml:99](../.github/workflows/terraform.yml#L99)) and `deploy.yml`'s deploy job ([deploy.yml:131](../.github/workflows/deploy.yml#L131)) attach to via `environment: prod`. |
| Prevent self-review | unchecked | Solo project — checking it would lock you out (no one else can approve). On a team this should be on. |
| Wait timer | unchecked | Optional cooldown; not needed here. |
| Allow administrators to bypass | checked | Lets you override the approval gate in emergencies. Trade-off: weakens the gate. Off for stricter shops. |
| Deployment branches | `main` only | Even a manual `workflow_dispatch` from another branch can't target this environment. |

**`dev` environment:**

- No required reviewers (auto-deploys on every push to `dev`)
- Deployment branches: `dev` only

The `dev`/`prod` Environment names also matter for OIDC. The role trust
policies created in Step 2 condition on the JWT's `sub` claim, which
takes the form `repo:<owner>/<repo>:environment:<env>` when a workflow
job has `environment: <env>` set. So the Environment **name** must be
exactly `prod` or `dev` for OIDC to succeed; mismatched names → role
assumption fails with `AccessDenied`.

### Verification

The full chain only verifies end-to-end on the first workflow run
(Step 6). What we can confirm now:

```
Settings → Actions → Secrets         shows: 3 secrets set
Settings → Actions → Variables       shows: 2 variables set
Settings → Environments              shows: prod (1 protection rule), dev
```

### Repo state after this step

Unchanged. GitHub-side configuration only.

### Rollback

Delete the secrets/variables/environments in the GitHub UI. No AWS
resources are touched.

## Step 6 — First push / deploy (not yet done)

To be filled in when executed.

## Step 7 — Cluster autoscaler + KEDA (not yet done)

To be filled in when executed.

## Step 8 — Terraform second pass (CloudFront + storefront) (not yet done)

To be filled in when executed.
t r i g g e r  
 