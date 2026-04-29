# One ECR repository per service.
# Image scanning is enabled so we get notified about CVEs in our images.

resource "aws_ecr_repository" "this" {
  for_each = toset(var.services)

  name                 = each.key
  image_tag_mutability = "IMMUTABLE" # tags can't be overwritten — every image is a unique version

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}

# Lifecycle policy — keep the last 30 images per repo, delete older ones.
# Stops the repo from growing forever and racking up storage costs.
resource "aws_ecr_lifecycle_policy" "this" {
  for_each   = aws_ecr_repository.this
  repository = each.value.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last 30 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 30
      }
      action = { type = "expire" }
    }]
  })
}
