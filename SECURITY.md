# Security Policy

## Reporting a vulnerability

Do not post passwords, API tokens, session cookies, account identifiers, exploit payloads, or other sensitive details in a public GitHub issue.

If GitHub private vulnerability reporting is enabled for this repository, use that private reporting channel. If it is not available, open a minimal public issue stating that you need a private security contact, without including exploit details or sensitive data.

Include only the information needed to reproduce and assess the issue safely:

- affected commit or release;
- affected surface or route;
- expected versus observed behavior;
- impact in plain language;
- minimal reproduction steps that do not expose credentials or unrelated user data.

## Production boundary

Do not perform destructive, high-volume, or unauthorized testing against the production service. Do not create, modify, or delete production Cloudflare resources, D1 data, deployment state, or repository protection settings as part of a security report.

The governed production workflows are intentionally manual, SHA-bound, main-ref restricted, serialized, and attached to the GitHub Actions `production` Environment.

## Credentials and evidence

Never commit:

- `CLOUDFLARE_API_TOKEN`;
- `CLOUDFLARE_ACCOUNT_ID` when it is being treated as deployment configuration;
- Cesium ion tokens other than intentionally restricted browser-use configuration;
- cookies, session tokens, passwords, or authentication headers;
- `.env`, `.env.local`, `.dev.vars`, or generated secret files;
- raw `.c5-evidence/` captures containing sensitive or personally identifying information.

If a credential is accidentally disclosed, treat it as compromised and rotate/revoke it through the owning service before continuing release work.

## Supported state

Security fixes should target the current `main` release lineage. The project is currently in pre-release evidence closure; the final public release is not considered complete until the C4 production-persistence and C5 release-evidence gates are closed.
