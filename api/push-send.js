import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';

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
  const { cardiologo_nome, title, body, url } = req.body;

  try {
    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('subscription, user_id')
      .eq('cardiologo_nome', cardiologo_nome);

    if (!subs?.length) return res.status(200).json({ sent: 0, msg: 'Nessuna subscription trovata' });

    const payload = JSON.stringify({
      title: title || '🫀 Nuovi ECG da refertare',
      body: body || 'Hai nuovi ECG assegnati',
      url: url || '/',
      tag: 'ecg-' + Date.now(),
    });

    const results = await Promise.allSettled(
      subs.map(({ subscription }) =>
        webpush.sendNotification(subscription, payload)
      )
    );

    // Rimuovi subscription scadute (410 Gone)
    const expired = results
      .map((r, i) => r.status === 'rejected' && r.reason?.statusCode === 410 ? subs[i].user_id : null)
      .filter(Boolean);
    if (expired.length) {
      await supabase.from('push_subscriptions').delete().in('user_id', expired);
    }

    const sent = results.filter(r => r.status === 'fulfilled').length;
    return res.status(200).json({ sent });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
