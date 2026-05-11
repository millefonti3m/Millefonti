export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { email, cardiologo, count, batchNome } = req.body;
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
        subject: `Nuovi ECG da refertare — ${count} documento${count > 1 ? 'i' : 'o'}`,
        htmlContent: `
          <div style="font-family: Arial, sans-serif; max-width: 620px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
            <div style="background: linear-gradient(135deg, #255736, #437953); padding: 28px 32px;">
              <h1 style="color: white; margin: 0; font-size: 20px; font-weight: 600;">Ambulatorio Millefonti</h1>
              <p style="color: rgba(255,255,255,0.75); margin: 6px 0 0; font-size: 13px;">Piattaforma di Refertazione ECG</p>
            </div>
            <div style="padding: 32px;">
              <p style="color: #1a2640; font-size: 15px; margin: 0 0 8px;">Gentile Dott. ${cardiologo},</p>
              <p style="color: #4a5568; font-size: 14px; line-height: 1.6; margin: 0 0 24px;">
                ${batchNome 
                  ? `le sono stati assegnati <strong style="color: #1a2640;">${count} ECG</strong> del lotto <strong style="color: #1a2640;">${batchNome}</strong> da refertare.`
                  : `le ${count > 1 ? 'sono stati assegnati' : 'è stato assegnato'} <strong style="color: #1a2640;">${count} ECG</strong> da refertare.`
                }
              </p>

              <div style="text-align: center; margin-bottom: 28px;">
                <a href="https://ambulatoriomillefonti.it" style="display: inline-block; background: linear-gradient(135deg, #255736, #437953); color: white; padding: 14px 36px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px;">
                  Accedi alla piattaforma →
                </a>
              </div>

              <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
              <p style="color: #a0aec0; font-size: 11px; margin: 0; line-height: 1.6;">
                Questo è un messaggio automatico. Si prega di non rispondere a questa email.<br/>
                Per assistenza: <a href="mailto:ecg.millefonti@gmail.com" style="color: #255736;">ecg.millefonti@gmail.com</a>
              </p>
              <div style="text-align: center; padding: 28px 0 8px;">
                <img src="https://weearnnmglyjufhpycju.supabase.co/storage/v1/object/public/assets/logo%20definitivo.png" alt="Ambulatorio Millefonti" width="140"
                     style="display: block; margin: 0 auto;" />
              </div>
            </div>
          </div>
        `,
      }),
    });
    if (response.ok) return res.status(200).json({ success: true });
    const err = await response.text();
    return res.status(500).json({ error: err });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
