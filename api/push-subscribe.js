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
    // UPSERT atomico: aggiorna se esiste, inserisce se non esiste
    // onConflict: 'user_id' richiede unique constraint su user_id nella tabella
    const { error } = await supabase
      .from('push_subscriptions')
      .upsert(
        { user_id, cardiologo_nome, subscription },
        { onConflict: 'user_id' }
      );
    if (error) throw error;
    return res.status(200).json({ success: true });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
