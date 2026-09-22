# C4D Production Gate Runbook

## Current blocker

Gate 1 attempt 2 confirmed D1 authorization is now valid and created the real `cas-simulator-accounts` database. The run then exposed a provisioning-workflow defect: before the reviewed production binding exists, Wrangler cannot resolve the database name for `d1 migrations apply` from the repository's production `wrangler.jsonc`.

The workflow therefore creates a runner-local temporary Wrangler config after resolving the real D1 UUID. That temporary config contains only the provisioning-time `ACCOUNTS` binding plus `migrations_dir`, and is passed explicitly to both migration and schema-verification commands. It is not committed, deployed, or treated as the final production Worker binding. The reviewed `wrangler.jsonc` binding remains a later release PR step.


## GitHub production environment boundary

The C4D D1 provisioning job is repository-bound to the GitHub Actions environment named `production`. The same environment is referenced by production deploy and rollback. This repository-side binding enables GitHub environment protection rules and environment-scoped secrets to gate all production mutation jobs through one deployment boundary.

This binding does **not** itself prove that required reviewers, branch/tag deployment policies, prevent-self-review, or environment-scoped Cloudflare secrets have been configured in repository Settings. Those remain external operator controls and must be verified before final production execution. Until then, `environment: production` is a required hook, not evidence that the external protection policy is active.

## Execution sequence after D1 authorization is available

1. Read the current full 40-character `main` SHA and manually dispatch the `C4D provision D1` GitHub Actions workflow from `main`, supplying that exact value as `confirm_sha`. The workflow must emit `C4D_PROVISION_SOURCE=PASS`; any non-`refs/heads/main` ref or SHA mismatch fails before Cloudflare access.
2. Confirm `C4D_D1_READ_AUTHORIZATION=PASS`.
3. Provision or reuse `cas-simulator-accounts` and record the returned real database ID. Generate a runner-local temporary Wrangler config binding `ACCOUNTS` to that exact UUID for provisioning-time migration/schema commands only.
4. Confirm all committed migrations apply remotely through that temporary config — including `0001_c4a_accounts.sql`, `0002_c4d_rating.sql`, and `0003_account_lifecycle.sql` — and verify the schema contains `users`, `sessions`, `rated_matches`, `d1_migrations`, plus the `users.deleted_at_ms` account-lifecycle column.
5. Retain the `c4d-d1-provision-<run>-<attempt>` artifact. Its `c4d-provision.json` is the canonical machine-readable record for the provisioned D1 UUID and successful authorization/schema gates.
6. Add the real `ACCOUNTS` D1 binding to `wrangler.jsonc` in a normal branch/PR. Never use a placeholder ID.
7. Confirm `pnpm verify:c4d:binding` reports `C4D_PRODUCTION_BINDING=PASS` for that reviewed config.
8. Set repository variable `C4D_RATED_PRODUCTION_GATE=enabled` only with the release change that introduces the real binding.
9. Run normal CI and merge only if green.
10. Dispatch `Deploy production` using the exact merged release SHA. The deploy scaffold must fail closed before Worker mutation unless the rated binding validator passes.
11. Require existing C3 production root/health/WebSocket smoke to remain green.
12. Require `C4D_PRODUCTION_RATED_PRODUCT_SMOKE` to pass.
13. Require `c4d-cleanup-verification.json` to show zero remaining run-scoped users, sessions, and rated matches.
14. Require `C4D_PRODUCTION_SMOKE_CLEANUP=PASS`, then close C4D and proceed to final C5 evidence execution.

The provisioning workflow performs no Worker deployment. It validates Cloudflare identity/D1 authorization, creates or reuses the named D1 database, applies migrations, validates the expected schema, and retains the provisioning lineage artifact for the subsequent reviewed binding PR and final C5F package. D1 provisioning shares the repository-wide `production-mutation` concurrency group with production deploy and rollback, with cancellation disabled, so schema/resource mutation cannot overlap Worker deployment, rollback, or their production smoke/cleanup sequence.

## Provisioning evidence contract

The provisioning workflow retains a 30-day artifact named `c4d-d1-provision-<run>-<attempt>`. Successful evidence includes:

- `c4d-provision.json` with gate `C4D_PRODUCTION_D1`, status/provisioning/read-authorization/schema all `PASS`, `accountLifecycleSchema=PASS`, `gitRef=refs/heads/main`, a full provisioning `gitSha`, database name `cas-simulator-accounts`, and the real D1 UUID;
- `d1-list-before.json` and `d1-list-after.json`;
- `migrations.txt`;
- `schema-after.json`, `users-schema-after.json`, and `schema-verification.txt`, with both `C4D_D1_SCHEMA=PASS` and `C4D_ACCOUNT_LIFECYCLE_SCHEMA=PASS`;
- run/SHA metadata.

C5F later requires the provisioning record to come from `refs/heads/main`, requires a full provisioning Git SHA, and compares the UUID in `c4d-provision.json` with the final reviewed `ACCOUNTS` binding. The provisioning Git SHA itself need not equal the final release SHA because the binding PR necessarily follows provisioning and changes repository history.

## Binding release contract

The release `wrangler.jsonc` must contain exactly one D1 binding for the account store with:

```json
{
  "d1_databases": [
    {
      "binding": "ACCOUNTS",
      "database_name": "cas-simulator-accounts",
      "database_id": "<real D1 UUID returned by provisioning>"
    }
  ]
}
```

`scripts/verify-c4d-production-binding.mjs` rejects a missing required binding, duplicate `ACCOUNTS` entries, a wrong database name, malformed IDs, and the all-zero placeholder UUID. In the pre-provision repository state the binding may be absent while `C4D_RATED_PRODUCTION_GATE` is disabled. When that gate is enabled, `pnpm validate:scaffold` routes through `scripts/verify-release-scaffold.mjs`, which invokes the binding validator with `C4D_BINDING_REQUIRED=1`; failure stops the production workflow before `wrangler deploy`.

Project CI runs `C4D_BINDING_SELF_TEST=1 pnpm verify:c4d:binding` so the validator's accept/reject behavior remains covered before a real database ID is committed.

## Production rated smoke contract

The smoke creates two run-scoped accounts, verifies authenticated matchmaking, the one-account/one-active-match lock, an authoritative FORFEIT result, rating/W-L updates, post-result fixable-aircraft persistence, duplicate-result idempotency, leaderboard ordering, fixed-aircraft selection, lock release, and a second match.

The deploy workflow derives smoke login IDs from the GitHub Actions run ID. Its `always()` cleanup resolves only those run-scoped account IDs, removes matching `rated_matches`, sessions, and users, then queries D1 again. The cleanup PASS marker is emitted only when all three remaining counts are exactly zero; the query result is retained as `c4d-cleanup-verification.json`.

## Failure handling

- D1 authorization failure: stop before create/reuse, migration, binding, or deploy.
- D1 provisioning/migration failure: stop before changing `wrangler.jsonc` or deploying.
- Binding validation failure: do not enable/retain the rated gate for deployment; correct the reviewed binding and rerun CI.
- Worker deploy failure: do not run rated smoke; existing deployment remains the rollback target.
- C3 production smoke failure: treat as release regression and stop C4D closure.
- C4D rated smoke failure: cleanup must still run; keep C4D open and inspect the exact failed contract before another deploy.
- Cleanup or zero-count verification failure: keep C4D open and manually inspect only the run-scoped smoke rows before retrying; never delete non-smoke users.
