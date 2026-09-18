import type { ReactNode } from "react";

export function AccountDataNotice({ compact = false }: Readonly<{ compact?: boolean }>) {
  return (
    <section className={compact ? "account-data-notice account-data-notice--compact" : "account-data-notice"} aria-labelledby="account-data-title">
      <p className="product-eyebrow">ACCOUNT DATA & PRIVACY</p>
      <h2 id="account-data-title">What this account stores</h2>
      <p>
        CAS Flight Simulator stores only the account and match data needed for sign-in, ranked results,
        leaderboard display, and fixed-aircraft preferences.
      </p>
      <ul>
        <li>User ID and display name.</li>
        <li>Password verification data as a derived hash, salt, and KDF settings; the original password is not stored.</li>
        <li>Rating, wins/losses/draws, aircraft preference state, and account timestamps.</li>
        <li>Hashed session tokens. Sessions are valid for up to 7 days and expired sessions are cleaned during account activity.</li>
        <li>Rated-match ledger entries with internal user IDs, result/rating history, and completion time.</li>
      </ul>
      <p>
        The public leaderboard shows display name, rating, and W/L/D. The account contract does not request
        email address, legal name, postal address, phone number, age, or location.
      </p>
      <h3>Account deletion</h3>
      <p>
        Deleting an account revokes all sessions and removes the login ID, display name, password verification
        material, and aircraft preferences from active use. A pseudonymous internal user ID and rated-match ledger
        are retained only to preserve ranking and match-history integrity. Deleted accounts are excluded from sign-in
        and the leaderboard.
      </p>
      {!compact && (
        <p>
          Production account data is stored in the application's Cloudflare D1 database. Do not put private or
          sensitive information in your display name or user ID.
        </p>
      )}
    </section>
  );
}

export function AccountDataDisclosure({ children }: Readonly<{ children?: ReactNode }>) {
  return (
    <details className="account-data-disclosure">
      <summary>Review account data & privacy</summary>
      <AccountDataNotice compact />
      {children}
    </details>
  );
}
