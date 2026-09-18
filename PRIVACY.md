# Account Data Handling Notice

Last updated: 2026-09-18

This notice describes the account data handled by CAS Flight Simulator. It is a factual description of the application's current data model and account lifecycle.

## Data used by the account system

When account persistence is enabled, the application stores the following in its Cloudflare D1 account database:

- an internally generated user ID;
- the chosen login ID and display name;
- password verification material consisting of a derived password hash, random salt, and KDF iteration count;
- rating, wins, losses, draws, and fixed/fixable aircraft preference state;
- account creation and update timestamps;
- hashed session tokens and session expiry timestamps;
- rated-match ledger records containing internal participant IDs, outcome/rating history, reason, and completion time.

The application account contract does not ask for an email address, legal name, postal address, phone number, age, or location.

The original password is not stored. Password verification uses derived hash material.

## Public information

The public leaderboard exposes:

- display name;
- rating;
- wins;
- losses;
- draws.

Login IDs and session information are not included in leaderboard responses.

Users should not put private or sensitive information in a login ID or display name.

## Sessions

Account sessions are valid for up to 7 days. Session tokens are stored server-side only as hashes. Logging out removes the current session. Expired session rows are opportunistically removed during account activity.

## Account deletion

A signed-in user can request account deletion from the Account & Privacy panel. The action requires:

1. the current account password; and
2. the exact confirmation word `DELETE`.

A successful deletion:

- revokes all sessions for the account;
- removes the original login ID from active use;
- replaces the display name with a non-identifying deleted-account label;
- removes the stored password hash/salt material used by the account;
- removes fixed/fixable aircraft preference state;
- prevents future login with the deleted account;
- removes the account from the public leaderboard.

The system retains the generated internal user ID and rated-match ledger/rating history in pseudonymous form. These records are retained to preserve match/rating integrity and database referential integrity. They are not usable to log in after deletion.

## Operational and infrastructure data

The application is hosted using Cloudflare Workers/Durable Objects/D1 and loads Cesium resources for the browser experience. Infrastructure providers may process ordinary network/service metadata as part of operating those services; this repository does not claim control over provider-level logging outside the application's own stored account model.

## Security

Do not include passwords, cookies, session tokens, or other credentials in GitHub issues, screenshots, logs, or release evidence.

Security-sensitive reports should follow [SECURITY.md](SECURITY.md).

## Changes

If the account schema or public account behavior changes, this notice must be updated before unrestricted public registration is considered release-ready.
