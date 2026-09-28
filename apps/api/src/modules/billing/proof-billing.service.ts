import { Injectable } from '@nestjs/common';import { ProofEntitlementStatus,ProofProductType } from '@prisma/client';import Stripe from 'stripe';import { PrismaService } from '../database/prisma.service.js';
// Quota/entitlement + metered-overage reads for VerifyAPI (and the other proof
// products). The auth-gated Stripe Checkout session creation that used to live
// here (createProofCheckoutSession, findProofPlanBySlug, and the related
// provisionProofProductEntitlement/getActiveEntitlement/recordProofUsage
// helpers) was dead code: no controller ever wired up a /billing/proof/checkout
// route, and DESIGN.md requires paid CTAs to go straight to Stripe-hosted
// Checkout links (see ProofCheckoutButton/stripe-payment-links.ts) without any
// registration step in between. Those methods were removed rather than kept
// as unreachable code.
@Injectable() export class ProofBillingService {private readonly stripe:Stripe|null;constructor(private readonly prisma:PrismaService){this.stripe=process.env.STRIPE_SECRET_KEY?new Stripe(process.env.STRIPE_SECRET_KEY):null;}
 async getActiveProofEntitlement(organizationId:string,product:ProofProductType){return this.prisma.proofProductEntitlement.findFirst({where:{organizationId,product,status:ProofEntitlementStatus.ACTIVE,OR:[{periodEnd:null},{periodEnd:{gte:new Date()}}]},orderBy:{createdAt:'desc'}});}
 async resolveProofQuota(organizationId:string,product:ProofProductType){const entitlement=await this.getActiveProofEntitlement(organizationId,product);const monthlyLimit=entitlement?.monthlyLimit??null;return {limit:monthlyLimit,monthlyLimit,used:0,remaining:monthlyLimit,planSlug:entitlement?.planSlug??'free',source:entitlement?'entitlement' as const:'free' as const};}
 isVerifyApiMeteredOverageReady(){return false;}
 async createVerifyApiOverageEvent(p:any){return this.prisma.proofUsageEvent.create({data:{organizationId:p.organizationId,product:'verify-api',planSlug:p.planSlug||'free',verificationRunId:p.verificationRunId,proofId:p.proofId,isOverage:true,overageCents:p.overageCents??null}});}
 async reportUsageEventToStripeBestEffort(_id:string){return false;}
 async attachProofIdToUsageEvent(id:string,proofId:string){return this.prisma.proofUsageEvent.update({where:{id},data:{proofId}});}
}
