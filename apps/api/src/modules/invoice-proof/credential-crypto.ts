import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

function key(): Buffer {
  const secret = process.env.CREDENTIAL_ENCRYPTION_KEY || process.env.CHAIN_VERIFY_ENCRYPTION_KEY;
  if (!secret) throw new Error('CREDENTIAL_ENCRYPTION_KEY is not configured');
  return createHash('sha256').update(secret).digest();
}

export function encryptCredentials(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((part) => part.toString('base64url')).join('.');
}

export function decryptCredentials(value: string): unknown {
  const [ivRaw, tagRaw, dataRaw] = value.split('.');
  if (!ivRaw || !tagRaw || !dataRaw) throw new Error('Invalid encrypted credential payload');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivRaw, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(dataRaw, 'base64url')), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8')) as unknown;
}
