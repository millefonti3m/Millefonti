import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { userId, password, codice_referti, email_autorizzate } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'userId obbligatorio' });
  }

  try {
    // 1. Aggiorna password se fornita
    if (password) {
      const { error: pwError } = await supabase.auth.admin.updateUserById(
        userId,
        { password }
      );
      if (pwError) return res.status(400).json({ error: 'Password non aggiornata: ' + pwError.message });
    }

    // 2. Aggiorna codice_referti se presente nel body
    //    (accetta anche null esplicito per cancellare il codice)
    if ('codice_referti' in req.body) {
      const { error: profileError } = await supabase
        .from('user_profiles')
        .update({ codice_referti: codice_referti || null })
        .eq('id', userId);

      if (profileError) {
        return res.status(500).json({ error: 'Profilo non aggiornato: ' + profileError.message });
      }
    }

    // 3. Aggiorna email autorizzate se fornite
    //    DELETE vecchie + INSERT nuove
    if (Array.isArray(email_autorizzate)) {
      const { error: deleteError } = await supabase
        .from('email_autorizzate')
        .delete()
        .eq('user_id', userId);

      if (deleteError) {
        return res.status(500).json({ error: 'Eliminazione email_autorizzate fallita: ' + deleteError.message });
      }

      const righe = email_autorizzate
        .map(e => e.trim())
        .filter(Boolean)
        .map(e => ({ email: e, user_id: userId }));

      if (righe.length > 0) {
        const { error: insertError } = await supabase
          .from('email_autorizzate')
          .insert(righe);

        if (insertError) {
          return res.status(500).json({ error: 'Inserimento email_autorizzate fallito: ' + insertError.message });
        }
      }
    }

    return res.status(200).json({ success: true });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
