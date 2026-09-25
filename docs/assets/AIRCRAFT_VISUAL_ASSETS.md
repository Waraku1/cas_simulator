# Aircraft visual assets

## Bell X-1

CAS gameplay identities: `orbit-a1`, `strata-b2`, `kite-c3`, and free flight

Visual identity: **Bell X-1**

Source:
- Smithsonian Institution, National Air and Space Museum
- Smithsonian 3D package: `6c69a6bb-55e6-4356-8725-120ff7f8d652`
- Source page: https://3d.si.edu/object/3d/6c69a6bb-55e6-4356-8725-120ff7f8d652
- Rights: **CC0**

The repository does not copy an untracked third-party model manually. `scripts/sync-aircraft-assets.mjs` resolves an official GLB through the Smithsonian 3D API, prefers a web-suitable glTF-orientation-compliant / Draco-compressed candidate, validates the GLB container, and writes:

- `public/aircraft/bell-x1.glb`
- `public/aircraft/bell-x1.source.json`

Generated aircraft files under `public/aircraft/` are build artifacts and must not be hand-edited.

The sync selects an orientation-compliant official GLB under a **24 MiB** byte budget (1 MiB below Cloudflare Workers' per-asset upload limit), then checks the final normalized GLB size before writing it. If Smithsonian has no suitable candidate, the build fails before a production deploy rather than producing an oversized asset. The selected quality and byte length are recorded in `bell-x1.source.json`.

### Physical-scale normalization

The Smithsonian digitization GLB does not guarantee that one model coordinate unit equals one meter. CAS therefore derives the default-scene bounding box from POSITION accessor bounds and scene-node transforms during asset synchronization.

For Bell X-1, the Smithsonian object metadata gives:
- height: 3.264 m;
- length: 9.373 m;
- width/span: 8.534 m.

The synchronized GLB is recentered at its geometric bounding-box center and uniformly rescaled so its longest scene dimension is exactly **9.373 m** before it is served to Cesium. Runtime `model.scale` remains a gameplay/display multiplier rather than a source-unit conversion.

The synchronization log and `bell-x1.source.json` retain the source bounds, normalization factor, and normalized bounds for auditability.

### Product semantics

The Bell X-1 geometry is used as the **shared visual identity** for every current aircraft. Each aircraft retains its own fictional ranked handling profile. The 2.2× scene presentation scale and 72-pixel minimum make the 9.373 m model readable from the existing chase camera, without changing gameplay movement. The peer marker is displayed above the same live pose as the 3D aircraft so it does not hide the model. SPEED / PITCH / ROLL / ACTION values shown by CAS are game-balance values and must not be represented as historical Bell X-1 performance data.

Basic source credit should remain visible in project documentation even though CC0 does not require attribution.

### Runtime

The browser loads the synchronized model from the same application origin:

`/aircraft/bell-x1.glb`

This avoids a runtime dependency on Smithsonian network access and keeps the Render school path compatible with managed school networks.
