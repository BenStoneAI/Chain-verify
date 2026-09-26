import { Injectable } from '@nestjs/common';
import type { SoftwareDeliveryVerifyDto } from './dto/software-delivery-verify.dto.js';
/** Standalone boundary: deep GitHub/deployment inspection is intentionally not bundled into Chain Verify core. */
@Injectable() export class SoftwareDeliveryService {
 async verify(_orgId:string,input:SoftwareDeliveryVerifyDto){return {status:'needs_more_evidence',accepted:false,confidence:0,evidence_gaps:['External software-delivery inspection provider is not configured.'],input_received:Boolean(input)};}
}
