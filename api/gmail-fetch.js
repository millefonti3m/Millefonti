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
  // Gmail returns base64url encoded data
  const base64 = data.data.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
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
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const accessToken = await getAccessToken();
    const messages = await getUnreadEmails(accessToken);
    
    if (messages.length === 0) {
      return res.status(200).json({ message: 'Nessuna email nuova', processed: 0 });
    }

    let processed = 0;

    for (const msg of messages) {
      const email = await getEmail(accessToken, msg.id);
      
      // Estrai mittente e oggetto
      const headers = email.payload.headers;
      const from = headers.find(h => h.name === 'From')?.value || '';
      const subject = headers.find(h => h.name === 'Subject')?.value || 'Lotto ECG';
      
      // Estrai email mittente
      const fromEmail = from.match(/<(.+)>/)?.[1] || from;
      
      // Cerca azienda associata a questa email
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('id, nome, cognome')
        .eq('ruolo', 'azienda')
        .limit(100);
      
      // Trova l'utente dalla email
      const { data: authUsers } = await supabase.auth.admin.listUsers();
      const matchUser = authUsers?.users?.find(u => u.email === fromEmail);
      
      if (!matchUser) {
        console.log(`Email da mittente sconosciuto: ${fromEmail} - ignorata`);
        await markAsRead(accessToken, msg.id);
        continue;
      }

      // Trova parti con allegati PDF
      const parts = email.payload.parts || [];
      const pdfParts = parts.filter(p => 
        p.filename && (p.filename.toLowerCase().endsWith('.pdf') || 
                       p.filename.toLowerCase().endsWith('.png') ||
                       p.filename.toLowerCase().endsWith('.jpg'))
      );

      if (pdfParts.length === 0) {
        await markAsRead(accessToken, msg.id);
        continue;
      }

      // Crea batch
      const batchId = `BATCH-EMAIL-${Date.now()}`;
      const batchNome = subject.trim();

      // Carica ogni allegato
      const ecgs = [];
      for (const part of pdfParts) {
        const attachmentData = await getAttachment(accessToken, msg.id, part.body.attachmentId);
        const fileName = part.filename;
        const storageFileName = `${batchId}/${fileName}`;
        
        const blob = new Blob([attachmentData], { type: part.mimeType });
        const { error: uploadError } = await supabase.storage
          .from('ecg-files')
          .upload(storageFileName, blob, { contentType: part.mimeType });

        if (!uploadError) {
          ecgs.push({
            origine: 'azienda',
            paziente_nome: fileName.replace(/\.[^.]+$/, ''),
            paziente_eta: 0,
            paziente_sesso: 'M',
            note: 'Caricato via email',
            urgenza: 'normale',
            stato: 'in_attesa',
            origine_dettaglio: `${profile?.find(p => p.id === matchUser.id)?.nome || ''} ${profile?.find(p => p.id === matchUser.id)?.cognome || ''}`.trim(),
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
        console.log(`Processata email da ${fromEmail}: ${ecgs.length} ECG nel lotto "${batchNome}"`);
      }

      // Segna come letta
      await markAsRead(accessToken, msg.id);
    }

    return res.status(200).json({ message: `Processate ${processed} email`, processed });
  } catch (error) {
    console.error('Gmail fetch error:', error);
    return res.status(500).json({ error: error.message });
  }
}
