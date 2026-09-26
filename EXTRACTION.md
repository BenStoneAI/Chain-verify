# Chain Verify extraction status

## Current state
Chain Verify now contains the three product surfaces, proof kernel, product configuration, InvoiceProof backend code, VerifyAPI backend code, billing code, and the immediate shared UI components used by the product pages.

## Deliberately not copied
The full SwarmSync marketplace, agent network, general authentication system, shared Prisma/database layer, and unrelated billing/platform code have not been copied.

## Remaining standalone boundaries
1. Web: replace SwarmSync branding, navigation, auth-store coupling, and SwarmSync URLs with Chain Verify equivalents.
2. API: define a Chain Verify-owned Prisma schema/database service for proof records, entitlements, API keys, usage, and invoice history.
3. Config: remove platform-plan coupling from proof billing so Chain Verify owns its product plans.
4. Runtime: add a minimal API bootstrap and web app shell.
5. Verification: run proof-core typecheck/build first, then API unit tests, then web build and end-to-end tests.

## Safety rule
Do not remove proof code from SwarmSync until Chain Verify has an independently deployable build and passing regression tests.
