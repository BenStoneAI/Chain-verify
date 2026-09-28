import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AdminIdentity } from '@prisma/client';

/** Pulls the AdminIdentity attached by AdminAuthGuard onto the request. */
export const CurrentAdmin = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AdminIdentity | null =>
    ctx.switchToHttp().getRequest().admin ?? null,
);
