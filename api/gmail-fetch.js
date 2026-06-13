import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function getAccessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GMAIL_CLIENT_ID,
      client_secret: process.env.GMAIL_CLIENT_SECRET,
      refresh_token: process.env.GMAIL_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  console.log('Google token response:', JSON.stringify(data));
  console.log('ENV check - CLIENT_ID exists:', !!process.env.GMAIL_CLIENT_ID);
  console.log('ENV check - SECRET exists:', !!process.env.GMAIL_CLIENT_SECRET);
  console.log('ENV check - REFRESH exists:', !!process.env.GMAIL_REFRESH_TOKEN);
  return data.access_token;
}

async function getUnreadEmails(accessToken) {
  const res = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages?q=is:unread+has:attachment&maxResults=20',
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const data = await res.json();
  return data.messages || [];
}

async function getEmail(accessToken, messageId) {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  return res.json();
}

async function getAttachment(accessToken, messageId, attachmentId) {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${attachmentId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const data = await res.json();
  const base64 = data.data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64');
}

async function markAsRead(accessToken, messageId) {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ removeLabelIds: ['UNREAD'] }),
    }
  );
  if (!res.ok) console.warn(`markAsRead ${messageId}: HTTP ${res.status} (token potrebbe non avere permessi di scrittura Gmail)`);
}

// ── LOGO DETECTION ─────────────────────────────────────────────────────────
// Regola 1: se ci sono PDF + immagini → le immagini sono loghi email, scarta
// Regola 2: se ci sono solo immagini → scarta quelle < 50KB (loghi pesano poco)
// Gli ECG in JPEG pesano sempre > 100KB, i loghi tipicamente < 30KB
const LOGO_SIZE_THRESHOLD = 50000; // 50KB

function filtraLogoEmail(allFileParts) {
  const pdfs = allFileParts.filter(p => p.filename.toLowerCase().endsWith('.pdf'));
  const imgs = allFileParts.filter(p => /\.(jpe?g|png)$/i.test(p.filename.toLowerCase()));

  if (pdfs.length > 0 && imgs.length > 0) {
    // Mix PDF + immagini: le immagini sono quasi certamente loghi email
    console.log(`Logo detection [regola 1]: scartate ${imgs.length} immagini perché presenti ${pdfs.length} PDF`);
    imgs.forEach(p => console.log(`  → scartato: ${p.filename} (${p.body?.size || '?'} bytes)`));
    return pdfs;
  }

  if (imgs.length > 0 && pdfs.length === 0) {
    // Solo immagini: filtra per dimensione
    const ecgImgs = imgs.filter(p => (p.body?.size || 0) > LOGO_SIZE_THRESHOLD);
    const logoImgs = imgs.filter(p => (p.body?.size || 0) <= LOGO_SIZE_THRESHOLD);
    if (logoImgs.length > 0) {
      console.log(`Logo detection [regola 2]: scartate ${logoImgs.length} immagini piccole (< ${LOGO_SIZE_THRESHOLD/1000}KB)`);
      logoImgs.forEach(p => console.log(`  → scartato: ${p.filename} (${p.body?.size || '?'} bytes)`));
    }
    return ecgImgs;
  }

  return allFileParts; // solo PDF, nessun problema
}
// ───────────────────────────────────────────────────────────────────────────

// Helper per inviare alert al team
async function sendAlert(tipo, dettagli = '', contesto = '') {
  fetch('https://ambulatoriomillefonti.it/api/notify-breach', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tipo, dettagli, contesto }),
  }).catch(e => console.error('sendAlert error:', e.message));
}

export default async function handler(req, res) {
  try {
    const accessToken = await getAccessToken();
    if (!accessToken) {
      await sendAlert('gmail_token', 'Token Gmail non ottenuto — access_token è null', 'Verifica le variabili GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN su Vercel');
      return res.status(500).json({ error: 'Token non ottenuto' });
    }
    
    const messages = await getUnreadEmails(accessToken);
    if (messages.length === 0) {
      return res.status(200).json({ message: 'Nessuna email nuova', processed: 0 });
    }

    let processed = 0;

    for (const msg of messages) {
      // Controlla se email già processata
      const { data: giàProcessata } = await supabase
        .from('email_processate')
        .select('message_id')
        .eq('message_id', msg.id)
        .maybeSingle();
      
      if (giàProcessata) {
        console.log(`Email ${msg.id} già processata, skip`);
        await markAsRead(accessToken, msg.id);
        continue;
      }

      const email = await getEmail(accessToken, msg.id);
      const headers = email.payload.headers;
      const from = headers.find(h => h.name === 'From')?.value || '';
      const subject = headers.find(h => h.name === 'Subject')?.value || 'Lotto ECG';
      const fromEmail = from.match(/<(.+)>/)?.[1] || from.trim();

      // Cerca utente azienda con questa email (diretta o autorizzata)
      const { data: { users } } = await supabase.auth.admin.listUsers();
      let matchUser = users?.find(u => u.email === fromEmail);
      let userId = matchUser?.id;

      // Se non trovato direttamente, cerca nelle email autorizzate
      if (!matchUser) {
        const { data: emailAuth } = await supabase
          .from('email_autorizzate')
          .select('user_id')
          .eq('email', fromEmail)
          .single();
        if (emailAuth?.user_id) {
          userId = emailAuth.user_id;
          matchUser = users?.find(u => u.id === userId);
        }
      }

      if (!userId) {
        console.log(`Mittente sconosciuto: ${fromEmail}`);
        await markAsRead(accessToken, msg.id);
        continue;
      }

      // Controlla che sia un account azienda
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('nome, cognome, ruolo')
        .eq('id', userId)
        .single();

      if (!profile || profile.ruolo !== 'azienda') {
        await markAsRead(accessToken, msg.id);
        continue;
      }

      // Trova allegati PDF/PNG/JPG
      const allParts = [];
      const extractParts = (parts) => {
        if (!parts) return;
        parts.forEach(p => {
          if (p.filename && p.body?.attachmentId) allParts.push(p);
          if (p.parts) extractParts(p.parts);
        });
      };
      extractParts(email.payload.parts);
      
      const allFileParts = allParts.filter(p => {
        const name = p.filename.toLowerCase();
        return name.endsWith('.pdf') || name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.jpeg');
      });

      // ── Applica logo detection ──
      const fileParts = filtraLogoEmail(allFileParts);

      if (fileParts.length === 0) {
        console.log(`Nessun allegato ECG valido da ${fromEmail} (tutti filtrati come loghi)`);
        await markAsRead(accessToken, msg.id);
        continue;
      }

      const batchId = `BATCH-EMAIL-${Date.now()}`;
      const batchNome = subject.trim();
      const nomeAzienda = `${profile.nome || ''} ${profile.cognome || ''}`.trim();
      const ecgs = [];

      for (const part of fileParts) {
        const buffer = await getAttachment(accessToken, msg.id, part.body.attachmentId);
        const storageFileName = `${batchId}/${part.filename}`;
        const { error: uploadError } = await supabase.storage
          .from('ecg-files')
          .upload(storageFileName, buffer, { contentType: part.mimeType || 'application/pdf' });

        if (uploadError) {
          await sendAlert(
            'upload_ecg',
            uploadError.message || JSON.stringify(uploadError),
            `File: ${part.filename} | Azienda: ${nomeAzienda} | Email: ${fromEmail} | Lotto: ${batchNome}`
          );
        } else {
          ecgs.push({
            origine: 'azienda',
            paziente_nome: part.filename.replace(/\.[^.]+$/, ''),
            paziente_eta: 0,
            paziente_sesso: 'M',
            note: 'Caricato via email',
            urgenza: subject.toLowerCase().includes('urgente') ? 'urgente' : 'normale',
            stato: 'in_attesa',
            origine_dettaglio: nomeAzienda,
            batch_id: batchId,
            batch_nome: batchNome,
            file_ecg_url: storageFileName,
            email_destinatario: matchUser?.email || fromEmail, // sempre email principale account, non email inviante
          });
        }
      }

      if (ecgs.length > 0) {
        const { error: insertErr } = await supabase.from('ecgs').insert(ecgs);
        if (insertErr) {
          await sendAlert(
            'insert_db',
            insertErr.message || JSON.stringify(insertErr),
            `Azienda: ${nomeAzienda} | Email: ${fromEmail} | Lotto: ${batchNome} | ECG: ${ecgs.length}`
          );
        } else {
          processed++;
        console.log(`Processata email da ${fromEmail}: ${ecgs.length} ECG lotto "${batchNome}"`);
        // Push gestito dal Supabase webhook — niente duplicati
        // Email di conferma ricezione al mittente
        fetch('https://ambulatoriomillefonti.it/api/notify-ricezione', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: fromEmail,
            nomeAzienda,
            batchNome,
            count: ecgs.length,
            data: new Date().toLocaleDateString('it-IT'),
          }),
        }).catch(e => console.error('notify-ricezione error:', e.message));
        } // end else insertErr
      }

      // Segna come processata nel DB PRIMA di marcare come letta
      const { error: insertError } = await supabase.from('email_processate').insert({ message_id: msg.id });
      if (insertError) {
        console.error('Errore salvataggio email processata:', insertError);
      } else {
        console.log(`Email ${msg.id} salvata come processata`);
      }
      await markAsRead(accessToken, msg.id);
    }

    // Pulizia automatica referti più vecchi di 7 giorni (dati sanitari sensibili)
    let vecchi = null;
    try {
      const settaGiorniFa = new Date();
      settaGiorniFa.setDate(settaGiorniFa.getDate() - 7);
      const { data: vecchiData, error: queryErr } = await supabase
        .from('ecgs')
        .select('id, file_referto_url, file_ecg_url')
        .eq('stato', 'refertato')
        .lt('created_at', settaGiorniFa.toISOString());

      if (queryErr) throw new Error('Query pulizia fallita: ' + queryErr.message);
      vecchi = vecchiData;

      if (vecchi && vecchi.length > 0) {
        const filesDaEliminare = vecchi
          .flatMap(e => [e.file_referto_url, e.file_ecg_url])
          .filter(Boolean);

        if (filesDaEliminare.length > 0) {
          const { error: removeErr } = await supabase.storage.from('ecg-files').remove(filesDaEliminare);
          if (removeErr) throw new Error('Rimozione file Storage fallita: ' + removeErr.message);
        }

        const { error: updateErr } = await supabase.from('ecgs')
          .update({ file_referto_url: null, file_ecg_url: null })
          .in('id', vecchi.map(e => e.id));
        if (updateErr) throw new Error('Aggiornamento DB dopo pulizia fallito: ' + updateErr.message);

        console.log(`Pulizia: eliminati ${filesDaEliminare.length} file vecchi di 7+ giorni`);
      }
    } catch (puliziErr) {
      console.error('Errore pulizia file:', puliziErr.message);
      await sendAlert(
        'pulizia_file',
        puliziErr.message,
        `Errore rilevato il ${new Date().toLocaleString('it-IT')} — i file sanitari potrebbero non essere stati eliminati nei termini previsti (7 giorni)`
      );
    }

    return res.status(200).json({ message: `Processate ${processed} email`, processed, cleaned: vecchi?.length || 0 });
  } catch (error) {
    console.error('Gmail fetch error:', error);
    await sendAlert(
      'gmail_token',
      error.message || String(error),
      `Errore critico nel polling Gmail — ${new Date().toLocaleString('it-IT')}`
    );
    return res.status(500).json({ error: error.message });
  }
}
