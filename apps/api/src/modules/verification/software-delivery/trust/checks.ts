import type { CheckResult } from '../software-delivery.types.js';
import { CHECK_NAMES } from '../software-delivery.types.js';
import type { ReceiptValidation } from './receipt.js';
import { scanSuppression } from './suppression.js';

/**
 * AG1 - Agent Gate receipt validation result.
 * SKIP when no receipt was submitted (no evidence either way). A submitted
 * receipt that is invalid, untrusted, stale, mismatched or shows failed /
 * dirty / suspicious test runs yields FAIL or WARNING and contributes nothing
 * observed.
 */
export function buildReceiptCheck(receipt: ReceiptValidation): CheckResult {
  const base = { checkId: 'AG1', checkName: CHECK_NAMES['AG1'], tier: 'BASIC' as const };
  if (!receipt.submitted) {
    return {
      ...base,
      status: 'SKIP',
      skipKind: 'UNABLE',
      detail:
        'No Agent Gate receipt was submitted. Test execution is judged from CI evidence only; submit agentGateReceipt to add independently signed test evidence.',
      durationMs: 0,
    };
  }
  const evidence: Record<string, unknown> = {
    receiptId: receipt.receiptId,
    accepted: receipt.accepted,
    integrityOk: receipt.integrityOk,
    signatureTrusted: receipt.signatureTrusted,
    signingKeyId: receipt.signingKeyId,
    bindingOk: receipt.bindingOk,
    fresh: receipt.fresh,
    testsObserved: receipt.testsObserved,
    observedTests: receipt.observedTests,
    findings: receipt.findings,
    receiptHeadSha: receipt.headSha,
    receiptRepository: receipt.repository,
    receiptCreatedAt: receipt.createdAt,
  };
  if (receipt.status === 'PASS') {
    return {
      ...base,
      status: 'PASS',
      detail: `Receipt ${receipt.receiptId} is intact, signed by a trusted key, bound to this commit and repository, and records ${receipt.observedTests.length} executed test command(s) with exit code 0 on a clean tree.`,
      evidence,
    };
  }
  const worst = receipt.findings.filter((f) => f.severity === receipt.status);
  const detail = (worst.length > 0 ? worst : receipt.findings)
    .slice(0, 3)
    .map((f) => `[${f.code}] ${f.message}`)
    .join(' ');
  return {
    ...base,
    status: receipt.status === 'FAIL' ? 'FAIL' : 'WARNING',
    detail: `The submitted Agent Gate receipt was not accepted as evidence. ${detail}`,
    evidence,
  };
}

/**
 * AG2 - suppression detection over ADDED diff lines and submitted command
 * strings (from the Agent Gate receipt).
 */
export function buildSuppressionCheck(params: {
  diffText: string;
  commands: string[];
  test1Active: boolean;
}): CheckResult {
  const start = Date.now();
  const base = { checkId: 'AG2', checkName: CHECK_NAMES['AG2'], tier: 'BASIC' as const };
  if (!params.diffText && params.commands.length === 0) {
    return {
      ...base,
      status: 'SKIP',
      skipKind: 'UNABLE',
      detail: 'No diff text could be retrieved and no command strings were submitted, so suppression could not be assessed.',
      durationMs: 0,
    };
  }
  const scan = scanSuppression({
    diffText: params.diffText,
    commands: params.commands,
    test1Active: params.test1Active,
  });
  const fails = scan.findings.filter((f) => f.severity === 'FAIL');
  const warns = scan.findings.filter((f) => f.severity === 'WARNING');
  const evidence: Record<string, unknown> = {
    addedLinesScanned: scan.addedLinesScanned,
    commandsScanned: scan.commandsScanned,
    failCount: fails.length,
    warningCount: warns.length,
    findings: scan.findings.slice(0, 10).map((f) => ({
      rule: f.rule,
      category: f.category,
      severity: f.severity,
      source: f.source,
      file: f.file ?? null,
      line: f.line,
    })),
  };
  if (scan.findings.length === 0) {
    return { ...base, status: 'PASS', evidence, durationMs: Date.now() - start };
  }
  const describe = (list: typeof scan.findings) =>
    list
      .slice(0, 5)
      .map((f) => `${f.rule}${f.file ? ` in ${f.file}` : f.source === 'command' ? ' in a submitted command' : ''}`)
      .join('; ');
  const detail =
    fails.length > 0
      ? `Test or failure suppression was introduced: ${describe(fails)}.${warns.length > 0 ? ` Also flagged: ${describe(warns)}.` : ''}`
      : `Possible test suppression wording or markers were added: ${describe(warns)}.`;
  return {
    ...base,
    status: fails.length > 0 ? 'FAIL' : 'WARNING',
    detail,
    evidence,
    durationMs: Date.now() - start,
  };
}
