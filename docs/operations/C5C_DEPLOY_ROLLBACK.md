# C5C Production Deploy / Rollback Evidence Gate

## Scope

C5C establishes a reproducible production deployment and rollback evidence path without changing C1-C4 product semantics, flight behavior, account rules, matchmaking, Heart Point competition, aircraft balance, or rating logic.

The implementation consists of two manual GitHub Actions workflows:

- `.github/workflows/deploy.yml` — deploy an exact selected Git commit to production;
- `.github/workflows/rollback.yml` — restore one explicit existing Cloudflare Worker version.

Neither workflow runs on push or pull request events. Production mutation therefore requires an explicit manual dispatch.

## Safety and authority boundary

A production deploy requires the operator to paste the exact full Git SHA selected in the workflow UI. The workflow rejects the operation unless `confirm_sha` exactly equals `GITHUB_SHA`.

A production rollback requires all of the following:

1. the exact full Git SHA of the governance workflow ref in `confirm_sha`;
2. an explicit Cloudflare `target_version_id`;
3. the literal confirmation value `ROLLBACK`.

Rollback never selects an implicit previous version. This avoids ambiguity when multiple deployments or test versions exist.

Both workflows share the `production-deploy` concurrency group, so a deploy and rollback cannot mutate production concurrently.

## Evidence model

Before and after each production action, the workflow records:

- `wrangler deployments status --json`;
- `wrangler versions list --json`;
- Git SHA and Git ref used by the governance workflow;
- GitHub Actions run ID and attempt;
- C4D rated-production gate state;
- UTC start and finish timestamps;
- production root HTTP status;
- `/api/health` response;
- production multiplayer smoke output;
- C4D rated-product smoke output and cleanup evidence when that gate is enabled.

The evidence directory is uploaded with `actions/upload-artifact@v4` even when a later verification step fails. Retention is 30 days.

## Deploy procedure

1. Confirm the intended release commit has passed Project CI.
2. Open **Deploy production** in GitHub Actions.
3. Select the exact release ref.
4. Copy the full SHA for that ref and paste it into `confirm_sha`.
5. Dispatch the workflow.
6. Retain the `c5-production-deploy-<run>-<attempt>` artifact.
7. Confirm the artifact's `metadata.txt` records the intended SHA.
8. Confirm `deployments-after.json` and `versions-after.json` show the resulting Worker deployment/version state.
9. Confirm root, health and multiplayer smoke evidence are PASS.
10. For final C5 closure, repeat this evidence with `C4D_RATED_PRODUCTION_GATE=enabled` after the C4D production D1 prerequisite is closed.

`wrangler deploy` receives a version/deployment message containing the Git SHA and Actions run identity, creating a direct trace from Cloudflare version history back to GitHub evidence.

## Rollback procedure

1. Identify a known-good Worker version ID from retained deployment evidence or Cloudflare version history.
2. Verify that the target version is compatible with the current Durable Object/resource topology.
3. Open **Rollback production** in GitHub Actions.
4. Select the current governance workflow ref.
5. Paste its exact full SHA into `confirm_sha`.
6. Paste the known-good Worker version ID into `target_version_id`.
7. Enter `ROLLBACK` exactly in `confirmation`.
8. Dispatch the workflow.
9. Retain the `c5-production-rollback-<run>-<attempt>` artifact.
10. Confirm the post-rollback deployment state and smoke evidence before declaring rollback verification complete.

The rollback workflow calls `wrangler rollback <VERSION_ID> --message ...`, so production is restored to the exact already-published Worker version rather than rebuilt from source during the incident path.

## Durable Object / binding constraint

Do not use rollback as a substitute for data or resource migration reversal. A target version must remain compatible with the current Cloudflare resources and Durable Object lifecycle. If bindings were removed or an incompatible Durable Object class lifecycle change occurred after the target version, stop and resolve that infrastructure compatibility explicitly rather than forcing rollback.

C5C itself introduces no Durable Object migration or binding change.

## C4D prerequisite relationship

C5C implementation can be validated while the external C4D D1 authorization blocker remains open. However, a deploy/rollback run with `C4D_RATED_PRODUCTION_GATE=disabled` is only governance evidence; it cannot close the final release gate for the rated public product.

Final C5 closure requires a production deploy and the required rollback evidence after the C4D D1 database, binding, migrations and rated production smoke are operational.

## Closure criteria

C5C implementation is ready when:

- Project CI validates the deploy/rollback governance contract;
- both workflows remain manual-only;
- immutable SHA confirmation is enforced;
- rollback requires an explicit version ID and explicit confirmation;
- before/after Cloudflare state is captured;
- production smoke evidence is retained as an artifact;
- C1-C4 semantics remain unchanged.

C5C execution evidence is closed only after the manual production deploy and rollback runs have been completed and their artifacts retained.
