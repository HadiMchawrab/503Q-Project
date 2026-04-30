# Generic IRSA (IAM Roles for Service Accounts) helper.
# Given a Kubernetes service account name + namespace, produces an IAM role
# whose trust policy lets that one service account assume it via the cluster's
# OIDC provider. Caller attaches a permissions policy with `policy_json`.

data "aws_caller_identity" "current" {}

locals {
  trusted_namespaces = length(var.namespaces) > 0 ? var.namespaces : [var.namespace]
  trusted_subs       = [for ns in local.trusted_namespaces : "system:serviceaccount:${ns}:${var.service_account_name}"]
}

data "aws_iam_policy_document" "trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [var.oidc_provider_arn]
    }

    # Scope the role to specific service accounts. With multiple namespaces
    # (e.g. dev + prod sharing one cluster), all of them are listed here.
    condition {
      test     = "StringEquals"
      variable = "${var.oidc_provider_url}:sub"
      values   = local.trusted_subs
    }

    condition {
      test     = "StringEquals"
      variable = "${var.oidc_provider_url}:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "this" {
  name               = var.role_name
  assume_role_policy = data.aws_iam_policy_document.trust.json
}

resource "aws_iam_role_policy" "this" {
  name   = "${var.role_name}-policy"
  role   = aws_iam_role.this.id
  policy = var.policy_json
}
