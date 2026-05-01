# ShopCloud — end-to-end architecture

This document is the single source of truth for **how the system fits together** — what runs where, how requests flow, how config and secrets get to pods, how images get built and shipped, how dev differs from prod. It's grounded in the current state of the repo (file paths cited inline). When the code changes, this doc should be updated alongside it.

---

## 1. Big picture

ShopCloud is a small e-commerce platform. Five backend services, one customer storefront, one internal admin console, and one async invoice pipeline.

```
                           ┌──────────────────────────────────────┐
                           │ Customer (public internet)           │
                           └─────────────────┬────────────────────┘
                                             │ HTTPS
                                             ▼
                           ┌──────────────────────────────────────┐
                           │ Route 53 (latency routing)           │
                           └─────────────────┬────────────────────┘
                                             │
                                             ▼
                           ┌──────────────────────────────────────┐
                           │ CloudFront + WAF                     │
                           │   /         → S3 (storefront assets) │
                           │   /api/*    → Public ALB             │
                           └─────┬─────────────────┬──────────────┘
                                 │                 │
                                 ▼                 ▼
                ┌──────────────────────┐  ┌─────────────────────────────────┐
                │ S3 frontend bucket   │  │ Public ALB (managed by AWS LBC) │
                │ index.html, app.js,  │  │   /api/auth     → auth Service  │
                │ admin.js, cognito.js │  │   /api/catalog  → catalog       │
                │ styles.css, assets/  │  │   /api/cart     → cart          │
                │ (private, OAC only)  │  │   /api/checkout → checkout      │
                └──────────────────────┘  └─────────┬───────────────────────┘
                                                    │
              ┌─────────────────────────────────────┼─────────────────────────────────┐
              │                                     ▼                                 │
              │   EKS cluster (eu-west-1, 3 AZs, prod & dev namespaces)               │
              │                                                                       │
              │   Deployments (each = its own pods, Service, HPA):                    │
              │     auth ─── catalog ─── cart ─── checkout ─── admin ─── admin-ui     │
              │       │                    │           │           │           │      │
              │       └──────┬─────────────┘           ▼           │           ▼      │
              │              │                ┌────────────┐       │   internal-only  │
              │              ▼                │ checkout   │       │                  │
              │      ┌────────────┐           │  (IRSA)    │───┐   │                  │
              │      │ asyncpg    │           └────────────┘   │   │                  │
              │      │ pool       │                            │   │                  │
              │      └─────┬──────┘                            │   │                  │
              └────────────┼────────────────────────────────────┼───┼──────────────────┘
                           │                                    │   │
                           ▼                                    ▼   ▼
                ┌──────────────────────┐                ┌─────────────────────────┐
                │ RDS Postgres         │                │ SQS invoice queue       │
                │ (Multi-AZ private)   │                └─────────┬───────────────┘
                └──────────────────────┘                          │
                ┌──────────────────────┐                          ▼
                │ ElastiCache Redis    │     ┌─────────────────────────────────────┐
                │ (cart sessions)      │     │ Lambda: invoice_generator           │
                └──────────────────────┘     │   reportlab → S3 → SES → RDS UPDATE │
                                             └─────────────────────────────────────┘

                              ┌────────────────────────────────────┐
                              │ Admins (corporate, never internet) │
                              └────────────────────┬───────────────┘
                                                   │ AWS Client VPN (mTLS)
                                                   ▼
                              ┌────────────────────────────────────┐
                              │ Internal ALB (no public DNS)       │
                              │   /             → admin-ui Service │
                              │   /api/auth     → auth Service     │
                              │   /api/admin    → admin Service    │
                              └────────────────────┬───────────────┘
                                                   │
                                                   ▼
                                       (same EKS cluster as above)
```

Two things to internalize from this picture:

1. **Customers and admins traverse fundamentally different network paths.** Customers go internet → CloudFront → public ALB. Admins go VPN → internal ALB. The two paths share the same EKS pods underneath; what differs is who can reach them.
2. **Static assets do not run in the cluster.** The customer storefront ([frontend/](../frontend/)) is plain HTML/JS/CSS hosted by S3 + CloudFront. The cluster only runs API services and the admin-ui NGINX image.

---

## 2. The services

Every service is a FastAPI app built on a tiny scaffold ([shared/service.py](../shared/service.py)). They all gain `/health`, structured error handling, CORS, and security headers for free.

| Service | Port | Code | Responsibility | Endpoints (paths relative to the service's `ROOT_PATH`) |
|---|---|---|---|---|
| **auth** | 3004 | [services/auth/main.py](../services/auth/main.py) | Identity. In Cognito mode it just exposes `/me` and `/config`; in local-dev mode it also exposes `/login` and `/register` and seeds an admin from env vars. | `GET /config`, `GET /me`, `POST /login` (dev only), `POST /register` (dev only), `GET /health` |
| **catalog** | 3001 | [services/catalog/main.py](../services/catalog/main.py) | Read-only product browsing — list, search, filter, sort, single product, categories. | `GET /products`, `GET /products/{id}`, `GET /categories`, `GET /health` |
| **cart** | 3002 | [services/cart/main.py](../services/cart/main.py) | Cart state in **Redis**, keyed `cart:{user_id}` ([shared/cart_store.py](../shared/cart_store.py)). Validates price/stock by calling **catalog** over HTTP on every add. | `GET /`, `POST /items`, `PATCH /items/{id}`, `DELETE /items/{id}`, `DELETE /` |
| **checkout** | 3003 | [services/checkout/main.py](../services/checkout/main.py) | The transactional service. Reads cart from Redis, runs a single Postgres transaction with `SELECT ... FOR UPDATE` row locks ([services/checkout/main.py:104](../services/checkout/main.py#L104)), creates order + line items, decrements stock, clears cart, publishes `invoice.requested` to SQS. | `POST /` (place order), `GET /orders`, `GET /orders/{id}` |
| **admin** | 3005 | [services/admin/main.py](../services/admin/main.py) | Internal CRUD. Every route gated by `Depends(require_role("admin"))` ([services/admin/main.py:27](../services/admin/main.py#L27)) — non-admin tokens get 403 even if they reach the endpoint. | `GET /summary`, `GET/POST/PATCH /products`, `GET /orders`, `PATCH /orders/{id}/status` |
| **admin-ui** | 80 | [admin-ui/Dockerfile](../admin-ui/Dockerfile) | NGINX serving static admin assets. **No Python.** Sits behind the internal ALB. | `/` → `index.html`, plus the JS/CSS bundle |

### Shared modules worth knowing

- [shared/db.py](../shared/db.py) — single asyncpg pool per process, with retry-on-startup so pods don't crashloop racing Postgres on first deploy. `transaction()` is what checkout uses for the row-locking flow.
- [shared/auth.py](../shared/auth.py) — dual-mode token verification (Cognito RS256 / local HS256) + `current_user` FastAPI dependency + `require_role` factory + `upsert_user_from_claims` (JIT mirroring of Cognito identities into local `users` table).
- [shared/cart_store.py](../shared/cart_store.py) — Redis read/write for the cart, with a 7-day TTL.
- [shared/queue.py](../shared/queue.py) — wraps boto3 SQS in `asyncio.to_thread`. **No-ops when `INVOICE_QUEUE_URL` is empty** — that's how local dev skips the SQS/Lambda/SES path.
- [shared/config.py](../shared/config.py) — frozen dataclass of every env var the services consume.
- [shared/errors.py](../shared/errors.py) — `AppError` exception, error response envelope, registered handlers.
- [shared/service.py](../shared/service.py) — `create_app()`, the FastAPI factory every service uses.

---

## 3. Identity, sessions, and who gets to do what

### Two Cognito User Pools, two architectural roles

[infra/terraform/modules/cognito/main.tf](../infra/terraform/modules/cognito/main.tf) provisions:

- `shopcloud-customers` — open self-signup, 10-char passwords, email auto-verification.
- `shopcloud-admins` — `allow_admin_create_user_only = true`, 14-char passwords, mandatory TOTP MFA.

A user's **role is derived from which pool issued their token** ([shared/auth.py:99-115](../shared/auth.py#L99-L115)). No groups, no Lambda triggers. If you ever need three+ roles, switch to Cognito groups + a pre-token Lambda — that's the only file that'd change.

### What actually runs at sign-in

**Cognito mode (production):**

```
1. Browser hits CloudFront → S3 → loads index.html + app.js
2. User clicks "Sign in" → app.js calls Cognito.startLogin('customer')
3. cognito.js fetches /api/auth/config to learn the Cognito Hosted UI domain + client_id
4. Builds a PKCE code_verifier + code_challenge, stores verifier in sessionStorage
5. location.assign(<hosted_ui_domain>/oauth2/authorize?...code_challenge=...)
6. User signs in (or signs up) at Cognito's hosted page
7. Cognito redirects back to location.origin + location.pathname?code=<auth_code>
8. cognito.js completeLoginIfNeeded() exchanges code+verifier for tokens
9. Stores id_token, refresh_token, expiresAt in localStorage
10. Future fetch() calls include Authorization: Bearer <id_token>
11. Backend verifies the JWT against the pool's JWKS (shared/auth.py)
12. shared/auth.py upsert_user_from_claims() mirrors {sub, name, email} into Postgres users
```

**Local-dev mode (`APP_ENV != production` AND no Cognito configured):**

```
1. Browser loads localhost:8080/ → gateway serves frontend/index.html
2. /api/auth/config returns mode: 'local'
3. app.js shows the local sign-in form instead of the Cognito redirect button
4. User submits email + password → POST /api/auth/login (HS256, bcrypt)
5. Auth service returns {user, token} → frontend stores in localStorage
6. Future fetch() calls include Authorization: Bearer <hs256_token>
7. Backend verifies HS256 with JWT_SECRET (shared/auth.py)
```

Both modes converge at the backend: every protected route hangs off `Depends(current_user)` ([shared/auth.py:158](../shared/auth.py#L158)), which produces a claims dict with `sub`, `email`, `name`, `role`. Routes don't care which mode produced the token.

### Refresh tokens

The frontend's `api()` wrapper ([frontend/app.js](../frontend/app.js), [frontend/admin.js](../frontend/admin.js)) intercepts 401s. If a refresh token is present, it calls Cognito's `/oauth2/token` with `grant_type=refresh_token`, swaps the new ID token in, and retries the original request **once**. Concurrent 401s share a single `refreshInFlight` promise so a page firing five parallel requests only refreshes once. Refresh failure clears local state and the user is bounced back to the sign-in screen on next interaction. Local-dev mode has no refresh — tokens are valid for 8 hours, then re-login.

### IRSA — pod-level AWS permissions

Only the **checkout** ServiceAccount carries an IAM role ARN ([k8s/base/checkout.yaml:1-7](../k8s/base/checkout.yaml#L1-L7), [k8s/overlays/prod/checkout-sa-patch.yaml](../k8s/overlays/prod/checkout-sa-patch.yaml), terraform-side at [infra/terraform/environments/prod/main.tf:181-190](../infra/terraform/environments/prod/main.tf#L181-L190)). That role's only permission is `sqs:SendMessage` on the invoice queue. Every other pod has zero AWS API permissions. If a bug in cart accidentally tried to publish to SQS, AWS would reject the call.

---

## 4. The end-to-end "place an order" flow

This is the canonical walkthrough — every step is real code.

```
Browser (frontend/app.js)
   │  GET /api/auth/config
   ▼
CloudFront ── /api/* ──► Public ALB ── /api/auth ──► auth Service
                                                          │
                                                          ▼
                                            services/auth/main.py:67
                                            returns {mode, customer:{...}}
   │  (login flow as in §3)
   ▼
   user signs in, frontend stores id_token

   │  GET /api/catalog/products
   ▼
ALB ── /api/catalog ──► catalog Service ── 1 of N catalog pods
                                                  │
                                                  ▼
                                          services/catalog/main.py:33
                                                  │
                                                  ▼ asyncpg pool
                                          RDS Postgres `products`

   │  POST /api/cart/items   Authorization: Bearer ...
   ▼
ALB ── /api/cart ──► cart Service ── 1 of N cart pods
                                          │
                                          ▼
                                  services/cart/main.py:67
                                  shared/auth.py current_user verifies JWT
                                  shared/auth.py upsert_user_from_claims
                                          │
                                          ▼ httpx
                                  http://catalog:3001/products/{id}
                                  (validates price + stock cross-service)
                                          │
                                          ▼
                                  ElastiCache Redis SET cart:{user_id}

   │  POST /api/checkout/  { shippingAddress }
   ▼
ALB ── /api/checkout ──► checkout Service ── 1 of N checkout pods
                                                    │
                                                    ▼
                                            services/checkout/main.py:87
                                                    │
                                                    ▼ Redis GET cart:{user_id}
                                            ┌─── Postgres TXN ──────────────┐
                                            │ SELECT ... FOR UPDATE         │ row locks
                                            │ INSERT INTO orders            │
                                            │ INSERT INTO order_items × N   │
                                            │ UPDATE products SET stock = … │
                                            └───────────────────────────────┘
                                                    │
                                                    ▼ Redis DEL cart:{user_id}
                                                    │
                                                    ▼ shared/queue.py
                                                  SQS SendMessage
                                                    │
                                                    ▼
                                  ┌──────── Lambda: invoice_generator ────────┐
                                  │ load_order from RDS                       │
                                  │ idempotency: skip if invoice_status=sent  │
                                  │ render PDF (reportlab)                    │
                                  │ S3 put_object → invoices/{order_id}.pdf  │
                                  │ S3 generate_presigned_url (24h)           │
                                  │ SES send_email                            │
                                  │ UPDATE orders SET invoice_status='sent'   │
                                  └───────────────────────────────────────────┘

   │  201 { order, message: "Invoice queued" }
   ▼
Browser updates UI
```

Two non-obvious mechanics worth understanding:

1. **`SELECT ... FOR UPDATE`** at [services/checkout/main.py:104](../services/checkout/main.py#L104) is what makes concurrent checkouts safe. Two customers fighting over the last unit of stock will serialize on the lock and one will get `INSUFFICIENT_STOCK`. Without this, both could "succeed" and stock would go negative.

2. **At-least-once SQS + Lambda idempotency.** SQS guarantees at-least-once delivery; a Lambda timeout can re-trigger the same message. [lambda/invoice_generator/handler.py:143](../lambda/invoice_generator/handler.py#L143) checks `invoice_status == 'sent'` before doing anything and skips if true. Without that, customers could get duplicate invoice emails. The Lambda also returns `batchItemFailures` so SQS retries only the failed messages, not the whole batch.

---

## 5. The database

[database/init.sql](../database/init.sql) — four tables, applied as a Postgres init script ([docker-compose.dev.yml:12](../docker-compose.dev.yml#L12)) for local dev. **There is no migration tool wired up yet** — schema changes against a populated prod database have no automated path (audit item still open).

| Table | Purpose | Key fields | Foreign keys |
|---|---|---|---|
| `users` | Profile mirror of Cognito identity. In local-dev also stores `password_hash` and `role`. | `id` (Cognito `sub` or local UUID), `email` UNIQUE, `name`, `password_hash` NULL, `role` NULL CHECK in (`customer`, `admin`) | referenced by `orders.user_id` |
| `products` | Catalog | `id`, `sku` UNIQUE, `name`, `price_cents`, `stock`, `is_active` | referenced by `order_items.product_id` |
| `orders` | One row per placed order | `user_id`, `status`, `total_cents`, `shipping_address`, `invoice_status`, `invoice_url` | `user_id` → `users.id` |
| `order_items` | Line items, **price/name snapshotted at purchase time** | `order_id`, `product_id`, `product_name`, `unit_price_cents` | `order_id` → `orders.id` (CASCADE), `product_id` → `products.id` |

Why `order_items` snapshots `product_name` and `unit_price_cents` instead of joining: if a product is renamed or re-priced later, the historical order still shows what the customer actually bought and paid. Always do this.

---

## 6. Container images — three images, three reasons

Three Dockerfiles, three ECR repos, three runtimes.

### `shopcloud-app` ([Dockerfile](../Dockerfile))
Single Python 3.11 image carrying:
- `requirements.txt` deps (FastAPI, asyncpg, redis, PyJWT, bcrypt, boto3, httpx)
- The `services/` package (all five services' code)
- The `shared/` package (db, auth, queue, etc.)

Used by **all five backend Deployments**. Each Deployment overrides `command:` to pick its own uvicorn entrypoint:

```yaml
# k8s/base/auth.yaml
image: shopcloud-app:latest
command: ["uvicorn", "services.auth.main:app", ...]

# k8s/base/catalog.yaml
image: shopcloud-app:latest
command: ["uvicorn", "services.catalog.main:app", ...]
```

Same image, different processes, six independent fleets of pods. Image content is shared; the *running code* in each pod is just one service.

### `admin-ui` ([admin-ui/Dockerfile](../admin-ui/Dockerfile))
NGINX alpine + the four static admin files (`index.html`, `admin.js`, `cognito.js`, `styles.css`) baked in. No Python. This is its own image because:
- It's NGINX, not Python — different base image entirely.
- It's deployed behind the **internal** ALB, not the public one. Bundling it with the customer storefront would be a security boundary violation.

### `invoice-generator` ([lambda/invoice_generator/Dockerfile](../lambda/invoice_generator/Dockerfile))
AWS Lambda runtime image. Has `reportlab` + `psycopg` that the API services don't need. Different deploy target (Lambda, not EKS), different IAM, different scaling model. Genuinely unrelated workload.

### What's *not* in any image: the storefront
[frontend/](../frontend/) is plain HTML/JS/CSS — no container of its own. Local dev mounts it into the gateway NGINX. Prod ships it to S3 and CloudFront serves it. Putting it in a container would mean a Python interpreter or NGINX process running just to hand out static files that don't change between requests.

---

## 7. Kubernetes — what actually runs

### Per-service Deployments

Six Deployments in [k8s/base/](../k8s/base/), one per service. Each one:
- Picks pods by `app: <name>` selector
- Runs the same image (`shopcloud-app` or `admin-ui`) with a service-specific `command:`
- Has its own readinessProbe and livenessProbe on `/health` (or `/` for admin-ui)
- Sets resource requests (`100m` CPU / `128Mi` mem for backends, `50m`/`64Mi` for admin-ui) and limits
- Pulls env from the `shopcloud-config` ConfigMap and `shopcloud-secrets` Secret (backends only)
- Has its own Service in front of it for cluster-internal DNS

```
auth Deployment       → auth Service       → cluster DNS: auth:3004
catalog Deployment    → catalog Service    → cluster DNS: catalog:3001
cart Deployment       → cart Service       → cluster DNS: cart:3002
checkout Deployment   → checkout Service   → cluster DNS: checkout:3003
admin Deployment      → admin Service      → cluster DNS: admin:3005
admin-ui Deployment   → admin-ui Service   → cluster DNS: admin-ui:80
```

Inter-service calls use these DNS names. E.g. cart calling catalog uses `http://catalog:3001/products/{id}` ([services/cart/main.py:47](../services/cart/main.py#L47), via `settings.catalog_service_url` from [shared/config.py](../shared/config.py)).

### Configuration sources

```
ConfigMap shopcloud-config  ◄── k8s/app-configmap.yaml + overlay overrides
   │       (non-secret: APP_ENV, *_SERVICE_URL, AWS_REGION, COGNITO_*, INVOICE_QUEUE_URL)
   │
   ▼ envFrom: configMapRef
[ pod ]
   ▲ envFrom: secretRef
   │
Secret shopcloud-secrets    ◄── k8s/base/secrets.yaml (placeholder values only)
        (DATABASE_URL, REDIS_URL — production sources these from AWS Secrets Manager
         via the External Secrets Operator, NOT from this Secret manifest)
```

Per-pod env vars (`PORT`, `ROOT_PATH`) are set inline in each Deployment because they vary per service.

### Ingress — two ALBs, different origins

**Public ALB** ([k8s/base/ingress.yaml](../k8s/base/ingress.yaml)) — `internet-facing`, fronted by CloudFront:
- `/api/auth` → auth:3004
- `/api/catalog` → catalog:3001
- `/api/cart` → cart:3002
- `/api/checkout` → checkout:3003
- (no catch-all for `/` — CloudFront serves `/` from S3, not from the ALB)

**Internal ALB** ([k8s/base/ingress-admin.yaml](../k8s/base/ingress-admin.yaml)) — `scheme: internal`, no public DNS, reachable only via Client VPN:
- `/api/admin` → admin:3005
- `/api/auth` → auth:3004 (so admins can hit `/config` and `/me`)
- `/` → admin-ui:80 (catch-all, must be last)

The ALB does **not** strip `/api/auth` before forwarding to the auth pod. Each backend Deployment sets `ROOT_PATH=/api/<name>` ([k8s/base/auth.yaml:23-24](../k8s/base/auth.yaml#L23-L24)) so FastAPI's OpenAPI/Swagger renders correct URLs while routes are defined as `/login`, `/me`, etc. without the prefix.

### Scaling — three layers

1. **HPA** ([k8s/base/hpa.yaml](../k8s/base/hpa.yaml)) — every backend service scales 2→6 replicas at 70% CPU. Admin caps at 4. (CPU is a blunt signal for I/O-bound FastAPI services — known limitation, audit item still open.)
2. **Cluster Autoscaler** — when HPA wants more pods than nodes can fit, the autoscaler grows the EKS managed node group. Provisioned by the EKS module ([infra/terraform/modules/eks/](../infra/terraform/modules/eks/)).
3. **KEDA** ([k8s/base/keda-invoice-scaler.yaml](../k8s/base/keda-invoice-scaler.yaml)) — currently a no-op. Wired up to scale a future `invoice-worker` Deployment 0→20 based on SQS queue depth. Today the invoice processor is the Lambda, so the ScaledObject points at a target that doesn't exist (KEDA silently ignores missing targets).

### Lifecycle independence

Per-service Deployments mean:
- `kubectl rollout restart deployment/auth` recycles only auth pods. Catalog, cart, etc. unaffected.
- An auth pod crashes? K8s restarts that one pod from the existing image. The other pods don't notice.
- Each Deployment has its own logs/metrics, tagged with `app: <name>`.
- HPA scales each fleet on its own load — a traffic spike on `/api/catalog/products` scales catalog without touching cart or auth.

### Two namespaces, one cluster, separate data

`prod` and `dev` are separate Kubernetes namespaces in the **same** cluster. The IRSA role's trust policy ([infra/terraform/environments/prod/main.tf:185-186](../infra/terraform/environments/prod/main.tf#L185-L186)) accepts both namespaces, so the same role works for both.

**Data isolation strategy: same instance, different databases (Option 1).** The single RDS instance hosts two Postgres databases — `shopcloud_prod` and `shopcloud_dev` — provisioned by the data module via the `postgresql` provider ([infra/terraform/modules/data/main.tf](../infra/terraform/modules/data/main.tf)). Each namespace's `DATABASE_URL` (in `shopcloud-secrets`, set per-overlay) points at its own database. CI fills the URL from `terraform output rds_url_prod` / `rds_url_dev`. Postgres' database-level isolation prevents cross-database queries by default.

Redis is shared across both environments; cart keys are namespaced via `CART_KEY_PREFIX` (`cart:prod:` vs `cart:dev:`), set per-overlay's `configMapGenerator`. [shared/cart_store.py](../shared/cart_store.py) prepends this prefix.

Other differences:

| | `dev` | `prod` |
|---|---|---|
| Replicas per service | 1 | 2 (base default) |
| Branch that deploys | `dev` | `main` |
| Postgres database | `shopcloud_dev` | `shopcloud_prod` |
| Redis key prefix | `cart:dev:` | `cart:prod:` |
| `INVOICE_QUEUE_URL` | empty (no real emails) | terraform output |
| Manual approval to deploy | no | yes (GitHub Environment) |

**Trade-offs of Option 1:** dev load can starve prod CPU/IOPS on the shared instance, and an OOM in dev would impact prod. Acceptable for a course demo or low-traffic side-project; if either environment grows, move to Option 2 (separate RDS instances per env, separate terraform environment under `infra/terraform/environments/dev/`).

---

## 8. Local dev — what's running and how it differs

`docker compose -f docker-compose.dev.yml up` starts everything except the cloud bits (RDS, ElastiCache, SQS, Lambda, Cognito, CloudFront, ALB).

### Services running locally

```
postgres          (postgres:16-alpine, host port 55432)
redis             (redis:7-alpine, host port 6380)
auth              (shopcloud-app:local, internal port 3004)
catalog           (shopcloud-app:local, internal port 3001)
cart              (shopcloud-app:local, internal port 3002)
checkout          (shopcloud-app:local, internal port 3003)
admin             (shopcloud-app:local, internal port 3005)
admin-ui          (shopcloud-admin-ui:local, host port 8081)
gateway           (nginx:1.27-alpine, host port 8080)
```

Five backends share **one** image (`shopcloud-app:local`) — built once, reused across services. Same pattern as K8s. Each service overrides `command:` ([docker-compose.dev.yml:34](../docker-compose.dev.yml#L34)).

### Endpoints

| URL | What you get |
|---|---|
| `http://localhost:8080` | Gateway → storefront (`/`) + `/api/*` routed to services |
| `http://localhost:8081` | Admin console (NGINX-served static + its own `/api/auth` and `/api/admin` proxies) |
| `localhost:55432` | Postgres (psql for debugging) |
| `localhost:6380` | Redis (`redis-cli` for debugging) |

### Local mode shortcuts

The `.env` file sets `APP_ENV=development` and leaves Cognito vars blank. That triggers **local-dev mode**:

- [services/auth/main.py](../services/auth/main.py) exposes `/login`, `/register`, and seeds an admin (`admin@shopcloud.local` / `Admin123!`) on first boot ([services/auth/main.py:67-83](../services/auth/main.py#L67-L83))
- [shared/auth.py](../shared/auth.py) issues HS256 tokens signed with `JWT_SECRET`
- The frontend's `applyAuthMode()` shows the local sign-in form instead of the Cognito redirect button ([frontend/app.js](../frontend/app.js))
- [shared/queue.py](../shared/queue.py) `publish_invoice_event` no-ops because `INVOICE_QUEUE_URL` is empty — orders complete but no PDF/email side effect

### What dev does NOT exercise

- Cognito Hosted UI redirect flow (no real Cognito available)
- SQS → Lambda → S3 → SES invoice pipeline
- Refresh token flow (local mode tokens have no refresh)
- The internal ALB / VPN / public ALB (gateway nginx fakes the routing)
- Rolling updates, HPA, multi-pod load balancing
- Token verification against Cognito JWKS

If you change anything in `shared/auth.py`'s Cognito branch, the smoke test ([scripts/smoke.py](../scripts/smoke.py)) and local dev won't catch it. Test against a real (sandbox) Cognito pool before merging changes there.

---

## 9. Build and deploy — the CI/CD pipeline

Two workflows in [.github/workflows/](../.github/workflows/):

### `deploy.yml` — application deploys

Triggers:
- **Push to `dev` branch** → deploys to `dev` namespace.
- **Push to `main` branch** → deploys to `prod` namespace (gated by GitHub `prod` Environment manual approval).
- **PR** → builds images for validation, does NOT push or deploy.
- **`workflow_dispatch`** → manual override of the environment.

Steps (push case):

```
1. resolve     — branch → environment mapping. main=prod, dev=dev, PRs build-only.
2. build       — short Git SHA tag. Uses GitHub OIDC to assume the env's IAM role.
                 - docker build -f Dockerfile -t shopcloud-app:$SHA .
                 - docker build -f admin-ui/Dockerfile -t admin-ui:$SHA .
                 - docker push (both)
3. deploy      — runs only on push, gated by GitHub Environment for prod.
                 a) update kubeconfig for the EKS cluster
                 b) terraform output -raw <name> for each value the overlay needs:
                    - INVOICE_QUEUE_URL
                    - COGNITO_USER_POOL_ID, COGNITO_ADMIN_POOL_ID
                    - COGNITO_CLIENT_ID, COGNITO_ADMIN_CLIENT_ID
                    - COGNITO_CUSTOMER_DOMAIN, COGNITO_ADMIN_DOMAIN
                    - CHECKOUT_IRSA_ROLE_ARN
                    - FRONTEND_BUCKET, CLOUDFRONT_DISTRIBUTION_ID
                 c) sync frontend/ → S3 (long-cache for assets, no-cache for index.html)
                 d) CloudFront invalidate /index.html, /app.js, /admin.js, /cognito.js, /styles.css
                 e) `kustomize edit set image` for both shopcloud-app and admin-ui to $SHA
                 f) `kustomize edit add configmap shopcloud-config --behavior=merge` with the tf values
                 g) sed the IRSA role ARN into checkout-sa-patch.yaml
                 h) kubectl diff (informational), kubectl apply
                 i) wait for `kubectl rollout status` on every Deployment with 5min timeout
```

The image tag in [k8s/overlays/<env>/kustomization.yaml](../k8s/overlays/dev/kustomization.yaml) defaults to `placeholder-set-by-ci`. ECR is `IMMUTABLE` — `:latest` would be rejected on the second push, hence SHA-only tags.

### `terraform.yml` — infra

Triggers:
- **PR touching `infra/terraform/**`** → `terraform plan`, posts the plan as a PR comment.
- **Push to `main` touching `infra/terraform/**`** → `terraform apply` against prod (manual approval via GitHub Environment).

Today there's only `infra/terraform/environments/prod/`. When you add a `dev/` env, mirror the same pattern.

### What CI doesn't do

- No post-deploy smoke test against the cluster ([scripts/smoke.py](../scripts/smoke.py) only runs in local-dev mode).
- No automatic DB migration step (no migration tool wired up).
- No image vulnerability gate (ECR's `scan_on_push` runs but doesn't block deploys).

---

## 10. AWS — what terraform builds

[infra/terraform/environments/prod/main.tf](../infra/terraform/environments/prod/main.tf) composes 9 modules:

| Module | What it provisions |
|---|---|
| `network` | VPC, subnets across 3 AZs, NAT gateway. |
| `eks` | EKS cluster + managed node group. |
| `data` | RDS Postgres (Multi-AZ private), ElastiCache Redis, security groups scoping access to the node group. |
| `storage` | Two ECR repos: `shopcloud-app`, `admin-ui`. Image scanning on push. Lifecycle keeps last 30 images. **`image_tag_mutability = IMMUTABLE`**. |
| `messaging` | SQS invoice queue + DLQ. |
| `s3` | Invoices S3 bucket. |
| `lambda` | Invoice generator Lambda (container image), VPC config, IAM. |
| `iam_irsa` | The single `shopcloud-checkout` IAM role mapped to the `checkout` ServiceAccount in both `dev` and `prod` namespaces. Only permission: `sqs:SendMessage` on the invoice queue. |
| `cognito` | Two user pools + two app clients + two Hosted UI domains. |
| `s3_frontend` | Private S3 bucket for storefront assets, OAC-protected. |
| `edge` | CloudFront distribution (two origins: ALB + S3 frontend bucket), WAF (managed rules + rate limit), Route 53 latency records. |
| `vpn` | AWS Client VPN endpoint + ENI associations + auth rules. Reachable from VPC, mTLS auth. |

Cross-region read replica in `us-east-1` for DR is also defined inline in [main.tf:226-238](../infra/terraform/environments/prod/main.tf#L226-L238) (gated by `enable_cross_region_replica`).

---

## 11. Where to add things — cheat sheet

| Want to add | Files to touch |
|---|---|
| New endpoint on an existing service | `services/<name>/main.py` only |
| New env var | [shared/config.py](../shared/config.py), [.env.example](../.env.example), [k8s/app-configmap.yaml](../k8s/app-configmap.yaml) (or `secrets.yaml` if sensitive). If it comes from terraform, add to terraform outputs and to [.github/workflows/deploy.yml](../.github/workflows/deploy.yml) `tf_out` step + `kustomize edit add configmap`. |
| New service | New `services/<name>/main.py`, add to [Dockerfile](../Dockerfile)'s `COPY services` (already covered by directory copy). Add a Deployment+Service yaml under [k8s/base/](../k8s/base/), include in [k8s/base/kustomization.yaml](../k8s/base/kustomization.yaml). Add an HPA in [k8s/base/hpa.yaml](../k8s/base/hpa.yaml). Add a route in [gateway/nginx.conf](../gateway/nginx.conf), [k8s/base/ingress.yaml](../k8s/base/ingress.yaml), and a service block in [docker-compose.dev.yml](../docker-compose.dev.yml). |
| New AWS resource | New module under [infra/terraform/modules/](../infra/terraform/modules/), wire from [environments/prod/main.tf](../infra/terraform/environments/prod/main.tf). Output via [outputs.tf](../infra/terraform/environments/prod/outputs.tf) if CI needs it. |
| Pod needs an AWS permission | New `iam_irsa` module instance in [environments/prod/main.tf](../infra/terraform/environments/prod/main.tf), annotate the ServiceAccount with the role ARN (mirror [k8s/overlays/prod/checkout-sa-patch.yaml](../k8s/overlays/prod/checkout-sa-patch.yaml)). |
| Storefront UI change | [frontend/](../frontend/) — pure static. Push to `dev` or `main`, CI syncs to S3. |
| Admin console UI change | [frontend/admin.js](../frontend/admin.js), [frontend/styles.css](../frontend/styles.css), or [admin-ui/public/index.html](../admin-ui/public/index.html). Triggers an admin-ui image rebuild. |

---

## 12. Branch model — `dev` vs `main`

```
feature branch        ─── PR ───▶  dev branch        ─── PR ───▶  main branch
    │                                  │                              │
    │ (PR only)                        │ (push)                       │ (push)
    ▼                                  ▼                              ▼
Build images for           Deploy to dev namespace          Deploy to prod namespace
validation (no push,       (1 replica per service,          (2 replicas per service,
 no deploy)                 INVOICE_QUEUE_URL empty)         real SQS, real Cognito,
                                                              manual approval gate)
```

There is intentionally **no fast-forward path from feature → main**. Changes go feature → dev → main, with separate deploy gates at each transition.

---

## 13. Known limitations and open audit items

These are real and tracked. Fixing any one of them is bounded work; don't deploy to a real customer-facing prod without addressing them.

### Open
- **No DB migration tool.** Schema changes on populated prod DB have no path. Wire up alembic.
- **No post-deploy smoke test.** [scripts/smoke.py](../scripts/smoke.py) is local-only.
- **HPA on CPU only.** FastAPI is I/O-bound; CPU is a blunt scaling signal. Should add request latency or asyncpg pool saturation.
- **Refresh tokens in localStorage.** Fine for course demo, harden to httpOnly-cookie + backend exchange for real customer data.
- **No request IDs / tracing.** Cross-service debugging has no correlation key.
- **CORS wide open.** [shared/service.py:23-29](../shared/service.py#L23-L29) is `allow_origins=["*"]`.
- **No rate limiting** outside CloudFront WAF (which only sees CloudFront-fronted traffic, not internal traffic).
- **First terraform apply may need two passes** — circular reference between `s3_frontend` bucket policy and `edge` distribution. `try()` guards make this safe but the operator needs to know.
- **First Cognito apply may collide on domain prefix** — defaults `shopcloud-customers` / `shopcloud-admins` are globally unique across AWS. Override with `-var` if taken.

### Closed in this branch
- ✅ Local dev restored (Cognito-required mode broke `docker compose up`).
- ✅ Single `shopcloud-app` image instead of mismatched per-service repos.
- ✅ Admin internal ingress now exposes `/api/auth` and `/`.
- ✅ Image-tag immutability — overlays use SHA placeholders, CI fills them.
- ✅ Smoke test rewritten to refuse non-local mode.
- ✅ Storefront moved out of K8s — S3 + CloudFront.
- ✅ Admin-ui added as a real K8s Deployment.
- ✅ CI/CD workflows written.

---

## 14. Quick reference

**Login as a user (Cognito):** redirect to Hosted UI → callback → token in localStorage → backend verifies via JWKS.

**Login as a user (local dev):** POST `/api/auth/login` → HS256 token → backend verifies with `JWT_SECRET`.

**Add to cart:** `POST /api/cart/items` → cart pod → httpx to catalog pod → Redis SET.

**Place order:** `POST /api/checkout/` → DB transaction with row locks → SQS publish → Lambda renders PDF → SES emails customer.

**Deploy app to prod:** push to `main` → CI builds + tags `<short SHA>` → S3 sync + CloudFront invalidate → kustomize apply → rollout status.

**Add a new env var that comes from terraform:** add to [outputs.tf](../infra/terraform/environments/prod/outputs.tf), add a line in [shared/config.py](../shared/config.py), add a line in `tf_out` step of [deploy.yml](../.github/workflows/deploy.yml), add a `--from-literal` line in the `kustomize edit add configmap` step.

**Connect to a pod for debugging:** `kubectl -n <ns> exec -it deployment/<name> -- /bin/sh`.

**Tail logs of one service:** `kubectl -n <ns> logs -l app=<name> --tail=200 -f`.

**Trigger a rolling restart without changing code:** `kubectl -n <ns> rollout restart deployment/<name>`.
