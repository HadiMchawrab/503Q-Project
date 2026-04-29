# VPC with three tiers of subnets across 3 AZs:
#   - public:   for ALBs and NAT gateways (route to internet gateway)
#   - private:  for EKS nodes (route to internet via NAT)
#   - database: for RDS and Redis (no internet route at all)
#
# Two NAT gateways for HA — placed in the first two public subnets (AZ-a and AZ-b).
# Private subnets are routed to the NAT in their own AZ where possible; the third AZ
# falls back to the NAT in the first AZ.

# ----------------------------------------------------------------------------
# VPC
# ----------------------------------------------------------------------------
resource "aws_vpc" "this" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = { Name = "${var.name}-vpc" }
}

# ----------------------------------------------------------------------------
# Internet Gateway — lets public subnets reach the internet
# ----------------------------------------------------------------------------
resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = "${var.name}-igw" }
}

# ----------------------------------------------------------------------------
# Subnets — 3 AZs × 3 tiers = 9 subnets
# CIDR layout: 10.0.0.0/16 split into /20 blocks
#   public    : 10.0.0.0/20,   10.0.16.0/20,  10.0.32.0/20
#   private   : 10.0.48.0/20,  10.0.64.0/20,  10.0.80.0/20
#   database  : 10.0.96.0/20,  10.0.112.0/20, 10.0.128.0/20
# ----------------------------------------------------------------------------
resource "aws_subnet" "public" {
  count                   = length(var.azs)
  vpc_id                  = aws_vpc.this.id
  availability_zone       = var.azs[count.index]
  cidr_block              = cidrsubnet(var.vpc_cidr, 4, count.index)
  map_public_ip_on_launch = true

  tags = {
    Name                     = "${var.name}-public-${var.azs[count.index]}"
    # Tag that tells AWS Load Balancer Controller this subnet can host public ALBs.
    "kubernetes.io/role/elb" = "1"
  }
}

resource "aws_subnet" "private" {
  count             = length(var.azs)
  vpc_id            = aws_vpc.this.id
  availability_zone = var.azs[count.index]
  cidr_block        = cidrsubnet(var.vpc_cidr, 4, count.index + 3)

  tags = {
    Name                              = "${var.name}-private-${var.azs[count.index]}"
    # Tag that tells AWS Load Balancer Controller this subnet can host internal ALBs
    # and that EKS can place worker nodes here.
    "kubernetes.io/role/internal-elb" = "1"
  }
}

resource "aws_subnet" "database" {
  count             = length(var.azs)
  vpc_id            = aws_vpc.this.id
  availability_zone = var.azs[count.index]
  cidr_block        = cidrsubnet(var.vpc_cidr, 4, count.index + 6)

  tags = { Name = "${var.name}-db-${var.azs[count.index]}" }
}

# ----------------------------------------------------------------------------
# NAT Gateways — two of them, one in each of the first two public subnets.
# Lets pods in private subnets reach the internet (ECR, external APIs, etc.).
# Two NATs means an AZ outage doesn't kill outbound for the whole cluster.
# ----------------------------------------------------------------------------
resource "aws_eip" "nat" {
  count  = 2
  domain = "vpc"
  tags   = { Name = "${var.name}-nat-eip-${count.index}" }
}

resource "aws_nat_gateway" "this" {
  count         = 2
  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.public[count.index].id
  tags          = { Name = "${var.name}-nat-${var.azs[count.index]}" }

  depends_on = [aws_internet_gateway.this]
}

# ----------------------------------------------------------------------------
# Route tables
# ----------------------------------------------------------------------------
# Public route table — sends 0.0.0.0/0 through the IGW
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }
  tags = { Name = "${var.name}-rt-public" }
}

resource "aws_route_table_association" "public" {
  count          = length(var.azs)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# Private route tables — one per AZ, each pointing to a NAT gateway.
# AZ-a → NAT-a, AZ-b → NAT-b, AZ-c → NAT-a (fallback, since we only have 2 NATs).
resource "aws_route_table" "private" {
  count  = length(var.azs)
  vpc_id = aws_vpc.this.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.this[count.index < 2 ? count.index : 0].id
  }

  tags = { Name = "${var.name}-rt-private-${var.azs[count.index]}" }
}

resource "aws_route_table_association" "private" {
  count          = length(var.azs)
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private[count.index].id
}

# Database route table — no internet route at all. Locked down.
resource "aws_route_table" "database" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = "${var.name}-rt-database" }
}

resource "aws_route_table_association" "database" {
  count          = length(var.azs)
  subnet_id      = aws_subnet.database[count.index].id
  route_table_id = aws_route_table.database.id
}
