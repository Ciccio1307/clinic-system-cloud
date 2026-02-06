# Clinica System - Cloud Native Healthcare Platform

## 📖 Descrizione
Clinica System è una piattaforma per la gestione di prenotazioni mediche e referti digitali, progettata con un'architettura **Cloud-Native** su AWS. Il sistema garantisce scalabilità, sicurezza e alta disponibilità grazie all'orchestrazione containerizzata.

## 🏗️ Architettura
Il progetto adotta un approccio **Ibrido** per il deployment:
- **Infrastructure as Code (IaC):** Provisioning gestito tramite **Terraform**.
- **CI/CD Pipeline:** Automazione del rilascio tramite **GitHub Actions**.

### Stack Tecnologico
* **Frontend:** React.js (Containerizzato)
* **Backend:** Python FastAPI (Containerizzato con Boto3)
* **Database:** Amazon DynamoDB (Single Table Design)
* **Storage:** Amazon S3 (Referti PDF)
* **Compute:** Amazon ECS su Fargate (Serverless Containers)
* **Networking:** Application Load Balancer (ALB)
* **Sicurezza:** IAM Roles, Security Groups, JWT Authentication

## 🚀 Guida all'Installazione (Locale)

### Prerequisiti
* Terraform >= 1.0
* Docker Desktop
* AWS CLI configurata

### 1. Provisioning Infrastruttura
```bash
cd terraform
terraform init
terraform apply -auto-approve


### 2. Build & Deploy
git push origin main