# C2 — World / Theater Resource Gate

Status: **PERFORMANCE REMEDIATION / 3-MIN PREFLIGHT PENDING**

## Objective

Keep Cesium Earth as the world model while introducing a deterministic regional theater contract and a reproducible browser-side performance/resource evidence path before multiplayer is added.

## World contract

- World: WGS84 Cesium Earth.
- Terrain: Cesium World Terrain.
- Imagery: global imagery supplied through the configured Cesium ion assets.
- Theater: configurable rectangle centered on `THEATER.centerLatitudeDeg / centerLongitudeDeg`.
- Current size: 50 km × 50 km.
- Warning band: 5 km inside each edge.

The C2 boundary is a lightweight Cesium polyline clamped to terrain. C2 does not hard-clamp controls, teleport the aircraft, or impose gameplay consequences. A flight can move outside the theater so the warning/outside states can be verified. Later gates own respawn/gameplay behavior.

## Theater evaluation

`src/client/theater/model.ts` is independent of Cesium rendering. It converts current latitude/longitude to approximate local east/north offsets around the theater center using a spherical-earth local tangent approximation. For a 50 km regional theater this is sufficient for the boundary UI contract.

The signed edge distance is the smaller of the east/west and north/south remaining margins:
- positive and >5 km: `inside`;
- 0 to 5 km: `warning`;
- negative: `outside`.

The same module generates the four boundary corner coordinates used by the renderer.

## Resource/performance gate

Engineering targets, not provider guarantees:
- target FPS: >=45;
- minimum acceptable FPS: >=30;
- runtime render/simulation cap: 60 FPS;
- staged preflight: 3 active foreground minutes;
- standardized soak session: 30 active foreground minutes;
- observed-transfer budget: <=150 MiB per player session.

The Cesium default render loop is capped at 60 FPS and the C1 simulation update loop is capped at the same cadence. This prevents high-refresh-rate displays from driving the simulator at 100+ FPS without user-visible benefit.

Runtime diagnostics record:
- actual Cesium post-render FPS;
- average FPS over valid active-foreground samples;
- minimum valid one-second FPS sample;
- active foreground benchmark time;
- browser-observed `PerformanceResourceTiming.transferSize` total;
- resource count;
- zero-transfer resource count;
- cross-origin zero-transfer/opaque entry count;
- optional Chromium JS heap usage when available.

Background-tab throttling and long scheduling suspensions are excluded from FPS evidence instead of being counted as sustained renderer collapse. Benchmark time advances only during valid active-foreground sampling.

The Resource Timing buffer is increased to 6000 entries before the benchmark begins so a 30-minute run is not silently restricted to the browser's typical initial buffer size.

## Interrupted diagnostic run — 2026-09-16

The first long-session attempt was intentionally stopped at 188.2 wall-clock seconds because the device appeared to be under unnecessary load.

Reported values from the pre-remediation instrumentation:
- current FPS: 101.3;
- reported average FPS: 11.6;
- reported minimum FPS: 0.1;
- observed transfer: 0.05 MiB;
- resources: 703;
- zero-transfer resources: 527;
- opaque cross-origin resources: 521;
- JS heap: 123.9 MiB.

The simultaneous 101.3 current FPS and 11.6 average FPS exposed a measurement-design problem: the old average divided requestAnimationFrame totals by wall-clock session time, so tab throttling/suspension could corrupt average/minimum evidence. The 100+ current FPS also showed that a high-refresh-rate display could drive unnecessary rendering load.

This run is retained as diagnostic evidence, not as the C2 performance acceptance run.

Manual observations from the same run are accepted:
- [x] theater boundary and boundary states operated correctly;
- [x] accepted C1 control feel remained unchanged.

## Transfer-measurement limitation

`transferSize` is not complete bandwidth accounting. Browsers can report `0` for local-cache hits and for cross-origin resources that do not expose timing data with `Timing-Allow-Origin`. Therefore the UI and copied report call the value **observed transfer**, and separately record opaque cross-origin entries. The 150 MiB value is interpreted only as an engineering budget over observable browser timing evidence.

Reference: MDN `PerformanceResourceTiming.transferSize` and Resource Timing documentation.

## Revised evidence workflow

1. Start from a fresh localhost page load with the remediated build.
2. Keep the simulator tab active and operate normally.
3. Run only the first 3 active foreground minutes as a preflight.
4. At `PREFLIGHT READY`, review hardware load, current/average/minimum FPS, JS heap (if available), and observed transfer.
5. Stop at 3 minutes if load remains uncomfortable or evidence is abnormal; do not force the 30-minute soak.
6. Only after preflight passes, continue or rerun for the full 30 active foreground minutes.
7. Use `COPY C2 REPORT` to retain the JSON evidence.

## C2 exit criteria

Automated implementation gate:
- [x] deterministic theater model exists independently of Cesium rendering;
- [x] 50 km × 50 km boundary is rendered;
- [x] inside/warning/outside HUD state exists;
- [x] C1 flight model remains authoritative and unchanged by boundary status;
- [x] Resource Timing buffer is enlarged;
- [x] diagnostics distinguish observed transfer from opaque cross-origin entries;
- [x] copyable C2 evidence report exists;
- [x] 60 FPS runtime governor is implemented;
- [x] FPS evidence uses Cesium post-render frames and active foreground time.

Verified:
- [x] `pnpm validate:scaffold` passed on the initial C2 PR and merged main;
- [x] `pnpm check` passed on the initial C2 PR and merged main;
- [x] `pnpm build` passed on the initial C2 PR and merged main;
- [x] localhost boundary visual QA passed;
- [x] C1 controls/camera remained subjectively unchanged during C2 QA.

Pending closure evidence:
- [ ] performance-remediation PR and merged-main CI pass;
- [ ] 3-minute capped-runtime preflight passes without unacceptable hardware load;
- [ ] average FPS >=45 and minimum valid sample >=30 during preflight;
- [ ] standardized 30-minute active-foreground soak completes after preflight acceptance;
- [ ] observed transfer is reviewed against the <=150 MiB engineering budget with opacity caveat;
- [ ] optional heap evidence is recorded when supported.

C3 multiplayer does not begin until C2 is closed or an explicit documented exception is accepted.
