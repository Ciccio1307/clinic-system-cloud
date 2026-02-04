terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 4.16"
    }
  }
  required_version = ">= 1.2.0"
}

# 🔥 MAGIA: Non servono access_key e secret_key qui.
# Terraform userà automaticamente quelle che hai messo nei GitHub Secrets!
provider "aws" {
  region = var.aws_region
}

# --- 1. STORAGE (S3) ---
resource "aws_s3_bucket" "clinica_bucket" {
  bucket        = var.bucket_name
  force_destroy = true
  tags = {
    Name = "Bucket Referti Clinica"
  }
}

# --- 2. DATABASE (DynamoDB) ---
resource "aws_dynamodb_table" "clinica_db" {
  name           = "ClinicaDB"
  billing_mode   = "PROVISIONED"
  read_capacity  = 5
  write_capacity = 5
  hash_key       = "PK"
  range_key      = "SK"

  attribute {
    name = "PK"
    type = "S"
  }

  attribute {
    name = "SK"
    type = "S"
  }

  tags = {
    Name = "Database Clinica"
  }
}

# --- 3. NOTIFICHE (SNS) ---
resource "aws_sns_topic" "notifiche_referti" {
  name = "Clinica-Notifiche-Topic"
}

resource "aws_sns_topic_subscription" "email_sub" {
  topic_arn = aws_sns_topic.notifiche_referti.arn
  protocol  = "email"
  endpoint  = var.notification_email
}

# --- 4. CONTAINER REGISTRY (ECR) ---
resource "aws_ecr_repository" "backend_repo" {
  name                 = "clinica-backend"
  image_tag_mutability = "MUTABLE"
  force_delete         = true
}

resource "aws_ecr_repository" "frontend_repo" {
  name                 = "clinica-frontend"
  image_tag_mutability = "MUTABLE"
  force_delete         = true
}

# --- 5. NETWORK & SICUREZZA ---
data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

resource "aws_security_group" "lb_sg" {
  name        = "clinica-lb-sg"
  description = "Allow HTTP traffic to Load Balancer"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "ecs_sg" {
  name        = "clinica-ecs-sg"
  description = "Allow traffic to Containers"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    from_port   = 8000
    to_port     = 8000
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    from_port   = 3000
    to_port     = 3000
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# --- 6. LOAD BALANCER ---
resource "aws_lb" "clinica_lb" {
  name               = "clinica-lb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.lb_sg.id]
  subnets            = data.aws_subnets.default.ids
}

resource "aws_lb_target_group" "clinica_backend_tg" {
  name        = "clinica-backend-tg"
  port        = 8000
  protocol    = "HTTP"
  vpc_id      = data.aws_vpc.default.id
  target_type = "ip"
  health_check {
    path    = "/health"
    matcher = "200"
  }
}

resource "aws_lb_target_group" "clinica_frontend_tg" {
  name        = "clinica-frontend-tg"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = data.aws_vpc.default.id
  target_type = "ip"
  health_check {
    path    = "/"
    matcher = "200"
  }
}

resource "aws_lb_listener" "front_end" {
  load_balancer_arn = aws_lb.clinica_lb.arn
  port              = "80"
  protocol          = "HTTP"
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.clinica_frontend_tg.arn
  }
}

resource "aws_lb_listener_rule" "api_rule" {
  listener_arn = aws_lb_listener.front_end.arn
  priority     = 100
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.clinica_backend_tg.arn
  }
  condition {
    path_pattern {
      values = ["/docs", "/openapi.json", "/api/*"]
    }
  }
}

# --- 7. ECS ---
resource "aws_ecs_cluster" "clinica_cluster" {
  name = "clinica-cluster"
}

resource "aws_iam_role" "ecs_task_execution_role" {
  name = "clinica_ecs_task_execution_role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_admin_access" {
  role       = aws_iam_role.ecs_task_execution_role.name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
}

# --- 8. TASK DEFINITIONS ---
resource "aws_ecs_task_definition" "backend_task" {
  family                   = "clinica-backend-task"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.ecs_task_execution_role.arn
  task_role_arn            = aws_iam_role.ecs_task_execution_role.arn

  container_definitions = jsonencode([{
    name      = "clinica-backend-container"
    image     = "${aws_ecr_repository.backend_repo.repository_url}:latest"
    essential = true
    portMappings = [{ containerPort = 8000, hostPort = 8000 }]
    environment = [
      { name = "S3_BUCKET_NAME", value = aws_s3_bucket.clinica_bucket.id },
      { name = "DYNAMODB_TABLE", value = aws_dynamodb_table.clinica_db.name },
      { name = "AWS_REGION", value = var.aws_region }
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = "/ecs/clinica-backend"
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "ecs"
        "awslogs-create-group"  = "true"
      }
    }
  }])
}

resource "aws_ecs_service" "backend_service" {
  name            = "clinica-backend-service"
  cluster         = aws_ecs_cluster.clinica_cluster.id
  task_definition = aws_ecs_task_definition.backend_task.arn
  launch_type     = "FARGATE"
  desired_count   = 1
  network_configuration {
    subnets          = data.aws_subnets.default.ids
    security_groups  = [aws_security_group.ecs_sg.id]
    assign_public_ip = true
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.clinica_backend_tg.arn
    container_name   = "clinica-backend-container"
    container_port   = 8000
  }
}

resource "aws_ecs_task_definition" "frontend_task" {
  family                   = "clinica-frontend-task"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.ecs_task_execution_role.arn
  task_role_arn            = aws_iam_role.ecs_task_execution_role.arn

  container_definitions = jsonencode([{
    name      = "clinica-frontend-container"
    image     = "${aws_ecr_repository.frontend_repo.repository_url}:latest"
    essential = true
    portMappings = [{ containerPort = 3000, hostPort = 3000 }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = "/ecs/clinica-frontend"
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "ecs"
        "awslogs-create-group"  = "true"
      }
    }
  }])
}

resource "aws_ecs_service" "frontend_service" {
  name            = "clinica-frontend-service"
  cluster         = aws_ecs_cluster.clinica_cluster.id
  task_definition = aws_ecs_task_definition.frontend_task.arn
  launch_type     = "FARGATE"
  desired_count   = 1
  network_configuration {
    subnets          = data.aws_subnets.default.ids
    security_groups  = [aws_security_group.ecs_sg.id]
    assign_public_ip = true
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.clinica_frontend_tg.arn
    container_name   = "clinica-frontend-container"
    container_port   = 3000
  }
}