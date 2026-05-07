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
        subject: `Documentazione ECG disponibile — ${batchNome} (${count} documenti)`,
        htmlContent: `
          <div style="font-family: Arial, sans-serif; max-width: 620px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
            <div style="background: linear-gradient(135deg, #1a2640, #2e7cf6); padding: 28px 32px;">
              <h1 style="color: white; margin: 0; font-size: 20px; font-weight: 600; letter-spacing: 0.3px;">Ambulatorio Millefonti</h1>
              <p style="color: rgba(255,255,255,0.75); margin: 6px 0 0; font-size: 13px;">Piattaforma di Refertazione ECG</p>
            </div>
            <div style="padding: 32px;">
              <p style="color: #1a2640; font-size: 15px; margin: 0 0 8px;">Gentile cliente,</p>
              <p style="color: #4a5568; font-size: 14px; line-height: 1.6; margin: 0 0 24px;">
                la documentazione relativa al lotto <strong style="color: #1a2640;">${batchNome}</strong> 
                è stata completata dal <strong style="color: #1a2640;">Dott. ${cardiologo}</strong>. 
                I documenti sono disponibili per il download tramite i link seguenti.
              </p>
              
              <div style="background: #f7faff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 20px; margin-bottom: 24px;">
                <p style="color: #6b7d99; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 14px;">Documenti disponibili</p>
                <ul style="padding-left: 20px; margin: 0; line-height: 2.2; color: #2e7cf6;">
                  ${linksHtml}
                </ul>
              </div>

              <div style="background: #fff8e1; border-left: 4px solid #f59e0b; padding: 12px 16px; border-radius: 0 8px 8px 0; margin-bottom: 24px;">
                <p style="color: #856404; font-size: 12px; margin: 0;">⚠️ I link di download sono validi per <strong>7 giorni</strong> dalla data di questo messaggio.</p>
              </div>

              <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
              
              <p style="color: #a0aec0; font-size: 11px; margin: 0; line-height: 1.6;">
                Questo è un messaggio automatico generato dalla piattaforma Ambulatorio Millefonti. 
                Si prega di non rispondere a questa email.<br/>
                Per assistenza: <a href="mailto:ecg.millefonti@gmail.com" style="color: #2e7cf6;">ecg.millefonti@gmail.com</a> — 
                <a href="https://ambulatoriomillefonti.it" style="color: #2e7cf6;">ambulatoriomillefonti.it</a>
              </p>
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
