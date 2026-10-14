import { IsEmail, IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';

import { CONTACT_TOPICS, type ContactTopic } from './contact-email.js';

export class ContactMessageDto {
  @IsString()
  @Length(1, 100)
  name!: string;

  @IsString()
  @IsEmail()
  @MaxLength(200)
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  company?: string;

  @IsString()
  @IsIn([...CONTACT_TOPICS])
  topic!: ContactTopic;

  @IsString()
  @Length(10, 5000)
  message!: string;

  /** Honeypot: real visitors never see or fill this field. */
  @IsOptional()
  @IsString()
  website?: string;
}
