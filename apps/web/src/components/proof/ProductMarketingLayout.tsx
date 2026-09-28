import type { ReactNode } from 'react';
import Link from 'next/link';

import ProductFooter from '@/components/proof/ProductFooter';
import ProductNav from '@/components/proof/ProductNav';
import { ProofCheckoutButton } from '@/components/proof/ProofCheckoutButton';
import type { ProofProductSlug } from '@/lib/stripe-payment-links';

export type MarketingPlan = {
  slug?: string;
  name: string;
  price: string;
  cadence?: string;
  description: string;
  features: string[];
  featured?: boolean;
  cta?: string;
  href?: string;
};

export type ProductMarketingLayoutProps = {
  product: ProofProductSlug;
  eyebrow: string;
  headline: ReactNode;
  lede: string;
  primaryPlanSlug?: string;
  primaryCta: string;
  secondaryCta: string;
  secondaryHref: string;
  startPrice: string;
  quickFacts: Array<{ label: string; value: string; detail: string }>;
  benefitsTitle: string;
  benefits: Array<{ title: string; body: string }>;
  proofTitle: string;
  proofCopy: string;
  proofVisual: ReactNode;
  steps: Array<{ title: string; body: string }>;
  plansTitle: string;
  plansCopy: string;
  plans: MarketingPlan[];
  faqs: Array<{ q: string; a: string }>;
  finalTitle: string;
  finalCopy: string;
};

export function ProductMarketingLayout(props: ProductMarketingLayoutProps) {
  const anchors = [
    { label: 'What you get', href: '#value' },
    { label: 'Proof', href: '#proof' },
    { label: 'How it works', href: '#how-it-works' },
    { label: 'Plans', href: '#plans' },
  ];

  return (
    <>
      <ProductNav currentProduct={props.product} pageAnchors={anchors} />
      <main className={'pm-page pm-' + props.product}>
        <section className="pm-hero">
          <div className="pm-hero-copy">
            <div className="pm-eyebrow">{props.eyebrow}</div>
            <h1>{props.headline}</h1>
            <p>{props.lede}</p>
            <div className="pm-hero-actions">
              {props.primaryPlanSlug ? (
                <ProofCheckoutButton product={props.product} planSlug={props.primaryPlanSlug} className="pm-btn pm-btn-primary">
                  {props.primaryCta}
                </ProofCheckoutButton>
              ) : (
                <Link href={props.secondaryHref} className="pm-btn pm-btn-primary">{props.primaryCta}</Link>
              )}
              <Link href={props.secondaryHref} className="pm-btn pm-btn-secondary">{props.secondaryCta}</Link>
            </div>
            <div className="pm-purchase-note">
              <span>Secure Stripe checkout</span>
              <span>{props.startPrice}</span>
              <span>No account required before purchase</span>
            </div>
          </div>
          <div className="pm-hero-proof">
            <div className="pm-proof-shell">
              <div className="pm-proof-shell-top">
                <span><i/><i/><i/></span>
                <b>ChainVerify proof record</b>
                <em>LIVE FORMAT</em>
              </div>
              <div className="pm-proof-state"><i>✓</i><div><b>Evidence verified</b><span>Structured result ready to review</span></div></div>
              <div className="pm-proof-row"><span>Decision</span><b>VERIFIED</b></div>
              <div className="pm-proof-row"><span>Evidence</span><b>Attached</b></div>
              <div className="pm-proof-row"><span>Human review</span><b>Recorded</b></div>
              <div className="pm-proof-row"><span>Proof ID</span><code>cv_8f3e2…</code></div>
              <div className="pm-proof-footer">Independent · Reviewable · Exportable</div>
            </div>
          </div>
        </section>

        <section className="pm-quick-facts" aria-label="Product summary">
          {props.quickFacts.map((fact) => (
            <article key={fact.label}>
              <span>{fact.label}</span>
              <strong>{fact.value}</strong>
              <p>{fact.detail}</p>
            </article>
          ))}
        </section>

        <section className="pm-section" id="value">
          <div className="pm-section-head">
            <span>WHY IT EXISTS</span>
            <h2>{props.benefitsTitle}</h2>
          </div>
          <div className="pm-benefit-grid">
            {props.benefits.map((benefit) => (
              <article key={benefit.title}>
                <i>✓</i>
                <h3>{benefit.title}</h3>
                <p>{benefit.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="pm-section pm-proof-section" id="proof">
          <div className="pm-section-head">
            <span>SEE THE OUTPUT</span>
            <h2>{props.proofTitle}</h2>
            <p>{props.proofCopy}</p>
          </div>
          <div className="pm-proof-visual">{props.proofVisual}</div>
        </section>

        <section className="pm-section" id="how-it-works">
          <div className="pm-section-head">
            <span>HOW IT WORKS</span>
            <h2>One clear path from claim to proof.</h2>
          </div>
          <ol className="pm-steps">
            {props.steps.map((step, index) => (
              <li key={step.title}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <div><h3>{step.title}</h3><p>{step.body}</p></div>
              </li>
            ))}
          </ol>
        </section>

        <section className="pm-section pm-plans-section" id="plans">
          <div className="pm-section-head">
            <span>PLANS</span>
            <h2>{props.plansTitle}</h2>
            <p>{props.plansCopy}</p>
          </div>
          <div className="pm-plan-grid">
            {props.plans.map((plan) => (
              <article className={'pm-plan' + (plan.featured ? ' is-featured' : '')} key={plan.name}>
                {plan.featured && <div className="pm-plan-badge">RECOMMENDED</div>}
                <div className="pm-plan-name">{plan.name}</div>
                <div className="pm-plan-price">{plan.price}<small>{plan.cadence || ''}</small></div>
                <p>{plan.description}</p>
                <ul>{plan.features.map((feature) => <li key={feature}>✓ {feature}</li>)}</ul>
                {plan.slug ? (
                  <ProofCheckoutButton product={props.product} planSlug={plan.slug} className="pm-btn pm-plan-cta">
                    {plan.cta || 'Choose ' + plan.name}
                  </ProofCheckoutButton>
                ) : (
                  <Link href={plan.href || 'mailto:proof@chainverify.org'} className="pm-btn pm-plan-cta pm-btn-secondary">
                    {plan.cta || 'Contact us'}
                  </Link>
                )}
              </article>
            ))}
          </div>
          <p className="pm-plan-footnote">Checkout is hosted securely by Stripe. Create or connect your ChainVerify account after purchase.</p>
        </section>

        <section className="pm-section pm-faq">
          <div className="pm-section-head">
            <span>BUYER QUESTIONS</span>
            <h2>What you need to know before you buy.</h2>
          </div>
          <div className="pm-faq-list">
            {props.faqs.map((faq) => (
              <details key={faq.q}>
                <summary>{faq.q}<span>+</span></summary>
                <p>{faq.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="pm-final">
          <h2>{props.finalTitle}</h2>
          <p>{props.finalCopy}</p>
          <div className="pm-hero-actions">
            {props.primaryPlanSlug && (
              <ProofCheckoutButton product={props.product} planSlug={props.primaryPlanSlug} className="pm-btn pm-btn-primary">
                {props.primaryCta}
              </ProofCheckoutButton>
            )}
            <Link href="#plans" className="pm-btn pm-btn-secondary">Compare plans</Link>
          </div>
        </section>
      </main>
      <ProductFooter currentProduct={props.product} />
    </>
  );
}

export default ProductMarketingLayout;
