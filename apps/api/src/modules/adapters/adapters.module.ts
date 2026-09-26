import { createHash } from 'node:crypto';
import { Injectable, Logger, Module } from '@nestjs/common';
import nodemailer from 'nodemailer';
import { ProofEntitlementStatus, ProofProductType } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { assertSsrfSafeWithDns } from '../../common/utils/ssrf-guard.js';
import { BROWSER_INTAKE, IDENTITY_CONTEXT, OUTBOUND_EMAIL, PROOF_BILLING, type BrowserActionResult, type BrowserIntakePort, type IdentityContextPort, type OutboundEmailPort, type ProofBillingPort } from './ports.js';

@Injectable()
export class SmtpOutboundEmailAdapter implements OutboundEmailPort {
 private transport(){ const host=process.env.SMTP_HOST; if(!host) throw new Error('SMTP_HOST is not configured'); return nodemailer.createTransport({host,port:Number(process.env.SMTP_PORT||587),secure:process.env.SMTP_SECURE==='true',auth:process.env.SMTP_USER?{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}:undefined}); }
 private from(){ return process.env.SMTP_FROM || 'Chain Verify <no-reply@localhost>'; }
 async sendInvoiceProofReviewAlert(i:Parameters<OutboundEmailPort['sendInvoiceProofReviewAlert']>[0]){ await this.transport().sendMail({from:this.from(),to:i.to,subject:`InvoiceProof review required — ${i.riskLevel}`,text:`Organization: ${i.orgName}\nScan: ${i.scanId}\nRisk: ${i.riskLevel}\nFindings: ${i.findingCount}\n${i.topFindings.map(x=>`- ${x.severity}: ${x.pattern}`).join('\n')}`}); }
 async sendVendorPortalOtp(i:Parameters<OutboundEmailPort['sendVendorPortalOtp']>[0]){ await this.transport().sendMail({from:this.from(),to:i.to,subject:'Your InvoiceProof verification code',text:`${i.orgName} requested verification for ${i.vendorName}. Code: ${i.code}. Do not share this code.`}); }
}

@Injectable()
export class HttpBrowserIntakeAdapter implements BrowserIntakePort {
 private readonly sessions=new Map<string,string>();
 async initSession(id:string){this.sessions.set(id,'');}
 async navigate(id:string,url:string):Promise<BrowserActionResult>{ await assertSsrfSafeWithDns(url,true); const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),Number(process.env.URL_INTAKE_TIMEOUT_MS||15000)); try { const r=await fetch(url,{redirect:'manual',signal:controller.signal,headers:{'user-agent':'ChainVerify/1.0'}}); if(r.status>=300&&r.status<400){return {success:false,data:'Redirects are rejected; submit the final URL.'};} const type=r.headers.get('content-type')||''; const bytes=Buffer.from(await r.arrayBuffer()); if(bytes.length>Number(process.env.URL_INTAKE_MAX_BYTES||10485760)) return {success:false,data:'Response exceeds URL intake size limit.'}; this.sessions.set(id,bytes.toString('utf8')); return {success:r.ok,contentType:type,bodyBase64:type.toLowerCase().includes('pdf')?bytes.toString('base64'):undefined,data:type.toLowerCase().includes('pdf')?undefined:bytes.toString('utf8')}; } finally {clearTimeout(timer);} }
 async extractMain(id:string){const html=this.sessions.get(id)||'';const text=html.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();return {success:Boolean(text),data:text};}
 async accessibilitySnapshot(id:string){return this.extractMain(id);}
 async closeSession(id:string){this.sessions.delete(id);}
}

@Injectable()
export class ApiKeyIdentityAdapter implements IdentityContextPort {
 constructor(private readonly prisma:PrismaService){}
 async currentUser(request:any){ const auth=String(request?.headers?.authorization||''); const key=auth.startsWith('Bearer ')?auth.slice(7).trim():String(request?.headers?.['x-chain-verify-api-key']||''); if(!key)return null; const apiKeyHash=createHash('sha256').update(key).digest('hex'); const row=await this.prisma.apiIdentity.findFirst({where:{apiKeyHash,active:true}}); if(!row)return null; await this.prisma.apiIdentity.update({where:{id:row.id},data:{lastUsedAt:new Date()}}); return {id:row.id,organizationId:row.organizationId} as any; }
}

@Injectable()
export class PrismaProofBillingAdapter implements ProofBillingPort {
 constructor(private readonly prisma:PrismaService){}
 async getActiveEntitlement(organizationId:string,product:string){ const enumProduct=({invoice_proof:ProofProductType.INVOICE_PROOF,'invoice-proof':ProofProductType.INVOICE_PROOF,audit_proof:ProofProductType.AUDIT_PROOF,'audit-proof':ProofProductType.AUDIT_PROOF,verify_api:ProofProductType.VERIFY_API,'verify-api':ProofProductType.VERIFY_API} as Record<string,ProofProductType>)[product.toLowerCase()]; if(!enumProduct)return null; return this.prisma.proofProductEntitlement.findFirst({where:{organizationId,product:enumProduct,status:ProofEntitlementStatus.ACTIVE,OR:[{periodEnd:null},{periodEnd:{gte:new Date()}}]},orderBy:{createdAt:'desc'}}); }
}

@Module({providers:[PrismaService,{provide:OUTBOUND_EMAIL,useClass:SmtpOutboundEmailAdapter},{provide:BROWSER_INTAKE,useClass:HttpBrowserIntakeAdapter},{provide:IDENTITY_CONTEXT,useClass:ApiKeyIdentityAdapter},{provide:PROOF_BILLING,useClass:PrismaProofBillingAdapter}],exports:[OUTBOUND_EMAIL,BROWSER_INTAKE,IDENTITY_CONTEXT,PROOF_BILLING]})
export class ChainVerifyAdaptersModule {}
