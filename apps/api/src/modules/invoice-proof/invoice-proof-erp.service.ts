import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ErpProvider, OrgDataSource, OrgPoStatus } from '@prisma/client';
import { randomBytes, createHash } from 'crypto';

import { PrismaService } from '../database/prisma.service.js';
import { encryptCredentials, decryptCredentials } from './credential-crypto.js';

const ERP_CALLBACK_BASE =
  process.env.API_BASE_URL?.replace(/\/$/, '') ?? 'http://localhost:3000';

@Injectable()
export class InvoiceProofErpService {
  private readonly logger = new Logger(InvoiceProofErpService.name);

  constructor(private readonly prisma: PrismaService) {}

  normalizeProvider(provider: string): ErpProvider {
    const key = provider.toUpperCase().replace(/-/g, '');
    const map: Record<string, ErpProvider> = {
      QUICKBOOKS: ErpProvider.QUICKBOOKS,
      XERO: ErpProvider.XERO,
      NETSUITE: ErpProvider.NETSUITE,
      SAGE: ErpProvider.SAGE,
      BILLDOTCOM: ErpProvider.BILLDOTCOM,
      BILLCOM: ErpProvider.BILLDOTCOM,
    };
    const resolved = map[key];
    if (!resolved) throw new BadRequestException(`Unsupported ERP provider: ${provider}`);
    return resolved;
  }

  buildPkce() {
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    return { verifier, challenge };
  }

  getOAuthConfig(provider: ErpProvider) {
    switch (provider) {
      case ErpProvider.QUICKBOOKS:
        return {
          clientId: process.env.QUICKBOOKS_CLIENT_ID,
          clientSecret: process.env.QUICKBOOKS_CLIENT_SECRET,
          authUrl: 'https://appcenter.intuit.com/connect/oauth2',
          tokenUrl: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
          scope: 'com.intuit.quickbooks.accounting',
        };
      case ErpProvider.XERO:
        return {
          clientId: process.env.XERO_CLIENT_ID,
          clientSecret: process.env.XERO_CLIENT_SECRET,
          authUrl: 'https://login.xero.com/identity/connect/authorize',
          tokenUrl: 'https://identity.xero.com/connect/token',
          scope: 'openid profile email accounting.transactions accounting.contacts offline_access',
        };
      case ErpProvider.NETSUITE:
        return {
          clientId: process.env.NETSUITE_CONSUMER_KEY,
          clientSecret: process.env.NETSUITE_CONSUMER_SECRET,
          authUrl: null,
          tokenUrl: null,
          scope: 'rest_webservices',
        };
      case ErpProvider.SAGE:
        return {
          clientId: process.env.SAGE_CLIENT_ID,
          clientSecret: process.env.SAGE_CLIENT_SECRET,
          authUrl: 'https://www.sageone.com/oauth2/auth/central',
          tokenUrl: 'https://oauth.accounting.sage.com/token',
          scope: 'full_access',
        };
      case ErpProvider.BILLDOTCOM:
        return {
          clientId: process.env.BILLDOTCOM_APP_KEY,
          clientSecret: process.env.BILLDOTCOM_APP_SECRET,
          authUrl: null,
          tokenUrl: 'https://api.bill.com/api/v2/Login.json',
          scope: 'read',
        };
      default:
        throw new BadRequestException('ERP provider not configured');
    }
  }

  async startConnect(organizationId: string, providerRaw: string, redirectUri?: string) {
    const provider = this.normalizeProvider(providerRaw);
    const config = this.getOAuthConfig(provider);
    if (!config.clientId || !config.clientSecret) {
      throw new BadRequestException(
        `${provider} OAuth is not configured. Set client credentials in environment.`,
      );
    }

    const { verifier, challenge } = this.buildPkce();
    const state = randomBytes(16).toString('hex');
    const callback = redirectUri ?? `${ERP_CALLBACK_BASE}/invoice-proof/erp/callback/${providerRaw.toLowerCase()}`;

    await this.prisma.orgErpConnection.upsert({
      where: { organizationId_provider: { organizationId, provider } },
      create: {
        organizationId,
        provider,
        encryptedTokens: encryptCredentials({ state, pkceVerifier: verifier, pending: true }),
      },
      update: {
        encryptedTokens: encryptCredentials({ state, pkceVerifier: verifier, pending: true }),
      },
    });

    if (!config.authUrl) {
      return {
        provider,
        authUrl: null,
        message: `${provider} requires manual API key setup. Store credentials via admin integration.`,
        callback,
      };
    }

    const params = new URLSearchParams({
      client_id: config.clientId,
      response_type: 'code',
      scope: config.scope,
      redirect_uri: callback,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });

    return { provider, authUrl: `${config.authUrl}?${params.toString()}`, callback };
  }

  async handleCallback(providerRaw: string, code: string, state: string, realmId?: string) {
    const provider = this.normalizeProvider(providerRaw);
    const connections = await this.prisma.orgErpConnection.findMany({ where: { provider } });
    const connection = connections.find((c) => {
      try {
        const tokens = decryptCredentials(c.encryptedTokens) as { state?: string };
        return tokens.state === state;
      } catch {
        return false;
      }
    });
    if (!connection) throw new NotFoundException('OAuth state mismatch or connection not found');

    const config = this.getOAuthConfig(provider);
    const pending = decryptCredentials(connection.encryptedTokens) as { pkceVerifier?: string };
    const callback = `${ERP_CALLBACK_BASE}/invoice-proof/erp/callback/${providerRaw.toLowerCase()}`;

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: callback,
      client_id: config.clientId!,
      client_secret: config.clientSecret!,
      ...(pending.pkceVerifier ? { code_verifier: pending.pkceVerifier } : {}),
    });

    const tokenRes = await fetch(config.tokenUrl!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      this.logger.error(`ERP token exchange failed: ${errText}`);
      throw new BadRequestException('ERP OAuth token exchange failed');
    }
    const tokens = (await tokenRes.json()) as Record<string, unknown>;

    await this.prisma.orgErpConnection.update({
      where: { id: connection.id },
      data: {
        encryptedTokens: encryptCredentials({ ...tokens, obtainedAt: new Date().toISOString() }),
        realmId: realmId ?? connection.realmId,
        lastSyncStatus: 'CONNECTED',
      },
    });

    await this.syncProvider(connection.organizationId, provider);
    return { connected: true, provider, organizationId: connection.organizationId };
  }

  async listConnections(organizationId: string) {
    const rows = await this.prisma.orgErpConnection.findMany({
      where: { organizationId },
      select: {
        id: true,
        provider: true,
        realmId: true,
        lastSyncAt: true,
        lastSyncStatus: true,
        createdAt: true,
      },
    });
    return rows;
  }

  async disconnect(organizationId: string, providerRaw: string) {
    const provider = this.normalizeProvider(providerRaw);
    await this.prisma.orgErpConnection.deleteMany({ where: { organizationId, provider } });
    return { disconnected: true, provider };
  }

  async syncProvider(organizationId: string, provider: ErpProvider) {
    const connection = await this.prisma.orgErpConnection.findUnique({
      where: { organizationId_provider: { organizationId, provider } },
    });
    if (!connection) throw new NotFoundException('ERP connection not found');

    // Provider-specific sync — OAuth scaffold exists but live API calls are not yet implemented.
    let result: { vendors: number; pos: number; bills: number; live: false; message: string };
    try {
      result = await this.pullProviderData(organizationId, provider, connection);
      await this.prisma.orgErpConnection.update({
        where: { id: connection.id },
        data: { lastSyncAt: new Date(), lastSyncStatus: result.live ? 'OK' : 'SANDBOX_PENDING' },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.prisma.orgErpConnection.update({
        where: { id: connection.id },
        data: { lastSyncStatus: `ERROR: ${msg.slice(0, 200)}` },
      });
      throw err;
    }
    return result;
  }

  private async pullProviderData(
    organizationId: string,
    provider: ErpProvider,
    connection: { encryptedTokens: string; realmId: string | null },
  ): Promise<{ vendors: number; pos: number; bills: number; live: false; message: string }> {
    const tokens = decryptCredentials(connection.encryptedTokens) as Record<string, unknown>;

    // OAuth scaffold exists for QuickBooks, Xero, and Sage; NetSuite and Bill.com cannot
    // start OAuth yet (authUrl is null). No provider calls any live API — this is a stub.
    // Real API calls require Intuit/Xero/Sage credentials and are not implemented.
    this.logger.warn(
      `ERP sync called for ${provider} org=${organizationId} realm=${connection.realmId} — ` +
        'live API calls are NOT implemented. Returning sandbox-pending result.',
    );

    if (!tokens.pending) {
      // Token was exchanged successfully during OAuth callback; connection is authorized
      // but data import is not live yet. Run no-op counts to keep DB refs valid.
      const sourceMap: Record<ErpProvider, OrgDataSource> = {
        [ErpProvider.QUICKBOOKS]: OrgDataSource.QUICKBOOKS,
        [ErpProvider.XERO]: OrgDataSource.XERO,
        [ErpProvider.NETSUITE]: OrgDataSource.NETSUITE,
        [ErpProvider.SAGE]: OrgDataSource.MANUAL,
        [ErpProvider.BILLDOTCOM]: OrgDataSource.MANUAL,
      };
      const source = sourceMap[provider];
      await this.prisma.orgVendorMaster.count({ where: { organizationId, source } });
      await this.prisma.orgPoRegister.count({
        where: { organizationId, status: OrgPoStatus.OPEN, source },
      });
    }

    return {
      vendors: 0,
      pos: 0,
      bills: 0,
      live: false,
      message: 'Sandbox pending — real ERP sync not yet enabled. No data was imported.',
    };
  }
}
