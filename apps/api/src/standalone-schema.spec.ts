import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');

describe('Chain Verify database boundary', () => {
  it('contains the proof-product persistence models', () => {
    for (const model of ['Organization','ProofProductEntitlement','VerificationRun','ProofRecord','VerifyApiUsage','OrgInvoiceHistory','OrgInvoiceScanRun']) {
      expect(schema).toContain(`model ${model} {`);
    }
  });

  it('does not import SwarmSync marketplace persistence', () => {
    for (const model of ['Agent','Wallet','SwarmNeed','BrokerOpportunity','OrganizationSubscription']) {
      expect(schema).not.toContain(`model ${model} {`);
    }
  });
});
