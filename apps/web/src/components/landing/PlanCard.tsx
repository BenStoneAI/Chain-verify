import Link from 'next/link';

import { ProofCheckoutButton } from '@/components/proof/ProofCheckoutButton';

import type { Plan } from './plans';

export function PlanCard({ plan }: { plan: Plan }) {
  const headingId = `lp-plan-${plan.name.toLowerCase()}`;
  const buttonClass = 'lp-btn lp-btn-sm ' + (plan.recommended ? 'lp-btn-primary' : 'lp-btn-glass');

  return (
    <article
      className={'lp-plan-card' + (plan.recommended ? ' is-recommended' : '')}
      aria-labelledby={headingId}
    >
      <div>
        {plan.recommended ? <div className="lp-pill">RECOMMENDED</div> : null}
        <h3 id={headingId}>{plan.name}</h3>
        <div className="lp-plan-price">{plan.price}</div>
        <p>{plan.blurb}</p>
        <ul className="lp-checklist">
          {plan.bullets.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </div>

      {plan.slug ? (
        <ProofCheckoutButton product="verify-api" planSlug={plan.slug} className={buttonClass}>
          {plan.cta}
        </ProofCheckoutButton>
      ) : (
        <Link href="/contact" className={buttonClass}>{plan.cta}</Link>
      )}
    </article>
  );
}
