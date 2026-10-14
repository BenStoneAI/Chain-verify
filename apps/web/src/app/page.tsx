import { FaqSection } from '@/components/landing/FaqSection';
import { FinalCta } from '@/components/landing/FinalCta';
import { HowItWorks } from '@/components/landing/HowItWorks';
import { LandingFooter } from '@/components/landing/LandingFooter';
import { LandingHero } from '@/components/landing/LandingHero';
import { LandingNav } from '@/components/landing/LandingNav';
import { PlansSection } from '@/components/landing/PlansSection';
import { ProductGrid } from '@/components/landing/ProductGrid';
import { ProofEngineSection } from '@/components/landing/ProofEngineSection';

export default function HomePage() {
  return (
    <div className="lp">
      <a href="#main-content" className="lp-skip">Skip to content</a>
      <LandingNav />
      <main id="main-content" className="lp-container">
        <LandingHero />
        <ProductGrid />
        <ProofEngineSection />
        <HowItWorks />
        <PlansSection />
        <FaqSection />
        <FinalCta />
      </main>
      <LandingFooter />
    </div>
  );
}
