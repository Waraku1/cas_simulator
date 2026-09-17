# C5F CAS Development / Testing Evidence Package

## Purpose

C5F assembles the final release evidence into one reproducible, SHA-bound package. It does not turn missing evidence into PASS and it does not alter application behavior.

The package combines:

- the frozen architecture record from C0-C4;
- C5 security/accessibility, performance, release-governance, school-local, and human-QA runbooks;
- final external/device evidence references and locally retained evidence files;
- a release manifest tied to one exact Git SHA;
- machine-checked evidence lineage across **all seven** final gates;
- machine-checked Worker version-state continuity across initial deploy, rollback, and restoration;
- a verified final production state restored to the intended release after rollback proof;
- a generated package index;
- SHA-256 checksums for the package contents.

## Required final evidence gates

The C5F manifest requires all seven of the following to be `PASS` before a final package can be generated:

1. `c4dProduction` — production D1 provisioning/binding/migrations and rated-product readiness.
2. `c5bPerformance` — browser/device sustained performance and product multiplayer-load evidence.
3. `c5cDeploy` — both the initial release deploy and the post-rollback restoration deploy for the release SHA.
4. `c5cRollback` — governed explicit-version rollback evidence between those two deploys.
5. `c5dSchool` — supported managed-school-Mac regression evidence.
6. `c5eHumanQa` — completed C5E human QA / visual sign-off record.
7. `finalMainCi` — final `main` Project CI success for the same release lineage.

Every gate must include retained local evidence in `files`; `refs` may additionally record GitHub Actions URLs or other external references. Directories are accepted and copied recursively. A URL or manually written `PASS` string alone does not close a final evidence gate.

The required local lineage records are:

- `c4dProduction`: retained **C4D provision D1** artifact containing `c4d-provision.json`;
- `c5bPerformance`: structured `c5b-performance.json` validated against the frozen FPS/transfer thresholds;
- `c5cDeploy`: **two** retained purpose-labeled deploy artifacts, one with `deployment_purpose=initial_release` and one with `deployment_purpose=restore_after_rollback`, each containing `metadata.txt`, `wrangler-output.ndjson`, `deployments-live.json`, `c5c-deploy-version-state.json`, `c4d-rated-smoke.txt`, `c4d-cleanup-verification.json`, and `c4d-cleanup.txt`;
- `c5cRollback`: retained rollback artifact containing `metadata.txt`, `c5c-rollback-preflight.json`, `deployments-live.json`, `c5c-rollback-version-state.json`, rated-smoke evidence, and verified cleanup evidence;
- `c5dSchool`: managed-school-Mac automated `C5D_SCHOOL_RELEASE_REGRESSION` report plus `c5d-managed-mac-observation.json`;
- `c5eHumanQa`: the completed C5E JSON evidence record and its referenced captures/recording evidence;
- `finalMainCi`: retained final Project CI artifact containing `c5-final-ci.json`.

## Evidence lineage contract

Before the existing package generator copies any evidence, `pnpm verify:c5f` runs two complementary lineage layers:

1. the existing all-seven release lineage validator;
2. the Worker version-state lineage validator.

Final package generation fails unless both layers pass.

The all-seven validator requires:

- the final checked-out `releaseSha` to be the **same release SHA** recorded by both production deploy artifacts;
- exactly one `initial_release` deploy artifact and exactly one `restore_after_rollback` deploy artifact;
- rollback governance to have been executed from that same release SHA;
- the initial deploy to finish before rollback starts;
- rollback to finish before the restoration deploy starts;
- the restoration deploy to pass the same rated-product smoke and zero-count cleanup requirements as the initial deploy;
- the successful `restore_after_rollback` deployment to represent the **final production state** used for release closure;
- the final Project CI artifact to record a `push` run from `refs/heads/main` at that same release SHA;
- the C5B `c5b-performance.json` `releaseSha` to equal the final release SHA and pass the structured C5B validator;
- the C5D automated managed-Mac report Git SHA and `c5d-managed-mac-observation.json` `releaseSha` to equal the final release SHA and pass the C5D validator;
- the C5E human-QA record `releaseSha` to equal the final release SHA, after which the existing C5E validator still performs the complete C5E-01..16/content validation during package generation;
- the rated production gate to have been `enabled` for both deploy artifacts and rollback evidence;
- all three production mutations to retain `C4D_PRODUCTION_RATED_PRODUCT_SMOKE` with `ok=true` and verified zero-count cleanup evidence;
- `c4d-provision.json` to record successful D1 read authorization, provisioning, and schema verification for `cas-simulator-accounts`;
- the real D1 UUID in `c4d-provision.json` to exactly match the final reviewed `ACCOUNTS` binding in `wrangler.jsonc`.

The Worker version-state lineage layer additionally requires:

- each deploy artifact to contain `C5C_DEPLOY_VERSION_STATE=PASS` evidence whose `deployedVersionId` equals the post-deploy sole 100% live version;
- rollback evidence to contain `C5C_ROLLBACK_VERSION_STATE=PASS` with `beforeLiveVersionId != targetVersionId` and `afterLiveVersionId == targetVersionId`;
- the rollback `beforeLiveVersionId` to equal the initial deploy's `deployedVersionId`;
- the restoration deploy's `beforeLiveVersionId` to equal the rollback target;
- the restoration `deployedVersionId` to differ from the rollback target and become the sole 100% live version;
- initial and restoration deploys to identify the same Worker name and stable Worker identity tag;
- initial deploy, rollback, and restoration to identify the same production URL.

This prevents a nominally successful but ineffective **no-op rollback**, cross-environment evidence mixing, and restoration evidence captured from a different Worker.

Rollback evidence alone is intentionally insufficient: a successful rollback changes live production to the rollback target. C5F therefore requires a subsequent same release SHA `restore_after_rollback` deployment before final packaging.

The D1 provisioning workflow normally runs before the final binding PR, so its Git SHA is not required to equal the final release SHA. Instead, lineage is closed by the exact provisioned D1 UUID matching the final `ACCOUNTS` binding.

Hosted Linux C5D CI evidence remains continuous regression evidence only. It cannot satisfy final C5D closure because the C5D evidence validator requires the retained final automated report platform to be `darwin` and pairs it with the managed-Mac observation record.

## C5B final evidence record

Create the structured performance record from:

```bash
cp docs/evidence/templates/c5b-performance.template.json .c5-evidence/c5b-performance.json
```

Populate it from the accepted browser/device runs documented in `C5B_PERFORMANCE_EVIDENCE.md`, then validate it independently with:

```bash
C5B_EVIDENCE_FILE=.c5-evidence/c5b-performance.json pnpm verify:c5b:evidence
```

C5F invokes the same validator again with the final `releaseSha` as an expected SHA. Therefore a numerically valid performance record captured from another commit is rejected.

## C5D final evidence record

Retain the managed school Mac aggregate C5D report and create the observation record from:

```bash
cp docs/evidence/templates/c5d-managed-mac-observation.template.json .c5-evidence/c5d-managed-mac-observation.json
```

Validate them together before packaging:

```bash
C5D_REPORT_FILE=.c5-evidence/school-regression/<report>.json \
C5D_OBSERVATION_FILE=.c5-evidence/c5d-managed-mac-observation.json \
pnpm verify:c5d:evidence
```

C5F invokes the same validator with the final release SHA and rejects a hosted Linux report, failed sub-gate, incomplete human observation, or SHA mismatch.

## C5E final evidence record

C5E continues to use the existing validated human-QA record and capture contract. Before package generation, the C5F lineage validator first requires the C5E record's `releaseSha` to equal the final C5F `releaseSha`. The existing C5F package generator then invokes `verify-c5e-human-qa.mjs`, so all C5E-01..16 cases, environment metadata, required surface captures, multiplayer capture, notes, and visual sign-off remain mandatory.

## C5C production-state evidence

The final release execution order is:

1. deploy the selected final release SHA with `deployment_purpose=initial_release`;
2. execute the explicit known-good rollback from the same governance release SHA;
3. deploy that exact same final release SHA again with `deployment_purpose=restore_after_rollback`.

Retain both purpose-labeled deploy artifacts under the `c5cDeploy.files` entry and the rollback artifact under `c5cRollback.files`.

The initial deploy must prove that Wrangler's generated Worker `version_id` became the sole 100% live version. The rollback preflight then proves the target differs from that current live version. Post-rollback evidence proves the explicit target became the sole 100% live version. Finally, restoration evidence proves it started from that rollback target and replaced it with the restored release version on the same Worker identity and production URL.

C5F therefore rejects missing, duplicated, mislabeled, out-of-order, wrong-SHA, wrong-Worker, cross-URL, no-op rollback, failed-smoke, failed-cleanup, or version-state-mismatched evidence.

The restoration deployment is not optional cleanup paperwork: it is the operation that returns live production to the intended final release after rollback capability has been demonstrated.

## Prepare the manifest

```bash
mkdir -p .c5-evidence
cp docs/evidence/templates/c5f-package.template.json .c5-evidence/c5f-package.json
```

Fill:

- full 40-character `releaseSha`;
- a human-readable `releaseLabel`;
- `preparedBy` and ISO timestamp `preparedAt`;
- every gate status and evidence reference;
- retained artifact directories/files under every gate's `files` array.

File paths are resolved relative to the manifest file. Directories are accepted and copied recursively.

## Contract verification

Locally, run:

```bash
pnpm verify:c5f
```

With no manifest environment variable, this validates the committed C5F contract/template, required repository documentation, all-gate lineage contract, Worker version-state lineage contract, and required workflow/evidence tooling.

Project CI additionally runs:

```bash
C5F_SELF_TEST=1 pnpm verify:c5f
```

Project CI separately self-tests C5B, C5D, and C5C Worker version-state evidence validators. The C5F self-test then exercises three layers:

1. the existing package generator creates temporary PASS-shaped evidence, validates it through the real C5E verifier, copies/indexes/checksums the package, and deletes it;
2. the all-seven lineage validator accepts a complete synthetic evidence chain and rejects a wrong restoration SHA, restoration before rollback completion, non-zero restoration cleanup, D1 provision/binding mismatch, and C5E evidence from another release;
3. the Worker version-state lineage validator accepts a coherent initial/rollback/restoration chain and rejects a no-op rollback, rollback starting from another live version, restoration not starting from the rollback target, Worker identity mismatch, and production URL mismatch.

Synthetic evidence never counts toward release closure.

## Build the final package

Checkout the exact final release SHA first. Download/extract the required retained GitHub Actions artifacts and place the C5B/C5D/C5E device/human records in the `.c5-evidence` working area. Then run:

```bash
C5F_MANIFEST_FILE=.c5-evidence/c5f-package.json pnpm verify:c5f
```

The command first validates release lineage and Worker version-state lineage, then invokes the existing package generator. It refuses to continue when, among other conditions:

- `releaseSha` is not a full SHA;
- the current checkout does not equal `releaseSha`;
- any required gate is not `PASS`;
- required local evidence is absent;
- C5B, C5D, or C5E evidence belongs to another release SHA;
- final C5D evidence is not from the managed macOS/darwin path;
- either required deploy purpose is missing or duplicated;
- production initial-deploy/rollback/restoration ordering is invalid;
- a rollback target was already the sole live version before rollback;
- the initial deployed version is not the version from which rollback began;
- the rollback target did not become 100% live;
- restoration did not begin from the rollback target or did not replace it with the release version;
- Worker identity or production URL differs across the three production mutations;
- production deploy/rollback/final-main-CI lineage does not match the release SHA;
- D1 provisioning evidence does not match the final `ACCOUNTS` binding;
- rated smoke or zero-count cleanup evidence is invalid;
- a declared local evidence file/directory does not exist.

The generated package is written under:

```text
.c5-evidence/cas-package/<releaseSha>/
```

It contains the completed manifest, architecture/operations/project documentation, copied local evidence files, `PACKAGE_INDEX.md`, and `CHECKSUMS.sha256`.

## Package handling

Treat `.c5-evidence/` as release evidence, not source code. It is ignored by Git and may contain screenshots, downloaded workflow artifacts, or device-specific logs. Review captures for passwords, cookies, tokens, student/account identifiers, or other secrets before sharing/submission.

For final submission/archive, keep the package directory unchanged after checksum generation. If any evidence is replaced, regenerate the package and checksums from the same release checkout.

## Closure boundary

C5F implementation is closed when the package generator, all-gate lineage validator, Worker version-state lineage validator, C5B/C5D evidence validators, final-production-state restoration contract, and CI self-tests are merged and CI-protected. The C5F release gate is closed only when a complete lineage-validated package is successfully generated from the final release SHA after C4D and C5B-E execution evidence are all closed and the restoration deployment is live as the final production state.
