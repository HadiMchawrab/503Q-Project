# Kubernetes/EKS starter notes

This folder intentionally contains only starter manifests. The Phase 2 app is Dockerized and ready to be pushed to Amazon ECR. For a real EKS deployment, create one Deployment and one Service per component:

- web
- auth
- catalog
- cart
- checkout
- admin
- admin-ui
- invoice-worker

Use environment variables from ConfigMaps and Secrets. Keep the storefront public, keep the admin API internal, and expose the admin-ui only through an internal ALB or VPN-only ingress. Keep production and development in separate namespaces or, preferably, separate AWS accounts/VPCs.
