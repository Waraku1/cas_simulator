# School Network Compatibility

## Status

School-network usability is a formal project requirement.

Two independent constraints are confirmed on the managed school Mac:

1. the school network blocks the public Cloudflare `workers.dev` production hostname before application content loads; Chrome reports `NET::ERR_CERT_AUTHORITY_INVALID` and identifies Fortinet;
2. the Mac runs macOS 12.3, while the current Cloudflare `workerd` binary used by Miniflare/Vite local Worker development requires a newer macOS version.

The Cesium Earth client works through `http://127.0.0.1:5173`. Production Worker/Durable Object behavior is verified separately through GitHub-hosted infrastructure. The school compatibility issue is therefore handled through the supported localhost adapter path, not by bypassing managed network controls.

## Canonical school operating plan

### Full school mode without workerd

Use:

```bash
pnpm dev:school
```

Open:

```text
http://127.0.0.1:5173
```

The launcher starts four localhost services:

- Vite/Cesium client at `127.0.0.1:5173`;
- dependency-free local C3/C4 relay at `127.0.0.1:8787`;
- school-local account/session API at `127.0.0.1:8788`;
- authenticated ranked-product backend at `127.0.0.1:8789`.

`vite.school.config.ts` proxies the browser-facing API and WebSocket paths to the appropriate localhost backend. The browser therefore continues to exercise the same product-facing route families used by the current C4 application while production remains Cloudflare Worker + Durable Objects + D1 when provisioned.

The school adapters are bounded development/runtime parity layers. They do not replace the production architecture or create a second product contract.

## Automated school-local release check

With `pnpm dev:school` still running, open a second terminal and run:

```bash
pnpm verify:c5d:school
```

This is the canonical C5 release-regression command. It aggregates:

- C3 multiplayer relay smoke;
- C4B matchmaking and aircraft assignment smoke;
- C4C Heart Point competition smoke;
- C4D account/session/leaderboard smoke;
- C4D authenticated ranked-product smoke.

The command writes a structured JSON evidence record under `.c5-evidence/school-regression/` by default. See `docs/operations/C5D_SCHOOL_REGRESSION.md` for the release evidence contract.

The individual verification commands remain available for diagnosis:

```bash
pnpm verify:school
pnpm verify:school:c4b
pnpm verify:school:c4c
pnpm verify:school:c4d
pnpm verify:school:c4d:ranked
```

## Browser demonstration

Two independent browser contexts on the same development Mac may exercise the localhost product path through `127.0.0.1:5173`. This remains the canonical school demonstration boundary.

The Cesium browser connection still reaches Cesium ion for Earth data. That external path has already been verified on the school network.

### Client-only fallback

The previous client-only mode remains available:

```bash
pnpm dev
```

Use it only when backend/multiplayer/product behavior is intentionally unnecessary. It is not sufficient for C5D release-regression evidence.

## Why Cloudflare local runtime is not used at school

The current Cloudflare Vite plugin starts Miniflare/workerd for local Worker and Durable Object development. On the managed Mac this exits before server startup because the operating system is below the current workerd minimum supported macOS version.

The project does not pin an obsolete workerd build merely to bypass that platform requirement. The school Node adapters instead preserve the bounded browser/product contracts needed for local testing while removing workerd only from the school execution path.

## Separate-device boundary

This plan guarantees school use on the development Mac. It does **not** assume that a second school-managed device can reach a server hosted on that Mac across managed Wi-Fi.

Do not expose the local Vite or backend services on the school LAN unless that use is explicitly permitted. If separate-device school multiplayer becomes mandatory, it needs a network/hostname path permitted by school policy; it must not be implemented by evading the existing filter.

## Production deployment and backend verification

Production deployment remains GitHub Actions -> Cloudflare Workers. Deployment credentials and the production Cesium token remain in GitHub repository secrets. Production release governance and rollback evidence are defined separately in `docs/operations/C5C_DEPLOY_ROLLBACK.md`.

The blocked public production hostname is not used as the normal school execution path.

## Security boundary

Do not:

- bypass TLS/certificate warnings;
- disable or reconfigure Fortinet or school security controls;
- install unapproved CA certificates;
- use VPNs, proxies, alternate DNS, alternate-host routing, or similar mechanisms for the purpose of evading school filtering;
- modify the application hostname solely to evade a block;
- expose a development server to the managed school LAN without authorization.

The compatibility solution is supported localhost application execution, not circumvention of the managed network policy.
