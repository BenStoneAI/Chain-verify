/**
 * Purchase welcome email renderer. Pure: no I/O, no secrets.
 *
 * The email never carries an API key or key hash. For Agent Gate it only says
 * the key is shown once on the welcome page (the claim link works for 24 hours).
 */

export const WELCOME_EMAIL_LOGO_URL = 'https://www.chainverify.org/chainverify-logo-horizontal.png';
// Source asset is 1746x320; rendered at 280 wide keeping the aspect ratio.
const LOGO_WIDTH = 280;
const LOGO_HEIGHT = 51;
const HEADER_BG = '#0A0D14'; // the logo is white/cyan on transparent, so it needs a dark band
const BUTTON_BG = '#0E7490';
const FOOTER_TEXT = 'ChainVerify — independent proof for AI work';

export interface PurchaseWelcomeEmailInput {
  to: string;
  orgName: string;
  productName: string;
  planName: string;
  monthlyLimit: number | null;
  welcomeUrl: string;
  docsUrl: string;
  supportEmail: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function singleLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function isAgentGate(productName: string): boolean {
  return /agent\s*gate/i.test(productName);
}

function limitLine(input: PurchaseWelcomeEmailInput): string | null {
  if (input.monthlyLimit === null) return null;
  const unit = /invoice/i.test(input.productName) ? 'invoices' : 'verification runs';
  return `Included usage: ${input.monthlyLimit.toLocaleString('en-US')} ${unit} per month.`;
}

const KEY_NOTICE =
  'Your API key is shown once on the welcome page. The claim link works for 24 hours, so open it soon.';

export function renderPurchaseWelcomeEmail(input: PurchaseWelcomeEmailInput): RenderedEmail {
  const org = singleLine(input.orgName) || 'there';
  const subject = singleLine(`Welcome to ${input.productName} — your ${input.planName} plan is active`);
  const limit = limitLine(input);
  const keyNotice = isAgentGate(input.productName) ? KEY_NOTICE : null;

  const e = escapeHtml;
  const p = (inner: string) =>
    `<p style="margin:0 0 16px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:24px;color:#1F2937;">${inner}</p>`;

  const bodyRows = [
    p(`Hi ${e(org)},`),
    `<p style="margin:0 0 16px 0;font-family:Arial,Helvetica,sans-serif;font-size:20px;line-height:28px;font-weight:bold;color:#0A0D14;">Your ${e(input.planName)} plan is active</p>`,
    p(`Thanks for choosing ${e(input.productName)}. Your account is set up and ready to use.`),
    limit ? p(e(limit)) : '',
    keyNotice ? p(e(keyNotice)) : '',
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px 0;"><tr><td align="center" bgcolor="${BUTTON_BG}" style="border-radius:6px;background-color:${BUTTON_BG};"><a href="${e(input.welcomeUrl)}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;line-height:20px;color:#FFFFFF;text-decoration:none;border-radius:6px;">Open your welcome page</a></td></tr></table>`,
    p(`Read the <a href="${e(input.docsUrl)}" target="_blank" style="color:#0E7490;text-decoration:underline;">documentation</a> to get started.`),
    p(`Questions? Reply to this email or write to <a href="mailto:${e(input.supportEmail)}" style="color:#0E7490;text-decoration:underline;">${e(input.supportEmail)}</a>.`),
  ].filter(Boolean).join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${e(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#F3F4F6;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F3F4F6" style="background-color:#F3F4F6;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#FFFFFF;border-radius:8px;">
<tr><td align="center" bgcolor="${HEADER_BG}" style="background-color:${HEADER_BG};padding:28px 24px;border-radius:8px 8px 0 0;">
<img src="${WELCOME_EMAIL_LOGO_URL}" alt="ChainVerify" width="${LOGO_WIDTH}" height="${LOGO_HEIGHT}" style="display:block;border:0;outline:none;text-decoration:none;width:${LOGO_WIDTH}px;height:${LOGO_HEIGHT}px;max-width:100%;">
</td></tr>
<tr><td style="padding:32px 32px 16px 32px;">
${bodyRows}
</td></tr>
<tr><td style="padding:16px 32px 28px 32px;border-top:1px solid #E5E7EB;">
<p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#6B7280;text-align:center;">${e(FOOTER_TEXT)}</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    'ChainVerify',
    '',
    `Hi ${org},`,
    '',
    `Your ${input.planName} plan is active`,
    '',
    `Thanks for choosing ${input.productName}. Your account is set up and ready to use.`,
    ...(limit ? ['', limit] : []),
    ...(keyNotice ? ['', keyNotice] : []),
    '',
    `Open your welcome page: ${input.welcomeUrl}`,
    '',
    `Documentation: ${input.docsUrl}`,
    '',
    `Questions? Reply to this email or write to ${input.supportEmail}.`,
    '',
    '--',
    FOOTER_TEXT,
    '',
  ].join('\n');

  return { subject, html, text };
}
