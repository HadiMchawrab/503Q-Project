terraform {
  backend "s3" {
    bucket         = "shopcloud-tfstate-621721788004"
    key            = "prod/terraform.tfstate"
    region         = "eu-west-1"
    dynamodb_table = "shopcloud-tflock"
    encrypt        = true
  }
}
