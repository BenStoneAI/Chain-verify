import { Module } from '@nestjs/common';

import { ChainVerifyAdaptersModule } from '../adapters/adapters.module.js';
import { ContactController } from './contact.controller.js';

@Module({
  imports: [ChainVerifyAdaptersModule],
  controllers: [ContactController],
})
export class ContactModule {}
