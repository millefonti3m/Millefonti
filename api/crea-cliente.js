import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, password, nome, cognome, ruolo, codice_referti, numero_albo, email_autorizzate } = req.body;

  if (!email || !password || !nome || !ruolo) {
    return res.status(400).json({ error: 'Campi obbligatori mancanti: email, password, nome, ruolo' });
  }

  try {
    // 1. Crea utente in Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (authError) {
      return res.status(400).json({ error: authError.message });
    }

    const userId = authData.user.id;

    // 2. Inserisci profilo in user_profiles
    const { error: profileError } = await supabase
      .from('user_profiles')
      .insert({
        id: userId,
        nome,
        cognome: cognome || '',
        ruolo,
        codice_referti: codice_referti || null,
        numero_albo: numero_albo || null,
      });

    if (profileError) {
      // Rollback: elimina utente auth appena creato
      await supabase.auth.admin.deleteUser(userId);
      return res.status(500).json({ error: 'Profilo non creato: ' + profileError.message });
    }

    // 3. Inserisci email autorizzate
    if (Array.isArray(email_autorizzate) && email_autorizzate.length > 0) {
      const righe = email_autorizzate
        .map(e => e.trim())
        .filter(Boolean)
        .map(e => ({ email: e, user_id: userId }));

      if (righe.length > 0) {
        const { error: emailErr } = await supabase
          .from('email_autorizzate')
          .insert(righe);

        if (emailErr) {
          // Non critico — il cliente esiste, le email si aggiungono dopo
          console.error('email_autorizzate insert error:', emailErr.message);
        }
      }
    }

    return res.status(200).json({ success: true, userId });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
