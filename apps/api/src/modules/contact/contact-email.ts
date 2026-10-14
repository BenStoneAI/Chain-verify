/**
 * Contact-form email renderer. Pure: no I/O, no secrets, no recipient.
 * Every visitor-supplied value is stripped of control characters before it can reach a
 * header (subject) and HTML-escaped before it reaches the HTML body.
 */
import { escapeHtml, type RenderedEmail } from '../billing/purchase-welcome-email.js';

export const CONTACT_TOPICS = ['sales', 'support', 'security', 'other'] as const;
export type ContactTopic = (typeof CONTACT_TOPICS)[number];

export interface ContactMessageInput {
  name: string;
  email: string;
  company?: string;
  topic: ContactTopic;
  message: string;
  submittedAt: Date;
}

/** Removes CR, LF and every other control/line-separator character, then collapses whitespace. */
export function stripHeaderChars(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function renderContactEmail(input: ContactMessageInput): RenderedEmail {
  const name = stripHeaderChars(input.name);
  const email = stripHeaderChars(input.email);
  const company = input.company ? stripHeaderChars(input.company) : '';
  const submitted = input.submittedAt.toISOString();
  const subject = `[ChainVerify contact] ${input.topic} — ${name}`;

  const text = [
    `Topic: ${input.topic}`,
    `Name: ${name}`,
    `Email: ${email}`,
    `Company: ${company || '(not provided)'}`,
    `Submitted at: ${submitted}`,
    '',
    input.message,
  ].join('\n');

  const rows: Array<[string, string]> = [
    ['Topic', input.topic],
    ['Name', name],
    ['Email', email],
    ['Company', company || '(not provided)'],
    ['Submitted at', submitted],
  ];
  const html =
    '<table cellpadding="4" style="font-family:Arial,Helvetica,sans-serif;font-size:14px">' +
    rows.map(([k, v]) => `<tr><td><strong>${k}</strong></td><td>${escapeHtml(v)}</td></tr>`).join('') +
    '</table>' +
    `<p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;white-space:pre-wrap">${escapeHtml(input.message)}</p>`;

  return { subject, html, text };
}
