export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { email, batchNome, cardiologo, linksHtml, count } = req.body;
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
        subject: `Referti ECG pronti — Lotto ${batchNome} (${count} referti)`,
        htmlContent: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #2e7cf6, #0ea5a0); padding: 24px; border-radius: 12px 12px 0 0;">
              <h1 style="color: white; margin: 0; font-size: 22px;">Ambulatorio Millefonti</h1>
              <p style="color: rgba(255,255,255,0.85); margin: 8px 0 0;">I referti del lotto sono pronti</p>
            </div>
            <div style="background: #f4f7fb; padding: 24px; border-radius: 0 0 12px 12px;">
              <p style="color: #1a2640; font-size: 15px;">Il lotto <strong>${batchNome}</strong> è stato completamente refertato dal <strong>Dott. ${cardiologo}</strong>.</p>
              <p style="color: #1a2640; font-size: 14px; margin-bottom: 16px;">Clicca sul nome del dipendente per scaricare il relativo referto:</p>
              <ul style="padding-left: 20px; line-height: 2;">
                ${linksHtml}
              </ul>
              <p style="color: #6b7d99; font-size: 12px; margin-top: 20px;">I link sono validi per 7 giorni. Per informazioni: ecg.millefonti@gmail.com</p>
            </div>
          </div>
        `,
      }),
    });
    const responseText = await response.text();
    console.log('Brevo batch status:', response.status, responseText);
    if (response.ok) return res.status(200).json({ success: true });
    return res.status(500).json({ error: responseText });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
