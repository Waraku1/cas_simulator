# School Network Compatibility

## Status

School-network usability is a formal project requirement.

Two independent constraints are now confirmed on the managed school Mac:

1. the school network blocks the public Cloudflare `workers.dev` production hostname before application content loads; Chrome reports `NET::ERR_CERT_AUTHORITY_INVALID` and identifies Fortinet;
2. the Mac runs macOS 12.3, while the current Cloudflare `workerd` binary used by Miniflare/Vite local Worker development requires macOS 13.5 or later.

The Cesium Earth client itself works through `http://127.0.0.1:5173`, and GitHub-hosted infrastructure verifies the production Worker, Durable Object binding, and WebSocket relay. The school compatibility problem is therefore environmental, not a failure of the C1/C2/C3 application logic.

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

The command starts two localhost processes:

- Vite/Cesium client at `127.0.0.1:5173`;
- dependency-free Node multiplayer relay at `127.0.0.1:8787`.

`vite.school.config.ts` proxies `/api/*` and WebSocket upgrades from port 5173 to the relay. Browser code therefore keeps using the same-origin paths used in production:

- `/api/health`;
- `/api/rooms/{ROOM}/ws`.

The Node relay implements only the bounded C3 contract needed for school use:

- 6-character room validation;
- maximum 2 clients;
- server-generated player identity and slot;
- welcome/presence messages;
- bounded text snapshot validation;
- peer pose relay;
- disconnect presence update.

It does not replace the production architecture. Production remains Cloudflare Worker + SQLite-backed Durable Object + Hibernation WebSocket API.

### Automated school-local multiplayer check

With `pnpm dev:school` still running, open a second terminal and run:

```bash
pnpm verify:school
```

Expected result includes:

```text
"ok": true
"gate": "SCHOOL_LOCAL_MULTIPLAYER_SMOKE"
"players": 2
"relaySequence": 1
```

Before opening WebSockets, the verifier confirms that `/api/health` returns the C3 multiplayer feature. It then verifies two local clients, shared-room presence, and one peer-pose relay.

### Browser demonstration

Two independent browser contexts on the same development Mac may connect to the same local room through `127.0.0.1:5173`. This is the canonical school demonstration path for C3.

The Cesium browser connection still reaches Cesium ion for Earth data. That path has already been verified on the school network.

### Client-only fallback

The previous client-only mode remains available:

```bash
pnpm dev
```

Use it only when multiplayer/backend behavior is intentionally unnecessary.

## Why Cloudflare local runtime is not used at school

The current Cloudflare Vite plugin starts Miniflare/workerd for local Worker and Durable Object development. On the managed Mac this exits before server startup because macOS 12.3 is below the current workerd minimum supported macOS version.

The project does not pin an obsolete workerd build merely to bypass that platform requirement. Doing so would create an unsupported compatibility surface against the current C3 Durable Object configuration. The school Node relay instead keeps the production protocol stable while removing workerd only from the school execution path.

## Separate-device boundary

This plan guarantees school use on the development Mac. It does **not** assume that a second school-managed device can reach a server hosted on that Mac across managed Wi-Fi.

Do not expose the local Vite/relay server on the school LAN unless that use is explicitly permitted. If separate-device school multiplayer becomes mandatory, it needs a network/hostname path permitted by school policy; it must not be implemented by evading the existing filter.

## Production deployment and backend verification

Production deployment remains GitHub Actions -> Cloudflare Workers. Deployment credentials and the production Cesium token remain in GitHub repository secrets. Post-deploy verification covers the production root, C3 health feature, and two-client WebSocket relay.

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
