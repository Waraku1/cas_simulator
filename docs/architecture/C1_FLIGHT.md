# C1 — Flight Vertical Slice

Status: IMPLEMENTED / MANUAL LOCAL QA PENDING

## Objective

Create the first interactive flight experience on top of the C0 Cesium foundation without introducing multiplayer or game-loop mechanics.

## Flight model boundary

The aircraft is fictional and generic. The model is designed for stable, readable game interaction rather than reproduction of any real aircraft's performance, procedures, or handling qualities.

State:
- latitude / longitude;
- altitude;
- heading;
- pitch;
- bank;
- speed;
- throttle;
- vertical speed.

Controls:
- `W` / `S`: pitch;
- `A` / `D`: bank;
- `Q` / `E`: yaw input;
- `R` / `F`: throttle.

The integrator clamps frame delta and all primary control/state ranges. When the browser loses focus, pressed-key state is cleared.

## Rendering architecture

Cesium owns the high-frequency visual loop. React does not re-render at display refresh rate: the flight state updates via `requestAnimationFrame`, aircraft pose and chase camera are applied directly to Cesium properties, and compact telemetry is published to React at roughly 10 Hz for the HUD.

The aircraft representation uses simple Cesium geometry so C1 adds no external 3D-model dependency or asset-fetch cost.

## HUD contract

The HUD preserves the central viewport and places information around the edges:
- speed left;
- altitude right;
- attitude ladder and reticle center;
- heading / pitch / bank / vertical speed below center;
- throttle lower center;
- controls lower left;
- runtime diagnostics upper right.

The layout adapts at narrower widths and respects `prefers-reduced-motion` for HUD transitions.

## Verification evidence

GitHub Actions verified the C1 branch and merged `main` commit `64a03e4a3908b9d609d08eb6ac528f0b079d16ce` with:
- `pnpm install --frozen-lockfile`: PASS;
- `pnpm validate:scaffold`: PASS;
- `pnpm check`: PASS;
- `pnpm build`: PASS.

## C1 acceptance

Automated:
- [x] `pnpm validate:scaffold` exits 0.
- [x] `pnpm check` exits 0.
- [x] `pnpm build` exits 0.
- [x] Flight state is bounded and finite by construction.
- [x] HUD telemetry is decoupled from the high-frequency Cesium render loop.
- [x] No real-aircraft performance model, multiplayer, scoring, damage, or target/tag mechanics are introduced.

Manual localhost QA still required:
- [ ] Cesium Earth renders with the new flight HUD.
- [ ] Fictional aircraft moves continuously from keyboard input.
- [ ] Chase camera follows without visible breakage.
- [ ] HUD remains legible and central viewport remains usable.
- [ ] Runtime diagnostics remain visible and performance remains acceptable.

## Deferred

C2 owns theater boundaries and the 30-minute performance/resource gate. C3 owns multiplayer synchronization. C4 owns the abstract competitive game loop.
