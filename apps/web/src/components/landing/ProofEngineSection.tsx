import { EngineStages } from './EngineStages';
import { LiveEngineGate } from './LiveEngineGate';
import { SectionHeader } from './SectionHeader';

export function ProofEngineSection() {
  return (
    <section className="lp-section" id="3d-engine" aria-labelledby="lp-engine-title">
      <SectionHeader
        badge="WHAT YOU ACTUALLY GET"
        title="A verdict is useful. A proof record is defensible."
        titleId="lp-engine-title"
      >
        Each product is built around the same idea: don’t stop at a model answer or a status message.
        Keep the evidence, the checks, the decision, and the proof ID together.
      </SectionHeader>
      <EngineStages />
      <LiveEngineGate />
    </section>
  );
}
