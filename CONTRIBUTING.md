# Contributing

## Project state

This repository is in release-hardening / release-evidence closure. C0-C3 are accepted, the C4 product loop is implemented, and C5 repository-side release governance is implemented. Remaining release work is primarily external production configuration and final evidence.

Avoid feature expansion unless an actual release-gate failure exposes a concrete defect. Unnecessary source changes after the final release SHA is selected can invalidate SHA-bound C5B, C5D, and C5E evidence.

## Development setup

Requirements:

- Node.js 22+
- pnpm 10.x

Install and configure local browser credentials:

```bash
pnpm install
cp .env.example .env.local
```

Use a restricted Cesium ion browser token in `.env.local`. Never commit credentials.

For the managed-school-Mac compatible full-stack path:

```bash
pnpm dev:school
```

For client-only development:

```bash
pnpm dev
```

## Required validation

Before opening or merging a source change, run the relevant local checks. The canonical repository checks include:

```bash
pnpm validate:scaffold
pnpm check
pnpm build
```

Release-governance changes must also preserve the applicable C5 validators. Project CI is authoritative for the complete committed verification set.

## Pull requests

Keep each pull request bounded to one problem. Explain:

- the problem being fixed;
- the intended behavior after the change;
- whether product semantics change;
- the validation performed;
- whether the change affects release evidence or the final release SHA.

Do not silently weaken a fail-closed release gate to make CI pass.

## Production operations

Do not dispatch C4D D1 provisioning, production deploy, or rollback merely to validate a source change.

Those workflows are production mutations and require the explicit release sequence documented in `docs/operations/`, including main-ref/full-SHA governance, the shared `production-mutation` lock, the GitHub Actions `production` Environment, and retained evidence.

Do not insert placeholder D1 UUIDs, bypass repository protection, disable release validators, or force a rollback target that fails the compatibility/preflight checks.

## Product boundary

This is a fictional arcade simulator. Contributions must preserve the abstract Heart Point competition model and must not introduce realistic weapons, ammunition, ballistics, guidance/lock-on, physical-damage modeling, realistic targeting, or real-aircraft combat-performance modeling.

## Evidence and privacy

Do not commit raw `.c5-evidence/` output automatically. Review screenshots, recordings, logs, and JSON evidence for credentials, cookies, account identifiers, student information, or other sensitive data before sharing.

## Licensing

No open-source license is currently declared. A contribution does not change that status. Do not assume that public repository visibility grants redistribution or relicensing rights.
