import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

webpush.setVapidDetails(
  'mailto:ecg.millefonti@gmail.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { batchNome, count } = req.body;

  try {
    // 1. Legge le regole di assegnazione
    const { data: regole } = await supabase
      .from('regole_assegnazione').select('*').single();

    let dest = '';
    if (regole) {
      const giorni = ['domenica','lunedi','martedi','mercoledi','giovedi','venerdi','sabato'];
      if (regole.modalita === 'unico') dest = regole.cardiologo_unico || '';
      else if (regole.modalita === 'giorni') dest = regole[giorni[new Date().getDay()]] || '';
    }
    console.log('push-lotto: destinatario =', dest);
    if (!dest) return res.status(200).json({ sent: 0, msg: 'Nessun destinatario nelle regole' });

    // 2. Carica subscriptions del cardiologo
    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('subscription')
      .eq('cardiologo_nome', dest);

    console.log('push-lotto: subscriptions trovate =', subs?.length || 0);
    if (!subs?.length) return res.status(200).json({ sent: 0, msg: 'Nessuna subscription per ' + dest });

    // 3. Manda push direttamente
    const payload = JSON.stringify({
      title: '🫀 Nuovi ECG da refertare',
      body: `${count} ECG del lotto "${batchNome}" pronti per la refertazione`,
      url: '/',
    });

    const results = await Promise.allSettled(
      subs.map(({ subscription }) => webpush.sendNotification(subscription, payload))
    );

    const sent = results.filter(r => r.status === 'fulfilled').length;
    console.log('push-lotto: inviati', sent, 'su', subs.length);
    return res.status(200).json({ sent, dest });
  } catch(e) {
    console.error('push-lotto error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
