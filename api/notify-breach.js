const DESTINATARI = [
  { email: 'ecg.millefonti@gmail.com',    name: 'Ambulatorio Millefonti' },
  { email: 'rasciad.mansour1@gmail.com',   name: 'Rasciad' },
  { email: 'mansour.medlav@gmail.com',     name: 'Mansour' },
];

const LOGO = 'https://weearnnmglyjufhpycju.supabase.co/storage/v1/object/public/assets/logo%20definitivo.png';

const TIPI = {
  gmail_token: {
    emoji: '🔴',
    titolo: 'Il controllo delle email ECG non funziona',
    gravita: 'ATTENZIONE',
    colore: '#dc2626',
    spiegazione: `Il sistema che controlla automaticamente le nuove email con ECG allegati ha smesso di funzionare. 
Questo accade di solito perché il token di accesso a Gmail è scaduto o è stato revocato.`,
    impatto: `Se un cliente invia ECG via email in questo momento, questi <strong>non arriveranno in piattaforma</strong> e nessuno lo saprà. Il cliente riceverà la conferma di invio da Gmail, ma l'ECG non sarà visibile né refertabile.`,
    soluzioni: [
      'Accedi alla piattaforma e verifica se gli ECG recenti sono arrivati correttamente.',
      'Contatta Rasciad (tecnico) per rigenerare il token Gmail di accesso al sistema.',
      'Nel frattempo, avvisa i clienti di caricare gli ECG direttamente dalla piattaforma web su ambulatoriomillefonti.it invece che via email.',
      'Controlla i log su Vercel (vercel.com) per vedere il messaggio di errore esatto.',
    ],
    legale: false,
  },
  upload_ecg: {
    emoji: '🟠',
    titolo: 'Un file ECG non è stato salvato correttamente',
    gravita: 'ATTENZIONE',
    colore: '#ea580c',
    spiegazione: `Un ECG ricevuto non è stato caricato correttamente sul server. Il sistema ha ricevuto il file ma non è riuscito a salvarlo nello spazio di archiviazione.`,
    impatto: `Il cliente potrebbe aver già ricevuto la conferma di ricezione, ma il file <strong>non è disponibile per la refertazione</strong>. Mansour non riuscirà ad aprirlo.`,
    soluzioni: [
      'Contatta il cliente coinvolto (vedi dettagli sotto) e chiedigli di reinviare il file o di caricarlo nuovamente dalla piattaforma.',
      'Verifica su Supabase (supabase.com) → Storage → ecg-files che non ci siano problemi di spazio o permessi.',
      'Se il problema si ripete spesso, contatta Rasciad per una verifica tecnica.',
    ],
    legale: false,
  },
  insert_db: {
    emoji: '🔴',
    titolo: 'Un ECG è andato perso nel sistema',
    gravita: 'URGENTE',
    colore: '#dc2626',
    spiegazione: `Un ECG è stato ricevuto ma non è stato registrato nel database. Questo è il caso più critico: non esiste nessuna traccia di questo ECG nel sistema.`,
    impatto: `L'ECG <strong>non è visibile in piattaforma</strong>, non può essere assegnato né refertato. Se non si interviene, il cliente aspetterà un referto che non arriverà mai.`,
    soluzioni: [
      'Contatta immediatamente il cliente coinvolto (vedi dettagli sotto) e chiedigli di reinviare il file.',
      'Accedi a Supabase (supabase.com) → Table Editor → ecgs e verifica se ci sono anomalie.',
      'Controlla i log su Vercel per vedere il messaggio di errore esatto del database.',
      'Contatta Rasciad con urgenza per una verifica tecnica.',
    ],
    legale: false,
  },
  pulizia_file: {
    emoji: '🔴',
    titolo: 'I file sanitari non sono stati eliminati nei tempi previsti',
    gravita: 'ATTENZIONE LEGALE',
    colore: '#7c3aed',
    spiegazione: `Il sistema dovrebbe eliminare automaticamente tutti i file ECG e i referti dopo 7 giorni dalla refertazione, come previsto dal contratto con i clienti e dal GDPR. Questa eliminazione automatica non è avvenuta correttamente.`,
    impatto: `I dati sanitari dei pazienti stanno rimanendo sui server <strong>oltre il termine contrattuale di 7 giorni</strong>. Il contratto firmato con i clienti prevede espressamente questa eliminazione. Il mancato rispetto potrebbe configurarsi come inadempimento contrattuale e come violazione del GDPR (art. 5 - limitazione della conservazione).`,
    soluzioni: [
      'Accedi a Supabase (supabase.com) → Storage → ecg-files ed elimina manualmente i file con data superiore a 7 giorni.',
      'Verifica anche la tabella "ecgs" e imposta a null i campi file_ecg_url e file_referto_url per i record interessati.',
      'Documenta questa anomalia nel registro delle attività di trattamento (art. 30 GDPR).',
      'Contatta Rasciad con urgenza per risolvere il problema tecnico e prevenire che si ripeta.',
      'Se i dati sono rimasti esposti per più di 72 ore oltre il previsto, valuta con il tuo consulente legale se sia necessaria una notifica al Garante.',
    ],
    legale: true,
  },
  scadenza_codice: {
    emoji: '🟡',
    titolo: 'Codice download in scadenza',
    gravita: 'PROMEMORIA',
    colore: '#d97706',
    spiegazione: `Il codice di accesso per il download dei referti di uno o più clienti è prossimo alla scadenza (6 mesi). È necessario aggiornare il codice e comunicarlo al cliente.`,
    impatto: `Il codice attuale continuerà a funzionare fino a quando non viene aggiornato manualmente. Nessun blocco automatico.`,
    soluzioni: [
      'Vai in AdminView → tab 📊 Aziende → sezione Gestione codici download',
      'Clicca ✏️ Modifica sul cliente indicato',
      'Aggiorna il codice con il nuovo suggerito',
      'Comunica il nuovo codice al cliente',
    ],
    legale: false,
  },
};

async function inviaAlert(tipo, dettagli = '', contesto = '') {
  const t = TIPI[tipo];
  if (!t) return;

  const ora = new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' });

  const soluzionHtml = t.soluzioni.map((s, i) =>
    `<tr><td style="padding:8px 12px;vertical-align:top;color:${t.colore};font-weight:700;font-size:14px;">${i+1}.</td>
     <td style="padding:8px 12px;color:#374151;font-size:13px;line-height:1.6;">${s}</td></tr>`
  ).join('');

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
      <!-- Header -->
      <div style="background:${t.colore};padding:24px 32px;">
        <div style="font-size:13px;color:rgba(255,255,255,0.8);margin-bottom:6px;font-weight:600;letter-spacing:1px;">
          ${t.gravita} — SISTEMA AMBULATORIO MILLEFONTI
        </div>
        <h1 style="color:white;margin:0;font-size:18px;font-weight:700;">
          ${t.emoji} ${t.titolo}
        </h1>
        <div style="color:rgba(255,255,255,0.75);font-size:12px;margin-top:8px;">
          Rilevato il: ${ora}
        </div>
      </div>
      <!-- Corpo -->
      <div style="padding:28px 32px;">
        <!-- Cosa è successo -->
        <div style="margin-bottom:20px;">
          <div style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">
            Cosa è successo
          </div>
          <p style="color:#1f2937;font-size:14px;line-height:1.7;margin:0;background:#f9fafb;padding:14px 16px;border-radius:8px;border-left:4px solid ${t.colore};">
            ${t.spiegazione}
          </p>
        </div>
        <!-- Impatto -->
        <div style="margin-bottom:20px;">
          <div style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">
            Cosa significa per il servizio
          </div>
          <p style="color:#1f2937;font-size:14px;line-height:1.7;margin:0;background:#fff8f0;padding:14px 16px;border-radius:8px;border-left:4px solid #f59e0b;">
            ${t.impatto}
          </p>
        </div>
        ${contesto ? `
        <!-- Dettagli specifici -->
        <div style="margin-bottom:20px;">
          <div style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">
            Dettagli specifici
          </div>
          <p style="color:#374151;font-size:13px;line-height:1.6;margin:0;background:#f3f4f6;padding:12px 16px;border-radius:8px;font-family:monospace;">
            ${contesto}
          </p>
        </div>` : ''}
        <!-- Soluzioni -->
        <div style="margin-bottom:24px;">
          <div style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">
            Cosa fare adesso — segui questi passi in ordine
          </div>
          <table style="width:100%;border-collapse:collapse;background:#f0fdf4;border-radius:8px;overflow:hidden;">
            ${soluzionHtml}
          </table>
        </div>
        ${dettagli ? `
        <!-- Errore tecnico -->
        <div style="margin-bottom:20px;">
          <div style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">
            Messaggio tecnico (per il tecnico)
          </div>
          <p style="color:#6b7280;font-size:11px;line-height:1.6;margin:0;background:#1f2937;color:#d1fae5;padding:12px 16px;border-radius:8px;font-family:monospace;word-break:break-all;">
            ${dettagli}
          </p>
        </div>` : ''}
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;" />
        <p style="color:#9ca3af;font-size:11px;margin:0 0 4px;line-height:1.6;">
          Questa è una notifica automatica del sistema — si prega di non rispondere a questa email.
        </p>
        <div style="text-align:center;padding:24px 0 8px;">
          <img src="${LOGO}" alt="Ambulatorio Millefonti" width="120"
               style="display:block;margin:0 auto;" />
        </div>
        <div style="text-align:center; padding: 8px 0 16px; font-family: Arial, sans-serif;">
          <p style="color:#255736; font-size:13px; font-weight:700; margin:0 0 4px;">Ambulatorio Millefonti</p>
          <p style="color:#637082; font-size:11px; margin:0; line-height:1.8;">
            Via Garessio 47 — 10126 Torino<br/>
            Tel. 011 659 83 68 | +39 375 925 2801<br/>
            <a href="mailto:info@ambulatoriomillefonti.it" style="color:#255736; text-decoration:none;">info@ambulatoriomillefonti.it</a> —
            <a href="https://www.ambulatoriomillefonti.it" style="color:#255736; text-decoration:none;">www.ambulatoriomillefonti.it</a>
          </p>
        </div>
      </div>
    </div>
  `;

  await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sender: { name: 'Sistema Ambulatorio Millefonti', email: 'noreply@ambulatoriomillefonti.it' },
      to: DESTINATARI,
      subject: `${t.emoji} ${t.gravita}: ${t.titolo}`,
      htmlContent: html,
    }),
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { tipo, dettagli, contesto } = req.body;
  try {
    await inviaAlert(tipo, dettagli, contesto);
    return res.status(200).json({ success: true });
  } catch(e) {
    console.error('notify-breach error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}

export { inviaAlert };
