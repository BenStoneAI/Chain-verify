import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const service = readFileSync(new URL('./invoice-proof.service.ts', import.meta.url), 'utf8');
const moduleSource = readFileSync(new URL('./invoice-proof.module.ts', import.meta.url), 'utf8');

describe('InvoiceProof standalone adapters', () => {
  it('uses Chain Verify ports instead of SwarmSync email and Conduit services', () => {
    expect(service).toContain('OutboundEmailPort');
    expect(service).toContain('BrowserIntakePort');
    expect(service).not.toContain("../email/email.service.js");
    expect(service).not.toContain("../conduit/conduit-browser.service.js");
  });
  it('does not import broad SwarmSync modules', () => {
    for (const oldModule of ['AuthModule','EmailModule','ConduitModule','BillingModule']) expect(moduleSource).not.toContain(oldModule);
    expect(moduleSource).toContain('ChainVerifyAdaptersModule');
  });
});
