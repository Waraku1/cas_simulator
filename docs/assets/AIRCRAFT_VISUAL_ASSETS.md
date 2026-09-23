# Aircraft visual assets

## Bell X-1

CAS gameplay identity: `orbit-a1`

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

### Product semantics

The Bell X-1 geometry is used as a **visual aircraft identity**. CAS ranked handling remains the normalized `orbit-a1` gameplay profile. SPEED / PITCH / ROLL / ACTION values shown by CAS are game-balance values and must not be represented as historical Bell X-1 performance data.

Basic source credit should remain visible in project documentation even though CC0 does not require attribution.

### Runtime

The browser loads the synchronized model from the same application origin:

`/aircraft/bell-x1.glb`

This avoids a runtime dependency on Smithsonian network access and keeps the Render school path compatible with managed school networks.
