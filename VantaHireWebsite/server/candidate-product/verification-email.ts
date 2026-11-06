// Verification email copy (approved by the user, 3 Nov 2026). Codex wires the selection in
// server/auth.ts: the spark version for spark sign-ups and their resends only; everyone else
// gets the plain version. Sent through the existing Flow email service (Brevo); the link and
// expiry are unchanged. Inline styles and tables only, because email clients ignore stylesheets.

// spark palette (tailwind.config.ts): coral, ink and soft; text/muted/border match the app.
const SPARK = '#F25C2E', INK = '#C2410C', SOFT = '#FEF0EA', TEXT = '#09090B', MUTED = '#52525B', BORDER = '#E4E4E7';
const FONT = "'Helvetica Neue',Helvetica,Arial,sans-serif";

/** Escapes text and attribute values. Names and links are never inserted raw. */
export function escapeEmailHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

type Input = { firstName?: string | null; verifyUrl: string; baseUrl: string };
export type VerificationEmail = { subject: string; html: string; text: string };

// The persisted signup intent, not the current feature flag or candidate role
// alone, selects branding. Both registration and resend use this same selector.
export async function verificationEmailForAccount(
  input: Input & { userId: number; role: string },
  hasSparkSignup: (userId: number) => Promise<boolean>,
): Promise<VerificationEmail> {
  const spark = input.role === 'candidate' && await hasSparkSignup(input.userId);
  return spark ? sparkVerificationEmail(input) : accountVerificationEmail(input);
}

const first = (n?: string | null) => (n ?? '').trim() || 'there';

// Layout adapted from 21st.dev "Auth Verify Email" (preetsuthar17): card, title, description,
// full-width primary action, then a tinted help panel. Rebuilt as tables with inline styles,
// because email clients drop stylesheets, flexbox and inline SVG.
function layout(o: { header: string; accent: string; button: string; buttonText: string; link: string; panel: string; body: string; verifyUrl: string; background: string }) {
  const url = escapeEmailHtml(o.verifyUrl);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:${o.background};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${o.background};"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#FFFFFF;border:1px solid ${BORDER};border-top:4px solid ${o.accent};border-radius:16px;">
${o.header ? `<tr><td style="padding:28px 32px 0;">${o.header}</td></tr>` : ''}
<tr><td style="padding:24px 32px 0;font-family:${FONT};">
<h1 style="margin:0;font-size:24px;line-height:1.25;font-weight:600;color:${TEXT};">Confirm your email</h1>
<div style="margin-top:12px;font-size:16px;line-height:1.6;color:${TEXT};">${o.body}</div>
</td></tr>
<tr><td style="padding:24px 32px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="border-radius:10px;background:${o.button};">
<a href="${url}" style="display:block;padding:14px 20px;font-family:${FONT};font-size:19px;font-weight:700;line-height:1.3;color:${o.buttonText};text-decoration:none;border-radius:10px;">Confirm my email</a>
</td></tr></table></td></tr>
<tr><td style="padding:20px 32px 28px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:14px 16px;background:${o.panel};border:1px solid ${BORDER};border-radius:10px;font-family:${FONT};font-size:14px;line-height:1.6;color:${MUTED};">
Or paste this link into your browser:<br><a href="${url}" style="color:${o.link};word-break:break-all;">${url}</a>
<p style="margin:10px 0 0;">The link expires after 24 hours. Didn't sign up for ealana? Just ignore this email.</p>
</td></tr></table></td></tr>
</table></td></tr></table></body></html>`;
}

/** spark sign-ups and their resends. */
export function sparkVerificationEmail({ firstName, verifyUrl, baseUrl }: Input): VerificationEmail {
  const name = first(firstName);
  const header = `<img src="${escapeEmailHtml(baseUrl.replace(/\/+$/, ''))}/brand/spark-email-header.png" width="146" height="28" alt="ealana spark" style="display:block;border:0;height:28px;width:146px;">`;
  return {
    subject: 'Confirm your email for spark',
    html: layout({ header, accent: SPARK, button: SPARK, buttonText: '#FFFFFF', link: INK, panel: SOFT, background: SOFT, verifyUrl,
      body: `<p style="margin:0;">Hi ${escapeEmailHtml(name)},</p><p style="margin:8px 0 0;">Confirm your email to get started with your spark profile.</p>` }),
    text: `Hi ${name},\n\nConfirm your email to get started with your spark profile:\n${verifyUrl}\n\nThe link expires after 24 hours. Didn't sign up for ealana? Just ignore this email.`,
  };
}

/** Everyone else (recruiters and non-spark accounts). Copy refresh; no spark header or colours. */
export function accountVerificationEmail({ firstName, verifyUrl }: Input): VerificationEmail {
  const name = first(firstName);
  return {
    subject: 'Confirm your email for ealana',
    html: layout({ header: '', accent: TEXT, button: TEXT, buttonText: '#FFFFFF', link: TEXT, panel: '#F4F4F5', background: '#F4F4F5', verifyUrl,
      body: `<p style="margin:0;">Hi ${escapeEmailHtml(name)},</p><p style="margin:8px 0 0;">Thanks for signing up. Tap the button to confirm your email and get started.</p>` }),
    text: `Hi ${name},\n\nThanks for signing up. Confirm your email and get started:\n${verifyUrl}\n\nThe link expires after 24 hours. Didn't sign up for ealana? Just ignore this email.`,
  };
}
