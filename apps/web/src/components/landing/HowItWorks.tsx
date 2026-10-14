import { SectionHeader } from './SectionHeader';
import { flowSteps } from './faqFlow';

export function HowItWorks() {
  return (
    <section className="lp-section" id="how-it-works" aria-labelledby="lp-flow-title">
      <SectionHeader badge="ONE SIMPLE FLOW" title="From claim to proof in three moves." titleId="lp-flow-title">
        Every page follows the same path so buyers always know what happens next.
      </SectionHeader>
      <ol className="lp-flow-grid">
        {flowSteps.map((step) => (
          <li className="lp-flow-card" key={step.num}>
            <span className="lp-flow-num">{step.num}</span>
            <h3>{step.title}</h3>
            <p>{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
