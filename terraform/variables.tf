variable "aws_region" {
  description = "Regione AWS (es. us-east-2)"
  type        = string
  default     = "us-east-2"
}

variable "bucket_name" {
  description = "Nome univoco del bucket S3"
  type        = string
  default     = "clinica-referti-fvirzi-tf-final"
}

variable "notification_email" {
  description = "Email per notifiche SNS"
  type        = string
  default     = "francesco.virzi@studium.unict.it"
}