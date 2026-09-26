import { createPublicKey, verify as cryptoVerify } from 'crypto';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { Redis } from 'ioredis';

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { verifyApiPlanConfigs } from '@chain-verify/config';
import {
  buildEvidenceInputsFromPayloads,
  runProofProduct,
  type EvidenceInput,
  type ProofReport,
} from '@swarmsync/proof-core';
import type { Prisma } from '@prisma/client';
import {
  ProofFinalDecision,
  ProofProduct,
  ProofRiskLevel,
  ProofRunStatus,
  ProofSourceType,
  ProofSubject,
  SubscriptionStatus,
} from '@prisma/client';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { Public } from '../auth/decorators/public.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';

import { VerifyApiAuthGuard } from './verify-api-auth.guard.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { PrismaService } from '../database/prisma.service.js';

import { VerificationService } from './verification.service.js';
import {
  ProofService,
  computeContentHash,
  computeProofChainHash,
  isRetentionExpired,
  type ChainWalkResult,
} from './proof.service.js';
import { ProofBillingService } from '../billing/proof-billing.service.js';
import { ProofProductType } from '@prisma/client';
import { ProofClaimService } from './proof-claim.service.js';
import { AiAnalysisService, type AiIssue } from './ai-analysis.service.js';
import {
  assessSoftwareDeliveryReadiness,
  assessAuditProofReadiness,
  type ControlSkipped,
} from './evidence-readiness.js';
import { SoftwareDeliveryService } from './software-delivery/software-delivery.service.js';
import { SoftwareDeliveryVerifyDto } from './software-delivery/dto/software-delivery-verify.dto.js';
import {
  SOFTWARE_DELIVERY_USAGE_PRODUCT,
  VerifyApiUsageService,
} from './software-delivery/verify-api-usage.service.js';

// Allowed status values for pilot intake status updates.
const PILOT_INTAKE_ALLOWED_STATUSES = [
  'NEW',
  'CONTACTED',
  'CONVERTED',
  'REJECTED',
  'CLOSED',
] as const;
type PilotIntakeStatus = (typeof PILOT_INTAKE_ALLOWED_STATUSES)[number];

// Request body for POST /api/proof/pilot-intake (and its deprecated
// /api/proof/audit-intake alias) — lead-capture only, see recordPilotIntake.
interface PilotIntakeBody {
  product?: string;
  companyName?: string;
  workflowName?: string;
  contactEmail?: string;
  contactName?: string;
  agentCount?: string | number;
  invoiceCount?: string | number;
  notes?: string;
  sessionId?: string;
  stripeSessionId?: string;
  planSlug?: string;
  organizationId?: string;
  sourcePath?: string;
}

// Sentinel org for unauthenticated callers — mirrors verification.controller.ts
const ANONYMOUS_ORG_ID = 'anonymous';

// Per-IP demo quota — partitions the anonymous /api/verify/demo pool so a
// single bad actor cannot exhaust the global free-tier quota for every
// other prospect. Tracked in Redis (with in-process Map fallback when Redis
// is unavailable). Keyed by `demo:quota:<ip>:<YYYY-MM>` with a 31-day TTL
// so counters auto-expire without a sweep interval (M-8 fix).
const DEMO_PER_IP_MONTHLY_LIMIT = 50;
// Customer-facing URL surfaced in 429 demo-quota errors. Pulling from env when
// available so staging / preview builds can substitute a non-prod register URL
// without recompiling (HKO HK-4).
const DEMO_QUOTA_UPGRADE_URL =
  process.env.SWARMSYNC_REGISTER_URL ?? 'https://swarmsync.ai/register';

// In-process Map used as fallback when REDIS_URL is not configured.
const demoIpCounters = new Map<string, { count: number; periodKey: string }>();

function currentPeriodKey(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

// Hourly sweep removes stale period entries from the in-process fallback Map.
// Not needed when Redis is in use (TTL handles expiry), but kept so the Map
// doesn't grow unboundedly if Redis is unavailable. `.unref()` so this
// interval doesn't keep the Node process alive on shutdown.
const __demoIpSweep = setInterval(
  () => {
    const currentPeriod = currentPeriodKey();
    for (const [ip, entry] of demoIpCounters) {
      if (entry.periodKey !== currentPeriod) demoIpCounters.delete(ip);
    }
  },
  60 * 60 * 1000,
);
if (typeof __demoIpSweep.unref === 'function') __demoIpSweep.unref();

interface DemoRedisClient {
  get(key: string): Promise<string | null>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  pipeline(): DemoRedisPipeline;
  on(event: 'error', listener: (error: Error) => void): DemoRedisClient;
}

interface DemoRedisPipeline {
  incr(key: string): DemoRedisPipeline;
  expire(key: string, seconds: number): DemoRedisPipeline;
  exec(): Promise<Array<[Error | null, unknown]> | null>;
}

// Lazy Redis client for demo-quota persistence. Created on first use so the
// module can load in environments without REDIS_URL (tests, local dev without
// Redis) and falls back to the in-process Map automatically.
let _demoRedis: DemoRedisClient | null = null;
function getDemoRedis(): DemoRedisClient | null {
  if (_demoRedis) return _demoRedis;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    _demoRedis = new Redis(url, {
      lazyConnect: true,
      enableOfflineQueue: false,
      // Retry for up to ~30 s then stop so a transient Redis outage does not
      // stall the demo endpoint indefinitely — the in-process Map takes over.
      retryStrategy: (times: number) => (times < 6 ? Math.min(times * 500, 5000) : null),
    }) as DemoRedisClient;
    _demoRedis!.on('error', () => {
      /* swallow — fail-open to in-process Map */
    });
    return _demoRedis;
  } catch {
    return null;
  }
}

// Normalize an IP so the same client never gets bucketed under two keys
// (HKO HK-3). Strips IPv6 zone identifier (`fe80::1%eth0` → `fe80::1`) and
// the IPv4-in-IPv6 mapping prefix (`::ffff:127.0.0.1` → `127.0.0.1`).
function normalizeIp(raw: string): string {
  let ip = raw.trim();
  if (!ip) return 'unknown';
  // Strip surrounding brackets from "[::1]:65432"-style entries.
  if (ip.startsWith('[')) ip = ip.slice(1);
  const closeBracket = ip.indexOf(']');
  if (closeBracket !== -1) ip = ip.slice(0, closeBracket);
  // Drop port suffix on plain IPv4 (e.g. "1.2.3.4:5678"). IPv6 addresses
  // contain colons, so only treat a single trailing :port as a port.
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+$/.test(ip)) {
    ip = ip.split(':')[0];
  }
  // Strip IPv6 zone identifier.
  const zone = ip.indexOf('%');
  if (zone !== -1) ip = ip.slice(0, zone);
  // Unwrap IPv4-mapped IPv6 ("::ffff:1.2.3.4").
  const v4Mapped = ip.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
  if (v4Mapped) ip = v4Mapped[1];
  // Lowercase IPv6 for consistent hashing.
  if (ip.includes(':')) ip = ip.toLowerCase();
  return ip || 'unknown';
}

function clientIpFromRequest(req: Request | undefined | null): string {
  if (!req) return 'unknown';
  const fwd = req.headers?.['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) {
    // x-forwarded-for can be "client, proxy1, proxy2" — first entry is the client.
    return normalizeIp(fwd.split(',')[0]);
  }
  if (Array.isArray(fwd) && fwd.length > 0) {
    return normalizeIp(String(fwd[0]).split(',')[0]);
  }
  return normalizeIp(req.ip ?? 'unknown');
}

// Synchronous in-process Map accessors used as a fallback (and in tests).
function getDemoIpUsageInProcess(ip: string): { used: number; periodKey: string } {
  const periodKey = currentPeriodKey();
  const existing = demoIpCounters.get(ip);
  if (!existing || existing.periodKey !== periodKey) {
    return { used: 0, periodKey };
  }
  return { used: existing.count, periodKey };
}

function incrementDemoIpUsageInProcess(ip: string): { used: number; periodKey: string } {
  const periodKey = currentPeriodKey();
  const existing = demoIpCounters.get(ip);
  const next =
    !existing || existing.periodKey !== periodKey
      ? { count: 1, periodKey }
      : { count: existing.count + 1, periodKey };
  demoIpCounters.set(ip, next);
  return { used: next.count, periodKey };
}

// Async Redis-backed quota accessors. Fall through to the in-process Map when
// Redis is unavailable so the demo endpoint is never blocked by a Redis outage.
async function getDemoIpUsage(ip: string): Promise<{ used: number; periodKey: string }> {
  const periodKey = currentPeriodKey();
  const redis = getDemoRedis();
  if (redis) {
    try {
      const key = `demo:quota:${ip}:${periodKey}`;
      const val = await redis.get(key);
      return { used: val ? parseInt(val, 10) : 0, periodKey };
    } catch {
      /* fall through to in-process Map */
    }
  }
  return getDemoIpUsageInProcess(ip);
}

async function incrementDemoIpUsage(ip: string): Promise<{ used: number; periodKey: string }> {
  const periodKey = currentPeriodKey();
  const redis = getDemoRedis();
  if (redis) {
    try {
      const key = `demo:quota:${ip}:${periodKey}`;
      // INCR returns the new count atomically; set a 31-day TTL on first write.
      const pipe = redis.pipeline();
      pipe.incr(key);
      pipe.expire(key, 31 * 24 * 60 * 60);
      const results = await pipe.exec();
      const count = (results?.[0]?.[1] as number) ?? 1;
      return { used: count, periodKey };
    } catch {
      /* fall through to in-process Map */
    }
  }
  return incrementDemoIpUsageInProcess(ip);
}
const FIELD_RULES = new Set([
  'required_fields_present',
  'invoice_number_present',
  'vendor_name_present',
  'amount_total_present',
  'due_date_present',
  'missing_po_check',
  'duplicate_invoice_check',
  'agent_identity_present',
  'workflow_name_present',
  'task_description_present',
  'input_output_pair_present',
  'timestamp_integrity_check',
  'human_approval_check',
  'risk_level_check',
  'bank_detail_changes',
  'payment_term_changes',
  'vendor_name_mismatch',
  'invoice_amount_mismatch',
  'tax_fee_inconsistency',
  'line_item_math_error',
  'suspicious_vendor_change',
  'prior_invoice_comparison',
]);

type RuleIssue = {
  rule: string;
  severity: string;
  message: string;
  recommended_action?: string;
  evidenceRefs?: Array<Record<string, unknown>>;
  source_passage?: string;
};

// Map task string → ProofProduct + ProofSubject
function mapTaskToProduct(task: string | undefined): {
  product: ProofProduct;
  subject: ProofSubject;
} {
  switch (task) {
    case 'invoice_extraction':
      return { product: ProofProduct.INVOICE_AUDIT, subject: ProofSubject.INVOICE };
    case 'audit_proof':
    case 'agent_activity':
      return { product: ProofProduct.COMPLIANCE_SCAN, subject: ProofSubject.COMPLIANCE };
    case 'document':
      return { product: ProofProduct.DOCUMENT_VERIFY, subject: ProofSubject.DOCUMENT };
    case 'workflow_event':
      return { product: ProofProduct.COMPLIANCE_SCAN, subject: ProofSubject.COMPLIANCE };
    default:
      return { product: ProofProduct.INVOICE_AUDIT, subject: ProofSubject.INVOICE };
  }
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function paymentFingerprint(value: unknown): { routing?: string; accountLast4?: string } {
  const text = String(value ?? '');
  const routing = text.match(/routing\D*([0-9]{9})/i)?.[1] ?? text.match(/\b([0-9]{9})\b/)?.[1];
  const accountLast4 =
    text.match(/account\D*(?:x+)?([0-9]{4})/i)?.[1] ?? text.match(/acct\D*(?:x+)?([0-9]{4})/i)?.[1];
  return {
    ...(routing ? { routing } : {}),
    ...(accountLast4 ? { accountLast4 } : {}),
  };
}

function samePaymentDetails(a: unknown, b: unknown): boolean | null {
  const left = paymentFingerprint(a);
  const right = paymentFingerprint(b);
  const hasComparableRouting = left.routing && right.routing;
  const hasComparableAccount = left.accountLast4 && right.accountLast4;
  if (!hasComparableRouting && !hasComparableAccount) return null;
  return (
    (!hasComparableRouting || left.routing === right.routing) &&
    (!hasComparableAccount || left.accountLast4 === right.accountLast4)
  );
}

function parseLineItems(raw: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(raw))
    return raw.filter(
      (item): item is Record<string, unknown> => typeof item === 'object' && item !== null,
    );
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (item): item is Record<string, unknown> => typeof item === 'object' && item !== null,
      );
    }
  } catch {
    return [];
  }
  return [];
}

function evidenceObjects(evidence: unknown): Array<Record<string, unknown>> {
  const values = Array.isArray(evidence) ? evidence : evidence !== undefined ? [evidence] : [];
  return values.filter(
    (item): item is Record<string, unknown> => typeof item === 'object' && item !== null,
  );
}

function expectedFromEvidence(evidence: unknown, keys: string[]): unknown {
  for (const item of evidenceObjects(evidence)) {
    for (const key of keys) {
      if (item[key] !== undefined && item[key] !== null && item[key] !== '') return item[key];
    }
    const expected = item['expected'];
    if (typeof expected === 'object' && expected !== null) {
      for (const key of keys) {
        const value = (expected as Record<string, unknown>)[key];
        if (value !== undefined && value !== null && value !== '') return value;
      }
    }
  }

  // Fallback: also accept evidence supplied as plain strings such as
  // "invoice:INV-T007 expected total 38900". The QA harness and many
  // ad-hoc API callers send hints this way; without this fallback the
  // rule layer misses the mismatch and the AI prompt invents a generic
  // "amount is significantly larger than typical for this vendor"
  // explanation (Issue #7 in customer-flow-qa/master-issues.md).
  const evidenceItems = Array.isArray(evidence) ? evidence : evidence ? [evidence] : [];
  const stringEvidence = evidenceItems.filter((e): e is string => typeof e === 'string').join(' ');
  if (!stringEvidence) return undefined;

  const wantsTotal = keys.some((k) => /(total|amount|grand_total|invoice_total)/i.test(k));
  if (wantsTotal) {
    // Patterns: "expected total 38900", "expected total: $38,900", "total = 38900"
    const totalRe =
      /(?:expected\s+(?:total|amount)|total|amount)\s*[:=]?\s*\$?\s*([0-9][\d,]*(?:\.\d+)?)/i;
    const m = stringEvidence.match(totalRe);
    if (m) {
      const numeric = Number(m[1].replace(/,/g, ''));
      if (Number.isFinite(numeric)) return numeric;
    }
  }

  const wantsInvoiceNumber = keys.some((k) => /invoice_no|invoice_number|inv_number/i.test(k));
  if (wantsInvoiceNumber) {
    // Only extract an invoice number when the string evidence explicitly provides
    // an expected value (e.g. "expected invoice SMG-9000" or "invoice_number: SMG-9000").
    // A bare evidence reference like "invoice:INV-T001" is a record pointer, not a
    // value hint — matching it would compare the output invoice number against the
    // evidence record ID, producing a false "contradicts" issue.
    const invoiceRe =
      /(?:expected\s+invoice(?:\s+number)?|invoice_number\s*[:=])\s*([A-Z]{2,}[\w-]+)/i;
    const m = stringEvidence.match(invoiceRe);
    if (m) return m[1];
  }

  const wantsVendor = keys.some((k) => /vendor|supplier/i.test(k));
  if (wantsVendor) {
    const vendorRe = /(?:vendor|supplier)[:\s]+([^,;]+?)(?:\s+expected|$|[,;])/i;
    const m = stringEvidence.match(vendorRe);
    if (m) return m[1].trim();
  }

  return undefined;
}

function evaluateEvidenceConsistency(
  output: Record<string, unknown>,
  evidence: unknown,
): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const checks: Array<{
    rule: string;
    outputKeys: string[];
    evidenceKeys: string[];
    label: string;
  }> = [
    {
      rule: 'evidence_vendor_mismatch',
      outputKeys: ['vendor_name', 'vendor', 'supplier_name', 'supplier'],
      evidenceKeys: ['vendor_name', 'vendor', 'expected_vendor_name', 'vendor_master_name'],
      label: 'vendor name',
    },
    {
      rule: 'evidence_invoice_number_mismatch',
      outputKeys: ['invoice_number', 'invoice_no', 'inv_number'],
      evidenceKeys: ['invoice_number', 'invoice_no', 'expected_invoice_number'],
      label: 'invoice number',
    },
    {
      rule: 'evidence_total_mismatch',
      outputKeys: ['amount_total', 'total', 'invoice_total', 'grand_total'],
      evidenceKeys: ['amount_total', 'total', 'expected_total', 'invoice_total'],
      label: 'invoice total',
    },
    {
      rule: 'evidence_due_date_mismatch',
      outputKeys: ['due_date', 'payment_due', 'due_by'],
      evidenceKeys: ['due_date', 'expected_due_date', 'payment_due'],
      label: 'due date',
    },
  ];

  for (const check of checks) {
    const actual = check.outputKeys
      .map((key) => output[key])
      .find((value) => value !== undefined && value !== null && value !== '');
    const expected = expectedFromEvidence(evidence, check.evidenceKeys);
    if (actual === undefined || expected === undefined) continue;

    const actualNumber = asNumber(actual);
    const expectedNumber = asNumber(expected);
    const matches =
      actualNumber !== null && expectedNumber !== null
        ? Math.abs(actualNumber - expectedNumber) < 0.01
        : normalizeText(actual) === normalizeText(expected);

    if (!matches) {
      // Use the specific submitted-vs-evidence values when both are numeric
      // (e.g. invoice total) so the reasoning text cites the conflict
      // directly instead of falling through to a vague "outlier" narrative.
      let message: string;
      if (
        check.rule === 'evidence_total_mismatch' &&
        actualNumber !== null &&
        expectedNumber !== null
      ) {
        const fmt = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
        message = `AMOUNT_MISMATCH — stated total ${fmt(actualNumber)} does not match evidence total ${fmt(expectedNumber)}.`;
      } else if (actualNumber !== null && expectedNumber !== null) {
        message = `Submitted ${check.label} (${actualNumber}) does not match evidence value (${expectedNumber}).`;
      } else {
        message = `Submitted ${check.label} "${String(actual)}" contradicts evidence value "${String(expected)}".`;
      }
      issues.push({
        rule: check.rule,
        severity: 'critical',
        message,
      });
    }
  }

  return issues;
}

function firstEvidenceValue(records: Array<Record<string, unknown>>, keys: string[]): unknown {
  for (const record of records) {
    for (const key of keys) {
      const value = record[key];
      if (value !== undefined && value !== null && value !== '') return value;
    }
    for (const nestedKey of [
      'expected',
      'approved',
      'contract',
      'required',
      'actual',
      'delivered',
    ]) {
      const nested = record[nestedKey];
      if (typeof nested !== 'object' || nested === null) continue;
      for (const key of keys) {
        const value = (nested as Record<string, unknown>)[key];
        if (value !== undefined && value !== null && value !== '') return value;
      }
    }
  }
  return undefined;
}

function evidenceRecords(
  output: Record<string, unknown>,
  evidence?: unknown,
): Array<Record<string, unknown>> {
  return [output, ...evidenceObjects(evidence)];
}

function normalizeDomain(value: unknown): string {
  const text = String(value ?? '')
    .trim()
    .toLowerCase();
  const domain =
    text.match(
      /[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+/i,
    )?.[0] ?? text;
  return domain.replace(/^www\./, '');
}

function parseDomainFromText(blob: string, labels: string[]): string | undefined {
  const labelPattern = labels
    .map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  const match = blob.match(
    new RegExp(`(?:${labelPattern})\\s*[:=]?\\s*([a-z0-9.-]+\\.[a-z]{2,})`, 'i'),
  );
  return match ? normalizeDomain(match[1]) : undefined;
}

function normalizeVersion(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/^api\s+version\s*/, '')
    .replace(/^v/, '')
    .trim();
}

function normalizeDeploymentTarget(value: unknown): string {
  const text = String(value ?? '').toLowerCase();
  if (/\b(?:pre|non)[-\s]?prod(?:uction)?\b/.test(text)) return 'preproduction';
  if (/\bprod(?:uction)?\b/.test(text)) return 'production';
  if (/\bstag(?:e|ing)?\b/.test(text)) return 'staging';
  return text.trim();
}

function normalizeAuthMethod(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/oauth\s*2/g, 'oauth2')
    .replace(/[^a-z0-9]+/g, '');
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => stringList(item));
  if (typeof value === 'string')
    return value
      .split(/[,;|]/)
      .map((item) => item.trim())
      .filter(Boolean);
  if (value === undefined || value === null || value === false) return [];
  return [String(value)];
}

function booleanFlag(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (/^(true|yes|y|1|fail|failed|missing|incomplete|non[-_\s]?compliant)$/i.test(value.trim()))
      return true;
    if (/^(false|no|n|0|pass|passed|complete|compliant)$/i.test(value.trim())) return false;
  }
  return null;
}

function evaluateInvoiceEvidence(output: Record<string, unknown>, evidence: unknown): RuleIssue[] {
  const taskBlob = collectStringValues([output, evidence]).join('\n');
  const records = evidenceRecords(output, evidence);
  const evidenceOnly = evidenceObjects(evidence);
  const issues: RuleIssue[] = [];

  const push = (rule: string, severity: RuleIssue['severity'], message: string) => {
    if (!issues.some((issue) => issue.rule === rule)) {
      issues.push({ rule, severity, message });
    }
  };

  const invoiceNo = String(output['invoice_number'] ?? output['invoice_no'] ?? '');
  const amount = asNumber(output['amount_total'] ?? output['total'] ?? output['invoice_total']);
  const priorInvoiceNo =
    firstEvidenceValue(evidenceOnly, [
      'prior_invoice_number',
      'paid_invoice_number',
      'previous_invoice_number',
      'duplicate_invoice_number',
    ]) ??
    taskBlob.match(
      /(?:prior|previous|paid|payment register)[\s\S]{0,80}invoice\s+([A-Z0-9][\w-]+)/i,
    )?.[1];
  const priorAmountRaw =
    firstEvidenceValue(evidenceOnly, [
      'prior_amount',
      'paid_amount',
      'previous_amount_total',
      'duplicate_amount',
      'registered_amount',
    ]) ??
    taskBlob.match(
      /(?:prior|previous|paid|payment register)[\s\S]{0,120}amount\s+\$?\s*([0-9][\d,]*(?:\.\d+)?)/i,
    )?.[1];
  const priorAmount =
    typeof priorAmountRaw === 'string'
      ? Number(priorAmountRaw.replace(/,/g, ''))
      : asNumber(priorAmountRaw);
  const duplicateStatus = String(
    firstEvidenceValue(evidenceOnly, [
      'duplicate_status',
      'payment_register_status',
      'invoice_status',
    ]) ?? '',
  ).toUpperCase();
  const priorInvoiceMatch =
    Boolean(
      invoiceNo && priorInvoiceNo && normalizeText(invoiceNo) === normalizeText(priorInvoiceNo),
    ) ||
    Boolean(
      invoiceNo &&
      new RegExp(
        `(?:prior|previous|paid|payment register)[\\s\\S]{0,120}${invoiceNo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
        'i',
      ).test(taskBlob),
    );
  const alreadyPaid =
    /PAID|DUPLICATE/.test(duplicateStatus) ||
    /already paid|paid\s+20\d{2}|prior-payment-register|payment register/i.test(taskBlob);
  if (
    priorInvoiceMatch &&
    alreadyPaid &&
    amount !== null &&
    priorAmount !== null &&
    Math.abs(priorAmount - amount) < 0.01
  ) {
    push(
      'duplicate_invoice_check',
      'critical',
      `EXACT_DUPLICATE — invoice ${invoiceNo || 'number'} matches a prior paid invoice in the submitted payment register evidence.`,
    );
  }
  if (
    priorInvoiceMatch &&
    alreadyPaid &&
    priorAmount !== null &&
    amount !== null &&
    Math.abs(priorAmount - amount) >= 0.01
  ) {
    push(
      'modified_duplicate_invoice',
      'critical',
      `MODIFIED_DUPLICATE — invoice ${invoiceNo || 'number'} matches prior payment evidence but the amount changed.`,
    );
  }

  const senderDomain =
    normalizeDomain(
      firstEvidenceValue(records, [
        'sender_domain',
        'from_domain',
        'submitted_domain',
        'email_domain',
        'sender_email',
      ]),
    ) ||
    parseDomainFromText(taskBlob, ['sender_domain', 'sender domain', 'from_domain', 'from domain']);
  const approvedDomain =
    normalizeDomain(
      firstEvidenceValue(records, [
        'approved_domain',
        'expected_domain',
        'vendor_master_domain',
        'vendor_domain',
      ]),
    ) ||
    parseDomainFromText(taskBlob, [
      'approved_domain',
      'approved domain',
      'expected_domain',
      'expected domain',
    ]);
  if (senderDomain && approvedDomain && senderDomain !== approvedDomain) {
    push(
      'lookalike_domain_vendor',
      'critical',
      'LOOKALIKE_DOMAIN_VENDOR — sender/domain evidence does not match the approved vendor domain.',
    );
  }

  const approvalLimit = asNumber(
    firstEvidenceValue(records, [
      'approval_limit',
      'approver_limit',
      'authorized_limit',
      'approval_matrix_limit',
    ]),
  );
  const approvalAuthorized = booleanFlag(
    firstEvidenceValue(records, [
      'approver_authorized',
      'approval_authorized',
      'approval_matrix_passed',
    ]),
  );
  const approvalStatus = String(
    firstEvidenceValue(records, ['approval_status', 'approval_matrix_status']) ?? '',
  );
  if (
    (approvalLimit !== null && amount !== null && amount > approvalLimit) ||
    approvalAuthorized === false ||
    /mismatch|unauthorized|violation|failed/i.test(approvalStatus)
  ) {
    push(
      'approval_authority_mismatch',
      'high',
      'APPROVAL_AUTHORITY_MISMATCH — approver is not authorized for the invoice amount under the approval matrix.',
    );
  }

  const invoiceQuantity = asNumber(
    firstEvidenceValue(records, [
      'invoice_quantity',
      'billed_quantity',
      'quantity_billed',
      'delivered_quantity',
    ]),
  );
  const poQuantity = asNumber(
    firstEvidenceValue(records, [
      'po_quantity',
      'approved_quantity',
      'ordered_quantity',
      'purchase_order_quantity',
    ]),
  );
  const textQuantity = taskBlob.match(
    /(?:invoice|billed|delivered|quantity|qty)\s*(?:quantity|qty)?\s*[:=]?\s*([0-9]+(?:\.\d+)?)[\s\S]{0,40}(?:po|approved|ordered)\s*(?:quantity|qty)?\s*[:=]?\s*([0-9]+(?:\.\d+)?)/i,
  );
  const actualQty = invoiceQuantity ?? (textQuantity ? Number(textQuantity[1]) : null);
  const approvedQty = poQuantity ?? (textQuantity ? Number(textQuantity[2]) : null);
  if (actualQty !== null && approvedQty !== null && actualQty > approvedQty) {
    push(
      'po_quantity_exceeded',
      'high',
      'PO_AMOUNT_EXCEEDED — billed quantity or amount exceeds the purchase-order authorization.',
    );
  }

  if (/round-dollar|round dollar|vague service|vague advisory/i.test(taskBlob)) {
    push(
      'round_dollar_vague_service',
      'warning',
      'ROUND_DOLLAR_AMOUNT — round-dollar vague-service invoice requires review against a specific PO or contract.',
    );
  }

  const vendorStatus = String(
    firstEvidenceValue(records, ['vendor_status', 'vendor_master_status']) ?? '',
  );
  const complianceStatus = String(
    firstEvidenceValue(records, ['compliance_status', 'vendor_compliance_status']) ?? '',
  );
  const missingDocs = stringList(
    firstEvidenceValue(records, [
      'missing_compliance_docs',
      'compliance_docs_missing',
      'missing_docs',
      'missing_required_docs',
    ]),
  );
  if (
    /new|pending|unapproved|inactive|blocked/i.test(vendorStatus) ||
    /missing|non[-_\s]?compliant|incomplete|expired|failed/i.test(complianceStatus) ||
    missingDocs.length > 0 ||
    /new vendor|new_pending|missing compliance/i.test(taskBlob)
  ) {
    push(
      'vendor_compliance_missing',
      'high',
      'NEW_VENDOR_COMPLIANCE_MISSING — new vendor lacks required insurance/W-9 compliance evidence.',
    );
  }

  const remitAddress = firstEvidenceValue(records, [
    'remit_address',
    'remittance_address',
    'vendor_address',
  ]);
  const approvedAddress = firstEvidenceValue(records, [
    'approved_remit_address',
    'approved_address',
    'vendor_master_address',
  ]);
  const addressChangedFlag = booleanFlag(
    firstEvidenceValue(records, ['address_changed', 'remit_address_changed', 'remittance_changed']),
  );
  const addressChanged =
    addressChangedFlag === true ||
    (remitAddress !== undefined &&
      approvedAddress !== undefined &&
      normalizeText(remitAddress) !== normalizeText(approvedAddress)) ||
    /address change|vendor address mismatch|remit.*changed/i.test(taskBlob);
  const urgentPayment =
    booleanFlag(firstEvidenceValue(records, ['urgent_payment', 'urgent_payment_requested'])) ===
      true || /urgent payment|wire today|immediate payment/i.test(taskBlob);
  if (addressChanged) {
    push(
      'vendor_address_mismatch',
      'critical',
      'VENDOR_ADDRESS_MISMATCH — remittance/address evidence differs from the approved vendor master.',
    );
  }
  if (addressChanged && urgentPayment) {
    push(
      'urgency_pressure',
      'critical',
      'URGENCY_PRESSURE — urgent payment language combined with changed remittance details is a BEC red flag.',
    );
  }

  return issues;
}

function evaluateSoftwareDeliveryDocuments(output: Record<string, unknown>): RuleIssue[] {
  const blob = collectStringValues(output).join('\n');
  const normalized = blob.toLowerCase();
  const records = evidenceObjects(output);
  const issues: RuleIssue[] = [];
  const sourcePassageFor = (rule: string): string => {
    if (rule === 'staging_not_production') {
      const required = firstEvidenceValue(records, [
        'required_deployment_target',
        'expected_deployment_target',
        'contract_deployment_target',
      ]);
      const delivered = firstEvidenceValue(records, [
        'deployment_target',
        'delivered_deployment_target',
        'target_environment',
      ]);
      if (required || delivered) {
        return `required_deployment_target: ${String(required ?? 'unknown')}; deployment_target: ${String(delivered ?? 'unknown')}`;
      }
    }
    const termsByRule: Record<string, RegExp> = {
      staging_not_production: /staging|uat|pre-?production|target environment|deployment target/i,
      sync_direction_mismatch: /one[-\s]?way|unidirectional|bidirectional|sync/i,
      version_mismatch: /version|api/i,
      unauthorized_auth_scope_change: /auth|oauth|api key|without approval/i,
      fleet_hold_missing: /hold/i,
      audit_trail_missing: /audit trail|audit log/i,
      open_p2_defect: /open|defect|p2|critical|high/i,
      rollback_missing: /rollback/i,
      full_payment_incomplete_delivery: /payment|incomplete|partial/i,
      insufficient_delivery_evidence: /delivery|requirement|evidence/i,
    };
    const matcher = termsByRule[rule] ?? /./;
    const line = blob
      .split(/\r?\n/)
      .map((part) => part.trim())
      .find((part) => part.length > 0 && matcher.test(part));
    return (line || blob).replace(/\s+/g, ' ').trim().slice(0, 300);
  };
  const push = (rule: string, message: string) => {
    if (!issues.some((issue) => issue.rule === rule)) {
      const source_passage = sourcePassageFor(rule);
      issues.push({
        rule,
        severity: 'critical',
        message,
        source_passage,
        evidenceRefs: [
          {
            documentId: 'submitted_output',
            documentType: 'software_delivery',
            sourcePassage: source_passage,
          },
        ],
      });
    }
  };

  const requiredTarget = normalizeDeploymentTarget(
    firstEvidenceValue(records, [
      'required_deployment_target',
      'expected_deployment_target',
      'contract_deployment_target',
    ]),
  );
  const deliveredTarget = normalizeDeploymentTarget(
    firstEvidenceValue(records, [
      'deployment_target',
      'delivered_deployment_target',
      'target_environment',
    ]),
  );
  const stagingAsProduction =
    requiredTarget === 'production' && deliveredTarget && deliveredTarget !== 'production';
  if (stagingAsProduction) {
    push(
      'staging_not_production',
      'STAGING_NOT_PRODUCTION — delivery evidence presents staging/pre-production as the accepted production deployment.',
    );
  }

  const requiredSync = String(
    firstEvidenceValue(records, [
      'required_sync_direction',
      'expected_sync_direction',
      'contract_sync_direction',
    ]) ?? '',
  ).toLowerCase();
  const deliveredSync = String(
    firstEvidenceValue(records, [
      'sync_direction',
      'delivered_sync_direction',
      'actual_sync_direction',
    ]) ?? '',
  ).toLowerCase();
  if (
    (/bidirectional|two[-\s]?way|both directions/.test(requiredSync) &&
      /one[-\s]?way|unidirectional|single direction/.test(deliveredSync)) ||
    /one[-\s]?way|unidirectional|one\s+direction\s+only/i.test(blob)
  ) {
    push(
      'sync_direction_mismatch',
      'SYNC_DIRECTION_MISMATCH — contract requires bidirectional dispatch sync but delivery confirms only one direction.',
    );
  }

  const requiredVersion = normalizeVersion(
    firstEvidenceValue(records, [
      'required_api_version',
      'contract_api_version',
      'expected_api_version',
    ]),
  );
  const deliveredVersion = normalizeVersion(
    firstEvidenceValue(records, ['delivered_api_version', 'api_version', 'actual_api_version']),
  );
  if (
    (requiredVersion && deliveredVersion && requiredVersion !== deliveredVersion) ||
    /wrong\s+api\s+version|version mismatch/i.test(blob)
  ) {
    push(
      'version_mismatch',
      'VERSION_MISMATCH — delivered API version does not match the contracted version.',
    );
  }

  const approvedAuth = normalizeAuthMethod(
    firstEvidenceValue(records, [
      'approved_auth_method',
      'required_auth_method',
      'contract_auth_method',
    ]),
  );
  const deliveredAuth = normalizeAuthMethod(
    firstEvidenceValue(records, ['delivered_auth_method', 'auth_method', 'authentication_method']),
  );
  const authChangeApproved =
    booleanFlag(
      firstEvidenceValue(records, ['auth_change_approved', 'auth_scope_change_approved']),
    ) ?? false;
  if (
    (approvedAuth && deliveredAuth && approvedAuth !== deliveredAuth && !authChangeApproved) ||
    /auth(?:entication)?\s+method\s+changed|without approval|unauthorized auth/i.test(blob)
  ) {
    push(
      'unauthorized_auth_scope_change',
      'UNAUTHORIZED_AUTH_SCOPE_CHANGE — authentication method changed without approval.',
    );
  }

  const requirements = [
    ...stringList(
      firstEvidenceValue(records, [
        'missing_requirements',
        'failed_requirements',
        'incomplete_requirements',
      ]),
    ),
    ...records
      .flatMap((record) => (Array.isArray(record['requirements']) ? record['requirements'] : []))
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      .filter((item) =>
        /fail|missing|not implemented|incomplete/i.test(
          String(item['status'] ?? item['result'] ?? item['state'] ?? ''),
        ),
      )
      .map((item) => String(item['name'] ?? item['requirement'] ?? item['description'] ?? '')),
  ];
  if (
    requirements.some((requirement) =>
      /hold flag|maintenance hold|hold requirement/i.test(requirement),
    ) ||
    /hold flag.*not implemented|missing.*hold flag/i.test(blob)
  ) {
    push(
      'fleet_hold_missing',
      'FLEET_HOLD_MISSING — fleet maintenance hold flag requirement is not implemented.',
    );
  }

  if (
    requirements.some((requirement) => /audit trail|audit log|audit history/i.test(requirement)) ||
    /audit trail.*missing|audit trail.*not implemented|no audit trail/i.test(blob)
  ) {
    push('audit_trail_missing', 'AUDIT_TRAIL_MISSING — delivery lacks the required audit trail.');
  }

  const explicitNoOpenDefects =
    /(?:0|zero)\s+open\s+(?:p2|critical|high)\s+defects|open defect threshold.*(?:met|passed)/i.test(
      blob,
    );
  const openDefectCount = asNumber(
    firstEvidenceValue(records, ['open_defect_count', 'open_defects_count']),
  );
  const openDefectSeverity = String(
    firstEvidenceValue(records, ['open_defect_severity', 'highest_open_defect_severity']) ?? '',
  );
  const openDefects = records
    .flatMap((record) => (Array.isArray(record['open_defects']) ? record['open_defects'] : []))
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null);
  const hasHighOpenDefect =
    (openDefectCount !== null &&
      openDefectCount > 0 &&
      /p[012]|critical|high|sev[ -]?1|sev[ -]?2/i.test(openDefectSeverity)) ||
    openDefects.some((defect) => {
      const status = String(defect['status'] ?? defect['state'] ?? 'open');
      const severity = String(defect['severity'] ?? defect['priority'] ?? '');
      return (
        /open|active|unresolved/i.test(status) &&
        /p[012]|critical|high|sev[ -]?1|sev[ -]?2/i.test(severity)
      );
    });
  const mentionsNegatedOpenDefects =
    /\b(?:no|zero|0)\s+open\s+(?:p[01]?[0-9]|critical|high)\b/i.test(blob) ||
    /\bopen\s+defect\s+threshold\s+.*(?:met|passed)/i.test(blob);
  if (
    hasHighOpenDefect ||
    (!mentionsNegatedOpenDefects &&
      /(?<!zero\s)(?<!0\s)(?<!no\s)open\s+(?:p[012]|critical|high)\b|open defect/i.test(blob) &&
      !explicitNoOpenDefects)
  ) {
    push(
      'open_p2_defect',
      'OPEN_P2_DEFECT — open P2 financial/logistics defect remains at sign-off.',
    );
  }

  const rollbackProvided = booleanFlag(
    firstEvidenceValue(records, [
      'rollback_plan_provided',
      'rollback_plan_present',
      'rollback_available',
    ]),
  );
  const rollbackPlanText = String(
    firstEvidenceValue(records, ['rollback_plan', 'rollbackPlan', 'rollback_procedure']) ?? '',
  );
  const rollbackPlanMissing =
    /\b(not\s+(?:provided|included|present|available|defined|ready|tested)|missing|unavailable|none|no)\b/i.test(
      rollbackPlanText,
    );
  const rollbackPlanPresent =
    rollbackProvided === true ||
    (!rollbackPlanMissing &&
      /\b(included|provided|available|tested|ready|defined|present|complete|yes|true|passed)\b/i.test(
        rollbackPlanText,
      ));
  if (
    !rollbackPlanPresent &&
    (rollbackProvided === false ||
      /rollback plan.*missing|no rollback plan|rollback.*not provided/i.test(blob))
  ) {
    push('rollback_missing', 'ROLLBACK_MISSING — rollback plan is missing from delivery evidence.');
  }

  if (
    (booleanFlag(
      firstEvidenceValue(records, ['full_payment_requested', 'payment_in_full_requested']),
    ) === true ||
      /full payment requested|request(?:s|ed|ing)? full payment|pay(?:ment)?\s+in full/i.test(
        blob,
      )) &&
    issues.length > 0
  ) {
    push(
      'full_payment_incomplete_delivery',
      'FULL_PAYMENT_INCOMPLETE_DELIVERY — vendor requests full payment despite incomplete or failed delivery evidence.',
    );
  }

  const cleanSignals = [
    /production deployment (?:complete|successful|confirmed)/i,
    /bidirectional|two[-\s]?way sync|sync in both directions/i,
    /api version\s*(?:v?2\.1|2\.1)/i,
    /oauth\s*2|oauth2/i,
    /fleet maintenance hold flag.*(?:implemented|delivered|passed)/i,
    /audit trail.*(?:implemented|delivered|passed)/i,
    /rollback plan.*(?:included|provided|tested|ready)/i,
    /(?:0|zero)\s+open\s+(?:p2|critical|high)\s+defects|open defect threshold.*(?:met|passed)/i,
  ];
  const hasCleanDeliveryShape = cleanSignals.filter((re) => re.test(blob)).length >= 5;
  const hasPassingRequirements =
    records
      .flatMap((record) => (Array.isArray(record['requirements']) ? record['requirements'] : []))
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      .filter((item) =>
        /pass|complete|implemented|delivered/i.test(
          String(item['status'] ?? item['result'] ?? item['state'] ?? ''),
        ),
      ).length >= 2;
  const hasStructuredCleanDelivery =
    requiredTarget === 'production' &&
    deliveredTarget === 'production' &&
    /bidirectional|two[-\s]?way|both directions/.test(requiredSync) &&
    /bidirectional|two[-\s]?way|both directions/.test(deliveredSync) &&
    Boolean(requiredVersion && deliveredVersion && requiredVersion === deliveredVersion) &&
    Boolean(approvedAuth && deliveredAuth && approvedAuth === deliveredAuth) &&
    rollbackPlanPresent &&
    (openDefectCount === 0 || explicitNoOpenDefects) &&
    hasPassingRequirements;
  const containsKnownBadLanguage =
    /not implemented|missing|failed|staging|one[-\s]?way|wrong\s+api|without approval/i.test(
      normalized,
    ) ||
    (/open\s+p2/i.test(normalized) && !explicitNoOpenDefects);

  if (
    issues.length === 0 &&
    !hasCleanDeliveryShape &&
    !hasStructuredCleanDelivery &&
    !containsKnownBadLanguage
  ) {
    issues.push({
      rule: 'insufficient_delivery_evidence',
      severity: 'warning',
      message:
        'INSUFFICIENT_DELIVERY_EVIDENCE — delivery documents do not show enough requirement-level pass evidence to approve.',
    });
  }

  return issues;
}

// Keys that legitimately hold contact/identifier data — skipped by the PII
// scanner so vendor master records (vendor_email, invoice_number etc.) don't
// trigger false-positive PII findings. Bughound pass-2 fix B1: previously the
// scanner traversed every string in `output`, which flagged Harper Lane
// invoice fixtures with vendor contact fields as critical PII leaks.
const PII_WHITELIST_KEYS = new Set([
  'vendor_email',
  'vendor_phone',
  'vendor_contact',
  'supplier_email',
  'supplier_phone',
  'contact_email',
  'contact_phone',
  'email',
  'phone',
  'phone_number',
  'invoice_number',
  'invoice_no',
  'inv_number',
  'po_number',
  'purchase_order_number',
  'tax_id',
  'ein',
  'vat_id',
  'reference',
  'reference_number',
]);

// Collect every string value reachable from a JSON-ish blob — used by the
// automatic PII + hallucinated-citation safety scans so we don't miss
// content nested inside `output.summary`, `output.content`, etc. When
// `excludedKeys` is provided, values stored directly under those keys are
// skipped (used by the PII scanner to whitelist vendor contact fields).
function collectStringValues(
  value: unknown,
  bucket: string[] = [],
  depth = 0,
  excludedKeys?: Set<string>,
): string[] {
  if (depth > 6) return bucket;
  if (typeof value === 'string') {
    if (value.trim()) bucket.push(value);
    return bucket;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStringValues(item, bucket, depth + 1, excludedKeys);
    return bucket;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (excludedKeys && excludedKeys.has(k)) continue;
      collectStringValues(v, bucket, depth + 1, excludedKeys);
    }
  }
  return bucket;
}

function buildProofCoreEvidenceInputs(
  output: unknown,
  evidence: unknown,
  sourceProduct: EvidenceInput['sourceProduct'],
): EvidenceInput[] {
  return buildEvidenceInputsFromPayloads({ output, evidence, sourceProduct });
}

function proofReportToRuleIssues(report: ProofReport, prefix: string): RuleIssue[] {
  return report.findings.map((finding) => ({
    rule: `${prefix}:${finding.controlId}`,
    severity:
      finding.severity === 'critical' || finding.severity === 'high' ? 'critical' : 'warning',
    message: `${finding.controlId} — ${finding.message}`,
    recommended_action: finding.recommendedAction,
    evidenceRefs: finding.evidenceRefs as unknown as Array<Record<string, unknown>>,
    source_passage: finding.evidenceRefs.find((ref) => ref.sourcePassage)?.sourcePassage,
  })) as RuleIssue[];
}

function proofReportSkippedControls(report: ProofReport): ControlSkipped[] {
  return report.controls.skipped.map((controlId) => ({
    controlId,
    reason:
      'needs_more_evidence: deterministic proof control skipped because required evidence was absent',
  }));
}

function proofReportControls(report: ProofReport) {
  return {
    passed: report.controls.passed,
    failed: report.controls.failed,
    skipped: report.controls.skipped,
    coverage_summary: report.coverage_summary,
  };
}

// PII detector — fires when the output contains email/phone/SSN patterns
// outside of legitimate identifier fields (vendor_email, invoice_number…)
// and without an explicit `policy_allows_pii` flag. Marketed as a headline
// verification use case (privacy compliance), so the check runs automatically.
//
// business_document_mode (PRB-PII-FP): when `output.business_document_mode`
// is true, the detector switches to B2B-safe mode. Vendor phone numbers,
// vendor emails, and business addresses are expected in B2B invoices and are
// NOT blocked. Only genuinely sensitive data (SSNs, credit card numbers, bank
// account numbers, passwords, API keys) is flagged in this mode.
//
// Allowed in business_document_mode:
//   vendor phone numbers, vendor/AP email addresses, business addresses,
//   invoice contacts, AP workflow inboxes, public business identifiers (EIN/VAT),
//   company emails on B2B documents.
//
// Always blocked (both modes):
//   SSNs (###-##-####), 16-digit credit card numbers, passwords, API keys,
//   personal medical / HR data identifiers.
function detectPiiLeak(output: unknown): RuleIssue[] {
  const outputObj =
    typeof output === 'object' && output !== null ? (output as Record<string, unknown>) : null;
  if (outputObj && outputObj['policy_allows_pii'] === true) {
    return [];
  }

  const businessDocMode = outputObj && outputObj['business_document_mode'] === true;

  // Whitelist legitimate identifier/contact fields so vendor master records
  // and invoice numbers don't fire as PII leaks (Bughound B1).
  const strings = collectStringValues(output, [], 0, PII_WHITELIST_KEYS);
  if (strings.length === 0) return [];
  const joined = strings.join('\n');

  const findings: string[] = [];

  // SSN: 3-2-4 digit pattern, but require a non-digit (and non-hyphen) prefix
  // and suffix so invoice numbers like `INV-123-45-6789` don't false-positive.
  const ssnRe = /(?:^|[^\d-])(\d{3}-\d{2}-\d{4})(?=$|[^\d-])/g;
  // Credit card: 16-digit groups (####-####-####-#### or 16 consecutive digits).
  // Only fires on patterns that look like payment card numbers, not EINs/phone.
  const ccRe = /\b(?:\d{4}[\s-]){3}\d{4}\b|\b\d{16}\b/g;

  ssnRe.lastIndex = 0;
  if (ssnRe.test(joined)) findings.push('SSN-shaped identifier');
  ccRe.lastIndex = 0;
  if (ccRe.test(joined)) findings.push('credit card number');

  if (!businessDocMode) {
    // In standard (consumer-document) mode also flag loose email addresses and
    // phone numbers that appear outside whitelisted vendor-contact keys.
    const emailRe = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
    // Phone: matches 555-0199, (555) 555-0199, +1 555-555-0199, etc.
    // Requires at least one separator to avoid catching invoice numbers.
    const phoneRe = /(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}\b/g;

    if (emailRe.test(joined)) findings.push('email address');
    phoneRe.lastIndex = 0;
    if (phoneRe.test(joined)) findings.push('phone number');
  }

  if (findings.length === 0) return [];
  return [
    {
      rule: 'pii_leak_detected',
      severity: 'critical',
      message: `PII_LEAK_DETECTED — output contains ${findings.join(', ')} without an explicit policy_allows_pii flag.`,
    },
  ];
}

// Hallucinated-citation detector — fires when the output cites a section
// (e.g. "section 12.12.12", "Article 4.2.7", "policy §3.1") that does not
// appear in the supplied evidence array. Bughound pass-2 fixes (B2):
// (1) prefix accepts `§` after whitespace/punctuation (was \b, which fails for
//     non-word chars), (2) trailing dotted segments are optional so
//     "Section 4" still extracts, (3) evidence match uses a word-boundary
//     regex so "1.2" no longer substring-matches "1.22".
function detectHallucinatedCitations(output: unknown, evidence: unknown): RuleIssue[] {
  const outputStrings = collectStringValues(output);
  if (outputStrings.length === 0) return [];
  const outputBlob = outputStrings.join('\n');

  const citationRe =
    /(?:^|[\s,;(])(?:section|sec\.?|§|article|clause|policy\s+section)\s*([0-9]+(?:\.[0-9]+)*)\b/gi;
  const cited: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = citationRe.exec(outputBlob)) !== null) {
    cited.push(match[1]);
  }
  if (cited.length === 0) return [];

  // Also accept evidence supplied as plain strings ("privacy_policy_no_tenant_pii"
  // hints) — those have no section numbers, so any citation against them is
  // automatically unverified.
  const evidenceItems = Array.isArray(evidence) ? evidence : evidence ? [evidence] : [];
  const evidenceBlob = collectStringValues(evidenceItems).join('\n');

  // Escape regex special characters so a citation like "12.5" can be searched
  // for as a literal — and the surrounding non-digit boundary guards against
  // "1.2" matching inside "1.22".
  const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const issues: RuleIssue[] = [];
  const seen = new Set<string>();
  for (const ref of cited) {
    if (seen.has(ref)) continue;
    seen.add(ref);
    const boundaryRe = new RegExp(`(?:^|[^\\d.])${escapeRe(ref)}(?=$|[^\\d.])`);
    if (!boundaryRe.test(evidenceBlob)) {
      issues.push({
        rule: 'hallucinated_citation',
        severity: 'critical',
        message: `HALLUCINATED_CITATION — cited section "${ref}" is not present in the supplied evidence.`,
      });
    }
  }
  return issues;
}

// Only export internal rule-evaluation hooks outside production so they are
// available in Jest/Vitest test runs (NODE_ENV=test) and local development
// without leaking evaluation logic through the production module graph (M-4).
// The demo-quota helpers exposed here are the synchronous in-process variants
// so tests remain synchronous and never require a live Redis connection.
export const verifyApiRuleTestHooks =
  process.env.NODE_ENV === 'production'
    ? undefined
    : {
        detectPiiLeak,
        detectHallucinatedCitations,
        evaluateEvidenceConsistency,
        evaluateInvoiceEvidence,
        evaluateSoftwareDeliveryDocuments,
        evaluateStringRule,
        samePaymentDetails,
        detectCriticalBankChange,
        normalizeAiIssueSeverityForTask,
        getDemoIpUsage: getDemoIpUsageInProcess,
        incrementDemoIpUsage: incrementDemoIpUsageInProcess,
        demoIpCounters,
        buildSoftwareDeliveryValidationError,
      };

// Evaluate a named string rule against the submitted output object.
// Returns an issue object if the rule fires, null if the check passes.
function isInvoiceExtractionTask(task: string | undefined): boolean {
  const t = String(task ?? '').toLowerCase();
  return t === 'invoice_extraction' || t.includes('invoice');
}

function evaluateStringRule(
  rule: string,
  output: Record<string, unknown>,
  evidence?: unknown,
  task?: string,
): RuleIssue | null {
  switch (rule) {
    // Generic: at least one field must be present
    case 'required_fields_present': {
      if (Object.keys(output).length === 0) {
        return { rule, severity: 'warning', message: 'Output has no fields — nothing to verify.' };
      }
      return null;
    }

    // Invoice-specific field presence checks
    case 'invoice_number_present':
    case 'vendor_name_present':
    case 'amount_total_present':
    case 'due_date_present': {
      const fieldMap: Record<string, string[]> = {
        invoice_number_present: ['invoice_number', 'invoice_no', 'inv_number'],
        vendor_name_present: ['vendor_name', 'vendor', 'supplier_name', 'supplier'],
        amount_total_present: ['amount_total', 'total', 'invoice_total', 'grand_total'],
        due_date_present: ['due_date', 'payment_due', 'due_by'],
      };
      const candidates = fieldMap[rule] ?? [];
      const found = candidates.some(
        (k) => output[k] !== undefined && output[k] !== null && output[k] !== '',
      );
      if (!found) {
        const label = rule.replace(/_present$/, '').replace(/_/g, ' ');
        return {
          rule,
          severity: 'warning',
          message: `Required field "${label}" is missing from output.`,
        };
      }
      return null;
    }

    // Warn when no PO number is provided
    case 'missing_po_check': {
      const hasPoNumber =
        output['purchase_order_number'] !== undefined &&
        output['purchase_order_number'] !== null &&
        output['purchase_order_number'] !== '';
      if (!hasPoNumber) {
        return {
          rule,
          severity: 'info',
          message: 'No purchase order number provided — could not verify PO.',
        };
      }
      return null;
    }

    // FIX 4 (H2): accept caller-supplied duplicate flags AND the documented
    // flag_duplicate_invoice key so the runbook payload works.
    // Persistent cross-org dedup would require org-scoped proof_record history
    // which is not available in this rule function — left as a future TODO.
    // TODO: add org-scoped persistent dedup query once proof_records are
    //       accessible from this rule context (needs orgId threaded through).
    case 'duplicate_invoice_check': {
      const duplicateSignal =
        output['flag_duplicate_invoice'] ??
        output['duplicate_invoice'] ??
        output['is_duplicate'] ??
        expectedFromEvidence(evidence, [
          'flag_duplicate_invoice',
          'duplicate_invoice',
          'is_duplicate',
        ]);
      const invoiceNo = String(output['invoice_number'] ?? output['invoice_no'] ?? '');
      const evidenceText = collectStringValues(evidence).join('\n');
      const escapedInvoiceNo = invoiceNo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const explicitDuplicate =
        /EXACT_DUPLICATE|MODIFIED_DUPLICATE|already paid|prior-payment-register/i.test(
          evidenceText,
        ) &&
        (!invoiceNo || new RegExp(escapedInvoiceNo, 'i').test(evidenceText));
      if (
        duplicateSignal === true ||
        duplicateSignal === 'true' ||
        duplicateSignal === 'yes' ||
        explicitDuplicate
      ) {
        return {
          rule,
          severity: 'critical',
          message: 'Duplicate invoice risk detected from submitted invoice history/evidence.',
        };
      }
      return null;
    }

    // Audit-proof rules
    case 'agent_identity_present': {
      const candidates = ['agent_or_system_name', 'agent_name', 'agent_id', 'agent'];
      const found = candidates.some(
        (k) => output[k] !== undefined && output[k] !== null && output[k] !== '',
      );
      if (!found) {
        return {
          rule,
          severity: 'warning',
          message: 'Agent or system identity is missing from the activity record.',
        };
      }
      return null;
    }
    case 'workflow_name_present': {
      const candidates = ['workflow_name', 'workflow', 'workflow_id'];
      const found = candidates.some(
        (k) => output[k] !== undefined && output[k] !== null && output[k] !== '',
      );
      if (!found) {
        return {
          rule,
          severity: 'warning',
          message: 'Workflow name is missing from the activity record.',
        };
      }
      return null;
    }
    case 'task_description_present': {
      const candidates = ['task_performed', 'task', 'task_description', 'task_label'];
      const found = candidates.some(
        (k) => output[k] !== undefined && output[k] !== null && output[k] !== '',
      );
      if (!found) {
        return {
          rule,
          severity: 'warning',
          message: 'Task description is missing from the activity record.',
        };
      }
      return null;
    }
    case 'input_output_pair_present': {
      const hasInput = output['input_used'] !== undefined || output['inputs'] !== undefined;
      const hasOutput = output['output_produced'] !== undefined || output['output'] !== undefined;
      if (!hasInput || !hasOutput) {
        return {
          rule,
          severity: 'warning',
          message: 'Activity record must include both input used and output produced.',
        };
      }
      return null;
    }
    case 'timestamp_integrity_check': {
      const ts = output['timestamp'];
      if (!ts) {
        return {
          rule,
          severity: 'warning',
          message: 'Timestamp is missing from the activity record.',
        };
      }
      if (typeof ts === 'string' && isNaN(Date.parse(ts))) {
        return { rule, severity: 'warning', message: `Timestamp "${ts}" is not a valid ISO date.` };
      }
      return null;
    }
    case 'human_approval_check': {
      const required = output['human_approval_required'];
      if (required === true || required === 'true' || required === 'yes') {
        const approver = output['human_approver'];
        if (!approver) {
          return {
            rule,
            severity: 'info',
            message: 'Human approval is marked required but no approver is recorded.',
          };
        }
      }
      return null;
    }
    case 'risk_level_check': {
      const risk = output['business_risk'];
      if (!risk) {
        return {
          rule,
          severity: 'info',
          message: 'Business risk level not specified in the activity record.',
        };
      }
      return null;
    }

    case 'bank_detail_changes': {
      const prior = expectedFromEvidence(evidence, [
        'prior_bank_or_payment_details',
        'previous_bank_details',
        'vendor_master_bank_details',
      ]);
      // FIX 2 (H7): also accept prior from the output object so the runbook-documented
      // field works when a caller supplies it there instead of in evidence.
      const priorFromOutput =
        output['prior_bank_or_payment_details'] ??
        output['previous_bank_details'] ??
        output['vendor_master_bank_details'];
      const priorResolved = prior ?? priorFromOutput;
      const current =
        output['bank_or_payment_details'] ?? output['bank_details'] ?? output['payment_details'];
      if (priorResolved !== undefined && current !== undefined) {
        const paymentMatch = samePaymentDetails(priorResolved, current);
        const differs =
          paymentMatch === null
            ? normalizeText(priorResolved) !== normalizeText(current)
            : paymentMatch === false;
        if (!differs) return null;
        // Invoice demos expect needs_review (hold), not hard fail — critical is reserved
        // for audit/compliance bank-change gates (detectCriticalBankChange).
        const severity = isInvoiceExtractionTask(task) ? 'warning' : 'critical';
        return {
          rule: 'bank_detail_changes',
          severity,
          message: 'Bank/payment details differ from vendor master or prior invoice evidence.',
        };
      }
      // Flag presence of new bank details without vendor master verification.
      // Severity is 'warning' (not 'critical') — normal for first-time vendors;
      // critical only fires when details differ from a known prior (above).
      if (
        priorResolved === undefined &&
        current !== undefined &&
        String(current).trim().length > 0
      ) {
        return {
          rule: 'bank_detail_changes',
          severity: 'warning',
          message:
            'First-time bank/payment details detected — verify against vendor master before processing payment.',
        };
      }
      return null;
    }
    case 'payment_term_changes': {
      const prior = expectedFromEvidence(evidence, [
        'prior_payment_terms',
        'historical_payment_terms',
        'vendor_master_payment_terms',
      ]);
      const current = output['payment_terms'] ?? output['terms'];
      if (
        prior !== undefined &&
        current !== undefined &&
        normalizeText(prior) !== normalizeText(current)
      ) {
        return {
          rule: 'payment_term_changes',
          severity: 'warning',
          message: 'Payment terms differ from prior vendor history evidence.',
        };
      }
      return null;
    }

    case 'vendor_name_mismatch': {
      const expectedVendor = expectedFromEvidence(evidence, [
        'vendor_name',
        'vendor',
        'expected_vendor_name',
        'vendor_master_name',
      ]);
      const actualVendor =
        output['vendor_name'] ?? output['vendor'] ?? output['supplier_name'] ?? output['supplier'];
      if (
        expectedVendor !== undefined &&
        actualVendor !== undefined &&
        normalizeText(expectedVendor) !== normalizeText(actualVendor)
      ) {
        return {
          rule,
          severity: 'warning',
          message: 'Vendor name differs from vendor master evidence.',
        };
      }
      return null;
    }

    case 'invoice_amount_mismatch':
    case 'line_item_math_error': {
      const total = asNumber(
        output['amount_total'] ??
          output['total'] ??
          output['invoice_total'] ??
          output['grand_total'],
      );
      const lineItems = parseLineItems(output['line_items']);
      if (!lineItems.length) {
        return null;
      }
      let calculatedTotal = 0;
      for (const item of lineItems) {
        const qty = asNumber(item['qty'] ?? item['quantity']) ?? 1;
        const unitPrice = asNumber(item['unit_price'] ?? item['unitPrice'] ?? item['price']);
        const lineTotal = asNumber(item['total'] ?? item['line_total'] ?? item['amount']);
        if (
          unitPrice !== null &&
          lineTotal !== null &&
          Math.abs(qty * unitPrice - lineTotal) >= 0.01
        ) {
          return {
            rule: 'line_item_math_error',
            severity: 'warning',
            message: 'Line item total does not equal quantity times unit price.',
          };
        }
        calculatedTotal += lineTotal ?? (unitPrice !== null ? qty * unitPrice : 0);
      }
      if (total !== null && Math.abs(calculatedTotal - total) >= 0.01) {
        return {
          rule: 'invoice_amount_mismatch',
          severity: 'warning',
          message: 'Invoice total does not match the sum of line items.',
        };
      }
      return null;
    }

    case 'tax_fee_inconsistency': {
      const total = asNumber(
        output['amount_total'] ??
          output['total'] ??
          output['invoice_total'] ??
          output['grand_total'],
      );
      const tax = asNumber(output['tax_amount'] ?? output['tax']);
      if (tax !== null && tax < 0) {
        return { rule, severity: 'warning', message: 'Tax amount cannot be negative.' };
      }
      if (total !== null && tax !== null && total > 0 && tax / total > 0.3) {
        return {
          rule,
          severity: 'warning',
          message: 'Tax amount is unusually high relative to invoice total.',
        };
      }
      return null;
    }

    case 'suspicious_vendor_change': {
      const priorEmail = expectedFromEvidence(evidence, [
        'prior_vendor_email',
        'vendor_master_email',
      ]);
      const currentEmail = output['vendor_email'] ?? output['supplier_email'];
      if (priorEmail !== undefined && currentEmail !== undefined) {
        const priorDomain = String(priorEmail).split('@').pop()?.toLowerCase();
        const currentDomain = String(currentEmail).split('@').pop()?.toLowerCase();
        if (priorDomain && currentDomain && priorDomain !== currentDomain) {
          return {
            rule,
            severity: 'warning',
            message: 'Vendor email domain differs from prior/vendor-master evidence.',
          };
        }
      }
      return null;
    }

    case 'prior_invoice_comparison': {
      const priorUnitPrice = asNumber(
        expectedFromEvidence(evidence, ['prior_unit_price', 'historical_unit_price']),
      );
      const lineItems = parseLineItems(output['line_items']);
      const currentUnitPrice = lineItems.length
        ? asNumber(lineItems[0]['unit_price'] ?? lineItems[0]['unitPrice'] ?? lineItems[0]['price'])
        : null;
      if (priorUnitPrice !== null && currentUnitPrice !== null && priorUnitPrice > 0) {
        const drift = Math.abs(currentUnitPrice - priorUnitPrice) / priorUnitPrice;
        if (drift > 0.25) {
          return {
            rule,
            severity: 'warning',
            message: 'Unit price differs materially from prior invoice evidence.',
          };
        }
      }
      return null;
    }

    default:
      return {
        rule,
        severity: 'warning',
        message: `Rule "${rule}" is not a recognized rule name — check spelling.`,
      };
  }
}

// Deterministic critical bank-account-change gate. A bank / payment-detail
// change on a high or critical business-risk event that requires human
// approval is a fraud-redirection signal that must HARD BLOCK the workflow —
// not merely fall through to needs_review. Kept as a pure function so it is
// independently unit-testable and decoupled from the AI layer.
function detectCriticalBankChange(
  output: unknown,
  task: string | undefined,
  priorIssues: Array<{ rule?: string; severity?: string; message?: string }>,
): boolean {
  const outputObj =
    typeof output === 'object' && output !== null ? (output as Record<string, unknown>) : {};
  const signalText = [
    task,
    outputObj['workflow_name'],
    outputObj['workflow'],
    outputObj['event_type'],
    outputObj['task_performed'],
    outputObj['task'],
  ]
    .map((v) => String(v ?? '').toLowerCase())
    .join(' ');
  const isBankChangeEvent =
    /bank[\s_-]*(account|detail|change)|bank change|account change|payment[\s_-]*detail/.test(
      signalText,
    ) || priorIssues.some((i) => i.rule === 'bank_detail_changes' && i.severity === 'critical');
  const risk = String(outputObj['business_risk'] ?? '').toLowerCase();
  const riskHigh = risk === 'high' || risk === 'critical';
  const approvalRequired =
    outputObj['human_approval_required'] === true ||
    outputObj['human_approval_required'] === 'true' ||
    outputObj['human_approval_required'] === 'yes';
  return isBankChangeEvent && (riskHigh || approvalRequired);
}

function normalizeAiIssueSeverityForTask(
  task: string | undefined,
  output: unknown,
  evidence: unknown,
  issue: AiIssue,
): AiIssue | null {
  const issueText = `${issue.rule} ${issue.message}`;

  if (
    task === 'invoice_extraction' &&
    /amount|invoice total|historical|previous|prior|vendor/i.test(issueText)
  ) {
    const hasAmountBaseline =
      expectedFromEvidence(evidence, [
        'prior_amount_total',
        'prior_invoice_amount',
        'historical_amount_total',
        'historical_invoice_amount',
        'expected_amount_total',
        'expected_total',
        'invoice_total',
        'amount_total',
      ]) !== undefined;

    if (!hasAmountBaseline) {
      return null;
    }
  }

  if (issue.severity !== 'critical') return issue;
  if (task !== 'audit_proof' && task !== 'agent_activity') return issue;

  const outputObj =
    typeof output === 'object' && output !== null ? (output as Record<string, unknown>) : {};
  const approvalRequired =
    outputObj['human_approval_required'] === true ||
    outputObj['human_approval_required'] === 'true' ||
    outputObj['human_approval_required'] === 'yes';
  const hasApprover =
    outputObj['human_approver'] !== undefined &&
    outputObj['human_approver'] !== null &&
    String(outputObj['human_approver']).trim().length > 0;
  const approvalOnlyIssue = /human|approv|approver/i.test(issueText);

  if (approvalRequired && !hasApprover && approvalOnlyIssue) {
    return { ...issue, severity: 'warning' };
  }

  return issue;
}

const SOFTWARE_DELIVERY_REQUIRED_FIELDS = [
  'repoOwner',
  'repoName',
  'beforeSha',
  'afterSha',
  'jobStartedAt',
  'tier',
  'jobType',
] as const;

const SOFTWARE_DELIVERY_EXAMPLE = {
  source_type: 'software_delivery',
  rules: ['auto'],
  output: {
    repoOwner: 'owner',
    repoName: 'repo',
    beforeSha: 'abc123',
    afterSha: 'def456',
    jobStartedAt: '2026-03-01T00:00:00Z',
    tier: 'BASIC',
    jobType: 'NEW_FEATURE',
  },
} as const;

// Build a teaching 400 for software_delivery validation failures: list what is
// wrong, detect the common "fields at top level instead of inside output"
// mistake, and return a minimal correct example + docs link.
function buildSoftwareDeliveryValidationError(
  errors: Array<{ property: string; value?: unknown; constraints?: Record<string, string> }>,
  body: unknown,
) {
  const topLevel = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const output =
    typeof topLevel.output === 'object' && topLevel.output !== null
      ? (topLevel.output as Record<string, unknown>)
      : {};

  // Fields that are required, absent from output, but present at the top level.
  const misplaced = SOFTWARE_DELIVERY_REQUIRED_FIELDS.filter(
    (f) => output[f] === undefined && topLevel[f] !== undefined,
  );

  const details: string[] = [];
  if (misplaced.length > 0) {
    details.push(
      `These fields must be nested inside "output", not at the top level of the request: ${misplaced.join(', ')}.`,
    );
  }
  for (const err of errors) {
    const isRequiredAndMissing =
      (SOFTWARE_DELIVERY_REQUIRED_FIELDS as readonly string[]).includes(err.property) &&
      (err.value === undefined || err.value === null || err.value === '');
    if (isRequiredAndMissing) {
      details.push(`${err.property} is required inside output.`);
    } else if (err.constraints) {
      for (const message of Object.values(err.constraints)) {
        details.push(`${message} (field: output.${err.property}).`);
      }
    } else {
      details.push(`output.${err.property} is invalid.`);
    }
  }

  return {
    statusCode: 400,
    error: 'BAD_REQUEST',
    message: 'Invalid software_delivery payload',
    details,
    example: SOFTWARE_DELIVERY_EXAMPLE,
    docs: 'https://swarmsync.ai/docs/verify-api#software-delivery-verification',
  };
}

// Public investor-demo scope for the unauthenticated git-based software_delivery
// path. Anonymous callers may only verify commits in this exact public repo —
// everything else (arbitrary repos, private repos, deploy tokens, live-site
// probes) stays behind JwtAuthGuard on POST /api/verify.
const DEMO_SOFTWARE_DELIVERY_REPO = {
  owner: 'foxfirepoets',
  name: 'swarmsync-verifyapi-investor-demo',
} as const;

// Fields that require credentials, hit a caller-supplied URL, or mutate state —
// none are safe to expose on a public, unauthenticated endpoint. Presence of any
// of these in a demo request is rejected outright rather than silently dropped.
const DEMO_SOFTWARE_DELIVERY_DISALLOWED_FIELDS = [
  'netlifyToken',
  'renderToken',
  'vercelToken',
  'railwayToken',
  'sentryAuthToken',
  'deployUrl',
  'deployPlatform',
  'netlifySiteId',
  'renderServiceId',
  'vercelProjectId',
  'vercelTeamId',
  'railwayServiceId',
  'semgrepFindings',
  'performanceBaselineP95Ms',
  'performanceProbePaths',
  'sentryOrgSlug',
  'sentryProjectSlug',
  'sentryEnvironment',
] as const;

// The only checks that run for anonymous demo requests: all read-only public
// GitHub REST API calls (diff/commit/PR metadata) plus S12, which is pure
// diff-text static analysis (no code execution, no external call) — no build
// sandbox, no live-site fetch, no deploy-platform credentials. B2 ("commit
// made after job start") is deliberately excluded: it compares the commit
// timestamp against jobStartedAt, which the public demo page generates live
// at click time — since the demo replays fixed historical commits, B2 can
// never pass and adds no security signal for a canned demo, so it would only
// ever produce a false "needs review" on an otherwise-clean run.
const DEMO_SOFTWARE_DELIVERY_ALLOWED_CHECKS = ['B1', 'B3', 'B4', 'B7', 'S12'] as const;

// Blocks credential/live-site/deploy-mutating fields from any unauthenticated
// software_delivery demo request, regardless of which sub-path (document-based
// or git-based) handles it. Applied unconditionally so a future change to the
// document-based evaluator can't silently start acting on these fields without
// this gate already being in place.
function assertNoDisallowedDemoSoftwareDeliveryFields(output: Record<string, unknown>): void {
  const disallowedField = DEMO_SOFTWARE_DELIVERY_DISALLOWED_FIELDS.find(
    (field) => output[field] !== undefined && output[field] !== null && output[field] !== '',
  );
  if (disallowedField) {
    throw new BadRequestException(
      `Field "${disallowedField}" is not permitted for unauthenticated demo verification — credentials, deploy platforms, file uploads, and live-site checks are disabled in demo mode.`,
    );
  }
}

// Enforces the public investor-demo scope for the unauthenticated git-based
// software_delivery path. Throws a 403 for any repo other than the approved
// demo repo, and a 400 if the caller asks for checks outside the read-only
// GitHub allowlist. Disallowed-field checking lives in
// assertNoDisallowedDemoSoftwareDeliveryFields (called separately, unconditionally).
function assertDemoSoftwareDeliveryAllowed(
  output: Record<string, unknown>,
  requestedRules: unknown[],
): void {
  const repoOwner = String(output['repoOwner'] ?? '')
    .trim()
    .toLowerCase();
  const repoName = String(output['repoName'] ?? '')
    .trim()
    .toLowerCase();
  if (
    repoOwner !== DEMO_SOFTWARE_DELIVERY_REPO.owner ||
    repoName !== DEMO_SOFTWARE_DELIVERY_REPO.name
  ) {
    throw new HttpException(
      `Unauthenticated software_delivery verification is limited to the SwarmSync VerifyAPI investor demo repository (${DEMO_SOFTWARE_DELIVERY_REPO.owner}/${DEMO_SOFTWARE_DELIVERY_REPO.name}). Sign in to verify your own repositories.`,
      HttpStatus.FORBIDDEN,
    );
  }

  const rules = Array.isArray(requestedRules) ? requestedRules : [];
  const allowed = new Set<string>(['auto', ...DEMO_SOFTWARE_DELIVERY_ALLOWED_CHECKS]);
  const unsupported = rules.filter((rule) => typeof rule !== 'string' || !allowed.has(rule));
  if (unsupported.length > 0) {
    throw new BadRequestException(
      `Rule(s) not supported for unauthenticated demo verification: ${unsupported.join(', ')}. Allowed checks: ${DEMO_SOFTWARE_DELIVERY_ALLOWED_CHECKS.join(', ')}.`,
    );
  }
}

// Short-lived result cache for anonymous git-based software_delivery demo
// requests, keyed by the exact (repo, commit pair, tier, jobType) being
// verified. The public investor demo always re-submits the same two fixed
// commits, so without this cache every click — including repeat/abusive
// clicks, since the per-IP quota is bypassable via a spoofed
// X-Forwarded-For header — burns a fresh round of real GitHub API calls and a
// fresh unit of the shared 500/month anonymous-org quota that every demo
// visitor draws from. A cache hit consumes neither and returns the same
// proof_id/verification_id already on record for that exact input.
const DEMO_SOFTWARE_DELIVERY_CACHE_TTL_MS = 10 * 60 * 1000;
const demoSoftwareDeliveryCache = new Map<
  string,
  { expiresAt: number; response: Record<string, unknown> }
>();

function demoSoftwareDeliveryCacheKey(output: Record<string, unknown>): string {
  return [
    output['repoOwner'],
    output['repoName'],
    output['beforeSha'],
    output['afterSha'],
    output['tier'],
    output['jobType'],
  ]
    .map((v) => String(v ?? ''))
    .join('|')
    .toLowerCase();
}

function getDemoSoftwareDeliveryCache(key: string): Record<string, unknown> | null {
  const entry = demoSoftwareDeliveryCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    demoSoftwareDeliveryCache.delete(key);
    return null;
  }
  return entry.response;
}

function setDemoSoftwareDeliveryCache(key: string, response: Record<string, unknown>): void {
  demoSoftwareDeliveryCache.set(key, {
    expiresAt: Date.now() + DEMO_SOFTWARE_DELIVERY_CACHE_TTL_MS,
    response,
  });
}

function parseOptionalProofProduct(raw: string | undefined): ProofProduct | undefined {
  if (!raw) return undefined;
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'all' || normalized === 'verify-api') return undefined;
  const slugMap: Record<string, ProofProduct> = {
    'invoice-proof': ProofProduct.INVOICE_AUDIT,
    invoiceproof: ProofProduct.INVOICE_AUDIT,
    'audit-proof': ProofProduct.COMPLIANCE_SCAN,
    auditproof: ProofProduct.COMPLIANCE_SCAN,
    'document-verify': ProofProduct.DOCUMENT_VERIFY,
    document: ProofProduct.DOCUMENT_VERIFY,
    identity: ProofProduct.IDENTITY_CHECK,
  };
  if (slugMap[normalized]) return slugMap[normalized];
  if (Object.values(ProofProduct).includes(raw as ProofProduct)) {
    return raw as ProofProduct;
  }
  throw new BadRequestException(
    `product must be one of: ${Object.values(ProofProduct).join(', ')}`,
  );
}

function parseOptionalProofRunStatus(raw: string | undefined): ProofRunStatus | undefined {
  if (!raw) return undefined;
  if (Object.values(ProofRunStatus).includes(raw as ProofRunStatus)) {
    return raw as ProofRunStatus;
  }
  throw new BadRequestException(
    `status must be one of: ${Object.values(ProofRunStatus).join(', ')}`,
  );
}

function parseListNumber(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

// Map the frontend's source_type string to the closest ProofSourceType enum value.
// The advertised API uses plain strings; the DB uses the Prisma enum.
function mapSourceType(raw: string | undefined): ProofSourceType {
  if (!raw) return ProofSourceType.API_PUSH;
  const upper = raw.toUpperCase().replace(/-/g, '_');
  if (upper === 'API_OUTPUT' || upper === 'API_PUSH') return ProofSourceType.API_PUSH;
  if (upper === 'UPLOAD') return ProofSourceType.UPLOAD;
  if (upper === 'URL') return ProofSourceType.URL;
  if (upper === 'WEBHOOK') return ProofSourceType.WEBHOOK;
  return ProofSourceType.API_PUSH;
}

// Derive a ProofRunStatus / string for the response from numeric confidence and issues.
function deriveStatus(issues: unknown[]): ProofRunStatus {
  if (!issues || issues.length === 0) return ProofRunStatus.PASSED;
  const hasCritical = issues.some(
    (i) =>
      typeof i === 'object' && i !== null && (i as Record<string, unknown>).severity === 'critical',
  );
  if (hasCritical) return ProofRunStatus.FAILED;
  return ProofRunStatus.NEEDS_REVIEW;
}

// Map a verification status to the snake_case string the frontend expects.
function statusToApi(status: ProofRunStatus): string {
  if (status === ProofRunStatus.PASSED) return 'passed';
  if (status === ProofRunStatus.FAILED) return 'failed';
  return 'needs_review';
}

// Map risk level to recommended_action.
function recommendedAction(riskLevel: ProofRiskLevel, status: ProofRunStatus): string {
  if (status === ProofRunStatus.FAILED) return 'blocked';
  if (riskLevel === ProofRiskLevel.HIGH || riskLevel === ProofRiskLevel.MEDIUM) {
    return 'human_review';
  }
  return 'approved';
}

function dedupeRuleIssues<T extends { rule?: string; severity?: string; message?: string }>(
  issues: T[],
): T[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const visibleMessage = issue.message?.trim().toLowerCase();
    const key = visibleMessage
      ? `${issue.severity ?? ''}|${visibleMessage}`
      : `${issue.rule ?? ''}|${issue.severity ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Derive a confidence percentage from 0–100 → normalise to 0.0–1.0 float.
function normaliseConfidence(raw: number): number {
  return Math.round(raw) / 100;
}

// computeProofChainHash lives in proof.service.ts — see the doc comment
// there for why this used to be duplicated here (byte-for-byte) and why
// that was a bug waiting to happen for a hash-chain implementation.

function verifyProofSignature(
  chainHash: string | null | undefined,
  signature: string | null | undefined,
): boolean | null {
  if (!chainHash || !signature) return null;
  const publicKeyB64 = process.env['PROOF_SIGNING_PUBLIC_KEY'];
  if (!publicKeyB64) return null;
  try {
    const publicKey = createPublicKey({
      key: Buffer.from(publicKeyB64, 'base64'),
      format: 'der',
      type: 'spki',
    });
    return cryptoVerify(
      null,
      Buffer.from(chainHash, 'hex'),
      publicKey,
      Buffer.from(signature, 'base64'),
    );
  } catch {
    return false;
  }
}

function resolveVerifyApiPlan(planSlug: string | null | undefined) {
  return verifyApiPlanConfigs.find((plan) => plan.slug === planSlug) ?? verifyApiPlanConfigs[0];
}

function verifyApiMeteredOverageEnabled(): boolean {
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(
    (process.env.VERIFY_API_METERED_OVERAGE_ENABLED ?? '').trim().toLowerCase(),
  );
}

export function invoiceProofDashboardFields(riskLevel: string, issuesFound: unknown) {
  const normalizedRisk = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(riskLevel)
    ? riskLevel
    : 'LOW';
  return {
    riskLevel: normalizedRisk,
    risk_level: normalizedRisk.toLowerCase(),
    issuesFound: Array.isArray(issuesFound) ? issuesFound.length : 0,
  };
}

@ApiTags('Verify API')
@Controller('api')
@UseGuards(VerifyApiAuthGuard)
export class VerifyApiController {
  private readonly logger = new Logger(VerifyApiController.name);

  constructor(
    private readonly verificationService: VerificationService,
    private readonly proofService: ProofService,
    private readonly prisma: PrismaService,
    
    private readonly proofBilling: ProofBillingService,
    private readonly proofClaim: ProofClaimService,
    private readonly aiAnalysis: AiAnalysisService,
    private readonly softwareDelivery: SoftwareDeliveryService,
    
  ) {}

  // ---------------------------------------------------------------------------
  // POST /api/verify
  // Creates a VerificationRun, runs placeholder checks, then creates a ProofRecord.
  // Authenticated production endpoint.
  // ---------------------------------------------------------------------------

  @Post('verify')
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit output for verification and receive a proof record' })
  async verify(
    @Body()
    body: {
      source_type?: string;
      task?: string;
      output: unknown;
      rules?: unknown[];
      evidence?: unknown;
    },
    @CurrentUser() user: AuthenticatedUser | null | undefined,
  ) {
    return this.runVerification(body, user);
  }

  // ---------------------------------------------------------------------------
  // POST /api/verify/demo
  // Public sandbox endpoint used by product-page demos.
  // ---------------------------------------------------------------------------

  @Post('verify/demo')
  @Public()
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Submit a sandbox verification without an API key' })
  async verifyDemo(
    @Body()
    body: {
      source_type?: string;
      task?: string;
      output: unknown;
      rules?: unknown[];
      evidence?: unknown;
    },
    @Req() req: Request,
  ) {
    // Per-IP demo quota — prevents a single caller from burning down the
    // global anonymous monthly pool (Issue #8 in customer-flow-qa).
    // Bughound B4: increment BEFORE awaiting runVerification so a) parallel
    // requests can't race past the check (TOCTOU) and b) requests that throw
    // mid-verification still count against the caller's monthly budget.
    const ip = clientIpFromRequest(req);
    const { used } = await getDemoIpUsage(ip);
    if (used >= DEMO_PER_IP_MONTHLY_LIMIT) {
      throw new HttpException(
        `Anonymous demo limit reached (${used}/${DEMO_PER_IP_MONTHLY_LIMIT} this month for your IP). Sign up for a free account at ${DEMO_QUOTA_UPGRADE_URL} for higher limits.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    await incrementDemoIpUsage(ip);

    // Demo endpoint defaults source_type to api_output for a friendlier DX —
    // the production /api/verify endpoint still requires the field explicitly.
    const normalizedBody = {
      ...body,
      source_type: body?.source_type ?? 'api_output',
    };
    return this.runVerification(normalizedBody, null);
  }

  // ---------------------------------------------------------------------------
  // POST /api/proof/pilot-intake
  // Sales lead-capture form for ALL proof products (InvoiceProof / AuditProof /
  // VerifyAPI) — post-Stripe-checkout onboarding AND the general /book-pilot
  // page. Persists a ProofPilotIntake row for a human ops follow-up; this is
  // NOT a real AuditProof audit run.
  //
  // Root cause of the naming mismatch (see git history: b8f39bf added the
  // /audit-proof/welcome page as AuditProof-specific post-checkout onboarding;
  // 67103a8 "H1: pilot intake persists to ProofPilotIntake" wired the actual
  // persistence): the endpoint started life scoped to AuditProof's checkout
  // flow, was later generalized so /book-pilot (product_interest: InvoiceProof
  // | AuditProof | VerifyAPI | "Not sure") could reuse the same lead-capture
  // pipeline for all three products, but the path was never renamed off
  // "audit-intake" — leaving a generic multi-product lead form confusingly
  // named and namespaced as if it were AuditProof's real intake/processing
  // endpoint. A real AuditProof run has always gone through
  // POST /api/verify(/demo) with source_type/task: "audit_proof" (see
  // runVerification below) — this endpoint has never created a
  // VerificationRun and was never meant to.
  //
  // Fixed by renaming to /api/proof/pilot-intake, matching the sibling admin
  // endpoints below (GET .../pilot-intakes, PATCH .../pilot-intakes/:id/status)
  // that already used the honest "pilot-intake(s)" name. The old
  // /api/proof/audit-intake path is kept as a deprecated alias (still linked
  // from Stripe Checkout success_url configuration in the dashboard, which
  // this change does not touch) so no in-flight checkout session breaks.
  // ---------------------------------------------------------------------------

  @Post('proof/pilot-intake')
  @Public()
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Record a proof-product pilot/sales lead (InvoiceProof, AuditProof, or VerifyAPI)',
    description:
      'Lead-capture only — persists a ProofPilotIntake row for human ops follow-up. Does NOT ' +
      'run a real audit/verification. A real AuditProof run goes through POST /api/verify with ' +
      'task: "audit_proof".',
  })
  async pilotIntake(@Body() body: PilotIntakeBody, @Req() req: Request) {
    return this.recordPilotIntake(body, req);
  }

  /**
   * @deprecated Use POST /api/proof/pilot-intake. Kept as a thin alias so
   * existing Stripe Checkout success_url links and any external references
   * to the old path keep working; identical behavior, identical response
   * shape. Remove once the Stripe dashboard success_url configs (outside
   * this repo) have been repointed and no traffic hits this path anymore.
   */
  @Post('proof/audit-intake')
  @Public()
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[Deprecated — use POST /api/proof/pilot-intake] Record a pilot/sales lead',
  })
  async auditProofIntake(@Body() body: PilotIntakeBody, @Req() req: Request) {
    this.logger.warn(
      'POST /api/proof/audit-intake is deprecated — use /api/proof/pilot-intake instead',
    );
    return this.recordPilotIntake(body, req);
  }

  private async recordPilotIntake(body: PilotIntakeBody, req: Request) {
    // Required field validation.
    const product = body?.product?.trim() || 'auditproof';
    const companyName = body?.companyName?.trim();
    const contactEmail = body?.contactEmail?.trim();

    if (!companyName) {
      throw new BadRequestException('companyName is required');
    }
    if (!contactEmail) {
      throw new BadRequestException('contactEmail is required');
    }

    // PII-safe logging: log plan/session presence only, never email or body contents.
    this.logger.log(
      `Pilot intake received product=${product} plan=${body.planSlug ?? 'unknown'} session=${(body.sessionId ?? body.stripeSessionId) ? 'yes' : 'no'}`,
    );

    const agentCount =
      body.agentCount !== undefined && body.agentCount !== '' ? Number(body.agentCount) : undefined;
    const invoiceCount =
      body.invoiceCount !== undefined && body.invoiceCount !== ''
        ? Number(body.invoiceCount)
        : undefined;

    const resolvedSessionId = body.stripeSessionId ?? body.sessionId ?? undefined;
    const sourcePath =
      body.sourcePath?.trim() || (req.headers['referer'] as string | undefined) || undefined;

    const intake = await this.prisma.proofPilotIntake.create({
      data: {
        product,
        planSlug: body.planSlug?.trim() || undefined,
        companyName,
        contactName: body.contactName?.trim() || undefined,
        contactEmail,
        workflowName: body.workflowName?.trim() || undefined,
        agentCount:
          agentCount !== undefined && Number.isFinite(agentCount) ? agentCount : undefined,
        invoiceCount:
          invoiceCount !== undefined && Number.isFinite(invoiceCount) ? invoiceCount : undefined,
        notes: body.notes?.trim() || undefined,
        stripeSessionId: resolvedSessionId || undefined,
        organizationId: body.organizationId?.trim() || undefined,
        status: 'NEW',
        sourcePath: sourcePath || undefined,
        rawPayload: body as Prisma.InputJsonValue,
      },
    });

    return { ok: true, intakeId: intake.id };
  }

  // ---------------------------------------------------------------------------
  // GET /api/proof/pilot-intakes
  // Operator endpoint — list pilot intakes with optional filters.
  // Restricted to admin users via JwtAuthGuard + AdminOnlyGuard.
  // ---------------------------------------------------------------------------

  @Get('proof/pilot-intakes')
  @UseGuards(JwtAuthGuard, AdminOnlyGuard)
  @ApiOperation({ summary: '[Admin] List pilot intakes' })
  async listPilotIntakes(
    @Query('product') product?: string,
    @Query('status') status?: string,
    @Query('limit') limitStr?: string,
    @Query('offset') offsetStr?: string,
  ) {
    const limit = parseListNumber(limitStr, 50, 1, 200);
    const offset = parseListNumber(offsetStr, 0, 0, 100_000);

    const where: Prisma.ProofPilotIntakeWhereInput = {};
    if (product?.trim()) where.product = product.trim();
    if (status?.trim()) where.status = status.trim();

    const [intakes, total] = await Promise.all([
      this.prisma.proofPilotIntake.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.proofPilotIntake.count({ where }),
    ]);

    return { data: intakes, total, limit, offset };
  }

  // ---------------------------------------------------------------------------
  // PATCH /api/proof/pilot-intakes/:id/status
  // Operator endpoint — update intake status.
  // Restricted to admin users via JwtAuthGuard + AdminOnlyGuard.
  // ---------------------------------------------------------------------------

  @Patch('proof/pilot-intakes/:id/status')
  @UseGuards(JwtAuthGuard, AdminOnlyGuard)
  @ApiOperation({ summary: '[Admin] Update pilot intake status' })
  async updatePilotIntakeStatus(@Param('id') id: string, @Body() body: { status: string }) {
    const newStatus = body?.status?.trim() as PilotIntakeStatus | undefined;
    if (!newStatus || !PILOT_INTAKE_ALLOWED_STATUSES.includes(newStatus)) {
      throw new BadRequestException(
        `status must be one of: ${PILOT_INTAKE_ALLOWED_STATUSES.join(', ')}`,
      );
    }

    const existing = await this.prisma.proofPilotIntake.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`PilotIntake ${id} not found`);
    }

    const updated = await this.prisma.proofPilotIntake.update({
      where: { id },
      data: { status: newStatus },
    });

    return { ok: true, id: updated.id, status: updated.status };
  }

  private async runVerification(
    body: {
      source_type?: string;
      task?: string;
      output: unknown;
      rules?: unknown[];
      evidence?: unknown;
    },
    user: AuthenticatedUser | null | undefined,
  ) {
    if (!body || body.output === undefined || body.output === null) {
      throw new BadRequestException('Missing required field: output');
    }
    // Reject empty-object output — an object with no fields cannot be verified
    // and previously returned status:'passed' with 95% confidence (PRB-EMPTY-BODY-PASS).
    if (
      typeof body.output === 'object' &&
      !Array.isArray(body.output) &&
      Object.keys(body.output as object).length === 0
    ) {
      throw new BadRequestException(
        'output must not be an empty object — provide at least one field to verify',
      );
    }
    // Reject oversized output payloads before any DB write or AI call (L-2).
    // Large strings previously caused a 500 from the DB layer (text column overflow).
    const MAX_OUTPUT_CHARS = 50_000;
    const outputStr =
      typeof body.output === 'string' ? body.output : JSON.stringify(body.output ?? '');
    if (outputStr.length > MAX_OUTPUT_CHARS) {
      throw new BadRequestException(
        `Input too long — maximum ${MAX_OUTPUT_CHARS.toLocaleString()} characters`,
      );
    }
    const VALID_SOURCE_TYPES = [
      'api_output',
      'agent_activity',
      'audit_proof',
      'document',
      'workflow_event',
      'software_delivery',
    ] as const;

    if (!body.source_type) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'BAD_REQUEST',
        message: 'source_type is required',
        allowed_values: [...VALID_SOURCE_TYPES],
      });
    }
    if (!VALID_SOURCE_TYPES.includes(body.source_type as (typeof VALID_SOURCE_TYPES)[number])) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'BAD_REQUEST',
        message: `source_type "${body.source_type}" is not recognized`,
        allowed_values: [...VALID_SOURCE_TYPES],
      });
    }

    // Software delivery verification has its own table and flow — branch before quota checks.
    if (body.source_type === 'software_delivery') {
      // ISSUE-13: plain string output is not valid for software_delivery — reject early
      // before any DB write or AI call to prevent the 500 from the DTO validator.
      if (typeof body.output === 'string') {
        throw new BadRequestException(
          'software_delivery requires structured output. Provide at least one of: delivery_statement, deployment_report, release_notes. Plain text string is not accepted for software_delivery.',
        );
      }

      // Path A: document-based software_delivery — accept structured delivery documents
      // instead of requiring a git repo URL. Detect by presence of any document field.
      // This resolves PRB-SOFT-DELIVERY-500 where document payloads crashed with 500.
      const SD_DOC_FIELDS = [
        'requirements',
        'acceptance_criteria',
        'contract_requirements',
        'contract_scope',
        'requirements_traceability',
        'delivery_statement',
        'delivery',
        'deployment',
        'deployment_report',
        'release_notes',
        'change_log',
        'defect_list',
        'defects',
        'integration_scope',
      ] as const;
      const outputAsObj =
        typeof body.output === 'object' && body.output !== null
          ? (body.output as Record<string, unknown>)
          : {};
      const isDocumentBasedDelivery = SD_DOC_FIELDS.some(
        (f) => outputAsObj[f] !== undefined && outputAsObj[f] !== null,
      );

      // Credential/live-site/deploy fields are blocked for every anonymous
      // software_delivery demo request — document-based and git-based alike —
      // so a future change to the document-based evaluator can't silently start
      // acting on a field this gate was never re-checked against.
      if (!user) {
        assertNoDisallowedDemoSoftwareDeliveryFields(outputAsObj);
      }

      // Document-based path is allowed without auth (same as other source types on the demo
      // endpoint). Git-based path (repoOwner/repoName/beforeSha) normally requires an
      // authenticated user so the org quota and git credentials can be resolved — the sole
      // exception is the public investor-demo repo, which anonymous callers may verify
      // read-only via /api/verify/demo (see assertDemoSoftwareDeliveryAllowed).
      if (!isDocumentBasedDelivery && !user) {
        assertDemoSoftwareDeliveryAllowed(outputAsObj, Array.isArray(body.rules) ? body.rules : []);
      }

      // Resolve org: authenticated users use their billing org; anonymous callers
      // (demo endpoint, document-based only) are scoped to the sentinel org.
      const orgId = user ? await this.resolveOrgForUser(user) : ANONYMOUS_ORG_ID;
      if (isDocumentBasedDelivery) {
        const presentFields = SD_DOC_FIELDS.filter(
          (f) => outputAsObj[f] !== undefined && outputAsObj[f] !== null,
        );
        if (presentFields.length === 0) {
          throw new BadRequestException({
            statusCode: 400,
            error: 'BAD_REQUEST',
            message:
              'Document-based software_delivery requires at least one delivery, deployment, requirement, or defect evidence field.',
            allowed_document_fields: [...SD_DOC_FIELDS],
          });
        }
        const sdProofReport = await runProofProduct({
          product: 'verifyapi',
          evidenceInputs: buildProofCoreEvidenceInputs(body.output, body.evidence, 'verifyapi'),
        });
        const legacySdDocIssues = evaluateSoftwareDeliveryDocuments(outputAsObj);
        const proofCoreSdDocIssues = proofReportToRuleIssues(sdProofReport, 'proof_core');
        const sdDocIssues = [
          ...(sdProofReport.overall_status === 'pass' ? [] : legacySdDocIssues),
          ...proofCoreSdDocIssues,
        ];

        // Evidence-readiness gate: when required delivery evidence is absent we
        // emit needs_more_evidence findings (status, not a hard fail) and
        // deterministically cap acceptable-confidence so a delivery is never
        // reported "accepted" when a must-check control could not run.
        const sdReadiness = assessSoftwareDeliveryReadiness(outputAsObj, presentFields);
        const sdControlsSkipped = [
          ...sdReadiness.controls_skipped,
          ...proofReportSkippedControls(sdProofReport),
        ];
        const sdEvidenceGaps = [
          ...sdReadiness.evidence_gaps,
          ...sdProofReport.missing_evidence.map(
            (missing) => `Provide ${missing} so deterministic VerifyAPI controls can run.`,
          ),
        ];
        for (const gap of sdControlsSkipped) {
          sdDocIssues.push({
            rule: `needs_more_evidence:${gap.controlId}`,
            severity: 'warning',
            message: `NEEDS_MORE_EVIDENCE — ${gap.reason}`,
          });
        }

        const dedupedSdDocIssues = dedupeRuleIssues(sdDocIssues);
        const hasCriticalFindings = dedupedSdDocIssues.some((i) => i.severity === 'critical');
        const hasHighFindings = sdDocIssues.length >= 3;

        // Status: failed if any critical finding; needs_review if warnings OR
        // evidence gaps; passed only when clean AND no must-check control was
        // skipped for missing evidence.
        const sdDocStatus = hasCriticalFindings
          ? 'failed'
          : dedupedSdDocIssues.length > 0 ||
              sdReadiness.hasGaps ||
              sdProofReport.overall_status !== 'pass'
            ? 'needs_review'
            : 'passed';

        // Risk: critical/high findings → high; warnings → medium; clean → low.
        const sdDocRisk =
          hasCriticalFindings || hasHighFindings || sdProofReport.overall_status === 'fail'
            ? 'high'
            : dedupedSdDocIssues.length > 0 || sdProofReport.overall_status === 'needs_review'
              ? 'medium'
              : 'low';

        // Confidence = "how confident are we that this delivery is ACCEPTABLE?"
        // The shared deterministic proof-core confidence is authoritative. The
        // legacy readiness cap remains as a secondary lower-only guard.
        const sdDocConfidence = Math.min(sdProofReport.confidence, sdReadiness.confidenceCap);

        const sdDocRecommendedAction = hasCriticalFindings
          ? 'blocked'
          : dedupedSdDocIssues.length > 0 || sdProofReport.overall_status !== 'pass'
            ? 'human_review'
            : 'approved';

        const sdDocSummary =
          dedupedSdDocIssues.length === 0
            ? `Document-based software delivery accepted. Fields reviewed: ${presentFields.join(', ')}.`
            : `${dedupedSdDocIssues.length} finding(s) detected in delivery documents (${presentFields.join(', ')}): ${dedupedSdDocIssues.map((i) => i.rule).join(', ')}.`;

        // ISSUE-12: create a VerificationRun + ProofRecord for document-based software_delivery
        // so proof_id is populated in the response (same as other source types).
        const sdDocFinalDecision = hasCriticalFindings
          ? ProofFinalDecision.REJECTED
          : dedupedSdDocIssues.length > 0
            ? ProofFinalDecision.ESCALATED
            : ProofFinalDecision.APPROVED;
        const sdDocProofRiskLevel =
          sdDocRisk === 'high'
            ? ProofRiskLevel.HIGH
            : sdDocRisk === 'medium'
              ? ProofRiskLevel.MEDIUM
              : ProofRiskLevel.LOW;
        const sdDocFinalStatus = hasCriticalFindings
          ? ProofRunStatus.FAILED
          : dedupedSdDocIssues.length > 0
            ? ProofRunStatus.NEEDS_REVIEW
            : ProofRunStatus.PASSED;
        const sdDocRun = await this.verificationService.queueVerification(
          orgId,
          ProofProduct.DOCUMENT_VERIFY,
          ProofSourceType.API_PUSH,
          `software_delivery document: ${presentFields.join(', ')}`,
        );
        await this.verificationService.updateVerificationStatus(
          sdDocRun.id,
          orgId,
          ProofRunStatus.PROCESSING,
        );
        await this.verificationService.updateVerificationStatus(
          sdDocRun.id,
          orgId,
          sdDocFinalStatus,
          {
            riskLevel: sdDocProofRiskLevel,
            confidence: Math.round(sdDocConfidence * 100),
            issuesFound: dedupedSdDocIssues as unknown as Prisma.InputJsonValue,
            checksPerformed: [
              'software_delivery_document',
              'proof_core_verifyapi',
            ] as Prisma.InputJsonValue,
            outputSummary: sdDocSummary,
          },
        );
        const sdDocProof = await this.proofService.createProof(
          orgId,
          sdDocRun.id,
          ProofProduct.DOCUMENT_VERIFY,
          ProofSubject.DOCUMENT,
          sdDocSummary,
          [
            {
              source: 'software_delivery_document',
              source_type: 'software_delivery',
              fields_reviewed: presentFields,
              submitted_output: body.output,
              issues_found: dedupedSdDocIssues,
              proof_core_report: sdProofReport,
              verification_status: sdDocStatus,
              risk_level: sdDocRisk,
              checked_at: new Date().toISOString(),
            },
          ] as unknown as Prisma.InputJsonValue,
          sdDocFinalDecision,
        );
        const sdDocChainHash = sdDocProof.chain_hash ?? null;

        return {
          status: sdDocStatus,
          verification_status: sdDocStatus,
          confidence: Math.round(sdDocConfidence * 100) / 100,
          risk_level: sdDocRisk,
          proof_id: sdDocProof.id,
          chain_hash: sdDocChainHash,
          tier_run: 'DOCUMENT',
          job_type: 'DOCUMENT_DELIVERY',
          escalated: false,
          escalation_reason: null,
          summary: sdDocSummary,
          checks_passed: sdProofReport.controls.passed.length,
          checks_failed: sdProofReport.controls.failed.length,
          checks_warning: dedupedSdDocIssues.filter((i) => i.severity === 'warning').length,
          checks_skipped: sdControlsSkipped.length,
          evidence_gaps: [...new Set(sdEvidenceGaps)],
          controls_skipped: sdControlsSkipped,
          controls: proofReportControls(sdProofReport),
          issues_found: dedupedSdDocIssues.map((i) => ({
            check_id: i.rule,
            check_name: i.rule,
            status: i.severity === 'critical' ? 'FAIL' : 'WARNING',
            detail: i.message,
            evidenceRefs: i.evidenceRefs ?? [],
            source_passage: i.source_passage ?? null,
          })),
          recommended_action: sdDocRecommendedAction,
          findings: dedupedSdDocIssues.map((i) => ({
            rule: i.rule,
            severity: i.severity,
            message: i.message,
            source: i.rule?.startsWith('proof_core:') ? 'proof_core' : null,
            recommended_action: (i as Record<string, unknown>)['recommended_action'] ?? null,
            evidenceRefs: i.evidenceRefs ?? [],
            source_passage: i.source_passage ?? null,
          })),
          results: sdProofReport.findings,
        };
      }

      const dto = plainToInstance(SoftwareDeliveryVerifyDto, (body.output as object) ?? {});
      const validationErrors = await validate(dto);
      if (validationErrors.length > 0) {
        throw new BadRequestException(buildSoftwareDeliveryValidationError(validationErrors, body));
      }

      // Demo cache: identical (repo, commit pair, tier, jobType) inputs from an
      // anonymous caller return the prior result without touching GitHub or the
      // shared anonymous quota. Never applied to authenticated callers — a real
      // customer must always get a fresh check against their own repo state.
      const demoCacheKey = user ? null : demoSoftwareDeliveryCacheKey(outputAsObj);
      if (demoCacheKey) {
        const cached = getDemoSoftwareDeliveryCache(demoCacheKey);
        if (cached) return cached;
      }

      const sdLimit = await this.resolveSoftwareDeliveryMonthlyLimit(orgId);
      // Atomically claim quota + enforce the 429 in one step (no check-then-act
      // race). A claimed unit is consumed even if verification later throws —
      // consistent with the per-IP demo quota which also increments up front.
      await this.verifyApiUsage.reserve(orgId, SOFTWARE_DELIVERY_USAGE_PRODUCT, sdLimit);

      // Anonymous demo callers always run the fixed read-only GitHub check set,
      // regardless of what `rules`/`tier` they submitted — auto-expansion by tier
      // is only trusted for authenticated callers.
      const requestedChecks = user
        ? ((body.rules as string[]) ?? ['auto'])
        : [...DEMO_SOFTWARE_DELIVERY_ALLOWED_CHECKS];
      const result = await this.softwareDelivery.verify(dto, requestedChecks, {
        organizationId: orgId,
      });

      const sdRiskLevel =
        result.confidence < 0.5 ? 'high' : result.confidence < 0.75 ? 'medium' : 'low';
      // Use computeContentHash over content+evidence so the chain_hash is
      // tamper-evident (bound to delivered content), not merely derivable from the
      // proof id alone. Includes prevChainHash as an empty-string sentinel for SD
      // proofs (they are not chained to the org ledger).
      const sdChainHash = computeContentHash({
        proofId: result.proofId,
        deliveryPayload: body.output,
        evidence: body.evidence ?? null,
        prevChainHash: '',
      });

      const sdResponse = {
        verification_status: result.verificationStatus,
        verification_id: result.verificationId,
        confidence: result.confidence,
        risk_level: sdRiskLevel,
        proof_id: result.proofId,
        chain_hash: sdChainHash,
        tier_run: result.tierRun,
        job_type: result.jobType,
        escalated: result.escalated,
        escalation_reason: result.escalationReason,
        summary: result.summary,
        checks_passed: result.checksPassed,
        checks_failed: result.checksFailed,
        checks_warning: result.checksWarning,
        checks_skipped: result.checksSkipped,
        issues_found: result.issuesFound.map((i) => ({
          check_id: i.checkId,
          check_name: i.checkName,
          status: i.status,
          detail: i.detail,
        })),
        findings: result.issuesFound.map((i) => ({
          rule: i.checkId,
          severity: i.status === 'FAIL' ? 'critical' : i.status === 'WARNING' ? 'warning' : 'info',
          message: i.detail ?? i.checkName,
        })),
        recommended_action: result.recommendedAction,
        results: result.results.map((r) => ({
          check_id: r.checkId,
          check_name: r.checkName,
          status: r.status,
          detail: r.detail,
          duration_ms: r.durationMs,
          evidence: r.evidence,
        })),
      };
      if (demoCacheKey) setDemoSoftwareDeliveryCache(demoCacheKey, sdResponse);
      return sdResponse;
    }

    const orgId = await this.resolveOrgForUser(user);

    // Enforce monthly verification quota before queuing.
    // Also resolves the plan slug so the proof retention window can be set at creation time.
    let resolvedPlanSlug: string | undefined;
    let overageBillable: { planSlug: string; overageCents: number } | null = null;
    {
      const now = new Date();
      let plan = resolveVerifyApiPlan('free');
      let periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
      let limit: number | null = plan.monthlyRuns;
      // FIX 3 (H4): derive product type from body.task so quota is checked
      // against the correct ProofProductEntitlement row (INVOICE_PROOF /
      // AUDIT_PROOF / VERIFY_API). Falls back to VERIFY_API when no derived
      // entitlement exists, then to the subscription / anonymous default.
      const derivedProductType: ProofProductType =
        body.task === 'invoice_extraction'
          ? ProofProductType.INVOICE_PROOF
          : body.task === 'audit_proof' ||
              body.task === 'agent_activity' ||
              body.task === 'workflow_event' ||
              body.task === 'document'
            ? ProofProductType.AUDIT_PROOF
            : ProofProductType.VERIFY_API;

      if (user && orgId !== ANONYMOUS_ORG_ID) {
        // Try the task-derived product first; fall back to VERIFY_API when the
        // org holds no entitlement for the derived type.
        let resolvedProductType = derivedProductType;
        let proofQuota = await this.proofBilling.resolveProofQuota(orgId, derivedProductType);
        if (
          proofQuota.source !== 'entitlement' &&
          derivedProductType !== ProofProductType.VERIFY_API
        ) {
          proofQuota = await this.proofBilling.resolveProofQuota(
            orgId,
            ProofProductType.VERIFY_API,
          );
          resolvedProductType = ProofProductType.VERIFY_API;
        }
        if (proofQuota.source === 'entitlement') {
          plan = resolveVerifyApiPlan(proofQuota.planSlug);
          limit = proofQuota.monthlyLimit;
          const entitlement = await this.proofBilling.getActiveProofEntitlement(
            orgId,
            resolvedProductType,
          );
          if (entitlement?.periodStart) {
            periodStart = entitlement.periodStart;
          }
        } else {
          const sub = await this.prisma.organizationSubscription.findUnique({
            where: { organizationId: orgId },
          });
          if (sub && sub.status === SubscriptionStatus.ACTIVE) {
            plan = resolveVerifyApiPlan(sub.planSlug);
            limit = plan.monthlyRuns;
            periodStart = sub.currentPeriodStart;
          }
        }
      } else {
        limit = 500;
      }
      const used = await this.prisma.verificationRun.count({
        where: { orgId, createdAt: { gte: periodStart } },
      });
      if (typeof limit === 'number' && used >= limit) {
        if (
          plan.overageCents !== null &&
          verifyApiMeteredOverageEnabled() &&
          (await this.proofBilling.isVerifyApiMeteredOverageReady(orgId, plan.slug))
        ) {
          overageBillable = { planSlug: plan.slug, overageCents: plan.overageCents };
        } else {
          throw new HttpException(
            `Monthly verification limit reached (${used}/${limit}). Upgrade to Pro for higher limits.`,
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }
      }
      // Capture for proof retention window resolution.
      resolvedPlanSlug = plan.slug !== 'free' ? plan.slug : undefined;
    }

    // Validate payload sizes BEFORE any DB write to avoid partial VerificationRun records.
    const proofEvidence =
      body.evidence !== undefined
        ? Array.isArray(body.evidence)
          ? body.evidence
          : [body.evidence]
        : [];
    if (JSON.stringify(proofEvidence).length > 100_000) {
      throw new BadRequestException('evidence payload exceeds 100KB limit');
    }
    // L-4: per-string MaxLength(10000) guard on evidence items — prevents a
    // single oversized string from inflating the AI prompt or the chain hash.
    const EVIDENCE_STRING_MAX_LENGTH = 10_000;
    const oversizedEvidence = collectStringValues(proofEvidence).find(
      (s) => s.length > EVIDENCE_STRING_MAX_LENGTH,
    );
    if (oversizedEvidence !== undefined) {
      throw new BadRequestException(
        `Each evidence string must not exceed ${EVIDENCE_STRING_MAX_LENGTH} characters`,
      );
    }

    const sourceType = mapSourceType(body.source_type);
    const { product, subject } = mapTaskToProduct(body.task);
    const inputSummary = body.task
      ? `Task: ${String(body.task).slice(0, 200)}`
      : `API verification submitted via POST /api/verify`;

    // Step 1: create the run in QUEUED state.
    const run = await this.verificationService.queueVerification(
      orgId,
      product,
      sourceType,
      inputSummary,
    );
    const overageUsageEvent = overageBillable
      ? await this.proofBilling.createVerifyApiOverageEvent({
          organizationId: orgId,
          verificationRunId: run.id,
          planSlug: overageBillable.planSlug,
          overageCents: overageBillable.overageCents,
        })
      : null;
    if (overageUsageEvent) {
      this.proofBilling.reportUsageEventToStripeBestEffort(overageUsageEvent.id);
    }

    // Step 2: advance through PROCESSING → terminal using inline check logic.
    const rules = Array.isArray(body.rules) ? body.rules : [];
    const issues: Array<{ rule?: string; severity?: string; message?: string }> = [];

    if (rules.length > 0 && (typeof body.output !== 'object' || body.output === null)) {
      const fieldRules = rules.filter(
        (rule): rule is string => typeof rule === 'string' && FIELD_RULES.has(rule),
      );
      if (fieldRules.length > 0) {
        issues.push({
          rule: 'output_must_be_object',
          severity: 'warning',
          message:
            'Structured field rules require a JSON object output; text output cannot be verified against those rules.',
        });
      }
    } else if (typeof body.output === 'object' && body.output !== null) {
      const outputObj = body.output as Record<string, unknown>;
      // If no recognized rules were provided, run a minimum sanity check so an
      // empty rules[] array can never trivially return passed + 95% confidence.
      const effectiveRules = rules.filter(
        (r): r is string => typeof r === 'string' && FIELD_RULES.has(r),
      );
      if (effectiveRules.length === 0) {
        const sanityIssue = evaluateStringRule(
          'required_fields_present',
          outputObj,
          proofEvidence,
          body.task,
        );
        if (sanityIssue) issues.push(sanityIssue);
      }
      for (const rule of effectiveRules) {
        // Named string rules — dispatched to the evaluator above
        const issue = evaluateStringRule(rule, outputObj, proofEvidence, body.task);
        if (issue) issues.push(issue);
      }
      // Legacy object-shaped rules: { required: true, field: 'fieldName' }
      for (const rule of rules) {
        if (typeof rule === 'object' && rule !== null) {
          const r = rule as Record<string, unknown>;
          if (r.required === true && typeof r.field === 'string') {
            if (outputObj[r.field] === undefined || outputObj[r.field] === null) {
              issues.push({
                rule: r.field,
                severity: 'warning',
                message: `Required field "${r.field}" is missing from output`,
              });
            }
          }
        }
      }
      issues.push(...evaluateEvidenceConsistency(outputObj, proofEvidence));
      if (isInvoiceExtractionTask(body.task)) {
        issues.push(...evaluateInvoiceEvidence(outputObj, proofEvidence));
      }
    }

    // Automatic safety scans — always-on regardless of rules array. These
    // back the marketed headline use cases (privacy/PII verification and
    // citation-resolution / "no hallucinated references").
    issues.push(...detectPiiLeak(body.output));
    // Skip hallucinated-citation detection for audit_proof / source_type=audit_proof.
    // Policy documents consist entirely of self-referential section citations — every
    // "Section N" in the output refers to content within the same submitted document,
    // not an external reference that could be hallucinated. Running the detector on
    // audit_proof payloads produces critical false positives for every section number.
    const isAuditProofTask = body.task === 'audit_proof' || body.source_type === 'audit_proof';
    if (!isAuditProofTask) {
      issues.push(...detectHallucinatedCitations(body.output, proofEvidence));
    }

    // AuditProof deterministic controls run before AI so degraded mode can return
    // proof_core results when the LLM is unavailable (FIX-04).
    let auditEvidenceGaps: string[] = [];
    let auditControlsSkipped: ControlSkipped[] = [];
    let auditProofReport: ProofReport | null = null;
    if (isAuditProofTask) {
      const auditOutputObj =
        typeof body.output === 'object' && body.output !== null
          ? (body.output as Record<string, unknown>)
          : {};
      auditProofReport = await runProofProduct({
        product: 'auditproof',
        evidenceInputs: buildProofCoreEvidenceInputs(body.output, body.evidence, 'auditproof'),
      });
      issues.push(...proofReportToRuleIssues(auditProofReport, 'proof_core'));
      const auditReadiness = assessAuditProofReadiness(auditOutputObj);
      auditEvidenceGaps = [
        ...auditReadiness.evidence_gaps,
        ...auditProofReport.missing_evidence.map(
          (missing) => `Provide ${missing} so deterministic AuditProof controls can run.`,
        ),
      ];
      auditControlsSkipped = [
        ...auditReadiness.controls_skipped,
        ...proofReportSkippedControls(auditProofReport),
      ];
      for (const gap of auditControlsSkipped) {
        issues.push({
          rule: `needs_more_evidence:${gap.controlId}`,
          severity: 'warning',
          message: `NEEDS_MORE_EVIDENCE — ${gap.reason}`,
        });
      }
    }

    // AI semantic analysis — fail-closed: if the LLM is unavailable (network, auth,
    // quota, timeout) return 503 / needs_review rather than silently passing (PRB-LLM-FAIL-OPEN).
    const aiResult = await this.aiAnalysis.analyze(body.task, body.output);
    if (aiResult.llm_unavailable) {
      if (isAuditProofTask && auditProofReport) {
        this.logger.warn(
          `LLM unavailable for audit_proof run ${run.id} — returning proof_core-only degraded result`,
        );
        issues.push({
          rule: 'ai:unavailable',
          severity: 'warning',
          message:
            'AI semantic analysis temporarily unavailable — deterministic AuditProof controls were still evaluated.',
        });
      } else {
        this.logger.error(
          `LLM unavailable for verification run ${run.id} — returning needs_review (fail-closed)`,
        );
        // Clean up the QUEUED run so it doesn't orphan in the DB.
        try {
          await this.verificationService.updateVerificationStatus(
            run.id,
            orgId,
            ProofRunStatus.PROCESSING,
          );
          await this.verificationService.updateVerificationStatus(
            run.id,
            orgId,
            ProofRunStatus.NEEDS_REVIEW,
            {
              outputSummary: 'Verification temporarily unavailable — LLM service unreachable.',
            },
          );
        } catch {
          // Best-effort DB update; do not mask the 503.
        }
        throw new HttpException(
          {
            status: 'needs_review',
            risk: 'unknown',
            confidence: 0,
            message: 'Verification temporarily unavailable. Please retry or contact support.',
            findings: [],
          },
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
    }
    if (!aiResult.llm_unavailable) {
      const proofCoreContradictsCleanAi = issues.some(
        (i) =>
          (i.rule?.startsWith('proof_core:') || i.rule?.startsWith('needs_more_evidence:')) &&
          (i.severity === 'critical' || i.severity === 'warning' || i.severity === 'high'),
      );
      for (const aiIssue of aiResult.issues) {
        const normalizedAiIssue = normalizeAiIssueSeverityForTask(
          body.task,
          body.output,
          proofEvidence,
          aiIssue,
        );
        if (!normalizedAiIssue) continue;
        if (proofCoreContradictsCleanAi && /no_?issues/i.test(normalizedAiIssue.rule)) {
          continue;
        }
        issues.push({
          rule: `ai:${normalizedAiIssue.rule}`,
          severity: normalizedAiIssue.severity,
          message: normalizedAiIssue.message,
          ...(normalizedAiIssue.recommended_action
            ? { recommended_action: normalizedAiIssue.recommended_action }
            : {}),
        });
      }
    }

    // Critical bank-account-change detection (deterministic gate) — see
    // detectCriticalBankChange. Must HARD BLOCK rather than fall through to
    // needs_review. Runs independent of the AI layer so the verdict is stable.
    const isCriticalBankChange = detectCriticalBankChange(body.output, body.task, issues);
    if (isCriticalBankChange) {
      issues.push({
        rule: 'BANK_CHANGE_HIGH_RISK',
        severity: 'critical',
        message:
          'BANK_CHANGE_HIGH_RISK — bank/payment detail change on a high-risk event requires Compliance and Treasury review; automation blocked.',
      });
    }

    // H-6: Deterministic staging-environment detector. Fires when the delivery
    // explicitly identifies the TARGET environment as staging/UAT/pre-production.
    // Does NOT fire when "staging" appears only in rollback, comparison, historical,
    // or git-branch context (e.g. "rollback to staging tag", "from staging to
    // production", "staging tests completed"). Also suppressed when the delivery
    // contains explicit production-confirmation signals. Runs regardless of AI
    // availability so the check is stable even when the LLM is unavailable.
    if (body.source_type === 'software_delivery' || body.task === 'software_delivery') {
      // Patterns that positively identify the target environment as staging/UAT.
      // Requires contextual coupling (preposition + word) so the bare word "staging"
      // in a rollback plan or historical reference doesn't trigger the rule.
      const STAGING_TARGET_RE =
        /(?:deployed?\s+to\s+(?:staging|uat|pre-?production)|deployment\s+to\s+(?:staging|uat|pre-?production)|environment\s*[:=]\s*(?:staging|uat|pre-?production)|(?:staging|uat|pre-?production)\s+environment\s+is\s+now|running\s+on\s+(?:staging|uat|pre-?production)|not\s+yet\s+deployed\s+to\s+production|target\s+environment\s*[:=]\s*(?:staging|uat|pre-?production))/i;
      // Explicit production-confirmation signals — if present, suppress the flag
      // even if a staging pattern also matched (e.g. "deployed to prod; rolled back
      // from staging" is a production delivery).
      const PRODUCTION_CONFIRM_RE =
        /(?:deployed?\s+to\s+production|environment\s*[:=]\s*production|NODE_ENV\s*[:=]\s*["']?production["']?|running\s+on\s+production|production\s+deployment\s+(?:complete|successful|confirmed))/i;
      const allDeliveryStrings = collectStringValues(body.output);
      const deliveryBlob = allDeliveryStrings.join('\n');
      const hasStagingTarget = STAGING_TARGET_RE.test(deliveryBlob);
      const hasProductionConfirmation = PRODUCTION_CONFIRM_RE.test(deliveryBlob);
      if (hasStagingTarget && !hasProductionConfirmation) {
        issues.push({
          rule: 'STAGING_DEPLOYMENT_AS_PRODUCTION',
          severity: 'critical',
          message:
            'STAGING_DEPLOYMENT_AS_PRODUCTION — delivery describes a staging/pre-production environment; production deployment required before acceptance.',
        });
      }
    }

    // H-7: Deterministic unidirectional-sync detector. Fires when requirements or
    // evidence specify bidirectional sync but the delivery output only confirms one
    // direction (indicated by a directional arrow "→" or the word "only").
    // Extended: also checks output.integration_scope for the bidirectional
    // requirement (callers often paste their scope doc there rather than in
    // evidence), and fires a fallback when integration_scope declares bidirectional
    // but no delivery field confirms both directions.
    //
    // Bug 3 fix:
    // (1) UNIDIR_RE is only tested against delivery fields (delivery_statement,
    //     deployment_report, release_notes, change_log) — NOT against
    //     integration_scope which contains requirements, not delivery confirmation.
    //     A requirement saying "X sync REQUIRED" must not be read as a unidirectional
    //     delivery signal.
    // (2) Fallback violation is suppressed when the delivery fields contain explicit
    //     R-001 DELIVERED / bidirectional-delivered confirmation patterns, even if
    //     the BIDIR_RE synonym is absent.
    if (body.source_type === 'software_delivery' || body.task === 'software_delivery') {
      const BIDIR_RE =
        /\b(bidirectional|two-?way\s+sync|two\s+way\s+sync|sync\s+in\s+both\s+directions|bi-directional)\b/i;
      const UNIDIR_RE =
        /(→|->|one[\s-]way|unidirectional|one\s+direction\s+only|\bonly\b.*sync|sync.*\bonly\b)/i;
      // Pattern that explicitly confirms bidirectional delivery — suppresses
      // fallbackViolation even when the BIDIR_RE synonym is missing from the
      // delivery fields (Bug 3 fix — handles "R-001: DELIVERED" style confirmations).
      const BIDIR_DELIVERED_RE =
        /(?:R-?0*1\b.*\bDELIVERED|bidirectional.*delivered|delivered.*bidirectional|two.?way.*delivered|delivered.*two.?way|sync.*DELIVERED|DELIVERED.*sync)/i;

      const evidenceBlob = collectStringValues(proofEvidence).join('\n');
      const outputAsObjH7 =
        typeof body.output === 'object' && body.output !== null
          ? (body.output as Record<string, unknown>)
          : {};
      // Check both named requirements fields AND integration_scope (callers paste
      // scope docs there when evidence is not separately provided).
      // integration_scope contains REQUIREMENTS — use only for bidir requirement detection.
      const requirementsBlob = collectStringValues(
        outputAsObjH7['contract_scope'] ??
          outputAsObjH7['requirements'] ??
          outputAsObjH7['acceptance_criteria'] ??
          '',
      ).join('\n');
      const integrationScopeBlob = collectStringValues(
        outputAsObjH7['integration_scope'] ?? '',
      ).join('\n');
      const hasBidirRequirement =
        BIDIR_RE.test(evidenceBlob) ||
        BIDIR_RE.test(requirementsBlob) ||
        BIDIR_RE.test(integrationScopeBlob);

      // Delivery fields only — UNIDIR_RE must NOT be tested against integration_scope
      // (which describes requirements, not what was delivered). Bug 3 fix (1).
      const SD_DELIVERY_FIELDS = [
        'delivery_statement',
        'deployment_report',
        'release_notes',
        'change_log',
      ] as const;
      const deliveryFieldBlob = collectStringValues(
        SD_DELIVERY_FIELDS.map((f) => outputAsObjH7[f] ?? ''),
      ).join('\n');

      // Test unidirectional delivery marker only against delivery fields.
      const hasUnidirDelivery =
        deliveryFieldBlob.trim().length > 0 && UNIDIR_RE.test(deliveryFieldBlob);

      const deliveryConfirmsBidir = BIDIR_RE.test(deliveryFieldBlob);
      // Bug 3 fix (2): also suppress fallback when delivery fields contain an
      // explicit R-001-DELIVERED or "bidirectional delivered" confirmation.
      const deliveryExplicitlyConfirmsBidir =
        deliveryConfirmsBidir || BIDIR_DELIVERED_RE.test(deliveryFieldBlob);
      const integrationScopeHasBidir = BIDIR_RE.test(integrationScopeBlob);
      const fallbackViolation =
        integrationScopeHasBidir &&
        !deliveryExplicitlyConfirmsBidir &&
        deliveryFieldBlob.trim().length > 0;

      if ((hasBidirRequirement && hasUnidirDelivery) || fallbackViolation) {
        issues.push({
          rule: 'UNIDIRECTIONAL_SYNC_VIOLATION',
          severity: 'critical',
          message:
            'UNIDIRECTIONAL_SYNC_VIOLATION — contract requires bidirectional sync but delivery only confirms one direction; full sync not delivered.',
        });
      }
    }

    const dedupedIssues = dedupeRuleIssues(issues);
    const finalStatus = deriveStatus(dedupedIssues);
    // A confirmed critical bank-account change is a hard block, distinct from a
    // generic FAILED verdict — surfaced to callers as status:'blocked'.
    const isBlocked = isCriticalBankChange;

    // Escalate to HIGH if submitted business_risk is high/critical or human approval is required
    // without a recorded approver — regardless of rule-check results.
    const submittedRisk =
      typeof body.output === 'object' && body.output !== null
        ? String((body.output as Record<string, unknown>)['business_risk'] ?? '').toLowerCase()
        : '';
    const isHighBusinessRisk = submittedRisk === 'high' || submittedRisk === 'critical';
    const outputObj2 =
      typeof body.output === 'object' && body.output !== null
        ? (body.output as Record<string, unknown>)
        : {};
    const approvalRequired = outputObj2['human_approval_required'];
    const isMissingApproval =
      (approvalRequired === true || approvalRequired === 'true' || approvalRequired === 'yes') &&
      !outputObj2['human_approver'];

    const aiRiskHigh = aiResult.risk_assessment === 'high';
    // When no issues were found, risk must be LOW regardless of AI sentiment —
    // a "high risk" label with zero supporting issues is contradictory and
    // produces false positives on valid invoices (Kraken VALID-001 false positive).
    const riskLevel =
      dedupedIssues.length === 0
        ? ProofRiskLevel.LOW
        : isHighBusinessRisk || isMissingApproval || aiRiskHigh
          ? ProofRiskLevel.HIGH
          : dedupedIssues.some((i) => i.severity === 'critical')
            ? ProofRiskLevel.HIGH
            : ProofRiskLevel.MEDIUM;

    // H-5: when 3+ critical issues are present, cap confidence at 40 (≤0.40 after
    // normaliseConfidence). The formula `95 - n*15` already reaches 40 at 4 issues
    // but stays at 50 for exactly 3 — the explicit critical-count cap closes that gap.
    const criticalIssueCount = dedupedIssues.filter((i) => i.severity === 'critical').length;
    const confidenceIntRaw =
      dedupedIssues.length === 0
        ? 95
        : criticalIssueCount >= 3
          ? Math.min(40, Math.max(5, 95 - dedupedIssues.length * 15))
          : Math.max(40, 95 - dedupedIssues.length * 15);
    // Deterministically cap acceptable-confidence at 40 (≤0.40 normalized) when
    // major audit-control evidence is absent — never report audit-ready while a
    // must-check control could not run. Cap can only lower the value.
    const confidenceInt =
      auditProofReport !== null
        ? Math.round(
            Math.min(auditProofReport.confidence, normaliseConfidence(confidenceIntRaw)) * 100,
          )
        : auditControlsSkipped.length > 0
          ? Math.min(40, confidenceIntRaw)
          : confidenceIntRaw;

    // Transition QUEUED → PROCESSING
    await this.verificationService.updateVerificationStatus(
      run.id,
      orgId,
      ProofRunStatus.PROCESSING,
    );

    // Transition PROCESSING → terminal
    const completedRun = await this.verificationService.updateVerificationStatus(
      run.id,
      orgId,
      finalStatus,
      {
        riskLevel,
        confidence: confidenceInt,
        issuesFound: dedupedIssues as unknown as Prisma.InputJsonValue,
        checksPerformed: [
          ...(rules.length > 0 ? rules : ['output_present']),
          ...(auditProofReport ? ['proof_core_auditproof'] : []),
        ] as Prisma.InputJsonValue,
        outputSummary: aiResult.ai_summary
          ? aiResult.ai_summary
          : dedupedIssues.length === 0
            ? 'All checks passed'
            : `${dedupedIssues.length} issue(s) found`,
      },
    );

    // Step 3: create the ProofRecord (run must be in terminal status).
    const finalDecision =
      finalStatus === ProofRunStatus.PASSED
        ? ProofFinalDecision.APPROVED
        : finalStatus === ProofRunStatus.FAILED
          ? ProofFinalDecision.REJECTED
          : ProofFinalDecision.ESCALATED;
    const canonicalProofEvidence = [
      {
        source: 'api_verify_submission',
        task: body.task ?? null,
        source_type: body.source_type,
        submitted_output: body.output,
        rules_requested: rules,
        issues_found: dedupedIssues,
        proof_core_report: auditProofReport,
        verification_status: statusToApi(finalStatus),
        risk_level: completedRun.riskLevel.toLowerCase(),
        checked_at: new Date().toISOString(),
      },
      ...proofEvidence,
    ];

    const proof = await this.proofService.createProof(
      orgId,
      run.id,
      product,
      subject,
      completedRun.outputSummary ?? 'Verification complete',
      canonicalProofEvidence as unknown as Prisma.InputJsonValue,
      finalDecision,
      resolvedPlanSlug,
    );
    if (overageUsageEvent) {
      await this.proofBilling.attachProofIdToUsageEvent({
        organizationId: orgId,
        verificationRunId: run.id,
        proofId: proof.id,
      });
    }

    // For audit_proof tasks, dispatch a Conduit verification job.
    let conduitProofId: string | undefined;
    if (body.task === 'audit_proof') {
      const rawContent =
        typeof body.output === 'object' && body.output !== null
          ? JSON.stringify(body.output)
          : String(body.output ?? '');
      try {
        const { conduitVerificationId } = await this.conduitVerification.dispatchAuditProof({
          proofId: proof.id,
          orgId,
          summary: completedRun.outputSummary ?? 'Audit verification',
          content: rawContent,
        });
        conduitProofId = conduitVerificationId;
        // Persist conduit_proof_id to the ProofRecord so it survives retrieval/export.
        if (conduitProofId) {
          await this.prisma.proofRecord.update({
            where: { id: proof.id },
            data: { conduit_proof_id: conduitProofId },
          });
        }
      } catch {
        // Non-fatal: proof was created; Conduit dispatch failure is logged in dispatchAuditProof
      }
    }

    let claim_token: string | undefined;
    if (orgId === ANONYMOUS_ORG_ID) {
      claim_token = this.proofClaim.generateClaimToken();
      await this.prisma.verificationRun.update({
        where: { id: run.id },
        data: { claimToken: claim_token },
      });
    }

    const apiStatus = isBlocked ? 'blocked' : statusToApi(finalStatus);
    return {
      verification_id: run.id,
      proof_id: proof.id,
      ...(claim_token ? { claim_token } : {}),
      // `status` mirrors `verification_status`; both carry 'blocked' for a
      // critical bank-account change so either field satisfies callers.
      status: apiStatus,
      verification_status: apiStatus,
      confidence: normaliseConfidence(confidenceInt),
      risk_level: completedRun.riskLevel.toLowerCase(),
      issues_found: dedupedIssues.map((i) => i.message ?? i.rule ?? '').filter(Boolean),
      issue_codes: dedupedIssues.map((i) => i.rule ?? '').filter(Boolean),
      recommended_action: isBlocked ? 'blocked' : recommendedAction(riskLevel, finalStatus),
      // Structured findings with per-issue remediation steps for callers that
      // want more than the flat issues_found string array.
      findings: dedupedIssues.map((i) => ({
        rule: i.rule ?? null,
        severity: i.severity ?? null,
        message: i.message ?? null,
        remediation_steps: ((i as Record<string, unknown>)['recommended_action'] as string) ?? null,
      })),
      chain_hash: proof.chain_hash ?? undefined,
      conduit_proof_id: conduitProofId ?? null,
      // Evidence-readiness surface (additive — present on every response so
      // consumers can branch on missing-evidence without breaking existing
      // fields). Empty arrays when no must-check control was skipped.
      evidence_gaps: auditEvidenceGaps,
      controls_skipped: auditControlsSkipped,
      ...(auditProofReport
        ? {
            controls: proofReportControls(auditProofReport),
            results: auditProofReport.findings,
          }
        : {}),
      ...(proof.proof_signature
        ? {
            proof_signature: proof.proof_signature,
            signing_public_key: process.env['PROOF_SIGNING_PUBLIC_KEY'] ?? undefined,
          }
        : {}),
    };
  }

  // ---------------------------------------------------------------------------
  // GET /api/verify/:id
  // Fetch a saved VerificationRun by id.
  // ---------------------------------------------------------------------------

  @Get('verify/:id')
  @Public()
  @ApiOperation({ summary: 'Fetch a verification run by ID' })
  async getVerify(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser | null | undefined,
  ) {
    // Software-delivery verifications live in their own table keyed by proofId.
    // Resolve those first so a proof_id returned by POST /api/verify
    // (source_type: software_delivery) is retrievable here.
    const sd = await this.prisma.softwareDeliveryVerification.findUnique({
      where: { proofId: id },
      include: { results: true },
    });
    if (sd) return this.formatSoftwareDeliveryRecord(sd);

    const orgId = await this.resolveOrgForUser(user);
    const run = await this.verificationService.getVerificationRun(orgId, id);

    return {
      verification_id: run.id,
      org_id: run.orgId,
      product: run.product,
      source_type: run.sourceType,
      verification_status: statusToApi(run.status as ProofRunStatus),
      risk_level: run.riskLevel.toLowerCase(),
      confidence:
        run.confidence !== null && run.confidence !== undefined
          ? normaliseConfidence(run.confidence)
          : null,
      input_summary: run.inputSummary,
      output_summary: run.outputSummary ?? null,
      issues_found: Array.isArray(run.issuesFound) ? run.issuesFound : [],
      checks_performed: Array.isArray(run.checksPerformed) ? run.checksPerformed : [],
      created_at: run.createdAt,
      updated_at: run.updatedAt,
    };
  }

  // ---------------------------------------------------------------------------
  // GET /api/proof
  // List proof records for the caller. Anonymous callers see recent sandbox
  // records only; authenticated callers are scoped to their organization.
  // MUST be declared before GET /api/proof/:id to avoid route shadowing.
  // ---------------------------------------------------------------------------

  @Get('proof')
  @Public()
  @Throttle({ default: { ttl: 60000, limit: 60 } })
  @ApiOperation({ summary: 'List proof records for the caller or public sandbox' })
  async listProofRecords(
    @CurrentUser() user: AuthenticatedUser | null | undefined,
    @Query('product') product?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const parsedProduct = parseOptionalProofProduct(product);
    const parsedLimit = parseListNumber(limit, 20, 1, 50);
    const parsedOffset = parseListNumber(offset, 0, 0, 10_000);

    if (!user) {
      return this.proofService.listAnonymousProofSummaries({
        product: parsedProduct,
        limit: parsedLimit,
        offset: parsedOffset,
      });
    }

    const orgId = await this.resolveOrgForUser(user);
    const result = await this.proofService.listProofs(
      orgId,
      parsedProduct,
      undefined,
      undefined,
      parsedLimit,
      parsedOffset,
    );

    return {
      data: result.proofs.map((proof) => ({
        id: proof.id,
        proof_id: proof.id,
        verificationRunId: proof.verificationRunId,
        verification_id: proof.verificationRunId,
        product: proof.product,
        subject: proof.subject,
        summary: proof.summary,
        finalDecision: proof.finalDecision,
        final_decision: proof.finalDecision,
        proofStatus: proof.proofStatus,
        proof_status: proof.proofStatus,
        ...invoiceProofDashboardFields(
          proof.verificationRun.riskLevel,
          proof.verificationRun.issuesFound,
        ),
        chain_hash: proof.chain_hash ?? null,
        createdAt: proof.createdAt,
        created_at: proof.createdAt,
      })),
      total: result.total,
      limit: parsedLimit,
      offset: parsedOffset,
    };
  }

  @Get('proofs/public')
  @Public()
  @Throttle({ default: { ttl: 60000, limit: 60 } })
  @ApiOperation({ summary: 'List recent public sandbox proof records' })
  async listPublicProofs(
    @Query('product') product?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.proofService.listAnonymousProofSummaries({
      product: parseOptionalProofProduct(product),
      status: parseOptionalProofRunStatus(status),
      limit: parseListNumber(limit, 20, 1, 50),
      offset: parseListNumber(offset, 0, 0, 10_000),
    });
  }

  // ---------------------------------------------------------------------------
  // GET /api/proof/:id/export/pdf
  // Generate and stream a PDF of a ProofRecord.
  // MUST be declared before GET /api/proof/:id to avoid Express treating
  // the literal "export" segment as the :id parameter.
  // ---------------------------------------------------------------------------

  @Get('proof/:id/export/pdf')
  @Public()
  @Throttle({ default: { ttl: 60000, limit: 60 } })
  @ApiOperation({ summary: 'Export a proof record as a downloadable PDF' })
  async exportProofAsPdf(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser | null | undefined,
    @Res() res: Response,
  ) {
    const { proof, verification } = await this.proofService.getProofWithVerificationRunUnscoped(id);

    if (!proof) {
      throw new NotFoundException(`ProofRecord ${id} not found`);
    }

    // Retention gate.
    if (isRetentionExpired(proof)) {
      throw new HttpException(
        'This proof has been archived or expired per the retention policy.',
        HttpStatus.GONE,
      );
    }

    // Determine ownership.
    const callerOrgId = user ? await this.resolveOrgForUser(user) : null;
    const isOwner =
      callerOrgId !== null && callerOrgId !== ANONYMOUS_ORG_ID && callerOrgId === proof.orgId;

    // Wrong-org authenticated user → 404.
    if (user && callerOrgId !== null && callerOrgId !== ANONYMOUS_ORG_ID && !isOwner) {
      throw new NotFoundException(`ProofRecord ${id} not found`);
    }

    // Dynamic import keeps pdfkit out of the module-load critical path.
    const PDFDocument = (await import('pdfkit')).default;
    const doc = new PDFDocument({ margin: 50 });

    res.setHeader('Content-Type', 'application/pdf');

    if (!isOwner) {
      // Public caller — emit a clearly-labelled redacted public summary PDF.
      // Does NOT include raw evidence, model output, or financial details.
      res.setHeader('Content-Disposition', `attachment; filename="proof-${id}-public-summary.pdf"`);
      doc.pipe(res);

      doc
        .fontSize(18)
        .font('Helvetica-Bold')
        .text('SwarmSync Proof — Public Summary', { align: 'center' });
      doc.moveDown(0.5);
      doc
        .fontSize(9)
        .font('Helvetica')
        .fillColor('#cc6600')
        .text(
          'REDACTED — Full proof available to authenticated members of the owning organisation only.',
          { align: 'center' },
        );
      doc.moveDown(1);

      doc.moveTo(50, doc.y).lineTo(550, doc.y).strokeColor('#cccccc').stroke();
      doc.moveDown(0.5);

      const fields: Array<[string, string]> = [
        ['Proof ID', proof.id ?? id],
        ['Product', String(proof.product ?? 'unknown')],
        ['Final Decision', String(proof.finalDecision ?? 'unknown')],
        [
          'Verification Status',
          verification ? statusToApi(verification.status as ProofRunStatus) : 'N/A',
        ],
        ['Risk Level', verification ? verification.riskLevel.toLowerCase() : 'N/A'],
        [
          'Issues Count',
          String(
            Array.isArray(verification?.issuesFound)
              ? (verification!.issuesFound as unknown[]).length
              : 0,
          ),
        ],
        ['Chain Hash', proof.chain_hash ?? 'N/A'],
        ['Prev Chain Hash', proof.prev_chain_hash ?? 'N/A'],
        ['Signature Present', proof.proof_signature ? 'Yes' : 'No'],
        ['Created', String(proof.createdAt ?? 'unknown')],
        ['Verified By', 'SwarmSync'],
      ];
      doc.fillColor('#000000');
      for (const [label, value] of fields) {
        doc.fontSize(11).font('Helvetica-Bold').text(`${label}:`);
        doc.fontSize(11).font('Helvetica').text(value);
        doc.moveDown(0.3);
      }

      doc.moveDown(1);
      doc.moveTo(50, doc.y).lineTo(550, doc.y).strokeColor('#cccccc').stroke();
      doc.moveDown(0.5);
      doc
        .fontSize(9)
        .fillColor('#999999')
        .text(
          'This public summary was generated by SwarmSync. Sign in to access the full proof report.',
          { align: 'center' },
        );
      doc.end();
      return;
    }

    res.setHeader('Content-Disposition', `attachment; filename="proof-${id}.pdf"`);
    doc.pipe(res);

    // Header
    doc.fontSize(20).font('Helvetica-Bold').text('SwarmSync Proof Report', { align: 'center' });
    doc.moveDown(0.5);
    doc
      .fontSize(10)
      .font('Helvetica')
      .fillColor('#666666')
      .text(`Generated: ${new Date().toISOString()}`, { align: 'center' });
    doc.moveDown(1);

    // Divider
    doc.moveTo(50, doc.y).lineTo(550, doc.y).strokeColor('#cccccc').stroke();
    doc.moveDown(0.5);

    // Proof details
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#000000').text('Proof ID:');
    doc
      .fontSize(11)
      .font('Helvetica')
      .text(proof.id ?? id);
    doc.moveDown(0.5);

    doc.fontSize(12).font('Helvetica-Bold').text('Product:');
    doc
      .fontSize(11)
      .font('Helvetica')
      .text(String(proof.product ?? 'unknown'));
    doc.moveDown(0.5);

    if (verification) {
      doc.fontSize(12).font('Helvetica-Bold').text('Verification Status:');
      doc
        .fontSize(11)
        .font('Helvetica')
        .text(String(verification.status ?? 'unknown'));
      doc.moveDown(0.5);

      doc.fontSize(12).font('Helvetica-Bold').text('Risk Level:');
      doc
        .fontSize(11)
        .font('Helvetica')
        .text(String(verification.riskLevel ?? 'unknown'));
      doc.moveDown(0.5);

      doc.fontSize(12).font('Helvetica-Bold').text('Confidence:');
      const conf =
        verification.confidence != null
          ? `${(Number(verification.confidence) / 100).toFixed(2)}`
          : 'N/A';
      doc.fontSize(11).font('Helvetica').text(conf);
      doc.moveDown(0.5);

      // Issues
      const issues = Array.isArray(verification.issuesFound) ? verification.issuesFound : [];
      doc.fontSize(12).font('Helvetica-Bold').text(`Issues Found (${issues.length}):`);
      if (issues.length === 0) {
        doc.fontSize(11).font('Helvetica').text('None');
      } else {
        issues.forEach((issue: unknown) => {
          const i = issue as Record<string, unknown>;
          doc
            .fontSize(11)
            .font('Helvetica')
            .text(
              `• [${String(i.severity ?? 'info')}] ${String(i.message ?? i.code ?? JSON.stringify(i))}`,
            );
        });
      }
      doc.moveDown(0.5);
    }

    doc.fontSize(12).font('Helvetica-Bold').text('Final Decision:');
    doc
      .fontSize(11)
      .font('Helvetica')
      .text(String(proof.finalDecision ?? 'unknown'));
    doc.moveDown(0.5);

    doc.fontSize(12).font('Helvetica-Bold').text('Created:');
    doc
      .fontSize(11)
      .font('Helvetica')
      .text(String(proof.createdAt ?? 'unknown'));
    doc.moveDown(1);

    doc.fontSize(12).font('Helvetica-Bold').text('Proof Metadata:');
    doc
      .fontSize(10)
      .font('Helvetica')
      .text(`Chain hash: ${proof.chain_hash ?? 'N/A'}`);
    doc
      .fontSize(10)
      .font('Helvetica')
      .text(`Previous chain hash: ${proof.prev_chain_hash ?? 'N/A'}`);
    doc
      .fontSize(10)
      .font('Helvetica')
      .text(`Conduit proof ID: ${proof.conduit_proof_id ?? 'N/A'}`);
    doc
      .fontSize(10)
      .font('Helvetica')
      .text(`Proof signature: ${proof.proof_signature ?? 'N/A'}`);
    if (proof.proof_signature && process.env['PROOF_SIGNING_PUBLIC_KEY']) {
      doc
        .fontSize(10)
        .font('Helvetica')
        .text(`Signing public key: ${process.env['PROOF_SIGNING_PUBLIC_KEY']}`);
    }
    doc.moveDown(1);

    // Footer
    doc.moveTo(50, doc.y).lineTo(550, doc.y).strokeColor('#cccccc').stroke();
    doc.moveDown(0.5);
    doc
      .fontSize(9)
      .fillColor('#999999')
      .text('This report was generated by SwarmSync. Records are audit-ready proof reports.', {
        align: 'center',
      });

    doc.end();
  }

  // ---------------------------------------------------------------------------
  // GET /api/proof/:id/export/json
  // Export a full ProofRecord as a structured JSON download.
  // MUST be declared before GET /api/proof/:id (same route collision reason as PDF).
  // ---------------------------------------------------------------------------

  @Get('proof/:id/export/json')
  @Public()
  @Throttle({ default: { ttl: 60000, limit: 60 } })
  @ApiOperation({ summary: 'Export a proof record as a downloadable JSON file' })
  async exportProofAsJson(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser | null | undefined,
    @Res() res: Response,
  ) {
    const { proof, verification } = await this.proofService.getProofWithVerificationRunUnscoped(id);

    if (!proof) {
      throw new NotFoundException(`ProofRecord ${id} not found`);
    }

    // Retention gate.
    if (isRetentionExpired(proof)) {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="proof-${id}-notice.json"`);
      res.json({
        proof_id: proof.id,
        product: proof.product,
        created_at: proof.createdAt,
        retention_expired: true,
        message: 'This proof has been archived or expired per the retention policy.',
        exported_at: new Date().toISOString(),
      });
      return;
    }

    // Determine ownership.
    const callerOrgId = user ? await this.resolveOrgForUser(user) : null;
    const isOwner =
      callerOrgId !== null && callerOrgId !== ANONYMOUS_ORG_ID && callerOrgId === proof.orgId;

    // Wrong-org authenticated user → 404 (consistent with getProof).
    if (user && callerOrgId !== null && callerOrgId !== ANONYMOUS_ORG_ID && !isOwner) {
      throw new NotFoundException(`ProofRecord ${id} not found`);
    }

    if (isOwner) {
      // Full export for owning-org member.
      const payload = {
        proof_id: proof.id,
        org_id: proof.orgId,
        product: proof.product,
        subject: proof.subject,
        summary: proof.summary,
        final_decision: proof.finalDecision,
        proof_status: proof.proofStatus,
        evidence: Array.isArray(proof.evidence) ? proof.evidence : [],
        timeline: Array.isArray(proof.timeline) ? proof.timeline : [],
        chain_hash: proof.chain_hash ?? null,
        prev_chain_hash: proof.prev_chain_hash ?? null,
        proof_signature: proof.proof_signature ?? null,
        signing_public_key: proof.proof_signature
          ? (process.env['PROOF_SIGNING_PUBLIC_KEY'] ?? null)
          : null,
        conduit_proof_id: proof.conduit_proof_id ?? null,
        created_at: proof.createdAt,
        updated_at: proof.updatedAt,
        verification: verification
          ? {
              verification_id: verification.id,
              verification_status: statusToApi(verification.status as ProofRunStatus),
              risk_level: verification.riskLevel.toLowerCase(),
              confidence:
                verification.confidence !== null && verification.confidence !== undefined
                  ? normaliseConfidence(verification.confidence)
                  : null,
              input_summary: verification.inputSummary,
              output_summary: verification.outputSummary ?? null,
              issues_found: Array.isArray(verification.issuesFound) ? verification.issuesFound : [],
              checks_performed: Array.isArray(verification.checksPerformed)
                ? verification.checksPerformed
                : [],
              created_at: verification.createdAt,
            }
          : null,
        exported_at: new Date().toISOString(),
      };
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="proof-${id}.json"`);
      res.json(payload);
      return;
    }

    // Public caller — return a clearly-labelled redacted public summary.
    // Excludes raw evidence, model output, financial details, org/user IDs.
    const issueCount = Array.isArray(verification?.issuesFound)
      ? (verification!.issuesFound as unknown[]).length
      : 0;
    const redactedPayload = {
      _notice: 'Public Proof Summary — full data available to authenticated org members only.',
      proof_id: proof.id,
      product: proof.product,
      created_at: proof.createdAt,
      verification_status: verification ? statusToApi(verification.status as ProofRunStatus) : null,
      risk_level: verification ? verification.riskLevel.toLowerCase() : null,
      issues_count: issueCount,
      final_decision: proof.finalDecision,
      chain_hash: proof.chain_hash ?? null,
      prev_chain_hash: proof.prev_chain_hash ?? null,
      signature_present: Boolean(proof.proof_signature),
      signing_public_key: proof.proof_signature
        ? (process.env['PROOF_SIGNING_PUBLIC_KEY'] ?? null)
        : null,
      verified_by: 'SwarmSync',
      redacted: true,
      exported_at: new Date().toISOString(),
    };
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="proof-${id}-public-summary.json"`);
    res.json(redactedPayload);
  }

  // ---------------------------------------------------------------------------
  // GET /api/proof/chain/verify
  // Full chain-walk verification for the caller's org: walks every ProofRecord
  // back to genesis (or to `startProofId` if given), re-verifying at each step
  // that (a) the record's own chain_hash recomputes from its own content, and
  // (b) its prev_chain_hash equals the ACTUAL current chain_hash stored on its
  // predecessor — not merely what this record claims. See
  // ProofService.walkProofChain for the full algorithm and the residual
  // limitation it documents (a fully self-consistent re-forgery of an entire
  // chain suffix is not detectable by any bare hash chain without an
  // externally anchored checkpoint, which is out of scope here).
  //
  // Authenticated + org-scoped (no @Public()): unlike the single-record
  // /verify endpoint, this reveals how many proof records an org has and
  // whether their internal chain is intact, so it is not exposed anonymously.
  //
  // MUST be declared before GET /api/proof/:id/verify: both routes have the
  // identical shape `proof/<segment>/verify`, and Nest (via the underlying
  // Express router) matches path-to-regexp patterns in declaration order, not
  // by specificity. With the literal `chain/verify` route declared AFTER the
  // parameterised `:id/verify` route, a request to GET /api/proof/chain/verify
  // was silently captured by verifyProofRecord() with id='chain' and never
  // reached this handler at all — confirmed with a live Nest+Express route
  // probe before fixing. Declaring the literal route first restores normal
  // "static before dynamic" route precedence.
  // ---------------------------------------------------------------------------

  @Get('proof/chain/verify')
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({
    summary: "Walk and verify an organization's full proof chain back to genesis",
    description:
      'Re-verifies every record in the chain (or the requested suffix), independently ' +
      "confirming each record's prev_chain_hash against its predecessor's actual current " +
      'chain_hash. Reports the first break found, not just pass/fail.',
  })
  async verifyProofChain(
    @CurrentUser() user: AuthenticatedUser | null | undefined,
    @Query('startProofId') startProofId?: string,
  ): Promise<ChainWalkResult & { scope: 'full_chain' }> {
    const orgId = await this.resolveOrgForUser(user);
    const result = await this.proofService.walkProofChain(orgId, {
      startProofId: startProofId || undefined,
    });
    return { ...result, scope: 'full_chain' };
  }

  // ---------------------------------------------------------------------------
  // GET /api/proof/:id/verify
  // Recompute ONE record's own hash and verify optional SwarmSync signature.
  // MUST be declared before GET /api/proof/:id (and AFTER GET /api/proof/chain/verify
  // — see that route's comment) to avoid route collisions.
  //
  // SCOPE, READ BEFORE CHANGING THE RESPONSE SHAPE: this only proves the named
  // record is internally self-consistent (its chain_hash recomputes from its
  // own stored id/orgId/summary/evidence/prev_chain_hash). It does NOT re-fetch
  // the predecessor named by prev_chain_hash and confirm that predecessor's
  // CURRENT chain_hash still matches — so it cannot prove the record's place
  // in the wider chain is intact, only that this one record wasn't edited
  // without also being re-hashed. A "verified: true" here is a fast per-record
  // spot-check, not proof that the org's whole audit chain is untampered.
  // For that, use GET /api/proof/chain/verify (walks every link back to
  // genesis). AuditProof sells compliance/audit bundles off this signal, so
  // do not loosen `scope`/`chain_verified_by` below to imply more than a
  // single-record check without also fixing this comment and the docs page.
  // ---------------------------------------------------------------------------

  @Get('proof/:id/verify')
  @Public()
  @ApiOperation({
    summary: 'Verify a single proof record\'s own chain hash and optional signature metadata',
    description:
      'Single-record spot-check only: confirms this record is internally self-consistent. ' +
      'It does NOT confirm the predecessor named by prev_chain_hash still has that chain_hash ' +
      'today, so it cannot certify the full chain is intact — use GET /api/proof/chain/verify for that.',
  })
  async verifyProofRecord(
    @Param('id') id: string,
    @CurrentUser() _user: AuthenticatedUser | null | undefined,
  ) {
    const { proof, verification } = await this.proofService.getProofWithVerificationRunUnscoped(id);

    if (!proof) {
      throw new NotFoundException(`ProofRecord ${id} not found`);
    }

    const recomputedChainHash = computeProofChainHash({
      id: proof.id,
      orgId: proof.orgId,
      summary: proof.summary,
      evidence: proof.evidence,
      prevChainHash: proof.prev_chain_hash,
    });
    const chainHashMatches = !!proof.chain_hash && proof.chain_hash === recomputedChainHash;
    const signatureValid = verifyProofSignature(proof.chain_hash, proof.proof_signature);

    return {
      proof_id: proof.id,
      verification_id: verification?.id ?? null,
      chain_hash: proof.chain_hash ?? null,
      prev_chain_hash: proof.prev_chain_hash ?? null,
      recomputed_chain_hash: recomputedChainHash,
      chain_hash_matches: chainHashMatches,
      proof_signature: proof.proof_signature ?? null,
      signing_public_key: proof.proof_signature
        ? (process.env['PROOF_SIGNING_PUBLIC_KEY'] ?? null)
        : null,
      signature_valid: signatureValid,
      verified: chainHashMatches && signatureValid !== false,
      verification_level: signatureValid === true ? 'signed_hash_chain' : 'hash_chain',
      // Explicit, not inferable from the fields above: this call checked ONE
      // record, not the chain it belongs to. See GET /api/proof/chain/verify.
      scope: 'single_record',
      note:
        'This confirms only that this one record is internally self-consistent. It does not ' +
        "confirm this record's predecessor is unaltered — call GET /api/proof/chain/verify " +
        'to verify the full chain back to genesis.',
      checked_at: new Date().toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // GET /api/proof/:id
  // Fetch a saved ProofRecord by id.
  // ---------------------------------------------------------------------------

  @Get('proof/:id')
  @Public()
  @ApiOperation({ summary: 'Fetch a proof record by ID' })
  async getProof(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser | null | undefined,
  ) {
    // Software-delivery proof reports live in their own table keyed by proofId.
    // Per-check `evidence`/`detail` are free-text that can carry repo internals,
    // so they are only returned to an authenticated member of the owning org;
    // every other caller gets the redacted tamper-evidence envelope.
    const sd = await this.prisma.softwareDeliveryVerification.findUnique({
      where: { proofId: id },
      include: { results: true },
    });
    if (sd) {
      const sdCallerOrgId = user ? await this.resolveOrgForUser(user) : null;
      const sdIsOwner =
        sdCallerOrgId !== null &&
        sdCallerOrgId !== ANONYMOUS_ORG_ID &&
        sdCallerOrgId === sd.organizationId;
      const report = this.formatSoftwareDeliveryRecord(sd, { redacted: !sdIsOwner });
      // buyer_summary is buyer-supplied free text — owner-only. Non-owners get the
      // already-redacted report.summary ('' when redacted) so it never leaks.
      return {
        ...report,
        buyer_summary: sdIsOwner ? (sd.buyerSummary ?? report.summary) : (report.summary ?? ''),
      };
    }

    const { proof, verification } = await this.proofService.getProofWithVerificationRunUnscoped(id);

    // Retention gate: if proof is expired/archived, return a minimal notice.
    if (isRetentionExpired(proof)) {
      return {
        proof_id: proof.id,
        product: proof.product,
        proof_status: proof.proofStatus,
        created_at: proof.createdAt,
        retention_expired: true,
        message: 'This proof has been archived or expired per the retention policy.',
        verified_by: 'SwarmSync',
      };
    }

    // Determine whether the caller owns this proof.
    const callerOrgId = user ? await this.resolveOrgForUser(user) : null;
    const isOwner =
      callerOrgId !== null && callerOrgId !== ANONYMOUS_ORG_ID && callerOrgId === proof.orgId;

    if (isOwner) {
      // Full response for authenticated owning-org member.
      return {
        proof_id: proof.id,
        org_id: proof.orgId,
        product: proof.product,
        subject: proof.subject,
        summary: proof.summary,
        final_decision: proof.finalDecision,
        proof_status: proof.proofStatus,
        evidence: Array.isArray(proof.evidence) ? proof.evidence : [],
        timeline: Array.isArray(proof.timeline) ? proof.timeline : [],
        export_urls: Array.isArray(proof.exportUrls) ? proof.exportUrls : [],
        chain_hash: proof.chain_hash ?? null,
        prev_chain_hash: proof.prev_chain_hash ?? null,
        proof_signature: proof.proof_signature ?? null,
        signing_public_key: proof.proof_signature
          ? (process.env['PROOF_SIGNING_PUBLIC_KEY'] ?? null)
          : null,
        conduit_proof_id: proof.conduit_proof_id ?? null,
        created_at: proof.createdAt,
        verification: verification
          ? {
              verification_id: verification.id,
              verification_status: statusToApi(verification.status as ProofRunStatus),
              risk_level: verification.riskLevel.toLowerCase(),
              confidence:
                verification.confidence !== null && verification.confidence !== undefined
                  ? normaliseConfidence(verification.confidence)
                  : null,
            }
          : null,
      };
    }

    // Wrong-org authenticated user → 404 to avoid leaking existence to non-owners.
    if (user && callerOrgId !== null && callerOrgId !== ANONYMOUS_ORG_ID) {
      throw new NotFoundException(`ProofRecord ${id} not found`);
    }

    // Public / unauthenticated caller — return redacted summary only.
    // Excludes: raw submitted input, raw model output, invoice/vendor/bank/payment
    // details, evidence array, uploaded files, internal notes, orgId/userId,
    // private request payloads. Includes: public tamper-evidence fields only.
    const issueCount = Array.isArray(verification?.issuesFound)
      ? (verification!.issuesFound as unknown[]).length
      : 0;
    return {
      proof_id: proof.id,
      product: proof.product,
      source_type: proof.verificationRunId ? 'api_output' : null,
      created_at: proof.createdAt,
      verification_timestamp: verification?.updatedAt ?? verification?.createdAt ?? null,
      verification_status: verification ? statusToApi(verification.status as ProofRunStatus) : null,
      risk_level: verification ? verification.riskLevel.toLowerCase() : null,
      issues_count: issueCount,
      chain_hash: proof.chain_hash ?? null,
      prev_chain_hash: proof.prev_chain_hash ?? null,
      signature_present: Boolean(proof.proof_signature),
      signing_public_key: proof.proof_signature
        ? (process.env['PROOF_SIGNING_PUBLIC_KEY'] ?? null)
        : null,
      final_decision: proof.finalDecision,
      verified_by: 'SwarmSync',
      redacted: true,
    };
  }

  // Map a persisted SoftwareDeliveryVerification (+results) to the same response
  // shape POST /api/verify returns, so retrieval is consistent with creation.
  // confidence and recommended_action are not persisted, so they are recomputed
  // from the stored check counts using the same scoring rules as the orchestrator.
  private formatSoftwareDeliveryRecord(
    record: {
      proofId: string;
      overallStatus: string;
      tier: string;
      jobType: string;
      escalated: boolean;
      escalationReason: string | null;
      buyerSummary: string | null;
      checksPassed: number;
      checksFailed: number;
      checksWarning: number;
      checksSkipped: number;
      repoOwner?: string | null;
      repoName?: string | null;
      beforeSha?: string | null;
      afterSha?: string | null;
      prNumber?: number | null;
      deployUrl?: string | null;
      jobStartedAt?: Date | null;
      createdAt?: Date | null;
      results: Array<{
        checkId: string;
        checkName: string;
        status: string;
        detail: string | null;
        durationMs: number | null;
        evidence: unknown;
      }>;
    },
    options: { redacted?: boolean } = {},
  ) {
    const redacted = options.redacted === true;
    const verificationStatus = record.overallStatus.toLowerCase().replaceAll('_', '-');
    const confidence = Math.max(
      0,
      Math.min(1, 1 - record.checksFailed * 0.15 - record.checksWarning * 0.05),
    );
    const recommendedAction =
      record.overallStatus === 'FAILED'
        ? 'blocked'
        : record.overallStatus === 'NEEDS_REVIEW' || record.checksWarning > 0
          ? 'human_review'
          : 'approved';
    const issuesFound = record.results
      .filter((r) => r.status === 'FAIL' || r.status === 'WARNING')
      .map((r) => ({
        check_id: r.checkId,
        check_name: r.checkName,
        status: r.status,
        // Withhold free-text detail from non-owners (may carry repo internals).
        ...(redacted ? {} : { detail: r.detail }),
      }));
    // FIX 1 (C2/H3): repo identity fields, deploy_url, and buyer summary are
    // redacted for non-owning callers. Only proof_id, source_type,
    // verification_status, confidence, tier_run, job_type, check counts,
    // recommended_action, and redacted:true are always visible.
    return {
      proof_id: record.proofId,
      source_type: 'software_delivery',
      verification_status: verificationStatus,
      confidence: Math.round(confidence * 100) / 100,
      tier_run: record.tier,
      job_type: record.jobType,
      ...(redacted
        ? {}
        : {
            repo_owner: record.repoOwner ?? null,
            repo_name: record.repoName ?? null,
            before_sha: record.beforeSha ?? null,
            after_sha: record.afterSha ?? null,
            pr_number: record.prNumber ?? null,
            deploy_url: record.deployUrl ?? null,
          }),
      job_started_at: record.jobStartedAt ? record.jobStartedAt.toISOString() : null,
      created_at: record.createdAt ? record.createdAt.toISOString() : null,
      escalated: record.escalated,
      escalation_reason: record.escalationReason ?? undefined,
      summary: redacted ? '' : (record.buyerSummary ?? ''),
      checks_passed: record.checksPassed,
      checks_failed: record.checksFailed,
      checks_warning: record.checksWarning,
      checks_skipped: record.checksSkipped,
      issues_found: issuesFound,
      recommended_action: recommendedAction,
      ...(redacted ? { redacted: true } : {}),
      results: record.results.map((r) => ({
        check_id: r.checkId,
        check_name: r.checkName,
        status: r.status,
        duration_ms: r.durationMs,
        // detail/evidence are free-text that can carry repo internals (paths,
        // diffs) — withheld from non-owning callers. issues_found above still
        // surfaces failed/warning check names without the raw evidence body.
        ...(redacted ? {} : { detail: r.detail, evidence: r.evidence }),
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // GET /api/usage
  // Return verification usage for the caller's org with plan-aware limits.
  // Response: { used, remaining, limit, plan, period_start, period_end }
  // ---------------------------------------------------------------------------

  @Get('usage')
  @Public()
  @ApiOperation({ summary: 'Return verification usage and plan limits for the caller org' })
  async getUsage(
    @CurrentUser() user: AuthenticatedUser | null | undefined,
    @Req() req: Request,
    @Query('product') product?: string,
  ) {
    const now = new Date();
    const calMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const calMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    const freePlan = resolveVerifyApiPlan('free');

    if (!user) {
      // Partition the demo quota per IP so a single caller can't see (or
      // exhaust) the global anonymous pool. See Issue #8 in
      // customer-flow-qa/master-issues.md.
      const ip = clientIpFromRequest(req);
      const { used } = await getDemoIpUsage(ip);
      const limit = DEMO_PER_IP_MONTHLY_LIMIT;
      return {
        used,
        remaining: Math.max(0, limit - used),
        limit,
        plan: freePlan.slug,
        retention_days: freePlan.retentionDays,
        overage_cents: freePlan.overageCents,
        period_start: calMonthStart.toISOString(),
        period_end: calMonthEnd.toISOString(),
        scope: 'per_ip_demo',
      };
    }

    const orgId = await this.resolveOrgForUser(user);

    if (product === 'software-delivery' || product === 'software_delivery') {
      const calMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const calMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      const limit = await this.resolveSoftwareDeliveryMonthlyLimit(orgId);
      const used = await this.verifyApiUsage.getMonthlyCount(
        orgId,
        SOFTWARE_DELIVERY_USAGE_PRODUCT,
      );
      return {
        used,
        remaining: typeof limit === 'number' ? Math.max(0, limit - used) : null,
        limit,
        runs_this_month: used,
        runs_limit: limit,
        plan: (await this.resolveSoftwareDeliveryPlanSlug(orgId)) ?? freePlan.slug,
        retention_days: freePlan.retentionDays,
        overage_cents: freePlan.overageCents,
        period_start: calMonthStart.toISOString(),
        period_end: calMonthEnd.toISOString(),
        product: SOFTWARE_DELIVERY_USAGE_PRODUCT,
      };
    }

    // When ?product= is specified, prefer ProofProductEntitlement quota
    if (product && ['verify-api', 'audit-proof', 'invoice-proof'].includes(product)) {
      const proofType =
        product === 'invoice-proof'
          ? ProofProductType.INVOICE_PROOF
          : product === 'audit-proof'
            ? ProofProductType.AUDIT_PROOF
            : ProofProductType.VERIFY_API;

      const quota = await this.proofBilling.resolveProofQuota(orgId, proofType);
      const entitlement = await this.proofBilling.getActiveProofEntitlement(orgId, proofType);

      const periodStart = entitlement?.periodStart ?? calMonthStart;
      const periodEnd = entitlement?.periodEnd ?? calMonthEnd;

      const used = await this.prisma.verificationRun.count({
        where: { orgId, createdAt: { gte: periodStart, lte: periodEnd } },
      });

      const limit = quota.monthlyLimit;
      return {
        used,
        remaining: typeof limit === 'number' ? Math.max(0, limit - used) : null,
        limit,
        plan: quota.planSlug,
        retention_days: null,
        overage_cents: null,
        period_start: periodStart.toISOString(),
        period_end: periodEnd.toISOString(),
      };
    }

    const subscription = await this.prisma.organizationSubscription.findUnique({
      where: { organizationId: orgId },
    });

    let periodStart: Date;
    let periodEnd: Date;
    let planConfig = freePlan;

    if (subscription && subscription.status === SubscriptionStatus.ACTIVE) {
      planConfig = resolveVerifyApiPlan(subscription.planSlug);
      periodStart = subscription.currentPeriodStart;
      periodEnd = subscription.currentPeriodEnd;
    } else {
      periodStart = calMonthStart;
      periodEnd = calMonthEnd;
    }
    const limit = planConfig.monthlyRuns;

    const used = await this.prisma.verificationRun.count({
      where: { orgId, createdAt: { gte: periodStart, lte: periodEnd } },
    });

    return {
      used,
      remaining: typeof limit === 'number' ? Math.max(0, limit - used) : null,
      limit,
      plan: planConfig.slug,
      retention_days: planConfig.retentionDays,
      overage_cents: planConfig.overageCents,
      period_start: periodStart.toISOString(),
      period_end: periodEnd.toISOString(),
    };
  }

  private async resolveSoftwareDeliveryPlanSlug(orgId: string): Promise<string> {
    const proofQuota = await this.proofBilling.resolveProofQuota(
      orgId,
      ProofProductType.VERIFY_API,
    );
    if (proofQuota.source === 'entitlement') return proofQuota.planSlug;

    const subscription = await this.prisma.organizationSubscription.findUnique({
      where: { organizationId: orgId },
    });
    if (subscription && subscription.status === SubscriptionStatus.ACTIVE) {
      return subscription.planSlug;
    }
    return 'free';
  }

  /**
   * Resolve the billing organization for an authenticated principal (JWT user or
   * ssk_live_ API key owner). The JWT does not carry organizationId, so a paid
   * entitlement (keyed by org) was previously never matched and quota silently
   * fell back to the free tier. Here we resolve the user's membership org,
   * preferring one that holds an ACTIVE VerifyAPI entitlement so the paid plan
   * applies. Falls back to the principal's own id only when there is no
   * membership at all (anonymous/sandbox callers keep the sentinel org).
   */
  private async resolveOrgForUser(user: AuthenticatedUser | null | undefined): Promise<string> {
    if (!user) return ANONYMOUS_ORG_ID;
    const explicitOrg = (user as AuthenticatedUser & { organizationId?: string }).organizationId;
    if (explicitOrg) return explicitOrg;

    const memberships = await this.prisma.organizationMembership.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
      select: { organizationId: true },
    });
    if (memberships.length === 0) return user.id;

    // Resolve entitlement status for all memberships in parallel (avoids a
    // serial N+1 on the request hot path) and prefer the earliest membership
    // that holds an ACTIVE VerifyAPI entitlement; otherwise the earliest org.
    const entitlementChecks = await Promise.all(
      memberships.map((m) =>
        this.proofBilling
          .getActiveProofEntitlement(m.organizationId, ProofProductType.VERIFY_API)
          .then((entitlement) => ({
            organizationId: m.organizationId,
            entitled: Boolean(entitlement),
          })),
      ),
    );
    const preferred = entitlementChecks.find((c) => c.entitled);
    return preferred?.organizationId ?? memberships[0].organizationId;
  }

  private async resolveSoftwareDeliveryMonthlyLimit(orgId: string): Promise<number | null> {
    const proofQuota = await this.proofBilling.resolveProofQuota(
      orgId,
      ProofProductType.VERIFY_API,
    );
    if (proofQuota.source === 'entitlement') return proofQuota.monthlyLimit;

    const subscription = await this.prisma.organizationSubscription.findUnique({
      where: { organizationId: orgId },
    });
    if (subscription && subscription.status === SubscriptionStatus.ACTIVE) {
      return resolveVerifyApiPlan(subscription.planSlug).monthlyRuns;
    }
    return resolveVerifyApiPlan('free').monthlyRuns;
  }
}
