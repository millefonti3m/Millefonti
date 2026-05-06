export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { email, paziente, cardiologo, downloadUrl, batch } = req.body;
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Ambulatorio Millefonti <onboarding@resend.dev>',
        to: email,
        subject: batch ? `Referti ECG pronti — Lotto ${batch}` : `Referto ECG pronto — ${paziente}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #2e7cf6, #0ea5a0); padding: 24px; border-radius: 12px 12px 0 0;">
              <h1 style="color: white; margin: 0; font-size: 22px;">Ambulatorio Millefonti</h1>
              <p style="color: rgba(255,255,255,0.85); margin: 8px 0 0;">Il referto ECG è pronto</p>
            </div>
            <div style="background: #f4f7fb; padding: 24px; border-radius: 0 0 12px 12px;">
              <p style="color: #1a2640; font-size: 15px;">Il referto cardiologico per <strong>${paziente}</strong> è stato completato dal <strong>Dott. ${cardiologo}</strong>.</p>
              <div style="margin: 24px 0; text-align: center;">
                <a href="${downloadUrl}" style="background: #2e7cf6; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 15px;">
                  📄 Scarica il referto →
                </a>
              </div>
              <p style="color: #6b7d99; font-size: 12px;">Il link è valido per 7 giorni. Per informazioni: ecg.millefonti@gmail.com</p>
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
