import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { BarChart, Bar, Tooltip, ResponsiveContainer } from 'recharts';
import { Search, Filter, User, Calendar, CheckCircle, Clock, XCircle, FileText, LogOut, Upload, Activity, ArrowLeft, Settings, Lock } from 'lucide-react';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import './App.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

// --- LISTA SPECIALIZZAZIONI (Unica fonte di verità) ---
const SPECIALIZATIONS = [
    "Cardiologia", "Dermatologia", "Ortopedia", "Pediatria", "Oculistica",
    "Ginecologia", "Neurologia", "Psichiatria", "Urologia",
    "Otorinolaringoiatria", "Gastroenterologia", "Endocrinologia", "Medicina Generale"
];

const getErrorMessage = (error) => {
    if (!error.response) return 'Errore di rete o server non raggiungibile';
    return error.response.data?.detail || 'Errore imprevisto';
};

function App() {
    const [token, setToken] = useState(localStorage.getItem('token'));
    const [user, setUser] = useState(JSON.parse(localStorage.getItem('user') || 'null'));
    const [showLogin, setShowLogin] = useState(false);

    useEffect(() => {
        if (token) {
            axios.defaults.headers.common['Authorization'] = token;
            axios.get(`${API_URL}/api/users/me`)
                .then(res => { setUser(res.data); localStorage.setItem('user', JSON.stringify(res.data)); })
                .catch(() => logout());
        }
    }, [token]);

    const login = (newToken, newUser) => {
        setToken(newToken);
        setUser(newUser);
        localStorage.setItem('token', newToken);
        localStorage.setItem('user', JSON.stringify(newUser));
        axios.defaults.headers.common['Authorization'] = newToken;
        setShowLogin(false);
    };

    const logout = () => {
        setToken(null); setUser(null);
        localStorage.removeItem('token'); localStorage.removeItem('user');
        delete axios.defaults.headers.common['Authorization'];
        setShowLogin(false);
    };

    if (token && user) {
        return (
            <>
                <ToastContainer position="top-right" autoClose={3000} />
                {user.role === 'patient'
                    ? <PatientDashboard user={user} onLogout={logout} />
                    : <DoctorDashboardAdvanced user={user} onLogout={logout} />
                }
            </>
        );
    }

    if (showLogin) return <><ToastContainer /><LoginPage onLogin={login} onBack={() => setShowLogin(false)} /></>;

    return <><ToastContainer /><HomePage onEnter={() => setShowLogin(true)} /></>;
}

// ============================================
// 0. HOMEPAGE (Generica e Professionale)
// ============================================

function HomePage({ onEnter }) {
    return (
        <div className="homepage">
            <nav className="landing-navbar">
                <div className="brand"><Activity /> Clinica San Marco</div>
                <button className="btn-outline" onClick={onEnter}>Area Riservata</button>
            </nav>

            <header className="hero-section">
                <h1>La tua salute,<br />la nostra priorità!!!</h1>
                <p>Prenotazioni online immediate, referti digitali e un team di specialisti sempre al tuo fianco.</p>
                <button className="btn-cta" onClick={onEnter}>Prenota Ora</button>
            </header>

            <section className="features-section">
                <h2>Perché Sceglierci</h2>
                <div className="features-grid">
                    <div className="feature-card">
                        <div className="icon">🩺</div>
                        <h3>Team Multidisciplinare</h3>
                        <p>Oltre 15 specializzazioni mediche, dalla Cardiologia alla Pediatria, per un'assistenza completa.</p>
                    </div>
                    <div className="feature-card">
                        <div className="icon">⚡</div>
                        <h3>Zero Code</h3>
                        <p>Dimentica le attese. Scegli il medico, l'orario e prenota online 24/7 in autonomia.</p>
                    </div>
                    <div className="feature-card">
                        <div className="icon">📱</div>
                        <h3>Tutto Digitale</h3>
                        <p>Gestisci i tuoi appuntamenti e scarica i referti medici direttamente dal tuo computer.</p>
                    </div>
                </div>
            </section>
        </div>
    );
}

function LoginPage({ onLogin, onBack }) {
    const [isLogin, setIsLogin] = useState(true);
    const [formData, setFormData] = useState({ email: '', password: '', role: 'patient', name: '', surname: '', phone: '', specialization: '' });
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            if (isLogin) {
                const res = await axios.post(`${API_URL}/api/auth/login`, { email: formData.email, password: formData.password });
                onLogin(res.data.token, res.data.user);
            } else {
                await axios.post(`${API_URL}/api/auth/register`, { ...formData, specialization: formData.role === 'doctor' ? formData.specialization : null });
                toast.success('Registrato! Ora accedi.');
                setIsLogin(true);
            }
        } catch (error) { toast.error(getErrorMessage(error)); } finally { setLoading(false); }
    };

    return (
        <div className="login-container">
            <div className="login-box">
                <button onClick={onBack} className="back-link"><ArrowLeft size={16} /> Indietro</button>
                <h1>{isLogin ? 'Accedi' : 'Registrati'}</h1>
                <form onSubmit={handleSubmit}>
                    {!isLogin && (
                        <>
                            <input placeholder="Nome" onChange={e => setFormData({ ...formData, name: e.target.value })} required />
                            <input placeholder="Cognome" onChange={e => setFormData({ ...formData, surname: e.target.value })} required />
                            <input placeholder="Telefono" onChange={e => setFormData({ ...formData, phone: e.target.value })} required />

                            <select onChange={e => setFormData({ ...formData, role: e.target.value })} value={formData.role}>
                                <option value="patient">Sono un Paziente</option>
                                <option value="doctor">Sono un Medico</option>
                            </select>

                            {formData.role === 'doctor' && (
                                <select onChange={e => setFormData({ ...formData, specialization: e.target.value })} required defaultValue="">
                                    <option value="" disabled>Seleziona Specializzazione</option>
                                    {SPECIALIZATIONS.map(spec => <option key={spec} value={spec}>{spec}</option>)}
                                </select>
                            )}
                        </>
                    )}
                    <input type="email" placeholder="Email" onChange={e => setFormData({ ...formData, email: e.target.value })} required />
                    <input type="password" placeholder="Password" onChange={e => setFormData({ ...formData, password: e.target.value })} required />
                    <button type="submit" disabled={loading} className="btn-primary">{loading ? '...' : (isLogin ? 'Entra' : 'Registrati')}</button>
                </form>
                <p className="toggle-link" onClick={() => setIsLogin(!isLogin)}>{isLogin ? 'Non hai un account? Registrati' : 'Hai già un account? Accedi'}</p>
            </div>
        </div>
    );
}

// ============================================
// 2. DASHBOARD MEDICO
// ============================================

function DoctorDashboardAdvanced({ user, onLogout }) {
    const [view, setView] = useState('dashboard');
    const [appointments, setAppointments] = useState([]);
    const [filteredAppts, setFilteredAppts] = useState([]);
    const [searchTerm, setSearchTerm] = useState("");
    const [statusFilter, setStatusFilter] = useState("all");
    const [uploadModal, setUploadModal] = useState(null);

    const fetchData = async () => {
        try {
            const res = await axios.get(`${API_URL}/api/appointments/my`);
            setAppointments(res.data);
            setFilteredAppts(res.data);
        } catch (error) { toast.error("Errore caricamento dati"); }
    };

    useEffect(() => { fetchData(); }, []);

    useEffect(() => {
        let result = appointments;
        if (searchTerm) result = result.filter(a => a.patient_name?.toLowerCase().includes(searchTerm.toLowerCase()));
        if (statusFilter !== "all") result = result.filter(a => a.status === statusFilter);
        setFilteredAppts(result);
    }, [searchTerm, statusFilter, appointments]);

    const stats = useMemo(() => ({
        total: appointments.length,
        pending: appointments.filter(a => a.status === 'pending').length,
        today: appointments.filter(a => a.date === new Date().toISOString().split('T')[0]).length
    }), [appointments]);

    const updateStatus = async (id, status) => {
        try {
            await axios.patch(`${API_URL}/api/appointments/${id}/status`, null, { params: { status } });
            toast.success(`Stato aggiornato`);
            fetchData();
        } catch (e) { toast.error("Errore"); }
    };

    return (
        <div className="dashboard">
            <nav className="navbar">
                <div className="brand"><Activity /> Portale Medici</div>
                <div className="user-menu"><span>Dr. {user.surname}</span><button onClick={onLogout}>Esci</button></div>
            </nav>

            <div className="container">
                <div className="tabs">
                    <button className={view === 'dashboard' ? 'active' : ''} onClick={() => setView('dashboard')}>Dashboard</button>
                    <button className={view === 'profile' ? 'active' : ''} onClick={() => setView('profile')}>Profilo</button>
                </div>

                {view === 'dashboard' && (
                    <>
                        <div className="card-grid">
                            <StatCard title="Totale" value={stats.total} icon={<Calendar />} />
                            <StatCard title="Da Accettare" value={stats.pending} icon={<Clock />} />
                            <StatCard title="Oggi" value={stats.today} icon={<CheckCircle />} />
                        </div>

                        <div className="card" style={{ marginBottom: '2rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
                            <Search size={20} color="#64748b" />
                            <input type="text" placeholder="Cerca paziente..." style={{ border: 'none', outline: 'none', flex: 1 }} value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                            <select style={{ border: '1px solid #e2e8f0', padding: '5px', borderRadius: '5px' }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                                <option value="all">Tutti</option>
                                <option value="pending">🟡 In Attesa</option>
                                <option value="confirmed">🟢 Confermati</option>
                            </select>
                        </div>

                        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                            <table>
                                <thead>
                                    <tr style={{ background: '#f8fafc', textAlign: 'left' }}>
                                        <th style={{ padding: '1rem' }}>Paziente</th>
                                        <th style={{ padding: '1rem' }}>Data</th>
                                        <th style={{ padding: '1rem' }}>Stato</th>
                                        <th style={{ padding: '1rem' }}>Azioni</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredAppts.map((app) => (
                                        <tr key={app.appointment_id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                            <td style={{ padding: '1rem', fontWeight: 'bold', color: '#2563eb' }}>{app.patient_name}</td>
                                            <td style={{ padding: '1rem' }}>{app.date} <br /><small>{app.time_slot}</small></td>
                                            <td style={{ padding: '1rem' }}><span className={`badge ${app.status}`}>{app.status}</span></td>
                                            <td style={{ padding: '1rem' }}>
                                                {app.status === 'pending' && (
                                                    <><button className="btn-success" onClick={() => updateStatus(app.appointment_id, 'confirmed')}>✓</button>
                                                        <button className="btn-danger" onClick={() => updateStatus(app.appointment_id, 'rejected')}>✗</button></>
                                                )}
                                                {app.status === 'confirmed' && (
                                                    <button className="btn-primary" onClick={() => setUploadModal(app)}>Carica Referto</button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </>
                )}

                {view === 'profile' && <UserProfile user={user} />}

            </div>

            {/* MODALE UPLOAD */}
            {uploadModal && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                    <div className="card" style={{ width: '500px', padding: '2rem' }}>
                        <h3>Carica Referto per {uploadModal.patient_name}</h3>
                        <UploadForm appointment={uploadModal} onClose={() => setUploadModal(null)} />
                        <button onClick={() => setUploadModal(null)} style={{ marginTop: '1rem', background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}>Chiudi</button>
                    </div>
                </div>
            )}
        </div>
    );
}

function UploadForm({ appointment, onClose }) {
    const [file, setFile] = useState(null);
    const [notes, setNotes] = useState('');

    const handleUpload = async (e) => {
        e.preventDefault();
        const data = new FormData();
        data.append('file', file);
        const query = new URLSearchParams({
            appointment_id: appointment.appointment_id,
            exam_type: 'Visita Specialistica',
            exam_date: new Date().toISOString().split('T')[0],
            notes: notes
        }).toString();

        try {
            await axios.post(`${API_URL}/api/reports/upload?${query}`, data);
            toast.success("Referto caricato!");
            onClose();
        } catch (err) { toast.error("Errore upload"); }
    };

    return (
        <form onSubmit={handleUpload} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <input type="file" onChange={e => setFile(e.target.files[0])} required />
            <textarea placeholder="Note cliniche..." value={notes} onChange={e => setNotes(e.target.value)} style={{ width: '100%', padding: '10px', border: '1px solid #ddd' }} />
            <button type="submit" className="btn-primary">Carica PDF</button>
        </form>
    );
}

function StatCard({ title, value, icon }) {
    return (
        <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div><p style={{ color: '#64748b', fontSize: '0.9rem' }}>{title}</p><h3 style={{ fontSize: '1.5rem', margin: 0 }}>{value}</h3></div>
            <div style={{ fontSize: '1.5rem', color: '#2563eb' }}>{icon}</div>
        </div>
    );
}

// ============================================
// 3. DASHBOARD PAZIENTE
// ============================================

function PatientDashboard({ user, onLogout }) {
    const [view, setView] = useState('appointments');

    return (
        <div className="dashboard">
            <nav className="navbar">
                <div className="brand" style={{ color: '#16a34a' }}><Activity /> Area Paziente</div>
                <div className="user-menu"><span>{user.name}</span><button onClick={onLogout}>Esci</button></div>
            </nav>

            <div className="container">
                <div className="tabs">
                    <button className={view === 'appointments' ? 'active' : ''} onClick={() => setView('appointments')}>I miei Appuntamenti</button>
                    <button className={view === 'book' ? 'active' : ''} onClick={() => setView('book')}>Prenota Visita</button>
                    <button className={view === 'reports' ? 'active' : ''} onClick={() => setView('reports')}>I miei Referti</button>
                    <button className={view === 'profile' ? 'active' : ''} onClick={() => setView('profile')}>Profilo</button>
                </div>

                {view === 'appointments' && <PatientAppointments />}
                {view === 'book' && <BookAppointment onSuccess={() => setView('appointments')} />}
                {view === 'reports' && <PatientReports />}
                {view === 'profile' && <UserProfile user={user} />}
            </div>
        </div>
    );
}

function PatientAppointments() {
    const [appointments, setAppointments] = useState([]);
    useEffect(() => { axios.get(`${API_URL}/api/appointments/my`).then(res => setAppointments(res.data)); }, []);

    const cancel = async (id) => {
        if (window.confirm("Cancellare?")) {
            await axios.delete(`${API_URL}/api/appointments/${id}`);
            const res = await axios.get(`${API_URL}/api/appointments/my`);
            setAppointments(res.data);
            toast.info("Cancellato");
        }
    }

    return (
        <div className="card-grid">
            {appointments.length === 0 && <p>Nessun appuntamento.</p>}
            {appointments.map(a => (
                <div key={a.appointment_id} className="card">
                    <h3>{a.doctor_name}</h3>
                    <p style={{ color: '#666' }}>{a.specialization}</p>
                    <p>📅 {a.date} ore {a.time_slot}</p>
                    <span className={`badge ${a.status}`}>{a.status}</span>
                    {a.status === 'pending' && <button className="btn-danger" style={{ marginTop: '10px', width: '100%' }} onClick={() => cancel(a.appointment_id)}>Cancella</button>}
                </div>
            ))}
        </div>
    );
}

function BookAppointment({ onSuccess }) {
    const [spec, setSpec] = useState('');
    const [doctors, setDoctors] = useState([]);
    const [selectedDoc, setSelectedDoc] = useState('');
    const [date, setDate] = useState('');
    const [slots, setSlots] = useState([]);
    const [selectedSlot, setSelectedSlot] = useState('');
    const [reason, setReason] = useState('');

    useEffect(() => { if (spec) axios.get(`${API_URL}/api/doctors?specialization=${spec}`).then(res => setDoctors(res.data)); }, [spec]);
    useEffect(() => { if (selectedDoc && date) axios.get(`${API_URL}/api/doctors/${selectedDoc}/availability?date=${date}`).then(res => setSlots(res.data.available_slots)); }, [selectedDoc, date]);

    const submit = async (e) => {
        e.preventDefault();
        try {
            await axios.post(`${API_URL}/api/appointments`, { doctor_id: selectedDoc, date, time_slot: selectedSlot, reason });
            toast.success("Prenotato!");
            onSuccess();
        } catch (e) { toast.error("Errore"); }
    };

    return (
        <div className="form-box">
            <h2>Nuova Prenotazione</h2>
            <form onSubmit={submit}>
                <label>Specializzazione</label>
                <select onChange={e => setSpec(e.target.value)} defaultValue="">
                    <option value="" disabled>Seleziona Specializzazione...</option>
                    {SPECIALIZATIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>

                {spec && (
                    <>
                        <label>Medico</label>
                        <select onChange={e => setSelectedDoc(e.target.value)} defaultValue="">
                            <option value="" disabled>Seleziona Medico...</option>
                            {doctors.map(d => <option key={d.user_id} value={d.user_id}>{d.name} {d.surname}</option>)}
                        </select>
                    </>
                )}

                {selectedDoc && <><label>Data</label><input type="date" onChange={e => setDate(e.target.value)} /></>}
                {date && (
                    <div className="slots-grid">
                        {slots.length > 0 ? slots.map(s => <div key={s} className={`slot ${selectedSlot === s ? 'selected' : ''}`} onClick={() => setSelectedSlot(s)}>{s}</div>)
                            : <p>Nessun posto disponibile.</p>}
                    </div>
                )}
                {selectedSlot && <><label>Motivo</label><input placeholder="Motivo visita" onChange={e => setReason(e.target.value)} /><button className="btn-primary" style={{ marginTop: '10px' }}>Conferma</button></>}
            </form>
        </div>
    );
}

function PatientReports() {
    const [reports, setReports] = useState([]);
    useEffect(() => { axios.get(`${API_URL}/api/reports/my`).then(res => setReports(res.data)); }, []);

    const download = (id, name) => {
        axios.get(`${API_URL}/api/reports/${id}/download`, { responseType: 'blob' })
            .then(res => {
                const url = window.URL.createObjectURL(new Blob([res.data]));
                const link = document.createElement('a');
                link.href = url; link.setAttribute('download', name);
                document.body.appendChild(link); link.click();
            });
    };

    return (
        <div className="card-grid">
            {reports.length === 0 && <p>Nessun referto disponibile.</p>}
            {reports.map(r => (
                <div key={r.report_id} className="card">
                    <h3>📄 {r.exam_type}</h3>
                    <p>Medico: {r.doctor_name}</p>
                    <p>Data: {r.exam_date}</p>
                    <button className="btn-primary" onClick={() => download(r.report_id, r.original_filename)}>Scarica PDF</button>
                </div>
            ))}
        </div>
    );
}

// ============================================
// 4. PROFILO E CAMBIO PASSWORD
// ============================================

function UserProfile({ user }) {
    const [passData, setPassData] = useState({ old_password: '', new_password: '', confirm_password: '' });
    const [loading, setLoading] = useState(false);

    const handleChangePass = async (e) => {
        e.preventDefault();

        if (passData.new_password !== passData.confirm_password) {
            toast.error("Le nuove password non coincidono!");
            return;
        }
        if (passData.new_password.length < 6) {
            toast.error("La password deve essere di almeno 6 caratteri");
            return;
        }

        setLoading(true);
        try {
            await axios.post(`${API_URL}/api/users/change-password`, {
                old_password: passData.old_password,
                new_password: passData.new_password
            });
            toast.success("Password cambiata con successo!");
            setPassData({ old_password: '', new_password: '', confirm_password: '' });
        } catch (err) {
            toast.error(getErrorMessage(err));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: '2rem' }}>

            {/* COLONNA 1: DATI UTENTE */}
            <div className="card">
                <h3 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <User size={20} /> I Miei Dati
                </h3>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                    <div>
                        <label style={{ fontSize: '0.85rem', color: '#64748b', fontWeight: 'bold' }}>Nome e Cognome</label>
                        <input type="text" value={`${user.name} ${user.surname}`} disabled style={{ background: '#f1f5f9', cursor: 'not-allowed', border: '1px solid #e2e8f0' }} />
                    </div>
                    <div>
                        <label style={{ fontSize: '0.85rem', color: '#64748b', fontWeight: 'bold' }}>Email</label>
                        <input type="text" value={user.email} disabled style={{ background: '#f1f5f9', cursor: 'not-allowed', border: '1px solid #e2e8f0' }} />
                    </div>
                    <div>
                        <label style={{ fontSize: '0.85rem', color: '#64748b', fontWeight: 'bold' }}>Telefono</label>
                        <input type="text" value={user.phone} disabled style={{ background: '#f1f5f9', cursor: 'not-allowed', border: '1px solid #e2e8f0' }} />
                    </div>
                    <div>
                        <label style={{ fontSize: '0.85rem', color: '#64748b', fontWeight: 'bold' }}>Ruolo</label>
                        <div style={{ padding: '10px', background: '#f1f5f9', borderRadius: '8px', border: '1px solid #e2e8f0', color: '#64748b' }}>
                            {user.role === 'doctor' ? `Medico - ${user.specialization}` : 'Paziente'}
                        </div>
                    </div>
                </div>
            </div>

            {/* COLONNA 2: CAMBIO PASSWORD */}
            <div className="card">
                <h3 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <Lock size={20} /> Sicurezza
                </h3>
                <form onSubmit={handleChangePass}>
                    <label style={{ fontWeight: '500' }}>Vecchia Password</label>
                    <input
                        type="password"
                        placeholder="Inserisci la password attuale"
                        value={passData.old_password}
                        onChange={e => setPassData({ ...passData, old_password: e.target.value })}
                        required
                    />

                    <label style={{ fontWeight: '500' }}>Nuova Password</label>
                    <input
                        type="password"
                        placeholder="Minimo 6 caratteri"
                        value={passData.new_password}
                        onChange={e => setPassData({ ...passData, new_password: e.target.value })}
                        required
                    />

                    <label style={{ fontWeight: '500' }}>Conferma Password</label>
                    <input
                        type="password"
                        placeholder="Ripeti la nuova password"
                        value={passData.confirm_password}
                        onChange={e => setPassData({ ...passData, confirm_password: e.target.value })}
                        required
                    />

                    <button type="submit" className="btn-primary" disabled={loading} style={{ marginTop: '10px' }}>
                        {loading ? 'Aggiornamento...' : 'Aggiorna Password'}
                    </button>
                </form>
            </div>
        </div>
    );
}

export default App;