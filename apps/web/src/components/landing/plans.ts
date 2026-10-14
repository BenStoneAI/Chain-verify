import { AGENT_GATE_NAME } from './productName';

export interface Plan {
  name: string;
  price: string;
  blurb: string;
  bullets: readonly string[];
  /** Plan slug resolved to a Stripe Payment Link; null routes to /contact. */
  slug: string | null;
  cta: string;
  recommended: boolean;
}

/** Limits and retention mirror verifyApiPlanConfigs in packages/config/src/billing.ts. */
export const plans: readonly Plan[] = [
  {
    name: 'Build',
    price: '$99/mo',
    blurb: 'For prototypes and smaller production workflows.',
    bullets: ['5,000 runs / month', 'Proof ID every run', '90-day retention'],
    slug: 'agent-gate-build',
    cta: 'Start Build — $99/mo',
    recommended: false,
  },
  {
    name: 'Scale',
    price: '$499/mo',
    blurb: 'For active products with steady verification volume.',
    bullets: ['50,000 runs / month', 'Proof ID every run', '3-year retention'],
    slug: 'agent-gate-scale',
    cta: 'Start Scale — $499/mo',
    recommended: true,
  },
  {
    name: 'Production',
    price: '$1,200/mo',
    blurb: 'For high-volume teams that need longer-lived evidence.',
    bullets: ['250,000 runs / month', 'Proof ID every run', '7-year retention'],
    slug: 'agent-gate-production',
    cta: 'Start Production — $1,200/mo',
    recommended: false,
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    blurb: 'For custom volume, contracts, deployment, and support.',
    bullets: ['Custom limits', 'Commercial terms', 'Implementation support'],
    slug: null,
    cta: 'Talk to us',
    recommended: false,
  },
];

export const PLANS_BADGE = `${AGENT_GATE_NAME} plans`.toUpperCase();
