import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { OUTBOUND_EMAIL, type OutboundEmailPort } from '../adapters/ports.js';
import { Public } from '../auth/decorators/public.decorator.js';
import { ContactMessageDto } from './contact.dto.js';

const SEND_FAILURE_MESSAGE = 'Message could not be sent. Please try again shortly.';

/**
 * POST /api/contact: public contact form. Delivers to the owner's private inbox through
 * the outbound email port. The recipient address is resolved inside the adapter and is
 * never returned or logged here.
 */
@Controller('contact')
export class ContactController {
  private readonly logger = new Logger(ContactController.name);

  constructor(@Inject(OUTBOUND_EMAIL) private readonly email: OutboundEmailPort) {}

  @Post()
  @Public()
  @Throttle({ default: { limit: 5, ttl: 600000 } })
  @HttpCode(HttpStatus.OK)
  async submit(@Body() body: unknown): Promise<{ ok: true }> {
    const raw = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;

    // Honeypot: bots fill every field. Pretend success and send nothing.
    if (typeof raw.website === 'string' && raw.website.trim() !== '') {
      return { ok: true };
    }

    const dto = plainToInstance(ContactMessageDto, raw);
    const errors = validateSync(dto, { whitelist: false });
    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Please check the form and try again.',
        fields: errors.map((error) => error.property),
      });
    }

    try {
      await this.email.sendContactMessage({
        name: dto.name.trim(),
        email: dto.email.trim(),
        company: dto.company?.trim() || undefined,
        topic: dto.topic,
        message: dto.message.trim(),
        submittedAt: new Date(),
      });
    } catch {
      this.logger.warn(`Contact message delivery failed (topic=${dto.topic})`);
      throw new ServiceUnavailableException({ message: SEND_FAILURE_MESSAGE });
    }

    return { ok: true };
  }
}
