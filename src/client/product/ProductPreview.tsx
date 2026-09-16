import { useEffect, useState } from "react";
import { aircraftById } from "../../shared/aircraft";
import type { MatchFoundAssignment } from "../../shared/matchmaking";
import {
  MATCH_RULES,
  type LeaderboardEntry,
  type PlayerProfile,
  type ProductScreen,
} from "../../shared/product";
import { FlightRuntime } from "../FlightRuntime";
import { useMatchmaking } from "./useMatchmaking";

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
        <p className="product-eyebrow">C4 PRODUCT PREVIEW</p>
        <h1>{mode === "login" ? "Welcome back" : "Create pilot ID"}</h1>
        <p className="product-copy">
          {mode === "login"
            ? "Sign in to enter matchmaking, review rating, and manage your fixed aircraft."
            : "Registration follows the public account contract; production persistence remains adapter-backed."}
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
          <input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} placeholder="••••••••••" />
        </label>
        <button className="product-primary" onClick={onEnter}>ENTER PRODUCT PREVIEW</button>
        <p className="preview-note">Preview credentials are not submitted or stored yet.</p>
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
            Match with one opponent, receive a sidegrade fictional aircraft, and compete over a continuous 100 Heart Point match.
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
      <footer className="product-footer">C4B LIVE MATCHMAKING PREVIEW // ACCOUNT PERSISTENCE PENDING</footer>
    </div>
  );
}

function MatchmakingPreview({
  fixedAircraftId,
  onMatched,
  onCancel,
}: Readonly<{
  fixedAircraftId: string | null;
  onMatched: (assignment: MatchFoundAssignment) => void;
  onCancel: () => void;
}>) {
  const matchmaking = useMatchmaking();
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    matchmaking.enqueue(fixedAircraftId);
    return matchmaking.cancel;
  }, [fixedAircraftId, matchmaking.enqueue, matchmaking.cancel]);

  useEffect(() => {
    if (matchmaking.assignment) onMatched(matchmaking.assignment);
  }, [matchmaking.assignment, onMatched]);

  useEffect(() => {
    if (matchmaking.queuedAtMs === null) {
      setElapsedSeconds(0);
      return;
    }
    const update = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - matchmaking.queuedAtMs!) / 1_000)));
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [matchmaking.queuedAtMs]);

  const cancel = () => {
    matchmaking.cancel();
    onCancel();
  };

  return (
    <div className="product-screen product-screen--matchmaking">
      <div className="product-grid" aria-hidden="true" />
      <Brand />
      <section className="queue-card">
        <div className="queue-orbit" aria-hidden="true"><span /></div>
        <p className="product-eyebrow">MATCHMAKING // LIVE LOCAL CONTRACT</p>
        <h1>{matchmaking.status === "connecting" ? "Connecting to queue" : "Searching for opponent"}</h1>
        <p className="product-copy">
          The server pairs exactly two waiting clients, assigns the room and fictional aircraft, then synchronizes the reveal and countdown.
        </p>
        <div className="queue-meta">
          <span>RATED 1V1</span>
          <span>{fixedAircraftId ? "FIXED AIRCRAFT" : "RANDOM AIRCRAFT"}</span>
          <span>{String(Math.floor(elapsedSeconds / 60)).padStart(2, "0")}:{String(elapsedSeconds % 60).padStart(2, "0")}</span>
        </div>
        {matchmaking.status === "error" && <p className="preview-note">{matchmaking.errorMessage}</p>}
        <div className="queue-actions">
          <button className="product-secondary" onClick={cancel}>CANCEL</button>
        </div>
      </section>
    </div>
  );
}

function AircraftAssignmentPreview({
  assignment,
  onCountdown,
}: Readonly<{
  assignment: MatchFoundAssignment;
  onCountdown: () => void;
}>) {
  const aircraft = aircraftById(assignment.aircraftId);
  const peerAircraft = aircraftById(assignment.peerAircraftId);

  useEffect(() => {
    const timer = window.setTimeout(onCountdown, Math.max(0, assignment.assignmentEndsAtMs - Date.now()));
    return () => window.clearTimeout(timer);
  }, [assignment.assignmentEndsAtMs, onCountdown]);

  return (
    <div className="product-screen product-screen--assignment">
      <div className="product-grid" aria-hidden="true" />
      <Brand />
      <section className="assignment-card">
        <p className="product-eyebrow">MATCH FOUND // AIRCRAFT ASSIGNMENT</p>
        <div className="aircraft-silhouette" aria-hidden="true"><span /></div>
        <h1>{aircraft?.displayName ?? assignment.aircraftId}</h1>
        <p className="product-copy">
          Server-assigned fictional sidegrade. Opponent profile: {peerAircraft?.displayName ?? assignment.peerAircraftId}. Spawn side: {assignment.spawnSide.toUpperCase()}.
        </p>
        <dl className="spec-strip">
          <div><dt>SPEED</dt><dd>{aircraft ? `${aircraft.minimumSpeedMps}–${aircraft.maximumSpeedMps}` : "—"}</dd></div>
          <div><dt>PITCH</dt><dd>{aircraft?.pitchAccelerationDegS2 ?? "—"}</dd></div>
          <div><dt>ROLL</dt><dd>{aircraft?.rollAccelerationDegS2 ?? "—"}</dd></div>
          <div><dt>ACTION</dt><dd>{aircraft?.actionModuleId.toUpperCase() ?? "—"}</dd></div>
        </dl>
        <p className="preview-note">Assignment reveal advances automatically into the synchronized countdown.</p>
      </section>
    </div>
  );
}

function CountdownPreview({
  assignment,
  onActive,
}: Readonly<{
  assignment: MatchFoundAssignment;
  onActive: () => void;
}>) {
  const [remainingMs, setRemainingMs] = useState(() => Math.max(0, assignment.activeAtMs - Date.now()));

  useEffect(() => {
    const update = () => {
      const next = Math.max(0, assignment.activeAtMs - Date.now());
      setRemainingMs(next);
      if (next === 0) onActive();
    };
    update();
    const timer = window.setInterval(update, 100);
    return () => window.clearInterval(timer);
  }, [assignment.activeAtMs, onActive]);

  return (
    <div className="product-screen product-screen--matchmaking">
      <div className="product-grid" aria-hidden="true" />
      <Brand />
      <section className="queue-card">
        <p className="product-eyebrow">MATCH {assignment.matchId.slice(0, 8).toUpperCase()}</p>
        <h1>{Math.max(1, Math.ceil(remainingMs / 1_000))}</h1>
        <p className="product-copy">Room {assignment.roomCode} // synchronized start</p>
        <div className="queue-meta"><span>100 HP</span><span>04:00</span><span>{assignment.spawnSide.toUpperCase()} SIDE</span></div>
      </section>
    </div>
  );
}

function MatchPreview({ assignment, onExit }: Readonly<{ assignment: MatchFoundAssignment; onExit: () => void }>) {
  const aircraft = aircraftById(assignment.aircraftId);
  return (
    <div className="product-match-shell">
      <FlightRuntime showDevelopmentPanels={false} autoRoomCode={assignment.roomCode} />
      <div className="c4-match-hud" aria-label="C4 match HUD preview">
        <div className="match-hud__top">
          <div className="hp-block hp-block--local">
            <span>YOU // {aircraft?.displayName ?? assignment.aircraftId}</span><strong>{MATCH_RULES.startingHeartPoints}</strong><div><i style={{ width: "100%" }} /></div>
          </div>
          <div className="match-clock"><span>REGULATION</span><strong>04:00</strong><small>{assignment.roomCode}</small></div>
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
  const [assignment, setAssignment] = useState<MatchFoundAssignment | null>(null);

  if (screen === "auth") return <AuthPreview onEnter={() => setScreen("home")} />;
  if (screen === "home") {
    return (
      <HomePreview
        profile={PREVIEW_PROFILE}
        onStart={() => {
          setAssignment(null);
          setScreen("matchmaking");
        }}
        onLeaderboard={() => setScreen("leaderboard")}
        onSignOut={() => setScreen("auth")}
      />
    );
  }
  if (screen === "matchmaking") {
    return (
      <MatchmakingPreview
        fixedAircraftId={PREVIEW_PROFILE.fixedAircraftId}
        onMatched={(nextAssignment) => {
          setAssignment(nextAssignment);
          setScreen("aircraft-assignment");
        }}
        onCancel={() => setScreen("home")}
      />
    );
  }
  if (screen === "aircraft-assignment" && assignment) {
    return <AircraftAssignmentPreview assignment={assignment} onCountdown={() => setScreen("countdown")} />;
  }
  if (screen === "countdown" && assignment) {
    return <CountdownPreview assignment={assignment} onActive={() => setScreen("match")} />;
  }
  if (screen === "leaderboard") return <LeaderboardPreview onBack={() => setScreen("home")} />;
  if (screen === "match" && assignment) return <MatchPreview assignment={assignment} onExit={() => setScreen("home")} />;

  return <HomePreview profile={PREVIEW_PROFILE} onStart={() => setScreen("matchmaking")} onLeaderboard={() => setScreen("leaderboard")} onSignOut={() => setScreen("auth")} />;
}
