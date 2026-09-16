# C4R Product Contract

Status: DRAFT FOR IMPLEMENTATION

This document is the implementation contract for the public CAS Simulator product direction after C3 closure. C1-C3 remain accepted foundations unless explicitly superseded below.

## 1. Product flow

The public product follows this state flow:

`AUTH -> HOME -> MATCHMAKING -> AIRCRAFT_ASSIGNMENT -> COUNTDOWN -> ACTIVE -> OVERTIME? -> RESULT -> RATING_UPDATE -> HOME`

The school-local runtime may use a development identity/session shim until public authentication persistence is implemented, but the UI and domain state machine must match the public flow.

## 2. Account and home requirements

Public home requires:
- login with user ID and password;
- registration when no account exists;
- persistent account identity;
- rating and leaderboard access;
- current fixed-aircraft state;
- a single primary START action that enters matchmaking.

Passwords must never be stored in plaintext. Authentication, session validation, and rating mutation are server-authoritative.

## 3. Matchmaking

START places the authenticated user into a waiting queue. A match begins only after two compatible players are paired.

The queue UX must clearly expose:
- searching state;
- elapsed wait time;
- cancel action;
- matched transition;
- aircraft assignment before countdown.

## 4. Aircraft assignment and persistence

Each fictional aircraft has a stable `aircraftId` and a gameplay specification.

When `fixedAircraftId` is null, matchmaking assigns one aircraft from the eligible pool using the server-side assignment policy. After a match, the user may designate the assigned aircraft as the one persistent fixed aircraft.

A user can have at most one fixed aircraft at any time. Fixing another aircraft replaces the previous fixed choice. This is a single-choice persistence mechanic, not a multi-aircraft inventory.

Aircraft must be sidegrades under a shared balance budget. Rarity or random assignment must not imply direct competitive superiority.

Allowed gameplay variation:
- minimum speed;
- maximum speed;
- pitch response/acceleration;
- roll response/acceleration;
- visual size/profile;
- appearance;
- fictional abstract action-module profile.

Out of scope:
- real weapon names or real weapon performance;
- projectiles or ballistic trajectories;
- ammunition simulation;
- guidance or lock-on simulation;
- physical damage/destruction modeling;
- realistic targeting mechanics;
- real-aircraft combat performance modeling.

## 5. Match start geometry

At match start both players receive deterministic, symmetric staging near the theater center:
- same altitude;
- same initial speed unless an aircraft-balance contract later explicitly requires normalized launch speed;
- parallel headings;
- lateral separation;
- each player can visually acquire the other without either side receiving positional privilege;
- left/right slot assignment is randomized per match.

A short countdown freezes competitive actions before ACTIVE begins.

## 6. Heart Point match contract

Heart Point (HP) is an abstract competitive resource. It is not a physical damage model.

Canonical values:
- starting HP: 100 each;
- HP minimum: 0;
- regulation: 4 minutes;
- overtime after exact regulation tie: 60 seconds;
- HP recovery: none by default;
- flight-performance degradation from low HP: none.

Server-authoritative abstract action events may reduce the peer's HP according to the equipped fictional action-module balance profile.

Immediate result:
- if one player reaches 0 HP, the other player wins immediately.

Regulation result at 4:00:
- higher HP wins;
- exact HP tie enters OVERTIME.

Overtime result:
- HP play continues for the full 60 seconds unless one player reaches 0 HP;
- at 60 seconds, higher HP wins;
- if HP remains exactly equal, result is DRAW.

There is no mid-match respawn under the HP model.

## 7. Disconnect and result integrity

- disconnect grace: 20 seconds;
- successful reconnection within grace resumes the same match state;
- intentional leave or failure to return within grace resolves as FORFEIT LOSS;
- infrastructure/server failure resolves as NO CONTEST;
- NO CONTEST never changes rating;
- rating changes only for completed rated matches.

Result categories are explicit:
- WIN;
- LOSS;
- DRAW;
- NO_CONTEST.

Forfeit is a result reason attached to LOSS, not a separate rating category.

## 8. Rating and leaderboard

Rating updates are server-authoritative and committed only after a completed rated result. The exact rating formula is a later bounded decision, but the product contract requires deterministic update semantics and idempotent result processing.

Leaderboard minimum fields:
- rank;
- display name;
- rating;
- wins;
- losses;
- draws.

## 9. UX quality contract

Implementation must prioritize a coherent product shell instead of exposing development panels as the primary experience.

Target surfaces:
- Auth screen;
- Home screen;
- Matchmaking overlay/screen;
- Aircraft reveal/assignment transition;
- Countdown;
- In-match HUD;
- Result screen;
- Leaderboard.

The in-match HUD should keep critical information immediately scannable: HP, remaining time, overtime state, action readiness, connection state, and peer identification. Diagnostics remain development-only secondary UI.

## 10. Delivery roadmap

### C4R — Product contract and UI state shell
Freeze domain/state contracts, shared types, route/screen state, visual shell, and migration boundaries. No persistence or real matchmaking dependency yet.

### C4A — Authentication and Home
Implement public-compatible login/register/session architecture and the polished Home shell. School-local development may use a documented local identity adapter while preserving public interfaces.

### C4B — Matchmaking and Aircraft Assignment
Implement queue lifecycle, matched transition, random/fixed aircraft assignment, one-fixed-aircraft invariant, aircraft catalog and balance contract, staging/countdown.

### C4C — HP Competition Runtime
Implement server-authoritative 100 HP lifecycle, 4-minute regulation, 60-second overtime, action cooldown/effects, disconnect grace, forfeit/no-contest, and result state. Production Durable Object and school-local Node runtime must be behaviorally equivalent.

### C4D — Rating and Leaderboard
Implement completed-match rating transaction, persistent statistics, leaderboard query/view, result-to-home flow, and fixed-aircraft persistence.

### C5 — Release Hardening
Accessibility, performance evidence, authentication/security review, production deployment, rollback, school-local regression, browser/device QA, CAS evidence packaging, and visual sign-off.

## 11. Immediate implementation sequence

1. Define shared `ProductScreen`, match phase, result, HP, aircraft and account-facing types.
2. Refactor the current app into a product-shell state boundary without breaking C1-C3 flight/multiplayer behavior.
3. Build polished Home/Matchmaking/Match HUD placeholder surfaces against typed mock/domain state.
4. Replace mock adapters incrementally with C4A-C4D server implementations.

This sequence keeps visible UX progress ahead of backend completion while preventing UI contracts from diverging from the eventual server model.
