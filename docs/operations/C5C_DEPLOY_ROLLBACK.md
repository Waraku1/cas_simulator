# C5C Production Deploy / Rollback Evidence Gate

## Scope

C5C establishes a reproducible production deployment, rollback, and final-release restoration evidence path without changing C1-C4 product semantics, flight behavior, account rules, matchmaking, Heart Point competition, aircraft balance, or rating logic.

The implementation consists of two manual GitHub Actions workflows:

- `.github/workflows/deploy.yml` — deploy an exact selected Git commit to production, explicitly labeled as either `initial_release` or `restore_after_rollback`;
- `.github/workflows/rollback.yml` — restore one explicit existing Cloudflare Worker version.

Neither workflow runs on push or pull request events. Production mutation therefore requires an explicit manual dispatch.

## Safety and authority boundary

A production deploy requires the operator to paste the exact full Git SHA selected in the workflow UI and select one explicit deployment purpose. The workflow rejects the operation unless `confirm_sha` exactly equals `GITHUB_SHA` and `deployment_purpose` is one of:

- `initial_release` — the first deployment of the final release SHA before rollback verification;
- `restore_after_rollback` — the final same-SHA deployment that restores the intended release after rollback verification.

A production rollback requires all of the following:

1. the exact full Git SHA of the governance workflow ref in `confirm_sha`;
2. an explicit Cloudflare `target_version_id`;
3. the literal confirmation value `ROLLBACK`.

Rollback never selects an implicit previous version. Both workflows share the `production-deploy` concurrency group, so deploy and rollback cannot mutate production concurrently.

### Rated D1 binding preflight

`pnpm validate:scaffold` routes through `scripts/verify-release-scaffold.mjs`. When `C4D_RATED_PRODUCTION_GATE=enabled`, the release scaffold invokes the production-binding validator with `C4D_BINDING_REQUIRED=1` before the Worker deployment command can run.

The validator requires exactly one D1 entry with:

- `binding: "ACCOUNTS"`;
- `database_name: "cas-simulator-accounts"`;
- a real, non-placeholder D1 UUID in `database_id`.

A missing binding is allowed only while the rated production gate is disabled. Once the rated gate is enabled, missing, duplicate, wrongly named, malformed, or placeholder bindings fail closed before Worker mutation.

## Evidence model

Before and after each production action, the workflow records Cloudflare deployment/version state, Git identity, Actions run identity, rated-gate state, UTC start/finish timestamps, production root/health, multiplayer smoke, rated-product smoke, and verified D1 cleanup evidence.

Deploy metadata additionally records `deployment_purpose`. The deployment artifact name also contains that purpose so the initial and restoration runs cannot be confused operationally.

The cleanup step resolves only the run-scoped smoke accounts, deletes their related rated-match/session rows and users, then queries D1 again. `C4D_PRODUCTION_SMOKE_CLEANUP=PASS` or `C4D_ROLLBACK_SMOKE_CLEANUP=PASS` is emitted only when remaining `users`, `sessions`, and `rated_matches` counts are all exactly zero.

Artifacts are retained for 30 days even when a later verification step fails.

## Required final execution sequence

Final C5C evidence is intentionally a three-mutation sequence on the same release SHA:

1. **Initial release deploy** — dispatch **Deploy production** on the final release SHA with `deployment_purpose=initial_release`. Require the rated gate enabled, full smoke PASS, and zero-count cleanup evidence. Retain the purpose-labeled deployment artifact.
2. **Rollback proof** — select a known-good compatible Worker version and dispatch **Rollback production** from the same release governance SHA. Require root/health/multiplayer/rated smoke PASS and zero-count cleanup. Retain the rollback artifact.
3. **Final restoration deploy** — dispatch **Deploy production** again on the exact same release SHA with `deployment_purpose=restore_after_rollback`. Require the same full production validation and zero-count cleanup, then retain the restoration artifact.

The restoration deploy is mandatory. Successful rollback evidence by itself leaves production on the rollback target and therefore cannot represent the final production state.

## Initial deploy procedure

1. Confirm the intended final release commit has passed Project CI.
2. Open **Deploy production** and select the exact release ref.
3. Paste the full SHA into `confirm_sha`.
4. Select `initial_release` as `deployment_purpose`.
5. Dispatch the workflow.
6. Require `C4D_PRODUCTION_BINDING=PASS` when the rated gate is enabled.
7. Require root, health, multiplayer, and rated-product smoke PASS.
8. Require `c4d-cleanup-verification.json` zero counts and `C4D_PRODUCTION_SMOKE_CLEANUP=PASS`.
9. Retain `c5-production-deploy-initial_release-<run>-<attempt>`.

## Rollback procedure

1. Identify a known-good Worker version ID from retained deployment evidence or Cloudflare version history.
2. Verify compatibility with the current Durable Object/resource topology.
3. Open **Rollback production** on the same release governance ref.
4. Provide the exact SHA, explicit `target_version_id`, and literal `ROLLBACK` confirmation.
5. Dispatch and retain `c5-production-rollback-<run>-<attempt>`.
6. Require post-rollback root, health, multiplayer, rated-product smoke, zero-count cleanup, and `C4D_ROLLBACK_SMOKE_CLEANUP=PASS`.

## Final restoration procedure

1. Re-open **Deploy production** on the exact same final release SHA used for the initial deploy.
2. Paste that same SHA into `confirm_sha`.
3. Select `restore_after_rollback` as `deployment_purpose`.
4. Dispatch the workflow.
5. Require the same binding preflight, build, root/health/multiplayer/rated-product smoke, and zero-count cleanup as the initial deploy.
6. Retain `c5-production-deploy-restore_after_rollback-<run>-<attempt>`.
7. Treat this successful restoration deployment as the final production state for C5 closure.

C5F machine-checks that the initial deploy finished before rollback began and that rollback finished before the restoration deploy began. Both deployment artifacts and the rollback artifact must identify the same release SHA/governance SHA.

`wrangler deploy` includes deployment purpose, Git SHA, and Actions run identity in its Cloudflare version message, creating a direct trace from Cloudflare history back to the evidence artifact.

## Durable Object / binding constraint

Do not use rollback as a substitute for data or resource migration reversal. A rollback target must remain compatible with current Cloudflare resources and Durable Object lifecycle. If an incompatible binding or Durable Object class lifecycle change exists, stop and resolve the infrastructure compatibility explicitly rather than forcing rollback.

C5C itself introduces no Durable Object migration or application binding change.

## C4D prerequisite relationship

C5C implementation can be validated while external C4D D1 authorization remains open. A deploy/rollback run with `C4D_RATED_PRODUCTION_GATE=disabled` is only governance evidence and cannot close the final rated-product release gate.

Final C5 closure requires all three production mutations above only after the C4D D1 database, binding, migrations, and rated production path are operational.

## Closure criteria

C5C implementation is ready when Project CI validates the manual-only workflows, immutable SHA confirmation, explicit deployment purpose, explicit rollback target/confirmation, fail-closed real D1 binding, before/after Cloudflare evidence, production smoke, and zero-count cleanup without changing C1-C4 semantics.

C5C execution evidence is closed only after the `initial_release` deploy, rollback proof, and same release SHA `restore_after_rollback` deployment have all completed successfully, their artifacts are retained, and C5F verifies their ordering. The restoration deploy, not the rollback target, is the required final production state.
