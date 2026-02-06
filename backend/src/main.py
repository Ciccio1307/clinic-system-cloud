from fastapi import FastAPI, File, UploadFile, HTTPException, Depends, Header, Query, Body, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, EmailStr
from typing import List, Optional
from datetime import datetime
from enum import Enum
import uuid
import os
import io

# AWS SDK
import boto3
from botocore.exceptions import ClientError
from boto3.dynamodb.conditions import Key, Attr
from passlib.context import CryptContext

app = FastAPI(title="Clinica API - Enterprise Edition", version="4.7.0")

# --- CONFIGURAZIONE AWS ---
AWS_REGION = os.getenv("AWS_REGION", "us-east-2")
S3_BUCKET_NAME = os.getenv("S3_BUCKET_NAME")
# 👇 ARN DEL TUO TOPIC (NON TOCCARE)
SNS_TOPIC_ARN = "arn:aws:sns:us-east-2:763835214385:Clinica-Notifiche-Topic"

# 1. Client S3
s3_client = boto3.client('s3', region_name=AWS_REGION)

# 2. Risorsa DynamoDB
dynamodb = boto3.resource('dynamodb', region_name=AWS_REGION)
table_name = os.getenv("DYNAMODB_TABLE", "ClinicaDB")
table = dynamodb.Table(table_name)

# 3. Client SNS
sns_client = boto3.client('sns', region_name=AWS_REGION)

# Sicurezza Password
pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")

# --- CORS ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================
# MODELS
# ============================================
class UserRole(str, Enum):
    PATIENT = "patient"
    DOCTOR = "doctor"

class AppointmentStatus(str, Enum):
    PENDING = "pending"
    CONFIRMED = "confirmed"
    REJECTED = "rejected"
    COMPLETED = "completed"
    CANCELLED = "cancelled"

class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    role: UserRole
    name: str
    surname: str
    phone: str
    specialization: Optional[str] = None

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

# --- MODELLO PER CAMBIO PASSWORD ---
class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str

# --- MODELLO PER UPDATE NOTE REFERTO (NUOVO) ---
class ReportUpdate(BaseModel):
    notes: str

# --- 🔒 MODELLI SICURI (NO PASSWORD) ---
class UserResponse(BaseModel):
    user_id: str
    email: EmailStr
    role: UserRole
    name: str
    surname: str
    phone: str
    specialization: Optional[str] = None

class LoginResponse(BaseModel):
    token: str
    user: UserResponse

class AppointmentRequest(BaseModel):
    doctor_id: str
    date: str
    time_slot: str
    reason: str

class AvailabilityRequest(BaseModel):
    date: str
    time_slots: List[str]
    is_available: bool

# ============================================
# AUTHENTICATION HELPERS
# ============================================
def get_current_user(authorization: str = Header(None)):
    if not authorization:
        raise HTTPException(status_code=401, detail="Non autenticato")
    user_id = authorization.replace("Bearer ", "")
    try:
        response = table.get_item(Key={'PK': f"USER#{user_id}", 'SK': 'PROFILE'})
        user = response.get('Item')
        if not user:
            raise HTTPException(status_code=401, detail="Utente non trovato")
        return user
    except ClientError:
        raise HTTPException(status_code=500, detail="Errore Database")

# ============================================
# ENDPOINTS
# ============================================

@app.post("/api/auth/register")
async def register(data: RegisterRequest):
    # Nota: In produzione usare Query su GSI 'EmailIndex' invece di Scan
    scan = table.scan(FilterExpression=Attr('email').eq(data.email) & Attr('SK').eq('PROFILE'))
    if scan['Count'] > 0:
        raise HTTPException(status_code=400, detail="Email già registrata")
    
    user_id = str(uuid.uuid4())
    hashed_password = pwd_context.hash(data.password)
    
    item = {
        'PK': f"USER#{user_id}", 'SK': 'PROFILE',
        'user_id': user_id, 'email': data.email, 'password_hash': hashed_password,
        'role': data.role, 'name': data.name, 'surname': data.surname,
        'phone': data.phone, 'specialization': data.specialization if data.role == UserRole.DOCTOR else None,
        'created_at': datetime.now().isoformat()
    }
    table.put_item(Item=item)
    return {"user_id": user_id, "message": "Registrazione completata"}

@app.post("/api/auth/login", response_model=LoginResponse) # 🔒 Filtra via la password
async def login(data: LoginRequest):
    scan = table.scan(FilterExpression=Attr('email').eq(data.email) & Attr('SK').eq('PROFILE'))
    if scan['Count'] == 0:
        raise HTTPException(status_code=401, detail="Credenziali non valide")
    user = scan['Items'][0]
    if not pwd_context.verify(data.password, user['password_hash']):
        raise HTTPException(status_code=401, detail="Credenziali non valide")
    
    return {
        "token": f"Bearer {user['user_id']}",
        "user": user # Pydantic pulirà questo oggetto rimuovendo password_hash
    }

@app.get("/api/users/me", response_model=UserResponse)
async def get_my_profile(current_user: dict = Depends(get_current_user)):
    return current_user

# --- ENDPOINT: CAMBIO PASSWORD ---
@app.post("/api/users/change-password")
async def change_password(data: ChangePasswordRequest, current_user: dict = Depends(get_current_user)):
    # 1. Recupera l'utente dal DB per avere l'hash aggiornato e sicuro
    response = table.get_item(Key={'PK': f"USER#{current_user['user_id']}", 'SK': 'PROFILE'})
    user_record = response.get('Item')

    if not user_record:
        raise HTTPException(status_code=404, detail="Utente non trovato")

    # 2. Verifica che la VECCHIA password sia corretta
    if not pwd_context.verify(data.old_password, user_record['password_hash']):
        raise HTTPException(status_code=400, detail="La vecchia password non è corretta")

    # 3. Hasha la NUOVA password
    new_hashed_password = pwd_context.hash(data.new_password)

    # 4. Aggiorna nel Database
    table.update_item(
        Key={'PK': f"USER#{current_user['user_id']}", 'SK': 'PROFILE'},
        UpdateExpression="set #p = :p",
        ExpressionAttributeNames={'#p': 'password_hash'},
        ExpressionAttributeValues={':p': new_hashed_password}
    )

    return {"message": "Password aggiornata con successo"}

@app.get("/api/doctors")
async def get_doctors(specialization: Optional[str] = None):
    filter_exp = Attr('role').eq(UserRole.DOCTOR) & Attr('SK').eq('PROFILE')
    if specialization:
        filter_exp = filter_exp & Attr('specialization').eq(specialization)
    response = table.scan(FilterExpression=filter_exp)
    # Rimuoviamo password_hash manualmente dalla lista per sicurezza extra
    doctors = []
    for doc in response['Items']:
        doc.pop('password_hash', None)
        doctors.append(doc)
    return doctors

@app.get("/api/doctors/{doctor_id}/availability")
async def get_doctor_availability(doctor_id: str, date: str):
    pk_avail = f"AVAIL#{doctor_id}#{date}"
    response = table.get_item(Key={'PK': pk_avail, 'SK': 'SLOTS'})
    avail_item = response.get('Item')
    slots = avail_item.get('time_slots', []) if avail_item else [f"{h:02d}:{m}" for h in range(9, 18) for m in ["00", "30"]]
    
    scan_appt = table.scan(FilterExpression=Attr('doctor_id').eq(doctor_id) & Attr('date').eq(date) & Attr('SK').eq('APPT'))
    booked_slots = [a['time_slot'] for a in scan_appt['Items'] if a['status'] in ['confirmed', 'pending']]
    
    return {'doctor_id': doctor_id, 'date': date, 'available_slots': [s for s in slots if s not in booked_slots]}

@app.post("/api/doctors/availability")
async def set_availability(data: AvailabilityRequest, current_user: dict = Depends(get_current_user)):
    if current_user['role'] != UserRole.DOCTOR:
        raise HTTPException(status_code=403, detail="Non autorizzato")
    item = {'PK': f"AVAIL#{current_user['user_id']}#{data.date}", 'SK': 'SLOTS', 'doctor_id': current_user['user_id'], 'date': data.date, 'time_slots': data.time_slots, 'is_available': data.is_available}
    table.put_item(Item=item)
    return {"message": "Disponibilità salvata"}

@app.post("/api/appointments")
async def create_appointment(data: AppointmentRequest, current_user: dict = Depends(get_current_user)):
    if current_user['role'] != UserRole.PATIENT:
        raise HTTPException(status_code=403, detail="Solo pazienti")
    
    # 1. Verifica slot (ignorando i cancellati)
    scan = table.scan(FilterExpression=Attr('doctor_id').eq(data.doctor_id) & Attr('date').eq(data.date) & Attr('time_slot').eq(data.time_slot) & Attr('SK').eq('APPT'))
    active_appts = [a for a in scan['Items'] if a.get('status') != AppointmentStatus.CANCELLED]
    
    if len(active_appts) > 0:
        raise HTTPException(status_code=400, detail="Slot occupato")

    # 🚀 PERFORMANCE FIX: Denormalizzazione
    doc_res = table.get_item(Key={'PK': f"USER#{data.doctor_id}", 'SK': 'PROFILE'})
    doctor_data = doc_res.get('Item', {})
    
    doctor_name = f"Dr. {doctor_data.get('name', 'N/A')} {doctor_data.get('surname', 'N/A')}"
    doctor_spec = doctor_data.get('specialization', 'Generico')

    appt_id = str(uuid.uuid4())
    item = {
        'PK': f"APPT#{appt_id}", 'SK': 'APPT',
        'appointment_id': appt_id, 
        'patient_id': current_user['user_id'], 
        'patient_name': f"{current_user['name']} {current_user['surname']}", # Utile per il dottore
        'doctor_id': data.doctor_id,
        'doctor_name': doctor_name, # Utile per il paziente
        'doctor_specialization': doctor_spec,
        'date': data.date, 
        'time_slot': data.time_slot, 
        'status': AppointmentStatus.PENDING,
        'reason': data.reason, 
        'created_at': datetime.now().isoformat()
    }
    table.put_item(Item=item)
    return item

@app.get("/api/appointments/my")
async def get_my_appointments(current_user: dict = Depends(get_current_user)):
    user_id = current_user['user_id']
    role = current_user['role']
    filter_exp = Attr('patient_id').eq(user_id) if role == UserRole.PATIENT else Attr('doctor_id').eq(user_id)
    
    # Escludiamo i cancellati dalla vista principale
    filter_exp = filter_exp & Attr('status').ne(AppointmentStatus.CANCELLED)
    
    response = table.scan(FilterExpression=filter_exp & Attr('SK').eq('APPT'))
    return response['Items']

# --- CANCELLAZIONE (Soft Delete) ---
@app.delete("/api/appointments/{appointment_id}")
async def delete_appointment(appointment_id: str, current_user: dict = Depends(get_current_user)):
    # 1. Recupera l'appuntamento
    res = table.get_item(Key={'PK': f"APPT#{appointment_id}", 'SK': 'APPT'})
    appt = res.get('Item')
    
    if not appt:
        raise HTTPException(status_code=404, detail="Appuntamento non trovato")

    # 2. Controllo PROPRIETÀ
    is_patient = current_user['role'] == UserRole.PATIENT and appt['patient_id'] == current_user['user_id']
    is_doctor = current_user['role'] == UserRole.DOCTOR and appt['doctor_id'] == current_user['user_id']

    if not (is_patient or is_doctor):
        raise HTTPException(status_code=403, detail="Non autorizzato a cancellare questo appuntamento")

    # 3. Imposta stato a CANCELLED
    table.update_item(
        Key={'PK': f"APPT#{appointment_id}", 'SK': 'APPT'},
        UpdateExpression="set #s = :s",
        ExpressionAttributeNames={'#s': 'status'},
        ExpressionAttributeValues={':s': AppointmentStatus.CANCELLED},
    )
    return {"message": "Appuntamento cancellato"}

# 🔥 FIX UNIVERSALE PER AGENDA (Accetta POST/PUT/PATCH per aggiornamento stato) 🔥
@app.api_route("/api/appointments/{appointment_id}/status", methods=["POST", "PUT", "PATCH"])
async def universal_status_update(
    appointment_id: str,
    request: Request,
    status_query: Optional[str] = Query(None, alias="status"),
    status_body: Optional[dict] = Body(None),
    current_user: dict = Depends(get_current_user)
):
    if current_user['role'] != UserRole.DOCTOR:
        raise HTTPException(status_code=403, detail="Solo i dottori possono gestire appuntamenti")

    # 1. Cerca lo stato ovunque (Query params o Body JSON)
    final_status = status_query
    if not final_status and status_body and 'status' in status_body:
        final_status = status_body['status']
    
    if not final_status:
         raise HTTPException(status_code=422, detail="Parametro 'status' mancante")

    # 2. Aggiorna
    try:
        table.update_item(
            Key={'PK': f"APPT#{appointment_id}", 'SK': 'APPT'},
            UpdateExpression="set #s = :s",
            ExpressionAttributeNames={'#s': 'status'},
            ExpressionAttributeValues={':s': final_status},
            ReturnValues="UPDATED_NEW"
        )
    except Exception as e:
        print(f"ERRORE DB: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    return {"message": "Stato aggiornato", "status": final_status}

# --- UPLOAD REFERTO INTELLIGENTE (Gestisce Duplicati e Update) ---
@app.post("/api/reports/upload")
async def upload_report(
    file: UploadFile, appointment_id: str, exam_type: str, exam_date: str,
    notes: Optional[str] = None, current_user: dict = Depends(get_current_user)
):
    if current_user['role'] != UserRole.DOCTOR:
        raise HTTPException(status_code=403, detail="Non autorizzato")

    # 1. Recupera l'appuntamento
    res = table.get_item(Key={'PK': f"APPT#{appointment_id}", 'SK': 'APPT'})
    appointment = res.get('Item')
    if not appointment:
        raise HTTPException(status_code=404, detail="Appuntamento non trovato")

    # 2. CONTROLLO ESISTENZA: Cerca se c'è già un referto
    existing_report_scan = table.scan(
        FilterExpression=Attr('appointment_id').eq(appointment_id) & Attr('SK').eq('METADATA')
    )
    existing_reports = existing_report_scan.get('Items', [])
    
    is_update = False
    
    if len(existing_reports) > 0:
        # --- MODALITÀ AGGIORNAMENTO ---
        # Riutilizza ID e chiave S3 per sovrascrivere
        old_report = existing_reports[0]
        report_id = old_report['report_id']
        s3_key = old_report['s3_key'] 
        is_update = True
        print(f"Aggiornamento referto esistente: {report_id}")
    else:
        # --- MODALITÀ CREAZIONE ---
        # Nuovo ID e nuova chiave S3
        report_id = str(uuid.uuid4())
        s3_key = f"reports/{appointment['patient_id']}/{report_id}_{file.filename}"
        is_update = False

    # 3. Carica su S3 (Sovrascrive se esiste già)
    try:
        await file.seek(0)
        s3_client.upload_fileobj(file.file, S3_BUCKET_NAME, s3_key, ExtraArgs={'ContentType': file.content_type})
    except Exception as e:
        raise HTTPException(status_code=500, detail="Errore S3")

    # 4. Aggiorna DynamoDB
    item = {
        'PK': f"REPORT#{report_id}", 'SK': 'METADATA',
        'report_id': report_id, 
        'appointment_id': appointment_id,
        'patient_id': appointment['patient_id'], 
        'doctor_id': current_user['user_id'],
        'exam_type': exam_type, 
        'exam_date': exam_date, 
        's3_key': s3_key,
        'original_filename': file.filename, 
        'notes': notes, 
        'upload_date': datetime.now().isoformat(),
        'last_updated': datetime.now().isoformat()
    }
    table.put_item(Item=item)

    # 5. Notifica SNS (Solo se è NUOVO per evitare spam)
    if not is_update:
        try:
            pat_res = table.get_item(Key={'PK': f"USER#{appointment['patient_id']}", 'SK': 'PROFILE'})
            if 'Item' in pat_res:
                patient_email = pat_res['Item']['email']
                message = (f"Nuovo referto disponibile per {exam_type}.")
                sns_client.publish(
                    TopicArn=SNS_TOPIC_ARN,
                    Message=message,
                    Subject="Nuovo Referto Disponibile",
                    MessageAttributes={'email': {'DataType': 'String', 'StringValue': patient_email}}
                )
        except Exception as e:
            print(f"Errore notifica: {e}")

    return {"message": "Referto aggiornato" if is_update else "Referto caricato"}

# --- ENDPOINT PATCH: MODIFICA SOLO NOTE (NUOVO) ---
@app.patch("/api/reports/{report_id}")
async def update_report_notes(
    report_id: str, 
    update_data: ReportUpdate, 
    current_user: dict = Depends(get_current_user)
):
    # 1. Controllo Ruolo
    if current_user['role'] != UserRole.DOCTOR:
        raise HTTPException(status_code=403, detail="Non autorizzato")

    # 2. Recupera il report per verificare la proprietà
    response = table.get_item(Key={'PK': f"REPORT#{report_id}", 'SK': 'METADATA'})
    report = response.get('Item')

    if not report:
        raise HTTPException(status_code=404, detail="Referto non trovato")

    # 3. Verifica che sia il medico che lo ha creato
    if report['doctor_id'] != current_user['user_id']:
        raise HTTPException(status_code=403, detail="Non puoi modificare referti altrui")

    # 4. Aggiorna solo il campo note e il timestamp
    try:
        table.update_item(
            Key={'PK': f"REPORT#{report_id}", 'SK': 'METADATA'},
            UpdateExpression="set #n = :n, #u = :u",
            ExpressionAttributeNames={'#n': 'notes', '#u': 'last_updated'},
            ExpressionAttributeValues={
                ':n': update_data.notes,
                ':u': datetime.now().isoformat()
            },
            ReturnValues="UPDATED_NEW"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return {"message": "Note aggiornate con successo", "notes": update_data.notes}

@app.get("/api/reports/my")
async def get_my_reports(current_user: dict = Depends(get_current_user)):
    user_id = current_user['user_id']
    if current_user['role'] == UserRole.PATIENT:
        res = table.scan(FilterExpression=Attr('patient_id').eq(user_id) & Attr('SK').eq('METADATA'))
    else:
        res = table.scan(FilterExpression=Attr('doctor_id').eq(user_id) & Attr('SK').eq('METADATA'))
    
    reports = res['Items']
    # Arricchiamo con i nomi dei dottori (qui lo scan è leggero)
    for r in reports:
        doc_res = table.get_item(Key={'PK': f"USER#{r['doctor_id']}", 'SK': 'PROFILE'})
        if 'Item' in doc_res:
             r['doctor_name'] = f"Dr. {doc_res['Item'].get('surname')}"
    return reports

@app.get("/api/reports/{report_id}/download")
async def download_report(report_id: str, current_user: dict = Depends(get_current_user)):
    res = table.get_item(Key={'PK': f"REPORT#{report_id}", 'SK': 'METADATA'})
    report = res.get('Item')
    if not report:
        raise HTTPException(status_code=404, detail="Referto non trovato")
    try:
        file_stream = io.BytesIO()
        s3_client.download_fileobj(S3_BUCKET_NAME, report['s3_key'], file_stream)
        file_stream.seek(0)
        return StreamingResponse(file_stream, media_type="application/pdf", headers={"Content-Disposition": f"attachment; filename={report['original_filename']}"})
    except Exception:
        raise HTTPException(status_code=500, detail="Errore Download")

@app.get("/health")
async def health():
    return {"status": "ok", "cloud": "active", "version": "4.7.0"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)