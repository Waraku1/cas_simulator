# C4D — Rating, Account State, and Leaderboard

## Status

- C4C authoritative match runtime: **CLOSED / ACCEPTED** after human QA.
- C4D school-local rated product: **AUTOMATED E2E PASS** on main `a6cec45697d9e076bf984843b186660b2671e556` and retained by later main CI.
- C4D production Worker/Durable Object authority code: **IMPLEMENTED / CI GREEN** on main `e2470fa005ac8f6abd405ba071ba62f6bfb64011`.
- One-account/one-active-rated-match integrity hardening: **IMPLEMENTED / CI PENDING** on `c4d/active-match-integrity`.
- Production D1 provisioning, binding, migration, deployment, and public rated-product smoke: **BLOCKED ON CLOUDFLARE D1 API AUTHORIZATION**.

C4D is not closed until the production persistence gate is completed.

## Rating contract

- Initial rating: `1200`.
- Update model: deterministic Elo-style update with `K = 32`.
- Equal-rating decisive result: winner `1216`, loser `1184`.
- Draws are rated from the normal expected-score calculation.
- `infrastructure-failure` / NO CONTEST never changes rating or W/L/D.
- W/L/D changes only with a completed rated result.
- `matchId` is the idempotency key in `rated_matches`; one match can affect account statistics at most once.

## Identity and trust boundary

Public clients do not supply authoritative account identity, rating, W/L/D, or fixed-aircraft state.

The production flow is:

`HttpOnly session cookie -> Worker authentication against D1 -> server-injected internal identity -> RankedMatchmaker -> RankedMatch -> D1 result transaction`

For `/api/matchmaking/ws` and `/api/matches/{matchId}/ws`, `src/worker/app.ts` authenticates the session before forwarding to the Durable Object layer. It overwrites internal identity headers from the stored account record. Client-provided values with the same header names are not authoritative.

`RankedMatchmaker` stores only the authenticated user ID and server-resolved `fixedAircraftId` in its hibernating WebSocket attachment. The `enqueue.fixedAircraftId` field remains in the client protocol for compatibility but is not authoritative.

A ranked pair must contain two distinct authenticated account IDs. Match initialization stores each account ID only as server-side match metadata. `competitionSnapshot()` deliberately excludes it from browser-visible state.

`RankedMatch` validates both the join token and the authenticated account ID before accepting a ranked WebSocket connection.

## Result finalization and retry

The authoritative match result is saved to Durable Object state before account mutation.

After a result exists:

1. NO CONTEST is marked account-neutral and completes without rating mutation.
2. Legacy matches without account IDs remain valid but unrated.
3. Rated matches call `D1RatingRepository.applyMatch()`.
4. Randomly assigned aircraft become `fixableAircraftId` only after a completed rated result.
5. A durable `rating-finalized-v1` marker is written only after required account mutations succeed.
6. If D1 mutation fails, the Durable Object keeps the match result and schedules an alarm retry rather than losing or recomputing the result.
7. Repeated calls are safe because the D1 `rated_matches` ledger rejects duplicate application by `match_id`.
8. The global active-match lock is released only after the account-finalization marker exists; lock-release failure is retried by Durable Object alarm.

This means a transient persistence failure does not invalidate the already-determined match result, does not create a double rating update, and does not prematurely allow the same account to enter another rated match before finalization completes.

## One active rated match per account

`RankedMatchmaker` persists a global map from authenticated `userId` to authoritative `matchId` in its Durable Object storage.

- A user already present in this map cannot enter a second rated queue/match from another browser context or tab.
- Self-matching of the same account remains prohibited independently.
- Both participants are locked before RankedMatch initialization.
- Initialization failure rolls back only locks that still point to the failed `matchId`.
- Match completion releases a lock only when `active[userId] === matchId`; delayed completion from an older match therefore cannot clear a newer lock.
- `RankedMatch` uses the production integrity wrapper to release both participant locks only after account finalization has completed.
- Lock release is idempotent and alarm-retried on internal failure.

## Initial connection integrity

A participant who receives a ranked assignment but never establishes the RankedMatch connection no longer leaves the match indefinitely pending.

- Initial deadline: `activeAtMs + 20 seconds`.
- Connecting before that deadline clears the participant deadline.
- If one participant remains absent when the deadline expires, the connected participant wins by FORFEIT.
- If both participants remain absent, the match resolves as NO CONTEST / `infrastructure-failure`.
- The school-local runtime mirrors this behavior and the pure runtime CI gate verifies both outcomes.

## Fixed-aircraft contract

- At most one `fixedAircraftId` exists per account.
- If a fixed aircraft exists, matchmaking uses the stored server value.
- Otherwise the server chooses one eligible fictional aircraft randomly.
- Production records whether the assignment was random as server-only match provenance.
- After a completed rated match, a random assignment is written as `fixableAircraftId`.
- The public fixed-aircraft API only accepts `null` or the current `fixableAircraftId`; arbitrary aircraft IDs are rejected.

## School-local evidence

The CI gate `C4D_AUTHENTICATED_RATED_PRODUCT_SMOKE` covers:

- two real registered sessions;
- session-authenticated matchmaking;
- server-controlled random assignment;
- authenticated RankedMatch transport;
- FORFEIT result;
- `1200 -> 1184 / 1216` rating update;
- exactly one LOSS / WIN increment;
- duplicate-result idempotency;
- leaderboard ordering;
- random-assignment fixability;
- rejection of a non-fixable aircraft;
- fixed-aircraft persistence into the next match.

The pure runtime gate additionally verifies 20-second reconnect grace, initial-connect grace, and dual-initial-absence NO CONTEST behavior. The same CI run retains C3, C4B, C4C, and account regression gates.

## Production D1 deployment gate

The repository contains migrations:

- `migrations/0001_c4a_accounts.sql`
- `migrations/0002_c4d_rating.sql`

The production `ACCOUNTS` D1 binding is intentionally not configured with a placeholder database ID. A real Cloudflare D1 database must first be provisioned, and the resulting real `database_id` must then be bound as `ACCOUNTS` and both migrations applied.

An isolated GitHub Actions provisioning attempt was executed before any production deployment. Cloudflare rejected `wrangler d1 list --json` with API authentication error code `10000`. No D1 database, migration, binding, or Worker deployment was created by that failed run. The existing production service therefore remained unchanged.

Until D1 authorization is available:

- existing C3 production room functionality remains available;
- account and authenticated ranked-product routes fail closed with `STORAGE_UNAVAILABLE` rather than falling back to client identity;
- the D1 provisioning workflow remains safely rerunnable after the Cloudflare token is granted D1 access.

After provisioning, C4D requires a production smoke covering account creation/session, two-account matchmaking, one completed rated result, account refresh, leaderboard update, duplicate-result protection, active-match lock behavior, and fixed-aircraft persistence before C4D can be closed.
