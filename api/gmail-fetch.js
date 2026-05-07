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
  await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ removeLabelIds: ['UNREAD'] }),
    }
  );
}

export default async function handler(req, res) {
  try {
    const accessToken = await getAccessToken();
    if (!accessToken) return res.status(500).json({ error: 'Token non ottenuto' });
    
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
      
      const fileParts = allParts.filter(p => {
        const name = p.filename.toLowerCase();
        return name.endsWith('.pdf') || name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.jpeg');
      });

      if (fileParts.length === 0) {
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

        if (!uploadError) {
          ecgs.push({
            origine: 'azienda',
            paziente_nome: part.filename.replace(/\.[^.]+$/, ''),
            paziente_eta: 0,
            paziente_sesso: 'M',
            note: 'Caricato via email',
            urgenza: 'normale',
            stato: 'in_attesa',
            origine_dettaglio: nomeAzienda,
            batch_id: batchId,
            batch_nome: batchNome,
            file_ecg_url: storageFileName,
            email_destinatario: fromEmail,
          });
        }
      }

      if (ecgs.length > 0) {
        await supabase.from('ecgs').insert(ecgs);
        processed++;
        console.log(`Processata email da ${fromEmail}: ${ecgs.length} ECG lotto "${batchNome}"`);
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

    return res.status(200).json({ message: `Processate ${processed} email`, processed });
  } catch (error) {
    console.error('Gmail fetch error:', error);
    return res.status(500).json({ error: error.message });
  }
}
