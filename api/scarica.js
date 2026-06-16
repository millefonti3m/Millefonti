import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function formatDataItaliana(isoString) {
  const d = new Date(isoString);
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' });
}

function paginaHTML({ batchNome, count, expiresAt, errore, scaduta }) {
  const FONT = "system-ui, -apple-system, sans-serif";
  const sottotitolo = scaduta
    ? ''
    : `Lotto: <strong>${batchNome || '—'}</strong> · ${count || '?'} referti`;
  const dataScadenza = expiresAt ? formatDataItaliana(expiresAt) : '—';

  const contenuto = scaduta
    ? `
      <div style="background:#fdedf0;border:1px solid #e03e5a33;border-radius:10px;padding:12px 16px;color:#e03e5a;font-size:13px;text-align:center;">
        Questo link è scaduto. Contatta l'ambulatorio.
      </div>`
    : `
      <form method="POST" style="margin:0;">
        <div style="margin-bottom:16px;">
          <label style="color:#3d5270;font-size:12px;font-weight:600;display:block;margin-bottom:7px;">Codice di accesso</label>
          <input
            name="codice"
            type="text"
            placeholder="es. AB12CD34"
            autocomplete="off"
            style="background:#f4f7fb;border:1px solid #dde5f0;border-radius:10px;padding:11px 14px;color:#1a2640;font-size:14px;width:100%;outline:none;box-sizing:border-box;font-family:monospace;letter-spacing:2px;text-transform:uppercase;"
          />
          <div style="color:#8098b8;font-size:12px;margin-top:8px;">
            Download disponibile fino al ${dataScadenza}
          </div>
        </div>
        ${errore ? `
          <div style="background:#fdedf0;border:1px solid #e03e5a33;border-radius:10px;padding:10px 14px;color:#e03e5a;font-size:13px;margin-bottom:16px;">
            ${errore}
          </div>` : ''}
        <button
          type="submit"
          style="background:#255736;color:white;border:none;border-radius:10px;padding:13px 0;cursor:pointer;font-weight:700;font-size:15px;width:100%;box-shadow:0 4px 16px rgba(37,87,54,0.3);font-family:${FONT};">
          Scarica referti
        </button>
      </form>`;

  return `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Scarica referti — Ambulatorio Millefonti</title>
</head>
<body style="margin:0;min-height:100vh;background:linear-gradient(135deg,#e8f2ff,#f4f7fb,#e8f9f4);display:flex;align-items:center;justify-content:center;padding:24px;font-family:${FONT};box-sizing:border-box;">
  <div style="max-width:400px;width:100%;text-align:center;">
    <img src="/logo-squared.png" alt="logo" style="width:330px;height:330px;object-fit:contain;margin:0 auto 16px;display:block;mix-blend-mode:multiply;" />
    <h1 style="color:#1a2640;font-size:36px;font-weight:700;margin:0 0 4px;letter-spacing:-1px;">Ambulatorio Millefonti</h1>
    <p style="color:#8098b8;font-size:13px;margin:0 0 36px;">${sottotitolo}</p>
    <div style="background:white;border:1px solid #dde5f0;border-radius:18px;padding:28px;box-shadow:0 2px 12px rgba(46,124,246,0.08);text-align:left;">
      ${contenuto}
    </div>
    <div style="color:#b0c2d8;font-family:monospace;font-size:10px;margin-top:20px;letter-spacing:2px;">MILLEFONTI · DOWNLOAD SICURO</div>
  </div>
</body>
</html>`;
}

export default async function handler(req, res) {
  const token = req.query?.token || (req.body && req.body.token);

  if (!token) {
    return res.status(400).send(paginaHTML({ scaduta: true }));
  }

  // Carica il token dal DB
  const { data: tk, error: tkErr } = await supabase
    .from('download_tokens')
    .select('id, token, download_url, azienda_email, batch_nome, count, expires_at, used_at, codice_referti')
    .eq('token', token)
    .single();

  // Token non trovato
  if (tkErr || !tk) {
    return res.status(404).send(paginaHTML({ scaduta: true }));
  }

  // Token scaduto
  if (new Date(tk.expires_at) < new Date()) {
    return res.status(410).send(paginaHTML({ scaduta: true }));
  }

  // ── GET: mostra pagina ──────────────────────────────────────────────
  if (req.method === 'GET') {
    return res.status(200).send(paginaHTML({
      batchNome: tk.batch_nome,
      count: tk.count,
      expiresAt: tk.expires_at,
    }));
  }

  // ── POST: verifica codice ───────────────────────────────────────────
  if (req.method === 'POST') {
    const codiceInserito = (req.body?.codice || '').trim();

    // Codice non impostato nel token: redirect diretto + alert breach
    if (!tk.codice_referti) {
      fetch('https://ambulatoriomillefonti.it/api/notify-breach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tipo: 'codice_mancante',
          messaggio: `Codice non impostato per ${tk.azienda_email} — accesso diretto al download concesso.`,
        }),
      }).catch(() => {});
      await supabase
        .from('download_tokens')
        .update({ used_at: new Date().toISOString() })
        .eq('id', tk.id);
      return res.redirect(302, tk.download_url);
    }

    // Confronto case-insensitive
    if (codiceInserito !== tk.codice_referti) {
      return res.status(200).send(paginaHTML({
        batchNome: tk.batch_nome,
        count: tk.count,
        expiresAt: tk.expires_at,
        errore: 'Codice non corretto. Riprova.',
      }));
    }

    // Codice corretto: segna used_at e redirect
    await supabase
      .from('download_tokens')
      .update({ used_at: new Date().toISOString() })
      .eq('id', tk.id);

    return res.redirect(302, tk.download_url);
  }

  return res.status(405).end();
}
