# C5F CAS Development / Testing Evidence Package

## Purpose

C5F assembles the final release evidence into one reproducible, SHA-bound package. It does not turn missing evidence into PASS and it does not alter application behavior.

The package combines:

- the frozen architecture record from C0-C4;
- C5 security/accessibility, performance, release-governance, school-local, and human-QA runbooks;
- final external/device evidence references and locally retained evidence files;
- a release manifest tied to one exact Git SHA;
- machine-checked production evidence lineage;
- a generated package index;
- SHA-256 checksums for the package contents.

## Required final evidence gates

The C5F manifest requires all of the following to be `PASS` before a final package can be generated:

1. `c4dProduction` — production D1 provisioning/binding/migrations and rated-product smoke.
2. `c5bPerformance` — browser/device sustained performance and product multiplayer load evidence.
3. `c5cDeploy` — governed production deploy evidence for the release SHA.
4. `c5cRollback` — governed explicit-version rollback evidence.
5. `c5dSchool` — supported managed-school-Mac regression evidence.
6. `c5eHumanQa` — completed C5E human QA / visual sign-off record.
7. `finalMainCi` — final `main` Project CI success for the same release lineage.

Every gate must include retained local evidence in `files`; `refs` may additionally record GitHub Actions URLs or other external references. Directories are accepted and copied recursively.

The following production-lineage files are mandatory:

- `c4dProduction`: retained **C4D provision D1** artifact containing `c4d-provision.json`;
- `c5cDeploy`: retained production deploy artifact containing `metadata.txt`, `c4d-rated-smoke.txt`, `c4d-cleanup-verification.json`, and `c4d-cleanup.txt`;
- `c5cRollback`: retained rollback artifact containing the same rated-smoke/cleanup evidence plus rollback `metadata.txt`;
- `finalMainCi`: retained final Project CI artifact containing `c5-final-ci.json`.

C5B, C5D, and C5E continue to require their existing local browser/device, managed-school-Mac, and human-QA evidence respectively.

## Evidence lineage contract

Before the existing package generator copies any evidence, `pnpm verify:c5f` runs a dedicated lineage validator. Final package generation fails unless all of the following are true:

- the final checked-out `releaseSha` is the same release SHA recorded by the production deploy artifact;
- rollback governance was executed from that same release SHA;
- the final Project CI artifact records a `push` run from `refs/heads/main` at that same release SHA;
- the rated production gate was `enabled` for deploy and rollback evidence;
- both deploy and rollback rated-product smoke records report `C4D_PRODUCTION_RATED_PRODUCT_SMOKE` with `ok=true`;
- both `c4d-cleanup-verification.json` records prove zero remaining run-scoped users, sessions, and rated matches and their cleanup PASS markers are present;
- `c4d-provision.json` records successful D1 read authorization, provisioning, and schema verification for `cas-simulator-accounts`;
- the real D1 UUID recorded by `c4d-provision.json` exactly matches the final reviewed `ACCOUNTS` binding in `wrangler.jsonc`.

The D1 provisioning workflow normally runs before the final binding PR, so its Git SHA is not required to equal the final release SHA. Instead, lineage is closed by the exact provisioned D1 UUID matching the final `ACCOUNTS` binding.

A URL or manually written `PASS` string alone cannot satisfy these four production-lineage gates.

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
- retained artifact directories/files under each gate's `files` array.

File paths are resolved relative to the manifest file. Directories are accepted and copied recursively.

## Contract verification

Locally, run:

```bash
pnpm verify:c5f
```

With no manifest environment variable, this validates the committed C5F contract/template, required repository documentation, and production-lineage workflow contract.

Project CI additionally runs:

```bash
C5F_SELF_TEST=1 pnpm verify:c5f
```

The CI-only synthetic self-test exercises both layers:

1. the existing package generator creates temporary PASS-shaped evidence, validates it through the real C5E verifier, copies/indexes/checksums the package, and deletes it;
2. the lineage validator accepts a complete synthetic production evidence chain and rejects wrong deploy SHA, non-zero cleanup, and D1 provision/binding mismatch.

Synthetic evidence never counts toward release closure.

## Build the final package

Checkout the exact final release SHA first. Download and extract the required retained GitHub Actions artifacts into the `.c5-evidence` working area, then run:

```bash
C5F_MANIFEST_FILE=.c5-evidence/c5f-package.json pnpm verify:c5f
```

The command first validates evidence lineage and then invokes the existing package generator. It refuses to continue when, among other conditions:

- `releaseSha` is not a full SHA;
- the current checkout does not equal `releaseSha`;
- any required gate is not `PASS`;
- required local evidence is absent;
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

C5F implementation is closed when the package generator, lineage validator, and CI self-tests are merged and CI-protected. The C5F release gate is closed only when a complete lineage-validated package is successfully generated from the final release SHA after C4D and C5B-E execution evidence are all closed.
