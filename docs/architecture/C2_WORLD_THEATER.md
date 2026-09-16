# C2 — World / Theater Resource Gate

Status: **IMPLEMENTED / 30-MIN LOCAL QA PENDING**

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
- standardized session: 30 minutes;
- observed-transfer budget: <=150 MiB per player session.

Runtime diagnostics now record:
- current FPS;
- average FPS since the page session began;
- minimum one-second FPS sample;
- elapsed benchmark time;
- browser-observed `PerformanceResourceTiming.transferSize` total;
- resource count;
- zero-transfer resource count;
- cross-origin zero-transfer/opaque entry count;
- optional Chromium JS heap usage when available.

The Resource Timing buffer is increased to 6000 entries before the benchmark begins so a 30-minute run is not silently restricted to the browser's typical initial buffer size.

## Transfer-measurement limitation

`transferSize` is not complete bandwidth accounting. Browsers can report `0` for local-cache hits and for cross-origin resources that do not expose timing data with `Timing-Allow-Origin`. Therefore the UI and copied report call the value **observed transfer**, and separately record opaque cross-origin entries. The 150 MiB value is interpreted only as an engineering budget over observable browser timing evidence.

Reference: MDN `PerformanceResourceTiming.transferSize` and Resource Timing documentation.

## Evidence workflow

1. Start from a fresh localhost page load.
2. Keep the simulator tab active and operate normally within the theater.
3. Continue for at least 30 minutes.
4. Confirm current/average/minimum FPS and observed transfer in the C2 panel.
5. Use `COPY C2 REPORT` and retain the JSON with the CAS/testing evidence.
6. Record any visible terrain loading defects or boundary-rendering problems separately.

## C2 exit criteria

Automated implementation gate:
- [x] deterministic theater model exists independently of Cesium rendering;
- [x] 50 km × 50 km boundary is rendered;
- [x] inside/warning/outside HUD state exists;
- [x] C1 flight model remains authoritative and unchanged by boundary status;
- [x] Resource Timing buffer is enlarged;
- [x] diagnostics distinguish observed transfer from opaque cross-origin entries;
- [x] copyable C2 evidence report exists.

Pending closure evidence:
- [ ] `pnpm validate:scaffold` passes on C2 PR and merged main;
- [ ] `pnpm check` passes on C2 PR and merged main;
- [ ] `pnpm build` passes on C2 PR and merged main;
- [ ] localhost boundary visual QA passes;
- [ ] standardized 30-minute session completes;
- [ ] average FPS >=45 target where feasible and minimum FPS remains >=30;
- [ ] observed transfer is reviewed against the <=150 MiB engineering budget with opacity caveat;
- [ ] optional heap evidence is recorded when supported.

C3 multiplayer does not begin until C2 is closed or an explicit documented exception is accepted.
