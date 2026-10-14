import { ProductCard } from './ProductCard';
import { SectionHeader } from './SectionHeader';
import { offers } from './offers';

export function ProductGrid() {
  return (
    <section className="lp-section" id="products" aria-labelledby="lp-products-title">
      <SectionHeader
        badge="CHOOSE THE DECISION YOU NEED TO TRUST"
        title="Buy the proof layer that matches the risk."
        titleId="lp-products-title"
      >
        Starting price, outcome, and checkout are visible before you have to dig through a product page.
      </SectionHeader>
      <div className="lp-product-grid">
        {offers.map((offer) => <ProductCard key={offer.product} offer={offer} />)}
      </div>
    </section>
  );
}
