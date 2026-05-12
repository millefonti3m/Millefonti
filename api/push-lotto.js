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

  let batchNome, count;

  // Formato webhook Supabase: { type, table, record, old_record }
  if (req.body?.type === 'INSERT' && req.body?.record) {
    const record = req.body.record;
    batchNome = record.batch_nome || 'Nuovo ECG';
    count = 1;
    console.log('push-lotto: webhook Supabase INSERT, batch_id:', record.batch_id);

    // Nota: non facciamo deduplicazione per batch_id perché tutti gli ECG
    // vengono inseriti atomicamente e il conteggio sarebbe sempre > 1.
    // Il push tag 'ecg-notification' garantisce che il device mostri una sola notifica.
  } else {
    // Chiamata diretta (es. da inviaLotto)
    batchNome = req.body?.batchNome || 'Nuovo lotto';
    count = req.body?.count || 1;
    console.log('push-lotto: chiamata diretta, batchNome:', batchNome);
  }

  try {
    // 1. Controlla regola specifica per azienda (ha priorità)
    const nomeAzienda = req.body?.record?.origine_dettaglio || req.body?.nomeAzienda || '';
    let dest = '';
    if (nomeAzienda) {
      const { data: regAz } = await supabase.from('regole_per_azienda')
        .select('cardiologo_nome').eq('azienda_nome', nomeAzienda).maybeSingle();
      if (regAz?.cardiologo_nome) dest = regAz.cardiologo_nome;
    }
    // 2. Fallback: regole generali
    if (!dest) {
      const { data: regole } = await supabase.from('regole_assegnazione').select('*').single();
      if (regole) {
        const giorni = ['domenica','lunedi','martedi','mercoledi','giovedi','venerdi','sabato'];
        if (regole.modalita === 'unico') dest = regole.cardiologo_unico || '';
        else if (regole.modalita === 'giorni') dest = regole[giorni[new Date().getDay()]] || '';
      }
    }
    console.log('push-lotto: azienda="'+nomeAzienda+'" dest="'+dest+'"');
    if (!dest) return res.status(200).json({ sent: 0, msg: 'Nessun destinatario' });

    // Carica subscriptions
    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('subscription')
      .eq('cardiologo_nome', dest);

    if (!subs?.length) return res.status(200).json({ sent: 0, msg: 'Nessuna subscription per ' + dest });

    const payload = JSON.stringify({
      title: '🫀 Nuovi ECG da refertare',
      body: count > 1
        ? `${count} ECG del lotto "${batchNome}" pronti`
        : `Nuovo ECG "${batchNome}" pronto`,
      url: '/',
      tag: 'ecg-notification',
    });

    const results = await Promise.allSettled(
      subs.map(({ subscription }) => webpush.sendNotification(subscription, payload))
    );

    const sent = results.filter(r => r.status === 'fulfilled').length;
    console.log('push-lotto: inviati', sent);
    return res.status(200).json({ sent, dest });
  } catch(e) {
    console.error('push-lotto error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
