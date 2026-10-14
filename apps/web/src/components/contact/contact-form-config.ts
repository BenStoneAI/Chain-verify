export type ContactTopic = 'sales' | 'support' | 'security' | 'other';

export const CONTACT_TOPIC_OPTIONS: ReadonlyArray<{ value: ContactTopic; label: string }> = [
  { value: 'sales', label: 'Sales and pilots' },
  { value: 'support', label: 'Support' },
  { value: 'security', label: 'Security report' },
  { value: 'other', label: 'Privacy or other' },
];

export const CONTACT_LIMITS = {
  name: 100,
  email: 200,
  company: 120,
  messageMin: 10,
  messageMax: 5000,
} as const;

export const CONTACT_FALLBACK_ERROR = 'Message could not be sent. Please try again shortly.';

export type ContactStatus = 'idle' | 'sending' | 'success' | 'error';
