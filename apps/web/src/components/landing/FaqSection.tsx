import { SectionHeader } from './SectionHeader';
import { faqEntries } from './faqFlow';

export function FaqSection() {
  return (
    <section className="lp-section" id="faq" aria-labelledby="lp-faq-title">
      <SectionHeader badge="BUYER QUESTIONS" title="What you need to know before you buy." titleId="lp-faq-title" />
      <div className="lp-faq-list">
        {faqEntries.map((entry) => (
          <details className="lp-faq-item" key={entry.question} open={entry.openByDefault}>
            <summary>{entry.question}</summary>
            <p>{entry.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
