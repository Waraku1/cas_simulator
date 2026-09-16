# School Network Compatibility

## Status

The production Worker is healthy and deployed, but the school network currently blocks the `workers.dev` production hostname through Fortinet HTTPS filtering. Chrome reports `NET::ERR_CERT_AUTHORITY_INVALID` and identifies Fortinet.

This is treated as a managed-network policy/certificate issue, not an application or Cloudflare deployment failure.

## Evidence

- Local client-only `pnpm dev` renders Cesium Earth successfully on the same development Mac.
- GitHub Actions production deployment succeeds.
- Production root HTTP verification succeeds from GitHub-hosted infrastructure.
- `/api/health` returns `ok: true` and `stage: C0_FOUNDATION` from production.
- The school browser cannot open the exact `workers.dev` hostname and reports a Fortinet certificate error.

## Approved resolution order

1. Ask school IT to inspect FortiGate Web Filter, Application Control, DNS Filter, and SSL inspection logs for the exact production hostname.
2. Request an allowlist exception for the exact project hostname only:
   - `cas-flight-simulator.heleshiheiheleshihei.workers.dev`
3. Do not disable Fortinet, bypass TLS warnings, install unapproved certificates, or use alternate routing intended to evade school filtering.
4. If school policy does not permit `workers.dev`, use a school-approved Custom Domain for the Worker. The domain must be owned/approved and configured through Cloudflare normally.
5. After a Custom Domain is approved, update the Cesium production token Allowed URL and set the GitHub Actions repository variable `PRODUCTION_URL` to the new origin. The deployment workflow already supports this variable.

## Cesium dependencies

The current client uses Cesium ion with `Terrain.fromWorldTerrain()` and a restricted browser token. Cesium ion's default API endpoint is `https://api.cesium.com`, with asset data commonly served from `https://assets.cesium.com`. The existing local Cesium render on the school network indicates these dependencies are currently reachable, so they should not be broadened in an allowlist request unless Fortinet logs show they are blocked.

## C0 closure

C0 remains open until browser-level production rendering is verified. The Worker/backend production gate itself is already healthy. Browser verification can be performed on an approved unrestricted network while school-network access is being resolved, but school-network compatibility remains a tracked operational requirement for the CAS deployment.
