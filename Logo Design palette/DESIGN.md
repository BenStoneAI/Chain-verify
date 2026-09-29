\---

version: alpha
colors:
background: "#07080D"
surface: "#11151F"
surfaceRaised: "#171D29"
text: "#F8FAFC"
textMuted: "#8F9DB2"
verifyApi: "#8B5CF6"
auditProof: "#22D3EE"
invoiceProof: "#FFB45C"
typography:
sans:
fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
mono:
fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
rounded:
control: "12px"
card: "18px"
pill: "999px"
spacing:
compact: "8px"
control: "12px"
section: "88px"
components:
primaryCta:
radius: "12px"
marketingCard:
radius: "18px"
proofRecord:
radius: "18px"

Overview

ChainVerify is a hybrid brand/product site for buyers who need evidence before trusting AI work or high-stakes workflow output. The North Star is a **technical verification dossier with editorial clarity**: the visual system can feel advanced, but the commercial path must stay obvious.

The public marketing surfaces are allowed cinematic depth, restrained ambient motion, and product-specific accents. Product demos and proof records are more utilitarian and evidence-led. The site must never resemble a crypto landing page, a generic neon AI template, or a dense developer-docs page.

The signature element is the **proof record**: claims, checks, evidence, review state, and proof ID presented as one coherent object.

Colors

The shared environment uses near-black #07080D, raised graphite #11151F / #171D29, primary text #F8FAFC, and muted text #8F9DB2.

Product color is semantic rather than decorative:

* VerifyAPI uses violet #8B5CF6.
* AuditProof uses cyan #22D3EE.
* InvoiceProof uses amber #FFB45C.

Green is reserved for true success states and is not a brand accent. Product colors may appear in CTA gradients, proof-state borders, focused controls, and small ambient glows; they should not flood whole sections.

Typography

Use the sans stack for marketing, navigation, pricing, and explanatory copy. Use the mono stack only for proof IDs, API paths, statuses, labels, and evidence metadata.

Large headlines use tight tracking and compact line height. Body copy stays conversational, short, and explicit about what is verified versus what remains a human decision.

Layout

Marketing pages follow one buyer sequence:

**Outcome → visible CTA/price → proof/value → how it works → plans → buyer questions → repeated CTA.**

A primary commercial CTA must be visible in the first viewport on desktop and mobile. Starting price must sit near that CTA. Do not require registration before a paid Stripe Checkout.

Homepage product selection appears immediately after the hero. Product pages use the shared ProductMarketingLayout rather than independent section order.

Elevation \& Depth

Marketing cards use restrained glass/graphite depth with one-pixel borders and soft shadows. Proof records may float slightly to reinforce the idea of a portable evidence object.

Ambient animation must remain slow and subordinate to content. Respect prefers-reduced-motion.

Shapes

Controls use 12px radii. Major cards and proof records use 18px radii. Pills are reserved for compact status/metadata, never as a default container shape.

Components

**Primary CTA:** one dominant commercial action per section. CTA text names the plan and price when a purchase is the expected next step.

**Pricing:** show the fewest useful plan choices. Lead with a bounded pilot where the product requires implementation; lead with the lowest paid self-service tier for VerifyAPI. Enterprise is visually secondary.

**Checkout:** paid CTAs open Stripe-hosted Checkout directly. Account creation must not block payment. Post-payment activation is a separate, explicit step until automated provisioning exists.

**Proof record:** show decision, evidence state, human review state, and proof ID together.

**FAQ:** answer purchasing objections and limitations, not generic company marketing.

Do's and Don'ts

Do:

* Put outcome, starting price, and purchase CTA above the fold.
* Keep CTA vocabulary identical from hero through pricing.
* Use evidence and product limitations to build trust.
* Keep product-page section order consistent.
* Make mobile purchase actions full-width and obvious.

Don't:

* Hide checkout below demos, API samples, or long feature inventories.
* Make a buyer create an account before a paid checkout.
* Present samples as production evidence.
* Use decorative motion that competes with pricing or CTA hierarchy.
* Add plan choices that do not change a buyer decision.

