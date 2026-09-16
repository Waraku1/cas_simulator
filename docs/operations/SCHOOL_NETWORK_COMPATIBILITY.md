# School Network Compatibility

## Status

School-network usability is now a formal project requirement.

The school-managed network blocks the current public Cloudflare `workers.dev` production hostname before application content loads. Chrome reports `NET::ERR_CERT_AUTHORITY_INVALID` and identifies Fortinet.

The same development Mac and school Wi-Fi successfully run the Cesium Earth client through `http://127.0.0.1:5173`. GitHub-hosted infrastructure also reaches the deployed production root, health endpoint, Durable Object binding, and production WebSocket relay successfully. The remaining incompatibility is therefore managed-network reachability to the public Worker hostname, not the simulator, Cesium client, or C3 room implementation.

## Canonical school operating plan

### Full-stack school mode

Use:

```bash
pnpm dev:school
```

Open:

```text
http://127.0.0.1:5173
```

`dev:school` synchronizes the Cesium runtime assets and starts the normal Cloudflare Vite configuration locally. The Cloudflare Vite plugin/Miniflare provides local Worker and Durable Object resources, so these application paths remain on the development Mac:

- `/api/health`;
- `/api/rooms/{ROOM}/ws`;
- `MultiplayerRoom` Durable Object instances;
- two-client presence and pose relay.

This mode does not require browser access to the blocked public `workers.dev` hostname.

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

This verifies two local WebSocket clients, shared-room presence, and one peer-pose relay through the local Durable Object.

### Browser demonstration

Two independent browser contexts on the same development Mac may connect to the same local room through `127.0.0.1:5173`. This is the canonical school demonstration path for C3.

The Cesium browser connection still reaches Cesium ion for Earth data. That path has already been verified on the school network.

### Client-only fallback

The previous client-only mode remains available:

```bash
pnpm dev
```

Use it only when the Worker/Durable Object backend is intentionally unnecessary.

## Separate-device boundary

This plan guarantees full-stack school use on the development Mac. It does **not** assume that a second school-managed device can reach a server hosted on that Mac across the managed Wi-Fi.

Do not expose the local Vite/Worker server on the school LAN unless that use is explicitly permitted. If separate-device school multiplayer becomes a mandatory requirement, it needs a network/hostname path permitted by school policy; it must not be implemented by evading the existing filter.

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

The compatibility solution is local execution of the application's own Worker/Durable Object development runtime, not circumvention of the managed network policy.
