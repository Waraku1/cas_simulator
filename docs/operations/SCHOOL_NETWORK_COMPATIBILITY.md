# School Network Compatibility

## Status

The school-managed network blocks the current Cloudflare `workers.dev` production hostname before application content loads. Chrome reports `NET::ERR_CERT_AUTHORITY_INVALID` and identifies Fortinet.

The same development Mac and school Wi-Fi successfully run the Cesium Earth client through `http://127.0.0.1:5173`, while GitHub-hosted infrastructure successfully reaches the deployed production root and `/api/health`. Therefore this is treated as an external managed-network policy constraint rather than an application failure.

## Canonical operating plan

### School-day development and demonstrations

Use the client-only local environment:

```bash
pnpm dev
```

Open:

```text
http://127.0.0.1:5173
```

This is the supported school-network path for C1–C4 development.

### Production deployment and backend verification

Use GitHub Actions and Cloudflare Workers. Deployment credentials and the production Cesium token remain in GitHub repository secrets. Post-deploy checks verify the production root and `/api/health` from supported external infrastructure.

### Final browser verification

Before C5 release closure, verify the production site in desktop browsers from an allowed non-school network. School-network access to the public production hostname is not required for C1–C4 engineering completion.

## Security boundary

Do not:

- bypass TLS/certificate warnings;
- disable or reconfigure Fortinet or school security controls;
- install unapproved CA certificates;
- use VPNs, proxies, alternate DNS, alternate-host routing, or similar mechanisms for the purpose of evading school filtering;
- modify the application hostname solely to evade a block.

If school-network public access ever becomes a formal project requirement, it must use an approved network/hostname path. Until then, localhost is the canonical school environment.
