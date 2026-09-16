import { useEffect, useRef, useState } from "react";
import { actionModuleById } from "../../shared/action-modules";
import { aircraftById } from "../../shared/aircraft";
import type { LeaderboardProfile, PublicUserProfile } from "../../shared/auth";
import type { MatchFoundAssignment } from "../../shared/matchmaking";
import {
  MATCH_RULES,
  type MatchResult,
  type MatchResultReason,
  type ProductScreen,
} from "../../shared/product";
import { FlightRuntime } from "../FlightRuntime";
import { loadLeaderboard, useAccount } from "./useAccount";
import { useMatchmaking } from "./useMatchmaking";
import { useRankedMatch } from "./useRankedMatch";

type ProductMatchOutcome = Readonly<{
  result: MatchResult;
  reason: MatchResultReason;
  localHeartPoints: number;
  peerHeartPoints: number;
}>;

function Brand() {
  return <div className="product-brand"><span>CAS FLIGHT SIMULATOR</span><strong>ARCADE AIRSPACE</strong></div>;
}

function LoadingScreen() {
  return <div className="product-screen product-screen--matchmaking"><div className="product-grid" aria-hidden="true" /><Brand /><section className="queue-card"><div className="queue-orbit" aria-hidden="true"><span /></div><p className="product-eyebrow">ACCOUNT SESSION</p><h1>Loading pilot</h1></section></div>;
}

function AuthLive({ account }: Readonly<{ account: ReturnType<typeof useAccount> }>) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [loginId, setLoginId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const busy = account.status === "submitting";

  const submit = async () => {
    if (mode === "login") await account.login(loginId, password);
    else await account.register(loginId, displayName, password);
  };

  return (
    <div className="product-screen product-screen--auth">
      <div className="product-grid" aria-hidden="true" /><Brand />
      <section className="auth-card" aria-label="Account access">
        <p className="product-eyebrow">C4D ACCOUNT // LIVE</p>
        <h1>{mode === "login" ? "Welcome back" : "Create pilot ID"}</h1>
        <p className="product-copy">{mode === "login" ? "Sign in to load your rating, record, and fixed-aircraft state." : "Create one pilot account. Passwords are stored only as derived hashes."}</p>
        <div className="segmented-control" role="tablist" aria-label="Authentication mode">
          <button className={mode === "login" ? "is-active" : ""} onClick={() => setMode("login")}>LOGIN</button>
          <button className={mode === "register" ? "is-active" : ""} onClick={() => setMode("register")}>REGISTER</button>
        </div>
        <label className="product-field"><span>USER ID</span><input value={loginId} onChange={(event) => setLoginId(event.target.value)} autoComplete="username" placeholder="pilot-id" /></label>
        {mode === "register" && <label className="product-field"><span>DISPLAY NAME</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="nickname" placeholder="display name" /></label>}
        <label className="product-field"><span>PASSWORD</span><input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} placeholder="10+ characters" onKeyDown={(event) => { if (event.key === "Enter" && !busy) void submit(); }} /></label>
        <button className="product-primary" disabled={busy} onClick={() => void submit()}>{busy ? "PLEASE WAIT" : mode === "login" ? "LOGIN" : "CREATE ACCOUNT"}</button>
        {account.errorMessage && <p className="preview-note" role="alert">{account.errorMessage}</p>}
      </section>
    </div>
  );
}

function HomeLive({ profile, account, onStart, onLeaderboard }: Readonly<{
  profile: PublicUserProfile;
  account: ReturnType<typeof useAccount>;
  onStart: () => void;
  onLeaderboard: () => void;
}>) {
  const fixed = profile.fixedAircraftId ? aircraftById(profile.fixedAircraftId) : null;
  const fixable = profile.fixableAircraftId ? aircraftById(profile.fixableAircraftId) : null;
  return (
    <div className="product-screen product-screen--home">
      <div className="product-grid" aria-hidden="true" />
      <header className="home-topbar"><Brand /><div className="pilot-chip"><span>{profile.displayName}</span><strong>{profile.rating}</strong><button onClick={() => void account.logout()}>SIGN OUT</button></div></header>
      <main className="home-layout">
        <section className="home-hero">
          <p className="product-eyebrow">RANKED // 1V1</p><h1>Own the airspace.</h1>
          <p className="product-copy">Match with one opponent, receive a fictional sidegrade aircraft, and compete over a continuous 100 Heart Point match.</p>
          <button className="start-button" onClick={onStart}><span>START</span><small>BEGIN MATCHMAKING</small></button>
          {account.errorMessage && <p className="preview-note" role="alert">{account.errorMessage}</p>}
        </section>
        <section className="home-cards" aria-label="Pilot summary">
          <article className="summary-card summary-card--rating"><span>RATING</span><strong>{profile.rating}</strong><small>{profile.wins}W / {profile.losses}L / {profile.draws}D</small></article>
          <article className="summary-card">
            <span>FIXED AIRCRAFT</span><strong>{fixed?.displayName ?? "RANDOM"}</strong><small>{fixed ? "PERSISTENT" : "ASSIGNED EACH MATCH"}</small>
            {fixed && <button className="product-secondary" onClick={() => void account.setFixedAircraft(null)}>RETURN TO RANDOM</button>}
            {!fixed && fixable && <button className="product-secondary" onClick={() => void account.setFixedAircraft(fixable.aircraftId)}>FIX {fixable.displayName.toUpperCase()}</button>}
          </article>
          <button className="summary-card summary-card--button" onClick={onLeaderboard}><span>LEADERBOARD</span><strong>VIEW</strong><small>RANKINGS & RECORDS</small></button>
        </section>
      </main>
      <footer className="product-footer">C4D LIVE ACCOUNT SESSION // RATING LEDGER FOUNDATION</footer>
    </div>
  );
}

function MatchmakingLive({ fixedAircraftId, onMatched, onCancel }: Readonly<{
  fixedAircraftId: string | null;
  onMatched: (assignment: MatchFoundAssignment) => void;
  onCancel: () => void;
}>) {
  const matchmaking = useMatchmaking();
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  useEffect(() => { matchmaking.enqueue(fixedAircraftId); return matchmaking.cancel; }, [fixedAircraftId, matchmaking.enqueue, matchmaking.cancel]);
  useEffect(() => { if (matchmaking.assignment) onMatched(matchmaking.assignment); }, [matchmaking.assignment, onMatched]);
  useEffect(() => {
    if (matchmaking.queuedAtMs === null) { setElapsedSeconds(0); return; }
    const update = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - matchmaking.queuedAtMs!) / 1_000)));
    update(); const timer = window.setInterval(update, 250); return () => window.clearInterval(timer);
  }, [matchmaking.queuedAtMs]);
  return (
    <div className="product-screen product-screen--matchmaking"><div className="product-grid" aria-hidden="true" /><Brand />
      <section className="queue-card"><div className="queue-orbit" aria-hidden="true"><span /></div><p className="product-eyebrow">MATCHMAKING // LIVE</p><h1>{matchmaking.status === "connecting" ? "Connecting to queue" : "Searching for opponent"}</h1>
        <div className="queue-meta"><span>RATED 1V1</span><span>{fixedAircraftId ? "FIXED AIRCRAFT" : "RANDOM AIRCRAFT"}</span><span>{String(Math.floor(elapsedSeconds / 60)).padStart(2, "0")}:{String(elapsedSeconds % 60).padStart(2, "0")}</span></div>
        {matchmaking.status === "error" && <p className="preview-note">{matchmaking.errorMessage}</p>}<button className="product-secondary" onClick={() => { matchmaking.cancel(); onCancel(); }}>CANCEL</button>
      </section>
    </div>
  );
}

function AssignmentLive({ assignment, onCountdown }: Readonly<{ assignment: MatchFoundAssignment; onCountdown: () => void }>) {
  const aircraft = aircraftById(assignment.aircraftId); const peerAircraft = aircraftById(assignment.peerAircraftId);
  useEffect(() => { const timer = window.setTimeout(onCountdown, Math.max(0, assignment.assignmentEndsAtMs - Date.now())); return () => window.clearTimeout(timer); }, [assignment.assignmentEndsAtMs, onCountdown]);
  return <div className="product-screen product-screen--assignment"><div className="product-grid" aria-hidden="true" /><Brand /><section className="assignment-card"><p className="product-eyebrow">MATCH FOUND // AIRCRAFT ASSIGNMENT</p><div className="aircraft-silhouette" aria-hidden="true"><span /></div><h1>{aircraft?.displayName ?? assignment.aircraftId}</h1><p className="product-copy">Opponent profile: {peerAircraft?.displayName ?? assignment.peerAircraftId}. Spawn side: {assignment.spawnSide.toUpperCase()}.</p><dl className="spec-strip"><div><dt>SPEED</dt><dd>{aircraft ? `${aircraft.minimumSpeedMps}–${aircraft.maximumSpeedMps}` : "—"}</dd></div><div><dt>PITCH</dt><dd>{aircraft?.pitchAccelerationDegS2 ?? "—"}</dd></div><div><dt>ROLL</dt><dd>{aircraft?.rollAccelerationDegS2 ?? "—"}</dd></div><div><dt>ACTION</dt><dd>{aircraft?.actionModuleId.toUpperCase() ?? "—"}</dd></div></dl></section></div>;
}

function CountdownLive({ assignment, onActive }: Readonly<{ assignment: MatchFoundAssignment; onActive: () => void }>) {
  const [remainingMs, setRemainingMs] = useState(() => Math.max(0, assignment.activeAtMs - Date.now()));
  useEffect(() => { const update = () => { const next = Math.max(0, assignment.activeAtMs - Date.now()); setRemainingMs(next); if (next === 0) onActive(); }; update(); const timer = window.setInterval(update, 100); return () => window.clearInterval(timer); }, [assignment.activeAtMs, onActive]);
  return <div className="product-screen product-screen--matchmaking"><div className="product-grid" aria-hidden="true" /><Brand /><section className="queue-card"><p className="product-eyebrow">MATCH {assignment.matchId.slice(0, 8).toUpperCase()}</p><h1>{Math.max(1, Math.ceil(remainingMs / 1_000))}</h1><p className="product-copy">Room {assignment.roomCode} // synchronized start</p><div className="queue-meta"><span>100 HP</span><span>04:00</span><span>{assignment.spawnSide.toUpperCase()} SIDE</span></div></section></div>;
}

function formatClock(milliseconds: number) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function resultFromWinner(localSlot: 1 | 2, winnerSlot: 1 | 2 | null, reason: MatchResultReason): MatchResult {
  if (reason === "infrastructure-failure") return "no-contest"; if (winnerSlot === null) return "draw"; return winnerSlot === localSlot ? "win" : "loss";
}

function actionFeedbackLabel(code: string | undefined) {
  if (!code) return "SPACE TO ACTIVATE";
  if (code === "accepted") return "ACTION ACCEPTED";
  if (code === "cooldown") return "COOLDOWN ACTIVE";
  if (code === "outside_interaction") return "OUTSIDE INTERACTION RANGE";
  if (code === "pose_stale") return "POSITION SYNCING";
  if (code === "peer_unavailable") return "PEER UNAVAILABLE";
  if (code === "not_active") return "MATCH NOT ACTIVE";
  return code.toUpperCase();
}

function MatchLive({ assignment, onResolved }: Readonly<{ assignment: MatchFoundAssignment; onResolved: (outcome: ProductMatchOutcome) => void }>) {
  const ranked = useRankedMatch(assignment); const aircraft = aircraftById(assignment.aircraftId); const actionModule = aircraft ? actionModuleById(aircraft.actionModuleId) : null;
  const [clockNowMs, setClockNowMs] = useState(Date.now()); const resolvedRef = useRef(false);
  useEffect(() => { const timer = window.setInterval(() => setClockNowMs(Date.now()), 100); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    const handle = (event: KeyboardEvent) => { if (event.code !== "Space" || event.repeat) return; const target = event.target; if (target instanceof HTMLInputElement || target instanceof HTMLButtonElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable)) return; event.preventDefault(); ranked.activateAction(); };
    window.addEventListener("keydown", handle, { passive: false }); return () => window.removeEventListener("keydown", handle);
  }, [ranked.activateAction]);
  const state = ranked.matchState; const local = ranked.slot && state ? state.participants[ranked.slot - 1] : null; const peer = ranked.slot && state ? state.participants[ranked.slot === 1 ? 1 : 0] : null;
  const localHp = local?.heartPoints ?? MATCH_RULES.startingHeartPoints; const peerHp = peer?.heartPoints ?? MATCH_RULES.startingHeartPoints; const serverNow = clockNowMs + ranked.serverTimeOffsetMs;
  useEffect(() => { if (!state?.result || !ranked.slot || resolvedRef.current) return; resolvedRef.current = true; onResolved({ result: resultFromWinner(ranked.slot, state.result.winnerSlot, state.result.reason), reason: state.result.reason, localHeartPoints: localHp, peerHeartPoints: peerHp }); }, [state?.result, ranked.slot, localHp, peerHp, onResolved]);
  const phase = state?.phase ?? "countdown"; const remaining = state ? phase === "overtime" ? state.overtimeEndsAtMs - serverNow : phase === "active" ? state.regulationEndsAtMs - serverNow : Math.max(0, state.activeAtMs - serverNow) : MATCH_RULES.regulationSeconds * 1_000;
  const cooldown = local ? Math.max(0, local.nextActionAtMs - serverNow) : 0; const actionReady = (phase === "active" || phase === "overtime") && cooldown === 0 && ranked.peerConnected; const actionStatus = actionReady ? "READY" : cooldown > 0 ? `${(cooldown / 1_000).toFixed(1)}S` : ranked.status === "connecting" ? "SYNCING" : "STANDBY"; const stagingSlot = assignment.spawnSide === "left" ? 1 : 2;
  return <div className="product-match-shell"><FlightRuntime showDevelopmentPanels={false} externalNetworkController={ranked} stagingSlot={stagingSlot} /><div className="c4-match-hud"><div className="match-hud__top"><div className="hp-block hp-block--local"><span>YOU // {aircraft?.displayName ?? assignment.aircraftId}</span><strong>{localHp}</strong><div><i style={{ width: `${localHp}%` }} /></div></div><div className="match-clock"><span>{phase === "overtime" ? "OVERTIME" : phase === "active" ? "REGULATION" : "SYNCING"}</span><strong>{formatClock(remaining)}</strong><small>{assignment.roomCode}</small></div><div className="hp-block hp-block--peer"><span>PEER</span><strong>{peerHp}</strong><div><i style={{ width: `${peerHp}%` }} /></div></div></div><div className="match-action-state"><span>ACTION // {actionModule?.displayName ?? "ABSTRACT MODULE"}</span><strong>{actionStatus}</strong><small>{actionFeedbackLabel(ranked.lastActionFeedback?.code)}</small></div><button className="match-exit-preview" onClick={ranked.leaveMatch} disabled={Boolean(state?.result)}>FORFEIT MATCH</button></div></div>;
}

function ResultLive({ outcome, onHome }: Readonly<{ outcome: ProductMatchOutcome; onHome: () => void }>) {
  return <div className="product-screen product-screen--matchmaking"><div className="product-grid" aria-hidden="true" /><Brand /><section className="queue-card"><p className="product-eyebrow">MATCH COMPLETE</p><h1>{outcome.result.toUpperCase()}</h1><p className="product-copy">{outcome.reason.replaceAll("-", " ").toUpperCase()} // HP {outcome.localHeartPoints}–{outcome.peerHeartPoints}</p><button className="product-primary" onClick={onHome}>RETURN HOME</button></section></div>;
}

function LeaderboardLive({ entries, onBack }: Readonly<{ entries: readonly LeaderboardProfile[]; onBack: () => void }>) {
  return <div className="product-screen product-screen--leaderboard"><div className="product-grid" aria-hidden="true" /><header className="home-topbar"><Brand /><button className="product-secondary" onClick={onBack}>BACK HOME</button></header><main className="leaderboard-card"><p className="product-eyebrow">GLOBAL RANKING</p><h1>Leaderboard</h1><div className="leaderboard-head"><span>RANK</span><span>PILOT</span><span>RATING</span><span>W/L/D</span></div>{entries.map((entry) => <div className="leaderboard-row" key={entry.userId}><strong>#{entry.rank}</strong><span>{entry.displayName}</span><strong>{entry.rating}</strong><span>{entry.wins}/{entry.losses}/{entry.draws}</span></div>)}{entries.length === 0 && <p className="preview-note">No ranked pilots yet.</p>}</main></div>;
}

export function ProductLive() {
  const account = useAccount(); const [screen, setScreen] = useState<ProductScreen>("home"); const [assignment, setAssignment] = useState<MatchFoundAssignment | null>(null); const [outcome, setOutcome] = useState<ProductMatchOutcome | null>(null); const [leaderboard, setLeaderboard] = useState<readonly LeaderboardProfile[]>([]);
  if (account.status === "loading") return <LoadingScreen />;
  if (!account.user) return <AuthLive account={account} />;
  const profile = account.user;
  if (screen === "home") return <HomeLive profile={profile} account={account} onStart={() => { setAssignment(null); setOutcome(null); setScreen("matchmaking"); }} onLeaderboard={() => { void loadLeaderboard().then((entries) => { setLeaderboard(entries); setScreen("leaderboard"); }); }} />;
  if (screen === "matchmaking") return <MatchmakingLive fixedAircraftId={profile.fixedAircraftId} onMatched={(next) => { setAssignment(next); setScreen("aircraft-assignment"); }} onCancel={() => setScreen("home")} />;
  if (screen === "aircraft-assignment" && assignment) return <AssignmentLive assignment={assignment} onCountdown={() => setScreen("countdown")} />;
  if (screen === "countdown" && assignment) return <CountdownLive assignment={assignment} onActive={() => setScreen("match")} />;
  if (screen === "match" && assignment) return <MatchLive assignment={assignment} onResolved={(next) => { setOutcome(next); setScreen("result"); }} />;
  if (screen === "result" && outcome) return <ResultLive outcome={outcome} onHome={() => { void account.refresh(); setScreen("home"); }} />;
  if (screen === "leaderboard") return <LeaderboardLive entries={leaderboard} onBack={() => setScreen("home")} />;
  return <HomeLive profile={profile} account={account} onStart={() => setScreen("matchmaking")} onLeaderboard={() => setScreen("leaderboard")} />;
}
