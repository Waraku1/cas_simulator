# C5 Release Hardening Status

## Closed / merged implementation baseline

- C1-C4 product semantics: frozen.
- C5 release flight-control refinement: merged.
- C5A accessibility and security hardening: merged.
- C5B performance/evidence instrumentation: merged via PR #53 at `20b66fa33b47cf5aff5f54b081ecb902766261e1`.
- C5C deploy/rollback governance: merged via PR #54 at `93868f8d7bafcb2e7731865fb01298fc4b706615`.
- C5D school-local regression evidence packaging: merged via PR #55 at `ad54678253a4fd0ea104f60dbdc00f19fff59ccf`; post-merge Project CI #133 passed.
- C5E human QA / visual sign-off evidence contract: merged via PR #56 at `2cc0c8937530193a5b14ccf4a99e2e4a32aa27a1`.

## C5B — performance/evidence execution

The merged product flight reuses the canonical C2 runtime diagnostics without exposing development UI, exports the latest product-flight evidence as `window.__CAS_PERFORMANCE_EVIDENCE__`, and keeps the frozen 45 FPS target, 30 FPS floor, 60 FPS cap, 3-minute preflight, 30-minute benchmark, and 150 MiB observed-transfer target under CI contract verification.

C5B implementation is merged, but release evidence is not closed by static CI alone. The sustained browser/device benchmark and two-browser ranked product run in `docs/operations/C5B_PERFORMANCE_EVIDENCE.md` remain required.

## C5C — deploy / rollback execution

The merged C5C release-governance contract provides manual-only immutable-SHA production deploy, explicit version-ID rollback, pre/post Cloudflare state capture, shared production mutation concurrency, post-action smoke verification, and retained evidence artifacts.

C5C implementation is merged, but execution evidence is not closed until production deploy and rollback workflows are actually exercised and their artifacts retained. Final rated-product release evidence must be performed after C4D production D1 provisioning/binding/migrations are operational and `C4D_RATED_PRODUCTION_GATE=enabled`.

## C5D — school-local regression execution

The merged C5D gate packages C3 multiplayer, C4B matchmaking/assignment, C4C competition, C4D account/session/leaderboard, and C4D authenticated ranked-product smoke into one structured evidence command. Hosted Project CI retains the aggregate report and launcher/health evidence as an artifact.

C5D implementation is merged and hosted-CI evidence is green. Final device-specific closure still requires the same aggregate command on the supported managed school Mac plus browser usability observation; hosted Linux CI does not substitute for that managed-device evidence.

## C5E — human QA / visual sign-off execution

The merged C5E gate defines one validated evidence record for the eight critical product surfaces, accepted flight/camera behavior, two-browser peer rendering, reconnect state, product diagnostics boundary, keyboard path, 200% zoom, compact desktop layout, and explicit final visual/UX sign-off.

C5E implementation is merged, but human execution remains open. A completed record must identify a concrete 40-character release SHA and environment/device metadata, mark every C5E-01..16 case PASS, retain representative captures for all eight product surfaces plus multiplayer evidence, and pass `C5E_EVIDENCE_FILE=<record> pnpm verify:c5e`.

## C5F — final CAS evidence package

Implementation is in progress on `c5f/cas-evidence-package`.

C5F binds the final development/testing package to one exact release SHA. The package generator requires PASS evidence for C4D production, C5B performance, C5C deploy and rollback, C5D school-local, C5E human QA, and final main CI. It copies the architecture/operations/project record and declared local evidence, generates a package index, and writes SHA-256 checksums. Missing evidence, a non-PASS gate, or a release-SHA/checkout mismatch blocks generation.

C5F implementation can be merged before external/device evidence is complete. Final package generation remains intentionally blocked until all required release evidence exists.

## Remaining C5 gates

1. Execute and retain C5B browser/device performance evidence.
2. Close C4D production D1 provisioning/binding/migrations/rated smoke once Cloudflare D1 authorization is available.
3. Execute and retain final C5C production deploy/rollback evidence after the C4D prerequisite is closed.
4. Execute and retain C5D supported managed-school-Mac regression evidence.
5. Execute C5E browser/device human QA and final visual/UX sign-off.
6. Merge C5F, then generate the final CAS development/testing package from the final release SHA.

No C1-C4 product semantics are changed by this status packet.
