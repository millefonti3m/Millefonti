export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { paziente, origine, urgenza, note } = req.body;
  const urgenzaLabel = urgenza === 'urgente' ? '🔴 URGENTE' : '🟢 Normale';
  const origineLabel = origine === 'farmacia' ? '💊 Farmacia' : origine === 'azienda' ? '🏢 Azienda' : '👤 Privato';
  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': process.env.BREVO_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sender: { name: 'Ambulatorio Millefonti', email: 'noreply@ambulatoriomillefonti.it' },
        to: [{ email: 'ecg.millefonti@gmail.com' }],
        subject: `${urgenzaLabel} — Nuovo ECG da refertare`,
        htmlContent: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #2e7cf6, #0ea5a0); padding: 24px; border-radius: 12px 12px 0 0;">
              <h1 style="color: white; margin: 0; font-size: 24px;">Ambulatorio Millefonti</h1>
              <p style="color: rgba(255,255,255,0.85); margin: 8px 0 0;">Nuovo ECG in attesa di assegnazione</p>
            </div>
            <div style="background: #f4f7fb; padding: 24px; border-radius: 0 0 12px 12px;">
              <table style="width: 100%; border-collapse: collapse;">
                <tr><td style="padding: 10px; color: #6b7d99; font-size: 13px;">Paziente</td><td style="padding: 10px; font-weight: bold; color: #1a2640;">${paziente}</td></tr>
                <tr style="background: white;"><td style="padding: 10px; color: #6b7d99; font-size: 13px;">Canale</td><td style="padding: 10px; font-weight: bold; color: #1a2640;">${origineLabel}</td></tr>
                <tr><td style="padding: 10px; color: #6b7d99; font-size: 13px;">Urgenza</td><td style="padding: 10px; font-weight: bold; color: #1a2640;">${urgenzaLabel}</td></tr>
                <tr style="background: white;"><td style="padding: 10px; color: #6b7d99; font-size: 13px;">Note</td><td style="padding: 10px; color: #1a2640;">${note || '—'}</td></tr>
              </table>
              <div style="margin-top: 20px; text-align: center;">
                <a href="https://ambulatoriomillefonti.it" style="background: #2e7cf6; color: white; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: bold;">Vai alla piattaforma →</a>
              </div>
              <div style="text-align: center; padding: 28px 0 8px;">
                <img src="https://weearnnmglyjufhpycju.supabase.co/storage/v1/object/public/assets/logo%20definitivo.png" alt="Ambulatorio Millefonti" width="140"
                     style="display: block; margin: 0 auto;" />
              </div>
              <div style="text-align:center; padding: 8px 0 16px; font-family: Arial, sans-serif;">
                <p style="color:#255736; font-size:13px; font-weight:700; margin:0 0 4px;">Ambulatorio Millefonti</p>
                <p style="color:#637082; font-size:11px; margin:0; line-height:1.8;">
                  Via Garessio 47 — 10126 Torino<br/>
                  Tel. 011 659 83 68 | +39 375 925 2801<br/>
                  <a href="mailto:info@ambulatoriomillefonti.it" style="color:#255736; text-decoration:none;">info@ambulatoriomillefonti.it</a> —
                  <a href="https://www.ambulatoriomillefonti.it" style="color:#255736; text-decoration:none;">www.ambulatoriomillefonti.it</a>
                </p>
              </div>
            </div>
          </div>
        `,
      }),
    });
    if (response.ok) return res.status(200).json({ success: true });
    const error = await response.json();
    return res.status(500).json({ error });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
