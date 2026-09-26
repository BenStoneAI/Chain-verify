// Canonical delivery-verification models for VerifyAPI Phase B3.
//
// parseDeliveryEvidence() is the single entry-point that turns a set of
// ClassifiedEvidence documents into structured, typed delivery artefacts.
// Every downstream VR-C control calls this; none parse raw text themselves.
//
// Design notes:
//   - Tolerant parsing: fields are matched by many key-name variants and
//     prose patterns so the controls are not brittle against caller naming.
//   - Never throws. Missing/uninterpretable fields become null/empty.
//   - Prose extraction covers delivery_statement prose that callers send as
//     free text rather than structured JSON.

import type { ClassifiedEvidence } from '../ingestion/evidence-input.js';

// ---------------------------------------------------------------------------
// Canonical model types
// ---------------------------------------------------------------------------

/** A single contractual requirement, optionally with delivery-specific extras. */
export type Requirement = {
  id: string;
  description: string;
  /** Exact version string contracted (e.g. "2.3", "v1.4.2"). */
  contractedVersion?: string;
  /** True when the contract calls for bidirectional sync on this requirement. */
  requiresBidirectionalSync?: boolean;
  /** The contracted deployment target environment (e.g. "production"). */
  contractedDeploymentTarget?: string;
  /** The contracted authentication method (e.g. "oauth2", "oauth"). */
  contractedAuthMethod?: string;
};

/** A deployment claim from delivery or deployment evidence. */
export type DeploymentRecord = {
  target: string;
  environment: string;
  /** Raw source passage for citation. */
  sourcePassage?: string;
};

/** A defect record from a defect_log document. */
export type DefectRecord = {
  id: string;
  severity: string;
  status: string;
  /** Raw source passage for citation. */
  sourcePassage?: string;
};

/** A version record pairing a requirement ID to contracted vs delivered. */
export type VersionRecord = {
  requirementId: string;
  contracted: string;
  delivered: string;
  /** Raw source passage for citation. */
  sourcePassage?: string;
};

/** Fully parsed delivery evidence extracted from classified documents. */
export type ParsedDeliveryEvidence = {
  requirements: Requirement[];
  deliverables: string[];
  deployments: DeploymentRecord[];
  tests: string[];
  defects: DefectRecord[];
  versions: VersionRecord[];
  acceptanceCriteria: string[];
  environmentClaims: string[];
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Lowercase + collapse whitespace. */
function norm(s: unknown): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Read a value from a record under multiple candidate key names. */
function pick(
  record: Record<string, unknown>,
  keys: string[],
): unknown {
  for (const k of keys) {
    const v = record[k];
    if (v !== undefined && v !== null && v !== '') return v;
    // Also try lowercase variant.
    const lk = k.toLowerCase();
    const vl = record[lk];
    if (vl !== undefined && vl !== null && vl !== '') return vl;
  }
  return undefined;
}

/** Coerce an unknown value to a string; returns '' when not useful. */
function str(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.trim();
  return String(v).trim();
}

/** Collect all row records from docs of the given type. */
function rowsByType(
  docs: ClassifiedEvidence[],
  type: string,
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const doc of docs) {
    if (doc.documentType === type && doc.rows) {
      out.push(...doc.rows);
    }
  }
  return out;
}

/** Recursively collect JSON objects so nested delivery payloads can be parsed. */
function flattenJsonObjects(value: unknown, out: Array<Record<string, unknown>> = []): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    for (const item of value) flattenJsonObjects(item, out);
    return out;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    out.push(record);
    for (const nested of Object.values(record)) flattenJsonObjects(nested, out);
  }
  return out;
}

/** Collect row-like records from parsed rows and nested JSON for docs of a type. */
function recordsByType(docs: ClassifiedEvidence[], type: string): Array<Record<string, unknown>> {
  const out = rowsByType(docs, type);
  for (const doc of docs) {
    if (doc.documentType === type && doc.json !== undefined && doc.json !== null) {
      out.push(...flattenJsonObjects(doc.json));
    }
  }
  return out;
}

/** Collect all raw text blobs from docs of the given type. */
function textsByType(docs: ClassifiedEvidence[], type: string): string[] {
  return docs
    .filter((d) => d.documentType === type && typeof d.text === 'string' && d.text.trim())
    .map((d) => d.text as string);
}

// ---------------------------------------------------------------------------
// Requirements parsing
// ---------------------------------------------------------------------------

const REQ_ID_KEYS = [
  'id',
  'requirement_id',
  'req_id',
  'req id',
  'requirementid',
  'ID',
  'REQ_ID',
];
const REQ_DESC_KEYS = [
  'description',
  'requirement',
  'name',
  'title',
  'text',
  'Description',
  'Requirement',
];
const REQ_VERSION_KEYS = [
  'version',
  'contracted_version',
  'contractedVersion',
  'required_version',
  'requiredVersion',
  'api_version',
  'apiVersion',
  'Version',
];
const REQ_DEPLOY_TARGET_KEYS = [
  'deployment_target',
  'deploymentTarget',
  'contracted_deployment_target',
  'contractedDeploymentTarget',
  'required_deployment_target',
  'requiredDeploymentTarget',
  'environment',
  'target_environment',
  'targetEnvironment',
  'DeploymentTarget',
];
const REQ_AUTH_KEYS = [
  'auth_method',
  'authMethod',
  'contracted_auth_method',
  'contractedAuthMethod',
  'required_auth_method',
  'requiredAuthMethod',
  'authentication_method',
  'authenticationMethod',
  'AuthMethod',
];

/** Normalize a deployment target to a canonical label. */
export function normalizeDeploymentTarget(v: unknown): string {
  const t = norm(v);
  if (/\b(?:pre|non)[-\s]?prod(?:uction)?\b/.test(t)) return 'preproduction';
  if (/\bprod(?:uction)?\b/.test(t)) return 'production';
  if (/\bstag(?:e|ing)?\b/.test(t)) return 'staging';
  if (/\buat\b/.test(t)) return 'uat';
  if (/\btest\b/.test(t)) return 'test';
  return t;
}

/** Normalize version string (strip leading 'v', 'api version ', etc.). */
export function normalizeVersion(v: unknown): string {
  return String(v ?? '')
    .toLowerCase()
    .replace(/^api\s+version\s*/, '')
    .replace(/^v/, '')
    .trim();
}

/** Normalize auth method string. */
export function normalizeAuthMethod(v: unknown): string {
  return String(v ?? '')
    .toLowerCase()
    .replace(/oauth\s*2\.?0?/gi, 'oauth2')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

/** Contracted auth is absent / not applicable — comparisons must not fire VR-C6. */
export function isUnspecifiedAuthMethod(auth: string | undefined): boolean {
  if (!auth) return true;
  return (
    auth === 'notapplicable' ||
    auth === 'na' ||
    auth === 'none' ||
    auth === 'unspecified' ||
    auth === 'notspecified' ||
    auth === 'notrequired'
  );
}

/** Parse requirements from requirements_doc rows + prose. */
function parseRequirements(docs: ClassifiedEvidence[]): Requirement[] {
  const reqs: Requirement[] = [];
  const seen = new Set<string>();

  // From structured rows.
  for (const row of recordsByType(docs, 'requirements_doc')) {
    const id = str(pick(row, REQ_ID_KEYS));
    const description = str(pick(row, REQ_DESC_KEYS));
    const contractedVersion = (() => {
      const v = str(pick(row, REQ_VERSION_KEYS));
      return v ? normalizeVersion(v) : undefined;
    })();

    const deployTarget = (() => {
      const v = str(pick(row, REQ_DEPLOY_TARGET_KEYS));
      return v ? normalizeDeploymentTarget(v) : undefined;
    })();

    const syncField = norm(pick(row, ['sync', 'sync_direction', 'sync_type', 'SyncDirection', 'required_sync']));
    const requiresBidirectionalSync = /bidirectional|two[-\s]?way|both directions/.test(syncField)
      ? true
      : undefined;

    const authRaw = str(pick(row, REQ_AUTH_KEYS));
    const contractedAuthMethod = authRaw ? normalizeAuthMethod(authRaw) : undefined;

    const hasContractFields = Boolean(
      contractedVersion || deployTarget || requiresBidirectionalSync !== undefined || contractedAuthMethod,
    );
    if (!id && !description && !hasContractFields) continue;

    const reqId = id || (hasContractFields ? 'CONTRACT-SCOPE' : `REQ-${reqs.length + 1}`);
    if (seen.has(reqId)) continue;
    seen.add(reqId);

    reqs.push({
      id: reqId,
      description: description || (hasContractFields ? 'Contract scope' : reqId),
      ...(contractedVersion ? { contractedVersion } : {}),
      ...(requiresBidirectionalSync !== undefined ? { requiresBidirectionalSync } : {}),
      ...(deployTarget ? { contractedDeploymentTarget: deployTarget } : {}),
      ...(contractedAuthMethod ? { contractedAuthMethod } : {}),
    });
  }

  // Also parse requirements embedded in delivery_statement JSON arrays.
  for (const doc of docs) {
    if (doc.documentType !== 'delivery_statement') continue;
    if (!doc.json) continue;
    const json = doc.json as Record<string, unknown>;
    const embedded = json['requirements'] ?? json['contract_requirements'] ?? json['requirement_list'];
    if (!Array.isArray(embedded)) continue;
    for (const item of embedded) {
      if (typeof item !== 'object' || item === null) continue;
      const r = item as Record<string, unknown>;
      const id = str(pick(r, REQ_ID_KEYS));
      const description = str(pick(r, REQ_DESC_KEYS));
      if (!id && !description) continue;
      const reqId = id || `REQ-${reqs.length + 1}`;
      if (seen.has(reqId)) continue;
      seen.add(reqId);
      reqs.push({ id: reqId, description: description || reqId });
    }
  }

  return reqs;
}

// ---------------------------------------------------------------------------
// Deployment parsing
// ---------------------------------------------------------------------------

const DEPLOY_TARGET_KEYS = [
  'deployment_target',
  'deploymentTarget',
  'target_environment',
  'targetEnvironment',
  'environment',
  'delivered_deployment_target',
  'deliveredDeploymentTarget',
  'DeploymentTarget',
  'target',
];

/** Parse deployment records from deployment_evidence rows and delivery prose. */
function parseDeployments(docs: ClassifiedEvidence[]): DeploymentRecord[] {
  const records: DeploymentRecord[] = [];

  for (const row of [
    ...recordsByType(docs, 'deployment_evidence'),
    ...recordsByType(docs, 'delivery_statement'),
  ]) {
    const rawTarget = str(pick(row, DEPLOY_TARGET_KEYS));
    if (!rawTarget) continue;
    const target = normalizeDeploymentTarget(rawTarget);
    records.push({
      target,
      environment: target,
      sourcePassage: `deployment_evidence row: ${JSON.stringify(row).slice(0, 200)}`,
    });
  }

  // Also scan delivery_statement prose for deployment claims.
  for (const text of textsByType(docs, 'delivery_statement')) {
    // "deployed to staging", "deployment target: staging", "environment: production"
    const patterns: Array<RegExp> = [
      /deployed\s+to\s+(staging|production|uat|test|pre[-\s]?prod(?:uction)?)/i,
      /deployment\s+target\s*[:=]\s*(staging|production|uat|test|pre[-\s]?prod(?:uction)?)/i,
      /target\s+environment\s*[:=]\s*(staging|production|uat|test|pre[-\s]?prod(?:uction)?)/i,
      /environment\s*[:=]\s*(staging|production|uat|test|pre[-\s]?prod(?:uction)?)/i,
    ];
    for (const re of patterns) {
      const m = text.match(re);
      if (m) {
        const target = normalizeDeploymentTarget(m[1]);
        records.push({
          target,
          environment: target,
          sourcePassage: m[0].trim(),
        });
      }
    }
  }

  return records;
}

// ---------------------------------------------------------------------------
// Defect parsing
// ---------------------------------------------------------------------------

const DEFECT_ID_KEYS = ['id', 'defect_id', 'bug_id', 'issue_id', 'DefectId'];
const DEFECT_SEV_KEYS = ['severity', 'priority', 'Severity', 'Priority'];
const DEFECT_STATUS_KEYS = ['status', 'state', 'Status', 'State'];

/** Parse defect records from defect_log rows and delivery prose. */
function parseDefects(docs: ClassifiedEvidence[]): DefectRecord[] {
  const records: DefectRecord[] = [];

  for (const row of [
    ...recordsByType(docs, 'defect_log'),
    ...recordsByType(docs, 'delivery_statement'),
  ]) {
    const openDefectsText = str(pick(row, ['open_defects', 'openDefects', 'defects', 'defect_list']));
    if (openDefectsText) {
      if (/(?:0|zero)\s+open\s+(?:p[012]|critical|high)\s+defects?/i.test(openDefectsText)) {
        continue;
      }
      const highOpen = /\b(?:one|[1-9][0-9]*)\s+(p[012]|critical|high)\s+defects?\s+remains?\s+open|(?:open|unresolved)\s+(p[012]|critical|high)\s+defects?/i.exec(openDefectsText);
      if (highOpen) {
        records.push({
          id: `STRUCTURED-DEFECT-${records.length + 1}`,
          severity: (highOpen[1] ?? highOpen[2]).toLowerCase(),
          status: 'open',
          sourcePassage: openDefectsText,
        });
        continue;
      }
    }
    const id = str(pick(row, DEFECT_ID_KEYS)) || `DEFECT-${records.length + 1}`;
    const severity = str(pick(row, DEFECT_SEV_KEYS));
    const status = str(pick(row, DEFECT_STATUS_KEYS));
    if (!severity && !status) continue;
    records.push({
      id,
      severity: severity || 'unknown',
      status: status || 'unknown',
      sourcePassage: `defect_log row: ${JSON.stringify(row).slice(0, 200)}`,
    });
  }

  // Extract defects mentioned in delivery prose.
  for (const text of textsByType(docs, 'delivery_statement')) {
    // "P1 defect open", "open P2 issue", "open critical defect"
    const probeRe =
      /\b(open|unresolved|active)\s+(p[012]|critical|high|sev[\s-]?[12])\s+(defect|bug|issue)\b/gi;
    let m: RegExpExecArray | null;
    while ((m = probeRe.exec(text)) !== null) {
      const sev = m[2].toLowerCase().replace(/\s+/g, '');
      records.push({
        id: `PROSE-DEFECT-${records.length + 1}`,
        severity: sev,
        status: 'open',
        sourcePassage: m[0].trim(),
      });
    }
    // "2 open critical defects", "three open p2 bugs"
    const countRe =
      /\b(?:[0-9]+|one|two|three|four|five)\s+open\s+(p[012]|critical|high)\s+(defects?|bugs?|issues?)\b/gi;
    while ((m = countRe.exec(text)) !== null) {
      records.push({
        id: `PROSE-DEFECT-${records.length + 1}`,
        severity: m[1].toLowerCase(),
        status: 'open',
        sourcePassage: m[0].trim(),
      });
    }
  }

  return records;
}

// ---------------------------------------------------------------------------
// Version records parsing
// ---------------------------------------------------------------------------

/** Parse version mismatch records from structured delivery evidence. */
function parseVersionRecords(
  docs: ClassifiedEvidence[],
  requirements: Requirement[],
): VersionRecord[] {
  const records: VersionRecord[] = [];

  // Match delivered versions against contracted requirements.
  const deliveryRows = [
    ...recordsByType(docs, 'requirements_doc'),
    ...recordsByType(docs, 'delivery_statement'),
    ...recordsByType(docs, 'deployment_evidence'),
  ];

  const DELIVERED_VERSION_KEYS = [
    'delivered_api_version',
    'deliveredApiVersion',
    'delivered_version',
    'deliveredVersion',
    'api_version',
    'apiVersion',
    'actual_api_version',
    'actualApiVersion',
    'version',
    'software_version',
    'softwareVersion',
    'build_version',
    'buildVersion',
    'DeliveredVersion',
  ];
  const CONTRACTED_VERSION_KEYS = [
    'contracted_api_version',
    'contractedApiVersion',
    'contract_api_version',
    'contractApiVersion',
    'required_api_version',
    'requiredApiVersion',
    'expected_api_version',
    'expectedApiVersion',
    'contracted_version',
    'contractedVersion',
    'required_version',
    'requiredVersion',
  ];
  const REQUIREMENT_ID_KEYS = ['requirement_id', 'requirementId', 'req_id', 'reqId', 'id'];

  for (const row of deliveryRows) {
    const contractedRaw = str(pick(row, CONTRACTED_VERSION_KEYS));
    const deliveredRaw = str(pick(row, DELIVERED_VERSION_KEYS));
    if (!contractedRaw || !deliveredRaw) continue;
    const contracted = normalizeVersion(contractedRaw);
    const delivered = normalizeVersion(deliveredRaw);
    if (contracted && delivered && contracted !== delivered) {
      records.push({
        requirementId: str(pick(row, REQUIREMENT_ID_KEYS)) || 'UNKNOWN',
        contracted,
        delivered,
        sourcePassage: `version row: ${JSON.stringify(row).slice(0, 200)}`,
      });
    }
  }

  for (const req of requirements) {
    if (!req.contractedVersion) continue;

    // Look for a delivered version in delivery rows.
    for (const row of deliveryRows) {
      const deliveredRaw = str(pick(row, DELIVERED_VERSION_KEYS));
      if (!deliveredRaw) continue;
      const delivered = normalizeVersion(deliveredRaw);
      if (delivered && delivered !== req.contractedVersion) {
        records.push({
          requirementId: req.id,
          contracted: req.contractedVersion,
          delivered,
          sourcePassage: `${DELIVERED_VERSION_KEYS[0]}: ${deliveredRaw}`,
        });
        break; // One record per requirement.
      }
    }
  }

  // Also scan delivery prose for "version X.Y delivered vs X.Z contracted" patterns.
  for (const text of textsByType(docs, 'delivery_statement')) {
    const patterns = [
      // "version 2.1 delivered vs 2.3 contracted"
      /version\s+([0-9][.\w]*)\s+delivered\s+(?:vs?\.?\s+|versus\s+)([0-9][.\w]*)\s+contracted/gi,
      // "delivered version 2.1, contracted version 2.3"
      /delivered\s+version\s+([0-9][.\w]*)[,;]?\s+contracted\s+version\s+([0-9][.\w]*)/gi,
      // "contracted v2.3 but delivered v2.1"
      /contracted\s+v?([0-9][.\w]*)\s+but\s+delivered\s+v?([0-9][.\w]*)/gi,
    ];
    for (const re of patterns) {
      let m: RegExpExecArray | null;
      re.lastIndex = 0;
      while ((m = re.exec(text)) !== null) {
        const first = normalizeVersion(m[1]);
        const second = normalizeVersion(m[2]);
        // Determine which is delivered and which contracted by keyword order in pattern.
        const isDeliveredFirst = /delivered.*contracted/i.test(re.source);
        const delivered = isDeliveredFirst ? first : second;
        const contracted = isDeliveredFirst ? second : first;
        if (delivered !== contracted) {
          records.push({
            requirementId: 'PROSE',
            contracted,
            delivered,
            sourcePassage: m[0].trim(),
          });
        }
      }
    }
  }

  return records;
}

// ---------------------------------------------------------------------------
// Deliverables / tests / acceptance criteria / environment claims
// ---------------------------------------------------------------------------

function parseDeliverables(docs: ClassifiedEvidence[]): string[] {
  const out: string[] = [];
  for (const text of textsByType(docs, 'delivery_statement')) {
    // "REQ-001: PARTIAL", "REQ-002: delivered", "REQ-003: 80% complete"
    const re =
      /\b(REQ[-_][A-Z0-9]+|ITEM[-_][0-9]+|DEL[-_][0-9]+)\b[^\n]*(?:status|:\s*)(partial|complete|not yet delivered|[0-9]+%\s+complete|will finish[^\n]*)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      out.push(m[0].trim());
    }
    // Also capture entire delivery statement paragraphs that mention partial status.
    if (/partial|not yet delivered|80%|will finish in/i.test(text)) {
      out.push(text.trim());
    }
  }
  return [...new Set(out)];
}

function parseTests(docs: ClassifiedEvidence[]): string[] {
  const out: string[] = [];
  const testTypes = ['deployment_evidence', 'delivery_statement'];
  for (const type of testTypes) {
    for (const text of textsByType(docs, type)) {
      const re = /\b(?:test|spec|scenario)[:\s]+([^\n]{10,120})/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        out.push(m[0].trim());
      }
    }
  }
  return out;
}

function parseAcceptanceCriteria(docs: ClassifiedEvidence[]): string[] {
  const out: string[] = [];
  for (const text of [...textsByType(docs, 'requirements_doc'), ...textsByType(docs, 'delivery_statement')]) {
    const re =
      /(?:acceptance\s+criteria?|accept\s+when|definition\s+of\s+done)[:\s]+([^\n]{10,200})/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      out.push(m[0].trim());
    }
  }
  return out;
}

function parseEnvironmentClaims(docs: ClassifiedEvidence[]): string[] {
  const out: string[] = [];
  for (const text of textsByType(docs, 'delivery_statement')) {
    const re =
      /(?:deployed\s+to|environment|target|deployment)[:\s]+(staging|production|uat|test|pre[-\s]?prod(?:uction)?)[^\n]*/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      out.push(m[0].trim());
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Parse classified evidence documents into structured delivery artefacts.
 * Tolerant: missing documents yield empty arrays, not errors.
 */
export function parseDeliveryEvidence(documents: ClassifiedEvidence[]): ParsedDeliveryEvidence {
  const requirements = parseRequirements(documents);
  const deployments = parseDeployments(documents);
  const defects = parseDefects(documents);
  const versions = parseVersionRecords(documents, requirements);
  const deliverables = parseDeliverables(documents);
  const tests = parseTests(documents);
  const acceptanceCriteria = parseAcceptanceCriteria(documents);
  const environmentClaims = parseEnvironmentClaims(documents);

  return {
    requirements,
    deliverables,
    deployments,
    tests,
    defects,
    versions,
    acceptanceCriteria,
    environmentClaims,
  };
}
