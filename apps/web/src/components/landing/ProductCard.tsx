import Link from 'next/link';

import { ProofCheckoutButton } from '@/components/proof/ProofCheckoutButton';

import type { Offer } from './offers';

export function ProductCard({ offer }: { offer: Offer }) {
  const headingId = `lp-offer-${offer.product}`;

  return (
    <article
      className={'lp-product-card' + (offer.featured ? ' is-featured' : '')}
      aria-labelledby={headingId}
    >
      <div>
        {offer.featured ? <div className="lp-pill">★ Self-Serve · Instant Checkout</div> : null}
        <div
          className={`lp-product-banner lp-product-banner--${offer.banner}`}
          role="img"
          aria-label={offer.bannerLabel}
        />
        <div className="lp-product-top">
          <span className="lp-product-category">{offer.eyebrow}</span>
          <span className="lp-price-pill">{offer.price}</span>
        </div>
        <h3 id={headingId}>{offer.name}</h3>
        <p className="lp-product-subtitle">{offer.title}</p>
        <p className="lp-product-desc">{offer.body}</p>
        <ul className="lp-checklist">
          {offer.bullets.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </div>

      <div className="lp-product-actions">
        <ProofCheckoutButton
          product={offer.product}
          planSlug={offer.plan}
          className={'lp-btn ' + (offer.featured ? 'lp-btn-primary' : 'lp-btn-glass')}
        >
          {offer.cta}
        </ProofCheckoutButton>
        <Link href={offer.href} className="lp-details-link">
          See details<span className="lp-sr-only"> about {offer.name}</span> →
        </Link>
      </div>
    </article>
  );
}
