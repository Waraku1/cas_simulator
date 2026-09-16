# C0 Status

Status: CLOSED — ENGINEERING FOUNDATION

## Verified foundation

- Project structure and dependency contract: PASS.
- Frozen-lockfile dependency installation: PASS.
- Cesium Earth viewport and restricted-token setup: PASS locally.
- 50 km × 50 km theater configuration: PASS.
- Runtime FPS / browser-visible transfer diagnostics: PASS.
- Cloudflare Worker health endpoint: PASS in production.
- Worker/static-asset routing contract: PASS.
- Cesium runtime asset synchronization: PASS.
- TypeScript check: PASS.
- Production build: PASS.
- GitHub Actions production deployment: PASS.
- Production root HTTP verification from GitHub-hosted infrastructure: PASS.
- `/api/health`: `ok: true`, `stage: C0_FOUNDATION`.

## Local browser evidence

Observed on the development Mac:

- Cesium Earth renders and is interactive.
- FPS: 120.
- Visible transfer: 43.4 MiB.
- Resources: 163.

These are C0 diagnostic observations, not the final C2 performance benchmark.

## Production deployment evidence

Production origin:

`https://cas-flight-simulator.heleshiheiheleshihei.workers.dev`

Formal production deployment run: `35036193599`

Cloudflare version ID: `40e93b27-20d7-4d37-ade8-cd2145df0afe`

Health response observed by GitHub Actions:

```json
{"ok":true,"stage":"C0_FOUNDATION","service":"cas-flight-simulator"}
```

## Managed-network constraint

The development Mac runs macOS 12.3, while the current local Cloudflare `workerd` requires a newer supported macOS. Therefore school-day frontend development uses the client-only Vite configuration.

The school-managed Wi-Fi additionally blocks the current `workers.dev` hostname through Fortinet/TLS policy before application content loads. Because the same Mac and same Wi-Fi successfully render Cesium Earth through localhost, this is tracked as an external network-policy limitation rather than a foundation implementation defect.

Operational split:

- School development/demo: `pnpm dev` on localhost.
- Production build/deploy/runtime checks: GitHub Actions + Cloudflare Workers.
- Final cloud browser verification: allowed external network before C5 release closure.
- No attempt is made to bypass or disable school network controls.

School-network cloud reachability is tracked in Issue #2 and does not block C1–C4 engineering work.

## Next gate

C1 — Flight may begin.
