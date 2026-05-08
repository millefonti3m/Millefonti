import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { batchNome, count } = req.body;

  try {
    // Legge le regole con service key (niente problemi di RLS)
    const { data: regole } = await supabase
      .from('regole_assegnazione').select('*').single();

    let dest = '';
    if (regole) {
      const giorni = ['domenica','lunedi','martedi','mercoledi','giovedi','venerdi','sabato'];
      if (regole.modalita === 'unico') dest = regole.cardiologo_unico || '';
      else if (regole.modalita === 'giorni') dest = regole[giorni[new Date().getDay()]] || '';
    }

    if (!dest) return res.status(200).json({ sent: 0, msg: 'Nessun destinatario' });

    const pushRes = await fetch(`${req.headers.origin || 'https://ambulatoriomillefonti.it'}/api/push-send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cardiologo_nome: dest,
        title: '🫀 Nuovi ECG da refertare',
        body: `${count} ECG del lotto "${batchNome}" pronti per la refertazione`,
      })
    });

    const result = await pushRes.json();
    console.log(`push-lotto: inviato a ${dest} per "${batchNome}" →`, result);
    return res.status(200).json({ sent: result.sent, dest });
  } catch(e) {
    console.error('push-lotto error:', e);
    return res.status(500).json({ error: e.message });
  }
}
