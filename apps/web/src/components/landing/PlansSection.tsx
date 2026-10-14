import { PlanCard } from './PlanCard';
import { SectionHeader } from './SectionHeader';
import { PLANS_BADGE, plans } from './plans';

export function PlansSection() {
  return (
    <section className="lp-section" id="plans" aria-labelledby="lp-plans-title">
      <SectionHeader
        badge={PLANS_BADGE}
        title="Pick the verification volume you actually need."
        titleId="lp-plans-title"
      >
        Fewer choices, clear limits, and the same proof model at every paid tier.
      </SectionHeader>
      <div className="lp-plans-grid">
        {plans.map((plan) => <PlanCard key={plan.name} plan={plan} />)}
      </div>
    </section>
  );
}
