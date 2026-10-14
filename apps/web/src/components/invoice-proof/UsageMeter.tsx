import type { InvoiceProofUsage } from '@/lib/invoice-proof/types';

const PLAN_LABELS: Record<string, string> = {
  free: 'Free',
  'invoiceproof-pilot': 'Pilot',
  'invoiceproof-verify': 'Verify',
  'invoiceproof-protect': 'Protect',
  'invoiceproof-govern': 'Govern',
};

export interface UsageMeterProps {
  usage: InvoiceProofUsage;
}

export function planLabel(slug: string): string {
  return PLAN_LABELS[slug] ?? slug;
}

export function UsageMeter({ usage }: UsageMeterProps) {
  const capped = usage.limit !== null && usage.limit > 0;
  const pct = capped ? Math.min(100, Math.round((usage.used / (usage.limit as number)) * 100)) : 0;
  const tone = pct >= 90 ? ' is-crit' : pct >= 70 ? ' is-warn' : '';

  return (
    <section className="ipa-card" aria-label="Usage this period">
      <div className="ipa-meter-row">
        <span className="ipa-muted">Runs this period ({planLabel(usage.plan)} plan)</span>
        <strong>
          {usage.used.toLocaleString()}
          {capped ? <span className="ipa-muted"> / {(usage.limit as number).toLocaleString()}</span> : null}
        </strong>
      </div>
      {capped ? (
        <div
          className="ipa-meter"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label="Plan usage"
        >
          <div className={`ipa-meter-fill${tone}`} style={{ width: `${pct}%` }} />
        </div>
      ) : (
        <p className="ipa-faint">This plan has no fixed monthly cap.</p>
      )}
    </section>
  );
}
