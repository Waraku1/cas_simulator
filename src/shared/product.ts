export const MATCH_RULES = Object.freeze({
  startingHeartPoints: 100,
  regulationSeconds: 4 * 60,
  overtimeSeconds: 60,
  disconnectGraceSeconds: 20,
});

export type ProductScreen =
  | "auth"
  | "home"
  | "matchmaking"
  | "aircraft-assignment"
  | "countdown"
  | "match"
  | "result"
  | "leaderboard";

export type MatchPhase =
  | "waiting"
  | "aircraft-assignment"
  | "countdown"
  | "active"
  | "overtime"
  | "completed"
  | "no-contest";

export type MatchResult = "win" | "loss" | "draw" | "no-contest";

export type MatchResultReason =
  | "heart-points-depleted"
  | "regulation-heart-points"
  | "overtime-heart-points"
  | "overtime-draw"
  | "forfeit"
  | "infrastructure-failure";

export type PlayerProfile = Readonly<{
  userId: string;
  displayName: string;
  rating: number;
  wins: number;
  losses: number;
  draws: number;
  fixedAircraftId: string | null;
}>;

export type ActionModuleSpec = Readonly<{
  actionModuleId: string;
  displayName: string;
  heartPointEffect: number;
  cooldownMs: number;
  activationRadiusM: number;
  activationProfile: "close" | "balanced" | "precision";
}>;

export type AircraftSpec = Readonly<{
  aircraftId: string;
  displayName: string;
  minimumSpeedMps: number;
  maximumSpeedMps: number;
  pitchAccelerationDegS2: number;
  rollAccelerationDegS2: number;
  visualScale: number;
  appearanceKey: string;
  actionModuleId: string;
}>;

export type MatchParticipantState = Readonly<{
  playerId: string;
  aircraftId: string;
  heartPoints: number;
  connected: boolean;
}>;

export type RatedMatchState = Readonly<{
  matchId: string;
  phase: MatchPhase;
  regulationRemainingMs: number;
  overtimeRemainingMs: number;
  participants: readonly [MatchParticipantState, MatchParticipantState];
  result: MatchResult | null;
  resultReason: MatchResultReason | null;
}>;

export type LeaderboardEntry = Readonly<{
  rank: number;
  userId: string;
  displayName: string;
  rating: number;
  wins: number;
  losses: number;
  draws: number;
}>;

export const clampHeartPoints = (value: number) =>
  Math.min(MATCH_RULES.startingHeartPoints, Math.max(0, Math.round(value)));
