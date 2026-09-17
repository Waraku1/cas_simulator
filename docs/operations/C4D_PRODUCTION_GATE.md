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
6. Set repository variable `C4D_RATED_PRODUCTION_GATE=enabled` only in the same release change that introduces the real binding.
7. Run normal CI and merge only if green.
8. Dispatch `Deploy production`.
9. Require existing C3 production root/health/WebSocket smoke to remain green.
10. Require `C4D_PRODUCTION_RATED_PRODUCT_SMOKE` to pass.
11. Require `C4D_PRODUCTION_SMOKE_CLEANUP=PASS`.
12. Verify no smoke users remain in D1, then close C4D and proceed to C5 release hardening.

The provisioning workflow performs no Worker deployment. It only validates Cloudflare identity/D1 authorization, creates or reuses the named D1 database, applies migrations, validates the expected schema, and prints the real database ID for the subsequent reviewed binding PR.

## Production rated smoke contract

The smoke creates two run-scoped accounts, verifies authenticated matchmaking, the one-account/one-active-match lock, an authoritative FORFEIT result, rating/W-L updates, post-result fixable-aircraft persistence, duplicate-result idempotency, leaderboard ordering, fixed-aircraft selection, lock release, and a second match.

The deploy workflow derives smoke login IDs from the GitHub Actions run ID. Its `always()` cleanup removes matching `rated_matches`, sessions, and users after the deployed smoke, including failure cases.

## Failure handling

- D1 authorization failure: stop before create/reuse, migration, binding, or deploy.
- D1 provisioning/migration failure: stop before changing `wrangler.jsonc` or deploying.
- Worker deploy failure: do not run rated smoke; existing deployment remains the rollback target.
- C3 production smoke failure: treat as release regression and stop C4D closure.
- C4D rated smoke failure: cleanup must still run; keep C4D open and inspect the exact failed contract before another deploy.
- Cleanup failure: keep C4D open and manually inspect only the run-scoped smoke rows before retrying; never delete non-smoke users.
