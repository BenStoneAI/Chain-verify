import { Injectable, Logger, Module } from '@nestjs/common';
import { BROWSER_INTAKE, IDENTITY_CONTEXT, OUTBOUND_EMAIL, PROOF_BILLING, type BrowserIntakePort, type IdentityContextPort, type OutboundEmailPort, type ProofBillingPort } from './ports.js';

@Injectable()
export class EnvOutboundEmailAdapter implements OutboundEmailPort {
  private readonly logger=new Logger(EnvOutboundEmailAdapter.name);
  async sendInvoiceProofReviewAlert(input: Parameters<OutboundEmailPort['sendInvoiceProofReviewAlert']>[0]) { this.logger.warn(`Email provider not configured; review alert not sent to ${input.to}`); }
  async sendVendorPortalOtp(_input: Parameters<OutboundEmailPort['sendVendorPortalOtp']>[0]) { throw new Error('Outbound email provider is not configured'); }
}
@Injectable()
export class DisabledBrowserIntakeAdapter implements BrowserIntakePort {
  async initSession(){ throw new Error('Browser intake provider is not configured'); }
  async navigate(){ return {success:false}; }
  async extractMain(){ return {success:false}; }
  async accessibilitySnapshot(){ return {success:false}; }
  async closeSession(){}
}
@Injectable()
export class HeaderIdentityAdapter implements IdentityContextPort {
  async currentUser(request:any){ const id=request?.headers?.['x-chain-verify-user-id']; return typeof id==='string'&&id ? {id} as any : null; }
}
@Injectable()
export class DatabaseProofBillingAdapter implements ProofBillingPort { async getActiveEntitlement(){ return null; } }

@Module({providers:[
 {provide:OUTBOUND_EMAIL,useClass:EnvOutboundEmailAdapter},
 {provide:BROWSER_INTAKE,useClass:DisabledBrowserIntakeAdapter},
 {provide:IDENTITY_CONTEXT,useClass:HeaderIdentityAdapter},
 {provide:PROOF_BILLING,useClass:DatabaseProofBillingAdapter},
],exports:[OUTBOUND_EMAIL,BROWSER_INTAKE,IDENTITY_CONTEXT,PROOF_BILLING]})
export class ChainVerifyAdaptersModule {}
