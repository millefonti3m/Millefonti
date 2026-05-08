import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { subscription, cardiologo_nome, user_id } = req.body;
  if (!subscription || !user_id) return res.status(400).json({ error: 'Dati mancanti' });

  try {
    // Rimuovi vecchie subscription per questo utente e inserisci la nuova
    await supabase.from('push_subscriptions').delete().eq('user_id', user_id);
    await supabase.from('push_subscriptions').insert({ user_id, cardiologo_nome, subscription });
    return res.status(200).json({ success: true });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
