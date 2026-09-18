# C5E Human QA and Visual Sign-off

## Scope

C5E closes the browser/device human-QA and final visual/UX sign-off contract without changing C1-C4 product semantics. It is an evidence gate, not a redesign task.

Automated CI cannot prove visual clarity, peer rendering quality, browser interaction quality, or device-specific usability. C5E therefore defines a repeatable human-observation record and a validator that refuses to treat missing, blocked, or failed checks as release PASS.

## Environments

Run the matrix on each release environment that is claimed as supported:

1. **Production / allowed network** — current release SHA deployed through the governed C5C workflow.
2. **School-local** — `pnpm dev:school` on the supported managed school Mac.

Record exact browser/version, operating system/device, environment URL, Git SHA, date/time, and tester identifier in the evidence JSON. Do not bypass school filtering or TLS controls to obtain production evidence.

## Evidence file

Copy the committed template:

```bash
mkdir -p .c5-evidence
cp docs/evidence/templates/c5e-human-qa.template.json .c5-evidence/c5e-human-qa.json
```

Fill every case with one of:

- `PASS` — directly observed and acceptable;
- `FAIL` — directly observed release defect;
- `BLOCKED` — could not be executed; this does not count as PASS.

Each case must include concise notes. Add screenshot/video/log references where they materially support the observation. Screenshots must not contain passwords, session cookies, tokens, or other secrets.

Validate the completed record with:

```bash
C5E_EVIDENCE_FILE=.c5-evidence/c5e-human-qa.json pnpm verify:c5e
```

Without `C5E_EVIDENCE_FILE`, `pnpm verify:c5e` validates only the committed C5E contract/template for CI.

## Required human checks

### Product surfaces

- **C5E-01 Auth** — login/register controls are legible, focus is visible, errors are understandable, no secret value is exposed, and the account-data/privacy notice is reachable and readable before registration.
- **C5E-02 Home** — identity/rating/fixed-aircraft state is readable, START is visually obvious, and the authenticated Account & Privacy panel is keyboard-accessible with clear deletion consequences and password + exact-`DELETE` confirmation.
- **C5E-03 Matchmaking** — searching/cancel state is unambiguous and transition timing does not produce overlapping UI.
- **C5E-04 Aircraft assignment** — assigned aircraft and fixed/random provenance are understandable without implying pay-to-win or superiority.
- **C5E-05 Countdown** — countdown is readable and transition into ACTIVE is visually stable.
- **C5E-06 Active HUD** — HP, time/overtime, action readiness, connection state, and peer identification are immediately scannable while flying.
- **C5E-07 Result** — WIN/LOSS/DRAW/NO_CONTEST, rating effect, and return-to-home action are clear and internally consistent.
- **C5E-08 Leaderboard** — ranking rows remain readable, current-user context is clear, and layout does not clip.

### Interaction and multiplayer

- **C5E-09 Flight/camera** — accepted release controls remain usable: bank-mediated heading turn, pitch/bank acceleration/deceleration, and ±3° near-level capture show no obvious regression.
- **C5E-10 Peer rendering** — two browsers in one ranked/product match visibly render the peer aircraft and interpolation remains usable during ordinary maneuvering.
- **C5E-11 Connection lifecycle** — disconnect/reconnect within the accepted grace behavior is understandable in the UI; no stale peer/connection state remains after recovery.
- **C5E-12 Product diagnostics boundary** — development diagnostics are not exposed on the normal product surface; the C5B evidence probe remains observational only.

### Accessibility / layout observations

- **C5E-13 Keyboard path** — major non-flight product actions can be reached and activated with visible keyboard focus.
- **C5E-14 200% zoom** — critical auth/home/matchmaking/result/leaderboard content remains usable without loss of essential controls or unreadable overlap.
- **C5E-15 Compact desktop viewport** — at 1280×720, critical product controls and match HUD remain usable without release-blocking clipping/overlap.

### Final sign-off

- **C5E-16 Visual/UX sign-off** — after reviewing all preceding checks, no known visual, interaction, or information-hierarchy defect remains that blocks release. This is a separate explicit PASS; it is not inferred automatically from the other rows.

## Screenshot set

Retain at least one representative capture for each of the eight product surfaces: Auth, Home, Matchmaking, Aircraft Assignment, Countdown, Active HUD, Result, and Leaderboard. For multiplayer QA, retain a paired capture or short recording showing both clients/peer rendering when permitted.

Do not commit raw evidence automatically. Keep it in `.c5-evidence/` during testing, then include approved artifacts in the final CAS evidence package under the release-evidence process.

## Failure handling

Any `FAIL` or `BLOCKED` keeps C5E open. Fixes that change behavior or product semantics return through normal branch/PR/CI review; do not silently accept a defect by editing the evidence record. Re-run affected checks after remediation and retain the final record together with the release SHA.

## Closure boundary

C5E is closed only when:

- every required case C5E-01 through C5E-16 is `PASS`;
- the record identifies a concrete release SHA and environment/device metadata;
- representative visual evidence is retained;
- the validator exits 0;
- C5B/C5C/C5D evidence required for the same release has not been invalidated by subsequent code changes.
