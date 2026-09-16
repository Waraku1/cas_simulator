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
- `Q / E`: experimental direct-yaw instrumentation retained only during development; mandatory removal before final release is tracked by Issue #7.

Pitch and roll angle authority are unrestricted. The orientation quaternion is normalized after updates, permitting full loops and continuous rolls. Pitch acts about the aircraft's own lateral axis, so its earth-relative effect naturally depends on bank attitude.

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

C1.6 finalized near-level capture. Pitch and bank independently return toward exactly 0° only when the displayed residual angle is within ±5°, the relevant input is released, and the relevant angular rate is at or below 1.5 deg/s. Capture rate is 18 deg/s. Outside ±5° there is no auto-level authority.

## Rendering alignment

The flight model exports its canonical local body frame. Cesium converts that frame from local ENU to ECEF and uses it consistently for aircraft orientation, asymmetric nose marker, chase-camera position, and camera look direction. Aircraft nose, camera, and actual travel therefore share one reference-frame contract.

## Verification evidence

C1.6 final implementation:
- PR #11 CI run `35057459919`: PASS;
- merged main commit `f76c2ec06192e9d6dfc287bc40d682c5eeb66de6`;
- merged-main CI run `35057500444`: PASS;
- `pnpm install --frozen-lockfile`: PASS;
- `pnpm validate:scaffold`: PASS;
- `pnpm check`: PASS;
- `pnpm build`: PASS.

Localhost visual/interaction QA was accepted on 2026-09-16. The accepted baseline includes corrected forward direction, unrestricted pitch/roll, bank-dependent body-axis pitch behavior, progressive control response, softer ±5° level capture, readable HUD, and acceptable control sensitivity.

C1 is frozen except for later-gate integration requirements and the explicitly deferred C5 removal of experimental direct yaw.
