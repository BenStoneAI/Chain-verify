import type { EvidenceInput } from './evidence-input.js';

const VERIFYAPI_PROOF_INPUT_KEYS = [
  'requirements',
  'acceptance_criteria',
  'contract_scope',
  'integration_scope',
  'requirements_traceability',
  'contract_requirements',
  'delivery_statement',
  'delivery',
  'deployment_report',
  'deployment',
  'deployment_evidence',
  'release_notes',
  'change_log',
  'defect_list',
  'defects',
  'open_defects',
  'issues',
] as const;

const AUDITPROOF_PROOF_INPUT_KEYS = [
  'policy',
  'policy_text',
  'policies',
  'policy_document',
  'governance_policy',
  'procurement_policy',
  'risk_register',
  'risk_registry',
  'risks',
  'risk_log',
  'risk_assessment',
  'approval_matrix',
  'approvals',
  'signatures',
  'signature',
  'sign_off',
  'sign_offs',
  'approval_workflow',
  'authorization_matrix',
  'exception_log',
  'exceptions',
  'waivers',
] as const;

const MAX_SPLIT_DEPTH = 8;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function logicalKeysFor(sourceProduct: EvidenceInput['sourceProduct']): ReadonlySet<string> {
  if (sourceProduct === 'verifyapi') return new Set(VERIFYAPI_PROOF_INPUT_KEYS);
  if (sourceProduct === 'auditproof') return new Set(AUDITPROOF_PROOF_INPUT_KEYS);
  return new Set();
}

function filenamePart(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'evidence';
}

function pushLogicalInput(
  inputs: EvidenceInput[],
  sourceProduct: EvidenceInput['sourceProduct'],
  filename: string,
  logicalKey: string,
  value: unknown,
  provenance?: EvidenceInput['provenance'],
): void {
  if (value === undefined || value === null) return;
  if (typeof value === 'string') {
    if (value.trim()) {
      inputs.push({
        filename: `${filenamePart(filename)}.txt`,
        text: `${logicalKey}: ${value}`,
        sourceProduct,
        ...(provenance !== undefined ? { provenance } : {}),
      });
    }
    return;
  }
  if (isRecord(value) && Object.keys(value).length === 0) return;
  inputs.push({
    filename: `${filenamePart(filename)}.json`,
    json: { [logicalKey]: value },
    sourceProduct,
    ...(provenance !== undefined ? { provenance } : {}),
  });
}

function pushAuditTextSections(
  inputs: EvidenceInput[],
  text: string,
  provenance?: EvidenceInput['provenance'],
): void {
  const sections: Array<{ key: string; type: string; pattern: RegExp }> = [
    { key: 'policy', type: 'policy_register', pattern: /policy register\s*:\s*([\s\S]*?)(?=\n[A-Z][^\n:]{2,80}:\s*|\nExpected:|$)/i },
    { key: 'approval_matrix', type: 'segregation_of_duties', pattern: /segregation of duties\s*:\s*([\s\S]*?)(?=\n[A-Z][^\n:]{2,80}:\s*|\nExpected:|$)/i },
    { key: 'risk_register', type: 'risk_register', pattern: /risk register\s*:\s*([\s\S]*?)(?=\n[A-Z][^\n:]{2,80}:\s*|\nExpected:|$)/i },
    { key: 'exception_log', type: 'exception_log', pattern: /exception log\s*:\s*([\s\S]*?)(?=\n[A-Z][^\n:]{2,80}:\s*|\nExpected:|$)/i },
  ];
  for (const section of sections) {
    const match = section.pattern.exec(text);
    const body = match?.[1]?.trim();
    if (!body) continue;
    pushLogicalInput(inputs, 'auditproof', section.type, section.key, body, provenance);
  }
  if (/no\s+(?:cfo|ceo|vp|executive)\s+signature|missing\s+(?:cfo|ceo|vp|executive)\s+signature|requires?\s+signature/i.test(text)) {
    pushLogicalInput(inputs, 'auditproof', 'signature_gaps', 'signatures', text, provenance);
  }
}

function collectLogicalPayloads(
  inputs: EvidenceInput[],
  sourceProduct: EvidenceInput['sourceProduct'],
  value: unknown,
  keys: ReadonlySet<string>,
  path: string[],
  depth = 0,
  provenance?: EvidenceInput['provenance'],
): void {
  if (depth > MAX_SPLIT_DEPTH) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectLogicalPayloads(
        inputs,
        sourceProduct,
        item,
        keys,
        [...path, String(index)],
        depth + 1,
        provenance,
      ),
    );
    return;
  }
  if (!isRecord(value)) return;

  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    const childPath = [...path, key];
    if (keys.has(normalizedKey)) {
      pushLogicalInput(inputs, sourceProduct, childPath.join('.'), key, child, provenance);
    }
    collectLogicalPayloads(inputs, sourceProduct, child, keys, childPath, depth + 1, provenance);
  }
}

export function expandEvidenceInput(input: EvidenceInput): EvidenceInput[] {
  const expanded: EvidenceInput[] = [input];
  const keys = logicalKeysFor(input.sourceProduct);
  if (keys.size === 0) return expanded;

  if (input.json !== undefined && input.json !== null) {
    collectLogicalPayloads(
      expanded,
      input.sourceProduct,
      input.json,
      keys,
      [input.filename?.replace(/\.[^.]+$/, '') || 'submission'],
      0,
      input.provenance,
    );
  }
  return expanded;
}

export function buildEvidenceInputsFromPayloads(args: {
  output: unknown;
  evidence?: unknown;
  sourceProduct: EvidenceInput['sourceProduct'];
  /** Provenance for `output` (trusted server-side value only; default customer_submitted). */
  provenance?: EvidenceInput['provenance'];
  /** Provenance for `evidence` (defaults to `provenance`). */
  evidenceProvenance?: EvidenceInput['provenance'];
}): EvidenceInput[] {
  const roots: EvidenceInput[] = [];
  const evidenceProvenance = args.evidenceProvenance ?? args.provenance;
  pushLogicalInput(roots, args.sourceProduct, 'submission', 'submission', args.output, args.provenance);
  pushLogicalInput(
    roots,
    args.sourceProduct,
    'supporting_evidence',
    'supporting_evidence',
    args.evidence,
    evidenceProvenance,
  );
  if (args.sourceProduct === 'auditproof') {
    if (typeof args.output === 'string') pushAuditTextSections(roots, args.output, args.provenance);
    if (typeof args.evidence === 'string') {
      pushAuditTextSections(roots, args.evidence, evidenceProvenance);
    }
    if (isRecord(args.output)) {
      for (const value of Object.values(args.output)) {
        if (typeof value === 'string') pushAuditTextSections(roots, value, args.provenance);
      }
    }
    if (isRecord(args.evidence)) {
      for (const value of Object.values(args.evidence)) {
        if (typeof value === 'string') pushAuditTextSections(roots, value, evidenceProvenance);
      }
    }
  }
  return roots.flatMap(expandEvidenceInput);
}
