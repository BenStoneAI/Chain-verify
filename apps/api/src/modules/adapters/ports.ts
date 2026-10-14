import type { AuthenticatedUser } from '../auth/types.js';

export const OUTBOUND_EMAIL = Symbol('OUTBOUND_EMAIL');
export const BROWSER_INTAKE = Symbol('BROWSER_INTAKE');
export const IDENTITY_CONTEXT = Symbol('IDENTITY_CONTEXT');
export const PROOF_BILLING = Symbol('PROOF_BILLING');

export interface OutboundEmailPort {
  sendInvoiceProofReviewAlert(input: { to:string; orgName:string; scanId:string; riskLevel:string; findingCount:number; topFindings:Array<{pattern:string;severity:string}> }): Promise<void>;
  sendVendorPortalOtp(input: { to:string; vendorName:string; orgName:string; code:string }): Promise<void>;
  sendPurchaseWelcome(input: { to:string; orgName:string; productName:string; planName:string; monthlyLimit:number|null; welcomeUrl:string; docsUrl:string; supportEmail:string }): Promise<void>;
}
export interface BrowserActionResult { success:boolean; contentType?:string; bodyBase64?:string; data?:unknown; }
export interface BrowserIntakePort {
  initSession(id:string, options?:{allowedDomains?:string[]}): Promise<void>;
  navigate(id:string,url:string): Promise<BrowserActionResult>;
  extractMain(id:string): Promise<BrowserActionResult>;
  accessibilitySnapshot(id:string): Promise<BrowserActionResult>;
  closeSession(id:string): Promise<void>;
}
export interface IdentityContextPort { currentUser(request: unknown): Promise<AuthenticatedUser | null>; }
export interface ProofBillingPort { getActiveEntitlement(organizationId:string, product:string): Promise<unknown | null>; }
