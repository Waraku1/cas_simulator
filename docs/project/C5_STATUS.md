# C5 Release Hardening Status

## Closed / merged baseline

- C1-C4 product semantics: frozen.
- C5 release flight-control refinement: merged.
- C5A accessibility and security hardening: merged.

## C5B — performance/evidence gate

Implementation status on `c5b/performance-evidence-gate`:

- product flight now reuses the canonical C2 runtime diagnostics without exposing development UI;
- latest product-flight evidence is exported as `window.__CAS_PERFORMANCE_EVIDENCE__`;
- CI verifies the frozen 45 FPS target, 30 FPS floor, 60 FPS cap, 3-minute preflight, 30-minute benchmark, and 150 MiB observed-transfer target remain wired;
- the browser/device evidence protocol is documented in `docs/operations/C5B_PERFORMANCE_EVIDENCE.md`.

C5B is not considered fully closed by static CI alone. Human/browser evidence still requires the sustained benchmark and two-browser ranked product run described in the runbook.

## Remaining C5 gates after C5B implementation

1. Execute and retain C5B browser/device performance evidence.
2. Close C4D production D1 provisioning/binding/migrations/rated smoke once Cloudflare D1 authorization is available.
3. Complete production deploy/rollback same-version evidence.
4. Complete supported school-local regression evidence.
5. Complete browser/device human QA and final visual/UX sign-off.
6. Assemble the final CAS development/testing evidence package.

No C1-C4 product semantics are changed by this status packet.
