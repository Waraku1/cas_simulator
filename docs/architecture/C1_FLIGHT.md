# C1 — Flight Vertical Slice

Status: **CLOSED / ACCEPTED**

## Objective

Create the first interactive flight experience on top of the C0 Cesium foundation without introducing multiplayer or the competitive game loop.

The aircraft is fictional and generic. C1 is a kinematic game-flight model rather than a reproduction of any real aircraft's performance or procedures.

## Canonical state and axes

Canonical flight state contains latitude/longitude, altitude, normalized orientation quaternion relative to local ENU, pitch and roll angular velocity, speed, throttle, and vertical speed.

`heading`, `pitch`, and `bank` are display telemetry derived from the quaternion rather than independently integrated authority variables.

Body axes are `+X forward`, `+Y left`, `+Z up`. Local geographic axes are `+X east`, `+Y north`, `+Z up`.

## Accepted controls

- `W / S`: body-axis pitch command.
- `A / D`: body-axis roll command.
- `ArrowUp / ArrowDown`: throttle.

Pitch and roll angle authority are unrestricted. The orientation quaternion is normalized after updates, permitting full loops and continuous rolls. Pitch acts about the aircraft's own lateral axis, so its earth-relative effect naturally depends on bank attitude.

During C1 development, `Q / E` existed as temporary direct-yaw instrumentation for isolating heading and camera behavior. C5 release integration removes that path completely; release heading change is bank-mediated.

## Accepted control response

C1.5 introduced persistent angular-rate state instead of instantaneous fixed-rate control.

Pitch:
- maximum rate: 34 deg/s;
- acceleration while held: 70 deg/s²;
- release deceleration: 180 deg/s².

Roll:
- maximum rate: 72 deg/s;
- acceleration while held: 160 deg/s²;
- release deceleration: 360 deg/s².

C1.6 established near-level capture. The C5 release refinement narrows the capture window to ±3°: pitch and bank independently return toward exactly 0° only when the displayed residual angle is within ±3°, the relevant input is released, and the relevant angular rate is at or below 1.5 deg/s. Capture rate remains 18 deg/s. Outside ±3° there is no auto-level authority.

## C5 release turn integration

Release turning is generated from bank rather than a direct yaw input.

- Positive/right bank generates a positive/right heading change; negative/left bank generates the opposite change.
- Turn authority is bounded to a maximum 3.5 deg/s.
- The response uses `sin(bank)` so it remains continuous and bounded through unrestricted rolls, is zero when wings-level, and returns to zero when fully inverted rather than diverging near 90° bank.
- Turn authority is multiplied by the horizontal component implied by pitch, fading toward zero near vertical flight where geographic heading becomes poorly defined.
- The heading turn is applied as a local/world-up quaternion rotation to the complete attitude, rather than as a pilot-commanded body-axis yaw.

This is intentionally a gentle game-flight coupling, not a claim of real-aircraft coordinated-turn performance.

## Rendering alignment

The flight model exports its canonical local body frame. Cesium converts that frame from local ENU to ECEF and uses it consistently for aircraft orientation, asymmetric nose marker, chase-camera position, and camera look direction. Aircraft nose, camera, and actual travel therefore share one reference-frame contract.

Post-release correction: Cesium already converts a standard glTF model's axes when rendering an Entity model. The model and fallback geometry therefore receive the same body-frame orientation; applying another glTF-to-body rotation makes the model appear sideways. The chase camera retains the accepted C1.6 body-up follow and 16 m lift. Frame time is integrated in bounded 60 Hz steps, so a slow render frame no longer drops elapsed input time while the accepted angular response parameters remain fixed.

Bell X-1 presentation: the official, physically normalized GLB is shared by all three current gameplay profiles and by free flight. Its display multiplier matches the previous game silhouette at the existing chase-camera distance; it does not change flight handling or source-model dimensions. The peer's orange marker is lifted above the same live pose used by the 3D model so it does not cover the aircraft. The marker and model still update from the same interpolated peer pose.

Ranked flight loads the Bell X-1 GLB as two scene models and updates their model matrices in the same frame loop as the local aircraft and interpolated peer pose. The generic body, wings, and nose remain visible only while each model loads or if it fails. A concise notice reports failures instead of leaving an apparently missing aircraft. Free flight retains the Entity model path.

Ranked viewport dragging orbits the chase camera around the own aircraft, with a bounded vertical view angle and double-click recentering. The camera offset is published as a separate view value for screen-center capture. It never enters `FlightInput`, `FlightState`, model orientation, or the bank-mediated turn integration. The accepted flight controls and angular response remain fixed.

Follow-up display correction: the Bell X-1 asset receives a 180° rotation around the body's up axis in both Entity and ranked primitive rendering. The fallback geometry, camera, network pose, flight direction, and up axis are unchanged. The local speed target now depends on the vertical component of the aircraft's forward vector: climbing reduces speed and descending increases it within the existing game speed bounds. At exactly level flight, the previous throttle target and response are unchanged. The game samples rendered terrain height below the aircraft; contact during a ranked match is sent in the pose and resolved as an opponent win by the Worker.

## Verification evidence

C1.6 final implementation:
- PR #11 CI run `35057459919`: PASS;
- merged main commit `f76c2ec06192e9d6dfc287bc40d682c5eeb66de6`;
- merged-main CI run `35057500444`: PASS;
- `pnpm install --frozen-lockfile`: PASS;
- `pnpm validate:scaffold`: PASS;
- `pnpm check`: PASS;
- `pnpm build`: PASS.

Localhost visual/interaction QA was accepted on 2026-09-16. The accepted baseline includes corrected forward direction, unrestricted pitch/roll, bank-dependent body-axis pitch behavior, progressive control response, readable HUD, and acceptable control sensitivity.

C1 remains closed. The bank-mediated heading turn, ±3° capture refinement, and removal of direct yaw are C5 release integration changes layered on the accepted C1 architecture and must pass the C5 release verification gate before merge to the release baseline.
