import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { hash } from 'argon2';

import { PrismaService } from '../database/prisma.service.js';

const ANONYMOUS_ORG_ID = 'anonymous';

@Injectable()
export class ProofClaimService {
  constructor(private readonly prisma: PrismaService) {}

  generateClaimToken(): string {
    return `claim_${randomBytes(24).toString('hex')}`;
  }

  async claimProofs(params: { email: string; claimToken?: string; product?: string }) {
    const email = params.email.trim().toLowerCase();
    if (!email) throw new BadRequestException('email is required');

    if (!params.claimToken) {
      return { ok: true, message: 'If a matching proof exists, a claim link will be sent to your email.' };
    }

    const run = await this.prisma.verificationRun.findFirst({
      where: {
        claimToken: params.claimToken,
        orgId: ANONYMOUS_ORG_ID,
      },
      include: { proofs: true },
    });

    if (!run) {
      throw new NotFoundException('Claim token not found or already claimed');
    }

    let user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      const password = randomBytes(16).toString('hex');
      user = await this.prisma.user.create({
        data: {
          email,
          password: await hash(password),
          userType: 'HUMAN',
          displayName: email.split('@')[0] ?? 'Proof User',
          emailVerified: new Date(),
        },
      });
    }

    const slug = `proof-${user.id.slice(0, 8)}`;
    let org = await this.prisma.organization.findUnique({ where: { slug } });
    if (!org) {
      org = await this.prisma.organization.create({
        data: { slug, name: `${email} — Proof` },
      });
    }

    await this.prisma.organizationMembership.upsert({
      where: {
        userId_organizationId: { userId: user.id, organizationId: org.id },
      },
      update: {},
      create: { userId: user.id, organizationId: org.id, role: 'OWNER' },
    });

    await this.prisma.$transaction([
      this.prisma.verificationRun.update({
        where: { id: run.id },
        data: { orgId: org.id, claimToken: null },
      }),
      this.prisma.proofRecord.updateMany({
        where: { verificationRunId: run.id },
        data: { orgId: org.id },
      }),
    ]);

    return {
      ok: true,
      organizationId: org.id,
      verificationRunId: run.id,
      proofIds: run.proofs.map((p) => p.id),
      message: 'Proof saved to your account. Sign in with your email to view it in the console.',
    };
  }
}
