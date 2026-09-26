import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const moduleSource = readFileSync(new URL('./app.module.ts', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');

describe('standalone API runtime', () => {
  it('boots only Chain Verify product modules', () => {
    expect(moduleSource).toContain('InvoiceProofModule');
    expect(moduleSource).toContain('VerifyApiController');
    expect(moduleSource).not.toContain('Marketplace');
    expect(moduleSource).not.toContain('AgentModule');
  });
  it('has a Nest application entrypoint', () => {
    expect(mainSource).toContain('NestFactory.create');
    expect(mainSource).toContain('CHAIN_VERIFY_API_PORT');
  });
});
