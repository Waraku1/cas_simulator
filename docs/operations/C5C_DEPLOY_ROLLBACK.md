# C5C Production Deploy / Rollback Evidence Gate

## Scope

C5C establishes a reproducible production deployment, rollback, and final-release restoration evidence path without changing C1-C4 product semantics, flight behavior, account rules, matchmaking, Heart Point competition, aircraft balance, or rating logic.

The implementation consists of two manual GitHub Actions workflows:

- `.github/workflows/deploy.yml` — deploy an exact selected Git commit to production with an explicit purpose: `initial_release`, `restore_after_rollback`, or `post_release_update`;
- `.github/workflows/rollback.yml` — restore one explicit existing Cloudflare Worker version.

Neither workflow runs on push or pull request events. Production mutation therefore requires an explicit manual dispatch.

## Safety and authority boundary

A production deploy requires the operator to dispatch from `refs/heads/main`, paste the exact full 40-character Git SHA selected in the workflow UI, and select one explicit deployment purpose. The workflow rejects the operation before Cloudflare mutation unless `GITHUB_REF=refs/heads/main`, `confirm_sha` is a full SHA, `confirm_sha` exactly equals `GITHUB_SHA`, and `deployment_purpose` is one of:

- `initial_release` — the first deployment of the final release SHA before rollback verification;
- `restore_after_rollback` — the final same-SHA deployment that restores the intended release after rollback verification;
- `post_release_update` — a governed production deployment of a later `main` SHA after the release baseline has already been frozen. It uses the same exact-SHA, environment, concurrency, binding, version-state, target-binding, smoke, cleanup, and artifact controls, but it is **not** part of the frozen C5F initial/rollback/restoration lineage.

A production rollback requires all of the following:

1. the workflow is dispatched from `refs/heads/main`;
2. the exact full 40-character Git SHA of that main governance ref in `confirm_sha`, matching `GITHUB_SHA`;
3. an explicit Cloudflare `target_version_id`;
4. the literal confirmation value `ROLLBACK`.

Rollback never selects an implicit previous version. The repository performs its own explicit confirmation before Wrangler is invoked non-interactively with `--yes`. D1 provisioning, deploy, and rollback all share the `production-mutation` concurrency group with `cancel-in-progress: false`. Therefore no remote D1 provisioning/migration can overlap a Worker deploy, rollback, rated smoke, or production cleanup sequence, and no production mutation run is cancelled by a later dispatch.

All three production mutation jobs also reference the GitHub Actions environment `production`. This creates the repository-side attachment point for environment required reviewers, deployment branch policies, prevent-self-review, and environment-scoped secrets. The workflow declaration alone does not prove those external Settings controls are enabled; their active configuration remains a release Gate 0/operator evidence requirement.

### Rated D1 binding preflight

`pnpm validate:scaffold` routes through `scripts/verify-release-scaffold.mjs`. When `C4D_RATED_PRODUCTION_GATE=enabled`, the release scaffold invokes the production-binding validator with `C4D_BINDING_REQUIRED=1` before the Worker deployment command can run.

The validator requires exactly one D1 entry with:

- `binding: "ACCOUNTS"`;
- `database_name: "cas-simulator-accounts"`;
- a real, non-placeholder D1 UUID in `database_id`.

A missing binding is allowed only while the rated production gate is disabled. Once the rated gate is enabled, missing, duplicate, wrongly named, malformed, or placeholder bindings fail closed before Worker mutation.

## Worker version-state evidence

C5C does not treat a successful CLI exit as sufficient evidence that the intended Worker version became live.

For each production deploy, the workflow sets `WRANGLER_OUTPUT_FILE_PATH` and retains Wrangler's structured NDJSON output. The `deploy` record supplies the Worker name, stable Worker identity tag, generated `version_id`, target URLs, and timestamp. The workflow then immediately queries `wrangler deployments status --json` and runs `pnpm verify:c5c:version-state`.

A deploy passes version-state verification only when:

- the structured output contains exactly one `deploy` record;
- the Worker name is `cas-flight-simulator`;
- Worker tag and deployed version ID are present;
- Cloudflare reports exactly one live Worker version at 100% traffic;
- that live version ID exactly equals the version ID produced by the deploy command.

The resulting evidence is retained as `c5c-deploy-version-state.json` with gate `C5C_DEPLOY_VERSION_STATE`.

Rollback receives a stricter preflight. Before any rollback mutation, the current deployment must contain exactly one Worker version at 100% traffic and the requested `target_version_id` must be different from that live version. A **no-op rollback** to the version already live is rejected before mutation and cannot count as rollback proof. The successful preflight is retained as `c5c-rollback-preflight.json`.

After rollback, Cloudflare deployment state is queried again. `c5c-rollback-version-state.json` is emitted only when the requested target is now the sole 100% live version. Its gate is `C5C_ROLLBACK_VERSION_STATE`.

### Production URL / Wrangler deploy target binding

The recorded production URL is not accepted merely because HTTP smoke succeeds against it. After version-state verification, the deploy workflow runs `pnpm verify:c5c:target` against `c5c-deploy-version-state.json`.

The validator requires the recorded production URL to be represented by at least one HTTP URL in Wrangler's structured deploy `targets` array. Scheme and host must match. When a target has a non-root route path, the production URL path must equal that route base or be below it. A target ending in `*` is treated as a route prefix.

This closes the environment-identity gap where Worker version evidence could otherwise belong to one deployed Worker while root/health/multiplayer smoke was accidentally pointed at another endpoint. The same target binding is revalidated from retained deploy artifacts during C5F final package verification.

## Evidence model

Before and after each production action, the workflow records Cloudflare deployment/version state, Git identity, Actions run identity, production URL, rated-gate state, UTC start/finish timestamps, production root/health, multiplayer smoke, rated-product smoke, and verified D1 cleanup evidence.

Deploy metadata additionally records `deployment_purpose`. The deployment artifact name also contains that purpose so the initial and restoration runs cannot be confused operationally.

Version-state evidence adds:

- `wrangler-output.ndjson` for deploy identity/version provenance;
- `deployments-live.json` immediately after the mutation;
- `c5c-deploy-version-state.json` for each deploy, including the Wrangler deploy target list used for production URL binding;
- `c5c-rollback-preflight.json` before rollback;
- `c5c-rollback-version-state.json` after rollback.

The cleanup step resolves only the run-scoped smoke accounts, deletes their related rated-match/session rows and users, then queries D1 again. `C4D_PRODUCTION_SMOKE_CLEANUP=PASS` or `C4D_ROLLBACK_SMOKE_CLEANUP=PASS` is emitted only when remaining `users`, `sessions`, and `rated_matches` counts are all exactly zero.

Artifacts are retained for 30 days even when a later verification step fails.

## Required final execution sequence

Final C5C evidence is intentionally a three-mutation sequence on the same release SHA:

1. **Initial release deploy** — dispatch **Deploy production** on the final release SHA with `deployment_purpose=initial_release`. Require the rated gate enabled, Worker version-state PASS, production URL / Wrangler deploy target binding PASS, full smoke PASS, and zero-count cleanup evidence. Retain the purpose-labeled deployment artifact.
2. **Rollback proof** — select a known-good compatible Worker version and dispatch **Rollback production** from the same release governance SHA. The target must differ from the current 100% live initial-release version. Require rollback preflight PASS, post-rollback Worker version-state PASS, root/health/multiplayer/rated smoke PASS, and zero-count cleanup. Retain the rollback artifact.
3. **Final restoration deploy** — dispatch **Deploy production** again on the exact same release SHA with `deployment_purpose=restore_after_rollback`. Require the same full version-state, production URL target binding, and production validation, then retain the restoration artifact.

The restoration deploy is mandatory. Successful rollback evidence by itself leaves production on the rollback target and therefore cannot represent the final production state.

## Initial deploy procedure

1. Confirm the intended final release commit has passed Project CI.
2. Open **Deploy production** and select `main` / `refs/heads/main` at the exact final release SHA.
3. Paste that full 40-character SHA into `confirm_sha`.
4. Select `initial_release` as `deployment_purpose`.
5. Dispatch the workflow.
6. Require `C4D_PRODUCTION_BINDING=PASS` when the rated gate is enabled.
7. Require `c5c-deploy-version-state.json` to report PASS and its `deployedVersionId` to equal `afterLiveVersionId`.
8. Require the recorded production URL to match one of the Wrangler deploy targets through `pnpm verify:c5c:target`.
9. Require root, health, multiplayer, and rated-product smoke PASS.
10. Require `c4d-cleanup-verification.json` zero counts and `C4D_PRODUCTION_SMOKE_CLEANUP=PASS`.
11. Retain `c5-production-deploy-initial_release-<run>-<attempt>`.

## Rollback procedure

1. Identify a known-good Worker version ID from retained deployment evidence or Cloudflare version history.
2. Verify compatibility with the current Durable Object/resource topology.
3. Open **Rollback production** on `main` at the same release governance SHA used for deployment.
4. Provide that exact full SHA, explicit `target_version_id`, and literal `ROLLBACK` confirmation.
5. Require `c5c-rollback-preflight.json` PASS. If the target equals the current sole 100% live version, stop: this is a no-op rollback and is not valid evidence.
6. Execute the rollback and retain `c5-production-rollback-<run>-<attempt>`.
7. Require `c5c-rollback-version-state.json` PASS with `beforeLiveVersionId != targetVersionId` and `afterLiveVersionId == targetVersionId`.
8. Require post-rollback root, health, multiplayer, rated-product smoke, zero-count cleanup, and `C4D_ROLLBACK_SMOKE_CLEANUP=PASS`.

## Final restoration procedure

1. Re-open **Deploy production** on `main` at the exact same final release SHA used for the initial deploy.
2. Paste that same SHA into `confirm_sha`.
3. Select `restore_after_rollback` as `deployment_purpose`.
4. Dispatch the workflow.
5. Require the same binding preflight and build checks as the initial deploy.
6. Require restoration `c5c-deploy-version-state.json` PASS.
7. Require the recorded production URL to match one of the restoration Wrangler deploy targets.
8. Require the same root/health/multiplayer/rated-product smoke and zero-count cleanup as the initial deploy.
9. Retain `c5-production-deploy-restore_after_rollback-<run>-<attempt>`.
10. Treat this successful restoration deployment as the final production state for C5 closure.

C5F machine-checks chronology, Worker version continuity, and endpoint identity. The final lineage must prove:

- the initial deploy finished before rollback began;
- rollback finished before restoration began;
- the rollback `beforeLiveVersionId` equals the initial deploy's `deployedVersionId`;
- the rollback target differs from that initial live version and becomes 100% live;
- the restoration deploy begins while the rollback target is still the sole 100% live version;
- the restoration deploy's resulting version becomes the new sole 100% live version;
- initial and restoration deploys have the same Worker name and Worker identity tag;
- initial deploy, rollback, and restoration use the same production URL;
- each deploy's production URL is represented by that deploy's retained Wrangler HTTP target list.

Both deployment artifacts and the rollback artifact must identify the same release SHA/governance SHA and must record `refs/heads/main` as the production mutation ref. C5F rejects retained deploy or rollback evidence from any other ref.

`wrangler deploy` includes deployment purpose, Git SHA, and Actions run identity in its Cloudflare version message, while structured output preserves the generated version ID, Worker identity, and HTTP deploy targets for machine verification.

## Durable Object / binding constraint

Do not use rollback as a substitute for data or resource migration reversal. A rollback target must remain compatible with current Cloudflare resources and Durable Object lifecycle. If an incompatible binding or Durable Object class lifecycle change exists, stop and resolve the infrastructure compatibility explicitly rather than forcing rollback.

C5C itself introduces no Durable Object migration or application binding change.

## C4D prerequisite relationship

C5C implementation can be validated while external C4D D1 authorization remains open. A deploy/rollback run with `C4D_RATED_PRODUCTION_GATE=disabled` is only governance evidence and cannot close the final rated-product release gate.

Final C5 closure requires all three production mutations above only after the C4D D1 database, binding, migrations, and rated production path are operational.

## Closure criteria

C5C implementation is ready when Project CI validates the manual-only workflows, immutable SHA confirmation, explicit deployment purpose, explicit rollback target/confirmation, fail-closed real D1 binding, Wrangler structured deployment identity, production URL / Wrangler deploy target binding, no-op rollback rejection, before/after 100% live Worker version checks, production smoke, and zero-count cleanup without changing C1-C4 semantics.

C5C execution evidence is closed only after the `initial_release` deploy, rollback proof, and same release SHA `restore_after_rollback` deployment have all completed successfully, their artifacts are retained, and C5F verifies chronology plus Worker version-state and endpoint lineage. The restoration deploy, not the rollback target, is the required final production state.


## Post-release update procedure

Use this path only after the original C5 release-preparation baseline has already been frozen.

1. Merge the reviewed post-release source change through the normal protected `main` PR path.
2. Require Project CI PASS on the exact resulting `main` SHA.
3. Open **Deploy production** from `main` at that exact SHA.
4. Paste the same full 40-character SHA into `confirm_sha`.
5. Select `post_release_update` as `deployment_purpose`.
6. Dispatch the workflow and require the same D1 binding preflight, build, version-state, production URL target binding, root/health/multiplayer/rated-product smoke, and zero-count cleanup used by the release deployment path.
7. Retain the resulting `c5-production-deploy-post_release_update-<run>-<attempt>` artifact as post-release deployment evidence.
8. Do not use a `post_release_update` artifact to satisfy or rewrite frozen C5F `initial_release` / `restore_after_rollback` evidence.

A post-release update does not require repeating the original release rollback proof unless a separate change-management decision explicitly requires a new rollback exercise.
