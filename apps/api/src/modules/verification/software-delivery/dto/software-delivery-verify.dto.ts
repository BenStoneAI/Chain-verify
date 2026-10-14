import {
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsDateString,
  IsUrl,
  Max,
  Min,
} from 'class-validator';

export enum SoftwareTier {
  BASIC = 'BASIC',
  STANDARD = 'STANDARD',
  THOROUGH = 'THOROUGH',
}

export enum SoftwareJobType {
  BUG_FIX = 'BUG_FIX',
  DEPLOY_UPDATE = 'DEPLOY_UPDATE',
  WRITE_TESTS = 'WRITE_TESTS',
  MIGRATE_DATA = 'MIGRATE_DATA',
  BUILD_INTEGRATION = 'BUILD_INTEGRATION',
  NEW_FEATURE = 'NEW_FEATURE',
  CODE_REVIEW = 'CODE_REVIEW',
}

export enum DeployPlatform {
  NETLIFY = 'NETLIFY',
  RENDER = 'RENDER',
  VERCEL = 'VERCEL',
  RAILWAY = 'RAILWAY',
  OTHER = 'OTHER',
}

export class SoftwareDeliveryVerifyDto {
  @IsString()
  repoOwner: string;

  @IsString()
  repoName: string;

  @IsString()
  beforeSha: string;

  @IsString()
  afterSha: string;

  @IsDateString()
  jobStartedAt: string;

  @IsEnum(SoftwareTier)
  tier: SoftwareTier;

  @IsEnum(SoftwareJobType)
  jobType: SoftwareJobType;

  @IsOptional()
  @IsString()
  jobDescription?: string;

  @IsOptional()
  @IsString()
  aiReport?: string;

  @IsOptional()
  @IsUrl()
  deployUrl?: string;

  @IsOptional()
  @IsEnum(DeployPlatform)
  deployPlatform?: DeployPlatform;

  @IsOptional()
  @IsInt()
  prNumber?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000000)
  jobValueUsd?: number;

  @IsOptional()
  @IsInt()
  diffSize?: number;

  @IsOptional()
  @IsString()
  netlifyToken?: string;

  @IsOptional()
  @IsString()
  renderToken?: string;

  @IsOptional()
  @IsString()
  netlifySiteId?: string;

  @IsOptional()
  @IsString()
  renderServiceId?: string;

  @IsOptional()
  @IsString()
  vercelToken?: string;

  @IsOptional()
  @IsString()
  vercelProjectId?: string;

  @IsOptional()
  @IsString()
  vercelTeamId?: string;

  @IsOptional()
  @IsString()
  railwayToken?: string;

  @IsOptional()
  @IsString()
  railwayServiceId?: string;

  @IsOptional()
  @IsArray()
  semgrepFindings?: Array<Record<string, unknown>>;

  @IsOptional()
  @IsNumber()
  @Min(0)
  performanceBaselineP95Ms?: number;

  @IsOptional()
  @IsArray()
  performanceProbePaths?: string[];

  @IsOptional()
  @IsString()
  sentryOrgSlug?: string;

  @IsOptional()
  @IsString()
  sentryProjectSlug?: string;

  @IsOptional()
  @IsString()
  sentryAuthToken?: string;

  @IsOptional()
  @IsString()
  sentryEnvironment?: string;

  /**
   * Optional receipt produced by a local Agent Gate run (agentgate receipt).
   * It is ADDITIONAL evidence: it is validated (hash, signature against a
   * server-side trusted key, HEAD, repository, age) and only then counted as
   * observed. Anything else is recorded as customer-submitted and never
   * raises confidence.
   */
  @IsOptional()
  @IsObject()
  agentGateReceipt?: Record<string, unknown>;
}
