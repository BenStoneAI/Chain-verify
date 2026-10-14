/**
 * Regression: H2 — AUD-T003 bank change returned 'needs_review' instead of 'blocked'
 *
 * Fix added detectCriticalBankChange() in verify-api.controller.ts and an isBlocked
 * gate so that a bank-change + high-risk + human_approval_required event produces:
 *   status: 'blocked'
 *   issue_codes including 'BANK_CHANGE_HIGH_RISK'
 *
 * The fix agent added 3 tests in verify-api.controller.spec.ts that verify the
 * detectCriticalBankChange helper in isolation.
 *
 * This file extends coverage with two additional assertions that were NOT in the
 * original spec:
 * 1. A bank_detail_changes critical prior issue alone (without workflow_name match)
 *    triggers the block — confirming the priorIssues path of detectCriticalBankChange.
 * 2. A medium-risk workflow with approval=false returns false — an extra boundary
 *    case beyond AUD-T001/T002.
 *
 * All tests use verifyApiRuleTestHooks (the exported pure-function test hook) so
 * they run in <1 ms without a database or HTTP call.
 */

import 'reflect-metadata';

import { describe, expect, it, vi } from 'vitest';

vi.mock('@chain-verify/config', () => ({
  verifyApiPlanConfigs: [
    { slug: 'free', monthlyRuns: 10, overageCents: null, retentionDays: 7 },
  ],
}));

import { verifyApiRuleTestHooks as _hooks } from '../verification/verify-api.controller.js';

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
const hooks = _hooks!;

describe('Regression H2: detectCriticalBankChange blocks AUD-T003 pattern', () => {
  // ─── Tests that mirror the existing spec (confirm they pass) ───────────────

  it('blocks AUD-T003: Vendor Risk After Bank Change (critical, human_approval_required)', () => {
    // This is the exact payload from AUD-T003 that previously returned needs_review.
    expect(
      hooks.detectCriticalBankChange(
        {
          workflow_name: 'Vendor Risk After Bank Change',
          business_risk: 'critical',
          human_approval_required: true,
        },
        'workflow_event',
        [],
      ),
    ).toBe(true);
  });

  it('does not block AUD-T001 (low risk, no bank change, no approval)', () => {
    expect(
      hooks.detectCriticalBankChange(
        { workflow_name: 'Global Vendor Activity Summary', business_risk: 'low', human_approval_required: false },
        'workflow_event',
        [],
      ),
    ).toBe(false);
  });

  it('does not block AUD-T002 (medium risk, no bank change, no approval)', () => {
    expect(
      hooks.detectCriticalBankChange(
        { workflow_name: 'Invoice Approval Recommendation', business_risk: 'medium', human_approval_required: false },
        'workflow_event',
        [],
      ),
    ).toBe(false);
  });

  // ─── Additional boundary assertions not in the original spec ──────────────

  it('blocks when priorIssues already contains bank_detail_changes critical (regardless of workflow name)', () => {
    // Confirms the priorIssues code path: if the rule layer already detected a bank change
    // at critical severity, the block fires even without a bank-keyword in workflow_name.
    expect(
      hooks.detectCriticalBankChange(
        { business_risk: 'high', human_approval_required: true },
        'invoice_extraction',
        [{ rule: 'bank_detail_changes', severity: 'critical', message: 'Account differs' }],
      ),
    ).toBe(true);
  });

  it('does not block a bank-change event at LOW risk with no approval required', () => {
    // A first-time bank detail update at low risk and no approval requirement
    // should NOT block automation — only the high/critical + approval combination blocks.
    expect(
      hooks.detectCriticalBankChange(
        { workflow_name: 'Routine Bank Detail Refresh', business_risk: 'low', human_approval_required: false },
        'workflow_event',
        [],
      ),
    ).toBe(false);
  });

  it('blocks when human_approval_required=true even without an explicit high business_risk field', () => {
    // approval_required alone (no risk field present) should still block when the
    // event name signals a bank change — the OR condition in the guard covers this.
    expect(
      hooks.detectCriticalBankChange(
        { workflow_name: 'Vendor Bank Account Change', human_approval_required: true },
        'workflow_event',
        [],
      ),
    ).toBe(true);
  });
});
