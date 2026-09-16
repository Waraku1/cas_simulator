import { useState } from "react";
import {
  MATCH_RULES,
  type LeaderboardEntry,
  type PlayerProfile,
  type ProductScreen,
} from "../../shared/product";
import { FlightRuntime } from "../FlightRuntime";

const PREVIEW_PROFILE: PlayerProfile = {
  userId: "preview-pilot",
  displayName: "PREVIEW PILOT",
  rating: 1200,
  wins: 0,
  losses: 0,
  draws: 0,
  fixedAircraftId: null,
};

const PREVIEW_LEADERBOARD: readonly LeaderboardEntry[] = [
  { rank: 1, userId: "alpha", displayName: "ALPHA", rating: 1324, wins: 14, losses: 7, draws: 2 },
  { rank: 2, userId: "vector", displayName: "VECTOR", rating: 1288, wins: 11, losses: 6, draws: 1 },
  { rank: 3, userId: PREVIEW_PROFILE.userId, displayName: PREVIEW_PROFILE.displayName, rating: 1200, wins: 0, losses: 0, draws: 0 },
];

function Brand() {
  return (
    <div className="product-brand" aria-label="CAS Flight Simulator">
      <span>CAS FLIGHT SIMULATOR</span>
      <strong>ARCADE AIRSPACE</strong>
    </div>
  );
}

function AuthPreview({ onEnter }: Readonly<{ onEnter: () => void }>) {
  const [mode, setMode] = useState<"login" | "register">("login");

  return (
    <div className="product-screen product-screen--auth">
      <div className="product-grid" aria-hidden="true" />
      <Brand />
      <section className="auth-card" aria-label="Account preview">
        <p className="product-eyebrow">C4R PRODUCT PREVIEW</p>
        <h1>{mode === "login" ? "Welcome back" : "Create pilot ID"}</h1>
        <p className="product-copy">
          {mode === "login"
            ? "Sign in to enter matchmaking, review rating, and manage your fixed aircraft."
            : "Registration UI is wired to the public contract; persistence arrives in C4A."}
        </p>
        <div className="segmented-control" role="tablist" aria-label="Authentication mode">
          <button className={mode === "login" ? "is-active" : ""} onClick={() => setMode("login")}>LOGIN</button>
          <button className={mode === "register" ? "is-active" : ""} onClick={() => setMode("register")}>REGISTER</button>
        </div>
        <label className="product-field">
          <span>USER ID</span>
          <input autoComplete="username" placeholder="pilot-id" />
        </label>
        {mode === "register" && (
          <label className="product-field">
            <span>DISPLAY NAME</span>
            <input autoComplete="nickname" placeholder="display name" />
          </label>
        )}
        <label className="product-field">
          <span>PASSWORD</span>
          <input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} placeholder="••••••••" />
        </label>
        <button className="product-primary" onClick={onEnter}>ENTER UI PREVIEW</button>
        <p className="preview-note">No credentials are submitted or stored in C4R preview mode.</p>
      </section>
    </div>
  );
}

function HomePreview({
  profile,
  onStart,
  onLeaderboard,
  onSignOut,
}: Readonly<{
  profile: PlayerProfile;
  onStart: () => void;
  onLeaderboard: () => void;
  onSignOut: () => void;
}>) {
  return (
    <div className="product-screen product-screen--home">
      <div className="product-grid" aria-hidden="true" />
      <header className="home-topbar">
        <Brand />
        <div className="pilot-chip">
          <span>{profile.displayName}</span>
          <strong>{profile.rating}</strong>
          <button onClick={onSignOut}>SIGN OUT</button>
        </div>
      </header>

      <main className="home-layout">
        <section className="home-hero">
          <p className="product-eyebrow">RANKED // 1V1</p>
          <h1>Own the airspace.</h1>
          <p className="product-copy">
            Match with one opponent, receive a balanced fictional aircraft, and compete over a continuous 100 Heart Point match.
          </p>
          <button className="start-button" onClick={onStart}>
            <span>START</span>
            <small>BEGIN MATCHMAKING</small>
          </button>
        </section>

        <section className="home-cards" aria-label="Pilot summary">
          <article className="summary-card summary-card--rating">
            <span>RATING</span>
            <strong>{profile.rating}</strong>
            <small>PROVISIONAL</small>
          </article>
          <article className="summary-card">
            <span>FIXED AIRCRAFT</span>
            <strong>{profile.fixedAircraftId ?? "RANDOM"}</strong>
            <small>{profile.fixedAircraftId ? "PERSISTENT" : "ASSIGNED EACH MATCH"}</small>
          </article>
          <button className="summary-card summary-card--button" onClick={onLeaderboard}>
            <span>LEADERBOARD</span>
            <strong>VIEW</strong>
            <small>RANKINGS & RECORDS</small>
          </button>
        </section>
      </main>
      <footer className="product-footer">C4R UI PREVIEW // BACKEND ADAPTERS PENDING</footer>
    </div>
  );
}

function MatchmakingPreview({ onMatched, onCancel }: Readonly<{ onMatched: () => void; onCancel: () => void }>) {
  return (
    <div className="product-screen product-screen--matchmaking">
      <div className="product-grid" aria-hidden="true" />
      <Brand />
      <section className="queue-card">
        <div className="queue-orbit" aria-hidden="true"><span /></div>
        <p className="product-eyebrow">MATCHMAKING</p>
        <h1>Searching for opponent</h1>
        <p className="product-copy">Your current queue position and elapsed wait time will be server-backed in C4B.</p>
        <div className="queue-meta"><span>RATED 1V1</span><span>REGION AUTO</span><span>00:08</span></div>
        <div className="queue-actions">
          <button className="product-secondary" onClick={onCancel}>CANCEL</button>
          <button className="product-primary product-primary--compact" onClick={onMatched}>PREVIEW MATCH FOUND</button>
        </div>
      </section>
    </div>
  );
}

function AircraftAssignmentPreview({ onContinue }: Readonly<{ onContinue: () => void }>) {
  return (
    <div className="product-screen product-screen--assignment">
      <div className="product-grid" aria-hidden="true" />
      <Brand />
      <section className="assignment-card">
        <p className="product-eyebrow">AIRCRAFT ASSIGNMENT</p>
        <div className="aircraft-silhouette" aria-hidden="true"><span /></div>
        <h1>ORBIT // A1</h1>
        <p className="product-copy">Balanced fictional profile assigned for this match. Final catalog and balance budget arrive in C4B.</p>
        <dl className="spec-strip">
          <div><dt>SPEED</dt><dd>BALANCED</dd></div>
          <div><dt>HANDLING</dt><dd>AGILE</dd></div>
          <div><dt>SIZE</dt><dd>MEDIUM</dd></div>
          <div><dt>ACTION</dt><dd>STANDARD</dd></div>
        </dl>
        <button className="product-primary" onClick={onContinue}>ENTER COUNTDOWN</button>
      </section>
    </div>
  );
}

function MatchPreview({ onExit }: Readonly<{ onExit: () => void }>) {
  return (
    <div className="product-match-shell">
      <FlightRuntime showDevelopmentPanels={false} />
      <div className="c4-match-hud" aria-label="C4 match HUD preview">
        <div className="match-hud__top">
          <div className="hp-block hp-block--local">
            <span>YOU</span><strong>{MATCH_RULES.startingHeartPoints}</strong><div><i style={{ width: "100%" }} /></div>
          </div>
          <div className="match-clock"><span>REGULATION</span><strong>04:00</strong><small>RATED MATCH</small></div>
          <div className="hp-block hp-block--peer">
            <span>PEER</span><strong>{MATCH_RULES.startingHeartPoints}</strong><div><i style={{ width: "100%" }} /></div>
          </div>
        </div>
        <div className="match-action-state"><span>ACTION</span><strong>READY</strong><small>ABSTRACT MODULE</small></div>
        <button className="match-exit-preview" onClick={onExit}>EXIT PREVIEW</button>
      </div>
    </div>
  );
}

function LeaderboardPreview({ onBack }: Readonly<{ onBack: () => void }>) {
  return (
    <div className="product-screen product-screen--leaderboard">
      <div className="product-grid" aria-hidden="true" />
      <header className="home-topbar"><Brand /><button className="product-secondary" onClick={onBack}>BACK HOME</button></header>
      <main className="leaderboard-card">
        <p className="product-eyebrow">GLOBAL RANKING</p>
        <h1>Leaderboard</h1>
        <div className="leaderboard-head"><span>RANK</span><span>PILOT</span><span>RATING</span><span>W/L/D</span></div>
        {PREVIEW_LEADERBOARD.map((entry) => (
          <div className={entry.userId === PREVIEW_PROFILE.userId ? "leaderboard-row is-local" : "leaderboard-row"} key={entry.userId}>
            <strong>#{entry.rank}</strong><span>{entry.displayName}</span><strong>{entry.rating}</strong><span>{entry.wins}/{entry.losses}/{entry.draws}</span>
          </div>
        ))}
      </main>
    </div>
  );
}

export function ProductPreview() {
  const [screen, setScreen] = useState<ProductScreen>("auth");

  if (screen === "auth") return <AuthPreview onEnter={() => setScreen("home")} />;
  if (screen === "home") {
    return (
      <HomePreview
        profile={PREVIEW_PROFILE}
        onStart={() => setScreen("matchmaking")}
        onLeaderboard={() => setScreen("leaderboard")}
        onSignOut={() => setScreen("auth")}
      />
    );
  }
  if (screen === "matchmaking") {
    return <MatchmakingPreview onMatched={() => setScreen("aircraft-assignment")} onCancel={() => setScreen("home")} />;
  }
  if (screen === "aircraft-assignment") {
    return <AircraftAssignmentPreview onContinue={() => setScreen("match")} />;
  }
  if (screen === "leaderboard") return <LeaderboardPreview onBack={() => setScreen("home")} />;
  if (screen === "match") return <MatchPreview onExit={() => setScreen("home")} />;

  return <HomePreview profile={PREVIEW_PROFILE} onStart={() => setScreen("matchmaking")} onLeaderboard={() => setScreen("leaderboard")} onSignOut={() => setScreen("auth")} />;
}
