output "load_balancer_dns" {
  value       = aws_lb.clinica_lb.dns_name
  description = "Indirizzo del Load Balancer (Sito Web)"
}

output "ecr_backend_url" {
  value       = aws_ecr_repository.backend_repo.repository_url
  description = "ECR Repository URL Backend"
}

output "ecr_frontend_url" {
  value       = aws_ecr_repository.frontend_repo.repository_url
  description = "ECR Repository URL Frontend"
}