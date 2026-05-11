export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { email, nomeAzienda, batchNome, count, data } = req.body;

  console.log('notify-ricezione: body =', JSON.stringify(req.body));
  console.log('notify-ricezione: email =', email, '| batchNome =', batchNome);

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    console.error('notify-ricezione: email mancante o non valida:', email);
    return res.status(400).json({ error: 'Email destinatario mancante o non valida' });
  }

  const LOGO = 'https://weearnnmglyjufhpycju.supabase.co/storage/v1/object/public/assets/logo%20definitivo.png';

  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': process.env.BREVO_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sender: { name: 'Ambulatorio Millefonti', email: 'noreply@ambulatoriomillefonti.it' },
        to: [{ email }],
        subject: `Ricezione lotto ECG confermata — ${batchNome}`,
        htmlContent: `
          <div style="font-family: Arial, sans-serif; max-width: 620px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
            <div style="background: linear-gradient(135deg, #1a2640, #2e7cf6); padding: 28px 32px;">
              <h1 style="color: white; margin: 0; font-size: 20px; font-weight: 600;">Ambulatorio Millefonti</h1>
              <p style="color: rgba(255,255,255,0.75); margin: 6px 0 0; font-size: 13px;">Piattaforma di Refertazione ECG</p>
            </div>
            <div style="padding: 32px;">
              <p style="color: #1a2640; font-size: 15px; margin: 0 0 8px;">Gentile Cliente,</p>
              <p style="color: #4a5568; font-size: 14px; line-height: 1.6; margin: 0 0 20px;">
                confermiamo la ricezione del lotto <strong style="color: #1a2640;">${batchNome}</strong>, 
                composto da <strong style="color: #1a2640;">${count} ECG</strong>, 
                pervenuto in data <strong style="color: #1a2640;">${data}</strong>.
              </p>
              <p style="color: #4a5568; font-size: 14px; line-height: 1.6; margin: 0 0 28px;">
                Il materiale è stato acquisito correttamente dalla nostra piattaforma e sarà preso in carico 
                dal cardiologo nelle prossime ore. Riceverà una notifica via email non appena i referti 
                saranno pronti per il download.
              </p>
              <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
              <p style="color: #a0aec0; font-size: 11px; margin: 0 0 4px; line-height: 1.6;">
                Questa è una notifica automatica — si prega di non rispondere a questa email.
              </p>
              <p style="color: #1a2640; font-size: 12px; font-weight: 600; margin: 0;">
                Ambulatorio Millefonti
              </p>
              <p style="color: #6b7d99; font-size: 12px; margin: 2px 0 0;">
                Via Garessio 47 — Torino
              </p>
              <div style="text-align: center; padding: 28px 0 8px;">
                <img src="${LOGO}" alt="Ambulatorio Millefonti" width="140"
                     style="display: block; margin: 0 auto;" />
              </div>
            </div>
          </div>
        `,
      }),
    });
    if (response.ok) return res.status(200).json({ success: true });
    const err = await response.text();
    console.error('notify-ricezione: Brevo error =', err);
    return res.status(500).json({ error: err });
  } catch (error) {
    console.error('notify-ricezione: exception =', error.message);
    return res.status(500).json({ error: error.message });
  }
}
