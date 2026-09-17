# C5D School-Local Release Regression Evidence

## Scope

C5D packages the already-accepted school-local execution path into one release-regression evidence run. It does not change production architecture, C1-C4 product semantics, flight controls, matchmaking, Heart Point rules, account authority, or rating behavior.

The supported school path remains localhost-only and does not bypass school filtering or expose the development machine to the managed LAN.

## Current school runtime topology

`pnpm dev:school` starts the supported localhost stack:

- `127.0.0.1:5173` — Vite/Cesium browser origin;
- `127.0.0.1:8787` — dependency-free local C3/C4 relay and legacy matchmaking/competition parity;
- `127.0.0.1:8788` — school-local account/session API;
- `127.0.0.1:8789` — authenticated ranked-product backend.

The Vite school configuration proxies browser requests to these localhost services while preserving the same browser-facing API shapes used by the product.

## Automated release regression

Start the stack in terminal 1:

```bash
pnpm dev:school
```

After `http://127.0.0.1:5173/api/health` is available, run in terminal 2:

```bash
pnpm verify:c5d:school
```

The aggregate release verifier executes, in order:

1. C3 two-client multiplayer relay smoke;
2. C4B matchmaking / aircraft-assignment smoke;
3. C4C Heart Point competition smoke;
4. C4D account/session/leaderboard smoke;
5. C4D authenticated ranked-product smoke.

A failure in any sub-gate makes C5D fail.

## Evidence output

By default, the verifier writes a JSON record under:

```text
.c5-evidence/school-regression/
```

The directory is ignored by Git so local evidence cannot be committed accidentally.

The report records:

- Git SHA when available;
- Node and pnpm versions;
- platform, architecture and OS version/release;
- UTC start/end timestamps;
- each underlying command, pass/fail state, duration, exit code and command output;
- aggregate C5D pass/fail status.

It deliberately does not record the machine hostname or the user's environment variables.

For CI, `C5D_EVIDENCE_DIR` redirects the report to an ephemeral artifact directory.

## CI evidence

Project CI starts the same school-local stack, executes `pnpm verify:c5d:school`, and uploads the aggregate report together with the school health response, launcher log, and CI lineage metadata. This is continuous regression evidence on the GitHub runner.

CI does not substitute for the managed school Mac evidence because the supported school device has its own OS/network constraints. The final evidence validator explicitly rejects hosted Linux reports as the managed-Mac closure record.

## Managed school Mac closure

Final school-local release evidence requires one successful aggregate run on the supported managed school Mac plus one structured browser-usability observation record.

After the aggregate run, create the human observation record from:

```bash
cp docs/evidence/templates/c5d-managed-mac-observation.template.json .c5-evidence/c5d-managed-mac-observation.json
```

Record the same 40-character release SHA as the automated JSON report, tester/timestamp/browser/device metadata, and confirm all of the following:

- `pnpm dev:school` started without port conflicts;
- the browser opened `http://127.0.0.1:5173` normally;
- the five automated release gates all passed;
- no TLS/filter bypass, VPN, alternate DNS, proxy or LAN exposure was used;
- ordinary flight input remained usable;
- the product UI remained usable in the browser.

Then validate both records together:

```bash
C5D_REPORT_FILE=.c5-evidence/school-regression/<report>.json \
C5D_OBSERVATION_FILE=.c5-evidence/c5d-managed-mac-observation.json \
pnpm verify:c5d:evidence
```

The validator requires:

- the automated report to be `C5D_SCHOOL_RELEASE_REGRESSION` with `ok=true`;
- all five underlying gates to have passed with exit code 0;
- the automated environment platform to be `darwin`;
- the report Git SHA and observation `releaseSha` to match exactly;
- every required managed-Mac/browser observation to be true;
- non-empty tester/browser/device/notes metadata.

When invoked from C5F, the same SHA must also equal the final package release SHA.

## Network/security boundary

Do not bypass certificate warnings or school security controls. Do not expose ports 5173/8787/8788/8789 to the managed LAN unless explicitly authorized. The supported compatibility solution is localhost execution on the development Mac.

## Closure criteria

C5D implementation is ready when the aggregate verifier and structured managed-Mac evidence validator are under CI and the operational documentation matches the current four-service school runtime.

C5D execution evidence is closed only after both the successful managed-school-Mac aggregate report and the validated browser-usability observation record are retained for the final release SHA.
