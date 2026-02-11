terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 4.16"
    }
  }
  required_version = ">= 1.2.0"
}

variable "alert_email" {
  type        = string
  description = "L'indirizzo email per ricevere le notifiche dai referti"
}

provider "aws" {
  region = "us-east-2"
}

# --- LOCALS (Costanti utili) ---
locals {
  project_name = "clinica-san-marco"
  common_tags = {
    Project     = "Clinica San Marco"
    Environment = "Production"
    ManagedBy   = "Terraform"
  }
}

# --- 1. STORAGE (S3) ---
resource "aws_s3_bucket" "clinica_bucket" {
  bucket        = "clinica-referti-fvirzi-tf-final"
  force_destroy = true
  
  tags = merge(local.common_tags, {
    Name = "Bucket Referti Clinica"
  })
}

# Blocca accesso pubblico al bucket (Best Practice di sicurezza)
resource "aws_s3_bucket_public_access_block" "clinica_bucket_access" {
  bucket = aws_s3_bucket.clinica_bucket.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
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

  tags = merge(local.common_tags, {
    Name = "Database Clinica"
  })
}

# --- 3. NOTIFICHE (SNS) ---
resource "aws_sns_topic" "notifiche_referti" {
  name = "Clinica-Notifiche-Topic"
  tags = local.common_tags
}



resource "aws_sns_topic_subscription" "email_sub" {
  topic_arn = aws_sns_topic.notifiche_referti.arn
  protocol  = "email"
  endpoint  = var.alert_email  # <--- Usiamo la variabile qui
}

# --- 4. CONTAINER REGISTRY (ECR) ---
resource "aws_ecr_repository" "backend_repo" {
  name                 = "clinica-backend"
  image_tag_mutability = "MUTABLE"
  force_delete         = true
  tags                 = local.common_tags
}

resource "aws_ecr_repository" "frontend_repo" {
  name                 = "clinica-frontend"
  image_tag_mutability = "MUTABLE"
  force_delete         = true
  tags                 = local.common_tags
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

# Security Group per il LOAD BALANCER (Porta 80)
resource "aws_security_group" "lb_sg" {
  name        = "clinica-lb-sg"
  description = "Allow HTTP traffic to Load Balancer"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "HTTP from Internet"
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
  
  tags = local.common_tags
}

# Security Group per ECS (Apre 8000 Backend e 3000 Frontend)
resource "aws_security_group" "ecs_sg" {
  name        = "clinica-ecs-sg"
  description = "Allow traffic to Containers"
  vpc_id      = data.aws_vpc.default.id

  # Backend Port
  ingress {
    from_port       = 8000
    to_port         = 8000
    protocol        = "tcp"
    security_groups = [aws_security_group.lb_sg.id] # Consenti solo dal Load Balancer
    # Alternativa per debug rapido (meno sicuro): cidr_blocks = ["0.0.0.0/0"]
  }
  
  # Frontend Port
  ingress {
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.lb_sg.id] # Consenti solo dal Load Balancer
    # Alternativa per debug rapido (meno sicuro): cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  
  tags = local.common_tags
}

# --- 6. LOAD BALANCER (ROUTING AVANZATO) ---

resource "aws_lb" "clinica_lb" {
  name               = "clinica-lb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.lb_sg.id]
  subnets            = data.aws_subnets.default.ids
  tags               = local.common_tags
}

# Target Group Backend (8000)
resource "aws_lb_target_group" "clinica_backend_tg" {
  name        = "clinica-backend-tg"
  port        = 8000
  protocol    = "HTTP"
  vpc_id      = data.aws_vpc.default.id
  target_type = "ip"
  
  health_check {
    path                = "/health"
    matcher             = "200"
    interval            = 60
    timeout             = 30
    healthy_threshold   = 2
    unhealthy_threshold = 5
  }
}

# Target Group Frontend (3000)
resource "aws_lb_target_group" "clinica_frontend_tg" {
  name        = "clinica-frontend-tg"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = data.aws_vpc.default.id
  target_type = "ip"
  
  health_check {
    path                = "/"
    matcher             = "200"
    interval            = 60
    timeout             = 30
    healthy_threshold   = 2
    unhealthy_threshold = 5
  }
}

# Listener Principale (Smistamento Traffico)
resource "aws_lb_listener" "front_end" {
  load_balancer_arn = aws_lb.clinica_lb.arn
  port              = "80"
  protocol          = "HTTP"

  # AZIONE DI DEFAULT: Manda tutto al Frontend (Sito React)
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.clinica_frontend_tg.arn
  }
}

# Regola per mandare /docs e /api al Backend
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

# --- 7. ECS (CLUSTER & ROLE) ---
resource "aws_ecs_cluster" "clinica_cluster" {
  name = "clinica-cluster"
  tags = local.common_tags
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

# --- 8. DEFINIZIONE DEI TASK E SERVIZI ---

# BACKEND TASK
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
    portMappings = [{
      containerPort = 8000
      hostPort      = 8000
    }]
    environment = [
      { name = "S3_BUCKET_NAME", value = aws_s3_bucket.clinica_bucket.id },
      { name = "DYNAMODB_TABLE", value = aws_dynamodb_table.clinica_db.name },
      { name = "AWS_REGION", value = "us-east-2" }
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = "/ecs/clinica-backend"
        "awslogs-region"        = "us-east-2"
        "awslogs-stream-prefix" = "ecs"
        "awslogs-create-group"  = "true"
      }
    }
  }])
}

# BACKEND SERVICE
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

# FRONTEND TASK
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
    portMappings = [{
      containerPort = 3000
      hostPort      = 3000
    }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = "/ecs/clinica-frontend"
        "awslogs-region"        = "us-east-2"
        "awslogs-stream-prefix" = "ecs"
        "awslogs-create-group"  = "true"
      }
    }
  }])
}

# FRONTEND SERVICE
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

# --- OUTPUT OTTIMIZZATI ---

# 1. URL Completo del Load Balancer (Pronto per REACT_APP_API_URL e GitHub Secrets)
output "REACT_APP_API_URL" {
  value       = "http://${aws_lb.clinica_lb.dns_name}"
  description = "Copia questo valore e incollalo nei GitHub Secrets come REACT_APP_API_URL"
}

# 2. URL Repository Backend (Per GitHub Actions)
output "ECR_BACKEND_URI" {
  value       = aws_ecr_repository.backend_repo.repository_url
  description = "URI del repository ECR per il Backend"
}

# 3. URL Repository Frontend (Per GitHub Actions)
output "ECR_FRONTEND_URI" {
  value       = aws_ecr_repository.frontend_repo.repository_url
  description = "URI del repository ECR per il Frontend"
}