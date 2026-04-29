# ShopCloud Phase 2 — FastAPI Application

ShopCloud is a Dockerized e-commerce platform built for the EECE 503Q DevSecOps project.  
This version rewrites the backend services using **Python FastAPI** while keeping the app aligned with the professor's architecture.


## V9 fixes compared with the first FastAPI build

- Keeps the same V7 customer/admin frontend behavior.
- Fixes demo/local email validation, including `admin@shopcloud.local`.
- Adds JSON-safe response serialization for UUIDs and timestamps.
- Adds startup retries for PostgreSQL and Redis.
- Fixes product card image markup and fallback behavior.
- Loads products even if category loading temporarily fails during startup.

## Technology stack

| Layer | Technology |
|---|---|
| Public frontend | Static HTML, CSS, JavaScript served by FastAPI |
| Backend services | Python FastAPI |
| API gateway | Nginx reverse proxy |
| Database | PostgreSQL |
| Cart/session storage | Redis |
| Invoice queue | Redis Stream, locally simulating SQS |
| Invoice generator | Python worker, locally simulating Lambda |
| Invoice PDFs | Docker volume served through `/invoices`, locally simulating S3 |
| Email | Console log simulation, locally simulating SES |
| Containers | Docker Compose |

## Service mapping

| Project service | Local implementation | AWS architecture mapping |
|---|---|---|
| Product catalog | `catalog` FastAPI service | EKS service behind public ALB |
| Shopping cart | `cart` FastAPI service + Redis | EKS service + ElastiCache Redis |
| Checkout | `checkout` FastAPI service | EKS service |
| Authentication | `auth` FastAPI service with JWT | Local Cognito-style simulation |
| Admin panel API | `admin` FastAPI service | EKS service behind internal ALB |
| Frontend | `web` FastAPI static server | CloudFront/static frontend path |
| Invoice generation | `invoice-worker` Python worker | SQS-triggered Lambda equivalent |
| Database | PostgreSQL container | Amazon RDS for PostgreSQL |
| Redis | Redis container | Amazon ElastiCache for Redis |
| Gateway | Nginx | ALB/API routing equivalent |

## Why this is safe for the DevOps part

This FastAPI rewrite does **not** make the DevOps phase harder.

It still uses:

- one Dockerfile
- Docker Compose
- separate containers per application component
- environment variables
- PostgreSQL
- Redis
- Nginx gateway
- clear service boundaries

This structure can still be pushed to ECR and deployed to EKS in the same way as the earlier Node/Express version.

## How to run locally on Windows CMD

Unzip the project folder on your Desktop. Then run:

```cmd
cd C:\Users\manso\OneDrive\Desktop\shopcloud-app-fastapi-v9
copy .env.example .env
docker compose up --build
```

Then open:

```text
http://localhost:8080
```

Admin console:

```text
http://localhost:8080/admin.html
```

Default admin:

```text
Email: admin@shopcloud.local
Password: Admin123!
```

## If you are switching from an older version

Stop the old app first:

```cmd
cd C:\Users\manso\OneDrive\Desktop\shopcloud-app-v7
docker compose down
```

Then start this version.

If Chrome still shows you as logged in from an old version, clear local storage for `localhost:8080` or open the site in Incognito mode.

## Useful API documentation links

Because the backend is FastAPI, each service has automatic API docs:

```text
http://localhost:8080/api/auth/docs
http://localhost:8080/api/catalog/docs
http://localhost:8080/api/cart/docs
http://localhost:8080/api/checkout/docs
http://localhost:8080/api/admin/docs
```

## Main endpoints

### Auth

| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/register` | Create customer account |
| POST | `/api/auth/login` | Login customer/admin |
| GET | `/api/auth/me` | Current user |

### Catalog

| Method | Path | Description |
|---|---|---|
| GET | `/api/catalog/products` | List products |
| GET | `/api/catalog/products/{id}` | Get one product |
| GET | `/api/catalog/categories` | List categories |

### Cart

| Method | Path | Description |
|---|---|---|
| GET | `/api/cart/` | View cart |
| POST | `/api/cart/items` | Add item |
| PATCH | `/api/cart/items/{productId}` | Update quantity |
| DELETE | `/api/cart/items/{productId}` | Remove item |
| DELETE | `/api/cart/` | Clear cart |

### Checkout

| Method | Path | Description |
|---|---|---|
| POST | `/api/checkout/` | Place order |
| GET | `/api/checkout/orders` | Customer order history |
| GET | `/api/checkout/orders/{id}` | Customer order details |

### Admin

| Method | Path | Description |
|---|---|---|
| GET | `/api/admin/summary` | Dashboard metrics |
| GET | `/api/admin/products` | Inventory table |
| POST | `/api/admin/products` | Add product |
| PATCH | `/api/admin/products/{id}` | Update product |
| GET | `/api/admin/orders` | View orders |
| GET | `/api/admin/orders/{id}` | Order details |
| PATCH | `/api/admin/orders/{id}/status` | Update order status |

## Invoice files

The invoice worker writes PDFs to a shared Docker volume. The web service serves them through `/invoices/...`, so the order history can open the generated invoice without requiring a host-folder permission workaround.

## Smoke test

After the app is running, in another terminal run:

```cmd
python scripts\smoke.py
```

This checks catalog and admin summary through the gateway.

## Important design choices

### FastAPI microservices

Each backend capability is a separate FastAPI service:

- `auth`
- `catalog`
- `cart`
- `checkout`
- `admin`

This matches the project architecture and keeps future EKS deployment straightforward.

### JWT auth

The local app uses JWTs to simulate the authentication layer. In the AWS architecture, this maps to Cognito.

### Admin access

The admin API is reachable locally for demonstration purposes. In the final AWS architecture, the admin path should be exposed only through an internal ALB reachable via Client VPN.

### Invoice generation

Checkout does not generate invoices directly. It publishes an invoice event to a Redis Stream. The invoice worker consumes the event and generates the PDF asynchronously. This locally simulates the AWS SQS → Lambda → S3 → SES design.

## Folder structure

```text
shopcloud-app-fastapi-v9/
├── database/
│   └── init.sql
├── gateway/
│   └── nginx.conf
├── services/
│   ├── auth/
│   ├── catalog/
│   ├── cart/
│   ├── checkout/
│   ├── admin/
│   └── invoice_worker/
├── shared/
├── web/
│   └── public/
├── k8s/
├── scripts/
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
└── README.md
```
