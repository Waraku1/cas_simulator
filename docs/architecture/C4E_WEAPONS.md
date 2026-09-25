# C4E — Formal Weapon System

## Status

POST-RELEASE PRODUCT HARDENING

This contract replaces the user-facing abstract ACTION model with two explicit CAS gameplay weapons while preserving the existing server-authoritative competition boundary.

The values below are **CAS gameplay balance parameters only**. They are not intended to reproduce real-world weapon performance.

## Player controls

- `Left Arrow / Right Arrow`: cycle the selected weapon.
- `Space`: fire the selected weapon.
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
- interaction radius: 600 m
- fire profile: single

### GUN

- HP effect: 4
- cooldown: 0.40 s
- interaction radius: 180 m
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
- 3D participant distance against the selected weapon's CAS interaction radius.
- an available game projectile slot (at most eight in flight per match).

An accepted request creates a server-owned projectile eight game units ahead of the aircraft.
It does **not** immediately change HP. The server advances projectiles in bounded game steps,
checks each traveled segment against the peer's current aircraft position, and applies HP
only when the two touch. A miss or an expired projectile has no HP effect. Stale peer poses
cannot create a contact, and completing the match removes remaining projectiles.

`GUN` travels along the aircraft's forward direction without tracking. `MISSILE` tracks
only when the opponent is in the forward aim region when fired; otherwise it travels
straight. These are intentionally abstract game rules, with no real-world guidance model.

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
- game lock availability and in-flight projectile count;
- visible game projectile points at server-authoritative positions;
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
