import { supabase } from "./supabase.js";
import { useState, useEffect, useRef, useCallback } from "react";
import { jsPDF } from "jspdf";
import JSZip from "jszip";

const C = {
  bg:"#f4f7fb", surface:"#ffffff", card:"#ffffff", cardAlt:"#f0f5ff",
  border:"#dde5f0", borderLight:"#eaf0f8",
  accent:"#2e7cf6", accentLight:"#e8f0fe",
  green:"#1aaa6e", greenLight:"#e6f9f1",
  orange:"#f07c1a", orangeLight:"#fff3e6",
  red:"#e03e5a", redLight:"#fdedf0",
  yellow:"#f5a623", yellowLight:"#fff8e8",
  teal:"#0ea5a0", tealLight:"#e5f7f7",
  purple:"#8b5cf6", purpleLight:"#f3edff",
  pink:"#ec4899", pinkLight:"#fdf0f7",
  text:"#1a2640", textSoft:"#3d5270", muted:"#8098b8", mutedLight:"#b0c2d8",
  white:"#ffffff",
  shadow:"0 2px 12px rgba(46,124,246,0.08)",
  shadowMd:"0 4px 24px rgba(46,124,246,0.12)",
};
const MONO = "'DM Mono', 'Courier New', monospace";
const SANS = "'DM Sans', 'Segoe UI', sans-serif";

const now = Date.now();

// All ECGs start unassigned (cardiologo:null). Admin assigns them manually.
const INIT_ECGS = [
  { id:"ECG-F01", origine:"farmacia", farmacia:"Farmacia Centrale Roma",   paziente:"M.R., 58a, M", ts:now-5400000,  stato:"in_attesa", urgenza:"urgente", note:"Palpitazioni episodiche",    cardiologo:null, chat:[] },
  { id:"ECG-F02", origine:"farmacia", farmacia:"Farmacia Salute Milano",   paziente:"A.G., 72a, F", ts:now-2700000,  stato:"in_attesa", urgenza:"normale", note:"Dolore toracico da sforzo",  cardiologo:null, chat:[] },
  { id:"ECG-F03", origine:"farmacia", farmacia:"Farmacia Verde Napoli",    paziente:"L.P., 45a, M", ts:now-18000000, stato:"refertato",  urgenza:"normale", note:"Check-up annuale",           cardiologo:"Dr. Rossi", chat:[] },
  { id:"ECG-A01", origine:"azienda",  azienda:"Med Lavoro Torino",  batch:"FCA-Mirafiori-2024-04", paziente:"R.B., 42a, M", ts:now-3600000,  stato:"in_attesa", urgenza:"normale", note:"Idoneità annuale", cardiologo:"Dr. Rossi", chat:[] },
  { id:"ECG-A02", origine:"azienda",  azienda:"Med Lavoro Torino",  batch:"FCA-Mirafiori-2024-04", paziente:"D.F., 51a, M", ts:now-3600000,  stato:"in_attesa", urgenza:"normale", note:"Idoneità annuale", cardiologo:"Dr. Rossi", chat:[] },
  { id:"ECG-A03", origine:"azienda",  azienda:"Med Lavoro Torino",  batch:"Iveco-Torino-2024-04",  paziente:"P.L., 38a, F", ts:now-7200000,  stato:"refertato",  urgenza:"normale", note:"Idoneità annuale", cardiologo:"Dr. Conti", chat:[] },
  { id:"ECG-P01", origine:"pubblico", paziente:"M.B., 62a, M", servizio:"ecg",   ts:now-7200000,  stato:"refertato",  urgenza:"normale", note:"Check-up annuale",              cardiologo:"Dr. Rossi", chat:[], appuntamento:"2024-04-15 09:00" },
  { id:"ECG-P02", origine:"pubblico", paziente:"L.S., 54a, F", servizio:"score2",ts:now-1800000,  stato:"in_attesa",  urgenza:"normale", note:"Prelievo + PAO + SCORE2",       cardiologo:null, chat:[], appuntamento:"2024-04-22 11:30", risultati:{ colTot:235, hdl:48, pas:142, fumatore:false } },
  { id:"ECG-F04", origine:"farmacia", farmacia:"Farmacia Bianchi Torino",  paziente:"G.M., 65a, M", ts:now-1200000,  stato:"in_attesa", urgenza:"normale", note:"Pre-operatorio",              cardiologo:"Dr. Conti", chat:[] },
  { id:"ECG-F05", origine:"farmacia", farmacia:"Farmacia Centrale Roma",   paziente:"S.T., 48a, F", ts:now-900000,   stato:"in_attesa", urgenza:"urgente", note:"Sincope recente",            cardiologo:null, chat:[] },
];

const CARDIOLOGI_DATA = {}; // caricato dinamicamente da Supabase

const ME_FARMACIA = "Farmacia Centrale Roma";
const ME_AZIENDA = "Med Lavoro Torino";
const ME_CARDIOLOGO_DEFAULT = "";

const generaSlots = () => {
  const slots = [];
  const oggi = new Date();
  for (let g=1; g<=14; g++) {
    const data = new Date(oggi);
    data.setDate(oggi.getDate()+g);
    if (data.getDay()===0) continue;
    const orari = data.getDay()===6
      ? ["09:00","09:30","10:00","10:30","11:00"]
      : ["09:00","09:30","10:00","10:30","11:00","11:30","15:00","15:30","16:00","16:30","17:00","17:30"];
    const occupati = Math.floor(Math.random()*4);
    slots.push({ data: data.toISOString().slice(0,10), giorno: data.toLocaleDateString("it-IT",{weekday:"short",day:"2-digit",month:"short"}), orari: orari.slice(occupati) });
  }
  return slots;
};

const fmt = ts => { const d=new Date(ts); return d.toLocaleDateString("it-IT",{day:"2-digit",month:"2-digit"})+" "+d.toLocaleTimeString("it-IT",{hour:"2-digit",minute:"2-digit"}); };

const useSLA = (ecg) => {
  const [left,setLeft] = useState(null);
  useEffect(()=>{
    if (ecg.stato!=="in_attesa") return;
    const slaMs = ecg.urgenza==="urgente"?24*3600000:48*3600000;
    const tick = ()=>setLeft(ecg.ts+slaMs-Date.now());
    tick();
    const id = setInterval(tick,1000);
    return ()=>clearInterval(id);
  },[ecg]);
  return left;
};

const SLATimer = ({ ecg, compact }) => {
  const left = useSLA(ecg);
  if (left===null) return null;
  const expired = left<0, urgent = left<1800000;
  const h = Math.abs(Math.floor(left/3600000)), m = Math.abs(Math.floor((left%3600000)/60000)), s = Math.abs(Math.floor((left%60000)/1000));
  const color = expired?C.red:urgent?C.orange:C.teal;
  const bg = expired?C.redLight:urgent?C.orangeLight:C.tealLight;
  const label = `${h}h ${String(m).padStart(2,"0")}m ${String(s).padStart(2,"0")}s`;
  if (compact) return <span style={{ color, background:bg, border:`1px solid ${color}33`, padding:"2px 10px", borderRadius:20, fontSize:11, fontFamily:MONO, whiteSpace:"nowrap" }}>{expired?"⚠ scaduto":`⏱ ${label}`}</span>;
  return (
    <div style={{ background:bg, border:`1px solid ${color}33`, borderRadius:12, padding:"14px 18px", display:"flex", alignItems:"center", gap:14 }}>
      <span style={{ fontSize:22 }}>{expired?"⚠️":"⏱"}</span>
      <div>
        <div style={{ color:C.muted, fontFamily:MONO, fontSize:10, letterSpacing:1.5, marginBottom:3 }}>SLA {ecg.urgenza==="urgente"?"2H":"4H"} — {expired?"SCADUTO":"RIMANENTE"}</div>
        <div style={{ color, fontFamily:MONO, fontSize:20, fontWeight:"bold", letterSpacing:1 }}>{label}</div>
      </div>
    </div>
  );
};

const Badge = ({ stato, urgenza }) => {
  if (urgenza==="urgente"&&stato==="in_attesa") return <span style={{ background:C.redLight, color:C.red, border:`1px solid ${C.red}33`, padding:"3px 12px", borderRadius:20, fontSize:11, fontFamily:SANS, fontWeight:600 }}>● Urgente</span>;
  if (stato==="in_attesa") return <span style={{ background:C.orangeLight, color:C.orange, border:`1px solid ${C.orange}33`, padding:"3px 12px", borderRadius:20, fontSize:11, fontFamily:SANS, fontWeight:600 }}>○ In attesa</span>;
  if (stato==="prenotato") return <span style={{ background:C.yellowLight, color:C.yellow, border:`1px solid ${C.yellow}33`, padding:"3px 12px", borderRadius:20, fontSize:11, fontFamily:SANS, fontWeight:600 }}>📅 Prenotato</span>;
  return <span style={{ background:C.greenLight, color:C.green, border:`1px solid ${C.green}33`, padding:"3px 12px", borderRadius:20, fontSize:11, fontFamily:SANS, fontWeight:600 }}>✓ Refertato</span>;
};

const OrigineTag = ({ ecg }) => {
  if (ecg.origine==="azienda") return <span style={{ background:C.purpleLight, color:C.purple, border:`1px solid ${C.purple}33`, borderRadius:6, padding:"2px 8px", fontSize:10, fontWeight:600 }}>🏢 Azienda</span>;
  if (ecg.origine==="pubblico") return <span style={{ background:C.pinkLight, color:C.pink, border:`1px solid ${C.pink}33`, borderRadius:6, padding:"2px 8px", fontSize:10, fontWeight:600 }}>👤 Privato</span>;
  return <span style={{ background:C.tealLight, color:C.teal, border:`1px solid ${C.teal}33`, borderRadius:6, padding:"2px 8px", fontSize:10, fontWeight:600 }}>💊 Farmacia</span>;
};

const StatCard = ({ label, value, color, sub, icon }) => (
  <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:16, padding:"20px 24px", flex:1, minWidth:120, boxShadow:C.shadow }}>
    {icon && <div style={{ fontSize:22, marginBottom:8 }}>{icon}</div>}
    <div style={{ color:C.muted, fontSize:11, fontFamily:SANS, fontWeight:500, marginBottom:6, letterSpacing:0.5 }}>{label}</div>
    <div style={{ color:color||C.accent, fontSize:30, fontFamily:MONO, fontWeight:"bold", lineHeight:1 }}>{value}</div>
    {sub && <div style={{ color:C.muted, fontSize:12, fontFamily:SANS, marginTop:6 }}>{sub}</div>}
  </div>
);

const UploadZone = ({ onFile }) => {
  const [drag,setDrag] = useState(false);
  const [file,setFile] = useState(null);
  const id = useRef("fu-"+Math.random().toString(36).slice(2,7)).current;
  return (
    <div>
      <label style={{ color:C.textSoft, fontSize:12, fontFamily:SANS, fontWeight:600, display:"block", marginBottom:8 }}>CARICA REFERTO PDF</label>
      <div onDragOver={e=>{e.preventDefault();setDrag(true)}} onDragLeave={()=>setDrag(false)}
        onDrop={e=>{e.preventDefault();setDrag(false);const f=e.dataTransfer.files[0];setFile(f);onFile?.(f)}}
        onClick={()=>document.getElementById(id).click()}
        style={{ border:`2px dashed ${drag?C.accent:C.border}`, borderRadius:14, padding:"28px 20px", textAlign:"center", cursor:"pointer", background:drag?C.accentLight:"#f8faff" }}>
        <input id={id} type="file" accept=".pdf,.png,.jpg" style={{display:"none"}} onChange={e=>{const f=e.target.files[0];setFile(f);onFile?.(f)}} />
        {file ? <div style={{ color:C.green, fontWeight:600, fontSize:14 }}>✓ {file.name}</div>
               : <><div style={{fontSize:28,marginBottom:8}}>📎</div><div style={{color:C.textSoft,fontSize:14,fontWeight:500}}>Trascina o clicca per selezionare</div><div style={{color:C.muted,fontSize:12,marginTop:4}}>PDF · PNG · JPG</div></>}
      </div>
    </div>
  );
};

const inputStyle = { background:C.bg, border:`1px solid ${C.border}`, borderRadius:10, padding:"11px 14px", color:C.text, fontFamily:SANS, fontSize:14, width:"100%", outline:"none" };
const labelStyle = { color:C.textSoft, fontSize:12, fontFamily:SANS, fontWeight:600, display:"block", marginBottom:7 };
const btnPrimary = (active) => ({ background:active?C.accent:C.border, color:active?C.white:C.muted, border:"none", borderRadius:10, padding:"13px 0", cursor:active?"pointer":"not-allowed", fontFamily:SANS, fontWeight:700, fontSize:15, width:"100%", boxShadow:active?`0 4px 16px ${C.accent}44`:"none" });

const Logo = ({ size=51 }) => (
  <div style={{ display:"flex", alignItems:"center", gap:10 }}>
    <img src="/logo-squared.png" alt="logo" style={{ width:size*1.8, height:size*1.8, borderRadius:size/3, objectFit:"cover" }} />
    <div style={{ display:"flex", flexDirection:"column", lineHeight:1 }}>
      <span style={{ fontFamily:SANS, fontWeight:700, fontSize:size*0.5, color:C.text, letterSpacing:-0.3 }}>Ambulatorio Millefonti</span>
      <span style={{ fontFamily:MONO, fontSize:size*0.28, color:C.muted, letterSpacing:2, marginTop:2 }}>ECG · REFERTAZIONE</span>
    </div>
  </div>
);

// ── LOGIN ─────────────────────────────────────────────────────────────────
const Login = ({ onLogin, onSelectCardiologo }) => {
  const [showCardiologi, setShowCardiologi] = useState(false);
  const roles = [
    { id:"pubblico",   label:"Pubblico — Cittadini",             icon:"👤", desc:"Prenota ECG o stima rischio CV" },
    { id:"farmacia",   label:"Farmacia",                         icon:"💊", desc:"Carica ECG, ricevi referti" },
    { id:"azienda",    label:"Azienda — Medicina del lavoro",    icon:"🏢", desc:"Upload batch per visite di idoneità" },
    { id:"cardiologo", label:"Cardiologo",                       icon:"🫀", desc:"Vedi ed esegui i referti assegnati" },
    { id:"admin",      label:"Admin",                            icon:"⚙️", desc:"Dashboard e controllo piattaforma" },
  ];

  if (showCardiologi) return (
    <div style={{ minHeight:"100vh", background:"linear-gradient(135deg,#e8f2ff,#f4f7fb,#e8f9f4)", display:"flex", alignItems:"center", justifyContent:"center", padding:24, fontFamily:SANS }}>
      <div style={{ maxWidth:440, width:"100%" }}>
        <button onClick={()=>setShowCardiologi(false)} style={{ background:"transparent", border:"none", color:C.muted, fontSize:13, cursor:"pointer", marginBottom:20, fontWeight:500 }}>← Torna alla scelta ruolo</button>
        <h2 style={{ color:C.text, fontSize:24, fontWeight:700, marginBottom:6 }}>Seleziona il tuo profilo</h2>
        <p style={{ color:C.muted, fontSize:13, marginBottom:24 }}>Vedrai <strong>solo gli ECG che l'admin ti ha assegnato</strong> — nessun accesso alla coda generale</p>
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {Object.entries(CARDIOLOGI_DATA).length > 0 && Object.entries(CARDIOLOGI_DATA).map(([nome,d])=>(
            <button key={nome} onClick={()=>{ onSelectCardiologo(nome); onLogin("cardiologo"); }}
              style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:14, padding:"16px 20px", cursor:"pointer", display:"flex", alignItems:"center", gap:14, textAlign:"left", boxShadow:C.shadow }}>
              <div style={{ width:40, height:40, background:C.accentLight, borderRadius:12, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 }}>🫀</div>
              <div style={{ flex:1 }}>
                <div style={{ fontWeight:700, fontSize:14, color:C.text }}>{nome}</div>
                <div style={{ fontSize:12, color:C.muted, marginTop:3 }}>{0 || 0} referti</div>
              </div>
              <span style={{ color:C.mutedLight }}>›</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight:"100vh", background:"linear-gradient(135deg,#e8f2ff,#f4f7fb,#e8f9f4)", display:"flex", alignItems:"center", justifyContent:"center", padding:24, fontFamily:SANS }}>
      <div style={{ position:"fixed", top:-100, right:-100, width:400, height:400, borderRadius:"50%", background:"radial-gradient(circle,#2e7cf618,transparent 70%)", pointerEvents:"none" }} />
      <div style={{ position:"fixed", bottom:-80, left:-80, width:300, height:300, borderRadius:"50%", background:"radial-gradient(circle,#1aaa6e12,transparent 70%)", pointerEvents:"none" }} />
      <div style={{ position:"relative", zIndex:1, textAlign:"center", maxWidth:440, width:"100%" }}>
        <img src="/logo-squared.png" alt="logo" style={{ width:330, height:330, objectFit:"contain", margin:"0 auto 16px", display:"block", mixBlendMode:"multiply" }} />
        <h1 style={{ color:C.text, fontSize:36, fontWeight:700, margin:"0 0 4px", letterSpacing:-1 }}>Ambulatorio Millefonti</h1>
        <p style={{ color:C.muted, fontFamily:MONO, fontSize:11, letterSpacing:3, marginBottom:8, textTransform:"uppercase" }}>ECG · Refertazione</p>
        <p style={{ color:C.textSoft, fontSize:14, marginBottom:36 }}>Cardiologia accessibile per cittadini, farmacie, aziende</p>
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {roles.map(r=>(
            <button key={r.id} onClick={()=>r.id==="cardiologo"?setShowCardiologi(true):onLogin(r.id)}
              style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:16, padding:"16px 20px", cursor:"pointer", display:"flex", alignItems:"center", gap:14, textAlign:"left", boxShadow:C.shadow }}>
              <div style={{ width:42, height:42, background:`linear-gradient(135deg,${C.accentLight},${C.tealLight})`, borderRadius:11, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>{r.icon}</div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontWeight:700, fontSize:14, color:C.text }}>{r.label}</div>
                <div style={{ color:C.muted, fontSize:12, marginTop:2 }}>{r.desc}</div>
              </div>
              <span style={{ color:C.mutedLight, fontSize:18 }}>›</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

// ── PUBBLICO ─────────────────────────────────────────────────────────────
const PubblicoView = ({ setEcgs }) => {
  const [step, setStep] = useState(-1); // -1=home, 0-2=booking
  const [servizio, setServizio] = useState(null);
  const [slotScelto, setSlotScelto] = useState(null);
  const [form, setForm] = useState({ nome:"", cognome:"", email:"", telefono:"", note:"" });
  const [confermato, setConfermato] = useState(false);
  const slots = useRef(generaSlots()).current;

  const reset = () => { setStep(-1); setServizio(null); setSlotScelto(null); setForm({ nome:"", cognome:"", email:"", telefono:"", note:"" }); setConfermato(false); };

  const avvia = (s) => { setServizio(s); setStep(0); };

  const conferma = () => {
    setEcgs(prev=>[...prev,{
      id:`ECG-P${Date.now().toString().slice(-4)}`, origine:"pubblico",
      paziente:`${form.nome} ${form.cognome}`, servizio,
      ts:Date.now(), stato:"prenotato", urgenza:"normale",
      note:form.note||"—", cardiologo:null, chat:[],
      appuntamento:`${slotScelto.data} ${slotScelto.ora}`,
      ...(servizio==="score2"?{risultati:{}}:{})
    }]);
    setConfermato(true);
  };

  if (step===-1) return (
    <div style={{ padding:32, maxWidth:700, margin:"0 auto" }}>
      <div style={{ textAlign:"center", marginBottom:40 }}>
        <div style={{ display:"inline-block", background:"linear-gradient(135deg,#fdf0f7,#e5f7f7)", borderRadius:20, padding:"8px 20px", fontFamily:MONO, fontSize:11, letterSpacing:2, color:C.teal, textTransform:"uppercase", marginBottom:16 }}>Prenotazione online · Risposta rapida</div>
        <h1 style={{ color:C.text, fontSize:38, fontWeight:700, marginBottom:10, letterSpacing:-1 }}>La tua <span style={{ color:C.teal }}>salute del cuore</span><br/>con un appuntamento.</h1>
        <p style={{ color:C.muted, fontSize:15, maxWidth:460, margin:"0 auto" }}>Scegli il servizio, prenota uno slot disponibile nei prossimi 14 giorni, e vieni in ambulatorio.</p>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20, marginBottom:32 }}>
        <div onClick={()=>avvia("ecg")} style={{ background:"linear-gradient(135deg,#fff,#e5f7f7)", border:`2px solid ${C.teal}33`, borderRadius:20, padding:28, cursor:"pointer", boxShadow:C.shadow }} onMouseEnter={e=>{e.currentTarget.style.borderColor=C.teal+"99"}} onMouseLeave={e=>{e.currentTarget.style.borderColor=C.teal+"33"}}>
          <div style={{ width:60, height:60, background:C.tealLight, borderRadius:18, display:"flex", alignItems:"center", justifyContent:"center", fontSize:30, marginBottom:18 }}>🫀</div>
          <h3 style={{ color:C.text, fontSize:20, fontWeight:700, marginBottom:6 }}>ECG con referto cardiologico</h3>
          <p style={{ color:C.muted, fontSize:13, marginBottom:18, lineHeight:1.5 }}>Tracciato a 12 derivazioni con referto firmato da un cardiologo OMCeO. Valido per sport, lavoro, certificazioni.</p>
          {["Tracciato ECG 12 derivazioni","Referto PDF firmato","Valido per sport · lavoro · certificazioni"].map(t=>(
            <div key={t} style={{ display:"flex", alignItems:"center", gap:8, fontSize:12, color:C.textSoft, marginBottom:6 }}><span style={{ color:C.teal, fontWeight:700 }}>✓</span>{t}</div>
          ))}
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", paddingTop:16, borderTop:`1px solid ${C.teal}22`, marginTop:12 }}>
            <div style={{ color:C.teal, fontSize:28, fontWeight:700, fontFamily:MONO }}>50€</div>
            <button style={{ background:C.teal, color:C.white, border:"none", borderRadius:10, padding:"10px 20px", cursor:"pointer", fontWeight:700, fontSize:14 }}>Prenota →</button>
          </div>
        </div>
        <div onClick={()=>avvia("score2")} style={{ background:"linear-gradient(135deg,#fff,#fdf0f7)", border:`2px solid ${C.pink}33`, borderRadius:20, padding:28, cursor:"pointer", boxShadow:C.shadow }} onMouseEnter={e=>{e.currentTarget.style.borderColor=C.pink+"99"}} onMouseLeave={e=>{e.currentTarget.style.borderColor=C.pink+"33"}}>
          <div style={{ position:"relative" }}>
            <div style={{ position:"absolute", top:-8, right:-8, background:C.yellow, color:C.white, borderRadius:20, padding:"3px 12px", fontSize:11, fontWeight:700 }}>★ Più richiesto</div>
          </div>
          <div style={{ width:60, height:60, background:C.pinkLight, borderRadius:18, display:"flex", alignItems:"center", justifyContent:"center", fontSize:30, marginBottom:18 }}>📊</div>
          <h3 style={{ color:C.text, fontSize:20, fontWeight:700, marginBottom:6 }}>Stima il tuo rischio CV</h3>
          <p style={{ color:C.muted, fontSize:13, marginBottom:18, lineHeight:1.5 }}>Conosci la tua probabilità di evento cardiovascolare nei prossimi 10 anni con il calcolatore SCORE2.</p>
          {["Prelievo (col. tot + HDL)","Misurazione pressione arteriosa","Calcolo SCORE2 + report PDF"].map(t=>(
            <div key={t} style={{ display:"flex", alignItems:"center", gap:8, fontSize:12, color:C.textSoft, marginBottom:6 }}><span style={{ color:C.pink, fontWeight:700 }}>✓</span>{t}</div>
          ))}
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", paddingTop:16, borderTop:`1px solid ${C.pink}22`, marginTop:12 }}>
            <div style={{ color:C.pink, fontSize:28, fontWeight:700, fontFamily:MONO }}>30€</div>
            <button style={{ background:C.pink, color:C.white, border:"none", borderRadius:10, padding:"10px 20px", cursor:"pointer", fontWeight:700, fontSize:14 }}>Prenota →</button>
          </div>
        </div>
      </div>
      <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:16, padding:"20px 28px", display:"flex", justifyContent:"space-around", alignItems:"center", flexWrap:"wrap", gap:16, boxShadow:C.shadow }}>
        {[["🏥","Ambulatorio fisico"],["⚡","Risultati rapidi"],["🛡️","Privacy GDPR"],["💳","Pagamento sicuro"]].map(([i,t])=>(
          <div key={t} style={{ display:"flex", alignItems:"center", gap:10 }}>
            <span style={{ fontSize:22 }}>{i}</span>
            <span style={{ color:C.textSoft, fontWeight:600, fontSize:13 }}>{t}</span>
          </div>
        ))}
      </div>
    </div>
  );

  const colorTema = servizio==="ecg"?C.teal:C.pink;
  const prezzo = servizio==="ecg"?"50€":"30€";

  if (confermato) return (
    <div style={{ padding:32, maxWidth:560, margin:"0 auto", textAlign:"center" }}>
      <div style={{ width:96, height:96, background:C.greenLight, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", fontSize:44, margin:"40px auto 24px" }}>✅</div>
      <h2 style={{ color:C.green, fontSize:28, fontWeight:700, marginBottom:6 }}>Prenotazione confermata!</h2>
      <p style={{ color:C.muted, fontSize:15, marginBottom:30 }}>Riceverai un'email di conferma a {form.email}</p>
      <div style={{ background:C.white, border:`2px solid ${colorTema}33`, borderRadius:18, padding:24, textAlign:"left", boxShadow:C.shadow, marginBottom:20 }}>
        <div style={{ color:colorTema, fontFamily:MONO, fontSize:11, letterSpacing:2, textTransform:"uppercase", fontWeight:700, marginBottom:14 }}>Riepilogo appuntamento</div>
        {[["Servizio",servizio==="ecg"?"ECG con referto":"Stima rischio CV (SCORE2)"],["Data",new Date(slotScelto.data).toLocaleDateString("it-IT",{weekday:"long",day:"2-digit",month:"long"})],["Orario",slotScelto.ora],["Paziente",`${form.nome} ${form.cognome}`],["Costo",prezzo]].map(([k,v])=>(
          <div key={k} style={{ display:"flex", justifyContent:"space-between", padding:"10px 0", borderBottom:`1px solid ${C.borderLight}`, fontSize:14 }}>
            <span style={{ color:C.muted }}>{k}</span><span style={{ color:C.text, fontWeight:600 }}>{v}</span>
          </div>
        ))}
      </div>
      {servizio==="score2" && <div style={{ background:C.yellowLight, border:`1px solid ${C.yellow}33`, borderRadius:12, padding:"14px 18px", marginBottom:20, fontSize:13, color:C.textSoft, textAlign:"left" }}>⏰ Per il prelievo: presentarsi a <strong>digiuno da almeno 8 ore</strong>.</div>}
      <button onClick={reset} style={btnPrimary(true)}>← Torna alla home</button>
    </div>
  );

  return (
    <div style={{ padding:32, maxWidth:560, margin:"0 auto" }}>
      <button onClick={reset} style={{ background:"transparent", border:"none", color:C.muted, fontSize:13, cursor:"pointer", marginBottom:20, fontWeight:500 }}>← Torna ai servizi</button>
      <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:20 }}>
        <div style={{ width:48, height:48, background:servizio==="ecg"?C.tealLight:C.pinkLight, borderRadius:14, display:"flex", alignItems:"center", justifyContent:"center", fontSize:24 }}>{servizio==="ecg"?"🫀":"📊"}</div>
        <div>
          <h2 style={{ color:C.text, fontSize:22, fontWeight:700 }}>{servizio==="ecg"?"ECG con referto":"Stima rischio CV"}</h2>
          <div style={{ color:colorTema, fontFamily:MONO, fontSize:14, fontWeight:700 }}>{prezzo}</div>
        </div>
      </div>
      <div style={{ display:"flex", gap:8, marginBottom:28 }}>
        {["Dati","Data e orario","Conferma"].map((s,i)=>(
          <div key={s} style={{ flex:1, height:6, borderRadius:6, background:i<=step?colorTema:C.border }} />
        ))}
      </div>

      {step===0 && (
        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
            {[["nome","Nome"],["cognome","Cognome"]].map(([k,l])=>(
              <div key={k}><label style={labelStyle}>{l}</label><input style={inputStyle} value={form[k]} onChange={e=>setForm(p=>({...p,[k]:e.target.value}))} placeholder={l} /></div>
            ))}
          </div>
          {[["email","Email","email@esempio.it"],["telefono","Telefono","+39 333 000 0000"]].map(([k,l,ph])=>(
            <div key={k}><label style={labelStyle}>{l}</label><input style={inputStyle} value={form[k]} onChange={e=>setForm(p=>({...p,[k]:e.target.value}))} placeholder={ph} /></div>
          ))}
          <div><label style={labelStyle}>Note (sintomi, motivo visita)</label><textarea style={{...inputStyle, height:80, resize:"vertical"}} value={form.note} onChange={e=>setForm(p=>({...p,note:e.target.value}))} placeholder="Facoltativo" /></div>
          {servizio==="score2" && <div style={{ background:C.yellowLight, border:`1px solid ${C.yellow}33`, borderRadius:10, padding:"12px 16px", fontSize:13, color:C.textSoft }}>⏰ Presentarsi a <strong>digiuno da almeno 8 ore</strong> prima dell'appuntamento.</div>}
          <button onClick={()=>setStep(1)} style={btnPrimary(!!(form.nome&&form.cognome&&form.email))}>Scegli data e orario →</button>
        </div>
      )}

      {step===1 && (
        <div>
          <p style={{ color:C.muted, fontSize:13, marginBottom:16 }}>Seleziona un giorno e un orario disponibile nei prossimi 14 giorni.</p>
          <div style={{ display:"flex", flexDirection:"column", gap:12, maxHeight:380, overflowY:"auto" }}>
            {slots.map(s=>(
              <div key={s.data} style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:14, padding:"14px 16px", boxShadow:C.shadow }}>
                <div style={{ color:C.muted, fontSize:11, fontFamily:MONO, textTransform:"uppercase", letterSpacing:1, marginBottom:10 }}>{s.giorno}</div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
                  {s.orari.map(o=>{
                    const sel = slotScelto?.data===s.data&&slotScelto?.ora===o;
                    return <button key={o} onClick={()=>setSlotScelto({data:s.data,ora:o})} style={{ background:sel?colorTema:C.bg, color:sel?C.white:C.text, border:`1.5px solid ${sel?colorTema:C.border}`, borderRadius:8, padding:"7px 14px", cursor:"pointer", fontFamily:MONO, fontSize:13, fontWeight:600 }}>{o}</button>;
                  })}
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop:16, display:"flex", gap:10 }}>
            <button onClick={()=>setStep(0)} style={{ background:C.bg, border:`1px solid ${C.border}`, borderRadius:10, padding:"12px 0", cursor:"pointer", fontFamily:SANS, fontWeight:600, fontSize:14, flex:1, color:C.muted }}>← Indietro</button>
            <button onClick={()=>setStep(2)} style={{...btnPrimary(!!slotScelto), flex:2}}>Conferma →</button>
          </div>
        </div>
      )}

      {step===2 && (
        <div>
          <div style={{ background:C.white, border:`2px solid ${colorTema}33`, borderRadius:16, padding:22, boxShadow:C.shadow, marginBottom:16 }}>
            <div style={{ color:colorTema, fontFamily:MONO, fontSize:11, letterSpacing:2, textTransform:"uppercase", fontWeight:700, marginBottom:14 }}>Riepilogo prenotazione</div>
            {[["Servizio",servizio==="ecg"?"ECG con referto":"Stima rischio CV (SCORE2)"],["Paziente",`${form.nome} ${form.cognome}`],["Email",form.email],["Telefono",form.telefono||"—"],["Data",new Date(slotScelto.data).toLocaleDateString("it-IT",{weekday:"long",day:"2-digit",month:"long"})],["Orario",slotScelto.ora],["Costo",prezzo]].map(([k,v])=>(
              <div key={k} style={{ display:"flex", justifyContent:"space-between", padding:"9px 0", borderBottom:`1px solid ${C.borderLight}`, fontSize:14 }}>
                <span style={{ color:C.muted }}>{k}</span><span style={{ color:C.text, fontWeight:600 }}>{v}</span>
              </div>
            ))}
          </div>
          <div style={{ display:"flex", gap:10 }}>
            <button onClick={()=>setStep(1)} style={{ background:C.bg, border:`1px solid ${C.border}`, borderRadius:10, padding:"12px 0", cursor:"pointer", fontFamily:SANS, fontWeight:600, fontSize:14, flex:1, color:C.muted }}>← Indietro</button>
            <button onClick={conferma} style={{...btnPrimary(true), flex:2}}>Conferma prenotazione ✓</button>
          </div>
        </div>
      )}
    </div>
  );
};

// ── FARMACIA ─────────────────────────────────────────────────────────────
const FarmaciaView = ({ ecgs, setEcgs }) => {
  const [tab, setTab] = useState("upload");
  const [file, setFile] = useState(null);
  const [form, setForm] = useState({ paziente:"", eta:"", sesso:"M", note:"", urgenza:"normale" });
  const [sent, setSent] = useState(false);
  const [meEmail, setMeEmail] = useState("");
  const [nomeFarmacia, setNomeFarmacia] = useState("");
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.user) return;
      setMeEmail(session.user.email);
      const { data: profile } = await supabase.from('user_profiles').select('nome, cognome').eq('id', session.user.id).single();
      if (profile) { const n = `${profile.nome||''} ${profile.cognome||''}`.trim(); if (n) setNomeFarmacia(n); }
    });
  }, []);
  const miei = ecgs.filter(e=>e.origine==="farmacia"&&(meEmail?e.email_destinatario===meEmail:e.farmacia===ME_FARMACIA));

  const invia = async () => {
    if (!file||!form.paziente) return;
    // 1. Carica file su Supabase Storage
    const fileExt = file.name.split('.').pop();
    const fileName = `farmacia-${Date.now()}.${fileExt}`;
    const { error: uploadError } = await supabase.storage.from('ecg-files').upload(fileName, file);
    const fileUrl = uploadError ? null : fileName;
    // 2. Salva ECG nel database
    const nuovoEcg = {
      origine: "farmacia",
      paziente_nome: form.paziente,
      paziente_eta: parseInt(form.eta)||0,
      paziente_sesso: form.sesso,
      note: form.note||"—",
      urgenza: form.urgenza,
      stato: "in_attesa",
      origine_dettaglio: nomeFarmacia || ME_FARMACIA,
      file_ecg_url: fileUrl,
      email_destinatario: meEmail,
    };
    const { data, error } = await supabase.from('ecgs').insert(nuovoEcg).select().single();
    if (!error && data) {
      setEcgs(prev=>[...prev,{ ...data, paziente:`${form.paziente}, ${form.eta}a, ${form.sesso}`, farmacia:ME_FARMACIA, ts:new Date(data.created_at).getTime(), cardiologo:data.cardiologo_nome||null, chat:[] }]);
    }
    setSent(true);
    fetch('/api/notify', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ paziente:`${form.paziente}, ${form.eta}a, ${form.sesso}`, origine:"farmacia", urgenza:form.urgenza, note:form.note }) }).catch(()=>{});
  };

  const tabBtn = (id,label) => (
    <button onClick={()=>setTab(id)} style={{ background:tab===id?C.white:"transparent", border:tab===id?`1px solid ${C.border}`:"1px solid transparent", borderRadius:10, padding:"8px 20px", cursor:"pointer", fontFamily:SANS, fontWeight:600, fontSize:13, color:tab===id?C.accent:C.muted, boxShadow:tab===id?C.shadow:"none" }}>{label}</button>
  );

  return (
    <div style={{ padding:32, maxWidth:700, margin:"0 auto" }}>
      <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:28 }}>
        <div style={{ width:52, height:52, background:"linear-gradient(135deg,#e5f7f7,#f4f7fb)", borderRadius:16, display:"flex", alignItems:"center", justifyContent:"center", fontSize:26 }}>💊</div>
        <div><h2 style={{ color:C.text, fontSize:24, fontWeight:700 }}>Farmacia · {ME_FARMACIA}</h2><div style={{ color:C.muted, fontSize:13, marginTop:2 }}>Carica ECG e monitora i tuoi referti</div></div>
      </div>
      <div style={{ display:"flex", gap:6, marginBottom:24, background:C.bg, borderRadius:12, padding:4, width:"fit-content" }}>
        {tabBtn("upload","Carica ECG")}
        {tabBtn("storico","I miei referti")}
      </div>

      {tab==="upload" && (
        sent ? (
          <div style={{ background:C.white, border:`2px solid ${C.green}33`, borderRadius:20, padding:40, textAlign:"center", boxShadow:C.shadow }}>
            <div style={{ fontSize:48, marginBottom:16 }}>✅</div>
            <h3 style={{ color:C.green, fontSize:22, fontWeight:700, marginBottom:6 }}>ECG inviato!</h3>
            <p style={{ color:C.muted, fontSize:14, marginBottom:20 }}>Il referto arriverà entro {form.urgenza==="urgente"?"2":"4"} ore.</p>
            <button onClick={()=>{setSent(false);setFile(null);setForm({ paziente:"", eta:"", sesso:"M", note:"", urgenza:"normale" })}} style={{ background:C.accent, color:C.white, border:"none", borderRadius:10, padding:"12px 28px", cursor:"pointer", fontWeight:700, fontSize:14 }}>Carica un altro →</button>
          </div>
        ) : (
          <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:20, padding:28, boxShadow:C.shadow }}>
            <h3 style={{ color:C.text, fontSize:17, fontWeight:700, marginBottom:20 }}>Nuovo ECG da refertare</h3>
            <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
              <div><label style={labelStyle}>NOME PAZIENTE</label><input style={inputStyle} value={form.paziente} onChange={e=>setForm(p=>({...p,paziente:e.target.value}))} placeholder="Cognome Nome" /></div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                <div><label style={labelStyle}>ETÀ</label><input style={inputStyle} type="number" value={form.eta} onChange={e=>setForm(p=>({...p,eta:e.target.value}))} placeholder="es. 58" /></div>
                <div><label style={labelStyle}>SESSO</label>
                  <select style={inputStyle} value={form.sesso} onChange={e=>setForm(p=>({...p,sesso:e.target.value}))}>
                    <option value="M">Maschio</option><option value="F">Femmina</option>
                  </select>
                </div>
              </div>
              <div><label style={labelStyle}>URGENZA</label>
                <div style={{ display:"flex", gap:8 }}>
                  {[["normale","Normale (4h)"],["urgente","Urgente (2h)"]].map(([v,l])=>(
                    <button key={v} onClick={()=>setForm(p=>({...p,urgenza:v}))} style={{ flex:1, padding:"10px 0", borderRadius:10, cursor:"pointer", border:`1.5px solid ${form.urgenza===v?(v==="urgente"?C.red:C.accent):C.border}`, background:form.urgenza===v?(v==="urgente"?C.redLight:C.accentLight):C.bg, color:form.urgenza===v?(v==="urgente"?C.red:C.accent):C.muted, fontWeight:600, fontSize:13 }}>{l}</button>
                  ))}
                </div>
              </div>
              <div><label style={labelStyle}>NOTE CLINICHE</label><textarea style={{...inputStyle, height:70, resize:"vertical"}} value={form.note} onChange={e=>setForm(p=>({...p,note:e.target.value}))} placeholder="Sintomi, motivo..." /></div>
              <UploadZone onFile={setFile} />
              <button onClick={invia} style={btnPrimary(!!(file&&form.paziente&&form.eta))}>Invia per refertazione →</button>
            </div>
          </div>
        )
      )}

      {tab==="storico" && (
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {miei.length===0 && <div style={{ textAlign:"center", padding:40, color:C.muted }}>Nessun ECG ancora caricato</div>}
          {miei.map(e=>(
            <div key={e.id} style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:14, padding:"16px 20px", boxShadow:C.shadow, display:"flex", alignItems:"center", gap:14, flexWrap:"wrap" }}>
              <div style={{ flex:1, minWidth:160 }}>
                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
                  <span style={{ fontFamily:MONO, color:C.muted, fontSize:11 }}>{e.id}</span>
                  <Badge stato={e.stato} urgenza={e.urgenza} />
                </div>
                <div style={{ color:C.text, fontSize:15, fontWeight:600 }}>{e.paziente}</div>
                <div style={{ color:C.muted, fontSize:12, marginTop:2 }}>{fmt(e.ts)} · {e.note}</div>
              </div>
              {e.stato==="refertato" && <div style={{ background:C.greenLight, color:C.green, border:`1px solid ${C.green}33`, borderRadius:10, padding:"8px 16px", fontSize:13, fontWeight:700, cursor:"pointer" }}>📄 Scarica PDF</div>}
              {e.stato==="in_attesa" && !e.cardiologo && <div style={{ background:C.yellowLight, color:C.yellow, border:`1px solid ${C.yellow}33`, borderRadius:10, padding:"8px 16px", fontSize:12, fontWeight:600 }}>⏳ In coda</div>}
              {e.stato==="in_attesa" && e.cardiologo && <div style={{ background:C.accentLight, color:C.accent, border:`1px solid ${C.accent}33`, borderRadius:10, padding:"8px 16px", fontSize:12, fontWeight:600 }}>🫀 In refertazione</div>}
              {e.stato==="in_attesa" && <SLATimer ecg={e} compact />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ── AZIENDA ─────────────────────────────────────────────────────────────
const AziendaView = ({ ecgs, setEcgs }) => {
  const [tab, setTab] = useState("dashboard");
  const [batchNome, setBatchNome] = useState("");
  const [emailLotto, setEmailLotto] = useState("");
  const [noteGenerali, setNoteGenerali] = useState("");
  const [filesLotto, setFilesLotto] = useState([]);
  const [logoWarning, setLogoWarning] = useState(false);
  const [sent, setSent] = useState(false);
  const [scaricandoBatch, setScaricandoBatch] = useState(null);
  const [caricando, setCaricando] = useState(false);
  const [nomeAzienda, setNomeAzienda] = useState("");
  const [meEmail, setMeEmail] = useState("");
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.user) return;
      setMeEmail(session.user.email);
      const { data: profile } = await supabase.from('user_profiles').select('nome, cognome').eq('id', session.user.id).single();
      if (profile) { const n = `${profile.nome||''} ${profile.cognome||''}`.trim(); if (n) setNomeAzienda(n); }
    });
  }, []);
  // Filtra per email destinatario (funziona sia per upload da sito che da mail)
  const miei = ecgs.filter(e => e.origine === "azienda" && (
    meEmail ? e.email_destinatario === meEmail : e.azienda === ME_AZIENDA
  ));
  // Conteggio ECG del mese corrente
  const meseCorrente = new Date().getMonth();
  const annoCorrente = new Date().getFullYear();
  const ecgMese = miei.filter(e => {
    const d = new Date(e.created_at || e.ts);
    return d.getMonth() === meseCorrente && d.getFullYear() === annoCorrente;
  });
  const ecgRefertatiMese = ecgMese.filter(e => e.stato === "refertato");

  const tabBtn = (id,label) => (
    <button onClick={()=>setTab(id)} style={{ background:tab===id?C.white:"transparent", border:tab===id?`1px solid ${C.border}`:"1px solid transparent", borderRadius:10, padding:"8px 20px", cursor:"pointer", fontFamily:SANS, fontWeight:600, fontSize:13, color:tab===id?C.purple:C.muted, boxShadow:tab===id?C.shadow:"none" }}>{label}</button>
  );

  const inviaLotto = async () => {
    if (!batchNome||filesLotto.length===0||caricando) return;
    setCaricando(true);
    const batchId = `BATCH-${Date.now()}`;
    const emailAccount = meEmail;
    const nuovi = await Promise.all(Array.from(filesLotto).map(async (file, i) => {
      // Nome paziente = nome file senza estensione
      const nomePaziente = file.name.replace(/\.[^.]+$/, '');
      // Carica file su Storage mantenendo nome originale
      const storageFileName = `${batchId}/${file.name}`;
      const { error: uploadError } = await supabase.storage.from('ecg-files').upload(storageFileName, file);
      const fileUrl = uploadError ? null : storageFileName;
      return {
        origine: "azienda",
        paziente_nome: nomePaziente,
        paziente_eta: 0,
        paziente_sesso: "M",
        note: noteGenerali || "Idoneità lavorativa",
        urgenza: "normale",
        stato: "in_attesa",
        origine_dettaglio: nomeAzienda || ME_AZIENDA,
        batch_id: batchId,
        batch_nome: batchNome,
        file_ecg_url: fileUrl,
        email_destinatario: emailAccount,
      };
    }));
    const { data, error } = await supabase.from('ecgs').insert(nuovi).select();
    if (!error && data) {
      const mapped = data.map(e=>({ ...e, paziente:e.paziente_nome, azienda:ME_AZIENDA, batch:batchNome, ts:new Date(e.created_at).getTime(), cardiologo:e.cardiologo_nome||null, chat:[] }));
      setEcgs(prev=>[...prev,...mapped]);
    }
    setSent(true);
    setCaricando(false);
    fetch('/api/notify', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ paziente:`Lotto ${batchNome} — ${filesLotto.length} ECG`, origine:"azienda", urgenza:"normale", note:`Azienda: ${nomeAzienda||ME_AZIENDA} | Email referto: ${emailLotto}` }) }).catch(()=>{});
    // Email conferma ricezione — legge email_destinatario dal record inserito (identico a notify-referto)
    const emailRicezione = data?.[0]?.email_destinatario;
    if (emailRicezione) {
      fetch('/api/notify-ricezione', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email: emailRicezione, nomeAzienda: nomeAzienda||ME_AZIENDA, batchNome, count: filesLotto.length, data: new Date().toLocaleDateString('it-IT') }) }).catch(()=>{});
    }
        // Push gestito dal webhook Supabase (INSERT su ecgs) — nessuna chiamata esplicita
  };

  const scaricaBatchAzienda = async (batchId, bNome) => {
    const rows = miei.filter(e => e.batch_id===batchId && e.stato==='refertato' && e.file_referto_url);
    if (!rows.length) { alert('Nessun referto disponibile'); return; }
    setScaricandoBatch(batchId);
    try {
      const zip = new JSZip();
      await Promise.all(rows.map(async e => {
        const { data } = await supabase.storage.from('ecg-files').download(e.file_referto_url);
        if (data) zip.file(e.file_referto_url.split('/').pop(), data);
      }));
      const blob = await zip.generateAsync({ type:'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href=url; a.download=`${bNome}_referti.zip`; a.click();
      URL.revokeObjectURL(url);
    } catch(err) { alert('Errore: '+err.message); }
    setScaricandoBatch(null);
  };

  const scaricaSingoloAzienda = async (ecg) => {
    if (!ecg.file_referto_url) return;
    const { data } = await supabase.storage.from('ecg-files').download(ecg.file_referto_url);
    if (!data) { alert('File non disponibile'); return; }
    const url = URL.createObjectURL(data);
    const a = document.createElement('a'); a.href=url; a.download=ecg.file_referto_url.split('/').pop(); a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ padding:32, maxWidth:800, margin:"0 auto" }}>
      <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:28 }}>
        <div style={{ width:52, height:52, background:"linear-gradient(135deg,#f3edff,#f4f7fb)", borderRadius:16, display:"flex", alignItems:"center", justifyContent:"center", fontSize:26 }}>🏢</div>
        <div><h2 style={{ color:C.text, fontSize:24, fontWeight:700 }}>{nomeAzienda || ME_AZIENDA}</h2><div style={{ color:C.muted, fontSize:13, marginTop:2 }}>{ecgRefertatiMese.length} ECG refertati questo mese</div></div>
        <div style={{ marginLeft:"auto", background:`linear-gradient(135deg,${C.purpleLight},#eaf2ff)`, borderRadius:14, padding:"10px 18px", textAlign:"right" }}>
          <div style={{ color:C.purple, fontFamily:MONO, fontSize:22, fontWeight:"bold" }}>{ecgMese.length}</div>
          <div style={{ color:C.muted, fontSize:11 }}>ECG caricati</div>
        </div>
      </div>
      <div style={{ display:"flex", gap:6, marginBottom:24, background:C.bg, borderRadius:12, padding:4, width:"fit-content" }}>
        {tabBtn("dashboard","Dashboard")}
        {tabBtn("upload","Carica lotto")}
        {tabBtn("storico","Storico")}
      </div>

      {tab==="dashboard" && (
        <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
          <div style={{ display:"flex", gap:14, flexWrap:"wrap" }}>
            <StatCard label="ECG nel mese" value={ecgMese.length} color={C.purple} sub="caricati" icon="📋" />
            <StatCard label="Referti completati" value={ecgRefertatiMese.length} color={C.green} sub="questo mese" icon="✅" />
            <StatCard label="Referti completati" value={miei.filter(e=>e.stato==="refertato").length} color={C.accent} sub="questo mese" icon="📄" />
            <StatCard label="In attesa" value={miei.filter(e=>e.stato==="in_attesa").length} color={C.orange} icon="⏳" />
          </div>
          <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:16, padding:20, boxShadow:C.shadow }}>
            <div style={{ color:C.muted, fontSize:12, fontWeight:700, letterSpacing:1, textTransform:"uppercase", marginBottom:12 }}>Utilizzo mensile</div>
            <div style={{ background:C.bg, borderRadius:8, height:12, overflow:"hidden" }}>
              <div style={{ height:"100%", background:`linear-gradient(90deg,${C.purple},${C.accent})`, width:`${ecgMese.length>0?(ecgRefertatiMese.length/ecgMese.length)*100:0}%`, borderRadius:8, transition:"width 0.5s" }} />
            </div>
            <div style={{ display:"flex", justifyContent:"space-between", marginTop:8, fontSize:12, color:C.muted }}>
              <span>{ecgRefertatiMese.length} refertati</span><span>{ecgMese.length - ecgRefertatiMese.length} in attesa</span>
            </div>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            <div style={{ color:C.textSoft, fontWeight:700, fontSize:13, marginBottom:4 }}>Ultimi lotti</div>
            {[...new Set(miei.map(e=>e.batch))].slice(0,3).map(b=>{
              const nel = miei.filter(e=>e.batch===b);
              return (
                <div key={b} style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:14, padding:"14px 20px", display:"flex", alignItems:"center", gap:12, boxShadow:C.shadow }}>
                  <div style={{ width:40, height:40, background:C.purpleLight, borderRadius:10, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0 }}>📂</div>
                  <div style={{ flex:1 }}>
                    <div style={{ color:C.text, fontWeight:700, fontSize:14 }}>{b}</div>
                    <div style={{ color:C.muted, fontSize:12, marginTop:2 }}>{nel.length} ECG · {nel.filter(e=>e.stato==="refertato").length} refertati · {nel.filter(e=>e.stato==="in_attesa").length} in attesa</div>
                  </div>
                  <span style={{ color:C.purple, fontFamily:MONO, fontWeight:700 }}>{nel.length} ECG</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab==="upload" && (
        sent ? (
          <div style={{ background:C.white, border:`2px solid ${C.green}33`, borderRadius:20, padding:40, textAlign:"center", boxShadow:C.shadow }}>
            <div style={{ fontSize:48, marginBottom:16 }}>✅</div>
            <h3 style={{ color:C.green, fontSize:22, fontWeight:700, marginBottom:6 }}>Lotto inviato!</h3>
            <p style={{ color:C.muted, fontSize:14, marginBottom:20 }}>{filesLotto.length} ECG del lotto <strong>{batchNome}</strong> ricevuti. Refertazione entro 24 ore.</p>
            <button onClick={()=>{setSent(false);setBatchNome("");setFilesLotto([])}} style={{ background:C.purple, color:C.white, border:"none", borderRadius:10, padding:"12px 28px", cursor:"pointer", fontWeight:700, fontSize:14 }}>Carica un altro lotto →</button>
          </div>
        ) : (
          <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:20, padding:28, boxShadow:C.shadow }}>
            <h3 style={{ color:C.text, fontSize:17, fontWeight:700, marginBottom:6 }}>Nuovo lotto ECG</h3>
            <p style={{ color:C.muted, fontSize:13, marginBottom:20 }}>Carica tutti i PDF del lotto in una volta. Il nome del file diventa il nome del paziente.</p>
            <div style={{ color:C.textSoft, fontWeight:600, fontSize:13, marginBottom:6 }}>Nome lotto <span style={{color:C.red}}>*</span></div>
            <input style={{...inputStyle, marginBottom:14}} value={batchNome} onChange={e=>setBatchNome(e.target.value)} placeholder='es. SL3M-Maggio2025' />

            <div style={{ color:C.textSoft, fontWeight:600, fontSize:13, marginBottom:6 }}>Carica ECG (selezione multipla) <span style={{color:C.red}}>*</span></div>
            <div onClick={()=>document.getElementById('batch-files').click()}
              style={{border:`2px dashed ${filesLotto.length>0?C.green:C.border}`,borderRadius:12,padding:"28px 20px",textAlign:"center",cursor:"pointer",background:filesLotto.length>0?C.greenLight:"#f8faff",marginBottom:14}}>
              <input id="batch-files" type="file" accept=".pdf,.png,.jpg,.jpeg" multiple style={{display:"none"}}
                onChange={e=>{
                const files = Array.from(e.target.files||[]);
                const pdfs = files.filter(f=>f.name.toLowerCase().endsWith('.pdf'));
                const imgs = files.filter(f=>/\.(jpe?g|png)$/i.test(f.name));
                // Se ci sono PDF E immagini → probabile logo email
                if (pdfs.length>0 && imgs.length>0) {
                  setLogoWarning(imgs.map(f=>f.name));
                  setFilesLotto(pdfs); // carica solo i PDF automaticamente
                } else {
                  setLogoWarning(false);
                  setFilesLotto(files);
                }
              }} />
              {filesLotto.length>0
                ? <div style={{color:C.green,fontWeight:700}}>{filesLotto.length} file selezionati ✓<br/><span style={{fontSize:12,fontWeight:400,color:C.muted}}>{Array.from(filesLotto).map(f=>f.name).join(', ')}</span></div>
                : <><div style={{fontSize:28,marginBottom:8}}>📁</div><div style={{color:C.textSoft,fontSize:14,fontWeight:500}}>Clicca per selezionare tutti i PDF del lotto</div><div style={{color:C.muted,fontSize:12,marginTop:4}}>Selezione multipla • PDF · PNG · JPG</div></>}
            </div>
            {logoWarning && logoWarning.length>0 && (
              <div style={{background:'#fff8e1',border:'1px solid #f59e0b',borderRadius:10,padding:'12px 16px',marginBottom:12,display:'flex',alignItems:'flex-start',gap:10}}>
                <span style={{fontSize:20}}>⚠️</span>
                <div>
                  <div style={{fontWeight:700,color:'#856404',fontSize:13,marginBottom:4}}>
                    {logoWarning.length} immagine{logoWarning.length>1?'i':''} rimoss{logoWarning.length>1?'e':'a'} automaticamente
                  </div>
                  <div style={{color:'#856404',fontSize:12}}>
                    Rilevat{logoWarning.length>1?'i':'o'} file immagine insieme ai PDF: probabilmente loghi email.<br/>
                    <strong>{logoWarning.join(', ')}</strong>
                  </div>
                </div>
              </div>
            )}
            <div style={{ color:C.textSoft, fontWeight:600, fontSize:13, marginBottom:6 }}>Note (opzionale)</div>
            <textarea style={{...inputStyle, resize:"vertical", marginBottom:14}} rows={2} value={noteGenerali} onChange={e=>setNoteGenerali(e.target.value)} placeholder="Es. idoneità annuale, visita periodica..." />
            <button onClick={inviaLotto} disabled={caricando} style={btnPrimary(!!(batchNome&&filesLotto.length>0&&!caricando))}>
              Invia lotto ({filesLotto.length} ECG) →
            </button>
          </div>
        )
      )}

      {tab==="storico" && (() => {
        const batches={}, singoli=[];
        [...miei].sort((a,b)=>b.ts-a.ts).forEach(e=>{
          if(e.batch_id){ if(!batches[e.batch_id]) batches[e.batch_id]={nome:e.batch_nome||e.batch_id,ecgs:[],ts:e.ts}; batches[e.batch_id].ecgs.push(e); }
          else singoli.push(e);
        });
        return (
          <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
            {miei.length===0 && <div style={{textAlign:"center",padding:40,color:C.muted}}>Nessun ECG ancora caricato</div>}
            {Object.entries(batches).sort((a,b)=>b[1].ts-a[1].ts).map(([bId,batch])=>{
              const refertati=batch.ecgs.filter(e=>e.stato==='refertato');
              const conFile=refertati.filter(e=>e.file_referto_url);
              const completo=refertati.length===batch.ecgs.length;
              return (
                <div key={bId} style={{background:C.white,border:`2px solid ${completo?C.green:C.border}`,borderRadius:16,boxShadow:C.shadow,overflow:'hidden'}}>
                  <div style={{background:completo?C.greenLight:C.cardAlt,padding:'12px 18px',display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:8}}>
                    <div>
                      <div style={{fontWeight:700,fontSize:15,color:C.text}}>📦 {batch.nome}</div>
                      <div style={{color:C.muted,fontSize:12,marginTop:2}}>{refertati.length}/{batch.ecgs.length} referti · {new Date(batch.ts).toLocaleDateString('it-IT')}</div>
                    </div>
                    <div style={{display:'flex',gap:8,alignItems:'center'}}>
                      <div style={{background:C.border,borderRadius:20,height:6,width:70}}>
                        <div style={{height:'100%',width:`${(refertati.length/batch.ecgs.length)*100}%`,background:completo?C.green:C.accent,borderRadius:20}}/>
                      </div>
                      {conFile.length>0
                        ? <button onClick={()=>scaricaBatchAzienda(bId,batch.nome)} disabled={scaricandoBatch===bId}
                            style={{background:scaricandoBatch===bId?C.border:C.accent,color:'white',border:'none',borderRadius:10,padding:'7px 14px',cursor:scaricandoBatch===bId?'not-allowed':'pointer',fontWeight:700,fontSize:13}}>
                            {scaricandoBatch===bId?'⏳':'⬇️ ZIP'} ({conFile.length})
                          </button>
                        : refertati.length>0 && <div style={{color:C.muted,fontSize:12}}>⚠️ File scaduti</div>
                      }
                    </div>
                  </div>
                  <div style={{padding:'6px 10px',display:'flex',flexDirection:'column',gap:4}}>
                    {batch.ecgs.map(e=>(
                      <div key={e.id} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 10px',borderRadius:10,background:e.stato==='refertato'?'#f8fffe':'#fffbf5',border:`1px solid ${e.stato==='refertato'?C.green+'33':C.border}`}}>
                        <div style={{flex:1}}>
                          <div style={{fontSize:14,fontWeight:600,color:C.text}}>{e.paziente_nome||e.paziente}</div>
                          <div style={{fontSize:11,color:C.muted,marginTop:1}}>{fmt(e.ts)}</div>
                        </div>
                        <Badge stato={e.stato} urgenza={e.urgenza}/>
                        {e.stato==='refertato' && e.file_referto_url && <button onClick={()=>scaricaSingoloAzienda(e)} style={{background:C.greenLight,color:C.green,border:`1px solid ${C.green}33`,borderRadius:8,padding:'5px 10px',cursor:'pointer',fontWeight:700,fontSize:12}}>📄 PDF</button>}
                        {e.stato==='refertato' && !e.file_referto_url && <div style={{color:C.muted,fontSize:11,fontStyle:'italic'}}>⚠️ Scaduto</div>}
                        {e.stato==='in_attesa' && !e.cardiologo && <div style={{background:C.yellowLight,color:C.yellow,borderRadius:8,padding:'5px 10px',fontSize:11,fontWeight:600}}>⏳ In coda</div>}
                        {e.stato==='in_attesa' && e.cardiologo && <div style={{background:C.purpleLight,color:C.purple,borderRadius:8,padding:'5px 10px',fontSize:11,fontWeight:600}}>🫀 In refertazione</div>}
                        <SLATimer ecg={e} compact/>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
            {singoli.length>0 && (
              <div>
                <div style={{fontSize:12,fontWeight:600,color:C.muted,marginBottom:8,paddingLeft:4}}>ECG singoli</div>
                {singoli.map(e=>(
                  <div key={e.id} style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:14,padding:'12px 18px',boxShadow:C.shadow,display:'flex',alignItems:'center',gap:12,flexWrap:'wrap',marginBottom:8}}>
                    <div style={{flex:1}}>
                      <Badge stato={e.stato} urgenza={e.urgenza}/>
                      <div style={{color:C.text,fontSize:14,fontWeight:600,marginTop:4}}>{e.paziente_nome||e.paziente}</div>
                      <div style={{color:C.muted,fontSize:12,marginTop:2}}>{fmt(e.ts)}</div>
                    </div>
                    {e.stato==='refertato' && e.file_referto_url && <button onClick={()=>scaricaSingoloAzienda(e)} style={{background:C.greenLight,color:C.green,border:`1px solid ${C.green}33`,borderRadius:10,padding:'8px 14px',cursor:'pointer',fontWeight:700,fontSize:13}}>📄 PDF</button>}
                    {e.stato==='refertato' && !e.file_referto_url && <div style={{color:C.muted,fontSize:12}}>⚠️ File scaduto</div>}
                    {e.stato==='in_attesa' && !e.cardiologo && <div style={{background:C.yellowLight,color:C.yellow,borderRadius:10,padding:'8px 14px',fontSize:12,fontWeight:600}}>⏳ In coda</div>}
                    {e.stato==='in_attesa' && e.cardiologo && <div style={{background:C.purpleLight,color:C.purple,borderRadius:10,padding:'8px 14px',fontSize:12,fontWeight:600}}>🫀 In refertazione</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
};

// ── CARDIOLOGO ────────────────────────────────────────────────────────────
// Vede SOLO gli ECG che l'admin gli ha assegnato esplicitamente.

// ── REFERTAZIONE INLINE ───────────────────────────────────────────────────
const RefertazioneInline = ({ ecg, meCardiologo, onRefertato, firmaUrl }) => {
  const [ecgFile, setEcgFile] = useState(null);
  const [ecgUrl, setEcgUrl] = useState(null);
  const [ecgType, setEcgType] = useState(null);
  const [crocette, setCrocette] = useState({ limiti:false, correlare:false, approfondire:false, visita:false, urgente:false });
  const [commento, setCommento] = useState("");
  const [posizione, setPosizione] = useState("top-right");
  const [generating, setGenerating] = useState(false);
  const [generato, setGenerato] = useState(false);
  const [pdfBlob, setPdfBlob] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [numPages, setNumPages] = useState(1);
  const [confirming, setConfirming] = useState(false);
  const canvasRef = useRef(null);
  const previewCanvasRef = useRef(null);
  const [previewDataUrl, setPreviewDataUrl] = useState(null);
  const fileId = useRef("rf-"+Math.random().toString(36).slice(2,7)).current;

  const handleFile = async (f) => {
    setEcgFile(f);
    const url = URL.createObjectURL(f);
    setEcgUrl(url);
    const tipo = f.type === "application/pdf" ? "pdf" : "image";
    setEcgType(tipo);
    setGenerato(false);
    if (tipo === 'pdf') {
      try {
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;
        const ab = await f.arrayBuffer();
        const pdfDoc = await pdfjsLib.getDocument({ data: ab }).promise;
        if (!cancelled) setNumPages(pdfDoc.numPages);
        const page = await pdfDoc.getPage(1);
        const vp = page.getViewport({ scale: 1.2 });
        const cv = document.createElement('canvas');
        cv.width = vp.width; cv.height = vp.height;
        const ctx2 = cv.getContext('2d');
        ctx2.fillStyle = '#fff'; ctx2.fillRect(0,0,cv.width,cv.height);
        await page.render({ canvasContext: ctx2, viewport: vp }).promise;
        setPreviewDataUrl(cv.toDataURL('image/jpeg', 0.85));
      } catch(e) { setPreviewDataUrl(url); }
    } else {
      setPreviewDataUrl(url);
    }
  };

  // Carica automaticamente il file da Supabase Storage se disponibile
  useEffect(() => {
    let cancelled = false;
    
    // Reset immediato quando cambia l'ECG
    setEcgFile(null);
    setEcgUrl(null);
    setEcgType(null);
    setPreviewDataUrl(null);
    setRotation(0);
    setNumPages(1);
    setGenerato(false);
    setPdfBlob(null);
    setCrocette({ limiti:false, correlare:false, approfondire:false, visita:false, urgente:false });
    setCommento("");
    
    if (!ecg?.file_ecg_url) return;
    
    console.log('[Storage] Caricando:', ecg.file_ecg_url);
    supabase.storage.from('ecg-files').download(ecg.file_ecg_url)
      .then(({ data, error }) => {
        if (cancelled) { console.log('[Storage] Annullato:', ecg.file_ecg_url); return; }
        if (error || !data) { console.error('[Storage] Errore:', error); return; }
        const ext = ecg.file_ecg_url.split('.').pop().toLowerCase();
        const mimeType = ext === 'pdf' ? 'application/pdf' : `image/${ext}`;
        const file = new File([data], ecg.file_ecg_url, { type: mimeType });
        const url = URL.createObjectURL(data);
        console.log('[Storage] File caricato:', file.name);
        setEcgFile(file);
        setEcgUrl(url);
        const tipo = mimeType === 'application/pdf' ? 'pdf' : 'image';
        setEcgType(tipo);
        // Per PDF: renderizza su canvas per anteprima pulita
        if (tipo === 'pdf') {
          (async () => {
            try {
              const pdfjsLib = await import("pdfjs-dist");
              pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;
              const ab = await data.arrayBuffer();
              const pdfDoc = await pdfjsLib.getDocument({ data: ab }).promise;
              const page = await pdfDoc.getPage(1);
              const vp = page.getViewport({ scale: 1.2 });
              const cv = document.createElement('canvas');
              cv.width = vp.width; cv.height = vp.height;
              const ctx2 = cv.getContext('2d');
              ctx2.fillStyle = '#fff'; ctx2.fillRect(0,0,cv.width,cv.height);
              await page.render({ canvasContext: ctx2, viewport: vp }).promise;
              if (!cancelled) setPreviewDataUrl(cv.toDataURL('image/jpeg', 0.85));
            } catch(e) { console.error('Preview PDF error:', e); }
          })();
        } else {
          if (!cancelled) setPreviewDataUrl(url);
        }
      })
      .catch(e => { if (!cancelled) console.error('[Storage] Errore:', e); });
    
    return () => { cancelled = true; };
  }, [ecg?.id, ecg?.file_ecg_url]);

  const almenoCrocetta = crocette.limiti || crocette.correlare || crocette.approfondire || crocette.visita || crocette.urgente;

  const disegnaOverlay = useCallback((ctx, W, H) => {
    // Riquadro posizionato tra anamnesi e tracciato ECG
    // Lascia visibili in alto: nome, sesso, altezza, peso, farmaci, anamnesi
    const rX = Math.round(W * 0.21);
    const rY = Math.round(H * 0.082);
    const rW = Math.round(W * 0.78);
    const rH = Math.round(H * 0.142); // ridotto per non toccare tracciato ECG

    // Sfondo bianco
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(rX, rY, rW, rH);

    // Bordo esterno marcato
    ctx.strokeStyle = "#1a2640";
    ctx.lineWidth = 2;
    ctx.strokeRect(rX, rY, rW, rH);

    // Layout: 3 zone verticali
    // - Header (10% altezza): titolo
    // - Crocette (50% altezza): 5 crocette in 3+2 colonne
    // - Commento + Firma + Logo (40% altezza)

    const headerH = Math.round(rH * 0.18);
    const crocetteH = Math.round(rH * 0.42);
    const bottomH = rH - headerH - crocetteH;

    const pad = Math.round(rH * 0.06);
    const fsTitle = Math.round(rH * 0.14);
    const fsCr = Math.round(rH * 0.066) + 3;
    const boxSz = Math.round(fsCr * 1.1);
    const fsCommento = Math.round(rH * 0.092);
    const fsFirma = Math.round(rH * 0.110);
    const fsStamp = Math.round(fsFirma * 0.62);
    const firmaColX = rX + Math.round(rW * 0.72);
    const firmaColW = rW - Math.round(rW * 0.72) - Math.round(rW * 0.015);

    // ── HEADER ──
    ctx.fillStyle = "#1a2640";
    ctx.font = `bold ${fsTitle}px Arial`;
    ctx.fillText("REFERTO ECG", rX + pad, rY + headerH * 0.78);

    // Linea sotto titolo
    ctx.strokeStyle = "#1a2640";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(rX + pad, rY + headerH);
    ctx.lineTo(rX + rW - pad, rY + headerH);
    ctx.stroke();

    // ── CROCETTE ──
    const voci = [
      [crocette.limiti,       "nei limiti della norma"],
      [crocette.correlare,    "da correlare con la clinica"],
      [crocette.approfondire, "da approfondire con Medico Curante"],
      [crocette.visita,       "da approfondire con visita cardiologica"],
      [crocette.urgente,      "Se nuova sintomatologia: visita cardiologica urgente / accesso in PS"],
    ];

    const crocetteY = rY + headerH;
    const crocColW = (Math.round(rW * 0.70) - pad * 2) / 3;
    const rowH = Math.round(crocetteH / 2);

    voci.forEach(([checked, label], i) => {
      const col = i < 3 ? i : i - 3;
      const row = i < 3 ? 0 : 1;
      const cx = rX + pad + col * crocColW;
      const cy = crocetteY + row * rowH + rowH * 0.65;

      // Box
      if (checked) {
        ctx.fillStyle = "#1aaa6e";
        ctx.fillRect(cx, cy - boxSz + 2, boxSz, boxSz);
        ctx.fillStyle = "#ffffff";
        ctx.font = `bold ${Math.round(boxSz * 1.35)}px Arial`;
        ctx.fillText("✓", cx, cy + 2);
      } else {
        ctx.strokeStyle = "#1a2640";
        ctx.lineWidth = 1.2;
        ctx.strokeRect(cx, cy - boxSz + 2, boxSz, boxSz);
      }
      // Label
      ctx.fillStyle = "#1a2640";
      ctx.font = `${fsCr}px Arial`;
      const maxLabelW = i === 4 ? crocColW * 2 - boxSz - 12 : crocColW - boxSz - 12;
      const words = label.split(" ");
      let line = "";
      let labelY = cy;
      const lines = [];
      words.forEach(word => {
        const test = line + word + " ";
        if (ctx.measureText(test).width > maxLabelW && line) {
          lines.push(line.trim());
          line = word + " ";
        } else line = test;
      });
      if (line.trim()) lines.push(line.trim());
      // Se più di una riga, sposta su per centrare
      if (lines.length > 1) labelY -= (lines.length - 1) * fsCr * 0.6;
      lines.forEach((ln, idx) => {
        ctx.fillText(ln, cx + boxSz + 8, labelY + idx * fsCr * 1.15);
      });
    });

    // Firma scannerizzata nella colonna destra (zona crocette)
    const nomeFirmaBase = meCardiologo.replace(/^Dott\.\s*Dr\.?/i, "").replace(/^Dr\.?\s*/i, "").replace(/^Dott\.?\s*/i, "").trim();
    const nomeFirma = "Dott. " + nomeFirmaBase;
    if (window.__millefonti_firma) {
      const img = window.__millefonti_firma;
      const maxW = firmaColW * 0.92, maxH = crocetteH - pad * 2;
      const ratio = img.width / img.height;
      const drawW = Math.min(maxW, maxH * ratio), drawH = drawW / ratio;
      ctx.drawImage(img, firmaColX + (firmaColW - drawW) / 2, crocetteY + (crocetteH - drawH) / 2, drawW, drawH);
    }
    // ── SEPARATORE ──
    const sepY = crocetteY + crocetteH;
    ctx.strokeStyle = "#cccccc"; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(rX + pad, sepY); ctx.lineTo(rX + rW - pad, sepY); ctx.stroke();
    // ── COMMENTO (sinistra bottom) ──
    if (commento.trim()) {
      ctx.fillStyle = "#1a2640"; ctx.font = `${fsCommento}px Arial`;
      const commentoMaxW = Math.round(rW * 0.63);
      const words = commento.split(" "); let line = ""; const linesC = [];
      words.forEach(word => {
        const test = line + word + " ";
        if (ctx.measureText(test).width > commentoMaxW && line) { linesC.push(line.trim()); line = word + " "; }
        else line = test;
      });
      if (line.trim()) linesC.push(line.trim());
      linesC.slice(0, 3).forEach((ln, idx) =>
        ctx.fillText(ln, rX + pad, sepY + fsCommento * 1.1 + idx * fsCommento * 1.2));
    }

    // ── FIRMA TESTO (basso destra, agganciata al fondo) ──
    const bPad     = Math.round(rH * 0.05);
    const lineDate = rY + rH - bPad;
    const lineVia  = lineDate - Math.round(fsStamp * 1.35);
    const lineAmb  = lineVia  - Math.round(fsStamp * 1.35);
    const lineNome = lineAmb  - fsFirma - Math.round(fsStamp * 0.5);
    const lineSepF = lineNome + Math.round(fsFirma * 0.4);
    ctx.fillStyle = "#1a2640"; ctx.font = `bold ${fsFirma}px Arial`;
    ctx.fillText(nomeFirma, firmaColX, lineNome);
    ctx.strokeStyle = "#1a2640"; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(firmaColX, lineSepF); ctx.lineTo(firmaColX + firmaColW * 0.95, lineSepF); ctx.stroke();
    ctx.fillStyle = "#1a2640"; ctx.font = `${fsStamp}px Arial`;
    ctx.fillText("Ambulatorio Millefonti", firmaColX, lineAmb);
    ctx.fillText("Via Garessio 47 - Torino", firmaColX, lineVia);
    ctx.fillStyle = "#6b7d99"; ctx.font = `${Math.round(fsFirma * 0.72)}px Arial`;
    ctx.fillText(new Date().toLocaleDateString("it-IT"), firmaColX, lineDate);

    // ── LOGO preload ──
    if (!window.__millefonti_logo || !window.__millefonti_logo.complete) {
      const logoImg = new Image();
      logoImg.crossOrigin = 'anonymous';
      logoImg.src = 'https://weearnnmglyjufhpycju.supabase.co/storage/v1/object/public/assets/logo%20definitivo.png';
      window.__millefonti_logo = logoImg;
    }

  }, [crocette, commento, posizione, meCardiologo]);

  const generaPDF = async () => {
    if (!ecgFile || !almenoCrocetta) return;
    setGenerating(true);
    // Precarica firma se disponibile
    if (firmaUrl) {
      try {
        const { data: firmaData } = await supabase.storage.from('ecg-files').createSignedUrl(firmaUrl, 3600);
        if (firmaData?.signedUrl) {
          await new Promise((res) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => { window.__millefonti_firma = img; res(); };
            img.onerror = () => res();
            img.src = firmaData.signedUrl;
          });
        }
      } catch(e) { window.__millefonti_firma = null; }
    } else {
      window.__millefonti_firma = null;
    }
    // Pre-carica il logo nel cache globale per essere sicuri che sia disponibile per il canvas
    await new Promise((resolve) => {
      if (window.__millefonti_logo && window.__millefonti_logo.complete) {
        resolve();
        return;
      }
      const preloadLogo = new Image();
      preloadLogo.crossOrigin = 'anonymous';
      preloadLogo.onload = () => {
        window.__millefonti_logo = preloadLogo;
        resolve();
      };
      preloadLogo.onerror = () => resolve();
      preloadLogo.src = 'https://weearnnmglyjufhpycju.supabase.co/storage/v1/object/public/assets/logo%20definitivo.png';
      setTimeout(resolve, 3000);
    });
    try {
      const { jsPDF } = await import("jspdf");

      // Helper: genera pagina referto
      const aggiungiPaginaReferto = (pdf, W, H, isLandscape) => {
        pdf.setFillColor(255,255,255);
        pdf.rect(0,0,W,H,"F");
        // Header blu
        pdf.setFillColor(46,124,246);
        pdf.rect(0,0,W,18,"F");
        pdf.setFontSize(11);
        pdf.setTextColor(255,255,255);
        pdf.setFont("helvetica","bold");
        pdf.text("AMBULATORIO MILLEFONTI — REFERTO CARDIOLOGICO", 10, 12);
        // Dati paziente
        pdf.setFontSize(10);
        pdf.setTextColor(26,38,64);
        pdf.setFont("helvetica","normal");
        pdf.text(`Paziente: ${ecg.paziente}`, 10, 28);
        pdf.text(`Data: ${new Date().toLocaleDateString("it-IT")}`, 10, 36);
        pdf.text(`Cardiologo: Dott. ${meCardiologo}`, 10, 44);
        // Linea separatore
        pdf.setDrawColor(200,210,220);
        pdf.setLineWidth(0.3);
        pdf.line(10, 48, W-10, 48);
        // Crocette
        pdf.setFontSize(11);
        pdf.setTextColor(26,38,64);
        let yy = 58;
        const voci = [
          [crocette.limiti,       "ECG nei limiti della norma"],
          [crocette.correlare,    "ECG da correlare con la clinica"],
          [crocette.approfondire, "ECG da approfondire con Medico Curante"],
          [crocette.visita,       "ECG da approfondire con visita cardiologica"],
          [crocette.urgente,      "Se nuova sintomatologia: visita cardiologica urgente / accesso in PS"],
        ];
        voci.forEach(([checked, label]) => {
          pdf.setDrawColor(26,38,64);
          pdf.setLineWidth(0.5);
          pdf.rect(10, yy-4, 5, 5);
          if (checked) {
            pdf.setFont("helvetica","bold");
            pdf.setTextColor(26,124,110);
            pdf.text("✓", 11, yy);
            pdf.setTextColor(26,38,64);
          }
          pdf.setFont("helvetica","normal");
          pdf.text(label, 19, yy);
          yy += 11;
        });
        // Commento
        if (commento.trim()) {
          yy += 4;
          pdf.setDrawColor(200,210,220);
          pdf.line(10, yy-4, W-10, yy-4);
          pdf.setFontSize(10);
          pdf.setTextColor(60,80,100);
          pdf.setFont("helvetica","italic");
          const lines = pdf.splitTextToSize(commento, W-20);
          pdf.text(lines, 10, yy+4);
        }
        // Footer con firma e logo
        const footerY = H - 22;
        pdf.setDrawColor(200,210,220);
        pdf.setLineWidth(0.3);
        pdf.line(10, footerY, W-10, footerY);
        pdf.setFont("helvetica","bold");
        pdf.setFontSize(10);
        pdf.setTextColor(26,38,64);
        pdf.text(`Dott. ${meCardiologo}`, 10, footerY+8);
        pdf.setFont("helvetica","normal");
        pdf.setFontSize(8);
        pdf.setTextColor(100,120,140);
        pdf.text(new Date().toLocaleDateString("it-IT"), 10, footerY+14);
        return pdf;
      };

      if (ecgType === "image") {
        const img = new Image();
        img.src = ecgUrl;
        await new Promise(r => { img.onload = r; });
        const W = img.naturalWidth;
        const H = img.naturalHeight;
        const isLandscape = W > H;

        if (posizione === "pagina-separata") {
          // PAGINA SEPARATA: genera una pagina referto pulita + pagina ECG
          const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: [297, 210] });
          const pw = 297; const ph = 210;

          // ── PAGINA 1: REFERTO PULITO ──
          pdf.setFillColor(255,255,255); pdf.rect(0,0,pw,ph,'F');

          // Top: logo + intestazione
          const logoSz = 28;
          if (window.__millefonti_logo && window.__millefonti_logo.complete) {
            const lCvs = document.createElement('canvas');
            lCvs.width = window.__millefonti_logo.naturalWidth;
            lCvs.height = window.__millefonti_logo.naturalHeight;
            lCvs.getContext('2d').drawImage(window.__millefonti_logo, 0, 0);
            pdf.addImage(lCvs.toDataURL('image/png'), 'PNG', 8, 4, logoSz, logoSz);
          }
          pdf.setTextColor(37,87,54); pdf.setFontSize(16); pdf.setFont('helvetica','bold');
          pdf.text('AMBULATORIO MILLEFONTI', 40, 14);
          pdf.setFontSize(9); pdf.setFont('helvetica','normal'); pdf.setTextColor(107,125,153);
          pdf.text('Via Garessio 47 — Torino', 40, 21);
          pdf.setTextColor(107,125,153); pdf.setFontSize(9);
          pdf.text(new Date().toLocaleDateString('it-IT'), pw-10, 14, {align:'right'});

          // Linea verde sotto intestazione
          pdf.setFillColor(37,87,54); pdf.rect(0, 36, pw, 1.5, 'F');

          // Paziente
          pdf.setFontSize(11); pdf.setFont('helvetica','bold'); pdf.setTextColor(37,87,54);
          pdf.text('PAZIENTE:', 10, 47);
          pdf.setFont('helvetica','normal'); pdf.setTextColor(30,30,30);
          pdf.text(ecg.paziente_nome || ecg.paziente || '—', 40, 47);

          // Linea grigia
          pdf.setDrawColor(220,229,240); pdf.setLineWidth(0.4);
          pdf.line(10, 52, pw-10, 52);

          // Titolo referto
          pdf.setFontSize(16); pdf.setFont('helvetica','bold'); pdf.setTextColor(37,87,54);
          pdf.text('REFERTO ECG', 10, 62);

          // Crocette
          const voci = [
            [crocette.limiti, "ECG nei limiti della norma"],
            [crocette.correlare, "ECG da correlare con la clinica"],
            [crocette.approfondire, "ECG da approfondire con Medico Curante"],
            [crocette.visita, "ECG da approfondire con visita cardiologica"],
            [crocette.urgente, "Se nuova sintomatologia: visita cardiologica urgente / accesso in PS"],
          ];
          let cy = 72;
          voci.forEach(([checked, label]) => {
            if (checked) {
              pdf.setFillColor(26, 170, 110);
              pdf.setTextColor(255, 255, 255);
              pdf.setFontSize(9);
              pdf.setFont("helvetica", "bold");
              pdf.rect(10, cy - 5, 4, 4, "F");
              pdf.text("✓", 10.5, cy - 2);
            } else {
              pdf.setDrawColor(200, 200, 200);
              pdf.setLineWidth(0.4);
              pdf.rect(10, cy - 5, 4, 4);
            }
            pdf.setTextColor(checked ? 26 : 107, checked ? 38 : 125, checked ? 64 : 153);
            pdf.setFontSize(11);
            pdf.setFont("helvetica", checked ? "bold" : "normal");
            pdf.text(label, 17, cy - 1);
            cy += 10;
          });

          // Commento
          if (commento.trim()) {
            cy += 4;
            pdf.setDrawColor(220, 229, 240);
            pdf.setLineWidth(0.5);
            pdf.line(10, cy, pw - 10, cy);
            cy += 8;
            pdf.setFontSize(10);
            pdf.setFont("helvetica", "bold");
            pdf.setTextColor(107, 125, 153);
            pdf.text("DESCRIZIONE", 10, cy);
            cy += 7;
            pdf.setFont("helvetica", "normal");
            pdf.setTextColor(37, 87, 54);
            pdf.setFontSize(11);
            const lines = pdf.splitTextToSize(commento, pw - 20);
            pdf.text(lines, 10, cy);
          }

          // Firma con timbro
          const nomeFirmaBase = meCardiologo.replace(/^Dott\.\s*Dr\.?/i,"").replace(/^Dr\.?\s*/i,"").replace(/^Dott\.?\s*/i,"").trim();
          const nomeFirma = "Dott. " + nomeFirmaBase;
          if (window.__millefonti_firma) {
            const fImg = window.__millefonti_firma;
            const fCvs = document.createElement("canvas");
            fCvs.width = fImg.width; fCvs.height = fImg.height;
            fCvs.getContext("2d").drawImage(fImg, 0, 0);
            const fW = 35, fH = fW / (fImg.width / fImg.height);
            pdf.addImage(fCvs.toDataURL("image/png"), "PNG", pw - 10 - fW, ph - 38 - fH, fW, fH);
          }
          pdf.setFontSize(13); pdf.setFont("helvetica", "bold"); pdf.setTextColor(37, 87, 54);
          pdf.text(nomeFirma, pw - 10, ph - 36, { align: "right" });
          pdf.setDrawColor(26, 38, 64); pdf.setLineWidth(0.3);
          pdf.line(pw - 65, ph - 33, pw - 10, ph - 33);
          pdf.setFontSize(8); pdf.setFont("helvetica", "normal"); pdf.setTextColor(37, 87, 54);
          pdf.text("Ambulatorio Millefonti", pw - 10, ph - 28, { align: "right" });
          pdf.text("Via Garessio 47 - Torino", pw - 10, ph - 23, { align: "right" });
          pdf.setTextColor(107, 125, 153);
          pdf.text(new Date().toLocaleDateString("it-IT"), pw - 10, ph - 17, { align: "right" });

                    // Footer
          pdf.setFillColor(37, 87, 54);
          pdf.rect(0, ph - 8, pw, 8, "F");
          pdf.setTextColor(255, 255, 255);
          pdf.setFontSize(8);
          pdf.text("Ambulatorio Millefonti — ambulatoriomillefonti.it", pw / 2, ph - 3, { align: "center" });

          // ── PAGINA 2: ECG ORIGINALE ──
          pdf.addPage(isLandscape ? "landscape" : "portrait");
          const p2w = isLandscape ? 297 : 210;
          const p2h = isLandscape ? 210 : 297;
          const ratio = W / H;
          let drawW = p2w; let drawH = drawW / ratio;
          if (drawH > p2h) { drawH = p2h; drawW = drawH * ratio; }
          const dx = (p2w - drawW) / 2;
          const dy = (p2h - drawH) / 2;
          const imgData = (() => { const c = document.createElement("canvas"); c.width = W; c.height = H; c.getContext("2d").drawImage(img, 0, 0); return c.toDataURL("image/jpeg", 0.78); })();
          pdf.addImage(imgData, "JPEG", dx, dy, drawW, drawH);

          if (ecg.batch_id) {
            setPdfBlob(pdf.output("blob"));
          } else {
            pdf.save(`Referto_${ecg.paziente.replace(/[^a-zA-Z]/g,"_")}_${new Date().toISOString().slice(0,10)}.pdf`);
          }

        } else {
          // Overlay sull'immagine (top-right o bottom-right)
          const canvas = document.createElement("canvas");
          canvas.width = W; canvas.height = H;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0);
          disegnaOverlay(ctx, W, H);
          const ratio = W / H;
          const pdfW = isLandscape ? 297 : 210;
          const pdfH = isLandscape ? pdfW / ratio : pdfW * ratio;
          const pdf = new jsPDF({ orientation: isLandscape?"landscape":"portrait", unit:"mm", format:[pdfW, Math.min(pdfH, 420)] });
          const dataUrl = canvas.toDataURL("image/jpeg", 0.78);
          pdf.addImage(dataUrl, "JPEG", 0, 0, pdfW, Math.min(pdfH, 420));
          if (ecg.batch_id) {
            setPdfBlob(pdf.output("blob"));
          } else {
            pdf.save(`Referto_${ecg.paziente.replace(/[^a-zA-Z]/g,"_")}_${new Date().toISOString().slice(0,10)}.pdf`);
          }
        }

      } else {
        // PDF: converti la prima pagina in immagine, applica overlay, salva come PDF singolo
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;
        const arrayBuffer = await ecgFile.arrayBuffer();
        const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const page = await pdfDoc.getPage(1);
        const viewport = page.getViewport({ scale: 2.0 });
        const cvs = document.createElement("canvas");
        cvs.width = viewport.width; cvs.height = viewport.height;
        const ctx = cvs.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, cvs.width, cvs.height);
        await page.render({ canvasContext: ctx, viewport }).promise;
        // Applica rotazione utente (↺↻) PRIMA di disegnare l'overlay
        let finalCvs = cvs;
        if (rotation !== 0) {
          const rad = (rotation * Math.PI) / 180;
          const rotCvs = document.createElement("canvas");
          if (rotation === 90 || rotation === 270) {
            rotCvs.width = cvs.height; rotCvs.height = cvs.width;
          } else {
            rotCvs.width = cvs.width; rotCvs.height = cvs.height;
          }
          const rCtx = rotCvs.getContext("2d");
          rCtx.translate(rotCvs.width/2, rotCvs.height/2);
          rCtx.rotate(rad);
          rCtx.drawImage(cvs, -cvs.width/2, -cvs.height/2);
          rCtx.setTransform(1, 0, 0, 1, 0, 0); // reset transform: overlay non eredita la rotazione
          finalCvs = rotCvs;
        }
        // Disegna overlay sul canvas (già ruotato se necessario)
        if (posizione !== "pagina-separata") {
          disegnaOverlay(finalCvs.getContext("2d"), finalCvs.width, finalCvs.height);
        }
        const ratio = finalCvs.width / finalCvs.height;
        const isLandscape2 = ratio > 1;
        const pdfW = isLandscape2 ? 297 : 210;
        const pdfH = pdfW / ratio;
        const finalPdf = new jsPDF({ orientation: isLandscape2?"landscape":"portrait", unit:"mm", format:[pdfW, pdfH] });
        const imgData = finalCvs.toDataURL("image/jpeg", 0.78);
        finalPdf.addImage(imgData, "JPEG", 0, 0, pdfW, pdfH);
        if (posizione === "pagina-separata") {
          const refertoPdf = new jsPDF({ orientation: "landscape", unit: "mm", format: [297, 210] });
          const pw = 297; const ph = 210;
          refertoPdf.setFillColor(255,255,255); refertoPdf.rect(0,0,pw,ph,'F');
          if (window.__millefonti_logo && window.__millefonti_logo.complete) {
            const lCvsR=document.createElement('canvas'); lCvsR.width=window.__millefonti_logo.naturalWidth; lCvsR.height=window.__millefonti_logo.naturalHeight;
            lCvsR.getContext('2d').drawImage(window.__millefonti_logo,0,0);
            refertoPdf.addImage(lCvsR.toDataURL('image/png'),'PNG',8,4,28,28);
          }
          refertoPdf.setTextColor(37,87,54); refertoPdf.setFontSize(16); refertoPdf.setFont('helvetica','bold');
          refertoPdf.text('AMBULATORIO MILLEFONTI',40,14);
          refertoPdf.setFontSize(9); refertoPdf.setFont('helvetica','normal'); refertoPdf.setTextColor(107,125,153);
          refertoPdf.text('Via Garessio 47 — Torino',40,21);
          refertoPdf.text(new Date().toLocaleDateString('it-IT'),pw-10,14,{align:'right'});
          refertoPdf.setFillColor(37,87,54); refertoPdf.rect(0,36,pw,1.5,'F');
          refertoPdf.setFontSize(11); refertoPdf.setFont('helvetica','bold'); refertoPdf.setTextColor(37,87,54);
          refertoPdf.text('PAZIENTE:',10,47);
          refertoPdf.setFont('helvetica','normal'); refertoPdf.setTextColor(30,30,30);
          refertoPdf.text(ecg.paziente_nome||ecg.paziente||'—',40,47);
          refertoPdf.setDrawColor(220,229,240); refertoPdf.setLineWidth(0.4); refertoPdf.line(10,52,pw-10,52);
          refertoPdf.setFontSize(16); refertoPdf.setFont('helvetica','bold'); refertoPdf.setTextColor(37,87,54);
          refertoPdf.text('REFERTO ECG',10,62);
          const voci2=[[crocette.limiti,"ECG nei limiti della norma"],[crocette.correlare,"ECG da correlare con la clinica"],[crocette.approfondire,"ECG da approfondire con Medico Curante"],[crocette.visita,"ECG da approfondire con visita cardiologica"],[crocette.urgente,"Se nuova sintomatologia: visita cardiologica urgente / accesso in PS"]];
          let cy2=72;
          voci2.forEach(([checked,label])=>{
            if(checked){refertoPdf.setFillColor(26,170,110);refertoPdf.setTextColor(255,255,255);refertoPdf.setFontSize(9);refertoPdf.setFont('helvetica','bold');refertoPdf.rect(10,cy2-5,4,4,'F');refertoPdf.text('✓',10.5,cy2-2);}
            else{refertoPdf.setDrawColor(200,200,200);refertoPdf.setLineWidth(0.4);refertoPdf.rect(10,cy2-5,4,4);}
            refertoPdf.setTextColor(checked?26:107,checked?38:125,checked?64:153);
            refertoPdf.setFontSize(11);refertoPdf.setFont('helvetica',checked?'bold':'normal');refertoPdf.text(label,17,cy2-1);cy2+=10;
          });
          if(commento.trim()){cy2+=4;refertoPdf.setDrawColor(220,229,240);refertoPdf.setLineWidth(0.5);refertoPdf.line(10,cy2,pw-10,cy2);cy2+=8;refertoPdf.setFontSize(10);refertoPdf.setFont('helvetica','bold');refertoPdf.setTextColor(107,125,153);refertoPdf.text('DESCRIZIONE',10,cy2);cy2+=7;refertoPdf.setFont('helvetica','normal');refertoPdf.setTextColor(37,87,54);refertoPdf.setFontSize(11);refertoPdf.text(refertoPdf.splitTextToSize(commento,pw-20),10,cy2);}
          const nb2=meCardiologo.replace(/^Dott\.\s*Dr\.?/i,'').replace(/^Dr\.?\s*/i,'').replace(/^Dott\.?\s*/i,'').trim();
          if(window.__millefonti_firma){const fCR=document.createElement('canvas');fCR.width=window.__millefonti_firma.width;fCR.height=window.__millefonti_firma.height;fCR.getContext('2d').drawImage(window.__millefonti_firma,0,0);const fW2=35,fH2=fW2/(window.__millefonti_firma.width/window.__millefonti_firma.height);refertoPdf.addImage(fCR.toDataURL('image/png'),'PNG',pw-10-fW2,ph-38-fH2,fW2,fH2);}
          refertoPdf.setFontSize(13);refertoPdf.setFont('helvetica','bold');refertoPdf.setTextColor(37,87,54);refertoPdf.text('Dott. '+nb2,pw-10,ph-36,{align:'right'});
          refertoPdf.setDrawColor(37,87,54);refertoPdf.setLineWidth(0.3);refertoPdf.line(pw-65,ph-33,pw-10,ph-33);
          refertoPdf.setFontSize(8);refertoPdf.setFont('helvetica','normal');refertoPdf.setTextColor(37,87,54);
          refertoPdf.text('Ambulatorio Millefonti',pw-10,ph-28,{align:'right'});
          refertoPdf.text('Via Garessio 47 - Torino',pw-10,ph-23,{align:'right'});
          refertoPdf.setTextColor(107,125,153);refertoPdf.text(new Date().toLocaleDateString('it-IT'),pw-10,ph-17,{align:'right'});
          refertoPdf.setFillColor(37,87,54);refertoPdf.rect(0,ph-8,pw,8,'F');refertoPdf.setTextColor(255,255,255);refertoPdf.setFontSize(8);
          refertoPdf.text('Ambulatorio Millefonti — ambulatoriomillefonti.it',pw/2,ph-3,{align:'center'});
          // Merge referto + tutte le pagine originali (pdf-lib, nessun canvas)
          const { PDFDocument, degrees: pdfDegrees } = await import('pdf-lib');
          const mergedDoc = await PDFDocument.create();
          const refertoSrc = await PDFDocument.load(refertoPdf.output('arraybuffer'));
          const [refertoPageCopied] = await mergedDoc.copyPages(refertoSrc, [0]);
          mergedDoc.addPage(refertoPageCopied);
          const originalSrc = await PDFDocument.load(arrayBuffer);
          const copiedPages = await mergedDoc.copyPages(originalSrc, originalSrc.getPageIndices());
          copiedPages.forEach(p => {
            if (rotation !== 0) { const ea = p.getRotation().angle; p.setRotation(pdfDegrees((ea + rotation) % 360)); }
            mergedDoc.addPage(p);
          });
          const mergedBytes = await mergedDoc.save();
          const mergedBlob = new Blob([mergedBytes], { type: 'application/pdf' });
          if(ecg.batch_id){setPdfBlob(mergedBlob);}else{
            const urlM=URL.createObjectURL(mergedBlob);
            const aM=document.createElement('a');aM.href=urlM;aM.download=`Referto_${ecg.paziente.replace(/[^a-zA-Z]/g,'_')}_${new Date().toISOString().slice(0,10)}.pdf`;aM.click();URL.revokeObjectURL(urlM);
          }
        } else {
          if (ecg.batch_id) {
            setPdfBlob(finalPdf.output("blob"));
          } else {
            finalPdf.save(`Referto_${ecg.paziente.replace(/[^a-zA-Z]/g,"_")}_${new Date().toISOString().slice(0,10)}.pdf`);
          }
        }
      }
      setGenerato(true);
    } catch(e) { console.error(e); alert("Errore nella generazione del PDF: "+e.message); }
    setGenerating(false);
  };

  const confermaSend = async () => {
    if (confirming) return;
    if (!pdfBlob) { alert("Genera prima il referto PDF!"); return; }
    setConfirming(true);
    
    // Usa il nome del file originale se disponibile, altrimenti il nome paziente
    const nomeFileOriginale = ecg.file_ecg_url 
      ? ecg.file_ecg_url.split('/').pop().replace(/\.[^.]+$/, '') // rimuove estensione
      : (ecg.paziente_nome || ecg.paziente || "paziente").replace(/[^a-zA-Z0-9]/g, "_");
    const refertoFileName = `referti/_${nomeFileOriginale}.pdf`;
    
    // Upload + DB update (async in background)
    (async () => {
      try {
        const { error: uploadError } = await supabase.storage.from('ecg-files')
          .upload(refertoFileName, pdfBlob, { contentType: 'application/pdf', upsert: true });
        if (uploadError) { console.error('Upload error:', uploadError); return; }
        
        const { error: dbError } = await supabase.from('ecgs')
          .update({ stato: 'refertato', file_referto_url: refertoFileName })
          .eq('id', ecg.id);
        if (dbError) console.error('DB update error:', dbError);
        
        // Elimina file ECG originale
        if (ecg.file_ecg_url) {
          await supabase.storage.from('ecg-files').remove([ecg.file_ecg_url]).catch(() => {});
        }
        
        // Email solo per ECG singoli
        if (!ecg.batch_id && ecg.email_destinatario) {
          const { data: urlData } = await supabase.storage.from('ecg-files').createSignedUrl(refertoFileName, 60 * 60 * 24 * 7);
          if (urlData?.signedUrl) {
            const emailDest = ecg.email_destinatario;
            const downloadUrl = urlData.signedUrl;

            // 1. Recupera codice_referti dell'azienda
            const { data: profilo } = await supabase
              .from('user_profiles')
              .select('codice_referti')
              .eq('email', emailDest)
              .single();
            const codiceReferti = profilo?.codice_referti || null;

            // 2. Crea token di download
            const expires = new Date();
            expires.setDate(expires.getDate() + 7);
            const { data: tokenData, error: tokenError } = await supabase
              .from('download_tokens')
              .insert({
                download_url: downloadUrl,
                azienda_email: emailDest,
                batch_nome: ecg.paziente_nome || ecg.paziente,
                count: 1,
                cardiologo: meCardiologo,
                expires_at: expires.toISOString(),
                codice_referti: codiceReferti,
              })
              .select('token')
              .single();

            // 3. Costruisci link
            if (tokenError) {
              fetch('/api/notify-breach', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tipo: 'token_creation_failed', messaggio: `Token creation failed per ${emailDest}` }),
              }).catch(() => {});
            }
            const linkDownload = tokenError || !tokenData
              ? downloadUrl
              : `https://ambulatoriomillefonti.it/api/scarica?token=${tokenData.token}`;

            // 4. Invia email con linkDownload
            fetch('/api/notify-referto', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                email: emailDest,
                paziente: ecg.paziente_nome || ecg.paziente,
                cardiologo: meCardiologo,
                downloadUrl: linkDownload,
              })
            }).catch(() => {});
          }
        }
      } catch(e) { console.error('Errore confermaSend:', e); }
    })();
    
    // Passa subito al prossimo ECG senza aspettare l'upload!
    onRefertato(refertoFileName);
    setConfirming(false);
  };

  const CROCETTE_OPTS = [
    {k:"limiti",      label:"ECG nei limiti della norma",                                          color:C.green},
    {k:"correlare",   label:"ECG da correlare con la clinica",                                     color:C.orange},
    {k:"approfondire",label:"ECG da approfondire con Medico Curante",                              color:C.red},
    {k:"visita",      label:"ECG da approfondire con visita cardiologica",                         color:C.purple},
    {k:"urgente",     label:"Se nuova sintomatologia: visita cardiologica urgente / accesso in PS", color:"#b91c1c"},
  ];

  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      {/* Top: carica ECG + anteprima FULL WIDTH */}
      <div style={{display:"flex",flexDirection:"column",gap:14}}>
        <div style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:16,padding:18,boxShadow:C.shadow}}>
          <div style={{color:C.muted,fontWeight:700,fontSize:11,letterSpacing:1.5,textTransform:"uppercase",marginBottom:12}}>1. Carica tracciato ECG</div>
          <div onClick={()=>document.getElementById(fileId).click()}
            style={{border:`2px dashed ${ecgFile?C.green:C.border}`,borderRadius:12,padding:"24px 16px",textAlign:"center",cursor:"pointer",background:ecgFile?C.greenLight:"#f8faff"}}>
            <input id={fileId} type="file" accept=".pdf,.png,.jpg,.jpeg" style={{display:"none"}} onChange={e=>handleFile(e.target.files[0])} />
            {ecgFile
              ? <div style={{color:C.green,fontWeight:700,fontSize:14}}>✓ {ecgFile.name}</div>
              : <><div style={{fontSize:24,marginBottom:6}}>📎</div><div style={{color:C.textSoft,fontSize:13,fontWeight:500}}>Clicca per caricare ECG</div><div style={{color:C.muted,fontSize:11,marginTop:3}}>PDF · JPEG · PNG</div></>
            }
          </div>
        </div>
      {/* Anteprima */}
        {ecgUrl && (
          <div style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:16,padding:16,flex:1,boxShadow:C.shadow,overflow:"hidden"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <div style={{color:C.muted,fontWeight:700,fontSize:11,letterSpacing:1.5,textTransform:"uppercase"}}>Anteprima tracciato</div>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <button onClick={()=>setZoom(z=>Math.max(0.5,z-0.25))} style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:8,padding:"4px 10px",cursor:"pointer",fontWeight:700,fontSize:14}}>−</button>
                <span style={{fontSize:12,color:C.muted,fontWeight:600,minWidth:40,textAlign:"center"}}>{Math.round(zoom*100)}%</span>
                <button onClick={()=>setZoom(z=>Math.min(3,z+0.25))} style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:8,padding:"4px 10px",cursor:"pointer",fontWeight:700,fontSize:14}}>+</button>
                <button onClick={()=>setZoom(1)} style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:8,padding:"4px 10px",cursor:"pointer",fontSize:11,color:C.muted}}>reset</button>
                <div style={{width:1,height:20,background:C.border,margin:"0 4px"}} />
                <button onClick={()=>setRotation(r=>(r-90+360)%360)} style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:8,padding:"4px 10px",cursor:"pointer",fontSize:14}} title="Ruota antiorario">↺</button>
                <button onClick={()=>setRotation(r=>(r+90)%360)} style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:8,padding:"4px 10px",cursor:"pointer",fontSize:14}} title="Ruota orario">↻</button>
                <a href={ecgUrl} target="_blank" rel="noreferrer" style={{color:C.accent,fontSize:12,fontWeight:600,textDecoration:"none",marginLeft:4}}>🔍 Tab</a>
              </div>
            </div>
            <div style={{overflow:"auto",maxHeight:"40vh",borderRadius:8,background:"#f5f5f5",border:`1px solid ${C.borderLight}`}}>
              {previewDataUrl
                ? <img src={previewDataUrl} alt="ECG" style={{
                    width: rotation===90||rotation===270 ? `${zoom*60}%` : `${zoom*100}%`,
                    display:"block",
                    cursor:zoom>1?"zoom-in":"default",
                    transform:`rotate(${rotation}deg)`,
                    transformOrigin:"center center",
                    margin: rotation===90||rotation===270 ? "10% auto" : "0"
                  }} />
                : <div style={{padding:40,textAlign:"center",color:C.muted}}>⏳ Caricamento...</div>
              }
            </div>
          </div>
        )}
      </div>

      {/* Bottom: crocette + commento + bottone - FULL WIDTH */}
      <div style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:16,padding:20,boxShadow:C.shadow}}>
        <div style={{color:C.muted,fontWeight:700,fontSize:11,letterSpacing:1.5,textTransform:"uppercase",marginBottom:14}}>2. Refertazione</div>

        {/* Crocette in griglia 2 colonne + commento full width */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
          {CROCETTE_OPTS.map(({k,label,color})=>(
            <div key={k} onClick={()=>setCrocette(p=>({...p,[k]:!p[k]}))}
              style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",borderRadius:10,cursor:"pointer",border:`2px solid ${crocette[k]?color:C.border}`,background:crocette[k]?color+"18":C.bg,transition:"all 0.15s"}}>
              <div style={{width:20,height:20,borderRadius:5,border:`2px solid ${crocette[k]?color:C.border}`,background:crocette[k]?color:"white",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                {crocette[k] && <span style={{color:"white",fontWeight:700,fontSize:12}}>✓</span>}
              </div>
              <span style={{fontSize:12,color:crocette[k]?color:C.textSoft,fontWeight:crocette[k]?700:400,lineHeight:1.3}}>{label}</span>
            </div>
          ))}
        </div>

        {/* Posizione referto */}
        <div style={{marginBottom:14}}>
          <label style={{color:C.textSoft,fontSize:12,fontWeight:600,display:"block",marginBottom:8}}>Posizione referto</label>
          <div style={{display:"flex",gap:8}}>
            {[["top-right","↗ Alto dx"],["bottom-right","↘ Basso dx"],["pagina-separata","📄 Pagina separata"]].map(([v,l])=>(
              <button key={v} onClick={()=>setPosizione(v)}
                style={{flex:1,padding:"8px 4px",borderRadius:8,cursor:"pointer",fontWeight:600,fontSize:11,border:`2px solid ${posizione===v?C.accent:C.border}`,background:posizione===v?C.accentLight:C.bg,color:posizione===v?C.accent:C.muted}}>
                {l}
              </button>
            ))}
          </div>
        </div>

        {/* Commento FULL WIDTH */}
        <div style={{marginBottom:14}}>
          <label style={{color:C.textSoft,fontSize:12,fontWeight:600,display:"block",marginBottom:7}}>Commento (opzionale)</label>
          <textarea value={commento} onChange={e=>setCommento(e.target.value)}
            placeholder="Note aggiuntive del cardiologo..."
            rows={3}
            style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:10,padding:"10px 12px",color:C.text,fontSize:13,width:"100%",outline:"none",resize:"vertical",fontFamily:SANS,boxSizing:"border-box"}} />
        </div>

        {/* Bottone genera */}
        <button onClick={generaPDF} disabled={!ecgFile||!almenoCrocetta||generating}
          style={{background:(!ecgFile||!almenoCrocetta||generating)?C.border:"linear-gradient(135deg,#2e7cf6,#0ea5a0)",color:(!ecgFile||!almenoCrocetta||generating)?C.muted:"white",border:"none",borderRadius:12,padding:"13px 0",cursor:(!ecgFile||!almenoCrocetta||generating)?"not-allowed":"pointer",fontWeight:700,fontSize:14,width:"100%",boxShadow:(!ecgFile||!almenoCrocetta||generating)?"none":"0 4px 16px rgba(46,124,246,0.3)"}}>
          {generating?"⏳ Generazione...":"📄 Genera referto PDF"}
        </button>

        {!almenoCrocetta && <div style={{color:C.muted,fontSize:11,textAlign:"center",marginTop:8}}>Seleziona almeno una crocetta</div>}
      </div>

      {/* Bottone conferma dopo generazione */}
      {generato && (
        <div style={{background:C.greenLight,border:`1px solid ${C.green}33`,borderRadius:16,padding:18,boxShadow:C.shadow}}>
          <div style={{color:C.green,fontWeight:700,fontSize:14,marginBottom:6}}>✅ PDF generato!</div>
          <div style={{color:C.textSoft,fontSize:12,marginBottom:14}}>Clicca per segnare come refertato.</div>
          <button onClick={confermaSend} disabled={confirming}
            style={{background:confirming?C.muted:C.green,color:"white",border:"none",borderRadius:10,padding:"12px 0",cursor:confirming?"wait":"pointer",fontWeight:700,fontSize:14,width:"100%",boxShadow:confirming?"none":`0 4px 16px ${C.green}44`}}>
            {confirming ? "⏳ Invio in corso..." : `Conferma refertazione`}
          </button>
        </div>
      )}
    </div>
  );
};

const FirmaPreview = ({ firmaUrl }) => {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    supabase.storage.from('ecg-files').createSignedUrl(firmaUrl, 3600)
      .then(({ data }) => { if (data?.signedUrl) setUrl(data.signedUrl); });
  }, [firmaUrl]);
  if (!url) return null;
  return <img src={url} alt="Firma" style={{ maxHeight:60, maxWidth:200, objectFit:"contain" }} />;
};

const CardiologoView = ({ ecgs, setEcgs, meCardiologo, caricaEcgs, pushAbilitato, registraPush }) => {
  const [selected, setSelected] = useState(null);
  const [done, setDone] = useState(false);
  const [file, setFile] = useState(null);
  const [firmaUrl, setFirmaUrl] = useState(null);
  const [uploadingFirma, setUploadingFirma] = useState(false);
  const [showProfilo, setShowProfilo] = useState(false);
  const [pdfBlobsMap, setPdfBlobsMap] = useState({}); // {ecgId: blob} per batch
  const [chiudendoBatch, setChiudendoBatch] = useState(null);
  const [showCompensi, setShowCompensi] = useState(false);
  const [tariffario, setTariffario] = useState({});
  const [meseComp, setMeseComp] = useState(() => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; });
  const [filtroTipo, setFiltroTipo] = useState('mese');
  const [dataDal, setDataDal] = useState(() => { const d=new Date(); d.setDate(1); return d.toISOString().split('T')[0]; });
  const [dataAl, setDataAl] = useState(() => new Date().toISOString().split('T')[0]);
  const [azExpanded, setAzExpanded] = useState(new Set());
  const [savingTariff, setSavingTariff] = useState(false);

  // Carica firma esistente all'avvio
  useEffect(() => {
    const caricaFirma = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const { data } = await supabase.from('user_profiles').select('firma_url').eq('id', session.user.id).single();
      if (data?.firma_url) setFirmaUrl(data.firma_url);
    };
    caricaFirma();
  }, []);

  // Carica tariffario da Supabase
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.user) return;
      const { data } = await supabase.from('user_profiles').select('tariffario').eq('id', session.user.id).single();
      if (data?.tariffario) setTariffario(typeof data.tariffario === 'string' ? JSON.parse(data.tariffario) : (data.tariffario || {}));
    });
  }, []);

  const getTariffa = (orig, urgenza = 'normale') => {
    if (urgenza === 'urgente') {
      const ku = `${orig}|urgente`;
      if (tariffario[ku] !== undefined) return parseFloat(tariffario[ku]);
    }
    if (tariffario[orig] !== undefined) return parseFloat(tariffario[orig]);
    return parseFloat(tariffario['default'] ?? 10);
  };

  const salvaTariffario = async () => {
    setSavingTariff(true);
    const { data: { session } } = await supabase.auth.getSession();
    await supabase.from('user_profiles').update({ tariffario }).eq('id', session.user.id);
    setSavingTariff(false);
    alert('Tariffario salvato!');
  };

  const esportaPDFCompensi = () => {
    const ecgsMese = refertatiMiei.filter(e => {
      const d = new Date(e.created_at||e.ts);
      if (filtroTipo === 'mese') { const [anno,mese]=meseComp.split('-').map(Number); return d.getFullYear()===anno && d.getMonth()===mese-1; }
      const dal=new Date(dataDal); dal.setHours(0,0,0,0);
      const al=new Date(dataAl); al.setHours(23,59,59,999);
      return d>=dal && d<=al;
    });
    const periodoLabel = filtroTipo==='mese'
      ? (() => { const [a,m]=meseComp.split('-'); return ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'][Number(m)-1]+' '+a; })()
      : `${dataDal} → ${dataAl}`;
    const [anno, mese] = meseComp.split('-').map(Number);
    const byAz = {};
    ecgsMese.forEach(e => {
      const k = e.origine_dettaglio||e.farmacia||e.azienda||'Altro';
      if (!byAz[k]) byAz[k] = { normale:[], urgente:[] };
      byAz[k][e.urgenza==='urgente'?'urgente':'normale'].push(e);
    });
    const pdf = new jsPDF({ unit:'mm', format:'a4' });
    const W=210, mar=18;
    const mesiLabel=['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
    // ── Header ──
    pdf.setFillColor(37,87,54); pdf.rect(0,0,W,40,'F');
    pdf.setTextColor(255,255,255); pdf.setFontSize(18); pdf.setFont('helvetica','bold');
    pdf.text('RENDICONTO COMPENSI ECG', mar, 16);
    pdf.setFontSize(10); pdf.setFont('helvetica','normal');
    pdf.text(`Ambulatorio Millefonti  ·  Via Garessio 47, Torino`, mar, 25);
    pdf.setFontSize(11); pdf.setFont('helvetica','bold');
    pdf.text(`Dott. ${meCardiologo}`, mar, 34);
    pdf.setFont('helvetica','normal');
    pdf.text(`${mesiLabel[mese-1]} ${anno}`, W-mar, 34, {align:'right'});
    // ── Info box ──
    pdf.setFillColor(244,247,250); pdf.rect(mar, 46, W-mar*2, 14, 'F');
    pdf.setTextColor(107,125,153); pdf.setFontSize(9);
    pdf.text(`Periodo di riferimento: 01/${String(mese).padStart(2,'0')}/${anno} — ${new Date(anno,mese,0).getDate()}/${String(mese).padStart(2,'0')}/${anno}`, mar+4, 53);
    pdf.text(`Totale ECG refertati: ${ecgsMese.length}`, W-mar-4, 53, {align:'right'});
    // ── Intestazione tabella ──
    let y = 70;
    pdf.setFillColor(37,87,54); pdf.rect(mar, y-6, W-mar*2, 8, 'F');
    pdf.setTextColor(255,255,255); pdf.setFontSize(9); pdf.setFont('helvetica','bold');
    pdf.text('AZIENDA / FARMACIA', mar+2, y-0.5);
    pdf.text('STD', 120, y-0.5, {align:'right'});
    pdf.text('URG', 137, y-0.5, {align:'right'});
    pdf.text('€/STD', 152, y-0.5, {align:'right'});
    pdf.text('€/URG', 167, y-0.5, {align:'right'});
    pdf.text('TOTALE', W-mar-2, y-0.5, {align:'right'});
    y += 6;
    let totaleGlobale = 0;
    Object.entries(byAz).forEach(([az, {normale, urgente}], idx) => {
      const tNorm = getTariffa(az,'normale'), tUrg = getTariffa(az,'urgente');
      const tot = normale.length*tNorm + urgente.length*tUrg;
      totaleGlobale += tot;
      if (idx%2===0) { pdf.setFillColor(250,252,251); pdf.rect(mar,y-4,W-mar*2,9,'F'); }
      pdf.setTextColor(26,38,64); pdf.setFontSize(9.5); pdf.setFont('helvetica','normal');
      pdf.text(az.length>42?az.substring(0,39)+'…':az, mar+2, y);
      pdf.setFont('helvetica','bold'); pdf.setTextColor(46,124,246);
      pdf.text(String(normale.length), 120, y, {align:'right'});
      pdf.setTextColor(normale.length>0&&urgente.length>0?220:46,urgente.length>0?80:124,urgente.length>0?50:246);
      pdf.text(String(urgente.length), 137, y, {align:'right'});
      pdf.setFont('helvetica','normal'); pdf.setTextColor(107,125,153);
      pdf.text(`${tNorm.toFixed(2)}€`, 152, y, {align:'right'});
      pdf.text(`${tUrg.toFixed(2)}€`, 167, y, {align:'right'});
      pdf.setFont('helvetica','bold'); pdf.setTextColor(14,165,100);
      pdf.text(`${tot.toFixed(2)}€`, W-mar-2, y, {align:'right'});
      y += 9;
      if (y > 260) { pdf.addPage(); y = 20; }
    });
    // ── Totale ──
    pdf.setFillColor(14,165,100); pdf.rect(mar, y, W-mar*2, 12, 'F');
    pdf.setTextColor(255,255,255); pdf.setFont('helvetica','bold'); pdf.setFontSize(12);
    pdf.text('TOTALE DOVUTO', mar+4, y+8);
    pdf.setFontSize(14);
    pdf.text(`${totaleGlobale.toFixed(2)} €`, W-mar-4, y+8, {align:'right'});
    y += 22;
    // ── Firma ──
    pdf.setDrawColor(200,210,230); pdf.line(mar, y, W-mar, y);
    y += 10;
    pdf.setFont('helvetica','normal'); pdf.setFontSize(9); pdf.setTextColor(120,130,150);
    pdf.text(`Rendiconto generato il ${new Date().toLocaleDateString('it-IT')} — ambulatoriomillefonti.it`, mar, y);
    pdf.text('Solo per riferimento interno', W-mar, y, {align:'right'});
    // ── DETTAGLIO ECG ──
    y += 8;
    pdf.setFontSize(11); pdf.setFont('helvetica','bold'); pdf.setTextColor(26,38,64);
    pdf.text('DETTAGLIO ECG REFERTATI', mar, y); y += 6;
    pdf.setFillColor(37,87,54); pdf.rect(mar, y-5, W-mar*2, 7, 'F');
    pdf.setTextColor(255,255,255); pdf.setFontSize(8); pdf.setFont('helvetica','bold');
    pdf.text('PAZIENTE', mar+2, y-0.5);
    pdf.text('DATA', 90, y-0.5);
    pdf.text('AZIENDA', 115, y-0.5);
    pdf.text('EMAIL', 155, y-0.5);
    pdf.text('TIPO', 185, y-0.5);
    pdf.text('€', W-mar-2, y-0.5, {align:'right'});
    y += 5;
    ecgsMese.sort((a,b)=>new Date(a.created_at||a.ts)-new Date(b.created_at||b.ts)).forEach((e, idx) => {
      if (y > 268) { pdf.addPage(); y = 20; }
      const az = e.origine_dettaglio||e.farmacia||e.azienda||'Altro';
      const isUrg = e.urgenza==='urgente';
      const importo = getTariffa(az, isUrg?'urgente':'normale');
      if (idx%2===0) { pdf.setFillColor(248,250,252); pdf.rect(mar,y-4,W-mar*2,8,'F'); }
      pdf.setTextColor(26,38,64); pdf.setFontSize(8.5); pdf.setFont('helvetica','normal');
      const nome = (e.paziente_nome||e.paziente||'—').substring(0,22);
      const data = new Date(e.created_at||e.ts).toLocaleDateString('it-IT');
      const azS = az.substring(0,20);
      const mail = (e.email_destinatario||'—').substring(0,22);
      pdf.text(nome, mar+2, y);
      pdf.text(data, 90, y);
      pdf.text(azS, 115, y);
      pdf.text(mail, 155, y);
      pdf.setTextColor(isUrg?200:46, isUrg?100:124, isUrg?20:246);
      pdf.text(isUrg?'URG':'STD', 185, y);
      pdf.setTextColor(14,165,100); pdf.setFont('helvetica','bold');
      pdf.text(`${importo.toFixed(2)}€`, W-mar-2, y, {align:'right'});
      y += 8;
    });
    const fn = filtroTipo==='mese'
      ? `Compensi_${mesiLabel[mese-1]}_${anno}_${meCardiologo.replace(/\s/g,'_')}.pdf`
      : `Compensi_${dataDal}_${dataAl}_${meCardiologo.replace(/\s/g,'_')}.pdf`;
    pdf.save(fn);
  };

  const scaricaBatch = async (batchId) => {
    const ecgsBatch = mieiEcgs.filter(e => e.batch_id === batchId && e.stato === "refertato" && e.file_referto_url);
    if (ecgsBatch.length === 0) { alert("Nessun referto disponibile"); return; }
    
    // Scarica tutti i PDF e crea uno ZIP
    const zip = new JSZip();
    
    await Promise.all(ecgsBatch.map(async (e) => {
      const { data } = await supabase.storage.from('ecg-files').download(e.file_referto_url);
      if (data) {
        const fileName = e.file_referto_url.split('/').pop();
        zip.file(fileName, data);
      }
    }));
    
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${ecgsBatch[0]?.batch_nome || batchId}_referti.zip`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const chiudiBatch = async (batchId) => {
    setChiudendoBatch(batchId);
    const ecgsBatch = mieiEcgs.filter(e => e.batch_id === batchId && e.stato === "refertato" && e.file_referto_url);
    const email = ecgsBatch[0]?.email_destinatario;
    const batchNome = ecgsBatch[0]?.batch_nome || batchId;
    if (ecgsBatch.length === 0 || !email) { setChiudendoBatch(null); alert("Nessun referto disponibile o email mancante"); return; }
    try {
      const zip = new JSZip();
      await Promise.all(ecgsBatch.map(async (e) => {
        const { data } = await supabase.storage.from('ecg-files').download(e.file_referto_url);
        if (data) zip.file(e.file_referto_url.split('/').pop(), data);
      }));
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const zipFileName = `referti/zip/_${batchNome.replace(/[^a-zA-Z0-9]/g,'_')}_${batchId}.zip`;
      await supabase.storage.from('ecg-files').upload(zipFileName, zipBlob, { contentType:'application/zip', upsert:true });
      const { data: urlData } = await supabase.storage.from('ecg-files').createSignedUrl(zipFileName, 60*60*24*7);
      if (urlData?.signedUrl) {
        const downloadUrl = urlData.signedUrl;

        // 1. Recupera codice_referti dell'azienda
        const { data: profilo } = await supabase
          .from('user_profiles')
          .select('codice_referti')
          .eq('email', email)
          .single();
        const codiceReferti = profilo?.codice_referti || null;

        // 2. Crea token di download
        const expires = new Date();
        expires.setDate(expires.getDate() + 7);
        const { data: tokenData, error: tokenError } = await supabase
          .from('download_tokens')
          .insert({
            download_url: downloadUrl,
            azienda_email: email,
            batch_nome: batchNome,
            count: ecgsBatch.length,
            cardiologo: meCardiologo,
            expires_at: expires.toISOString(),
            codice_referti: codiceReferti,
          })
          .select('token')
          .single();

        // 3. Costruisci link
        if (tokenError) {
          fetch('/api/notify-breach', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tipo: 'token_creation_failed', messaggio: `Token creation failed per ${email}` }),
          }).catch(() => {});
        }
        const linkDownload = tokenError || !tokenData
          ? downloadUrl
          : `https://ambulatoriomillefonti.it/api/scarica?token=${tokenData.token}`;

        // 4. Invia email con linkDownload
        await fetch('/api/notify-referto', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email, cardiologo: meCardiologo,
            downloadUrl: linkDownload,
            isBatch: true, batchNome, count: ecgsBatch.length,
          })
        }).catch(() => {});
      }
      alert(`Lotto "${batchNome}" chiuso! Email con ZIP inviata a ${email}`);
    } catch(e) { console.error('chiudiBatch error:', e); alert('Errore: ' + e.message); }
    setChiudendoBatch(null);
  };

  const caricaFirma = async (file) => {
    if (!file) return;
    setUploadingFirma(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const fileName = `firme/${session.user.id}_firma.png`;
      await supabase.storage.from('ecg-files').upload(fileName, file, { upsert: true });
      await supabase.from('user_profiles').update({ firma_url: fileName }).eq('id', session.user.id);
      setFirmaUrl(fileName);
    } catch(e) { console.error('Errore upload firma:', e); }
    setUploadingFirma(false);
  };

  // Solo ECG assegnati a questo cardiologo
  const mieiEcgs = ecgs.filter(e => e.cardiologo === meCardiologo);
  const inAttesa = mieiEcgs.filter(e => e.stato === "in_attesa");
  const refertatiMiei = mieiEcgs.filter(e => e.stato === "refertato");
  // Mostra sempre tutti gli ECG assegnati (in attesa + refertati)
  const ecgDaVisualizzare = mieiEcgs;
  // Conteggio batch attivo
  const batchCorrente = selected?.batch_id ? mieiEcgs.filter(e => e.batch_id === selected.batch_id) : null;
  const batchRefertati = batchCorrente ? batchCorrente.filter(e => e.stato === "refertato").length : 0;
  const me = { referti: 0, guadagno: 0, rating: 4.9, ...Object.values(CARDIOLOGI_DATA).find((_,i)=>Object.keys(CARDIOLOGI_DATA)[i]===meCardiologo)||{} };
  const guadagnoTot = (me.guadagno || 0) + refertatiMiei.reduce((s,e)=>s+getTariffa(e.origine_dettaglio||e.origine, e.urgenza==='urgente'?'urgente':'normale'),0);

  const handleReferti = () => {
    if (!file || !selected) return;
    setEcgs(prev => prev.map(e => e.id === selected.id ? { ...e, stato:"refertato" } : e));
    setDone(true);
  };

  return (
    <div style={{ display:"flex", height:"calc(100vh - 64px)", flexDirection:"column" }}>

      <div style={{ display:"flex", flex:1, overflow:"hidden" }}>
      {/* Sidebar */}
      <div style={{ width:320, borderRight:`1px solid ${C.border}`, display:"flex", flexDirection:"column", background:C.white, overflow:"hidden" }}>
        <div style={{ padding:"20px 20px 16px", background:"linear-gradient(135deg,#e8f4ff,#e6f9f4)", borderBottom:`1px solid ${C.border}` }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
            <div style={{ color:C.muted, fontSize:12, fontWeight:600 }}>{showCompensi ? '💰 Compensi' : 'Guadagni — mese corrente'}</div>
            <div style={{display:'flex',gap:4,alignItems:'center'}}>
              <button onClick={()=>setShowCompensi(p=>!p)} style={{background:showCompensi?'#e8f9f4':'rgba(255,255,255,0.6)',border:`1px solid ${showCompensi?C.teal:C.border}`,borderRadius:8,padding:"4px 10px",cursor:"pointer",fontSize:12,color:showCompensi?C.teal:C.muted,fontWeight:600}}>💰 {showCompensi?'Chiudi':'Compensi'}</button>
              <button onClick={registraPush} style={{background:pushAbilitato?'#e6f9f1':'#fff8e1',border:`1px solid ${pushAbilitato?'#1aaa6e':'#f59e0b'}`,borderRadius:8,padding:"4px 10px",cursor:"pointer",fontSize:13}} title={pushAbilitato?"Notifiche attive — clicca per rinnovare":"Abilita notifiche push"}>{pushAbilitato?"🔔✓":"🔔"}</button>
              <button onClick={()=>setShowProfilo(p=>!p)} style={{background:showProfilo?"rgba(46,124,246,0.1)":"rgba(255,255,255,0.6)",border:`1px solid ${showProfilo?C.accent:C.border}`,borderRadius:8,padding:"4px 10px",cursor:"pointer",fontSize:12,color:showProfilo?C.accent:C.muted,fontWeight:600}}>⚙️</button>
            </div>
          </div>
          <div style={{ color:C.green, fontFamily:MONO, fontSize:30, fontWeight:"bold" }}>{guadagnoTot}€</div>
          <div style={{ display:"flex", gap:6, marginTop:10, flexWrap:"wrap" }}>
            <span style={{ background:C.white, color:C.accent, border:`1px solid ${C.border}`, borderRadius:20, padding:"3px 12px", fontWeight:600, fontSize:12 }}>{(me.referti||0)+refertatiMiei.length} referti</span>
            <span style={{ background:C.white, color:C.yellow, border:`1px solid ${C.border}`, borderRadius:20, padding:"3px 12px", fontWeight:600, fontSize:12 }}>★ {me.rating}</span>
          </div>
        </div>

        <div style={{ padding:"14px 18px 6px", borderBottom:`1px solid ${C.borderLight}` }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:6 }}>
            <span style={{ color:C.textSoft, fontWeight:700, fontSize:13 }}>Da refertare</span>
            <span style={{ background:C.accentLight, color:C.accent, borderRadius:20, padding:"2px 12px", fontSize:12, fontWeight:700 }}>{inAttesa.length}</span>
            {batchCorrente && <span style={{background:C.purpleLight,color:C.purple,borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:700}}>📦 {batchRefertati}/{batchCorrente.length} ✓</span>}

          </div>
          {showProfilo && (
            <div style={{marginTop:12,padding:12,background:C.bg,borderRadius:12,border:`1px solid ${C.border}`}}>
              <div style={{fontWeight:700,fontSize:13,color:C.text,marginBottom:8}}>Firma scannerizzata</div>
              <div style={{color:C.muted,fontSize:11,marginBottom:10}}>Carica una foto della tua firma su sfondo bianco. Verrà applicata automaticamente ai referti.</div>
              {firmaUrl && <div style={{color:C.green,fontSize:11,fontWeight:600,marginBottom:8}}>✓ Firma presente</div>}
              <label style={{display:"block",border:`2px dashed ${C.border}`,borderRadius:10,padding:"10px",textAlign:"center",cursor:"pointer",background:C.white,fontSize:12}}>
                <input type="file" accept="image/png,image/jpeg" style={{display:"none"}} onChange={e=>caricaFirma(e.target.files[0])} />
                {uploadingFirma ? "⏳ Caricamento..." : firmaUrl ? "🔄 Aggiorna firma" : "📤 Carica firma (PNG/JPG)"}
              </label>
            </div>
          )}
        </div>

        <div style={{ overflowY:"auto", flex:1 }}>
          {(() => {
            // Raggruppa per batch
            const batches = {};
            const singoli = [];
            mieiEcgs.forEach(e => {
              if (e.batch_id) {
                if (!batches[e.batch_id]) batches[e.batch_id] = { nome: e.batch_nome||e.batch_id, ecgs: [], email: e.email_destinatario };
                batches[e.batch_id].ecgs.push(e);
              } else {
                singoli.push(e);
              }
            });

            return <>
              {/* Lotti */}
              {Object.entries(batches).map(([batchId, batch]) => {
                const refertati = batch.ecgs.filter(e=>e.stato==="refertato").length;
                const totale = batch.ecgs.length;
                const tuttiRefertati = refertati === totale;
                return (
                  <div key={batchId} style={{ borderBottom:`2px solid ${C.border}`, marginBottom:4 }}>
                    {/* Header lotto */}
                    <div style={{ padding:"10px 14px", background: tuttiRefertati ? "#f0fdf4" : C.accentLight, borderBottom:`1px solid ${C.borderLight}` }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                        <div style={{ fontWeight:700, fontSize:13, color:C.text }}>📦 {batch.nome}</div>
                        <span style={{ background:tuttiRefertati?C.green:C.purple, color:"white", borderRadius:20, padding:"2px 8px", fontSize:11, fontWeight:700 }}>{refertati}/{totale}</span>
                      </div>
                      {tuttiRefertati && (
                        <div style={{ marginTop:8, display:"flex", gap:6 }}>
                          <button onClick={()=>chiudiBatch(batchId)} disabled={chiudendoBatch===batchId}
                            style={{ flex:1, background:C.green, color:"white", border:"none", borderRadius:8, padding:"7px 0", cursor:"pointer", fontWeight:700, fontSize:12 }}>
                            {chiudendoBatch===batchId ? "⏳ Invio..." : "✉️ Invia email"}
                          </button>
                          <button onClick={()=>scaricaBatch(batchId)}
                            style={{ flex:1, background:C.accent, color:"white", border:"none", borderRadius:8, padding:"7px 0", cursor:"pointer", fontWeight:700, fontSize:12 }}>
                            ⬇️ Scarica ZIP
                          </button>
                        </div>
                      )}
                    </div>
                    {/* ECG del lotto */}
                    {batch.ecgs.map(ecg=>(
                      <div key={ecg.id} onClick={()=>{setSelected(ecg);setDone(false);}}
                        style={{ padding:"10px 14px 10px 20px", borderBottom:`1px solid ${C.borderLight}`, cursor:"pointer",
                          background:selected?.id===ecg.id?C.accentLight:ecg.stato==="refertato"?"#f0fdf4":"transparent",
                          borderLeft:`4px solid ${selected?.id===ecg.id?C.accent:ecg.stato==="refertato"?C.green:"transparent"}` }}>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                          <div style={{ color:C.text, fontSize:13, fontWeight:600 }}>{ecg.paziente_nome || ecg.paziente}</div>
                          <Badge stato={ecg.stato} urgenza={ecg.urgenza} />
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}

              {/* ECG Singoli */}
              {singoli.length > 0 && (
                <div>
                  <div style={{ padding:"8px 14px", background:C.bg, fontSize:11, fontWeight:700, color:C.muted, textTransform:"uppercase", letterSpacing:1 }}>💊 ECG Singoli</div>
                  {singoli.map(ecg=>(
                    <div key={ecg.id} onClick={()=>{setSelected(ecg);setDone(false);}}
                      style={{ padding:"12px 14px", borderBottom:`1px solid ${C.borderLight}`, cursor:"pointer",
                        background:selected?.id===ecg.id?C.accentLight:ecg.stato==="refertato"?"#f0fdf4":"transparent",
                        borderLeft:`4px solid ${selected?.id===ecg.id?C.accent:ecg.stato==="refertato"?C.green:"transparent"}` }}>
                      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                        <div style={{ color:C.text, fontSize:13, fontWeight:600 }}>{ecg.paziente}</div>
                        <Badge stato={ecg.stato} urgenza={ecg.urgenza} />
                      </div>
                      <div style={{ color:C.muted, fontSize:11 }}>{ecg.farmacia || ecg.origine_dettaglio}</div>
                      <div style={{ marginTop:4 }}><SLATimer ecg={ecg} compact /></div>
                    </div>
                  ))}
                </div>
              )}

              {mieiEcgs.length === 0 && (
                <div style={{ padding:40, textAlign:"center" }}>
                  <div style={{ fontSize:36, marginBottom:8 }}>🫀</div>
                  <div style={{ color:C.muted, fontSize:14 }}>Nessun ECG assegnato</div>
                </div>
              )}
            </>;
          })()}
        </div>
      </div>

      {/* Detail */}
      <div style={{ flex:1, overflowY:"auto", padding:32, background:C.bg }}>
        {showCompensi ? (
          <div style={{ maxWidth:760 }}>
            {/* Header + filtri */}
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:20, flexWrap:'wrap', gap:12 }}>
              <div>
                <h2 style={{ color:C.text, fontSize:20, fontWeight:700, marginBottom:4 }}>💰 Compensi</h2>
                <div style={{ color:C.muted, fontSize:13 }}>Riepilogo per azienda/farmacia con dettaglio ECG</div>
              </div>
              <button onClick={esportaPDFCompensi} style={{ background:`linear-gradient(135deg,${C.accent},${C.teal})`, color:'white', border:'none', borderRadius:10, padding:'8px 18px', cursor:'pointer', fontWeight:700, fontSize:13, whiteSpace:'nowrap' }}>
                📄 Esporta PDF
              </button>
            </div>
            {/* Selezione filtro */}
            <div style={{ background:C.white, borderRadius:14, boxShadow:C.shadow, padding:16, marginBottom:16 }}>
              <div style={{ display:'flex', gap:8, marginBottom:12 }}>
                {[['mese','📅 Per mese'],['intervallo','📆 Intervallo date']].map(([v,l])=>(
                  <button key={v} onClick={()=>setFiltroTipo(v)}
                    style={{ flex:1, padding:'8px 12px', borderRadius:8, cursor:'pointer', fontWeight:600, fontSize:12,
                      border:`2px solid ${filtroTipo===v?C.accent:C.border}`,
                      background:filtroTipo===v?C.accentLight:C.bg,
                      color:filtroTipo===v?C.accent:C.muted }}>
                    {l}
                  </button>
                ))}
              </div>
              {filtroTipo==='mese' ? (
                <select value={meseComp} onChange={e=>setMeseComp(e.target.value)}
                  style={{ width:'100%', border:`1px solid ${C.border}`, borderRadius:10, padding:'8px 12px', fontSize:13, color:C.text, background:C.white, cursor:'pointer' }}>
                  {Array.from({length:24},(_,i)=>{ const d=new Date(); d.setMonth(d.getMonth()-i); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; }).map(v=>{
                    const [a,m]=v.split('-'); const mn=['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'][Number(m)-1];
                    return <option key={v} value={v}>{mn} {a}</option>;
                  })}
                </select>
              ) : (
                <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:11, color:C.muted, marginBottom:4, fontWeight:600 }}>DAL</div>
                    <input type="date" value={dataDal} onChange={e=>setDataDal(e.target.value)}
                      style={{ width:'100%', border:`1px solid ${C.border}`, borderRadius:10, padding:'8px 12px', fontSize:13, color:C.text, background:C.white }} />
                  </div>
                  <div style={{ color:C.muted, marginTop:16 }}>→</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:11, color:C.muted, marginBottom:4, fontWeight:600 }}>AL</div>
                    <input type="date" value={dataAl} onChange={e=>setDataAl(e.target.value)}
                      style={{ width:'100%', border:`1px solid ${C.border}`, borderRadius:10, padding:'8px 12px', fontSize:13, color:C.text, background:C.white }} />
                  </div>
                </div>
              )}
            </div>
            {(() => {
              const ecgsFiltrati = refertatiMiei.filter(e => {
                const d = new Date(e.created_at||e.ts);
                if (filtroTipo==='mese') { const [anno,mese]=meseComp.split('-').map(Number); return d.getFullYear()===anno && d.getMonth()===mese-1; }
                const dal=new Date(dataDal); dal.setHours(0,0,0,0);
                const al=new Date(dataAl); al.setHours(23,59,59,999);
                return d>=dal && d<=al;
              });
              const byAz = {};
              ecgsFiltrati.forEach(e=>{ const k=e.origine_dettaglio||e.farmacia||e.azienda||'Altro'; if(!byAz[k]) byAz[k]=[]; byAz[k].push(e); });
              const totaleGlobale = Object.entries(byAz).reduce((s,[k,rows])=>
                s+rows.filter(e=>e.urgenza!=='urgente').length*getTariffa(k,'normale')+rows.filter(e=>e.urgenza==='urgente').length*getTariffa(k,'urgente'),0);
              return (
                <>
                  {ecgsFiltrati.length===0 && <div style={{textAlign:'center',padding:40,color:C.muted,background:C.white,borderRadius:16,boxShadow:C.shadow}}>Nessun referto nel periodo selezionato</div>}
                  {Object.entries(byAz).length > 0 && (
                    <div style={{ background:C.white, borderRadius:16, boxShadow:C.shadow, overflow:'hidden', marginBottom:16 }}>
                      {/* Intestazione */}
                      <div style={{ display:'grid', gridTemplateColumns:'24px 1fr 55px 55px 55px 55px 80px', padding:'10px 14px', background:C.cardAlt, fontSize:10, fontWeight:700, color:C.muted, textTransform:'uppercase', letterSpacing:0.5, gap:4 }}>
                        <div/><div>Azienda</div><div style={{textAlign:'center'}}>Std</div><div style={{textAlign:'center'}}>Urg</div><div style={{textAlign:'center'}}>€/Std</div><div style={{textAlign:'center'}}>€/Urg</div><div style={{textAlign:'right'}}>Totale</div>
                      </div>
                      {Object.entries(byAz).map(([az,rows])=>{
                        const norm = rows.filter(e=>e.urgenza!=='urgente').length;
                        const urg = rows.filter(e=>e.urgenza==='urgente').length;
                        const tot = norm*getTariffa(az,'normale') + urg*getTariffa(az,'urgente');
                        const expanded = azExpanded.has(az);
                        return (
                          <div key={az} style={{ borderBottom:`1px solid ${C.borderLight}` }}>
                            {/* Riga azienda */}
                            <div onClick={()=>setAzExpanded(p=>{ const n=new Set(p); n.has(az)?n.delete(az):n.add(az); return n; })}
                              style={{ display:'grid', gridTemplateColumns:'24px 1fr 55px 55px 55px 55px 80px', padding:'12px 14px', alignItems:'center', gap:4, cursor:'pointer', background:expanded?C.accentLight:'transparent' }}>
                              <div style={{ color:C.accent, fontWeight:700, fontSize:14, textAlign:'center' }}>{expanded?'▾':'▸'}</div>
                              <div style={{ color:C.text, fontSize:13, fontWeight:600 }}>{az}</div>
                              <div style={{ textAlign:'center', color:C.accent, fontWeight:700, fontSize:13 }}>{norm}</div>
                              <div style={{ textAlign:'center', color:'#f59e0b', fontWeight:700, fontSize:13 }}>{urg}</div>
                              <div style={{ textAlign:'center', fontSize:11, color:C.muted }}>{getTariffa(az,'normale').toFixed(2)}€</div>
                              <div style={{ textAlign:'center', fontSize:11, color:C.muted }}>{getTariffa(az,'urgente').toFixed(2)}€</div>
                              <div style={{ textAlign:'right', color:C.green, fontWeight:700 }}>{tot.toFixed(2)}€</div>
                            </div>
                            {/* Dettaglio ECG espanso */}
                            {expanded && (
                              <div style={{ background:'#f8fafc', borderTop:`1px solid ${C.borderLight}` }}>
                                <div style={{ display:'grid', gridTemplateColumns:'1fr 90px 140px 60px 55px', padding:'6px 38px', fontSize:10, fontWeight:700, color:C.muted, textTransform:'uppercase', gap:4 }}>
                                  <div>Paziente</div><div>Data</div><div>Email</div><div style={{textAlign:'center'}}>Tipo</div><div style={{textAlign:'right'}}>€</div>
                                </div>
                                {rows.sort((a,b)=>new Date(a.created_at||a.ts)-new Date(b.created_at||b.ts)).map((e,i)=>{
                                  const isUrg = e.urgenza==='urgente';
                                  const imp = getTariffa(az, isUrg?'urgente':'normale');
                                  return (
                                    <div key={e.id||i} style={{ display:'grid', gridTemplateColumns:'1fr 90px 140px 60px 55px', padding:'7px 38px', borderTop:`1px solid ${C.borderLight}`, gap:4, alignItems:'center', background:i%2===0?'#f0f7ff':'transparent' }}>
                                      <div style={{ fontSize:12, color:C.text, fontWeight:500 }}>{e.paziente_nome||e.paziente||'—'}</div>
                                      <div style={{ fontSize:11, color:C.muted }}>{new Date(e.created_at||e.ts).toLocaleDateString('it-IT')}</div>
                                      <div style={{ fontSize:10, color:C.muted, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{e.email_destinatario||'—'}</div>
                                      <div style={{ textAlign:'center' }}>
                                        <span style={{ fontSize:9, fontWeight:700, padding:'2px 6px', borderRadius:6,
                                          background:isUrg?'#fef3c7':'#eff6ff', color:isUrg?'#d97706':'#2563eb' }}>
                                          {isUrg?'URG':'STD'}
                                        </span>
                                      </div>
                                      <div style={{ textAlign:'right', fontSize:12, fontWeight:600, color:C.green }}>{imp.toFixed(2)}€</div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {/* Totale */}
                      <div style={{ display:'grid', gridTemplateColumns:'24px 1fr 55px 55px 55px 55px 80px', padding:'14px 14px', background:C.greenLight, gap:4 }}>
                        <div/><div style={{ fontWeight:700, color:C.text }}>Totale periodo</div>
                        <div style={{ textAlign:'center', fontWeight:700, color:C.accent }}>{ecgsFiltrati.filter(e=>e.urgenza!=='urgente').length}</div>
                        <div style={{ textAlign:'center', fontWeight:700, color:'#f59e0b' }}>{ecgsFiltrati.filter(e=>e.urgenza==='urgente').length}</div>
                        <div/><div/>
                        <div style={{ textAlign:'right', color:C.green, fontWeight:700, fontSize:16 }}>{totaleGlobale.toFixed(2)}€</div>
                      </div>
                    </div>
                  )}
                  <div style={{ marginTop:8, color:C.muted, fontSize:11 }}>
                    Le tariffe sono impostate dall'amministratore. Default: 10€/ECG. Clicca su un'azienda per vedere il dettaglio ECG.
                  </div>
                </>
              );
            })()}
          </div>
        ) : !selected ? (
          <div style={{ textAlign:"center", padding:"80px 0" }}>
            <div style={{ fontSize:56, marginBottom:12 }}>🫀</div>
            <div style={{ color:C.muted, fontSize:15 }}>Seleziona un ECG dalla lista</div>
            <div style={{ color:C.mutedLight, fontSize:12, marginTop:6 }}>Vedi solo gli ECG che ti sono stati assegnati dall'admin</div>
          </div>
        ) : done ? (
          <div style={{ textAlign:"center", padding:"80px 0" }}>
            <div style={{ width:90, height:90, background:C.greenLight, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", fontSize:40, margin:"0 auto 20px" }}>✅</div>
            <div style={{ color:C.green, fontWeight:700, fontSize:22 }}>Referto inviato!</div>
            
            <button onClick={()=>{setSelected(null);setDone(false)}} style={{ marginTop:24, background:C.accent, color:C.white, border:"none", borderRadius:10, padding:"11px 28px", cursor:"pointer", fontWeight:700, fontSize:14 }}>← Prossimo ECG</button>
          </div>
        ) : (
          <div style={{ maxWidth:600 }}>
            <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap", marginBottom:14 }}>
              <Badge stato={selected.stato} urgenza={selected.urgenza} />
              <OrigineTag ecg={selected} />
              <span style={{ fontFamily:MONO, color:C.muted, fontSize:12 }}>{selected.id}</span>
            </div>
            <h2 style={{ color:C.text, fontSize:24, fontWeight:700, marginBottom:4 }}>{selected.paziente}</h2>
            <div style={{ color:C.muted, fontSize:13, marginBottom:22 }}>
              {selected.origine==="azienda"?`${selected.azienda} · ${selected.batch}`:selected.origine==="farmacia"?selected.farmacia:`Prenotazione · ${selected.appuntamento||""}`} · {fmt(selected.ts)}
            </div>
            <div style={{ marginBottom:18 }}><SLATimer ecg={ecgs.find(e=>e.id===selected.id)||selected} /></div>
            {selected.origine==="pubblico"&&selected.servizio==="score2"&&selected.risultati&&Object.keys(selected.risultati).length>0 && (
              <div style={{ background:C.pinkLight, border:`1px solid ${C.pink}33`, borderRadius:16, padding:18, marginBottom:16 }}>
                <div style={{ color:C.pink, fontSize:12, fontWeight:700, letterSpacing:1, textTransform:"uppercase", marginBottom:12 }}>📊 Dati per SCORE2</div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, fontSize:13 }}>
                  <div><span style={{ color:C.muted }}>Col. Tot:</span> <strong>{selected.risultati.colTot} mg/dL</strong></div>
                  <div><span style={{ color:C.muted }}>HDL:</span> <strong>{selected.risultati.hdl} mg/dL</strong></div>
                  <div><span style={{ color:C.muted }}>PAS:</span> <strong>{selected.risultati.pas} mmHg</strong></div>
                  <div><span style={{ color:C.muted }}>Fumatore:</span> <strong>{selected.risultati.fumatore?"Sì":"No"}</strong></div>
                </div>
              </div>
            )}
            <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:16, padding:20, marginBottom:16, boxShadow:C.shadow }}>
              <div style={{ color:C.muted, fontWeight:600, fontSize:12, marginBottom:8 }}>NOTE CLINICHE</div>
              <div style={{ color:C.text, fontSize:14 }}>{selected.note||"—"}</div>
            </div>
            <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:16, padding:20, marginBottom:0, boxShadow:C.shadow }}>
              <div style={{ color:C.muted, fontWeight:600, fontSize:12, marginBottom:16 }}>STRUMENTO DI REFERTAZIONE</div>
              <RefertazioneInline
                key={selected?.id}
                ecg={selected}
                meCardiologo={meCardiologo}
                firmaUrl={firmaUrl}
                onRefertato={(refertoFileName)=>{
                  const selectedId = selected.id;
                  const selectedBatchId = selected?.batch_id;
                  // Aggiorna stato locale e calcola prossimo
                  let prossimo = null;
                  setEcgs(prev => {
                    const updated = prev.map(e => e.id===selectedId ? {...e,stato:"refertato", file_referto_url: refertoFileName || e.file_referto_url} : e);
                    if (selectedBatchId) {
                      prossimo = updated.find(e => e.batch_id===selectedBatchId && e.stato==="in_attesa" && e.id!==selectedId);
                    }
                    return updated;
                  });
                  // Passa al prossimo ECG immediatamente, oppure mostra fine
                  if (prossimo) {
                    setSelected(prossimo);
                    setDone(false);
                  } else {
                    setSelected(null);
                    setDone(true);
                  }
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
    </div>
  );
};

// ── ADMIN ─────────────────────────────────────────────────────────────────
const AdminView = ({ ecgs, setEcgs, cardiologiDB: cardiologiProp = [] }) => {
  const [tab, setTab] = useState("assegnazioni");
  const [refreshing, setRefreshing] = useState(false);
  const [cardiologiDB, setCardiologiDB] = useState(cardiologiProp);
  const [clientiCodici, setClientiCodici] = useState([]);
  const [codiciTemp, setCodiciTemp] = useState({});
  const [salvandoCodice, setSalvandoCodice] = useState({});

  // Carica cardiologi dal DB (sia ruolo singolo che ruoli multipli)
  useEffect(() => {
    Promise.all([
      supabase.from('user_profiles').select('nome, cognome').eq('ruolo', 'cardiologo'),
      supabase.from('user_profiles').select('nome, cognome').contains('ruoli', ['cardiologo'])
    ]).then(([res1, res2]) => {
      const tutti = [...(res1.data || []), ...(res2.data || [])];
      const unici = Array.from(new Map(tutti.map(c => {
        const nome = (c.nome ? c.nome + ' ' + c.cognome : c.cognome).trim();
        return [nome, nome];
      })).values());
      setCardiologiDB(unici);
    });
  }, []);

  // Carica utenti azienda/farmacia quando si apre il tab aziende
  useEffect(() => {
    if (tab !== 'aziende') return;
    supabase.from('user_profiles')
      .select('id, nome, cognome, ruolo, codice_referti')
      .or('ruolo.eq.azienda,ruolo.eq.farmacia')
      .then(({ data, error }) => {
        if (data) {
          setClientiCodici(data);
          const init = {};
          data.forEach(u => { init[u.id] = u.codice_referti || ''; });
          setCodiciTemp(init);
        }
      });
  }, [tab]);

  const [tariffariAdmin, setTariffariAdmin] = useState({});
  const [registroEcgs, setRegistroEcgs] = useState([]);
  const [registroLoading, setRegistroLoading] = useState(false);
  const [registroDal, setRegistroDal] = useState(() => { const d=new Date(); d.setMonth(d.getMonth()-1); d.setDate(1); return d.toISOString().split('T')[0]; });
  const [registroAl, setRegistroAl] = useState(() => new Date().toISOString().split('T')[0]);
  const [registroFiltroAz, setRegistroFiltroAz] = useState('tutti');
  const [registroFiltroCard, setRegistroFiltroCard] = useState('tutti');
  const [cardiologiTariffList, setCardiologiTariffList] = useState([]); // { userId: tariffario_obj }
  const [cardiologoSelTariff, setCardiologoSelTariff] = useState('');
  const [meseCompAdmin, setMeseCompAdmin] = useState(() => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; });
  const [savingTariffAdmin, setSavingTariffAdmin] = useState(false);
  const [tariffarioAmb, setTariffarioAmb] = useState({});
  const [savingTariffAmb, setSavingTariffAmb] = useState(false);

  // Carica registro ECG quando tab attivo
  useEffect(() => {
    if (tab !== 'registro') return;
    const carica = async () => {
      setRegistroLoading(true);
      const { data } = await supabase.from('ecgs')
        .select('id, paziente_nome, created_at, origine_dettaglio, cardiologo_nome, urgenza, stato, email_destinatario, batch_nome')
        .eq('stato', 'refertato')
        .order('created_at', { ascending: false });
      setRegistroEcgs(data || []);
      setRegistroLoading(false);
    };
    carica();
  }, [tab]);

  // Carica registro ECG quando tab attivo
  useEffect(() => {
    if (tab !== 'registro') return;
    const carica = async () => {
      setRegistroLoading(true);
      const { data } = await supabase.from('ecgs')
        .select('id, paziente_nome, created_at, origine_dettaglio, cardiologo_nome, urgenza, stato, email_destinatario, batch_nome')
        .eq('stato', 'refertato')
        .order('created_at', { ascending: false });
      setRegistroEcgs(data || []);
      setRegistroLoading(false);
    };
    carica();
  }, [tab]);

  // Carica tariffari di tutti i cardiologi al mount
  useEffect(() => {
    const caricaTariffari = async () => {
      const { data, error } = await supabase.from('user_profiles')
        .select('id, nome, cognome, tariffario')
        .or('ruolo.eq.cardiologo,ruoli.cs.{cardiologo}');
      if (error) { console.error('caricaTariffari error:', error); return; }
      if (data && data.length > 0) {
        const t = {};
        data.forEach(p => { t[p.id] = typeof p.tariffario === 'string' ? JSON.parse(p.tariffario||'{}') : (p.tariffario||{}); });
        setTariffariAdmin(t);
        setCardiologiTariffList(data.map(p => ({ id: p.id, nome: `${p.nome||''} ${p.cognome||''}`.trim() })));
        setCardiologoSelTariff(prev => prev || data[0].id);
      }
    };
    caricaTariffari();
  }, []);

  const salvaTariffarioAdmin = async () => {
    if (!cardiologoSelTariff) return;
    setSavingTariffAdmin(true);
    await supabase.from('user_profiles').update({ tariffario: tariffariAdmin[cardiologoSelTariff] || {} }).eq('id', cardiologoSelTariff);
    setSavingTariffAdmin(false);
    alert('Tariffario salvato!');
  };

  const getTariffaAdmin = (userId, azienda, urgenza='normale') => {
    const t = tariffariAdmin[userId] || {};
    if (urgenza === 'urgente') { const ku=`${azienda}|urgente`; if (t[ku]!==undefined) return parseFloat(t[ku]); }
    if (t[azienda]!==undefined) return parseFloat(t[azienda]);
    return parseFloat(t['default']??10);
  };

  const getTariffaAmb = (azienda, urgenza='normale') => {
    if (urgenza === 'urgente') { const ku=`${azienda}|urgente`; if (tariffarioAmb[ku]!==undefined) return parseFloat(tariffarioAmb[ku]); }
    if (tariffarioAmb[azienda]!==undefined) return parseFloat(tariffarioAmb[azienda]);
    return parseFloat(tariffarioAmb['default']??10);
  };

  const salvaTariffarioAmb = async () => {
    setSavingTariffAmb(true);
    await supabase.from('config_ambulatorio').upsert({ id: 1, tariffario: tariffarioAmb });
    setSavingTariffAmb(false);
    alert('Tariffario ambulatorio salvato!');
  };

  const regole_assegnazione_placeholder = null; // placeholder
  const [regole, setRegole] = useState({ modalita:'manuale', cardiologo_unico:'', lunedi:'', martedi:'', mercoledi:'', giovedi:'', venerdi:'', sabato:'', domenica:'' });
  const [regoleAziende, setRegoleAziende] = useState([]);
  const [nuovaRegAz, setNuovaRegAz] = useState({ azienda:'', cardiologo:'' });
  const [salvandoRegole, setSalvandoRegole] = useState(false);

  // Carica regole assegnazione
  useEffect(() => {
    supabase.from('regole_assegnazione').select('*').single()
      .then(({ data }) => { if (data) setRegole(data); });
    supabase.from('regole_per_azienda').select('*').order('azienda_nome')
      .then(({ data }) => { if (data) setRegoleAziende(data); });
  }, []);

  // Carica tariffario ambulatorio
  useEffect(() => {
    supabase.from('config_ambulatorio').select('tariffario').eq('id', 1).single()
      .then(({ data }) => { if (data?.tariffario) setTariffarioAmb(typeof data.tariffario === 'string' ? JSON.parse(data.tariffario) : (data.tariffario||{})); });
  }, []);

  const salvaRegole = async () => {
    setSalvandoRegole(true);
    await supabase.from('regole_assegnazione').update(regole).eq('id', regole.id);
    setSalvandoRegole(false);
    alert('Regole salvate!');
  };

  const ricarica = async () => {
    setRefreshing(true);
    const { data, error } = await supabase.from('ecgs').select('*').order('created_at', { ascending: false });
    if (!error && data) {
      const mapped = data.map(e => ({
        ...e,
        paziente: `${e.paziente_nome||'?'}, ${e.paziente_eta||'?'}a, ${e.paziente_sesso||'?'}`,
        farmacia: e.origine_dettaglio,
        azienda: e.origine_dettaglio,
        batch: e.batch_nome || e.batch_id,
        batch_nome: e.batch_nome,
        ts: new Date(e.created_at).getTime(),
        cardiologo: e.cardiologo_nome||null,
        chat: [],
      }));
      setEcgs(mapped);
    }
    setRefreshing(false);
  };
  const [filtroStato, setFiltroStato] = useState("tutti");
  const [filtroOrigine, setFiltroOrigine] = useState("tutti");
  const [filtroMese, setFiltroMese] = useState("tutti");
  const [filtroAzienda, setFiltroAzienda] = useState("tutti");
  const [assegnazioneTemp, setAssegnazioneTemp] = useState({}); // ecgId -> cardiologo selezionato

  const nomi = cardiologiDB.length > 0 ? cardiologiDB : Object.keys(CARDIOLOGI_DATA);
  const inAttesa = ecgs.filter(e=>e.stato==="in_attesa");
  const refertati = ecgs.filter(e=>e.stato==="refertato");
  const nonAssegnati = inAttesa.filter(e=>!e.cardiologo);
  const assegnati = inAttesa.filter(e=>!!e.cardiologo);
  const prenotazioni = ecgs.filter(e=>e.stato==="prenotato");
  const urgenti = inAttesa.filter(e=>e.urgenza==="urgente");

  const applicaRegoleAutomatiche = async (ecgList) => {
    if (regole.modalita === 'manuale') return;
    const giorni = ['domenica','lunedi','martedi','mercoledi','giovedi','venerdi','sabato'];
    for (const ecg of ecgList) {
      if (ecg.cardiologo_nome) continue; // già assegnato
      let dest = '';
      if (regole.modalita === 'unico') {
        dest = regole.cardiologo_unico;
      } else if (regole.modalita === 'giorni') {
        const giorno = giorni[new Date(ecg.created_at).getDay()];
        dest = regole[giorno] || '';
      }
      if (dest) {
        await supabase.from('ecgs').update({ cardiologo_nome: dest }).eq('id', ecg.id);
      }
    }
  };

  const generaCodice = (id) => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const codice = Array.from({length: 8}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    setCodiciTemp(prev => ({...prev, [id]: codice}));
  };

  const salvaCodice = async (id) => {
    setSalvandoCodice(prev => ({...prev, [id]: true}));
    await supabase.from('user_profiles').update({ codice_referti: codiciTemp[id] }).eq('id', id);
    setClientiCodici(prev => prev.map(u => u.id === id ? {...u, codice_referti: codiciTemp[id]} : u));
    setSalvandoCodice(prev => ({...prev, [id]: false}));
  };

  const eliminaEcg = async (ecgId) => {
    if (!confirm("Eliminare questo ECG? L'azione non è reversibile.")) return;
    await supabase.from('ecgs').delete().eq('id', ecgId);
    setEcgs(prev => prev.filter(e => e.id !== ecgId));
  };

  const eliminaBatch = async (batchId, nomeBatch) => {
    if (!confirm(`Eliminare l'intero lotto "${nomeBatch}"? L'azione non è reversibile.`)) return;
    await supabase.from('ecgs').delete().eq('batch_id', batchId);
    setEcgs(prev => prev.filter(e => e.batch_id !== batchId));
  };

  const inviaNotificaCardiologo = async (cardiologo, count, batchNome) => {
    // Push sempre — prima di qualsiasi early return
    fetch('/api/push-send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cardiologo_nome: cardiologo,
        title: '🫀 Nuovi ECG assegnati',
        body: batchNome ? `${count} ECG del lotto "${batchNome}" da refertare` : `${count} ECG da refertare`,
      })
    }).catch(() => {});
    // Email solo per cardiologi diversi da Mansour
    if (cardiologo === 'Mansour') return;
    // Trova email del cardiologo
    const { data: profiles } = await supabase.from('user_profiles')
      .select('id, nome, cognome, ruolo, ruoli')
      .or(`ruolo.eq.cardiologo,ruoli.cs.{cardiologo}`);
    const profile = profiles?.find(p => 
      (p.nome ? p.nome + ' ' + p.cognome : p.cognome).trim() === cardiologo
    );
    if (!profile) return;
    const { data: { users } } = await supabase.auth.admin.listUsers();
    const user = users?.find(u => u.id === profile.id);
    if (!user?.email) return;
    fetch('/api/notify-cardiologo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, cardiologo, count, batchNome: batchNome || null })
    }).catch(() => {});
  };

  const assegnaBatch = async (batchId, cardiologo) => {
    if (!batchId || !cardiologo) return;
    const { error } = await supabase.from('ecgs')
      .update({ cardiologo_nome: cardiologo })
      .eq('batch_id', batchId)
      .is('cardiologo_nome', null);
    if (!error) {
      setEcgs(prev => prev.map(e => e.batch_id === batchId && !e.cardiologo ? {...e, cardiologo, cardiologo_nome: cardiologo} : e));
      // Notifica cardiologo
      const batch = ecgs.filter(e => e.batch_id === batchId);
      await inviaNotificaCardiologo(cardiologo, batch.length, batch[0]?.batch_nome || batchId);
    }
  };

  const assegna = async (ecgId) => {
    const dest = assegnazioneTemp[ecgId];
    if (!dest) return;
    const { error } = await supabase.from('ecgs').update({ cardiologo_nome: dest }).eq('id', ecgId);
    if (!error) {
      setEcgs(prev=>prev.map(e=>e.id===ecgId?{...e,cardiologo:dest,cardiologo_nome:dest}:e));
      setAssegnazioneTemp(p=>({...p,[ecgId]:undefined}));
      inviaNotificaCardiologo(dest, 1, null);
    } else {
      console.error('Errore assegnazione:', error);
    }
  };

  const riassegna = async (ecgId, nuovoCardiologo) => {
    await supabase.from('ecgs').update({ cardiologo_nome: nuovoCardiologo }).eq('id', ecgId);
    setEcgs(prev=>prev.map(e=>e.id===ecgId?{...e,cardiologo:nuovoCardiologo,cardiologo_nome:nuovoCardiologo}:e));
  };

  const tabBtn = (id,label,badge) => (
    <button onClick={()=>setTab(id)} style={{ background:tab===id?C.white:"transparent", border:tab===id?`1px solid ${C.border}`:"1px solid transparent", borderRadius:10, padding:"8px 20px", cursor:"pointer", fontFamily:SANS, fontWeight:600, fontSize:13, color:tab===id?C.accent:C.muted, boxShadow:tab===id?C.shadow:"none", display:"flex", alignItems:"center", gap:6 }}>
      {label}
      {badge>0 && <span style={{ background:tab===id?C.accent:C.muted, color:C.white, borderRadius:20, padding:"1px 8px", fontSize:11 }}>{badge}</span>}
    </button>
  );

  // Filtered ECGs for storico tab
  const ecgsFiltrati = ecgs.filter(e=>{
    if (filtroStato!=="tutti" && e.stato!==filtroStato) return false;
    if (filtroOrigine!=="tutti" && e.origine!==filtroOrigine) return false;
    if (filtroMese!=="tutti") { const d=new Date(e.created_at||e.ts); const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; if (key!==filtroMese) return false; }
    if (filtroAzienda!=="tutti") { const az=e.origine_dettaglio||e.azienda||e.farmacia||'Altro'; if (az!==filtroAzienda) return false; }
    return true;
  });
  const mesiDisponibili = [...new Set(ecgs.map(e=>{ const d=new Date(e.created_at||e.ts); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; }))].sort().reverse();
  const aziendeDisponibili = [...new Set(ecgs.map(e=>e.origine_dettaglio||e.azienda||e.farmacia||'Altro').filter(Boolean))].sort();

  return (
    <div style={{ padding:32, maxWidth:960, margin:"0 auto" }}>
      <div style={{ display:"flex", alignItems:"center", gap:16, marginBottom:28 }}>
        <div style={{ width:52, height:52, background:"linear-gradient(135deg,#e8f0fe,#e5f7f7)", borderRadius:16, display:"flex", alignItems:"center", justifyContent:"center", fontSize:26 }}>⚙️</div>
        <div><h2 style={{ color:C.text, fontSize:24, fontWeight:700 }}>Admin · Dashboard</h2><div style={{ color:C.muted, fontSize:13, marginTop:2 }}>Controllo totale · Assegnazione ECG</div></div>
      </div>

      {/* KPIs */}
      <div style={{ display:"flex", gap:12, marginBottom:24, flexWrap:"wrap" }}>
        <StatCard label="ECG totali" value={ecgs.length} color={C.accent} icon="📋" />
        <StatCard label="Non assegnati" value={nonAssegnati.length} color={nonAssegnati.length>0?C.orange:C.green} icon="📥" sub={nonAssegnati.length>0?"→ da assegnare":"✓ tutti assegnati"} />
        <StatCard label="In refertazione" value={assegnati.length} color={C.accent} icon="🫀" />
        <StatCard label="Refertati" value={refertati.length} color={C.green} icon="✅" />
        <StatCard label="Urgenti" value={urgenti.length} color={urgenti.length>0?C.red:C.green} icon="⚡" />
      </div>

      {/* Tabs */}
      <div style={{ display:"flex", gap:6, marginBottom:24, background:C.bg, borderRadius:12, padding:4, width:"fit-content", flexWrap:"wrap" }}>
        {tabBtn("assegnazioni","Assegnazioni",nonAssegnati.length)}
        {tabBtn("dashboard","Dashboard",0)}
        {tabBtn("aziende","📊 Aziende",0)}
        {tabBtn("prenotazioni","Prenotazioni",prenotazioni.length)}
        {tabBtn("storico","Storico ECG",0)}
        {tabBtn("team","Team",0)}
        {tabBtn("tariffario","💰 Tariffario",0)}
        {tabBtn("registro","📋 Registro",0)}
        {tabBtn("regole","⚙️ Assegnazione",0)}
        <button onClick={ricarica} style={{marginLeft:"auto",background:C.bg,border:`1px solid ${C.border}`,borderRadius:10,padding:"6px 14px",cursor:"pointer",color:C.muted,fontSize:13,fontWeight:600}}>
          {refreshing?"⏳":"🔄"} Aggiorna
        </button>
      </div>

      {/* ── TAB: ASSEGNAZIONI ── */}
      {tab==="assegnazioni" && (
        <div>
          {/* Lotti da assegnare */}
          {(() => {
            const batches = {};
            ecgs.filter(e=>e.batch_id && !e.cardiologo && e.stato==="in_attesa").forEach(e => {
              if (!batches[e.batch_id]) batches[e.batch_id] = { ecgs:[], azienda:e.azienda||e.origine_dettaglio||e.origine_dettaglio, batch:e.batch_nome||e.batch||e.batch_id, email:e.email_destinatario };
              batches[e.batch_id].ecgs.push(e);
            });
            const batchList = Object.entries(batches);
            if (batchList.length === 0) return null;
            return (
              <div style={{ marginBottom:24 }}>
                <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14 }}>
                  <div style={{ background:C.purpleLight, color:C.purple, borderRadius:10, padding:"4px 14px", fontWeight:700, fontSize:13 }}>📦 Lotti da assegnare — {batchList.length}</div>
                  <div style={{ color:C.muted, fontSize:12 }}>Assegna un intero lotto con un click</div>
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                  {batchList.map(([batchId, batch]) => (
                    <div key={batchId} style={{ background:C.white, border:`2px solid ${C.purple}44`, borderRadius:16, padding:"18px 22px", boxShadow:C.shadow }}>
                      <div style={{ display:"flex", alignItems:"center", gap:14, flexWrap:"wrap" }}>
                        <div style={{ flex:1 }}>
                          <div style={{ fontWeight:700, fontSize:15, color:C.text, marginBottom:4 }}>📦 {batch.batch}</div>
                          <div style={{ color:C.muted, fontSize:12 }}>{batch.azienda} · {batch.ecgs.length} ECG · referto → {batch.email||"—"}</div>
                        </div>
                        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                          <select
                            value={assegnazioneTemp[batchId]||""}
                            onChange={e=>setAssegnazioneTemp(p=>({...p,[batchId]:e.target.value}))}
                            style={{ background:C.bg, border:`1.5px solid ${C.purple}`, borderRadius:10, padding:"9px 14px", color:C.text, fontFamily:SANS, fontSize:13, outline:"none", minWidth:160 }}>
                            <option value="">Scegli cardiologo...</option>
                            {nomi.map(n=>(<option key={n} value={n}>{n}</option>))}
                          </select>
                          <button
                            onClick={()=>assegnaBatch(batchId, assegnazioneTemp[batchId])}
                            disabled={!assegnazioneTemp[batchId]}
                            style={{ background:assegnazioneTemp[batchId]?C.purple:C.border, color:assegnazioneTemp[batchId]?C.white:C.muted, border:"none", borderRadius:10, padding:"10px 18px", cursor:assegnazioneTemp[batchId]?"pointer":"not-allowed", fontWeight:700, fontSize:13, whiteSpace:"nowrap" }}>
                            Assegna lotto →
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Non assegnati singoli */}
          {nonAssegnati.filter(e=>!e.batch_id).length>0 && (
            <div style={{ marginBottom:32 }}>
              <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14 }}>
                <div style={{ background:C.orangeLight, color:C.orange, borderRadius:10, padding:"4px 14px", fontWeight:700, fontSize:13 }}>📥 ECG singoli da assegnare — {nonAssegnati.filter(e=>!e.batch_id).length}</div>
                <div style={{ color:C.muted, fontSize:12 }}>Questi ECG non sono ancora visibili a nessun cardiologo</div>
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                {nonAssegnati.filter(e=>!e.batch_id).map(ecg=>(
                  <div key={ecg.id} style={{ background:C.white, border:`2px solid ${C.orange}44`, borderRadius:16, padding:"18px 22px", boxShadow:C.shadow }}>
                    <div style={{ display:"flex", alignItems:"flex-start", gap:14, flexWrap:"wrap" }}>
                      <div style={{ flex:1, minWidth:200 }}>
                        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
                          <span style={{ fontFamily:MONO, color:C.muted, fontSize:11 }}>{ecg.id}</span>
                          <Badge stato={ecg.stato} urgenza={ecg.urgenza} />
                          <OrigineTag ecg={ecg} />
                        </div>
                        <div style={{ color:C.text, fontSize:15, fontWeight:700 }}>{ecg.paziente}</div>
                        <div style={{ color:C.muted, fontSize:12, marginTop:3 }}>
                          {ecg.origine==="farmacia"?ecg.farmacia:ecg.origine==="azienda"?`${ecg.azienda} · ${ecg.batch}`:`Prenotazione · ${ecg.appuntamento||""}`}
                          {" · "}{fmt(ecg.ts)}
                        </div>
                        {ecg.note && <div style={{ color:C.textSoft, fontSize:12, marginTop:4, fontStyle:"italic" }}>{ecg.note}</div>}
                        <div style={{ marginTop:8 }}><SLATimer ecg={ecg} compact /></div>
                      </div>
                      <div style={{ display:"flex", gap:8, alignItems:"center", flexShrink:0, flexWrap:"wrap" }}>
                        <select
                          value={assegnazioneTemp[ecg.id]||""}
                          onChange={e=>setAssegnazioneTemp(p=>({...p,[ecg.id]:e.target.value}))}
                          style={{ background:C.bg, border:`1.5px solid ${C.accent}`, borderRadius:10, padding:"9px 14px", color:C.text, fontFamily:SANS, fontSize:13, outline:"none", minWidth:160 }}>
                          <option value="">Scegli cardiologo...</option>
                          {nomi.map(n=>(
                            <option key={n} value={n}>{n}</option>
                          ))}
                        </select>
                        <button
                          onClick={()=>assegna(ecg.id)}
                          disabled={!assegnazioneTemp[ecg.id]}
                          style={{ background:assegnazioneTemp[ecg.id]?C.accent:C.border, color:assegnazioneTemp[ecg.id]?C.white:C.muted, border:"none", borderRadius:10, padding:"10px 18px", cursor:assegnazioneTemp[ecg.id]?"pointer":"not-allowed", fontWeight:700, fontSize:13, whiteSpace:"nowrap" }}>
                          Assegna →
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {nonAssegnati.length===0 && (
            <div style={{ background:C.greenLight, border:`1px solid ${C.green}33`, borderRadius:14, padding:"18px 22px", marginBottom:24, display:"flex", alignItems:"center", gap:12 }}>
              <span style={{ fontSize:24 }}>✅</span>
              <div style={{ color:C.green, fontWeight:700 }}>Tutti gli ECG in attesa sono stati assegnati</div>
            </div>
          )}

          {/* Già assegnati */}
          {assegnati.length>0 && (
            <div>
              <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14 }}>
                <div style={{ background:C.accentLight, color:C.accent, borderRadius:10, padding:"4px 14px", fontWeight:700, fontSize:13 }}>🫀 In refertazione — {assegnati.length} ECG</div>
                <div style={{ color:C.muted, fontSize:12 }}>Puoi riassegnare a un altro cardiologo in qualsiasi momento</div>
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {assegnati.map(ecg=>(
                  <div key={ecg.id} style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:14, padding:"14px 20px", boxShadow:C.shadow, display:"flex", alignItems:"center", gap:12, flexWrap:"wrap" }}>
                    <div style={{ flex:1, minWidth:180 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
                        <span style={{ fontFamily:MONO, color:C.muted, fontSize:11 }}>{ecg.id}</span>
                        <Badge stato={ecg.stato} urgenza={ecg.urgenza} />
                        <OrigineTag ecg={ecg} />
                      </div>
                      <div style={{ color:C.text, fontSize:14, fontWeight:600 }}>{ecg.paziente}</div>
                    </div>
                    <div style={{ display:"flex", alignItems:"center", gap:8, background:C.accentLight, borderRadius:10, padding:"6px 12px" }}>
                      <span style={{ fontSize:14 }}>🫀</span>
                      <span style={{ color:C.accent, fontWeight:700, fontSize:13 }}>{ecg.cardiologo}</span>
                    </div>
                    {/* Riassegna */}
                    <select
                      value={ecg.cardiologo||""}
                      onChange={e=>riassegna(ecg.id, e.target.value)}
                      style={{ background:C.bg, border:`1px solid ${C.border}`, borderRadius:8, padding:"7px 10px", color:C.muted, fontFamily:SANS, fontSize:12, outline:"none" }}>
                      {nomi.map(n=>(
                        <option key={n} value={n}>{n===ecg.cardiologo?`✓ ${n}`:n}</option>
                      ))}
                    </select>
                    <SLATimer ecg={ecg} compact />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── TAB: AZIENDE ── */}
      {tab==="aziende" && (() => {
        const clienti = {};
        const meseCorr=new Date().getMonth(), annoCorr=new Date().getFullYear();
        const mesePrec=meseCorr===0?11:meseCorr-1, annoPrec=meseCorr===0?annoCorr-1:annoCorr;
        ecgs.forEach(e=>{ const k=e.origine_dettaglio||e.farmacia||e.azienda||'Altro'; if(!clienti[k]) clienti[k]={tot:0,refertati:0,meseCurr:0,mesePrec:0,origine:e.origine}; clienti[k].tot++; if(e.stato==='refertato') clienti[k].refertati++; const d=new Date(e.created_at||e.ts); if(d.getMonth()===meseCorr&&d.getFullYear()===annoCorr) clienti[k].meseCurr++; if(d.getMonth()===mesePrec&&d.getFullYear()===annoPrec) clienti[k].mesePrec++; });
        const sorted=Object.entries(clienti).sort((a,b)=>b[1].tot-a[1].tot);
        const MESI=['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];
        return (<div>
          <div style={{fontWeight:700,fontSize:17,color:C.text,marginBottom:20}}>📊 Statistiche per cliente</div>
          <div style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:16,boxShadow:C.shadow,overflow:'hidden'}}>
            <div style={{display:'grid',gridTemplateColumns:'1fr 80px 80px 80px 80px 70px',padding:'10px 20px',background:C.cardAlt,fontSize:11,fontWeight:700,color:C.muted,textTransform:'uppercase',letterSpacing:1}}>
              <div>Cliente</div><div style={{textAlign:'center'}}>Totale</div><div style={{textAlign:'center'}}>Ref.</div><div style={{textAlign:'center'}}>{MESI[meseCorr]}</div><div style={{textAlign:'center'}}>{MESI[mesePrec]}</div><div style={{textAlign:'center'}}>% compl.</div>
            </div>
            {sorted.map(([az,s])=>{ const pct=s.tot>0?Math.round((s.refertati/s.tot)*100):0; const trend=s.meseCurr>s.mesePrec?'↑':s.meseCurr<s.mesePrec?'↓':'→'; const trendCol=trend==='↑'?C.green:trend==='↓'?C.red:C.muted; return (
              <div key={az} style={{display:'grid',gridTemplateColumns:'1fr 80px 80px 80px 80px 70px',padding:'14px 20px',borderBottom:`1px solid ${C.borderLight}`,alignItems:'center'}}>
                <div><div style={{fontSize:14,fontWeight:600,color:C.text}}>{az}</div><div style={{fontSize:11,color:C.muted,marginTop:2}}>{s.origine==='azienda'?'🏢':s.origine==='farmacia'?'💊':'👤'}</div></div>
                <div style={{textAlign:'center',fontWeight:700,color:C.text}}>{s.tot}</div>
                <div style={{textAlign:'center',fontWeight:700,color:C.green}}>{s.refertati}</div>
                <div style={{textAlign:'center'}}><span style={{fontWeight:700,color:C.accent}}>{s.meseCurr}</span><span style={{fontSize:11,color:trendCol,marginLeft:4}}>{trend}</span></div>
                <div style={{textAlign:'center',color:C.muted,fontSize:13}}>{s.mesePrec}</div>
                <div style={{textAlign:'center'}}><div style={{background:pct>=80?C.greenLight:pct>=50?C.accentLight:C.orangeLight,color:pct>=80?C.green:pct>=50?C.accent:C.orange,borderRadius:8,padding:'3px 8px',fontSize:12,fontWeight:700,display:'inline-block'}}>{pct}%</div></div>
              </div>
            );})}
            {sorted.length===0&&<div style={{textAlign:'center',padding:40,color:C.muted}}>Nessun dato</div>}
          </div>

          {/* ── GESTIONE CODICI DOWNLOAD ── */}
          <hr style={{ border:'none', borderTop:`1px solid ${C.border}`, margin:'32px 0 24px' }} />
          <div style={{ fontWeight:700, fontSize:17, color:C.text, marginBottom:6 }}>🔑 Gestione codici download</div>
          <div style={{ color:C.muted, fontSize:13, marginBottom:20 }}>Ogni cliente usa il proprio codice per scaricare i referti dal portale.</div>
          <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:16, boxShadow:C.shadow, overflow:'hidden' }}>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 100px 180px 160px', padding:'10px 20px', background:C.cardAlt, fontSize:11, fontWeight:700, color:C.muted, textTransform:'uppercase', letterSpacing:1 }}>
              <div>Cliente</div><div>Ruolo</div><div>Codice download</div><div>Azioni</div>
            </div>
            {clientiCodici.length === 0 && (
              <div style={{ padding:'24px 20px', color:C.muted, fontSize:13 }}>Nessun cliente registrato</div>
            )}
            {clientiCodici.map(u => (
              <div key={u.id} style={{ display:'grid', gridTemplateColumns:'1fr 100px 180px 160px', padding:'14px 20px', borderTop:`1px solid ${C.border}`, alignItems:'center', gap:8 }}>
                <div style={{ fontWeight:600, fontSize:14, color:C.text }}>{`${u.nome||''} ${u.cognome||''}`.trim() || '—'}</div>
                <div>
                  <span style={{ background: u.ruolo==='azienda' ? C.accentLight : C.greenLight, color: u.ruolo==='azienda' ? C.accent : C.green, borderRadius:20, padding:'3px 10px', fontSize:11, fontWeight:700 }}>
                    {u.ruolo==='azienda' ? '🏢 Azienda' : '💊 Farmacia'}
                  </span>
                </div>
                <div>
                  <input
                    value={codiciTemp[u.id] || ''}
                    onChange={e => setCodiciTemp(prev => ({...prev, [u.id]: e.target.value.toUpperCase()}))}
                    style={{ ...inputStyle, fontFamily:MONO, fontSize:13, letterSpacing:2, textTransform:'uppercase', width:'100%', boxSizing:'border-box' }}
                    placeholder="—"
                  />
                </div>
                <div style={{ display:'flex', gap:8 }}>
                  <button onClick={() => generaCodice(u.id)} style={{ background:C.bg, border:`1px solid ${C.border}`, borderRadius:8, padding:'7px 12px', fontSize:12, fontWeight:600, color:C.muted, cursor:'pointer' }}>
                    🎲 Genera
                  </button>
                  <button onClick={() => salvaCodice(u.id)} disabled={salvandoCodice[u.id]} style={{ background:C.accent, color:C.white, border:'none', borderRadius:8, padding:'7px 12px', fontSize:12, fontWeight:700, cursor:'pointer', opacity: salvandoCodice[u.id] ? 0.6 : 1 }}>
                    {salvandoCodice[u.id] ? '...' : '💾 Salva'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>);
      })()}

      {/* ── TAB: DASHBOARD ── */}
      {tab==="dashboard" && (
        <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
          {/* KPI ricavi */}
          {(()=>{ const oggi=new Date(); const meseCorr=ecgs.filter(e=>{ const d=new Date(e.created_at||e.ts); return d.getMonth()===oggi.getMonth()&&d.getFullYear()===oggi.getFullYear()&&e.stato==='refertato'; }); const MESI=['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic']; const ultimi6=Array.from({length:6},(_,i)=>{ const d=new Date(oggi); d.setMonth(d.getMonth()-5+i); return {anno:d.getFullYear(),mese:d.getMonth(),label:MESI[d.getMonth()]}; }); const countPerMese=ultimi6.map(({anno,mese})=>({ label:MESI[mese], tot:ecgs.filter(e=>{ const d=new Date(e.created_at||e.ts); return d.getFullYear()===anno&&d.getMonth()===mese; }).length, ref:ecgs.filter(e=>{ const d=new Date(e.created_at||e.ts); return d.getFullYear()===anno&&d.getMonth()===mese&&e.stato==='refertato'; }).length })); const maxVal=Math.max(...countPerMese.map(m=>m.tot),1); const byOrigine={azienda:0,farmacia:0,pubblico:0}; ecgs.forEach(e=>{ if(byOrigine[e.origine]!==undefined) byOrigine[e.origine]++; }); const totOrig=Object.values(byOrigine).reduce((a,b)=>a+b,0)||1; return (<>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:12}}>
              {[{label:'Margine mese',value:`${meseCorr.reduce((s,e)=>{const urg=e.urgenza==='urgente'?'urgente':'normale';const az=e.origine_dettaglio||e.origine;const card=cardiologiTariffList.find(c=>c.nome===e.cardiologo_nome);return s+getTariffaAmb(az,urg)-(card?getTariffaAdmin(card.id,az,urg):0);},0).toFixed(0)}€`,color:C.green,icon:'💶',sub:'ricavi ambulatorio - compensi'},{label:'Margine anno',value:`${ecgs.filter(e=>{ const d=new Date(e.created_at||e.ts); return d.getFullYear()===oggi.getFullYear()&&e.stato==='refertato';}).reduce((s,e)=>{const urg=e.urgenza==='urgente'?'urgente':'normale';const az=e.origine_dettaglio||e.origine;const card=cardiologiTariffList.find(c=>c.nome===e.cardiologo_nome);return s+getTariffaAmb(az,urg)-(card?getTariffaAdmin(card.id,az,urg):0);},0).toFixed(0)}€`,color:C.teal,icon:'📈',sub:String(oggi.getFullYear())},{label:'ECG mese',value:meseCorr.length,color:C.accent,icon:'🫀',sub:'refertati'},{label:'Clienti attivi',value:new Set(ecgs.map(e=>e.origine_dettaglio||e.farmacia||'Altro').filter(Boolean)).size,color:C.purple,icon:'🏢',sub:'aziende/farmacie'}].map(({label,value,color,icon,sub})=>(
                <div key={label} style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:14,padding:'16px 18px',boxShadow:C.shadow}}>
                  <div style={{fontSize:20,marginBottom:6}}>{icon}</div><div style={{fontSize:24,fontWeight:700,color}}>{value}</div><div style={{fontSize:12,fontWeight:600,color:C.text,marginTop:2}}>{label}</div><div style={{fontSize:11,color:C.muted}}>{sub}</div>
                </div>))}
            </div>
            <div style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:14,padding:'20px 22px',boxShadow:C.shadow}}>
              <div style={{fontWeight:700,fontSize:14,color:C.text,marginBottom:16}}>📊 ECG ultimi 6 mesi</div>
              <div style={{display:'flex',alignItems:'flex-end',gap:10,height:120}}>
                {countPerMese.map(({label,tot,ref})=>(<div key={label} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:4}}>
                  <div style={{fontSize:11,fontWeight:700,color:C.accent}}>{tot||''}</div>
                  <div style={{width:'100%',display:'flex',gap:2,alignItems:'flex-end',height:90}}>
                    <div style={{flex:1,background:C.accentLight,borderRadius:'4px 4px 0 0',height:`${Math.round((tot/maxVal)*90)}px`,minHeight:tot>0?4:0,position:'relative'}}>
                      <div style={{position:'absolute',bottom:0,left:0,right:0,background:C.green,borderRadius:'4px 4px 0 0',height:`${Math.round((ref/maxVal)*90)}px`}}/>
                    </div>
                  </div>
                  <div style={{fontSize:11,color:C.muted}}>{label}</div>
                </div>))}
              </div>
              <div style={{display:'flex',gap:16,marginTop:10}}>
                <div style={{display:'flex',alignItems:'center',gap:6,fontSize:11,color:C.muted}}><div style={{width:10,height:10,background:C.accentLight,borderRadius:2}}/> Totali</div>
                <div style={{display:'flex',alignItems:'center',gap:6,fontSize:11,color:C.muted}}><div style={{width:10,height:10,background:C.green,borderRadius:2}}/> Refertati</div>
              </div>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
              <div style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:14,padding:'20px 22px',boxShadow:C.shadow}}>
                <div style={{fontWeight:700,fontSize:14,color:C.text,marginBottom:16}}>🥧 Ripartizione ECG</div>
                {[{k:'azienda',label:'Azienda',color:C.purple},{k:'farmacia',label:'Farmacia',color:C.teal},{k:'pubblico',label:'Pubblico',color:'#e03e5a'}].map(({k,label,color})=>{ const pct=Math.round((byOrigine[k]/totOrig)*100); return (<div key={k} style={{marginBottom:10}}><div style={{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:4}}><span style={{color:C.textSoft,fontWeight:600}}>{label}</span><span style={{color,fontWeight:700}}>{byOrigine[k]} ({pct}%)</span></div><div style={{background:C.bg,borderRadius:20,height:8}}><div style={{height:'100%',width:`${pct}%`,background:color,borderRadius:20}}/></div></div>); })}
              </div>
              <div style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:14,padding:'20px 22px',boxShadow:C.shadow}}>
                <div style={{fontWeight:700,fontSize:14,color:C.text,marginBottom:16}}>🏆 Top clienti</div>
                {Object.entries(ecgs.reduce((acc,e)=>{ const k=e.origine_dettaglio||e.farmacia||'Altro'; acc[k]=(acc[k]||0)+1; return acc; },{})).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([az,count],i)=>(
                  <div key={az} style={{display:'flex',alignItems:'center',gap:10,marginBottom:8}}>
                    <div style={{width:22,height:22,background:i===0?'#fff8e1':C.bg,border:`1px solid ${i===0?C.yellow:C.border}`,borderRadius:6,display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700,color:i===0?C.yellow:C.muted,flexShrink:0}}>{i+1}</div>
                    <div style={{flex:1,fontSize:12,color:C.text,fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{az}</div>
                    <div style={{background:C.accentLight,color:C.accent,borderRadius:8,padding:'2px 8px',fontSize:12,fontWeight:700}}>{count}</div>
                  </div>
                ))}
              </div>
            </div>
          </>); })()}
          {/* Storage indicator */}
          {(() => {
            const refertati = ecgs.filter(e=>e.stato==="refertato" && e.file_referto_url).length;
            const inAttesa = ecgs.filter(e=>e.stato==="in_attesa" && e.file_ecg_url).length;
            const stimaMB = Math.round(refertati * 1.5 + inAttesa * 0.7);
            const percentuale = Math.min(100, Math.round((stimaMB / 1024) * 100));
            const colore = percentuale > 80 ? "#e03e5a" : percentuale > 60 ? "#f59e0b" : C.green;
            return (
              <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:14, padding:"14px 20px", boxShadow:C.shadow }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                  <div style={{ fontWeight:700, fontSize:13, color:C.text }}>💾 Storage utilizzato (stima)</div>
                  <div style={{ fontWeight:700, fontSize:13, color:colore }}>{stimaMB} MB / 1024 MB</div>
                </div>
                <div style={{ background:C.bg, borderRadius:20, height:8, overflow:"hidden" }}>
                  <div style={{ height:"100%", width:`${percentuale}%`, background:colore, borderRadius:20, transition:"width 0.5s" }} />
                </div>
                <div style={{ color:C.muted, fontSize:11, marginTop:6 }}>
                  {percentuale < 60 ? "✅ Spazio sufficiente" : percentuale < 80 ? "⚠️ Monitora lo spazio" : "🔴 Considera upgrade a Piano Pro Supabase (25$/mese)"}
                </div>
              </div>
            );
          })()}
          <h3 style={{ color:C.text, fontWeight:700, fontSize:17, marginBottom:4 }}>Performance cardiologi</h3>
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {nomi.map(nome=>{
              const miei = ecgs.filter(e=>e.cardiologo===nome);
              const fatti = miei.filter(e=>e.stato==="refertato").length;
              const inCorso = miei.filter(e=>e.stato==="in_attesa").length;
              return (
                <div key={nome} style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:16, padding:"18px 24px", boxShadow:C.shadow, display:"flex", alignItems:"center", gap:16, flexWrap:"wrap" }}>
                  <div style={{ width:44, height:44, background:C.accentLight, borderRadius:12, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>🫀</div>
                  <div style={{ flex:1, minWidth:160 }}>
                    <div style={{ color:C.text, fontWeight:700, fontSize:15 }}>{nome}</div>
                    <div style={{ color:C.muted, fontSize:12, marginTop:2 }}>{fatti} referti completati</div>
                  </div>
                  <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
                    <div style={{ textAlign:"center", background:C.greenLight, borderRadius:10, padding:"8px 14px" }}>
                      <div style={{ color:C.green, fontWeight:700, fontFamily:MONO, fontSize:18 }}>{fatti}</div>
                      <div style={{ color:C.muted, fontSize:10, textTransform:"uppercase" }}>refertati</div>
                    </div>
                    <div style={{ textAlign:"center", background:inCorso>0?C.accentLight:C.bg, borderRadius:10, padding:"8px 14px" }}>
                      <div style={{ color:inCorso>0?C.accent:C.muted, fontWeight:700, fontFamily:MONO, fontSize:18 }}>{inCorso}</div>
                      <div style={{ color:C.muted, fontSize:10, textTransform:"uppercase" }}>in corso</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── TAB: PRENOTAZIONI ── */}
      {tab==="prenotazioni" && (
        <div>
          <h3 style={{ color:C.text, fontWeight:700, fontSize:17, marginBottom:14 }}>Prenotazioni online dal pubblico</h3>
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {prenotazioni.map(ecg=>(
              <div key={ecg.id} style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:14, padding:"16px 22px", boxShadow:C.shadow, display:"flex", alignItems:"center", gap:14, flexWrap:"wrap" }}>
                <div style={{ width:46, height:46, background:ecg.servizio==="score2"?C.pinkLight:C.tealLight, borderRadius:12, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22 }}>{ecg.servizio==="score2"?"📊":"🫀"}</div>
                <div style={{ flex:1, minWidth:160 }}>
                  <div style={{ color:C.text, fontWeight:700, fontSize:15 }}>{ecg.paziente}</div>
                  <div style={{ color:C.muted, fontSize:12, marginTop:2 }}>{ecg.servizio==="score2"?"Stima rischio CV (SCORE2)":"ECG con referto"}</div>
                </div>
                <div style={{ background:C.cardAlt, borderRadius:10, padding:"6px 14px", fontFamily:MONO, fontSize:12, color:C.text, fontWeight:600 }}>📅 {ecg.appuntamento}</div>
                <div style={{ display:"flex", gap:8 }}>
                  <span style={{ background:C.yellowLight, color:C.yellow, border:`1px solid ${C.yellow}33`, borderRadius:20, padding:"3px 12px", fontSize:12, fontWeight:600 }}>⏳ Da confermare</span>
                  <button onClick={()=>setEcgs(prev=>prev.map(e=>e.id===ecg.id?{...e,stato:"in_attesa"}:e))} style={{ background:C.accentLight, color:C.accent, border:`1px solid ${C.accent}33`, borderRadius:20, padding:"3px 12px", fontSize:12, fontWeight:700, cursor:"pointer" }}>✓ Conferma</button>
                </div>
              </div>
            ))}
            {prenotazioni.length===0 && <div style={{ textAlign:"center", padding:40, color:C.muted }}>Nessuna prenotazione in attesa di conferma</div>}
          </div>
        </div>
      )}

      {/* ── TAB: STORICO ── */}
      {tab==="storico" && (
        <div>
          {/* Statistiche mensili per azienda */}
          {(() => {
            const refertati = ecgs.filter(e => e.stato === "refertato");
            const perAzienda = {};
            refertati.forEach(e => {
              const azienda = e.origine_dettaglio || e.azienda || e.farmacia || e.origine || "Altro";
              const mese = new Date(e.created_at || e.ts).toLocaleDateString("it-IT", { month: "long", year: "numeric" });
              if (!perAzienda[azienda]) perAzienda[azienda] = {};
              if (!perAzienda[azienda][mese]) perAzienda[azienda][mese] = 0;
              perAzienda[azienda][mese]++;
            });
            if (Object.keys(perAzienda).length === 0) return null;
            return (
              <div style={{ marginBottom:24 }}>
                <div style={{ fontWeight:700, fontSize:15, color:C.text, marginBottom:12 }}>📊 Statistiche referti completati</div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:12 }}>
                  {Object.entries(perAzienda).map(([azienda, mesi]) => (
                    <div key={azienda} style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:14, padding:16, minWidth:200, boxShadow:C.shadow }}>
                      <div style={{ fontWeight:700, fontSize:13, color:C.text, marginBottom:10 }}>🏢 {azienda}</div>
                      {Object.entries(mesi).sort().reverse().map(([mese, count]) => (
                        <div key={mese} style={{ display:"flex", justifyContent:"space-between", fontSize:12, color:C.muted, marginBottom:4 }}>
                          <span>{mese}</span>
                          <span style={{ fontWeight:700, color:C.accent }}>{count} referti</span>
                        </div>
                      ))}
                      <div style={{ marginTop:8, borderTop:`1px solid ${C.borderLight}`, paddingTop:6, display:"flex", justifyContent:"space-between", fontSize:12 }}>
                        <span style={{ fontWeight:600, color:C.textSoft }}>Totale</span>
                        <span style={{ fontWeight:700, color:C.green }}>{Object.values(mesi).reduce((a,b)=>a+b,0)} referti</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          <div style={{ display:"flex", gap:8, marginBottom:8, flexWrap:"wrap" }}>
            {[["tutti","Tutti"],["in_attesa","In attesa"],["refertato","Refertati"],["prenotato","Prenotazioni"]].map(([v,l])=>(
              <button key={v} onClick={()=>setFiltroStato(v)} style={{ background:filtroStato===v?C.accent:C.white, color:filtroStato===v?C.white:C.muted, border:`1px solid ${filtroStato===v?C.accent:C.border}`, borderRadius:20, padding:"6px 16px", cursor:"pointer", fontWeight:600, fontSize:12 }}>{l}</button>
            ))}
            <div style={{ width:1, background:C.border }} />
            {[["tutti","Tutti"],["farmacia","💊 Farmacia"],["azienda","🏢 Azienda"],["pubblico","👤 Pubblico"]].map(([v,l])=>(
              <button key={v} onClick={()=>setFiltroOrigine(v)} style={{ background:filtroOrigine===v?C.teal:C.white, color:filtroOrigine===v?C.white:C.muted, border:`1px solid ${filtroOrigine===v?C.teal:C.border}`, borderRadius:20, padding:"6px 16px", cursor:"pointer", fontWeight:600, fontSize:12 }}>{l}</button>
            ))}
          </div>
          <div style={{ display:"flex", gap:8, marginBottom:16, flexWrap:"wrap", alignItems:"center" }}>
            <span style={{fontSize:12,color:C.muted,fontWeight:600}}>Mese:</span>
            <select value={filtroMese} onChange={e=>setFiltroMese(e.target.value)} style={{border:`1px solid ${C.border}`,borderRadius:20,padding:"5px 12px",fontSize:12,color:C.text,background:C.white,cursor:"pointer"}}>
              <option value="tutti">Tutti</option>
              {mesiDisponibili.map(m=>{ const [a,mo]=m.split('-'); const mn=['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'][Number(mo)-1]; return <option key={m} value={m}>{mn} {a}</option>; })}
            </select>
            <span style={{fontSize:12,color:C.muted,fontWeight:600}}>Cliente:</span>
            <select value={filtroAzienda} onChange={e=>setFiltroAzienda(e.target.value)} style={{border:`1px solid ${C.border}`,borderRadius:20,padding:"5px 12px",fontSize:12,color:C.text,background:C.white,cursor:"pointer"}}>
              <option value="tutti">Tutti</option>
              {aziendeDisponibili.map(az=><option key={az} value={az}>{az}</option>)}
            </select>
            {(filtroMese!=="tutti"||filtroAzienda!=="tutti") && <button onClick={()=>{setFiltroMese("tutti");setFiltroAzienda("tutti");}} style={{background:C.redLight,color:C.red,border:"none",borderRadius:20,padding:"5px 12px",cursor:"pointer",fontSize:12,fontWeight:600}}>✕ Reset</button>}
            <span style={{fontSize:12,color:C.muted,marginLeft:"auto"}}>{ecgsFiltrati.length} ECG</span>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {ecgsFiltrati.map(ecg=>(
              <div key={ecg.id} style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:14, padding:"14px 20px", boxShadow:C.shadow, display:"flex", alignItems:"center", gap:12, flexWrap:"wrap" }}>
                <div style={{ flex:1, minWidth:180 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:5 }}>
                    <span style={{ fontFamily:MONO, color:C.muted, fontSize:11 }}>{ecg.id}</span>
                    <Badge stato={ecg.stato} urgenza={ecg.urgenza} />
                    <OrigineTag ecg={ecg} />
                  </div>
                  <div style={{ color:C.text, fontSize:14, fontWeight:600 }}>{ecg.paziente}</div>
                  <div style={{ color:C.muted, fontSize:12, marginTop:2 }}>{fmt(ecg.ts)}</div>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  {ecg.cardiologo
                    ? <div style={{ background:C.accentLight, color:C.accent, borderRadius:10, padding:"6px 12px", fontSize:12, fontWeight:600 }}>🫀 {ecg.cardiologo}</div>
                    : ecg.stato!=="prenotato" && <div style={{ background:C.orangeLight, color:C.orange, borderRadius:10, padding:"6px 12px", fontSize:12, fontWeight:600 }}>⚠ Non assegnato</div>
                  }
                  <button onClick={()=>eliminaEcg(ecg.id)} style={{ background:"#fdedf0", color:"#e03e5a", border:"1px solid #e03e5a33", borderRadius:8, padding:"5px 10px", cursor:"pointer", fontSize:12, fontWeight:600 }}>🗑</button>
                </div>
              </div>
            ))}
            {ecgsFiltrati.length===0 && <div style={{ textAlign:"center", padding:40, color:C.muted }}>Nessun ECG trovato</div>}
          </div>
        </div>
      )}

      {/* ── TAB: TEAM ── */}
      {tab==="registro" && (() => {
        const aziendeReg = ['tutti', ...new Set(registroEcgs.map(e=>e.origine_dettaglio||'Altro').filter(Boolean))].sort();
        const cardioReg  = ['tutti', ...new Set(registroEcgs.map(e=>e.cardiologo_nome||'').filter(Boolean))].sort();
        const filtrati = registroEcgs.filter(e => {
          const d = new Date(e.created_at);
          const dal = new Date(registroDal); dal.setHours(0,0,0,0);
          const al  = new Date(registroAl);  al.setHours(23,59,59,999);
          if (d < dal || d > al) return false;
          if (registroFiltroAz !== 'tutti' && (e.origine_dettaglio||'') !== registroFiltroAz) return false;
          if (registroFiltroCard !== 'tutti' && (e.cardiologo_nome||'') !== registroFiltroCard) return false;
          return true;
        });

        const esportaRegistroPDF = () => {
          const pdf = new jsPDF({ unit:'mm', format:'a4', orientation:'landscape' });
          const W=297, mar=14;
          // Header
          pdf.setFillColor(37,87,54); pdf.rect(0,0,W,18,'F');
          pdf.setTextColor(255,255,255); pdf.setFontSize(14); pdf.setFont('helvetica','bold');
          pdf.text('REGISTRO ECG REFERTATI — Ambulatorio Millefonti', mar, 12);
          pdf.setFontSize(8); pdf.setFont('helvetica','normal');
          pdf.text(`Generato il ${new Date().toLocaleDateString('it-IT')} · Periodo: ${registroDal} → ${registroAl}`, W-mar, 12, {align:'right'});
          // Filtri applicati
          pdf.setFillColor(244,247,250); pdf.rect(0,18,W,10,'F');
          pdf.setTextColor(107,125,153); pdf.setFontSize(8);
          pdf.text(`Azienda: ${registroFiltroAz==='tutti'?'Tutte':registroFiltroAz}   Cardiologo: ${registroFiltroCard==='tutti'?'Tutti':registroFiltroCard}   Totale: ${filtrati.length} ECG`, mar, 25);
          // Intestazione tabella
          let y = 34;
          pdf.setFillColor(37,87,54); pdf.rect(mar,y-6,W-mar*2,8,'F');
          pdf.setTextColor(255,255,255); pdf.setFontSize(8); pdf.setFont('helvetica','bold');
          pdf.text('PAZIENTE', mar+2, y-0.5);
          pdf.text('DATA', 68, y-0.5);
          pdf.text('AZIENDA', 84, y-0.5);
          pdf.text('CARDIOLOGO', 148, y-0.5);
          pdf.text('LOTTO', 180, y-0.5);
          pdf.text('TIPO', 232, y-0.5);
          pdf.text('EMAIL DEST.', 244, y-0.5);
          y += 6;
          // Righe ECG
          filtrati.forEach((e, idx) => {
            if (y > 190) { pdf.addPage('landscape'); y = 20; }
            if (idx%2===0) { pdf.setFillColor(248,250,252); pdf.rect(mar,y-4,W-mar*2,8,'F'); }
            pdf.setTextColor(26,38,64); pdf.setFontSize(8); pdf.setFont('helvetica','normal');
            const nome = (e.paziente_nome||'—').substring(0,22);
            const data = new Date(e.created_at).toLocaleDateString('it-IT');
            const az   = (e.origine_dettaglio||'—').substring(0,28);
            const card = (e.cardiologo_nome||'—').substring(0,18);
            const lotto= (e.batch_nome||'—').substring(0,18);
            const mail = (e.email_destinatario||'—').substring(0,20);
            const isUrg= e.urgenza==='urgente';
            pdf.text(nome, mar+2, y);
            pdf.text(data, 68, y);
            pdf.text(az, 84, y);
            pdf.text(card, 148, y);
            pdf.text(lotto, 180, y);
            pdf.setTextColor(isUrg?200:46, isUrg?100:124, isUrg?20:246);
            pdf.setFont('helvetica','bold');
            pdf.text(isUrg?'URG':'STD', 232, y);
            pdf.setTextColor(107,125,153); pdf.setFont('helvetica','normal');
            pdf.text(mail, 244, y);
            y += 8;
          });
          // Footer
          pdf.setFillColor(37,87,54); pdf.rect(0,200,W,10,'F');
          pdf.setTextColor(255,255,255); pdf.setFontSize(7);
          pdf.text('Ambulatorio Millefonti — Registro permanente ECG refertati — dati non contenenti allegati sanitari', W/2, 206, {align:'center'});
          pdf.save(`Registro_ECG_${registroDal}_${registroAl}.pdf`);
        };

        return (
          <div style={{display:'flex',flexDirection:'column',gap:16}}>
            {/* Header */}
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:12}}>
              <div>
                <div style={{fontWeight:700,fontSize:18,color:C.text}}>📋 Registro ECG Refertati</div>
                <div style={{color:C.muted,fontSize:13,marginTop:2}}>Registro permanente — sopravvive all'eliminazione dei file allegati</div>
              </div>
              <button onClick={esportaRegistroPDF} disabled={filtrati.length===0}
                style={{background:filtrati.length===0?C.border:'linear-gradient(135deg,#1a2640,#2d4a8a)',color:'white',border:'none',borderRadius:12,padding:'10px 20px',cursor:filtrati.length===0?'not-allowed':'pointer',fontWeight:700,fontSize:13}}>
                📄 Esporta PDF Registro
              </button>
            </div>
            {/* Filtri */}
            <div style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:16,padding:18,boxShadow:C.shadow}}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:12,alignItems:'end'}}>
                <div>
                  <div style={{fontSize:11,fontWeight:700,color:C.muted,marginBottom:6,textTransform:'uppercase'}}>Dal</div>
                  <input type="date" value={registroDal} onChange={e=>setRegistroDal(e.target.value)}
                    style={{width:'100%',border:`1.5px solid ${C.border}`,borderRadius:10,padding:'8px 10px',fontSize:13,color:C.text}}/>
                </div>
                <div>
                  <div style={{fontSize:11,fontWeight:700,color:C.muted,marginBottom:6,textTransform:'uppercase'}}>Al</div>
                  <input type="date" value={registroAl} onChange={e=>setRegistroAl(e.target.value)}
                    style={{width:'100%',border:`1.5px solid ${C.border}`,borderRadius:10,padding:'8px 10px',fontSize:13,color:C.text}}/>
                </div>
                <div>
                  <div style={{fontSize:11,fontWeight:700,color:C.muted,marginBottom:6,textTransform:'uppercase'}}>Azienda</div>
                  <select value={registroFiltroAz} onChange={e=>setRegistroFiltroAz(e.target.value)}
                    style={{width:'100%',border:`1.5px solid ${C.border}`,borderRadius:10,padding:'8px 10px',fontSize:13,color:C.text,background:C.white,cursor:'pointer'}}>
                    {aziendeReg.map(a=><option key={a} value={a}>{a==='tutti'?'Tutte le aziende':a}</option>)}
                  </select>
                </div>
                <div>
                  <div style={{fontSize:11,fontWeight:700,color:C.muted,marginBottom:6,textTransform:'uppercase'}}>Cardiologo</div>
                  <select value={registroFiltroCard} onChange={e=>setRegistroFiltroCard(e.target.value)}
                    style={{width:'100%',border:`1.5px solid ${C.border}`,borderRadius:10,padding:'8px 10px',fontSize:13,color:C.text,background:C.white,cursor:'pointer'}}>
                    {cardioReg.map(c=><option key={c} value={c}>{c==='tutti'?'Tutti i cardiologi':c}</option>)}
                  </select>
                </div>
              </div>
              <div style={{marginTop:10,color:C.muted,fontSize:12}}>{filtrati.length} ECG trovati nel periodo selezionato</div>
            </div>
            {/* Tabella */}
            {registroLoading ? (
              <div style={{textAlign:'center',padding:40,color:C.muted}}>⏳ Caricamento...</div>
            ) : filtrati.length === 0 ? (
              <div style={{textAlign:'center',padding:40,color:C.muted,background:C.white,borderRadius:16,boxShadow:C.shadow}}>Nessun ECG trovato con i filtri selezionati</div>
            ) : (
              <div style={{background:C.white,borderRadius:16,boxShadow:C.shadow,overflow:'hidden'}}>
                <div style={{display:'grid',gridTemplateColumns:'1.2fr 80px 1.4fr 100px 100px 55px',padding:'9px 16px',background:C.cardAlt,fontSize:10,fontWeight:700,color:C.muted,textTransform:'uppercase',letterSpacing:0.5,gap:8}}>
                  <div>Paziente</div><div>Data</div><div>Azienda</div><div>Cardiologo</div><div>Email dest.</div><div style={{textAlign:'center'}}>Tipo</div>
                </div>
                {filtrati.map((e,idx)=>(
                  <div key={e.id} style={{display:'grid',gridTemplateColumns:'1.2fr 80px 1.4fr 100px 100px 55px',padding:'10px 16px',borderBottom:`1px solid ${C.borderLight}`,alignItems:'center',gap:8,background:idx%2===0?C.white:'#f9fbff'}}>
                    <div style={{fontSize:13,fontWeight:600,color:C.text}}>{e.paziente_nome||'—'}</div>
                    <div style={{fontSize:11,color:C.muted,whiteSpace:'nowrap'}}>{new Date(e.created_at).toLocaleDateString('it-IT')}</div>
                    <div style={{fontSize:12,color:C.text}}>{e.origine_dettaglio||'—'}</div>
                    <div style={{fontSize:12,color:C.accent,fontWeight:600}}>{e.cardiologo_nome||'—'}</div>
                    <div style={{fontSize:11,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{e.email_destinatario||'—'}</div>
                    <div style={{textAlign:'center'}}>
                      <span style={{fontSize:9,fontWeight:700,padding:'2px 6px',borderRadius:6,
                        background:e.urgenza==='urgente'?'#fef3c7':'#eff6ff',
                        color:e.urgenza==='urgente'?'#d97706':'#2563eb'}}>
                        {e.urgenza==='urgente'?'URG':'STD'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {tab==="regole" && (
        <div>
          <div style={{fontWeight:700,fontSize:17,color:C.text,marginBottom:20}}>⚙️ Regole assegnazione automatica</div>

          {/* Modalità */}
          <div style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:16,padding:20,marginBottom:16,boxShadow:C.shadow}}>
            <div style={{fontWeight:700,fontSize:14,color:C.text,marginBottom:14}}>Modalità</div>
            <div style={{display:"flex",gap:10,marginBottom:20}}>
              {[["manuale","🖐 Manuale"],["unico","👤 Cardiologo unico"],["giorni","📅 Per giorni"]].map(([v,l])=>(
                <button key={v} onClick={()=>setRegole(r=>({...r,modalita:v}))}
                  style={{flex:1,padding:"10px",borderRadius:10,cursor:"pointer",fontWeight:600,fontSize:13,border:`2px solid ${regole.modalita===v?C.accent:C.border}`,background:regole.modalita===v?C.accentLight:C.bg,color:regole.modalita===v?C.accent:C.muted}}>
                  {l}
                </button>
              ))}
            </div>

            {/* Cardiologo unico */}
            {regole.modalita==="unico" && (
              <div>
                <div style={{color:C.textSoft,fontWeight:600,fontSize:13,marginBottom:8}}>Assegna sempre a:</div>
                <select value={regole.cardiologo_unico||""} onChange={e=>setRegole(r=>({...r,cardiologo_unico:e.target.value}))}
                  style={{background:C.bg,border:`1.5px solid ${C.border}`,borderRadius:10,padding:"10px 14px",color:C.text,fontFamily:SANS,fontSize:13,outline:"none",width:"100%"}}>
                  <option value="">Scegli cardiologo...</option>
                  {nomi.map(n=>(<option key={n} value={n}>{n}</option>))}
                </select>
              </div>
            )}

            {/* Per giorni */}
            {regole.modalita==="giorni" && (
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                {[["lunedi","Lunedì"],["martedi","Martedì"],["mercoledi","Mercoledì"],["giovedi","Giovedì"],["venerdi","Venerdì"],["sabato","Sabato"],["domenica","Domenica"]].map(([k,label])=>(
                  <div key={k} style={{display:"flex",alignItems:"center",gap:12}}>
                    <div style={{width:100,fontWeight:600,fontSize:13,color:C.textSoft}}>{label}</div>
                    <select value={regole[k]||""} onChange={e=>setRegole(r=>({...r,[k]:e.target.value}))}
                      style={{flex:1,background:C.bg,border:`1.5px solid ${C.border}`,borderRadius:10,padding:"8px 12px",color:C.text,fontFamily:SANS,fontSize:13,outline:"none"}}>
                      <option value="">Nessuno (manuale)</option>
                      {nomi.map(n=>(<option key={n} value={n}>{n}</option>))}
                    </select>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button onClick={salvaRegole} disabled={salvandoRegole}
            style={{background:C.accent,color:C.white,border:"none",borderRadius:12,padding:"13px 0",cursor:"pointer",fontWeight:700,fontSize:14,width:"100%",boxShadow:`0 4px 16px ${C.accent}44`}}>
            {salvandoRegole?"⏳ Salvataggio...":"💾 Salva regole"}
          </button>
          
          {/* Regole per azienda */}
          <div style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:16,padding:20,marginTop:16,boxShadow:C.shadow}}>
            <div style={{fontWeight:700,fontSize:14,color:C.text,marginBottom:14}}>🏢 Assegnazione per azienda</div>
            <div style={{color:C.muted,fontSize:12,marginBottom:14}}>Queste regole hanno priorità sulle regole generali.</div>
            {regoleAziende.map(ra => (
              <div key={ra.id} style={{display:'flex',alignItems:'center',gap:10,marginBottom:8,padding:'10px 14px',background:C.bg,borderRadius:10}}>
                <div style={{flex:1,fontWeight:600,fontSize:13,color:C.text}}>{ra.azienda_nome}</div>
                <div style={{fontSize:13,color:C.accent,fontWeight:600}}>→ {ra.cardiologo_nome}</div>
                <button onClick={async()=>{
                  await supabase.from('regole_per_azienda').delete().eq('id',ra.id);
                  setRegoleAziende(prev=>prev.filter(r=>r.id!==ra.id));
                }} style={{background:'none',border:'none',cursor:'pointer',color:C.muted,fontSize:16,padding:'0 4px'}}>✕</button>
              </div>
            ))}
            <div style={{display:'flex',gap:8,marginTop:12}}>
              <select value={nuovaRegAz.azienda} onChange={e=>setNuovaRegAz(p=>({...p,azienda:e.target.value}))}
                style={{flex:2,background:C.bg,border:`1.5px solid ${C.border}`,borderRadius:10,padding:'8px 12px',fontSize:13,color:C.text,outline:'none',cursor:'pointer'}}>
                <option value="">Seleziona azienda...</option>
                {aziendeDisponibili.map(az=><option key={az} value={az}>{az}</option>)}
              </select>
              <select value={nuovaRegAz.cardiologo} onChange={e=>setNuovaRegAz(p=>({...p,cardiologo:e.target.value}))}
                style={{flex:1,background:C.bg,border:`1.5px solid ${C.border}`,borderRadius:10,padding:'8px 12px',fontSize:13,color:C.text,outline:'none'}}>
                <option value="">Cardiologo...</option>
                {nomi.map(n=><option key={n} value={n}>{n}</option>)}
              </select>
              <button onClick={async()=>{
                if(!nuovaRegAz.azienda||!nuovaRegAz.cardiologo) return;
                const {data} = await supabase.from('regole_per_azienda').upsert({azienda_nome:nuovaRegAz.azienda,cardiologo_nome:nuovaRegAz.cardiologo},{onConflict:'azienda_nome'}).select().single();
                if(data){setRegoleAziende(prev=>[...prev.filter(r=>r.azienda_nome!==nuovaRegAz.azienda),data].sort((a,b)=>a.azienda_nome.localeCompare(b.azienda_nome)));setNuovaRegAz({azienda:'',cardiologo:''});}
              }} style={{background:C.accent,color:C.white,border:'none',borderRadius:10,padding:'8px 16px',cursor:'pointer',fontWeight:700,fontSize:13,whiteSpace:'nowrap'}}>+ Aggiungi</button>
            </div>
          </div>
        </div>
      )}

      {tab==="tariffario" && (() => {
        const cardiologiList = cardiologiTariffList;
        const selCard = cardiologiList.find(c => c.id === cardiologoSelTariff);
        const tariffSel = tariffariAdmin[cardiologoSelTariff] || {};
        const aziendeTutte = [...new Set(ecgs.map(e=>e.origine_dettaglio||e.farmacia||e.azienda||'Altro').filter(Boolean))].sort();
        const [annoC,meseC] = meseCompAdmin.split('-').map(Number);
        const ecgsCardio = ecgs.filter(e => {
          if (!selCard) return false;
          const d = new Date(e.created_at||e.ts);
          return e.cardiologo_nome===selCard.nome && e.stato==='refertato' && d.getFullYear()===annoC && d.getMonth()===meseC-1;
        });
        const byAzAdmin = {};
        ecgsCardio.forEach(e=>{ const k=e.origine_dettaglio||e.farmacia||e.azienda||'Altro'; if(!byAzAdmin[k]) byAzAdmin[k]={normale:[],urgente:[]}; byAzAdmin[k][e.urgenza==='urgente'?'urgente':'normale'].push(e); });
        return (
          <div style={{display:'flex',flexDirection:'column',gap:20}}>
            {/* Selezione cardiologo */}
            <div style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:16,padding:20,boxShadow:C.shadow}}>
              <div style={{fontWeight:700,fontSize:15,color:C.text,marginBottom:14}}>💰 Gestione Tariffario</div>
              <div style={{display:'flex',gap:12,alignItems:'center',flexWrap:'wrap'}}>
                <div style={{fontWeight:600,fontSize:13,color:C.muted}}>Cardiologo:</div>
                {cardiologiList.map(c=>(
                  <button key={c.id} onClick={()=>setCardiologoSelTariff(c.id)}
                    style={{background:cardiologoSelTariff===c.id?C.accent:C.bg,color:cardiologoSelTariff===c.id?C.white:C.text,border:`1.5px solid ${cardiologoSelTariff===c.id?C.accent:C.border}`,borderRadius:10,padding:'8px 16px',cursor:'pointer',fontWeight:600,fontSize:13}}>
                    {c.nome}
                  </button>
                ))}
              </div>
            </div>
            {/* Tariffe per azienda */}
            {selCard && (
              <div style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:16,padding:20,boxShadow:C.shadow}}>
                <div style={{fontWeight:700,fontSize:14,color:C.text,marginBottom:4}}>Tariffe per {selCard.nome}</div>
                <div style={{color:C.muted,fontSize:12,marginBottom:16}}>Imposta la tariffa per ogni azienda. "Urgente" si applica agli ECG marcati urgenti.</div>
                {/* Default */}
                <div style={{display:'grid',gridTemplateColumns:'1fr 120px 120px',gap:12,alignItems:'center',padding:'10px 0',borderBottom:`1px solid ${C.borderLight}`}}>
                  <div style={{fontWeight:700,color:C.text,fontSize:13}}>🔧 Default (tutte le aziende)</div>
                  <div style={{display:'flex',alignItems:'center',gap:6}}>
                    <input type="number" min="0" step="0.5" placeholder="10"
                      value={tariffSel['default']??''}
                      onChange={e=>setTariffariAdmin(p=>({...p,[cardiologoSelTariff]:{...tariffSel,default:parseFloat(e.target.value)||0}}))}
                      style={{width:70,border:`1.5px solid ${C.border}`,borderRadius:8,padding:'6px 8px',fontSize:13,textAlign:'center'}}/>
                    <span style={{fontSize:12,color:C.muted}}>€ std</span>
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:6}}>
                    <input type="number" min="0" step="0.5" placeholder="10"
                      value={tariffSel['default|urgente']??''}
                      onChange={e=>setTariffariAdmin(p=>({...p,[cardiologoSelTariff]:{...tariffSel,'default|urgente':parseFloat(e.target.value)||0}}))}
                      style={{width:70,border:`1.5px solid ${C.border}`,borderRadius:8,padding:'6px 8px',fontSize:13,textAlign:'center'}}/>
                    <span style={{fontSize:12,color:'#f59e0b'}}>€ urg</span>
                  </div>
                </div>
                {/* Per azienda */}
                <div style={{display:'grid',gridTemplateColumns:'1fr 120px 120px',gap:12,padding:'8px 0 4px',marginBottom:8}}>
                  <div style={{fontSize:11,fontWeight:700,color:C.muted,textTransform:'uppercase',letterSpacing:1}}>Azienda</div>
                  <div style={{fontSize:11,fontWeight:700,color:C.muted,textTransform:'uppercase',letterSpacing:1}}>€/ECG Standard</div>
                  <div style={{fontSize:11,fontWeight:700,color:'#f59e0b',textTransform:'uppercase',letterSpacing:1}}>€/ECG Urgente</div>
                </div>
                {aziendeTutte.map(az=>(
                  <div key={az} style={{display:'grid',gridTemplateColumns:'1fr 120px 120px',gap:12,alignItems:'center',padding:'8px 0',borderBottom:`1px solid ${C.borderLight}`}}>
                    <div style={{fontSize:13,color:C.text,fontWeight:500}}>{az}</div>
                    <div style={{display:'flex',alignItems:'center',gap:6}}>
                      <input type="number" min="0" step="0.5"
                        placeholder={String(tariffSel['default']??10)}
                        value={tariffSel[az]??''}
                        onChange={e=>setTariffariAdmin(p=>({...p,[cardiologoSelTariff]:{...tariffSel,[az]:parseFloat(e.target.value)||0}}))}
                        style={{width:70,border:`1.5px solid ${C.border}`,borderRadius:8,padding:'6px 8px',fontSize:13,textAlign:'center'}}/>
                      <span style={{fontSize:12,color:C.muted}}>€</span>
                    </div>
                    <div style={{display:'flex',alignItems:'center',gap:6}}>
                      <input type="number" min="0" step="0.5"
                        placeholder={String(tariffSel['default|urgente']??tariffSel['default']??10)}
                        value={tariffSel[`${az}|urgente`]??''}
                        onChange={e=>setTariffariAdmin(p=>({...p,[cardiologoSelTariff]:{...tariffSel,[`${az}|urgente`]:parseFloat(e.target.value)||0}}))}
                        style={{width:70,border:`1.5px solid ${C.border}`,borderRadius:8,padding:'6px 8px',fontSize:13,textAlign:'center'}}/>
                      <span style={{fontSize:12,color:'#f59e0b'}}>€</span>
                    </div>
                  </div>
                ))}
                <div style={{marginTop:16,display:'flex',justifyContent:'flex-end'}}>
                  <button onClick={salvaTariffarioAdmin} disabled={savingTariffAdmin}
                    style={{background:savingTariffAdmin?C.border:C.accent,color:'white',border:'none',borderRadius:12,padding:'11px 24px',cursor:savingTariffAdmin?'not-allowed':'pointer',fontWeight:700,fontSize:14}}>
                    {savingTariffAdmin?'⏳ Salvando...':'💾 Salva tariffario'}
                  </button>
                </div>
              </div>
            )}
            {/* Tariffario Ambulatorio */}
            <div style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:16,padding:20,boxShadow:C.shadow}}>
              <div style={{fontWeight:700,fontSize:14,color:C.text,marginBottom:4}}>🏥 Tariffario Ambulatorio</div>
              <div style={{color:C.muted,fontSize:12,marginBottom:16}}>Prezzo fatturato dall'ambulatorio per ogni ECG. Usato per calcolare i ricavi nella dashboard.</div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 120px 120px',gap:12,alignItems:'center',padding:'10px 0',borderBottom:`1px solid ${C.borderLight}`}}>
                <div style={{fontWeight:700,color:C.text,fontSize:13}}>🔧 Default (tutte le aziende)</div>
                <div style={{display:'flex',alignItems:'center',gap:6}}>
                  <input type="number" min="0" step="0.5" placeholder="10"
                    value={tariffarioAmb['default']??''}
                    onChange={e=>setTariffarioAmb(p=>({...p,default:parseFloat(e.target.value)||0}))}
                    style={{width:70,border:`1.5px solid ${C.border}`,borderRadius:8,padding:'6px 8px',fontSize:13,textAlign:'center'}}/>
                  <span style={{fontSize:12,color:C.muted}}>€ std</span>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:6}}>
                  <input type="number" min="0" step="0.5" placeholder="10"
                    value={tariffarioAmb['default|urgente']??''}
                    onChange={e=>setTariffarioAmb(p=>({...p,'default|urgente':parseFloat(e.target.value)||0}))}
                    style={{width:70,border:`1.5px solid ${C.border}`,borderRadius:8,padding:'6px 8px',fontSize:13,textAlign:'center'}}/>
                  <span style={{fontSize:12,color:'#f59e0b'}}>€ urg</span>
                </div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 120px 120px',gap:12,padding:'8px 0 4px',marginBottom:8}}>
                <div style={{fontSize:11,fontWeight:700,color:C.muted,textTransform:'uppercase',letterSpacing:1}}>Azienda</div>
                <div style={{fontSize:11,fontWeight:700,color:C.muted,textTransform:'uppercase',letterSpacing:1}}>€/ECG Standard</div>
                <div style={{fontSize:11,fontWeight:700,color:'#f59e0b',textTransform:'uppercase',letterSpacing:1}}>€/ECG Urgente</div>
              </div>
              {aziendeTutte.map(az=>(
                <div key={az} style={{display:'grid',gridTemplateColumns:'1fr 120px 120px',gap:12,alignItems:'center',padding:'8px 0',borderBottom:`1px solid ${C.borderLight}`}}>
                  <div style={{fontSize:13,color:C.text,fontWeight:500}}>{az}</div>
                  <div style={{display:'flex',alignItems:'center',gap:6}}>
                    <input type="number" min="0" step="0.5"
                      placeholder={String(tariffarioAmb['default']??10)}
                      value={tariffarioAmb[az]??''}
                      onChange={e=>setTariffarioAmb(p=>({...p,[az]:parseFloat(e.target.value)||0}))}
                      style={{width:70,border:`1.5px solid ${C.border}`,borderRadius:8,padding:'6px 8px',fontSize:13,textAlign:'center'}}/>
                    <span style={{fontSize:12,color:C.muted}}>€</span>
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:6}}>
                    <input type="number" min="0" step="0.5"
                      placeholder={String(tariffarioAmb[`${az}|urgente`]??tariffarioAmb['default']??10)}
                      value={tariffarioAmb[`${az}|urgente`]??''}
                      onChange={e=>setTariffarioAmb(p=>({...p,[`${az}|urgente`]:parseFloat(e.target.value)||0}))}
                      style={{width:70,border:`1.5px solid ${C.border}`,borderRadius:8,padding:'6px 8px',fontSize:13,textAlign:'center'}}/>
                    <span style={{fontSize:12,color:'#f59e0b'}}>€</span>
                  </div>
                </div>
              ))}
              <div style={{marginTop:16,display:'flex',justifyContent:'flex-end'}}>
                <button onClick={salvaTariffarioAmb} disabled={savingTariffAmb}
                  style={{background:savingTariffAmb?C.border:C.green,color:'white',border:'none',borderRadius:12,padding:'11px 24px',cursor:savingTariffAmb?'not-allowed':'pointer',fontWeight:700,fontSize:14}}>
                  {savingTariffAmb?'⏳ Salvando...':'💾 Salva tariffario ambulatorio'}
                </button>
              </div>
            </div>

            {/* Compensi mese */}
            {selCard && (
              <div style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:16,padding:20,boxShadow:C.shadow}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:8}}>
                  <div style={{fontWeight:700,fontSize:14,color:C.text}}>📊 Compensi {selCard.nome}</div>
                  <select value={meseCompAdmin} onChange={e=>setMeseCompAdmin(e.target.value)}
                    style={{border:`1px solid ${C.border}`,borderRadius:10,padding:'7px 12px',fontSize:13,color:C.text,background:C.white,cursor:'pointer'}}>
                    {Array.from({length:12},(_,i)=>{ const d=new Date(); d.setMonth(d.getMonth()-i); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; }).map(v=>{ const [a,m]=v.split('-'); const mn=['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'][Number(m)-1]; return <option key={v} value={v}>{mn} {a}</option>; })}
                  </select>
                </div>
                {ecgsCardio.length===0 ? <div style={{textAlign:'center',padding:24,color:C.muted}}>Nessun ECG refertato questo mese</div> : (
                  <div style={{borderRadius:12,overflow:'hidden',border:`1px solid ${C.border}`}}>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 60px 60px 70px 70px 80px',padding:'8px 14px',background:C.cardAlt,fontSize:10,fontWeight:700,color:C.muted,textTransform:'uppercase',gap:4}}>
                      <div>Azienda</div><div style={{textAlign:'center'}}>Std</div><div style={{textAlign:'center'}}>Urg</div><div style={{textAlign:'center'}}>€/Std</div><div style={{textAlign:'center'}}>€/Urg</div><div style={{textAlign:'right'}}>Totale</div>
                    </div>
                    {Object.entries(byAzAdmin).map(([az,{normale,urgente}])=>{
                      const tN=getTariffaAdmin(selCard.id,az,'normale'), tU=getTariffaAdmin(selCard.id,az,'urgente');
                      const tot=normale.length*tN+urgente.length*tU;
                      return (<div key={az} style={{display:'grid',gridTemplateColumns:'1fr 60px 60px 70px 70px 80px',padding:'10px 14px',borderBottom:`1px solid ${C.borderLight}`,alignItems:'center',gap:4}}>
                        <div style={{fontSize:13,fontWeight:600,color:C.text}}>{az}</div>
                        <div style={{textAlign:'center',fontWeight:700,color:C.accent}}>{normale.length}</div>
                        <div style={{textAlign:'center',fontWeight:700,color:'#f59e0b'}}>{urgente.length}</div>
                        <div style={{textAlign:'center',fontSize:12,color:C.muted}}>{tN.toFixed(2)}€</div>
                        <div style={{textAlign:'center',fontSize:12,color:C.muted}}>{tU.toFixed(2)}€</div>
                        <div style={{textAlign:'right',fontWeight:700,color:C.green}}>{tot.toFixed(2)}€</div>
                      </div>);
                    })}
                    <div style={{display:'grid',gridTemplateColumns:'1fr 60px 60px 70px 70px 80px',padding:'12px 14px',background:C.greenLight,gap:4}}>
                      <div style={{fontWeight:700,color:C.text}}>Totale mese</div>
                      <div style={{textAlign:'center',fontWeight:700,color:C.accent}}>{ecgsCardio.filter(e=>e.urgenza!=='urgente').length}</div>
                      <div style={{textAlign:'center',fontWeight:700,color:'#f59e0b'}}>{ecgsCardio.filter(e=>e.urgenza==='urgente').length}</div>
                      <div/><div/>
                      <div style={{textAlign:'right',fontWeight:700,color:C.green,fontSize:15}}>{Object.entries(byAzAdmin).reduce((s,[k,{normale,urgente}])=>s+normale.length*getTariffaAdmin(selCard.id,k,'normale')+urgente.length*getTariffaAdmin(selCard.id,k,'urgente'),0).toFixed(2)}€</div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {tab==="team" && (
        <div>
          <h3 style={{ color:C.text, fontWeight:700, fontSize:17, marginBottom:6 }}>Team cardiologi</h3>
          <p style={{ color:C.muted, fontSize:13, marginBottom:20 }}>I cardiologi vedono <strong>solo gli ECG che assegni loro</strong> individualmente dal tab Assegnazioni. Non c'è accesso a canali o code generali.</p>
          <div style={{ background:C.yellowLight, border:`1px solid ${C.yellow}33`, borderRadius:12, padding:"14px 18px", marginBottom:20, fontSize:13, color:C.textSoft }}>
            💡 <strong>Come funziona:</strong> ogni ECG in arrivo finisce nella coda "Non assegnato" (tab Assegnazioni). Vai lì per scegliere chi lo prende in carico. Il cardiologo lo vedrà solo dopo l'assegnazione.
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            {nomi.map(nome=>{
              const mieiEcgs = ecgs.filter(e=>e.cardiologo===nome);
              return (
                <div key={nome} style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:16, padding:"20px 24px", boxShadow:C.shadow }}>
                  <div style={{ display:"flex", alignItems:"center", gap:14, flexWrap:"wrap" }}>
                    <div style={{ width:46, height:46, background:C.accentLight, borderRadius:12, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20 }}>🫀</div>
                    <div style={{ flex:1, minWidth:160 }}>
                      <div style={{ color:C.text, fontWeight:700, fontSize:16 }}>{nome}</div>
                      <div style={{ color:C.muted, fontSize:12, marginTop:2 }}>{mieiEcgs.filter(e=>e.stato==="refertato").length} referti completati</div>
                    </div>
                    <div style={{ display:"flex", gap:10 }}>
                      <div style={{ background:C.accentLight, borderRadius:10, padding:"8px 14px", textAlign:"center" }}>
                        <div style={{ color:C.accent, fontWeight:700, fontFamily:MONO, fontSize:16 }}>{mieiEcgs.filter(e=>e.stato==="in_attesa").length}</div>
                        <div style={{ color:C.muted, fontSize:10, textTransform:"uppercase" }}>assegnati</div>
                      </div>
                      <div style={{ background:C.greenLight, borderRadius:10, padding:"8px 14px", textAlign:"center" }}>
                        <div style={{ color:C.green, fontWeight:700, fontFamily:MONO, fontSize:16 }}>{mieiEcgs.filter(e=>e.stato==="refertato").length}</div>
                        <div style={{ color:C.muted, fontSize:10, textTransform:"uppercase" }}>refertati</div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

// ── SHELL ─────────────────────────────────────────────────────────────────
const Shell = ({ role, onLogout, children, meCardiologo, onCambiaRuolo }) => {
  const labels = { pubblico:"👤 Area pubblica", farmacia:`💊 ${ME_FARMACIA}`, azienda:`🏢 ${meCardiologo || ME_AZIENDA}`, cardiologo:`🫀 ${meCardiologo}`, admin:"⚙️ Admin" };
  return (
    <div style={{ minHeight:"100vh", background:C.bg, color:C.text, fontFamily:SANS }}>
      <div style={{ height:64, background:C.white, borderBottom:`1px solid ${C.border}`, display:"flex", alignItems:"center", padding:"0 28px", gap:16, position:"sticky", top:0, zIndex:100, boxShadow:"0 1px 12px rgba(0,0,0,0.06)" }}>
        <Logo size={32} />
        <div style={{ flex:1 }} />
        <span style={{ color:C.muted, fontSize:13, fontWeight:500 }}>{labels[role]}</span>
        {onCambiaRuolo && <button onClick={onCambiaRuolo} style={{ background:C.bg, border:`1px solid ${C.border}`, borderRadius:8, padding:"7px 16px", color:C.accent, cursor:"pointer", fontWeight:500, fontSize:13 }}>⇄ Cambia ruolo</button>}
        <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); onLogout(); }} style={{ background:C.bg, border:`1px solid ${C.border}`, borderRadius:8, padding:"7px 16px", color:C.muted, cursor:"pointer", fontWeight:500, fontSize:13 }}>← Esci</button>
      </div>
      <div>{children}</div>
    </div>
  );
};



// ── UPLOAD GENERICO (pagina pubblica /carica) ─────────────────────────────
const UploadGenerico = () => {
  const [step, setStep] = useState(0);
  const [file, setFile] = useState(null);
  const [inviato, setInviato] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    societa:"", nome:"", cognome:"", eta:"", sesso:"M",
    mansione:"", tipoVisita:"idoneita", urgenza:"normale",
    email:"", telefono:"", note:""
  });
  const fileId = useRef("ug-"+Math.random().toString(36).slice(2,7)).current;

  const set = (k,v) => setForm(f=>({...f,[k]:v}));

  const handleInvia = async () => {
    setLoading(true);
    try {
      await fetch('/api/notify', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          paziente:`${form.nome} ${form.cognome}, ${form.eta}a, ${form.sesso}`,
          origine:"azienda",
          urgenza:form.urgenza,
          note:`Società: ${form.societa} | Mansione: ${form.mansione} | Tipo: ${form.tipoVisita} | Email cliente: ${form.email} | Tel: ${form.telefono} | Note: ${form.note}`
        })
      });
    } catch(e){}
    setLoading(false);
    setInviato(true);
  };

  const inp = (label, key, opts={}) => (
    <div style={{marginBottom:14}}>
      <label style={{color:"#3d5270",fontSize:12,fontWeight:600,display:"block",marginBottom:7}}>{label}{opts.required&&<span style={{color:"#e03e5a"}}> *</span>}</label>
      {opts.type==="select" ? (
        <select value={form[key]} onChange={e=>set(key,e.target.value)} style={{background:"#f4f7fb",border:"1px solid #dde5f0",borderRadius:10,padding:"11px 14px",color:"#1a2640",fontSize:14,width:"100%",outline:"none"}}>
          {opts.options.map(([v,l])=><option key={v} value={v}>{l}</option>)}
        </select>
      ) : opts.type==="textarea" ? (
        <textarea value={form[key]} onChange={e=>set(key,e.target.value)} placeholder={opts.placeholder||""} rows={3} style={{background:"#f4f7fb",border:"1px solid #dde5f0",borderRadius:10,padding:"11px 14px",color:"#1a2640",fontSize:14,width:"100%",outline:"none",resize:"vertical"}} />
      ) : (
        <input value={form[key]} onChange={e=>set(key,e.target.value)} type={opts.type||"text"} placeholder={opts.placeholder||""} style={{background:"#f4f7fb",border:"1px solid #dde5f0",borderRadius:10,padding:"11px 14px",color:"#1a2640",fontSize:14,width:"100%",outline:"none"}} />
      )}
    </div>
  );

  if (inviato) return (
    <div style={{minHeight:"100vh",background:"linear-gradient(135deg,#e8f2ff,#f4f7fb,#e8f9f4)",display:"flex",alignItems:"center",justifyContent:"center",padding:24,fontFamily:SANS}}>
      <div style={{maxWidth:480,width:"100%",textAlign:"center"}}>
        <div style={{width:80,height:80,background:"#e6f9f1",borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:36,margin:"0 auto 20px"}}>✅</div>
        <h2 style={{color:"#1aaa6e",fontWeight:700,fontSize:24,marginBottom:8}}>Richiesta inviata!</h2>
        <p style={{color:"#4a5b7a",fontSize:15,marginBottom:8}}>Abbiamo ricevuto il tracciato ECG di <strong>{form.nome} {form.cognome}</strong>.</p>
        <p style={{color:"#6b7d99",fontSize:14,marginBottom:28}}>Il referto verrà inviato a <strong>{form.email}</strong> non appena disponibile.</p>
        <div style={{background:"#f4f7fb",border:"1px solid #dde5f0",borderRadius:14,padding:"16px 20px",marginBottom:24,textAlign:"left"}}>
          <div style={{color:"#6b7d99",fontSize:11,fontWeight:700,letterSpacing:1,textTransform:"uppercase",marginBottom:10}}>Riepilogo richiesta</div>
          {[["Società",form.societa],["Paziente",`${form.nome} ${form.cognome}`],["Tipo visita",form.tipoVisita==="idoneita"?"Idoneità lavorativa":"Check-up / Altro"],["Urgenza",form.urgenza==="urgente"?"🔴 Urgente":"🟢 Normale"],["Referto a",form.email]].map(([k,v])=>(
            <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:"1px solid #eaf0f8",fontSize:13}}>
              <span style={{color:"#8098b8"}}>{k}</span>
              <span style={{color:"#1a2640",fontWeight:600}}>{v}</span>
            </div>
          ))}
        </div>
        <p style={{color:"#8098b8",fontSize:12}}>Per informazioni: <strong>ecg.millefonti@gmail.com</strong></p>
      </div>
    </div>
  );

  const steps = ["Società e paziente","Visita e file","Contatti e invio"];

  return (
    <div style={{minHeight:"100vh",background:"linear-gradient(135deg,#e8f2ff,#f4f7fb,#e8f9f4)",fontFamily:SANS}}>
      {/* Header */}
      <div style={{background:"white",borderBottom:"1px solid #dde5f0",padding:"16px 24px",display:"flex",alignItems:"center",gap:12,boxShadow:"0 1px 12px rgba(0,0,0,0.06)"}}>
        <img src="/logo-squared.png" alt="logo" style={{width:40,height:40,borderRadius:10,objectFit:"contain"}} />
        <div>
          <div style={{fontWeight:700,fontSize:15,color:"#1a2640"}}>Ambulatorio Millefonti</div>
          <div style={{fontSize:11,color:"#8098b8",fontFamily:"'DM Mono',monospace",letterSpacing:1}}>CARICAMENTO ECG</div>
        </div>
      </div>

      <div style={{maxWidth:580,margin:"0 auto",padding:"32px 24px"}}>
        {/* Steps indicator */}
        <div style={{display:"flex",gap:8,marginBottom:28}}>
          {steps.map((s,i)=>(
            <div key={s} style={{display:"flex",alignItems:"center",gap:6}}>
              {i>0&&<div style={{width:24,height:2,background:i<=step?"#2e7cf6":"#dde5f0"}} />}
              <div style={{background:i<=step?"#2e7cf6":"#dde5f0",color:i<=step?"white":"#8098b8",borderRadius:20,padding:"4px 14px",fontSize:12,fontWeight:600,whiteSpace:"nowrap"}}>{s}</div>
            </div>
          ))}
        </div>

        <div style={{background:"white",border:"1px solid #dde5f0",borderRadius:18,padding:28,boxShadow:"0 2px 12px rgba(46,124,246,0.08)"}}>

          {/* STEP 0 — Società e paziente */}
          {step===0 && (
            <>
              <h3 style={{color:"#1a2640",fontWeight:700,fontSize:18,marginBottom:20}}>Dati società e paziente</h3>
              {inp("Nome società / studio medico","societa",{required:true,placeholder:"Es. Salute Lavoro 3M"})}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                <div>{inp("Nome paziente","nome",{required:true,placeholder:"Mario"})}</div>
                <div>{inp("Cognome","cognome",{required:true,placeholder:"Rossi"})}</div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                <div>{inp("Età","eta",{required:true,placeholder:"45"})}</div>
                <div>{inp("Sesso","sesso",{type:"select",options:[["M","Maschile"],["F","Femminile"]]})}</div>
              </div>
              {inp("Mansione lavorativa","mansione",{placeholder:"Es. Carrellista, Operatore, Impiegato..."})}
              <button onClick={()=>setStep(1)} disabled={!form.societa||!form.nome||!form.cognome||!form.eta}
                style={{background:(!form.societa||!form.nome||!form.cognome||!form.eta)?"#dde5f0":"#2e7cf6",color:(!form.societa||!form.nome||!form.cognome||!form.eta)?"#8098b8":"white",border:"none",borderRadius:10,padding:"13px 0",cursor:(!form.societa||!form.nome||!form.cognome||!form.eta)?"not-allowed":"pointer",fontWeight:700,fontSize:15,width:"100%",marginTop:8}}>
                Continua →
              </button>
            </>
          )}

          {/* STEP 1 — Visita e file */}
          {step===1 && (
            <>
              <h3 style={{color:"#1a2640",fontWeight:700,fontSize:18,marginBottom:20}}>Tipo visita e tracciato</h3>
              {inp("Tipo di visita","tipoVisita",{type:"select",options:[["idoneita","Idoneità lavorativa"],["checkup","Check-up / Sorveglianza"],["altro","Altro"]]})}
              <div style={{marginBottom:14}}>
                <label style={{color:"#3d5270",fontSize:12,fontWeight:600,display:"block",marginBottom:7}}>Urgenza</label>
                <div style={{display:"flex",gap:8}}>
                  {[["normale","🟢 Normale"],["urgente","🔴 Urgente"]].map(([v,l])=>(
                    <button key={v} onClick={()=>set("urgenza",v)} style={{flex:1,padding:"11px 0",borderRadius:10,cursor:"pointer",fontWeight:600,fontSize:13,border:`2px solid ${form.urgenza===v?(v==="urgente"?"#e03e5a":"#2e7cf6"):"#dde5f0"}`,background:form.urgenza===v?(v==="urgente"?"#fdedf0":"#e8f0fe"):"#f4f7fb",color:form.urgenza===v?(v==="urgente"?"#e03e5a":"#2e7cf6"):"#8098b8"}}>{l}</button>
                  ))}
                </div>
              </div>
              {inp("Note cliniche / sintomi","note",{type:"textarea",placeholder:"Eventuali note sul paziente, sintomi, terapie in corso..."})}
              <div style={{marginBottom:18}}>
                <label style={{color:"#3d5270",fontSize:12,fontWeight:600,display:"block",marginBottom:7}}>File ECG <span style={{color:"#e03e5a"}}>*</span></label>
                <div onClick={()=>document.getElementById(fileId).click()}
                  style={{border:`2px dashed ${file?"#1aaa6e":"#dde5f0"}`,borderRadius:14,padding:"28px 20px",textAlign:"center",cursor:"pointer",background:file?"#e6f9f1":"#f8faff"}}>
                  <input id={fileId} type="file" accept=".pdf,.png,.jpg,.jpeg" style={{display:"none"}} onChange={e=>setFile(e.target.files[0])} />
                  {file ? <div style={{color:"#1aaa6e",fontWeight:600,fontSize:14}}>✓ {file.name}</div>
                        : <><div style={{fontSize:28,marginBottom:8}}>📎</div><div style={{color:"#4a5b7a",fontSize:14,fontWeight:500}}>Clicca per caricare il tracciato ECG</div><div style={{color:"#8098b8",fontSize:12,marginTop:4}}>PDF · PNG · JPG</div></>}
                </div>
              </div>
              <div style={{display:"flex",gap:10}}>
                <button onClick={()=>setStep(0)} style={{background:"#f4f7fb",border:"1px solid #dde5f0",borderRadius:10,padding:"13px 0",cursor:"pointer",fontWeight:600,fontSize:14,flex:1,color:"#6b7d99"}}>← Indietro</button>
                <button onClick={()=>setStep(2)} disabled={!file}
                  style={{background:!file?"#dde5f0":"#2e7cf6",color:!file?"#8098b8":"white",border:"none",borderRadius:10,padding:"13px 0",cursor:!file?"not-allowed":"pointer",fontWeight:700,fontSize:15,flex:2}}>
                  Continua →
                </button>
              </div>
            </>
          )}

          {/* STEP 2 — Contatti e invio */}
          {step===2 && (
            <>
              <h3 style={{color:"#1a2640",fontWeight:700,fontSize:18,marginBottom:8}}>Dove inviare il referto</h3>
              <p style={{color:"#6b7d99",fontSize:13,marginBottom:20}}>Il referto firmato verrà inviato all'email indicata non appena disponibile.</p>
              {inp("Email per ricevere il referto","email",{required:true,type:"email",placeholder:"medico@societa.it"})}
              {inp("Telefono (opzionale)","telefono",{placeholder:"+39 333 000 0000"})}
              <div style={{background:"#f4f7fb",border:"1px solid #dde5f0",borderRadius:12,padding:"14px 18px",marginBottom:20}}>
                <div style={{color:"#6b7d99",fontSize:11,fontWeight:700,letterSpacing:1,textTransform:"uppercase",marginBottom:10}}>Riepilogo</div>
                {[["Società",form.societa],["Paziente",`${form.nome} ${form.cognome}, ${form.eta}a`],["Tipo",form.tipoVisita==="idoneita"?"Idoneità lavorativa":"Check-up"],["Urgenza",form.urgenza==="urgente"?"🔴 Urgente":"🟢 Normale"],["File",file?.name||"—"]].map(([k,v])=>(
                  <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid #eaf0f8",fontSize:12}}>
                    <span style={{color:"#8098b8"}}>{k}</span>
                    <span style={{color:"#1a2640",fontWeight:600,maxWidth:"60%",textAlign:"right",wordBreak:"break-all"}}>{v}</span>
                  </div>
                ))}
              </div>
              <div style={{display:"flex",gap:10}}>
                <button onClick={()=>setStep(1)} style={{background:"#f4f7fb",border:"1px solid #dde5f0",borderRadius:10,padding:"13px 0",cursor:"pointer",fontWeight:600,fontSize:14,flex:1,color:"#6b7d99"}}>← Indietro</button>
                <button onClick={handleInvia} disabled={!form.email||loading}
                  style={{background:(!form.email||loading)?"#dde5f0":"#1aaa6e",color:(!form.email||loading)?"#8098b8":"white",border:"none",borderRadius:10,padding:"13px 0",cursor:(!form.email||loading)?"not-allowed":"pointer",fontWeight:700,fontSize:15,flex:2,boxShadow:(!form.email||loading)?"none":"0 4px 16px rgba(26,170,110,0.3)"}}>
                  {loading?"Invio in corso...":"Invia richiesta →"}
                </button>
              </div>
            </>
          )}
        </div>
        <p style={{textAlign:"center",color:"#b0c2d8",fontSize:11,marginTop:20,fontFamily:"'DM Mono',monospace",letterSpacing:1}}>AMBULATORIO MILLEFONTI · ACCESSO SICURO · GDPR</p>
      </div>
    </div>
  );
};

// ── LOGIN REALE (Supabase Auth) ───────────────────────────────────────────
const LoginReale = ({ onLogin }) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errore, setErrore] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!email || !password) return;
    setLoading(true);
    setErrore(null);
    const err = await onLogin(email, password);
    if (err) setErrore(err);
    setLoading(false);
  };

  return (
    <div style={{ minHeight:"100vh", background:"linear-gradient(135deg, #e8f2ff, #f4f7fb, #e8f9f4)", display:"flex", alignItems:"center", justifyContent:"center", padding:24, fontFamily:SANS }}>
      <div style={{ maxWidth:400, width:"100%", textAlign:"center" }}>
        <img src="/logo-squared.png" alt="logo" style={{ width:330, height:330, objectFit:"contain", margin:"0 auto 16px", display:"block", mixBlendMode:"multiply" }} />
        <h1 style={{ color:"#1a2640", fontSize:36, fontWeight:700, marginBottom:4, letterSpacing:-1 }}>Ambulatorio Millefonti</h1>
        <p style={{ color:"#8098b8", fontSize:13, marginBottom:36 }}>Accedi al tuo account</p>
        <div style={{ background:"white", border:"1px solid #dde5f0", borderRadius:18, padding:28, boxShadow:"0 2px 12px rgba(46,124,246,0.08)", textAlign:"left" }}>
          <form onSubmit={e=>{e.preventDefault();handleSubmit();}} autoComplete="on" style={{margin:0}}>
          <div style={{ marginBottom:16 }}>
            <label style={{ color:"#3d5270", fontSize:12, fontWeight:600, display:"block", marginBottom:7 }}>Email</label>
            <input value={email} onChange={e=>setEmail(e.target.value)} type="email" placeholder="nome@esempio.it"
              name="email" autoComplete="username"
              style={{ background:"#f4f7fb", border:"1px solid #dde5f0", borderRadius:10, padding:"11px 14px", color:"#1a2640", fontSize:14, width:"100%", outline:"none" }} />
          </div>
          <div style={{ marginBottom:24 }}>
            <label style={{ color:"#3d5270", fontSize:12, fontWeight:600, display:"block", marginBottom:7 }}>Password</label>
            <input value={password} onChange={e=>setPassword(e.target.value)} type="password" placeholder="••••••••"
              name="password" autoComplete="current-password"
              style={{ background:"#f4f7fb", border:"1px solid #dde5f0", borderRadius:10, padding:"11px 14px", color:"#1a2640", fontSize:14, width:"100%", outline:"none" }}
               />
          </div>
          {errore && (
            <div style={{ background:"#fdedf0", border:"1px solid #e03e5a33", borderRadius:10, padding:"10px 14px", color:"#e03e5a", fontSize:13, marginBottom:16 }}>
              {errore}
            </div>
          )}
          <button type="submit" disabled={loading || !email || !password}
            style={{ background: (loading||!email||!password) ? "#dde5f0" : "#2e7cf6", color: (loading||!email||!password) ? "#8098b8" : "white", border:"none", borderRadius:10, padding:"13px 0", cursor: (loading||!email||!password) ? "not-allowed" : "pointer", fontWeight:700, fontSize:15, width:"100%", boxShadow: (!loading&&email&&password) ? "0 4px 16px rgba(46,124,246,0.3)" : "none" }}>
            {loading ? "Accesso in corso..." : "Accedi →"}
          </button>
          </form>
        </div>
        <div style={{ color:"#b0c2d8", fontFamily:"'DM Mono', monospace", fontSize:10, marginTop:20, letterSpacing:2 }}>MILLEFONTI · ACCESSO SICURO</div>
      </div>
    </div>
  );
};

// ── MOBILE HOOK ────────────────────────────────────────────────────────────
const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 1024);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return isMobile;
};

// ── CARDIOLOGO MOBILE ──────────────────────────────────────────────────────
const CardiologoMobile = ({ ecgs, setEcgs, meCardiologo, caricaEcgs, onLogout, pushAbilitato, registraPush }) => {
  const [screen, setScreen] = useState('lista'); // lista | lotto | referta
  const [selectedBatch, setSelectedBatch] = useState(null);
  const [selectedEcg, setSelectedEcg] = useState(null);
  const [crocette, setCrocette] = useState({ limiti:false, correlare:false, approfondire:false, visita:false, urgente:false });
  const [commento, setCommento] = useState('');
  const [ecgFile, setEcgFile] = useState(null);
  const [ecgUrl, setEcgUrl] = useState(null);
  const [ecgType, setEcgType] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [previewDataUrl, setPreviewDataUrl] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [rotationMobile, setRotationMobile] = useState(0);
  const rotationMobileRef = useRef(0);
  const [numPagesMobile, setNumPagesMobile] = useState(1);
  const [chiudendo, setChiudendo] = useState(false);
  const [posizioneMobile, setPosizioneMobile] = useState('overlay');

  useEffect(() => { rotationMobileRef.current = rotationMobile; }, [rotationMobile]);

  // Preload logo per pagina separata
  useEffect(() => {
    if (!window.__millefonti_logo || !window.__millefonti_logo.complete) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = 'https://weearnnmglyjufhpycju.supabase.co/storage/v1/object/public/assets/logo%20definitivo.png';
      window.__millefonti_logo = img;
    }
  }, []);

  const mieiEcgs = ecgs.filter(e => e.cardiologo === meCardiologo);
  const almenoCrocetta = Object.values(crocette).some(Boolean);

  // Carica file da Storage quando cambia ECG
  useEffect(() => {
    if (!selectedEcg?.file_ecg_url) return;
    setEcgFile(null); setEcgUrl(null); setPreviewDataUrl(null);
    let cancelled = false;
    supabase.storage.from('ecg-files').download(selectedEcg.file_ecg_url)
      .then(({ data, error }) => {
        if (cancelled || error || !data) return;
        const ext = selectedEcg.file_ecg_url.split('.').pop().toLowerCase();
        const mimeType = ext === 'pdf' ? 'application/pdf' : `image/${ext}`;
        const file = new File([data], selectedEcg.file_ecg_url, { type: mimeType });
        const url = URL.createObjectURL(data);
        setEcgFile(file); setEcgUrl(url);
        setEcgType(mimeType === 'application/pdf' ? 'pdf' : 'image');
        if (mimeType !== 'application/pdf') {
          setPreviewDataUrl(url);
        } else {
          (async () => {
            try {
              const pdfjsLib = await import("pdfjs-dist");
              pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;
              const ab = await data.arrayBuffer();
              const pdfDoc = await pdfjsLib.getDocument({ data: ab }).promise;
              if (!cancelled) setNumPagesMobile(pdfDoc.numPages);
              const page = await pdfDoc.getPage(1);
              const vp = page.getViewport({ scale: 1.5 });
              const cv = document.createElement('canvas');
              cv.width = vp.width; cv.height = vp.height;
              const ctx2 = cv.getContext('2d');
              ctx2.fillStyle = '#fff'; ctx2.fillRect(0,0,cv.width,cv.height);
              await page.render({ canvasContext: ctx2, viewport: vp }).promise;
              if (!cancelled) setPreviewDataUrl(cv.toDataURL('image/jpeg', 0.85));
            } catch(e) {}
          })();
        }
      });
    return () => { cancelled = true; };
  }, [selectedEcg?.id]);

  const resetReferta = () => {
    setCrocette({ limiti:false, correlare:false, approfondire:false, visita:false, urgente:false });
    setCommento(''); setEcgFile(null); setEcgUrl(null); setPreviewDataUrl(null); setZoom(1); setRotationMobile(0); setNumPagesMobile(1);
  };

  const apriEcg = (ecg) => {
    setSelectedEcg(ecg); resetReferta(); setScreen('referta');
  };

  const chiudiBatchMobile = async (batchId, batchNome, emailDest) => {
    if (!emailDest) { alert('Email destinatario non trovata'); return; }
    setChiudendo(true);
    try {
      const JSZip = (await import('jszip')).default;
      const batchEcgs = mieiEcgs.filter(e => e.batch_id===batchId && e.stato==='refertato' && e.file_referto_url);
      if (!batchEcgs.length) { alert('Nessun referto disponibile. Attendi qualche secondo e riprova.'); setChiudendo(false); return; }
      const zip = new JSZip();
      await Promise.all(batchEcgs.map(async e => {
        const { data } = await supabase.storage.from('ecg-files').download(e.file_referto_url);
        if (data) zip.file(e.file_referto_url.split('/').pop(), data);
      }));
      const zipBlob = await zip.generateAsync({ type:'blob' });
      const zipFileName = `referti/zip/_${batchNome.replace(/[^a-zA-Z0-9]/g,'_')}_${batchId}.zip`;
      await supabase.storage.from('ecg-files').upload(zipFileName, zipBlob, { contentType:'application/zip', upsert:true });
      const { data: urlData } = await supabase.storage.from('ecg-files').createSignedUrl(zipFileName, 60*60*24*7);
      if (urlData?.signedUrl) {
        const downloadUrl = urlData.signedUrl;

        // 1. Recupera codice_referti dell'azienda
        const { data: profilo } = await supabase
          .from('user_profiles')
          .select('codice_referti')
          .eq('email', emailDest)
          .single();
        const codiceReferti = profilo?.codice_referti || null;

        // 2. Crea token di download
        const expires = new Date();
        expires.setDate(expires.getDate() + 7);
        const { data: tokenData, error: tokenError } = await supabase
          .from('download_tokens')
          .insert({
            download_url: downloadUrl,
            azienda_email: emailDest,
            batch_nome: batchNome,
            count: batchEcgs.length,
            cardiologo: meCardiologo,
            expires_at: expires.toISOString(),
            codice_referti: codiceReferti,
          })
          .select('token')
          .single();

        // 3. Costruisci link
        await supabase.from('debug_log').insert({
          messaggio: 'token insert result',
          dettaglio: JSON.stringify({ tokenData, tokenError, emailDest, codiceReferti })
        });
        if (tokenError) {
          fetch('/api/notify-breach', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tipo: 'token_creation_failed', messaggio: `Token creation failed per ${emailDest}` }),
          }).catch(() => {});
        }
        const linkDownload = tokenError || !tokenData
          ? downloadUrl
          : `https://ambulatoriomillefonti.it/api/scarica?token=${tokenData.token}`;

        // 4. Invia email con linkDownload
        await fetch('/api/notify-referto', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ email:emailDest, cardiologo:meCardiologo, downloadUrl:linkDownload, isBatch:true, batchNome, count:batchEcgs.length })
        });
        alert('✅ Email inviata a ' + emailDest);
      }
    } catch(err) { alert('Errore: ' + err.message); }
    setChiudendo(false);
  };

  const scaricaBatchMobile = async (batchId, batchNome) => {
    const batchEcgs = mieiEcgs.filter(e => e.batch_id===batchId && e.stato==='refertato' && e.file_referto_url);
    if (!batchEcgs.length) { alert('Nessun referto disponibile'); return; }
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    await Promise.all(batchEcgs.map(async e => {
      const { data } = await supabase.storage.from('ecg-files').download(e.file_referto_url);
      if (data) zip.file(e.file_referto_url.split('/').pop(), data);
    }));
    const blob = await zip.generateAsync({ type:'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download=batchNome+'_referti.zip'; a.click();
    URL.revokeObjectURL(url);
  };

  const generaEConferma = async () => {
    if (!ecgFile || !almenoCrocetta || generating) return;
    setGenerating(true);
    try {
      const { jsPDF } = await import("jspdf");
      const pdfjsLib = await import("pdfjs-dist");
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;
      const ab = await ecgFile.arrayBuffer();
      const pdfDoc = await pdfjsLib.getDocument({ data: ab }).promise;
      const page = await pdfDoc.getPage(1);
      const vp = page.getViewport({ scale: 2.0 });
      const cv = document.createElement('canvas');
      cv.width = vp.width; cv.height = vp.height;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0,0,cv.width,cv.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;

      // Biforca in base alla posizione scelta
      // Applica rotazione utente (↺↻) al canvas
      const rotVal = rotationMobileRef.current;
      let finalCvMobile = cv;
      if (rotVal !== 0) {
        const rad = (rotVal * Math.PI) / 180;
        const rotCv = document.createElement('canvas');
        if (rotVal === 90 || rotVal === 270) {
          rotCv.width = cv.height; rotCv.height = cv.width;
        } else {
          rotCv.width = cv.width; rotCv.height = cv.height;
        }
        const rCtx2 = rotCv.getContext('2d');
        rCtx2.translate(rotCv.width/2, rotCv.height/2);
        rCtx2.rotate(rad);
        rCtx2.drawImage(cv, -cv.width/2, -cv.height/2);
        rCtx2.setTransform(1, 0, 0, 1, 0, 0); // reset transform: overlay non eredita la rotazione
        finalCvMobile = rotCv;
      }
      let pdfBlob2 = null;
      if (posizioneMobile === 'pagina-separata') {
        // ── PAGINA SEPARATA MOBILE ──
        const W = finalCvMobile.width, H = finalCvMobile.height;
        const ratio = W/H, isLandscape = ratio > 1;
        const pdf2 = new jsPDF({ orientation:'landscape', unit:'mm', format:[297,210] });
        const pw2=297, ph2=210;
        const logoSz2=28;
        pdf2.setFillColor(255,255,255); pdf2.rect(0,0,pw2,ph2,'F');
        if (window.__millefonti_logo && window.__millefonti_logo.complete) {
          const lCvs=document.createElement('canvas'); lCvs.width=window.__millefonti_logo.naturalWidth; lCvs.height=window.__millefonti_logo.naturalHeight;
          lCvs.getContext('2d').drawImage(window.__millefonti_logo,0,0);
          pdf2.addImage(lCvs.toDataURL('image/png'),'PNG',8,4,logoSz2,logoSz2);
        }
        pdf2.setTextColor(37,87,54); pdf2.setFontSize(16); pdf2.setFont('helvetica','bold');
        pdf2.text('AMBULATORIO MILLEFONTI',40,14);
        pdf2.setFontSize(9); pdf2.setFont('helvetica','normal'); pdf2.setTextColor(107,125,153);
        pdf2.text('Via Garessio 47 — Torino',40,21);
        pdf2.text(new Date().toLocaleDateString('it-IT'),pw2-10,14,{align:'right'});
        pdf2.setFillColor(37,87,54); pdf2.rect(0,36,pw2,1.5,'F');
        pdf2.setFontSize(11); pdf2.setFont('helvetica','bold'); pdf2.setTextColor(37,87,54);
        pdf2.text('PAZIENTE:',10,47);
        pdf2.setFont('helvetica','normal'); pdf2.setTextColor(30,30,30);
        pdf2.text(selectedEcg.paziente_nome||selectedEcg.paziente||'—',40,47);
        pdf2.setDrawColor(220,229,240); pdf2.setLineWidth(0.4); pdf2.line(10,52,pw2-10,52);
        pdf2.setFontSize(16); pdf2.setFont('helvetica','bold'); pdf2.setTextColor(37,87,54);
        pdf2.text('REFERTO ECG',10,62);
        const voci2=[[crocette.limiti,'ECG nei limiti della norma'],[crocette.correlare,'ECG da correlare con la clinica'],[crocette.approfondire,'ECG da approfondire con Medico Curante'],[crocette.visita,'ECG da approfondire con visita cardiologica'],[crocette.urgente,'Se nuova sintomatologia: visita cardiologica urgente / accesso in PS']];
        let cy2=72;
        voci2.forEach(([checked,label])=>{
          if(checked){pdf2.setFillColor(26,170,110);pdf2.setTextColor(255,255,255);pdf2.setFontSize(9);pdf2.setFont('helvetica','bold');pdf2.rect(10,cy2-5,4,4,'F');pdf2.text('✓',10.5,cy2-2);}
          else{pdf2.setDrawColor(200,200,200);pdf2.setLineWidth(0.4);pdf2.rect(10,cy2-5,4,4);}
          pdf2.setTextColor(checked?26:107,checked?38:125,checked?64:153);
          pdf2.setFontSize(11);pdf2.setFont('helvetica',checked?'bold':'normal');
          pdf2.text(label,17,cy2-1);cy2+=10;
        });
        if(commento&&commento.trim()){
          cy2+=4;pdf2.setDrawColor(220,229,240);pdf2.setLineWidth(0.5);pdf2.line(10,cy2,pw2-10,cy2);cy2+=8;
          pdf2.setFontSize(10);pdf2.setFont('helvetica','bold');pdf2.setTextColor(107,125,153);pdf2.text('DESCRIZIONE',10,cy2);cy2+=7;
          pdf2.setFont('helvetica','normal');pdf2.setTextColor(37,87,54);pdf2.setFontSize(11);
          pdf2.text(pdf2.splitTextToSize(commento,pw2-20),10,cy2);
        }
        const nbM2=meCardiologo.replace(/^Dott\.\s*Dr\.?/i,'').replace(/^Dr\.?\s*/i,'').replace(/^Dott\.?\s*/i,'').trim();
        const nomeFirma2='Dott. '+nbM2;
        if(window.__millefonti_firma){
          const fCvs2=document.createElement('canvas');fCvs2.width=window.__millefonti_firma.width;fCvs2.height=window.__millefonti_firma.height;
          fCvs2.getContext('2d').drawImage(window.__millefonti_firma,0,0);
          const fW2=35,fH2=fW2/(window.__millefonti_firma.width/window.__millefonti_firma.height);
          pdf2.addImage(fCvs2.toDataURL('image/png'),'PNG',pw2-10-fW2,ph2-38-fH2,fW2,fH2);
        }
        pdf2.setFontSize(13);pdf2.setFont('helvetica','bold');pdf2.setTextColor(37,87,54);pdf2.text(nomeFirma2,pw2-10,ph2-36,{align:'right'});
        pdf2.setDrawColor(37,87,54);pdf2.setLineWidth(0.3);pdf2.line(pw2-65,ph2-33,pw2-10,ph2-33);
        pdf2.setFontSize(8);pdf2.setFont('helvetica','normal');pdf2.setTextColor(37,87,54);
        pdf2.text('Ambulatorio Millefonti',pw2-10,ph2-28,{align:'right'});
        pdf2.text('Via Garessio 47 - Torino',pw2-10,ph2-23,{align:'right'});
        pdf2.setTextColor(107,125,153);pdf2.text(new Date().toLocaleDateString('it-IT'),pw2-10,ph2-17,{align:'right'});
        pdf2.setFillColor(37,87,54);pdf2.rect(0,ph2-8,pw2,8,'F');
        pdf2.setTextColor(255,255,255);pdf2.setFontSize(8);
        pdf2.text('Ambulatorio Millefonti — ambulatoriomillefonti.it',pw2/2,ph2-3,{align:'center'});
        // Merge referto + tutte le pagine originali con pdf-lib (nessun canvas)
        const { PDFDocument: PDFDoc2, degrees: pdfDeg2 } = await import('pdf-lib');
        const mergedDoc2 = await PDFDoc2.create();
        const refertoSrc2 = await PDFDoc2.load(pdf2.output('arraybuffer'));
        const [refertoPageM] = await mergedDoc2.copyPages(refertoSrc2, [0]);
        mergedDoc2.addPage(refertoPageM);
        const abForPdfLib = await ecgFile.arrayBuffer(); // fresh copy (ab detached da pdfjs)
        const originalSrc2 = await PDFDoc2.load(abForPdfLib);
        const copiedPages2 = await mergedDoc2.copyPages(originalSrc2, originalSrc2.getPageIndices());
        copiedPages2.forEach(p => {
          if (rotVal !== 0) { const ea2 = p.getRotation().angle; p.setRotation(pdfDeg2((ea2 + rotVal) % 360)); }
          mergedDoc2.addPage(p);
        });
        const mergedBytes2 = await mergedDoc2.save();
        pdfBlob2 = new Blob([mergedBytes2], { type: 'application/pdf' });
      } else {

      // Overlay identico al desktop
      const W = finalCvMobile.width, H = finalCvMobile.height;
      const finalCtxM = finalCvMobile.getContext('2d');
      const rX=Math.round(W*0.21),rY=Math.round(H*0.082),rW=Math.round(W*0.78),rH=Math.round(H*0.142);
      finalCtxM.fillStyle='#ffffff';finalCtxM.fillRect(rX,rY,rW,rH);
      finalCtxM.strokeStyle='#1a2640';finalCtxM.lineWidth=2;finalCtxM.strokeRect(rX,rY,rW,rH);
      const headerH=Math.round(rH*0.18),crocetteH=Math.round(rH*0.42);
      const pad=Math.round(rH*0.06),fsTitle=Math.round(rH*0.14),fsCr=Math.round(rH*0.066)+3;
      const boxSz=Math.round(fsCr*1.1),fsCommento=Math.round(rH*0.092),fsFirma=Math.round(rH*0.110),fsStampM=Math.round(fsFirma*0.62);
      const firmaColX=rX+Math.round(rW*0.72),firmaColW=rW-Math.round(rW*0.72)-Math.round(rW*0.015);
      // Header
      finalCtxM.fillStyle='#1a2640';finalCtxM.font=`bold ${fsTitle}px Arial`;finalCtxM.fillText('REFERTO ECG',rX+pad,rY+headerH*0.78);
      finalCtxM.strokeStyle='#1a2640';finalCtxM.lineWidth=1.2;
      finalCtxM.beginPath();finalCtxM.moveTo(rX+pad,rY+headerH);finalCtxM.lineTo(rX+rW-pad,rY+headerH);finalCtxM.stroke();
      // Crocette sinistra 70%
      const voci=[
        [crocette.limiti,'nei limiti della norma'],
        [crocette.correlare,'da correlare con la clinica'],
        [crocette.approfondire,'da approfondire con Medico Curante'],
        [crocette.visita,'da approfondire con visita cardiologica'],
        [crocette.urgente,'Se nuova sintomatologia: visita cardiologica urgente / accesso in PS'],
      ];
      const crocetteY=rY+headerH,crocColW=(Math.round(rW*0.70)-pad*2)/3,rowH=Math.round(crocetteH/2);
      voci.forEach(([checked,label],i)=>{
        const col=i<3?i:i-3,row=i<3?0:1,cx=rX+pad+col*crocColW,cy=crocetteY+row*rowH+rowH*0.65;
        if(checked){finalCtxM.fillStyle='#1aaa6e';finalCtxM.fillRect(cx,cy-boxSz+2,boxSz,boxSz);finalCtxM.fillStyle='#ffffff';finalCtxM.font=`bold ${Math.round(boxSz*1.35)}px Arial`;finalCtxM.fillText('✓',cx,cy+2);}else{finalCtxM.strokeStyle='#1a2640';finalCtxM.lineWidth=1.2;finalCtxM.strokeRect(cx,cy-boxSz+2,boxSz,boxSz);}
        finalCtxM.fillStyle='#1a2640';finalCtxM.font=`${fsCr}px Arial`;
        const maxLW=i===4?crocColW*2-boxSz-12:crocColW-boxSz-12,words=label.split(' ');let line='';const lns=[];
        words.forEach(w=>{const t=line+w+' ';if(finalCtxM.measureText(t).width>maxLW&&line){lns.push(line.trim());line=w+' ';}else line=t;});
        if(line.trim())lns.push(line.trim());
        let lY=cy;if(lns.length>1)lY-=(lns.length-1)*fsCr*0.6;
        lns.forEach((ln,idx)=>finalCtxM.fillText(ln,cx+boxSz+8,lY+idx*fsCr*1.15));
      });
      // Firma scannerizzata destra (nella sezione crocette)
      const nbM=meCardiologo.replace(/^Dott\.\s*Dr\.?/i,'').replace(/^Dr\.?\s*/i,'').replace(/^Dott\.?\s*/i,'').trim();
      const nomeFirmaM='Dott. '+nbM;
      if(window.__millefonti_firma){
        const img2=window.__millefonti_firma;
        const maxW=firmaColW*0.92,maxH=crocetteH-pad*2,r2=img2.width/img2.height;
        const dW=Math.min(maxW,maxH*r2),dH=dW/r2;
        finalCtxM.drawImage(img2,firmaColX+(firmaColW-dW)/2,crocetteY+(crocetteH-dH)/2,dW,dH);
      }
      // Separatore
      const sepY=crocetteY+crocetteH;
      finalCtxM.strokeStyle='#cccccc';finalCtxM.lineWidth=0.8;
      finalCtxM.beginPath();finalCtxM.moveTo(rX+pad,sepY);finalCtxM.lineTo(rX+rW-pad,sepY);finalCtxM.stroke();
      // Commento
      if(commento&&commento.trim()){
        finalCtxM.fillStyle='#1a2640';finalCtxM.font=`${fsCommento}px Arial`;
        const wds=commento.split(' ');let ln2='';const lns2=[];
        wds.forEach(w=>{const t=ln2+w+' ';if(finalCtxM.measureText(t).width>Math.round(rW*0.63)&&ln2){lns2.push(ln2.trim());ln2=w+' ';}else ln2=t;});
        if(ln2.trim())lns2.push(ln2.trim());
        lns2.slice(0,3).forEach((l,idx)=>finalCtxM.fillText(l,rX+pad,sepY+fsCommento*1.1+idx*fsCommento*1.2));
      }
      // Firma testo agganciata al fondo
      const bPad=Math.round(rH*0.05);
      const lineDate=rY+rH-bPad,lineVia=lineDate-Math.round(fsStampM*1.35),lineAmb=lineVia-Math.round(fsStampM*1.35);
      const lineNome=lineAmb-fsFirma-Math.round(fsStampM*0.5),lineSepF=lineNome+Math.round(fsFirma*0.4);
      finalCtxM.fillStyle='#1a2640';finalCtxM.font=`bold ${fsFirma}px Arial`;finalCtxM.fillText(nomeFirmaM,firmaColX,lineNome);
      finalCtxM.strokeStyle='#1a2640';finalCtxM.lineWidth=0.5;
      finalCtxM.beginPath();finalCtxM.moveTo(firmaColX,lineSepF);finalCtxM.lineTo(firmaColX+firmaColW*0.95,lineSepF);finalCtxM.stroke();
      finalCtxM.fillStyle='#1a2640';finalCtxM.font=`${fsStampM}px Arial`;
      finalCtxM.fillText('Ambulatorio Millefonti',firmaColX,lineAmb);
      finalCtxM.fillText('Via Garessio 47 - Torino',firmaColX,lineVia);
      finalCtxM.fillStyle='#6b7d99';finalCtxM.font=`${Math.round(fsFirma*0.72)}px Arial`;
      finalCtxM.fillText(new Date().toLocaleDateString('it-IT'),firmaColX,lineDate);

      const ratio = W/H, isLandscape = ratio>1;
      const pdfW = isLandscape?297:210, pdfH = isLandscape?pdfW/ratio:pdfW*ratio;
      const pdf = new jsPDF({ orientation:isLandscape?'landscape':'portrait', unit:'mm', format:[pdfW,Math.min(pdfH,420)] });
      pdf.addImage(finalCvMobile.toDataURL('image/jpeg',0.78),'JPEG',0,0,pdfW,Math.min(pdfH,420));
      pdfBlob2 = pdf.output('blob');
      } // end else overlay

      // Salva su Storage
      const nomeFileOrigMobile = (selectedEcg.file_ecg_url||'').split('/').pop().replace(/\.[^.]+$/,'');
      const refertoFileName = `referti/_${nomeFileOrigMobile}.pdf`;
      (async () => {
        await supabase.storage.from('ecg-files').upload(refertoFileName, pdfBlob2, { contentType:'application/pdf', upsert:true });
        await supabase.from('ecgs').update({ stato:'refertato', file_referto_url:refertoFileName }).eq('id', selectedEcg.id);
        if (selectedEcg.file_ecg_url) await supabase.storage.from('ecg-files').remove([selectedEcg.file_ecg_url]).catch(()=>{});
      })();

      // Aggiorna stato locale (incluso file_referto_url per evitare zip vuoti in chiudiBatch)
      setEcgs(prev => prev.map(e => e.id===selectedEcg.id ? {...e, stato:'refertato', file_referto_url: refertoFileName} : e));

      // Vai al prossimo ECG del batch o torna alla lista
      if (selectedEcg.batch_id) {
        const prossimo = mieiEcgs.find(e => e.batch_id===selectedEcg.batch_id && e.stato==='in_attesa' && e.id!==selectedEcg.id);
        if (prossimo) { setSelectedEcg(prossimo); resetReferta(); }
        else { setScreen('lotto'); }
      } else {
        setScreen('lista');
      }
    } catch(e) { alert('Errore: '+e.message); }
    setGenerating(false);
  };

  // Raggruppa ECG per batch
  const batches = {};
  const singoli = [];
  mieiEcgs.forEach(e => {
    if (e.batch_id) {
      if (!batches[e.batch_id]) batches[e.batch_id] = { nome: e.batch_nome||e.batch_id, ecgs:[], email: e.email_destinatario };
      batches[e.batch_id].ecgs.push(e);
    } else singoli.push(e);
  });

  // SCREEN: LISTA LOTTI
  if (screen === 'lista') return (
    <div style={{ minHeight:'100vh', background:C.bg, fontFamily:SANS }}>
      <div style={{ background:'linear-gradient(135deg,#1a2640,#2e7cf6)', padding:'20px 16px 16px', color:'white' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
          <div>
            <div style={{ fontSize:11, opacity:0.7, marginBottom:4, textTransform:'uppercase', letterSpacing:1 }}>Cardiologo</div>
            <div style={{ fontSize:18, fontWeight:700 }}>Dott. {meCardiologo}</div>
            <div style={{ fontSize:13, opacity:0.8, marginTop:2 }}>{mieiEcgs.filter(e=>e.stato==='in_attesa').length} ECG da refertare</div>
          </div>
          <div style={{display:'flex',gap:6,marginTop:4,alignItems:'center'}}>
            <button onClick={registraPush} style={{background:pushAbilitato?'rgba(26,170,110,0.25)':'rgba(255,220,0,0.25)',border:`1px solid ${pushAbilitato?'rgba(26,170,110,0.5)':'rgba(255,220,0,0.5)'}`,color:'white',borderRadius:10,padding:'8px 12px',cursor:'pointer',fontSize:16}} title={pushAbilitato?"Notifiche attive — tocca per rinnovare":"Abilita notifiche"}>{pushAbilitato?"🔔✓":"🔔"}</button>
            <button onClick={onLogout} style={{ background:'rgba(255,255,255,0.15)', border:'none', color:'white', borderRadius:10, padding:'8px 14px', cursor:'pointer', fontSize:13, fontWeight:600 }}>Esci</button>
          </div>
        </div>
      </div>
      <div style={{ padding:16, display:'flex', flexDirection:'column', gap:12 }}>
        {Object.entries(batches).map(([batchId, batch]) => {
          const refertati = batch.ecgs.filter(e=>e.stato==='refertato').length;
          const totale = batch.ecgs.length;
          const tuttiRefertati = refertati===totale;
          return (
            <div key={batchId} onClick={()=>{ setSelectedBatch({id:batchId,...batch}); setScreen('lotto'); }}
              style={{ background:C.white, borderRadius:16, padding:20, boxShadow:'0 2px 12px rgba(0,0,0,0.06)', border:`1px solid ${C.border}`, cursor:'pointer', active:{background:C.accentLight} }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
                <div style={{ fontWeight:700, fontSize:16, color:C.text }}>📦 {batch.nome}</div>
                <div style={{ background:tuttiRefertati?C.green:C.purple, color:'white', borderRadius:20, padding:'4px 12px', fontSize:13, fontWeight:700 }}>{refertati}/{totale}</div>
              </div>
              <div style={{ background:C.bg, borderRadius:20, height:6 }}>
                <div style={{ height:'100%', width:`${(refertati/totale)*100}%`, background:tuttiRefertati?C.green:C.accent, borderRadius:20 }} />
              </div>
              {!tuttiRefertati && <div style={{ color:C.muted, fontSize:12, marginTop:8 }}>Tocca per aprire il lotto →</div>}
              {tuttiRefertati && <div style={{ color:C.green, fontSize:12, fontWeight:600, marginTop:8 }}>✓ Lotto completato</div>}
            </div>
          );
        })}
        {singoli.filter(e=>e.stato==='in_attesa').map(ecg => (
          <div key={ecg.id} onClick={()=>apriEcg(ecg)}
            style={{ background:C.white, borderRadius:16, padding:20, boxShadow:'0 2px 12px rgba(0,0,0,0.06)', border:`1px solid ${C.border}`, cursor:'pointer' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div>
                <div style={{ fontWeight:700, fontSize:15, color:C.text }}>💊 {ecg.paziente_nome||ecg.paziente}</div>
                <div style={{ color:C.muted, fontSize:12, marginTop:2 }}>{ecg.farmacia||ecg.origine_dettaglio}</div>
              </div>
              <div style={{ color:C.accent, fontWeight:700, fontSize:13 }}>Referta →</div>
            </div>
          </div>
        ))}
        {mieiEcgs.filter(e=>e.stato==='in_attesa').length===0 && (
          <div style={{ textAlign:'center', padding:60 }}>
            <div style={{ fontSize:48, marginBottom:12 }}>🎉</div>
            <div style={{ color:C.green, fontWeight:700, fontSize:18 }}>Coda vuota!</div>
            <div style={{ color:C.muted, fontSize:14, marginTop:4 }}>Nessun ECG da refertare</div>
          </div>
        )}
      </div>
    </div>
  );

  // SCREEN: LOTTO
  if (screen === 'lotto') {
    const batchEcgs = selectedBatch ? mieiEcgs.filter(e=>e.batch_id===selectedBatch.id) : [];
    const tuttiRefertati = batchEcgs.every(e=>e.stato==='refertato');
    return (
      <div style={{ minHeight:'100vh', background:C.bg, fontFamily:SANS }}>
        <div style={{ background:'linear-gradient(135deg,#1a2640,#2e7cf6)', padding:'20px 16px 16px', color:'white', display:'flex', alignItems:'center', gap:12 }}>
          <button onClick={()=>setScreen('lista')} style={{ background:'rgba(255,255,255,0.2)', border:'none', color:'white', borderRadius:10, padding:'8px 12px', cursor:'pointer', fontSize:18 }}>←</button>
          <div>
            <div style={{ fontSize:18, fontWeight:700 }}>{selectedBatch?.nome}</div>
            <div style={{ fontSize:13, opacity:0.8 }}>{batchEcgs.filter(e=>e.stato==='refertato').length}/{batchEcgs.length} refertati</div>
          </div>
        </div>
        <div style={{ padding:16, display:'flex', flexDirection:'column', gap:10 }}>
          {batchEcgs.map(ecg => (
            <div key={ecg.id} onClick={()=>ecg.stato==='in_attesa'&&apriEcg(ecg)}
              style={{ background:C.white, borderRadius:14, padding:18, boxShadow:'0 2px 8px rgba(0,0,0,0.05)', border:`2px solid ${ecg.stato==='refertato'?C.green:C.border}`, cursor:ecg.stato==='in_attesa'?'pointer':'default', opacity:ecg.stato==='refertato'?0.7:1 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <div style={{ fontWeight:600, fontSize:15, color:C.text }}>{ecg.paziente_nome||ecg.paziente}</div>
                <div style={{ background:ecg.stato==='refertato'?C.greenLight:C.orangeLight, color:ecg.stato==='refertato'?C.green:C.orange, borderRadius:20, padding:'4px 12px', fontSize:12, fontWeight:700 }}>
                  {ecg.stato==='refertato'?'✓ Refertato':'Da refertare'}
                </div>
              </div>
              {ecg.stato==='in_attesa' && <div style={{ color:C.muted, fontSize:12, marginTop:4 }}>Tocca per refertare →</div>}
            </div>
          ))}
          {tuttiRefertati && (
            <div style={{ background:'#f0fdf4', border:`2px solid ${C.green}`, borderRadius:14, padding:20 }}>
              <div style={{ color:C.green, fontWeight:700, fontSize:16, marginBottom:4, textAlign:'center' }}>🎉 Lotto completato!</div>
              <div style={{ color:C.muted, fontSize:12, textAlign:'center', marginBottom:14 }}>{selectedBatch?.email || 'nessuna email'}</div>
              <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                <button onClick={()=>chiudiBatchMobile(selectedBatch.id, selectedBatch.nome, selectedBatch.email)}
                  disabled={chiudendo}
                  style={{ background:chiudendo?C.border:'linear-gradient(135deg,#1aaa6e,#0ea5a0)', color:chiudendo?C.muted:'white', border:'none', borderRadius:12, padding:'16px 0', cursor:chiudendo?'not-allowed':'pointer', fontWeight:700, fontSize:15 }}>
                  {chiudendo ? '⏳ Invio...' : '✉️ Invia email al cliente'}
                </button>
                <button onClick={()=>scaricaBatchMobile(selectedBatch.id, selectedBatch.nome)}
                  style={{ background:'white', border:`2px solid ${C.accent}`, color:C.accent, borderRadius:12, padding:'14px 0', cursor:'pointer', fontWeight:700, fontSize:15 }}>
                  ⬇️ Scarica ZIP
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // SCREEN: REFERTAZIONE
  const CROCETTE_MOBILE = [
    {k:'limiti', label:'ECG nei limiti della norma', color:'#1aaa6e'},
    {k:'correlare', label:'ECG da correlare con la clinica', color:'#f59e0b'},
    {k:'approfondire', label:'ECG da approfondire con Medico Curante', color:'#e03e5a'},
    {k:'visita', label:'ECG da approfondire con visita cardiologica', color:'#8b5cf6'},
    {k:'urgente', label:'Se nuova sintomatologia: visita cardiologica urgente', color:'#ef4444'},
  ];

  return (
    <div style={{ minHeight:'100vh', background:'#f4f7fb', fontFamily:SANS, paddingBottom:100 }}>
      {/* Header */}
      <div style={{ background:'linear-gradient(135deg,#1a2640,#2e7cf6)', padding:'16px', color:'white', display:'flex', alignItems:'center', gap:10 }}>
        <button onClick={()=>{ setScreen(selectedEcg?.batch_id?'lotto':'lista'); resetReferta(); }}
          style={{ background:'rgba(255,255,255,0.2)', border:'none', color:'white', borderRadius:10, padding:'8px 12px', cursor:'pointer', fontSize:18 }}>←</button>
        <div style={{ flex:1 }}>
          <div style={{ fontWeight:700, fontSize:15 }}>{selectedEcg?.paziente_nome||selectedEcg?.paziente}</div>
          <div style={{ fontSize:12, opacity:0.8 }}>{selectedEcg?.batch_nome||selectedEcg?.farmacia||selectedEcg?.origine_dettaglio}</div>
        </div>
      </div>

      {/* Modalità referto */}
      <div style={{display:'flex',gap:8,margin:'0 12px 8px'}}>
        {[['overlay','🫀 Sul tracciato'],['pagina-separata','📄 Pagina separata']].map(([v,l])=>(
          <button key={v} onClick={()=>setPosizioneMobile(v)}
            style={{flex:1,padding:'9px 4px',borderRadius:10,cursor:'pointer',fontWeight:600,fontSize:12,
              border:`2px solid ${posizioneMobile===v?C.accent:C.border}`,
              background:posizioneMobile===v?C.accentLight:C.bg,
              color:posizioneMobile===v?C.accent:C.muted}}>
            {l}
          </button>
        ))}
      </div>

      {/* Anteprima ECG */}
      <div style={{ margin:12, background:'white', borderRadius:14, overflow:'hidden', boxShadow:'0 2px 12px rgba(0,0,0,0.06)' }}>
        <div style={{ padding:'10px 14px', display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:`1px solid ${C.borderLight}` }}>
          <div style={{ fontWeight:600, fontSize:12, color:C.muted, textTransform:'uppercase', letterSpacing:1 }}>Tracciato ECG</div>
          <div style={{ display:'flex', gap:6 }}>
            <button onClick={()=>setZoom(z=>Math.max(0.5,z-0.25))} style={{ background:C.bg, border:`1px solid ${C.border}`, borderRadius:8, padding:'4px 10px', cursor:'pointer', fontWeight:700 }}>−</button>
            <button onClick={()=>setZoom(z=>Math.min(3,z+0.25))} style={{ background:C.bg, border:`1px solid ${C.border}`, borderRadius:8, padding:'4px 10px', cursor:'pointer', fontWeight:700 }}>+</button>
            <button onClick={()=>setRotationMobile(r=>(r-90+360)%360)} style={{ background:C.bg, border:`1px solid ${C.border}`, borderRadius:8, padding:'4px 10px', cursor:'pointer', fontSize:14 }}>↺</button>
            <button onClick={()=>setRotationMobile(r=>(r+90)%360)} style={{ background:C.bg, border:`1px solid ${C.border}`, borderRadius:8, padding:'4px 10px', cursor:'pointer', fontSize:14 }}>↻</button>
            {ecgUrl && ecgType==='pdf' && <a href={ecgUrl} target="_blank" rel="noreferrer" style={{ background:C.bg, border:`1px solid ${C.border}`, borderRadius:8, padding:'4px 10px', fontSize:12, color:C.accent, textDecoration:'none', fontWeight:600 }}>🔍 Tab</a>}
          </div>
        </div>
        <div style={{ overflow:'auto', maxHeight:'38vh', background:'#f5f5f5' }}>
          {previewDataUrl
            ? <img src={previewDataUrl} alt="ECG" style={{ width:rotationMobile===90||rotationMobile===270?`${zoom*60}%`:`${zoom*100}%`, display:'block', transform:`rotate(${rotationMobile}deg)`, transformOrigin:'center center', margin:rotationMobile===90||rotationMobile===270?'15% auto':'0' }} />
            : <div style={{ padding:40, textAlign:'center', color:C.muted }}>⏳ Caricamento...</div>
          }
        </div>
      </div>

      {/* Crocette */}
      <div style={{ margin:'0 12px', display:'flex', flexDirection:'column', gap:8 }}>
        {CROCETTE_MOBILE.map(({k,label,color}) => (
          <button key={k} onClick={()=>setCrocette(p=>({...p,[k]:!p[k]}))}
            style={{ background:crocette[k]?color+'18':'white', border:`2px solid ${crocette[k]?color:C.border}`, borderRadius:12, padding:'14px 16px', cursor:'pointer', textAlign:'left', display:'flex', alignItems:'center', gap:12, transition:'all 0.15s' }}>
            <div style={{ width:26, height:26, borderRadius:8, border:`2px solid ${crocette[k]?color:C.border}`, background:crocette[k]?color:'white', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
              {crocette[k] && <span style={{ color:'white', fontWeight:700, fontSize:16 }}>✓</span>}
            </div>
            <span style={{ fontSize:14, color:crocette[k]?color:C.textSoft, fontWeight:crocette[k]?700:400, lineHeight:1.3 }}>{label}</span>
          </button>
        ))}
      </div>

      {/* Commento */}
      <div style={{ margin:'12px 12px 0' }}>
        <textarea value={commento} onChange={e=>setCommento(e.target.value)}
          placeholder="Commento del cardiologo (opzionale)..."
          rows={3}
          style={{ width:'100%', background:'white', border:`1px solid ${C.border}`, borderRadius:12, padding:'12px 14px', color:C.text, fontSize:14, outline:'none', resize:'none', fontFamily:SANS, boxSizing:'border-box' }} />
      </div>

      {/* Bottone fisso in basso */}
      <div style={{ position:'fixed', bottom:0, left:0, right:0, padding:'12px 16px', background:'white', borderTop:`1px solid ${C.border}`, boxShadow:'0 -4px 20px rgba(0,0,0,0.08)' }}>
        {!ecgFile && <div style={{ textAlign:'center', color:C.muted, fontSize:13, marginBottom:8 }}>⏳ Caricamento ECG...</div>}
        <button onClick={generaEConferma} disabled={!ecgFile||!almenoCrocetta||generating}
          style={{ width:'100%', background:(!ecgFile||!almenoCrocetta||generating)?C.border:'linear-gradient(135deg,#1aaa6e,#0ea5a0)', color:(!ecgFile||!almenoCrocetta||generating)?C.muted:'white', border:'none', borderRadius:14, padding:'18px 0', cursor:(!ecgFile||!almenoCrocetta||generating)?'not-allowed':'pointer', fontWeight:700, fontSize:16, letterSpacing:0.3 }}>
          {generating ? '⏳ Generazione in corso...' : !almenoCrocetta ? 'Seleziona almeno una crocetta' : '✓ Genera e Conferma referto'}
        </button>
      </div>
    </div>
  );
};

// ── ADMIN MOBILE ───────────────────────────────────────────────────────────
const AdminMobile = ({ ecgs, setEcgs, caricaEcgs, onLogout }) => {
  const [screen, setScreen] = useState('dashboard');
  const [cardiologiDB, setCardiologiDB] = useState([]);
  const [assegnando, setAssegnando] = useState(null);

  useEffect(() => {
    Promise.all([
      supabase.from('user_profiles').select('nome, cognome').eq('ruolo', 'cardiologo'),
      supabase.from('user_profiles').select('nome, cognome').contains('ruoli', ['cardiologo'])
    ]).then(([r1, r2]) => {
      const tutti = [...(r1.data||[]), ...(r2.data||[])];
      const unici = [...new Set(tutti.map(c=>(c.nome?c.nome+' '+c.cognome:c.cognome).trim()))];
      setCardiologiDB(unici);
    });
  }, []);

  const inAttesa = ecgs.filter(e=>e.stato==='in_attesa');
  const refertati = ecgs.filter(e=>e.stato==='refertato');
  const urgenti = inAttesa.filter(e=>e.urgenza==='urgente');

  // Lotti non assegnati
  const batches = {};
  inAttesa.filter(e=>e.batch_id&&!e.cardiologo).forEach(e=>{
    if(!batches[e.batch_id]) batches[e.batch_id]={nome:e.batch_nome||e.batch_id,ecgs:[],email:e.email_destinatario};
    batches[e.batch_id].ecgs.push(e);
  });

  const assegnaBatch = async (batchId, cardiologo) => {
    setAssegnando(batchId);
    await supabase.from('ecgs').update({ cardiologo_nome: cardiologo }).eq('batch_id', batchId).is('cardiologo_nome', null);
    setEcgs(prev=>prev.map(e=>e.batch_id===batchId&&!e.cardiologo?{...e,cardiologo,cardiologo_nome:cardiologo}:e));
    setAssegnando(null);
  };

  if (screen === 'dashboard') return (
    <div style={{ minHeight:'100vh', background:C.bg, fontFamily:SANS }}>
      <div style={{ background:'linear-gradient(135deg,#1a2640,#2e7cf6)', padding:'20px 16px', color:'white' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
          <div>
            <div style={{ fontSize:11, opacity:0.7, textTransform:'uppercase', letterSpacing:1, marginBottom:4 }}>Ambulatorio Millefonti</div>
            <div style={{ fontSize:20, fontWeight:700 }}>Dashboard Admin</div>
          </div>
          <button onClick={onLogout} style={{ background:'rgba(255,255,255,0.15)', border:'none', color:'white', borderRadius:10, padding:'8px 14px', cursor:'pointer', fontSize:13, fontWeight:600, marginTop:4 }}>Esci</button>
        </div>
      </div>
      <div style={{ padding:16, display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
        {[
          ['📋', 'Totali', ecgs.length, C.accent],
          ['📥', 'In attesa', inAttesa.length, C.orange],
          ['✅', 'Refertati', refertati.length, C.green],
          ['⚡', 'Urgenti', urgenti.length, '#ef4444'],
        ].map(([icon,label,value,color])=>(
          <div key={label} style={{ background:'white', borderRadius:16, padding:20, boxShadow:'0 2px 8px rgba(0,0,0,0.05)', border:`1px solid ${C.border}` }}>
            <div style={{ fontSize:28, marginBottom:6 }}>{icon}</div>
            <div style={{ fontSize:28, fontWeight:700, color, lineHeight:1 }}>{value}</div>
            <div style={{ fontSize:12, color:C.muted, marginTop:4 }}>{label}</div>
          </div>
        ))}
      </div>
      <div style={{ padding:'0 16px', display:'flex', flexDirection:'column', gap:10 }}>
        <button onClick={()=>setScreen('assegna')} style={{ background:'white', border:`2px solid ${C.accent}`, borderRadius:14, padding:18, cursor:'pointer', textAlign:'left', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div>
            <div style={{ fontWeight:700, fontSize:15, color:C.text }}>📥 Assegna lotti</div>
            <div style={{ color:C.muted, fontSize:13, marginTop:2 }}>{Object.keys(batches).length} lotti in attesa</div>
          </div>
          <div style={{ color:C.accent, fontSize:20 }}>→</div>
        </button>
        <button onClick={caricaEcgs} style={{ background:'white', border:`1px solid ${C.border}`, borderRadius:14, padding:16, cursor:'pointer', color:C.muted, fontWeight:600, fontSize:14 }}>
          🔄 Aggiorna dati
        </button>
      </div>
    </div>
  );

  if (screen === 'assegna') return (
    <div style={{ minHeight:'100vh', background:C.bg, fontFamily:SANS }}>
      <div style={{ background:'linear-gradient(135deg,#1a2640,#2e7cf6)', padding:'16px', color:'white', display:'flex', alignItems:'center', gap:12 }}>
        <button onClick={()=>setScreen('dashboard')} style={{ background:'rgba(255,255,255,0.2)', border:'none', color:'white', borderRadius:10, padding:'8px 12px', cursor:'pointer', fontSize:18 }}>←</button>
        <div style={{ fontSize:18, fontWeight:700 }}>Lotti da assegnare</div>
      </div>
      <div style={{ padding:16, display:'flex', flexDirection:'column', gap:12 }}>
        {Object.entries(batches).map(([batchId,batch])=>(
          <div key={batchId} style={{ background:'white', borderRadius:16, padding:20, boxShadow:'0 2px 8px rgba(0,0,0,0.05)', border:`1px solid ${C.border}` }}>
            <div style={{ fontWeight:700, fontSize:15, color:C.text, marginBottom:4 }}>📦 {batch.nome}</div>
            <div style={{ color:C.muted, fontSize:13, marginBottom:14 }}>{batch.ecgs.length} ECG · {batch.email||'—'}</div>
            {cardiologiDB.map(nome=>(
              <button key={nome} onClick={()=>assegnaBatch(batchId,nome)} disabled={assegnando===batchId}
                style={{ width:'100%', background:assegnando===batchId?C.border:C.accent, color:'white', border:'none', borderRadius:10, padding:'14px 0', cursor:'pointer', fontWeight:700, fontSize:14, marginBottom:8 }}>
                {assegnando===batchId?'⏳ Assegnando...':`→ Assegna a ${nome}`}
              </button>
            ))}
          </div>
        ))}
        {Object.keys(batches).length===0 && (
          <div style={{ textAlign:'center', padding:60 }}>
            <div style={{ fontSize:48, marginBottom:12 }}>✅</div>
            <div style={{ color:C.green, fontWeight:700, fontSize:18 }}>Tutto assegnato!</div>
          </div>
        )}
      </div>
    </div>
  );

  return null;
};


// ── APP ───────────────────────────────────────────────────────────────────
export default function App() {
  const [role, setRole] = useState(null);
  const [ruoliDisponibili, setRuoliDisponibili] = useState([]);
  const [meCardiologo, setMeCardiologo] = useState(ME_CARDIOLOGO_DEFAULT);
  const [ecgs, setEcgs] = useState([]);
  const [cardiologiDB, setCardiologiDB] = useState([]);
  const isMobile = useIsMobile(); // deve stare prima di qualsiasi return

  const mapEcg = (e) => ({
    ...e,
    paziente: `${e.paziente_nome||'?'}, ${e.paziente_eta||'?'}a, ${e.paziente_sesso||'?'}`,
    farmacia: e.origine_dettaglio,
    azienda: e.origine_dettaglio,
    batch: e.batch_nome || e.batch_id,
    batch_nome: e.batch_nome,
    ts: new Date(e.created_at).getTime(),
    cardiologo: e.cardiologo_nome||null,
    chat: [],
  });

  const caricaEcgs = async () => {
    const { data, error } = await supabase.from('ecgs').select('*').order('created_at', { ascending: false });
    if (!error && data) setEcgs(data.map(mapEcg));
  };

  useEffect(() => {
    if (!role) return;
    caricaEcgs();
    // Realtime: aggiorna automaticamente quando cambia il DB
    const channel = supabase.channel('ecgs-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ecgs' }, async (payload) => {
        if (payload.eventType === 'INSERT') {
          const newEcg = payload.new;
          // Applica regole automatiche se ECG non ha cardiologo
          if (!newEcg.cardiologo_nome) {
            let dest = '';
            // 1. Controlla regola specifica per azienda
            const nomeAz = newEcg.origine_dettaglio || newEcg.azienda || '';
            if (nomeAz) {
              const { data: regAz } = await supabase.from('regole_per_azienda')
                .select('cardiologo_nome').eq('azienda_nome', nomeAz).maybeSingle();
              if (regAz?.cardiologo_nome) dest = regAz.cardiologo_nome;
            }
            // 2. Fallback: regole generali
            if (!dest) {
              const { data: regole } = await supabase.from('regole_assegnazione').select('*').single();
              if (regole) {
                const giorni = ['domenica','lunedi','martedi','mercoledi','giovedi','venerdi','sabato'];
                if (regole.modalita === 'unico') dest = regole.cardiologo_unico;
                else if (regole.modalita === 'giorni') dest = regole[giorni[new Date(newEcg.created_at).getDay()]] || '';
              }
            }
            if (dest) {
              await supabase.from('ecgs').update({ cardiologo_nome: dest }).eq('id', newEcg.id);
              newEcg.cardiologo_nome = dest;
            }
          }
          setEcgs(prev => [mapEcg(newEcg), ...prev]);
        } else if (payload.eventType === 'UPDATE') {
          setEcgs(prev => prev.map(e => e.id === payload.new.id ? mapEcg(payload.new) : e));
        } else if (payload.eventType === 'DELETE') {
          setEcgs(prev => prev.filter(e => e.id !== payload.old.id));
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [role]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const s = document.createElement("style");
    s.textContent = `@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@400;500;600;700&display=swap'); *{box-sizing:border-box;margin:0;padding:0} body{background:#f4f7fb;font-family:'DM Sans',sans-serif} select,input,textarea{color-scheme:light} ::-webkit-scrollbar{width:5px} ::-webkit-scrollbar-track{background:#f0f4fa} ::-webkit-scrollbar-thumb{background:#c8d6e8;border-radius:4px}`;
    document.head.appendChild(s);

    // Controlla sessione attiva
    import('@supabase/supabase-js').then(() => {
      const { supabase } = require('./supabase.js');
    }).catch(() => {});

    supabaseAuth();

    // Ricarica ECG quando l'app torna in primo piano (PWA iPhone)
    const onVisible = () => {
      if (document.visibilityState === 'visible') caricaEcgs();
    };
    document.addEventListener('visibilitychange', onVisible);

    // Polling ogni 30 secondi come fallback al realtime
    const pollInterval = setInterval(() => caricaEcgs(), 30000);

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(pollInterval);
    };
  }, []);

  // Ref per evitare doppia chiamata a caricaRuolo
  const authDoneRef = useRef(false);
  const [pushAbilitato, setPushAbilitato] = useState(false);

  // Ripristina push automaticamente se già abilitato
  useEffect(() => {
    if (role !== 'cardiologo') return;
    if (!('Notification' in window) || !('serviceWorker' in navigator)) return;
    if (Notification.permission !== 'granted') return;
    navigator.serviceWorker.ready
      .then(reg => reg.pushManager.getSubscription())
      .then(sub => { if (sub) setPushAbilitato(true); })
      .catch(() => {});
  }, [role]);

  const urlBase64ToUint8Array = (b64) => {
    const pad = '='.repeat((4 - b64.length % 4) % 4);
    const base64 = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
  };

  const registraPush = async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      alert('Il tuo browser non supporta le notifiche push'); return;
    }
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const permesso = await Notification.requestPermission();
      if (permesso !== 'granted') { alert('Permesso notifiche negato'); return; }
      const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
      if (!vapidKey) { alert('VAPID key mancante'); return; }
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidKey) });
      const { data: { session } } = await supabase.auth.getSession();
      await fetch('/api/push-subscribe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON(), cardiologo_nome: meCardiologo, user_id: session.user.id }),
      });
      setPushAbilitato(true);
      alert('✅ Notifiche attivate!');
    } catch(e) { console.error('Push error:', e); alert('Errore: ' + e.message); }
  };

  const supabaseAuth = async () => {
    // Safety: se dopo 6 secondi loading è ancora true, sblocca
    const safetyTimer = setTimeout(() => setLoading(false), 6000);
    try {
      const { supabase } = await import('./supabase.js');

      // 1. Controlla sessione esistente (affidabile su tutti i browser)
      const { data: { session } } = await supabase.auth.getSession();
      if (session && !authDoneRef.current) {
        authDoneRef.current = true;
        clearTimeout(safetyTimer);
        await caricaRuolo(supabase, session.user.id);
      } else if (!session) {
        clearTimeout(safetyTimer);
        setLoading(false);
      }

      // 2. Ascolta cambiamenti successivi (login/logout)
      supabase.auth.onAuthStateChange(async (event, session) => {
        if (event === 'SIGNED_OUT') {
          authDoneRef.current = false;
          setRole(null); setRuoliDisponibili([]); setMeCardiologo(ME_CARDIOLOGO_DEFAULT);
          setLoading(false);
        } else if (event === 'SIGNED_IN' && session && !authDoneRef.current) {
          // Solo se getSession non ha già gestito la sessione
          authDoneRef.current = true;
          await caricaRuolo(supabase, session.user.id);
        }
        // INITIAL_SESSION ignorato: già gestito da getSession() sopra
      });
    } catch(e) {
      clearTimeout(safetyTimer);
      setLoading(false);
    }
  };

  const caricaRuolo = async (supabase, userId) => {
    try {
      const { data } = await supabase
        .from('user_profiles')
        .select('ruolo, ruoli, nome, cognome')
        .eq('id', userId)
        .single();
      if (data?.nome || data?.cognome) {
        setMeCardiologo(`${data.nome||''} ${data.cognome||''}`.trim());
      }
      if (data?.ruoli && data.ruoli.length > 1) {
        const savedRole = localStorage.getItem('preferito_ruolo');
        setRuoliDisponibili(data.ruoli); // sempre popolato per il bottone "Cambia ruolo"
        if (savedRole && data.ruoli.includes(savedRole)) {
          setRole(savedRole);
        } else {
          setRole(null);
        }
      } else if (data?.ruolo) {
        setRole(data.ruolo);
      }
    } catch(e) {
      console.error('caricaRuolo error:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (email, password) => {
    for (let i = 0; i < 2; i++) {
      try {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (!error) return null;
        if (error.message.includes('Invalid login') || error.message.includes('Email not confirmed')) {
          return error.message;
        }
        if (i === 0) await new Promise(r => setTimeout(r, 800));
      } catch(e) {
        if (i === 1) return 'Errore di connessione. Riprova.';
        await new Promise(r => setTimeout(r, 800));
      }
    }
    return 'Errore di connessione. Riprova.';
  };

  const handleCambiaRuolo = () => {
    localStorage.removeItem('preferito_ruolo');
    setRole(null);
  };

  const handleLogout = (cambiaProfilo = false) => {
    authDoneRef.current = false;
    if (cambiaProfilo) localStorage.removeItem('preferito_ruolo');
    setEcgs([]);
    setMeCardiologo(ME_CARDIOLOGO_DEFAULT);
    setCardiologiDB([]);
    setRole(null);
    setRuoliDisponibili([]);
    supabase.auth.signOut();
  };

  if (loading) return (
    <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", background:"#f4f7fb", fontFamily:SANS }}>
      <div style={{ textAlign:"center" }}>
        <img src="/logo-squared.png" alt="logo" style={{ width:56, height:56, borderRadius:14, objectFit:"cover", margin:"0 auto 16px", display:"block" }} />
        <div style={{ color:"#8098b8", fontSize:14 }}>Caricamento...</div>
      </div>
    </div>
  );

  // Route /carica — pagina pubblica senza login
  if (window.location.pathname === '/carica') return <UploadGenerico />;


  if (ruoliDisponibili.length > 1 && !role) return (
    <div style={{ minHeight:"100vh", background:"linear-gradient(135deg, #e8f2ff, #f4f7fb, #e8f9f4)", display:"flex", alignItems:"center", justifyContent:"center", padding:24, fontFamily:SANS }}>
      <div style={{ maxWidth:400, width:"100%", textAlign:"center" }}>
        <img src="/logo-squared.png" alt="logo" style={{ width:120, height:120, objectFit:"contain", margin:"0 auto 20px", display:"block", mixBlendMode:"multiply" }} />
        <h2 style={{ color:"#1a2640", fontSize:22, fontWeight:700, marginBottom:8 }}>Con quale ruolo vuoi accedere?</h2>
        <p style={{ color:"#8098b8", fontSize:13, marginBottom:32 }}>Seleziona il profilo per questa sessione</p>
        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
          {ruoliDisponibili.map(r => (
            <button key={r} onClick={async () => {
              localStorage.setItem('preferito_ruolo', r);
              setRole(r);
              if (r === 'cardiologo') {
                const { data: { session } } = await supabase.auth.getSession();
                const { data: profile } = await supabase.from('user_profiles').select('nome, cognome').eq('id', session.user.id).single();
                if (profile) setMeCardiologo((profile.nome ? profile.nome + ' ' + profile.cognome : profile.cognome).trim());
              }
            }}
              style={{ background:"white", border:"2px solid #dde5f0", borderRadius:14, padding:"18px 24px", cursor:"pointer", fontWeight:700, fontSize:16, color:"#1a2640", display:"flex", alignItems:"center", gap:14, boxShadow:"0 2px 12px rgba(46,124,246,0.08)", transition:"all 0.15s" }}>
              <span style={{ fontSize:28 }}>{r === 'admin' ? '🔑' : r === 'cardiologo' ? '🫀' : r === 'farmacia' ? '💊' : '🏢'}</span>
              <div style={{ textAlign:"left" }}>
                <div style={{ fontWeight:700, fontSize:15 }}>{r === 'admin' ? 'Amministratore' : r === 'cardiologo' ? 'Cardiologo' : r === 'farmacia' ? 'Farmacia' : 'Azienda'}</div>
                <div style={{ color:"#8098b8", fontSize:12, fontWeight:400, marginTop:2 }}>{r === 'admin' ? 'Gestione completa della piattaforma' : r === 'cardiologo' ? 'Refertazione ECG' : ''}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  if (!role) return <LoginReale onLogin={handleLogin} />;

  // Vista mobile — bypassa completamente Shell
  if (isMobile && role === 'cardiologo') return <CardiologoMobile ecgs={ecgs} setEcgs={setEcgs} meCardiologo={meCardiologo} caricaEcgs={caricaEcgs} onLogout={handleLogout} pushAbilitato={pushAbilitato} registraPush={registraPush} />;
  if (isMobile && role === 'admin') return <AdminMobile ecgs={ecgs} setEcgs={setEcgs} caricaEcgs={caricaEcgs} onLogout={handleLogout} />;

  return (
    <Shell role={role} onLogout={handleLogout} meCardiologo={meCardiologo} onCambiaRuolo={ruoliDisponibili.length > 1 ? handleCambiaRuolo : undefined}>
      {role==="pubblico"   && <PubblicoView setEcgs={setEcgs} />}
      {role==="farmacia"   && <FarmaciaView ecgs={ecgs} setEcgs={setEcgs} />}
      {role==="azienda"    && <AziendaView  ecgs={ecgs} setEcgs={setEcgs} />}
      {role==="cardiologo" && <CardiologoView ecgs={ecgs} setEcgs={setEcgs} meCardiologo={meCardiologo} caricaEcgs={caricaEcgs} pushAbilitato={pushAbilitato} registraPush={registraPush} />}
      {role==="admin"      && <AdminView    ecgs={ecgs} setEcgs={setEcgs} cardiologiDB={cardiologiDB} />}
    </Shell>
  );
}
