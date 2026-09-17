# C5 Release Hardening Status

## Closed / merged baseline

- C1-C4 product semantics: frozen.
- C5 release flight-control refinement: merged.
- C5A accessibility and security hardening: merged.
- C5B performance/evidence instrumentation: merged via PR #53 at `20b66fa33b47cf5aff5f54b081ecb902766261e1`.

## C5B — performance/evidence execution

The merged product flight reuses the canonical C2 runtime diagnostics without exposing development UI, exports the latest product-flight evidence as `window.__CAS_PERFORMANCE_EVIDENCE__`, and keeps the frozen 45 FPS target, 30 FPS floor, 60 FPS cap, 3-minute preflight, 30-minute benchmark, and 150 MiB observed-transfer target under CI contract verification.

C5B implementation is merged, but release evidence is not closed by static CI alone. The sustained browser/device benchmark and two-browser ranked product run in `docs/operations/C5B_PERFORMANCE_EVIDENCE.md` remain required.

## C5C — deploy / rollback governance

Implementation is in progress on `c5c/release-deploy-rollback-governance`.

The bounded C5C contract adds:

- manual-only production deploy with exact full-SHA confirmation;
- Git-SHA traceability in Cloudflare Worker version/deployment history;
- pre/post Cloudflare deployment and version-state capture;
- explicit version-ID rollback with literal `ROLLBACK` confirmation;
- shared deployment concurrency to prevent simultaneous deploy/rollback mutation;
- root, health and multiplayer post-action smoke evidence;
- optional C4D rated-product production smoke when its gate is enabled;
- retained GitHub Actions evidence artifacts for both deploy and rollback.

C5C changes release governance only. It does not change C1-C4 gameplay, flight, multiplayer, account, aircraft, competition, or rating semantics.

C5C implementation can be validated while the external C4D D1 authorization prerequisite remains open. C5C execution evidence is not closed until the production deploy and rollback workflows are actually exercised and their artifacts retained. Final rated-product release evidence must be repeated after C4D production D1 provisioning/binding/migrations are operational and `C4D_RATED_PRODUCTION_GATE=enabled`.

## Remaining C5 gates

1. Execute and retain C5B browser/device performance evidence.
2. Close C4D production D1 provisioning/binding/migrations/rated smoke once Cloudflare D1 authorization is available.
3. Merge C5C deploy/rollback governance, then execute and retain final production deploy/rollback evidence after the C4D prerequisite is closed.
4. Complete supported school-local regression evidence.
5. Complete browser/device human QA and final visual/UX sign-off.
6. Assemble the final CAS development/testing evidence package.

No C1-C4 product semantics are changed by this status packet.
