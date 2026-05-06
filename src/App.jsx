import { supabase } from "./supabase.js";
import { useState, useEffect, useRef, useCallback } from "react";
import { jsPDF } from "jspdf";

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

const Logo = ({ size=34 }) => (
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
          {Object.entries(CARDIOLOGI_DATA).map(([nome,d])=>(
            <button key={nome} onClick={()=>{ onSelectCardiologo(nome); onLogin("cardiologo"); }}
              style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:14, padding:"16px 20px", cursor:"pointer", display:"flex", alignItems:"center", gap:14, textAlign:"left", boxShadow:C.shadow }}>
              <div style={{ width:40, height:40, background:C.accentLight, borderRadius:12, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 }}>🫀</div>
              <div style={{ flex:1 }}>
                <div style={{ fontWeight:700, fontSize:14, color:C.text }}>{nome}</div>
                <div style={{ fontSize:12, color:C.muted, marginTop:3 }}>{d.referti} referti · ★ {d.rating}</div>
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
        <img src="/logo-squared.png" alt="logo" style={{ width:220, height:220, objectFit:"contain", margin:"0 auto 16px", display:"block", mixBlendMode:"multiply" }} />
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
  const miei = ecgs.filter(e=>e.origine==="farmacia"&&e.farmacia===ME_FARMACIA);

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
      origine_dettaglio: ME_FARMACIA,
      file_ecg_url: fileUrl,
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
  const [sent, setSent] = useState(false);
  const miei = ecgs.filter(e=>e.origine==="azienda"&&e.azienda===ME_AZIENDA);
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
    if (!batchNome||!emailLotto||filesLotto.length===0) return;
    const batchId = `BATCH-${Date.now()}`;
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
        origine_dettaglio: ME_AZIENDA,
        batch_id: batchId,
        batch_nome: batchNome,
        file_ecg_url: fileUrl,
        email_destinatario: emailLotto,
      };
    }));
    const { data, error } = await supabase.from('ecgs').insert(nuovi).select();
    if (!error && data) {
      const mapped = data.map(e=>({ ...e, paziente:e.paziente_nome, azienda:ME_AZIENDA, batch:batchNome, ts:new Date(e.created_at).getTime(), cardiologo:e.cardiologo_nome||null, chat:[] }));
      setEcgs(prev=>[...prev,...mapped]);
    }
    setSent(true);
    fetch('/api/notify', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ paziente:`Lotto ${batchNome} — ${filesLotto.length} ECG`, origine:"azienda", urgenza:"normale", note:`Azienda: ${ME_AZIENDA} | Email referto: ${emailLotto}` }) }).catch(()=>{});
  };

  return (
    <div style={{ padding:32, maxWidth:800, margin:"0 auto" }}>
      <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:28 }}>
        <div style={{ width:52, height:52, background:"linear-gradient(135deg,#f3edff,#f4f7fb)", borderRadius:16, display:"flex", alignItems:"center", justifyContent:"center", fontSize:26 }}>🏢</div>
        <div><h2 style={{ color:C.text, fontSize:24, fontWeight:700 }}>{ME_AZIENDA}</h2><div style={{ color:C.muted, fontSize:13, marginTop:2 }}>{ecgRefertatiMese.length} ECG refertati questo mese</div></div>
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
            <button onClick={()=>{setSent(false);setBatchNome("");setLavoratori([{ paziente:"", eta:"", sesso:"M", mansione:"", note:"", file:null }])}} style={{ background:C.purple, color:C.white, border:"none", borderRadius:10, padding:"12px 28px", cursor:"pointer", fontWeight:700, fontSize:14 }}>Carica un altro lotto →</button>
          </div>
        ) : (
          <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:20, padding:28, boxShadow:C.shadow }}>
            <h3 style={{ color:C.text, fontSize:17, fontWeight:700, marginBottom:6 }}>Nuovo lotto ECG</h3>
            <p style={{ color:C.muted, fontSize:13, marginBottom:20 }}>Carica tutti i PDF del lotto in una volta. Il nome del file diventa il nome del paziente.</p>
            <div style={{ color:C.textSoft, fontWeight:600, fontSize:13, marginBottom:6 }}>Nome lotto <span style={{color:C.red}}>*</span></div>
            <input style={{...inputStyle, marginBottom:14}} value={batchNome} onChange={e=>setBatchNome(e.target.value)} placeholder='es. SL3M-Maggio2025' />
            <div style={{ color:C.textSoft, fontWeight:600, fontSize:13, marginBottom:6 }}>Email per ricevere i referti <span style={{color:C.red}}>*</span></div>
            <input style={{...inputStyle, marginBottom:14}} type="email" value={emailLotto} onChange={e=>setEmailLotto(e.target.value)} placeholder="medico@azienda.it" />
            <div style={{ color:C.textSoft, fontWeight:600, fontSize:13, marginBottom:6 }}>Carica ECG (selezione multipla) <span style={{color:C.red}}>*</span></div>
            <div onClick={()=>document.getElementById('batch-files').click()}
              style={{border:`2px dashed ${filesLotto.length>0?C.green:C.border}`,borderRadius:12,padding:"28px 20px",textAlign:"center",cursor:"pointer",background:filesLotto.length>0?C.greenLight:"#f8faff",marginBottom:14}}>
              <input id="batch-files" type="file" accept=".pdf,.png,.jpg,.jpeg" multiple style={{display:"none"}}
                onChange={e=>setFilesLotto(e.target.files)} />
              {filesLotto.length>0
                ? <div style={{color:C.green,fontWeight:700}}>{filesLotto.length} file selezionati ✓<br/><span style={{fontSize:12,fontWeight:400,color:C.muted}}>{Array.from(filesLotto).map(f=>f.name).join(', ')}</span></div>
                : <><div style={{fontSize:28,marginBottom:8}}>📁</div><div style={{color:C.textSoft,fontSize:14,fontWeight:500}}>Clicca per selezionare tutti i PDF del lotto</div><div style={{color:C.muted,fontSize:12,marginTop:4}}>Selezione multipla • PDF · PNG · JPG</div></>}
            </div>
            <div style={{ color:C.textSoft, fontWeight:600, fontSize:13, marginBottom:6 }}>Note (opzionale)</div>
            <textarea style={{...inputStyle, resize:"vertical", marginBottom:14}} rows={2} value={noteGenerali} onChange={e=>setNoteGenerali(e.target.value)} placeholder="Es. idoneità annuale, visita periodica..." />
            <button onClick={inviaLotto} style={btnPrimary(!!(batchNome&&emailLotto&&filesLotto.length>0))}>
              Invia lotto ({filesLotto.length} ECG) →
            </button>
          </div>
        )
      )}

      {tab==="storico" && (
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          {miei.map(e=>(
            <div key={e.id} style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:14, padding:"14px 20px", boxShadow:C.shadow, display:"flex", alignItems:"center", gap:12, flexWrap:"wrap" }}>
              <div style={{ flex:1, minWidth:160 }}>
                <div style={{ display:"flex", gap:8, marginBottom:5 }}>
                  <span style={{ fontFamily:MONO, color:C.muted, fontSize:11 }}>{e.id}</span>
                  <Badge stato={e.stato} urgenza={e.urgenza} />
                </div>
                <div style={{ color:C.text, fontSize:14, fontWeight:600 }}>{e.paziente}</div>
                <div style={{ color:C.muted, fontSize:12, marginTop:2 }}>📂 {e.batch}</div>
              </div>
              {e.stato==="refertato" && <div style={{ background:C.greenLight, color:C.green, borderRadius:10, padding:"8px 16px", fontSize:13, fontWeight:700, cursor:"pointer" }}>📄 Scarica</div>}
              {e.stato==="in_attesa" && !e.cardiologo && <div style={{ background:C.yellowLight, color:C.yellow, borderRadius:10, padding:"8px 16px", fontSize:12, fontWeight:600 }}>⏳ In coda</div>}
              {e.stato==="in_attesa" && e.cardiologo && <div style={{ background:C.purpleLight, color:C.purple, borderRadius:10, padding:"8px 16px", fontSize:12, fontWeight:600 }}>🫀 In refertazione</div>}
            </div>
          ))}
          {miei.length===0 && <div style={{ textAlign:"center", padding:40, color:C.muted }}>Nessun ECG ancora caricato</div>}
        </div>
      )}
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
        const page = await pdfDoc.getPage(1);
        const vp = page.getViewport({ scale: 1.5 });
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
              const vp = page.getViewport({ scale: 1.5 });
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
    const rY = Math.round(H * 0.105);
    const rW = Math.round(W * 0.78);
    const rH = Math.round(H * 0.195);

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
    const crocetteH = Math.round(rH * 0.40);
    const bottomH = rH - headerH - crocetteH;

    const pad = Math.round(rH * 0.06);
    const fsTitle = Math.round(rH * 0.14);
    const fsCr = Math.round(rH * 0.063);
    const boxSz = Math.round(fsCr * 1.1);
    const fsCommento = Math.round(rH * 0.092);
    const fsFirma = Math.round(rH * 0.105);

    // ── HEADER ──
    ctx.fillStyle = "#1a2640";
    ctx.font = `bold ${fsTitle}px Arial`;
    ctx.fillText("REFERTO CARDIOLOGICO", rX + pad, rY + headerH * 0.78);

    // Linea sotto titolo
    ctx.strokeStyle = "#1a2640";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(rX + pad, rY + headerH);
    ctx.lineTo(rX + rW - pad, rY + headerH);
    ctx.stroke();

    // ── CROCETTE ──
    const voci = [
      [crocette.limiti,       "ECG nei limiti della norma"],
      [crocette.correlare,    "ECG da correlare con la clinica"],
      [crocette.approfondire, "ECG da approfondire con medico curante"],
      [crocette.visita,       "ECG da approfondire con visita cardiologica"],
      [crocette.urgente,      "Se nuova sintomatologia: visita cardiologica urgente / accesso in PS"],
    ];

    const crocetteY = rY + headerH;
    const colW = (rW - pad * 2) / 2;
    const rowH = Math.round(crocetteH / 3);

    voci.forEach(([checked, label], i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const cx = rX + pad + col * colW;
      const cy = crocetteY + row * rowH + rowH * 0.65;

      // Box
      ctx.strokeStyle = "#1a2640";
      ctx.lineWidth = 1.2;
      ctx.strokeRect(cx, cy - boxSz + 2, boxSz, boxSz);
      if (checked) {
        ctx.fillStyle = "#1aaa6e";
        ctx.font = `bold ${Math.round(boxSz * 1.05)}px Arial`;
        ctx.fillText("✓", cx + 1, cy + 1);
      }
      // Label - può andare a capo se troppo lunga
      ctx.fillStyle = "#1a2640";
      ctx.font = `${fsCr}px Arial`;
      const maxLabelW = colW - boxSz - 12;
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

    // ── BOTTOM: linea separatore ──
    const sepY = crocetteY + crocetteH;
    ctx.strokeStyle = "#cccccc";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(rX + pad, sepY);
    ctx.lineTo(rX + rW - pad, sepY);
    ctx.stroke();

    // Calcola spazio per logo a destra
    const lSize = Math.round(bottomH * 1.05);
    const logoX = rX + rW - lSize - pad;
    const logoY = sepY + (bottomH - lSize) / 2;

    // ── COMMENTO (a sinistra, sopra firma) ──
    const commentoX = rX + pad;
    const commentoMaxW = Math.round(rW * 0.42);
    let commentoY = sepY + fsCr * 1.0;

    if (commento.trim()) {
      ctx.fillStyle = "#1a2640";
      ctx.font = `${fsCommento}px Arial`;
      const words = commento.split(" ");
      let line = "";
      const linesC = [];
      words.forEach(word => {
        const test = line + word + " ";
        if (ctx.measureText(test).width > commentoMaxW && line) {
          linesC.push(line.trim()); line = word + " ";
        } else line = test;
      });
      if (line.trim()) linesC.push(line.trim());
      // Massimo 2 righe per il commento
      linesC.slice(0, 2).forEach((ln, idx) => {
        ctx.fillText(ln, commentoX, commentoY + idx * fsCommento * 1.2);
      });
    }

    // ── FIRMA (centrale, con spazio per firma scannerizzata sopra il nome) ──
    const nomeFirma = meCardiologo.replace(/^Dott\.\s*Dr\.?/i, "Dott.").replace(/^Dr\.?\s/i, "Dott. ");
    const firmaSectionX = rX + Math.round(rW * 0.45);
    const firmaSectionW = Math.round(rW * 0.30);
    const firmaY = sepY + bottomH - fsFirma * 1.3;
    
    // Firma scannerizzata sopra il nome
    if (window.__millefonti_firma) {
      const img = window.__millefonti_firma;
      const maxW = firmaSectionW * 0.85;
      const maxH = fsFirma * 1.8;
      const ratio = img.width / img.height;
      const drawW = Math.min(maxW, maxH * ratio);
      const drawH = drawW / ratio;
      ctx.drawImage(img, firmaSectionX, firmaY - fsFirma * 0.5 - drawH, drawW, drawH);
    } else {
      // Linea placeholder se non c'è firma
      ctx.strokeStyle = "#cccccc";
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(firmaSectionX, firmaY - fsFirma * 0.4);
      ctx.lineTo(firmaSectionX + firmaSectionW * 0.85, firmaY - fsFirma * 0.4);
      ctx.stroke();
    }
    
    ctx.fillStyle = "#1a2640";
    ctx.font = `bold ${fsFirma}px Arial`;
    ctx.fillText(nomeFirma, firmaSectionX, firmaY);
    ctx.font = `${Math.round(fsFirma * 0.75)}px Arial`;
    ctx.fillStyle = "#6b7d99";
    ctx.fillText(new Date().toLocaleDateString("it-IT"), firmaSectionX, firmaY + fsFirma * 1.05);

    // ── LOGO (basso destra) ──
    // Usa l'immagine già pre-caricata dal cache del browser
    if (window.__millefonti_logo && window.__millefonti_logo.complete) {
      try { ctx.drawImage(window.__millefonti_logo, logoX, logoY, lSize, lSize); } catch(e) {}
    } else {
      const logoImg = new Image();
      logoImg.src = "/logo-squared.png";
      window.__millefonti_logo = logoImg;
      try { ctx.drawImage(logoImg, logoX, logoY, lSize, lSize); } catch(e) {}
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
      preloadLogo.onload = () => {
        window.__millefonti_logo = preloadLogo;
        resolve();
      };
      preloadLogo.onerror = () => resolve();
      preloadLogo.src = "/logo-squared.png";
      setTimeout(resolve, 2000);
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
          [crocette.approfondire, "ECG da approfondire con medico curante"],
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
        // JPEG/PNG: sovrapponi riquadro sull'immagine originale
        const img = new Image();
        img.src = ecgUrl;
        await new Promise(r => { img.onload = r; });
        const W = img.naturalWidth;
        const H = img.naturalHeight;
        const isLandscape = W > H;

        // Canvas per il tracciato con overlay
        const canvas = document.createElement("canvas");
        canvas.width = W; canvas.height = H;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);

        // Applica il riquadro di refertazione tramite disegnaOverlay
        disegnaOverlay(ctx, W, H);

        // Genera PDF con immagine modificata
        const ratio = W / H;
        const pdfW = isLandscape ? 297 : 210;
        const pdfH = isLandscape ? pdfW / ratio : pdfW * ratio;
        const pdf = new jsPDF({ orientation: isLandscape?"landscape":"portrait", unit:"mm", format:[pdfW, Math.min(pdfH, 420)] });
        const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
        pdf.addImage(dataUrl, "JPEG", 0, 0, pdfW, Math.min(pdfH, 420));
        if (ecg.batch_id) {
          setPdfBlob(pdf.output("blob"));
        } else {
          pdf.save(`Referto_${ecg.paziente.replace(/[^a-zA-Z]/g,"_")}_${new Date().toISOString().slice(0,10)}.pdf`);
        }

      } else {
        // PDF: converti la prima pagina in immagine, applica overlay, salva come PDF singolo
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;
        const arrayBuffer = await ecgFile.arrayBuffer();
        const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const page = await pdfDoc.getPage(1);
        const viewport = page.getViewport({ scale: 2.5 });
        const cvs = document.createElement("canvas");
        cvs.width = viewport.width; cvs.height = viewport.height;
        const ctx = cvs.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, cvs.width, cvs.height);
        await page.render({ canvasContext: ctx, viewport }).promise;
        // Applica il riquadro di refertazione direttamente sul tracciato
        disegnaOverlay(ctx, cvs.width, cvs.height);
        // Salva come PDF
        const ratio = cvs.width / cvs.height;
        const isLandscape2 = ratio > 1;
        const pdfW = isLandscape2 ? 297 : 210;
        const pdfH = pdfW / ratio;
        const finalPdf = new jsPDF({ orientation: isLandscape2?"landscape":"portrait", unit:"mm", format:[pdfW, pdfH] });
        const imgData = cvs.toDataURL("image/jpeg", 0.95);
        finalPdf.addImage(imgData, "JPEG", 0, 0, pdfW, pdfH);
        if (ecg.batch_id) {
          setPdfBlob(finalPdf.output("blob"));
        } else {
          finalPdf.save(`Referto_${ecg.paziente.replace(/[^a-zA-Z]/g,"_")}_${new Date().toISOString().slice(0,10)}.pdf`);
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
    const refertoFileName = `referti/${nomeFileOriginale}_refertato.pdf`;
    
    // Upload + DB update in background (non bloccare la UI!)
    supabase.storage.from('ecg-files')
      .upload(refertoFileName, pdfBlob, { contentType: 'application/pdf', upsert: true })
      .then(() => {
        supabase.from('ecgs').update({ stato: 'refertato', file_referto_url: refertoFileName }).eq('id', ecg.id);
        // Elimina il file ECG originale per risparmiare spazio
        if (ecg.file_ecg_url) {
          supabase.storage.from('ecg-files').remove([ecg.file_ecg_url]).catch(() => {});
        }
        if (ecg.email_destinatario) {
          supabase.storage.from('ecg-files').createSignedUrl(refertoFileName, 60 * 60 * 24 * 7).then(({ data }) => {
            if (data?.signedUrl) {
              fetch('/api/notify-referto', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  email: ecg.email_destinatario,
                  paziente: ecg.paziente_nome || ecg.paziente,
                  cardiologo: meCardiologo,
                  downloadUrl: data.signedUrl,
                  batch: ecg.batch_id || null,
                })
              }).catch(() => {});
            }
          });
        }
      })
      .catch(e => console.error('Errore upload referto:', e));
    
    // Passa subito al prossimo ECG senza aspettare l'upload!
    onRefertato();
    setConfirming(false);
  };

  const CROCETTE_OPTS = [
    {k:"limiti",      label:"ECG nei limiti della norma",                                          color:C.green},
    {k:"correlare",   label:"ECG da correlare con la clinica",                                     color:C.orange},
    {k:"approfondire",label:"ECG da approfondire con medico curante",                              color:C.red},
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
            {confirming ? "⏳ Invio in corso..." : `Conferma refertazione +${ecg.origine==="azienda"?10:15}€`}
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

const CardiologoView = ({ ecgs, setEcgs, meCardiologo, caricaEcgs }) => {
  const [selected, setSelected] = useState(null);
  const [done, setDone] = useState(false);
  const [file, setFile] = useState(null);
  const [firmaUrl, setFirmaUrl] = useState(null);
  const [uploadingFirma, setUploadingFirma] = useState(false);
  const [showProfilo, setShowProfilo] = useState(false);
  const [pdfBlobsMap, setPdfBlobsMap] = useState({}); // {ecgId: blob} per batch
  const [chiudendoBatch, setChiudendoBatch] = useState(null);

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

  const chiudiBatch = async (batchId) => {
    setChiudendoBatch(batchId);
    const ecgsBatch = mieiEcgs.filter(e => e.batch_id === batchId && e.stato === "refertato");
    // Genera signed URLs per tutti i referti del batch
    const links = await Promise.all(ecgsBatch.map(async (e) => {
      if (!e.file_referto_url) return null;
      const { data } = await supabase.storage.from('ecg-files').createSignedUrl(e.file_referto_url, 60 * 60 * 24 * 7);
      return { paziente: e.paziente_nome || e.paziente, url: data?.signedUrl };
    }));
    const validLinks = links.filter(Boolean);
    // Email unica con tutti i link
    const email = ecgsBatch[0]?.email_destinatario;
    const batchNome = ecgsBatch[0]?.batch_nome || batchId;
    if (email && validLinks.length > 0) {
      const linksHtml = validLinks.map(l => `<li><a href="${l.url}" style="color:#2e7cf6;font-weight:bold;">${l.paziente}</a></li>`).join('');
      await fetch('/api/notify-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, batchNome, cardiologo: meCardiologo, linksHtml, count: validLinks.length })
      }).catch(() => {});
    }
    setChiudendoBatch(null);
    alert(`Lotto "${batchNome}" chiuso! Email inviata a ${email}`);
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
  const guadagnoTot = (me.guadagno || 0) + refertatiMiei.reduce((s,e)=>s+(e.origine==="azienda"?10:15),0);

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
            <div style={{ color:C.muted, fontSize:12, fontWeight:600 }}>Guadagni — mese corrente</div>
            <button onClick={()=>setShowProfilo(p=>!p)} style={{background:showProfilo?"rgba(46,124,246,0.1)":"rgba(255,255,255,0.6)",border:`1px solid ${showProfilo?C.accent:C.border}`,borderRadius:8,padding:"4px 12px",cursor:"pointer",fontSize:12,color:showProfilo?C.accent:C.muted,fontWeight:600}}>⚙️ {meCardiologo}</button>
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
                        <button onClick={()=>chiudiBatch(batchId)} disabled={chiudendoBatch===batchId}
                          style={{ marginTop:8, width:"100%", background:C.green, color:"white", border:"none", borderRadius:8, padding:"7px 0", cursor:"pointer", fontWeight:700, fontSize:12 }}>
                          {chiudendoBatch===batchId ? "⏳ Invio..." : "✉️ Chiudi lotto e invia email"}
                        </button>
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
        {!selected ? (
          <div style={{ textAlign:"center", padding:"80px 0" }}>
            <div style={{ fontSize:56, marginBottom:12 }}>🫀</div>
            <div style={{ color:C.muted, fontSize:15 }}>Seleziona un ECG dalla lista</div>
            <div style={{ color:C.mutedLight, fontSize:12, marginTop:6 }}>Vedi solo gli ECG che ti sono stati assegnati dall'admin</div>
          </div>
        ) : done ? (
          <div style={{ textAlign:"center", padding:"80px 0" }}>
            <div style={{ width:90, height:90, background:C.greenLight, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", fontSize:40, margin:"0 auto 20px" }}>✅</div>
            <div style={{ color:C.green, fontWeight:700, fontSize:22 }}>Referto inviato!</div>
            <div style={{ color:C.green, fontFamily:MONO, fontSize:28, fontWeight:"bold", marginTop:20 }}>+{selected.origine==="azienda"?10:15}€ 💰</div>
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
                onRefertato={()=>{
                  const selectedId = selected.id;
                  const selectedBatchId = selected?.batch_id;
                  // Aggiorna stato locale e calcola prossimo
                  let prossimo = null;
                  setEcgs(prev => {
                    const updated = prev.map(e => e.id===selectedId ? {...e,stato:"refertato"} : e);
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

  // Carica cardiologi dal DB
  useEffect(() => {
    supabase.from('user_profiles').select('nome, cognome').eq('ruolo', 'cardiologo')
      .then(({ data, error }) => {
        console.log('Cardiologi DB:', data, error);
        if (data) setCardiologiDB(data.map(c => (c.nome ? c.nome + ' ' + c.cognome : c.cognome).trim()));
      });
  }, []);
  const [regole, setRegole] = useState({ modalita:'manuale', cardiologo_unico:'', lunedi:'', martedi:'', mercoledi:'', giovedi:'', venerdi:'', sabato:'', domenica:'' });
  const [salvandoRegole, setSalvandoRegole] = useState(false);

  // Carica regole assegnazione
  useEffect(() => {
    supabase.from('regole_assegnazione').select('*').single()
      .then(({ data }) => { if (data) setRegole(data); });
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

  const assegnaBatch = async (batchId, cardiologo) => {
    if (!batchId || !cardiologo) return;
    const { error } = await supabase.from('ecgs')
      .update({ cardiologo_nome: cardiologo })
      .eq('batch_id', batchId)
      .is('cardiologo_nome', null);
    if (!error) {
      setEcgs(prev => prev.map(e => e.batch_id === batchId && !e.cardiologo ? {...e, cardiologo, cardiologo_nome: cardiologo} : e));
    }
  };

  const assegna = async (ecgId) => {
    const dest = assegnazioneTemp[ecgId];
    if (!dest) return;
    const { error } = await supabase.from('ecgs').update({ cardiologo_nome: dest }).eq('id', ecgId);
    if (!error) {
      setEcgs(prev=>prev.map(e=>e.id===ecgId?{...e,cardiologo:dest,cardiologo_nome:dest}:e));
      setAssegnazioneTemp(p=>({...p,[ecgId]:undefined}));
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
    return true;
  });

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
        {tabBtn("prenotazioni","Prenotazioni",prenotazioni.length)}
        {tabBtn("storico","Storico ECG",0)}
        {tabBtn("team","Team",0)}
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
                            <option key={n} value={n}>{n} (★{CARDIOLOGI_DATA[n].rating})</option>
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

      {/* ── TAB: DASHBOARD ── */}
      {tab==="dashboard" && (
        <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
          <h3 style={{ color:C.text, fontWeight:700, fontSize:17, marginBottom:4 }}>Performance cardiologi</h3>
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {nomi.map(nome=>{
              const d = CARDIOLOGI_DATA[nome];
              const miei = ecgs.filter(e=>e.cardiologo===nome);
              const fatti = miei.filter(e=>e.stato==="refertato").length;
              const inCorso = miei.filter(e=>e.stato==="in_attesa").length;
              return (
                <div key={nome} style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:16, padding:"18px 24px", boxShadow:C.shadow, display:"flex", alignItems:"center", gap:16, flexWrap:"wrap" }}>
                  <div style={{ width:44, height:44, background:C.accentLight, borderRadius:12, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>🫀</div>
                  <div style={{ flex:1, minWidth:160 }}>
                    <div style={{ color:C.text, fontWeight:700, fontSize:15 }}>{nome}</div>
                    <div style={{ color:C.muted, fontSize:12, marginTop:2 }}>★ {d.rating} · {d.guadagno+fatti*15}€ guadagnati</div>
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
          <div style={{ display:"flex", gap:8, marginBottom:16, flexWrap:"wrap" }}>
            {[["tutti","Tutti"],["in_attesa","In attesa"],["refertato","Refertati"],["prenotato","Prenotazioni"]].map(([v,l])=>(
              <button key={v} onClick={()=>setFiltroStato(v)} style={{ background:filtroStato===v?C.accent:C.white, color:filtroStato===v?C.white:C.muted, border:`1px solid ${filtroStato===v?C.accent:C.border}`, borderRadius:20, padding:"6px 16px", cursor:"pointer", fontWeight:600, fontSize:12 }}>{l}</button>
            ))}
            <div style={{ width:1, background:C.border }} />
            {[["tutti","Tutti"],["farmacia","💊 Farmacia"],["azienda","🏢 Azienda"],["pubblico","👤 Pubblico"]].map(([v,l])=>(
              <button key={v} onClick={()=>setFiltroOrigine(v)} style={{ background:filtroOrigine===v?C.teal:C.white, color:filtroOrigine===v?C.white:C.muted, border:`1px solid ${filtroOrigine===v?C.teal:C.border}`, borderRadius:20, padding:"6px 16px", cursor:"pointer", fontWeight:600, fontSize:12 }}>{l}</button>
            ))}
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
                </div>
              </div>
            ))}
            {ecgsFiltrati.length===0 && <div style={{ textAlign:"center", padding:40, color:C.muted }}>Nessun ECG trovato</div>}
          </div>
        </div>
      )}

      {/* ── TAB: TEAM ── */}
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
        </div>
      )}

      {tab==="team" && (
        <div>
          <h3 style={{ color:C.text, fontWeight:700, fontSize:17, marginBottom:6 }}>Team cardiologi</h3>
          <p style={{ color:C.muted, fontSize:13, marginBottom:20 }}>I cardiologi vedono <strong>solo gli ECG che assegni loro</strong> individualmente dal tab Assegnazioni. Non c'è accesso a canali o code generali.</p>
          <div style={{ background:C.yellowLight, border:`1px solid ${C.yellow}33`, borderRadius:12, padding:"14px 18px", marginBottom:20, fontSize:13, color:C.textSoft }}>
            💡 <strong>Come funziona:</strong> ogni ECG in arrivo finisce nella coda "Non assegnato" (tab Assegnazioni). Vai lì per scegliere chi lo prende in carico. Il cardiologo lo vedrà solo dopo l'assegnazione.
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            {nomi.map(nome=>{
              const d = CARDIOLOGI_DATA[nome];
              const mieiEcgs = ecgs.filter(e=>e.cardiologo===nome);
              return (
                <div key={nome} style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:16, padding:"20px 24px", boxShadow:C.shadow }}>
                  <div style={{ display:"flex", alignItems:"center", gap:14, flexWrap:"wrap" }}>
                    <div style={{ width:46, height:46, background:C.accentLight, borderRadius:12, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20 }}>🫀</div>
                    <div style={{ flex:1, minWidth:160 }}>
                      <div style={{ color:C.text, fontWeight:700, fontSize:16 }}>{nome}</div>
                      <div style={{ color:C.muted, fontSize:12, marginTop:2 }}>{d.referti+mieiEcgs.filter(e=>e.stato==="refertato").length} referti · ★ {d.rating}</div>
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
const Shell = ({ role, onLogout, children, meCardiologo }) => {
  const labels = { pubblico:"👤 Area pubblica", farmacia:`💊 ${ME_FARMACIA}`, azienda:`🏢 ${ME_AZIENDA}`, cardiologo:`🫀 ${meCardiologo}`, admin:"⚙️ Admin" };
  return (
    <div style={{ minHeight:"100vh", background:C.bg, color:C.text, fontFamily:SANS }}>
      <div style={{ height:64, background:C.white, borderBottom:`1px solid ${C.border}`, display:"flex", alignItems:"center", padding:"0 28px", gap:16, position:"sticky", top:0, zIndex:100, boxShadow:"0 1px 12px rgba(0,0,0,0.06)" }}>
        <Logo size={32} />
        <div style={{ flex:1 }} />
        <span style={{ color:C.muted, fontSize:13, fontWeight:500 }}>{labels[role]}</span>
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
        <img src="/logo-squared.png" alt="logo" style={{ width:220, height:220, objectFit:"contain", margin:"0 auto 16px", display:"block", mixBlendMode:"multiply" }} />
        <h1 style={{ color:"#1a2640", fontSize:36, fontWeight:700, marginBottom:4, letterSpacing:-1 }}>Ambulatorio Millefonti</h1>
        <p style={{ color:"#8098b8", fontSize:13, marginBottom:36 }}>Accedi al tuo account</p>
        <div style={{ background:"white", border:"1px solid #dde5f0", borderRadius:18, padding:28, boxShadow:"0 2px 12px rgba(46,124,246,0.08)", textAlign:"left" }}>
          <div style={{ marginBottom:16 }}>
            <label style={{ color:"#3d5270", fontSize:12, fontWeight:600, display:"block", marginBottom:7 }}>Email</label>
            <input value={email} onChange={e=>setEmail(e.target.value)} type="email" placeholder="nome@esempio.it"
              style={{ background:"#f4f7fb", border:"1px solid #dde5f0", borderRadius:10, padding:"11px 14px", color:"#1a2640", fontSize:14, width:"100%", outline:"none" }} />
          </div>
          <div style={{ marginBottom:24 }}>
            <label style={{ color:"#3d5270", fontSize:12, fontWeight:600, display:"block", marginBottom:7 }}>Password</label>
            <input value={password} onChange={e=>setPassword(e.target.value)} type="password" placeholder="••••••••"
              style={{ background:"#f4f7fb", border:"1px solid #dde5f0", borderRadius:10, padding:"11px 14px", color:"#1a2640", fontSize:14, width:"100%", outline:"none" }}
              onKeyDown={e=>e.key==="Enter"&&handleSubmit()} />
          </div>
          {errore && (
            <div style={{ background:"#fdedf0", border:"1px solid #e03e5a33", borderRadius:10, padding:"10px 14px", color:"#e03e5a", fontSize:13, marginBottom:16 }}>
              {errore}
            </div>
          )}
          <button onClick={handleSubmit} disabled={loading || !email || !password}
            style={{ background: (loading||!email||!password) ? "#dde5f0" : "#2e7cf6", color: (loading||!email||!password) ? "#8098b8" : "white", border:"none", borderRadius:10, padding:"13px 0", cursor: (loading||!email||!password) ? "not-allowed" : "pointer", fontWeight:700, fontSize:15, width:"100%", boxShadow: (!loading&&email&&password) ? "0 4px 16px rgba(46,124,246,0.3)" : "none" }}>
            {loading ? "Accesso in corso..." : "Accedi →"}
          </button>
        </div>
        <div style={{ color:"#b0c2d8", fontFamily:"'DM Mono', monospace", fontSize:10, marginTop:20, letterSpacing:2 }}>MILLEFONTI · ACCESSO SICURO</div>
      </div>
    </div>
  );
};

// ── APP ───────────────────────────────────────────────────────────────────
export default function App() {
  const [role, setRole] = useState(null);
  const [meCardiologo, setMeCardiologo] = useState(ME_CARDIOLOGO_DEFAULT);
  const [ecgs, setEcgs] = useState([]);
  const [cardiologiDB, setCardiologiDB] = useState([]);

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
            const { data: regole } = await supabase.from('regole_assegnazione').select('*').single();
            if (regole) {
              const giorni = ['domenica','lunedi','martedi','mercoledi','giovedi','venerdi','sabato'];
              let dest = '';
              if (regole.modalita === 'unico') dest = regole.cardiologo_unico;
              else if (regole.modalita === 'giorni') dest = regole[giorni[new Date(newEcg.created_at).getDay()]] || '';
              if (dest) {
                await supabase.from('ecgs').update({ cardiologo_nome: dest }).eq('id', newEcg.id);
                newEcg.cardiologo_nome = dest;
              }
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
  }, []);

  const supabaseAuth = async () => {
    try {
      const { supabase } = await import('./supabase.js');

      // Sessione esistente?
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        await caricaRuolo(supabase, session.user.id);
      } else {
        setLoading(false);
      }

      // Ascolta login/logout
      supabase.auth.onAuthStateChange(async (_event, session) => {
        if (session) {
          await caricaRuolo(supabase, session.user.id);
        } else {
          setRole(null);
          setLoading(false);
        }
      });
    } catch(e) {
      setLoading(false);
    }
  };

  const caricaRuolo = async (supabase, userId) => {
    const { data } = await supabase
      .from('user_profiles')
      .select('ruolo, nome, cognome')
      .eq('id', userId)
      .single();
    if (data?.ruolo) setRole(data.ruolo);
    if (data?.nome || data?.cognome) {
      setMeCardiologo(`${data.nome||''} ${data.cognome||''}`.trim());
    }
    setLoading(false);
  };

  const handleLogin = async (email, password) => {
    const { supabase } = await import('./supabase.js');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return error.message;
    return null;
  };

  const handleLogout = () => {
    setEcgs([]);
    setMeCardiologo(ME_CARDIOLOGO_DEFAULT);
    setCardiologiDB([]);
    setRole(null);
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

  if (!role) return <LoginReale onLogin={handleLogin} />;

  return (
    <Shell role={role} onLogout={handleLogout} meCardiologo={meCardiologo}>
      {role==="pubblico"   && <PubblicoView setEcgs={setEcgs} />}
      {role==="farmacia"   && <FarmaciaView ecgs={ecgs} setEcgs={setEcgs} />}
      {role==="azienda"    && <AziendaView  ecgs={ecgs} setEcgs={setEcgs} />}
      {role==="cardiologo" && <CardiologoView ecgs={ecgs} setEcgs={setEcgs} meCardiologo={meCardiologo} caricaEcgs={caricaEcgs} />}
      {role==="admin"      && <AdminView    ecgs={ecgs} setEcgs={setEcgs} cardiologiDB={cardiologiDB} />}
    </Shell>
  );
}
