import { readFileSync } from 'node:fs';import { describe,it,expect } from 'vitest';
const schema=readFileSync(new URL('../../../prisma/schema.prisma',import.meta.url),'utf8');
const svc=readFileSync(new URL('../invoice-proof/invoice-proof.service.ts',import.meta.url),'utf8');
const adapters=readFileSync(new URL('./adapters.module.ts',import.meta.url),'utf8');
describe('standalone implementations',()=>{
 it('owns API identities without SwarmSync membership tables',()=>{expect(schema).toContain('model ApiIdentity');expect(svc).not.toContain('organizationMembership');});
 it('implements database billing and HTTP browser intake',()=>{expect(adapters).toContain('PrismaProofBillingAdapter');expect(adapters).toContain('HttpBrowserIntakeAdapter');expect(adapters).not.toContain('DisabledBrowserIntakeAdapter');});
 it('implements SMTP outbound email',()=>{expect(adapters).toContain('SmtpOutboundEmailAdapter');});
});
