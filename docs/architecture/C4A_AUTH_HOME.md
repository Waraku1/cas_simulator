# C4A Authentication and Home Contract

Status: IMPLEMENTATION FOUNDATION

C4A introduces public-compatible account/session persistence without coupling the UI to a specific storage implementation.

## 1. Architecture

Production:
- Cloudflare Worker owns `/api/auth/*`.
- Cloudflare D1 stores users and hashed session identifiers.
- Browser receives an opaque session cookie.
- Home/profile reads are server-authoritative.

School-local:
- the existing Node school backend implements the same HTTP contract;
- local account/session storage may be ephemeral during C4A;
- no production secret or production database is required for school iteration;
- the client must not branch on storage implementation.

## 2. API contract

### POST `/api/auth/register`
Input: `RegisterRequest`.

Success:
- creates one account;
- creates a session;
- returns the public user profile;
- sets the session cookie.

### POST `/api/auth/login`
Input: `LoginRequest`.

Success:
- validates credentials;
- rotates/creates a session;
- returns the public user profile;
- sets the session cookie.

Invalid login ID and invalid password must share a generic credential-error response.

### GET `/api/auth/session`
Returns the current public user profile when the session is valid. Returns `NOT_AUTHENTICATED` otherwise.

### POST `/api/auth/logout`
Invalidates the current session and clears the browser cookie.

## 3. Password storage

Plaintext passwords are never persisted or logged.

Implementation contract:
- per-user cryptographically random salt;
- PBKDF2-HMAC-SHA-256 through Web Crypto;
- iteration count stored per user to permit future upgrades;
- the production iteration count must be selected by bounded Worker CPU benchmarking before public release rather than copied from an arbitrary constant;
- successful login may re-hash with a newer work factor when policy changes.

Cloudflare Workers currently supports Web Crypto PBKDF2. The implementation must use constant-shape error responses and avoid exposing stored hash/salt data to the browser.

## 4. Session storage

Session tokens are high-entropy opaque random values.

Production persistence stores only a SHA-256 hash of the session token. The raw token exists only in the browser cookie and request processing memory.

Public cookie requirements:
- `HttpOnly`;
- `Secure`;
- `SameSite=Lax`;
- `Path=/`;
- bounded expiry.

School-local loopback may omit `Secure` only because the canonical school origin is HTTP `127.0.0.1`; that exception stays inside the school adapter and must never affect production headers.

Logout deletes the stored session and clears the cookie. Expired sessions are rejected even if a stale cookie remains.

## 5. D1 schema

Canonical migration: `migrations/0001_c4a_accounts.sql`.

Tables:
- `users`: identity, password verifier fields, rating/stat counters, optional single `fixed_aircraft_id`;
- `sessions`: hashed token, user reference, creation/expiry timestamps.

Leaderboard indexing is prepared on rating but leaderboard behavior is owned by C4D.

## 6. Home contract

The Home screen consumes only `PublicUserProfile` plus product-service state. It does not read D1 directly.

Required Home data:
- display name;
- current rating;
- W/L/D record;
- fixed aircraft or RANDOM mode;
- START matchmaking action;
- leaderboard navigation;
- logout.

C4A keeps the existing C4R visual shell and replaces preview identity state with the auth/session adapter incrementally.

## 7. Security and UX requirements

- Never put password values in logs, URLs, analytics, or localStorage.
- Never persist raw session tokens server-side.
- Login failure text must not reveal whether an account exists.
- Registration validates normalized login ID and display name server-side.
- UI must show pending/error/success states without double-submitting forms.
- Session expiry returns the user cleanly to Auth without destroying unrelated local app state.
- Authentication endpoints require JSON content type and bounded request bodies.

## 8. Delivery sequence

1. shared auth types/validation — implemented;
2. D1 account/session migration — implemented;
3. password/session crypto helpers;
4. production D1 repository adapter;
5. school-local in-memory repository adapter;
6. `/api/auth/register|login|session|logout` parity;
7. replace C4R preview auth with real adapter;
8. Home profile/session integration;
9. CI + school-local browser QA;
10. create/bind production D1 only after repo-side contract passes automated verification.
