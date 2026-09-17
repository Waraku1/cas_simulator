# C5F CAS Development / Testing Evidence Package

## Purpose

C5F assembles the final release evidence into one reproducible, SHA-bound package. It does not turn missing evidence into PASS and it does not alter application behavior.

The package combines:

- the frozen architecture record from C0-C4;
- C5 security/accessibility, performance, release-governance, school-local, and human-QA runbooks;
- final external/device evidence references and locally retained evidence files;
- a release manifest tied to one exact Git SHA;
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

Each gate must include at least one `files` or `refs` entry. A URL/Actions run reference may be placed in `refs`. Downloaded JSON, logs, screenshots, recordings, or artifact ZIPs should be placed in `files` when practical so the final package is self-contained.

## Prepare the manifest

```bash
mkdir -p .c5-evidence
cp docs/evidence/templates/c5f-package.template.json .c5-evidence/c5f-package.json
```

Fill:

- full 40-character `releaseSha`;
- a human-readable `releaseLabel`;
- `preparedBy` and ISO timestamp `preparedAt`;
- every gate status and evidence reference.

File paths are resolved relative to the manifest file. Directories are accepted and copied recursively.

## Contract verification

Locally, run:

```bash
pnpm verify:c5f
```

With no manifest environment variable, this validates the committed C5F contract/template and required repository documentation.

Project CI additionally runs:

```bash
C5F_SELF_TEST=1 pnpm verify:c5f
```

The CI-only synthetic self-test creates temporary PASS-shaped evidence, validates it through the real C5E verifier, exercises the actual package copy/index/checksum generator, verifies representative generated paths, and then deletes the temporary files. Synthetic evidence is never written into the final `.c5-evidence/cas-package/<releaseSha>` path and never counts toward release closure.

## Build the final package

Checkout the exact release SHA first. Then run:

```bash
C5F_MANIFEST_FILE=.c5-evidence/c5f-package.json pnpm verify:c5f
```

The generator refuses to continue when:

- `releaseSha` is not a full SHA;
- the current checkout does not equal `releaseSha`;
- any required gate is not `PASS`;
- a gate has no evidence reference;
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

C5F implementation is closed when the contract/generator and CI self-test are merged and CI-protected. The C5F release gate is closed only when a complete package is successfully generated from the final release SHA after C4D and C5B-E execution evidence are all closed.
