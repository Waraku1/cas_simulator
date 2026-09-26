# C4E — Formal Weapon System

## Status

POST-RELEASE PRODUCT HARDENING

This contract replaces the user-facing abstract ACTION model with two explicit CAS gameplay weapons while preserving the existing server-authoritative competition boundary.

The values below are **CAS gameplay balance parameters only**. They are not intended to reproduce real-world weapon performance.

## Player controls

- `Left Arrow / Right Arrow`: cycle the selected weapon.
- `Space`: fire the selected weapon. Holding it repeats GUN fire at its 0.40 s cooldown cadence; MISSILE remains a single press.
- Drag the ranked viewport to look around. Releasing the drag returns the view to forward over 0.2 s; double-click centers it immediately. These actions change only camera yaw/pitch, never the aircraft orientation or the accepted W/S, A/D, and throttle inputs.
- `Up Arrow / Down Arrow`: throttle remains unchanged.
- `W / S`: pitch remains unchanged.
- `A / D`: bank/turn remains unchanged.

The selected weapon is local client UI state. Selection itself does not mutate authoritative match state.

## Standard loadout

Every current v1 aircraft carries:

1. `MISSILE`
2. `GUN`

Aircraft catalog order defines the cycling order.

### MISSILE

- HP effect: 20
- cooldown: 5.0 s
- interaction radius: 1350 m (fictional game-space selection and launch gate)
- fire profile: single

### GUN

- HP effect: 4
- cooldown: 0.40 s
- interaction radius: 360 m (legacy catalog indicator; no longer a launch gate)
- fire profile: rapid

Cooldowns are independent per weapon.

## Authority boundary

The client may request:

```json
{
  "type": "action",
  "clientTimeMs": 0,
  "weaponId": "missile"
}
```

The server decides whether the request is accepted.

The production RankedMatch authority verifies:

- active/overtime match phase;
- both participants connected;
- selected weapon is present in the aircraft loadout;
- selected weapon cooldown;
- fresh authoritative pose samples;
- 3D participant distance against the MISSILE interaction radius; GUN can launch at any peer distance.
- an available game projectile slot (at most eight in flight per match).
- for a tracking MISSILE, fresh view and target poses in the central camera region continuously for 1.2 s.

An accepted request creates a server-owned projectile eight game units ahead of the aircraft.
It does **not** immediately change HP. The server advances projectiles in bounded game steps,
checks each traveled segment against the peer's current aircraft position, and applies HP
only when the two touch. A miss or an expired projectile has no HP effect. Stale peer poses
cannot create a contact, and completing the match removes remaining projectiles.

`GUN` travels straight along the aircraft's forward direction without tracking. Its
game path is limited to 720 m and 1.8 s; contact is checked only along the traveled
segments, and the display removes the point and short trail when the path ends.
Holding Space sends GUN requests at 0.44 s intervals, subject to server cooldown and
the match's eight-projectile cap. The client does not determine contact.

`MISSILE` follows the opponent only when the selected missile view has kept the peer
within the expanded central camera region for 1.2 s with fresh pose updates. The progress bar shows the
local hold estimate; the server separately verifies the hold before allowing tracking.
Once held, the peer marker says `LOCKED` until capture is lost, and the peer receives
`MISSILE LOCK ALERT`. Firing without a completed lock still launches a straight game
projectile. Capture pauses and resets while the look pointer is held, during the
0.2 s return to forward, while the view remains displaced, or when the aircraft itself is not facing
the peer. The 1.2 s hold remains unchanged. Older clients without a view field
cannot establish a tracked shot. These are abstract game rules with no real-world guidance model.

The missile's fictional travel setting is 400 game m/s for 5.1 s, and the
server increases its per-step tracking blend for a more responsive curved path.
The central capture cone grows from 8° to 14° while the 1.2 s hold is fixed.
The authoritative Worker publishes one projectile update per incoming pose;
the renderer fills between those samples with up to 120 ms of visual-only
position prediction and a short missile trail. Visual prediction never affects
the server's contact result.

Only the server may:

- mark the fire request accepted;
- apply the weapon HP effect;
- advance weapon cooldown state;
- resolve zero HP / winner state.

The client does not send damage, hit outcome, target HP, cooldown completion, or winner state.

## Cooldown model

Each participant holds independent readiness:

```text
weaponReadyAtMs.missile
weaponReadyAtMs.gun
```

The legacy `nextActionAtMs` field remains temporarily for rolling compatibility. New clients prefer `weaponReadyAtMs`.

Existing persisted match states that do not yet have `weaponReadyAtMs` fall back to `nextActionAtMs` so a Worker rollout does not invalidate an in-progress state.

## Protocol compatibility

The WebSocket message type remains `action` during the migration. The new client adds `weaponId`.

- New client -> old Worker: old parser ignores the additional field and the match remains usable during rollout.
- Old client -> new Worker: omitted `weaponId` defaults to `missile`.
- New Worker snapshots add `weaponReadyAtMs`; the new client accepts old snapshots that do not contain it.
- New Worker snapshots add optional `projectiles`; the client accepts snapshots without it.
- Action feedback may include `locked`; older feedback without it remains valid.
- New pose snapshots may include `view` (`yawRad`, `pitchRad`, `weaponId`, `looking`) and a terrain `groundHeightM`; older pose clients remain readable, but cannot establish a tracked shot.
- The Worker may send `lock_alert` with a source slot and a locked/unlocked transition.

This compatibility layer may be removed after production Worker and supported clients are fully migrated.

## UI

Aircraft Assignment retains the four existing values:

- SPEED
- PITCH
- ROLL
- ACTION

ACTION now displays `MISSILE / GUN`.

The match HUD displays:

- selected weapon name;
- READY / selected-weapon cooldown;
- server feedback;
- central MISSILE capture progress, peer marker, incoming lock alert, and in-flight projectile count;
- visible game projectile points and short GUN trails at server-authoritative positions;
- `← / → SWITCH · SPACE FIRE`.

MISSILE uses a warm accent; GUN uses the existing cyan accent.

## Explicit v1 non-goals

C4E v1 does not attempt to model:

- real-world missile guidance;
- ammunition logistics;
- ballistic tables;
- weapon-specific real-aircraft performance;
- client-authoritative hit detection.

Richer visual effects may be layered on later without changing this authority contract.
