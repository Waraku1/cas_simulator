# C2 — World / Theater Resource Gate

Status: **CLOSED / ACCEPTED**

## Objective

Keep Cesium Earth as the world model while introducing a deterministic regional theater contract and a reproducible browser-side performance/resource evidence path before multiplayer is added.

## World contract

- World: WGS84 Cesium Earth.
- Terrain: Cesium World Terrain.
- Imagery: global imagery supplied through the configured Cesium ion assets.
- Theater: configurable rectangle centered on `THEATER.centerLatitudeDeg / centerLongitudeDeg`.
- Current size: 50 km × 50 km.
- Warning band: 5 km inside each edge.

The C2 boundary is a lightweight Cesium polyline clamped to terrain. C2 does not hard-clamp controls or teleport the aircraft. A flight can move outside the theater so warning/outside states can be verified.

## Theater evaluation

`src/client/theater/model.ts` is independent of Cesium rendering. It converts current latitude/longitude to approximate local east/north offsets around the theater center using a spherical-earth local tangent approximation. For a 50 km regional theater this is sufficient for the boundary UI contract.

The signed edge distance is the smaller of the east/west and north/south remaining margins:
- positive and >5 km: `inside`;
- 0 to 5 km: `warning`;
- negative: `outside`.

The same module generates the four boundary corner coordinates used by the renderer.

## Resource/performance contract

Engineering targets, not provider guarantees:
- target average FPS: >=45;
- minimum acceptable valid one-second sample: >=30;
- runtime render/simulation cap: 60 FPS;
- staged preflight: 3 active foreground minutes;
- observed-transfer engineering budget: <=150 MiB per player session, subject to Resource Timing visibility limitations.

The Cesium default render loop and C1 simulation update loop are both governed at 60 FPS. Runtime diagnostics measure actual Cesium post-render cadence during valid active foreground time so background-tab throttling/suspension does not corrupt the average/minimum evidence.

Diagnostics record:
- current, average, and minimum valid FPS;
- active foreground benchmark time;
- browser-observed `PerformanceResourceTiming.transferSize` total;
- resource count;
- zero-transfer resource count;
- opaque cross-origin resource count;
- optional Chromium JS heap usage when available.

## Diagnostic run that triggered remediation

The first long-session attempt was intentionally stopped at 188.2 seconds because device load appeared unnecessarily high.

Pre-remediation report:
- current FPS: 101.3;
- reported average FPS: 11.6;
- reported minimum FPS: 0.1;
- observed transfer: 0.05 MiB;
- resources: 703;
- zero-transfer resources: 527;
- opaque cross-origin resources: 521;
- JS heap: 123.9 MiB.

The simultaneous 101.3 current FPS and 11.6 average FPS exposed both unnecessary high-refresh rendering and an invalid wall-clock averaging method under browser throttling/suspension. This run is retained as diagnostic evidence only.

Manual functional evidence from that run remained valid:
- [x] theater boundary and boundary states operated correctly;
- [x] accepted C1 control feel/camera showed no regression.

## Performance remediation

Merged through PR #17 as `1078907b7d8f728049ac8bbe40101984021bbbec`:
- [x] Cesium render loop capped at 60 FPS;
- [x] flight update loop governed to the same intended cadence;
- [x] FPS measurement uses actual Cesium `postRender` events;
- [x] benchmark time counts valid active foreground sampling only;
- [x] long scheduling suspensions/background-tab throttling are excluded from FPS evidence;
- [x] a 3-minute preflight stage was added before any optional longer soak;
- [x] copied evidence contains frame-cap/preflight metadata.

Automated verification:
- PR #17 CI run `35060087478`: PASS;
- merged-main CI run `35060151629`: PASS;
- `pnpm validate:scaffold`: PASS;
- `pnpm check`: PASS;
- `pnpm build`: PASS.

## Accepted C2 preflight — 2026-09-16

Accepted report:
- active foreground time: 201.8 s;
- preflight complete: true;
- runtime frame cap: 60 FPS;
- current FPS: 59.6;
- average FPS: 59.9;
- minimum valid sample: 52.0 FPS;
- observed transfer: 0.18 MiB;
- resources: 1445;
- zero-transfer resources: 1269;
- opaque cross-origin resources: 1263;
- JS heap: 116.7 MiB.

All FPS criteria passed with substantial margin. Heap usage was lower than in the interrupted diagnostic run.

## Transfer-measurement limitation

`transferSize` is not complete bandwidth accounting. Browsers can report `0` for cache hits and cross-origin resources that do not expose timing data with `Timing-Allow-Origin`. The UI/report therefore label the value **observed transfer** and separately record opaque cross-origin entries.

## 30-minute soak decision

The previously planned 30-minute soak is **explicitly waived** for C2 closure.

After the 60 FPS governor and corrected foreground-only post-render measurement, the 3-minute preflight demonstrated stable capped performance with no functional regressions. Repeating the same workload for 30 minutes was judged to have low additional information value relative to device/time cost.

This is a documented test-scope decision, not an unrecorded omission. If C3/C4 materially increases rendering or network load, a new bounded soak can be introduced at that later gate.

## C2 exit decision

- [x] deterministic theater model;
- [x] visible 50 km × 50 km boundary;
- [x] inside/warning/outside states;
- [x] C1 controls/camera preserved;
- [x] performance measurement corrected;
- [x] 60 FPS runtime governor;
- [x] 3-minute accepted preflight;
- [x] automated build/type/scaffold verification;
- [x] explicit long-soak waiver documented.

**C2 PASS — CLOSED / ACCEPTED. C3 multiplayer may proceed.**
