# Chain Verify

Independent extraction of SwarmSync's AuditProof, InvoiceProof, and Agent Gate products.

This repository is being built non-destructively; SwarmSync remains unchanged until Chain Verify is independently verified.

## Agent Gate (formerly VerifyAPI)

Agent Gate is software-delivery verification: 49 repository, CI, deploy, security, and test checks with per-check evidence and signed proof records.

- Public route: `/agent-gate` (docs at `/agent-gate/docs`, checkout return at `/agent-gate/welcome`).
- Deprecated alias: `/verify-api` and `/verify-api/*` permanently redirect (308, query string preserved) to the matching `/agent-gate` route. Existing Stripe return URLs keep working.
- Plans: Agent Gate Build, Scale, and Production, with canonical slugs `agent-gate-build|scale|production`. The legacy `verify-api-build|scale|production` slugs resolve to the same plans (same price and limits).
- API paths are unchanged (`POST /api/verify`, `/api/proof/*`) because external consumers call them.
- Internal identifiers that intentionally keep the old name: the product key `verify-api`, the `VERIFY_API` database enum value, the `verify-api` usage-product key, and the `VERIFY_API_*` environment variable names.
