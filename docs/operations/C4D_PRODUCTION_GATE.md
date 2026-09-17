# C4D Production Gate Runbook

## Current blocker

Cloudflare identity is valid (`wrangler whoami` passes), but the configured API token is not authorized for D1 database listing. `wrangler d1 list --json` fails with Cloudflare authentication error code `10000`.

Do not bind a placeholder D1 ID and do not enable the rated production gate until D1 authorization is corrected.

## Execution sequence after D1 authorization is available

1. From the main branch, manually dispatch the `C4D provision D1` GitHub Actions workflow.
2. Confirm `C4D_D1_READ_AUTHORIZATION=PASS`.
3. Provision or reuse `cas-simulator-accounts` and record the returned real database ID.
4. Confirm both migrations apply remotely and the schema contains `users`, `sessions`, `rated_matches`, and `d1_migrations`.
5. Add the real `ACCOUNTS` D1 binding to `wrangler.jsonc` in a normal branch/PR. Never use a placeholder ID.
6. Confirm `pnpm verify:c4d:binding` reports `C4D_PRODUCTION_BINDING=PASS` for that reviewed config.
7. Set repository variable `C4D_RATED_PRODUCTION_GATE=enabled` only with the release change that introduces the real binding.
8. Run normal CI and merge only if green.
9. Dispatch `Deploy production` using the exact merged release SHA. The deploy scaffold must fail closed before Worker mutation unless the rated binding validator passes.
10. Require existing C3 production root/health/WebSocket smoke to remain green.
11. Require `C4D_PRODUCTION_RATED_PRODUCT_SMOKE` to pass.
12. Require `c4d-cleanup-verification.json` to show zero remaining run-scoped users, sessions, and rated matches.
13. Require `C4D_PRODUCTION_SMOKE_CLEANUP=PASS`, then close C4D and proceed to final C5 evidence execution.

The provisioning workflow performs no Worker deployment. It only validates Cloudflare identity/D1 authorization, creates or reuses the named D1 database, applies migrations, validates the expected schema, and prints the real database ID for the subsequent reviewed binding PR.

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
