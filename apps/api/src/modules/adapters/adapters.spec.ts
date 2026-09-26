import { describe, expect, it } from 'vitest';
import { DisabledBrowserIntakeAdapter, EnvOutboundEmailAdapter, HeaderIdentityAdapter } from './adapters.module.js';

describe('Chain Verify adapters', () => {
  it('reads only explicit Chain Verify identity headers', async () => {
    const a=new HeaderIdentityAdapter();
    expect(await a.currentUser({headers:{'x-chain-verify-user-id':'user-1'}})).toMatchObject({id:'user-1'});
    expect(await a.currentUser({headers:{authorization:'Bearer legacy'}})).toBeNull();
  });
  it('fails closed when browser intake is not configured', async () => {
    await expect(new DisabledBrowserIntakeAdapter().initSession('x')).rejects.toThrow('not configured');
  });
  it('fails closed for security OTP email without a provider', async () => {
    await expect(new EnvOutboundEmailAdapter().sendVendorPortalOtp({to:'a@example.com',vendorName:'V',orgName:'O',code:'123456'})).rejects.toThrow('not configured');
  });
});
