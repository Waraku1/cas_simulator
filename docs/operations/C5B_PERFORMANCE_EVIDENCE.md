# C5B Performance Evidence Gate

## Scope

C5B closes the performance/evidence portion of C5 without changing simulator dynamics, ranked-match rules, account behavior, aircraft balance, or C4 product flow. No C1-C4 product semantics are changed.

The existing C2 resource budget remains authoritative:

- target rendered cadence: **45 FPS average or better**;
- minimum rendered cadence: **30 FPS floor**;
- runtime frame cap: **60 FPS**;
- preflight observation: **3 active foreground minutes**;
- sustained benchmark: **30 active foreground minutes**;
- observed transfer target: **150 MiB per player session**.

FPS is measured from Cesium `postRender` frames, not from JavaScript loop cadence. Background-tab throttling and long suspension are excluded from active benchmark time. Transfer evidence is based on `PerformanceResourceTiming.transferSize`; cache hits and opaque cross-origin resources can report zero, so this is an observed-transfer gate rather than complete provider bandwidth accounting.

## Instrumentation contract

`useRuntimeDiagnostics` is the canonical collector. Development flight keeps the visible C2 diagnostics panel. Product flight mounts a headless `PerformanceEvidenceProbe`, so the same measurement logic remains active while the C4 ranked HUD is displayed without exposing development UI.

The latest product-flight sample is available in the browser as:

```js
window.__CAS_PERFORMANCE_EVIDENCE__
```

For evidence capture, copy a stable JSON snapshot from DevTools:

```js
copy(JSON.stringify(window.__CAS_PERFORMANCE_EVIDENCE__, null, 2))
```

The object records current/average/minimum FPS, active measured seconds, observed transfer, resource counts, optional Chromium heap data, frozen thresholds, and threshold pass/fail booleans.

## Required evidence runs

### 1. Three-minute preflight

Run the accepted flight runtime on the target browser/device for at least three active foreground minutes before treating the device as suitable for the longer run. Confirm that terrain has settled, controls remain responsive, and the measured cadence is stable.

This is an early diagnostic only; it does not replace the 30-minute sustained benchmark.

### 2. 30-minute sustained benchmark

Run the accepted flight runtime continuously for 30 active foreground minutes with ordinary maneuvering and theater rendering. Record the final diagnostics report. The release target is:

- average FPS >= 45;
- minimum sampled FPS >= 30;
- observed transfer <= 150 MiB;
- no obvious control, camera, terrain, or multiplayer regression.

If the floor is missed because of a reproducible product workload rather than startup/transient conditions, C5B is not closed until the regression is explained or remediated.

### 3. C4 two-browser ranked product run

Perform a two-browser ranked product run using the current C4 account/matchmaking path. Keep both clients visible where possible (for example side-by-side windows or two devices), allow aircraft assignment/countdown to complete, and keep the match active through the normal product HUD.

For final C5B evidence, use the deterministic full-duration path: do not trigger abstract actions. Equal HP reaches the 4-minute regulation tie, then the complete 60-second overtime, then DRAW. Record at least **300 seconds** of ranked-product duration. This exercises the maximum normal product-match duration without changing the frozen competition contract.

Capture `window.__CAS_PERFORMANCE_EVIDENCE__` for both clients immediately after the run. `benchmarkComplete` may remain false for these ranked-client snapshots because the 30-minute benchmark is a separate run. Evaluate the same 45 FPS target, 30 FPS floor, and 150 MiB observed-transfer target.

Required observations:

- peer aircraft remains rendered and interpolated;
- ranked HUD remains responsive and scannable;
- HP/time/connection state remain server-authoritative;
- no visible stutter caused by product overlays or network updates;
- no C1-C4 behavior change is introduced by the evidence probe.

## Structured final evidence record

The final C5B gate is represented by one SHA-bound JSON record. Start from:

```bash
cp docs/evidence/templates/c5b-performance.template.json .c5-evidence/c5b-performance.json
```

Fill:

- the exact 40-character final `releaseSha`;
- tester, timestamp, browser/OS/device metadata;
- the copied preflight snapshot after at least 180 active seconds;
- the copied sustained snapshot after at least 1800 active seconds with `benchmarkComplete=true`;
- the two ranked-product client snapshots and ranked duration >= 300 seconds;
- the required ranked-product observations and concise notes.

Then validate:

```bash
C5B_EVIDENCE_FILE=.c5-evidence/c5b-performance.json pnpm verify:c5b:evidence
```

The validator recomputes acceptance from the numeric snapshot fields. A manually-set `targetFpsMet`, `minimumFpsMet`, or `transferBudgetMet` boolean cannot override an average below 45 FPS, a minimum below 30 FPS, or transfer above 150 MiB.

When invoked from C5F, the validator additionally requires the record's `releaseSha` to equal the final package release SHA.

## Evidence record contents

The retained record includes:

- commit SHA;
- browser versions for both ranked clients;
- operating system/device and environment kind;
- timestamps;
- copied canonical diagnostics JSON;
- explicit 45 FPS average / 30 FPS floor / 150 MiB transfer results;
- ranked-product visual/server-authority observations;
- concise notes for any anomaly.

Automated CI validates the instrumentation, frozen thresholds, structured evidence contract, and synthetic accept/reject cases. CI cannot substitute for browser/GPU performance evidence; final C5 closure still requires the human/device runs above.
