/** Sends the password-reset email through Resend. Returns false when email is not configured. */
export async function sendResetEmail(to, link) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  if (!key || !from) return false;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [to],
      subject: 'Reset your WorkSpark password',
      html: `<p>We received a request to reset your WorkSpark password.</p>
             <p><a href="${link}">Choose a new password</a> (this link works for 1 hour).</p>
             <p>If you did not ask for this, you can ignore this email.</p>`,
    }),
  });
  if (!res.ok) { console.error('Resend error', res.status, await res.text()); return false; }
  return true;
}
