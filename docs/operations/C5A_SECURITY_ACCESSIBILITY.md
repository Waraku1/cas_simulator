# C5A Security and Accessibility Hardening

## Scope

This gate hardens the merged C1-C5 release baseline without changing the accepted product loop, flight controls, ranked match rules, aircraft semantics, or C4 persistence contracts.

## Accessibility closure

The product accessibility layer is intentionally additive and does not redesign the visual UI.

Implemented targets:

- Authentication segmented control exposes tab semantics, selected state, roving tab focus, and Left/Right/Home/End keyboard navigation.
- Loading, matchmaking, assignment/countdown, match phase/action feedback, and result transitions are announced through persistent live regions.
- Matchmaking errors are assertive alerts.
- Heart Point blocks expose programmatic progressbar values from 0 to 100, with local/opponent labels and value text.
- Leaderboard rows expose compact accessible row summaries without altering the visual layout.
- Product controls receive explicit `:focus-visible` outlines.
- Reduced-motion preferences suppress non-essential product animation and transition timing.

## Session and identity review

The production account contract already provides the following controls and they remain unchanged:

- Session tokens are issued as `HttpOnly` cookies.
- Session cookies use `SameSite=Lax`.
- `Secure` is added when the request is served over HTTPS.
- Sessions expire after seven days.
- Only a hash of the opaque session token is persisted.
- Password derivation uses PBKDF2-HMAC-SHA256 with the accepted 600,000-iteration production work factor.
- Ranked identity is resolved server-side from the authenticated session.
- Publicly supplied identity-like headers are overwritten by the Worker before the request enters ranked transport.

C5A adds an explicit browser-origin boundary for state-changing account operations and ranked transport. Requests with an `Origin` header are accepted only when that origin equals the application origin. Requests without `Origin` remain supported for trusted non-browser verification tooling and school-local automation.

## Response hardening

Static product responses and non-WebSocket Worker responses add the following low-risk controls:

- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`
- `X-Frame-Options: DENY`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `Cross-Origin-Resource-Policy: same-origin` on Worker responses

WebSocket upgrade responses are returned without reconstruction so the Cloudflare upgrade contract is preserved.

A strict Content-Security-Policy is not introduced in this bounded patch. Cesium/runtime asset dependencies must first be enumerated and tested before a CSP can be made release-blocking without risking false breakage.

## Remaining infrastructure dependency

C5A deliberately does not implement process-local request counters as a substitute for real rate limiting. Production brute-force, registration-abuse, and connection-abuse controls require a shared edge/infrastructure mechanism so limits are consistent across Worker isolates and deployments.

Final C5 closure must therefore record the production rate-limit/WAF posture separately. This is an explicit external release dependency, not a hidden in-process fallback.

## Verification contract

The C5A branch must pass:

1. `pnpm validate:scaffold`
2. `pnpm check`
3. `pnpm verify:c4c:runtime`
4. `pnpm verify:c5a`
5. `pnpm build`
6. existing school full-stack verification from Project CI

No C1-C4 product semantic changes are permitted as part of this gate.
