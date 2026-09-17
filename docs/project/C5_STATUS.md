# C5 Release Hardening Status

## Closed / merged implementation baseline

- C1-C4 product semantics: frozen.
- C5 release flight-control refinement: merged.
- C5A accessibility and security hardening: merged.
- C5B performance/evidence instrumentation: merged via PR #53 at `20b66fa33b47cf5aff5f54b081ecb902766261e1`.
- C5C deploy/rollback governance: merged via PR #54 at `93868f8d7bafcb2e7731865fb01298fc4b706615`.

## C5B — performance/evidence execution

The merged product flight reuses the canonical C2 runtime diagnostics without exposing development UI, exports the latest product-flight evidence as `window.__CAS_PERFORMANCE_EVIDENCE__`, and keeps the frozen 45 FPS target, 30 FPS floor, 60 FPS cap, 3-minute preflight, 30-minute benchmark, and 150 MiB observed-transfer target under CI contract verification.

C5B implementation is merged, but release evidence is not closed by static CI alone. The sustained browser/device benchmark and two-browser ranked product run in `docs/operations/C5B_PERFORMANCE_EVIDENCE.md` remain required.

## C5C — deploy / rollback execution

The merged C5C release-governance contract provides manual-only immutable-SHA production deploy, explicit version-ID rollback, pre/post Cloudflare state capture, shared production mutation concurrency, post-action smoke verification, and retained evidence artifacts.

C5C implementation is merged, but execution evidence is not closed until production deploy and rollback workflows are actually exercised and their artifacts retained. Final rated-product release evidence must be performed after C4D production D1 provisioning/binding/migrations are operational and `C4D_RATED_PRODUCTION_GATE=enabled`.

## C5D — school-local regression evidence

Implementation is in progress on `c5d/school-regression-evidence`.

C5D packages the existing school-local release surface into one aggregate evidence command. It covers C3 multiplayer, C4B matchmaking/assignment, C4C competition, C4D account/session/leaderboard, and C4D authenticated ranked-product smoke while recording Git/runtime/OS metadata and per-gate output.

Project CI retains the aggregate school regression report as an artifact. Final C5D execution evidence still requires the same aggregate command on the supported managed school Mac plus a browser usability observation; CI on a hosted Linux runner does not substitute for that device-specific evidence.

C5D also updates the school compatibility documentation from the earlier two-process C3 description to the current four-service C4 localhost topology.

## Remaining C5 gates

1. Execute and retain C5B browser/device performance evidence.
2. Close C4D production D1 provisioning/binding/migrations/rated smoke once Cloudflare D1 authorization is available.
3. Execute and retain final C5C production deploy/rollback evidence after the C4D prerequisite is closed.
4. Merge C5D, then execute and retain the supported managed-school-Mac regression evidence.
5. Complete browser/device human QA and final visual/UX sign-off.
6. Assemble the final CAS development/testing evidence package.

No C1-C4 product semantics are changed by this status packet.
