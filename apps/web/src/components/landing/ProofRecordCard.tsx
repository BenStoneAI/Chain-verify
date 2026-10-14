'use client';

import { useState } from 'react';

import { proofRecords } from './proofRecords';
import { useTabKeyNav } from './useTabKeyNav';

const ID_PREFIX = 'lp-proof';

export function ProofRecordCard() {
  const [active, setActive] = useState(0);
  const onKeyDown = useTabKeyNav(proofRecords.length, setActive, ID_PREFIX);
  const record = proofRecords[active];

  return (
    <aside className="lp-proof-card" aria-label="ChainVerify proof record example">
      <div className="lp-proof-tabs" role="tablist" aria-label="Proof record examples">
        {proofRecords.map((item, index) => (
          <button
            key={item.tabLabel}
            id={`${ID_PREFIX}-tab-${index}`}
            type="button"
            role="tab"
            aria-selected={index === active}
            aria-controls={`${ID_PREFIX}-panel`}
            tabIndex={index === active ? 0 : -1}
            className={'lp-proof-tab' + (index === active ? ' is-active' : '')}
            onClick={() => setActive(index)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {item.tabLabel}
          </button>
        ))}
      </div>

      <div
        id={`${ID_PREFIX}-panel`}
        role="tabpanel"
        aria-labelledby={`${ID_PREFIX}-tab-${active}`}
        aria-live="polite"
      >
        <div className="lp-proof-head">
          <span className="lp-proof-title">ChainVerify proof record</span>
          <span className="lp-badge-verified">{record.verdict}</span>
        </div>

        <dl className="lp-proof-rows">
          <div className="lp-proof-row"><dt>Claim</dt><dd>{record.claim}</dd></div>
          <div className="lp-proof-row"><dt>Evidence</dt><dd>{record.evidence}</dd></div>
          <div className="lp-proof-row"><dt>Checks</dt><dd>{record.checks}</dd></div>
          <div className="lp-proof-row"><dt>Human review</dt><dd>{record.human}</dd></div>
        </dl>

        <div className="lp-proof-foot">
          <span>Independent · Reviewable · Exportable</span>
          <code>{record.id}</code>
        </div>
      </div>
    </aside>
  );
}
