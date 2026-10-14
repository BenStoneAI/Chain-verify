import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';

import { ProofActivationService } from './proof-activation.service.js';

@Controller('billing/proof')
export class ProofActivationController {
  constructor(private readonly activation: ProofActivationService) {}

  @Post('activate')
  @HttpCode(HttpStatus.OK)
  activate(
    @Body()
    body: {
      product: 'verify-api' | 'audit-proof' | 'invoice-proof';
      planSlug: string;
      sessionId: string;
      companyName: string;
      contactName?: string;
      contactEmail: string;
    },
  ) {
    return this.activation.activate(body);
  }
}
