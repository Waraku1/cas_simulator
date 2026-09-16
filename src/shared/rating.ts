export const RATING_RULES = Object.freeze({
  initialRating: 1200,
  kFactor: 32,
  scale: 400,
  minimumRating: 0,
  leaderboardLimit: 50,
});

export type RatedOutcome = "win" | "loss" | "draw";

export type RatingPairResult = Readonly<{
  firstBefore: number;
  secondBefore: number;
  firstAfter: number;
  secondAfter: number;
  firstDelta: number;
  secondDelta: number;
}>;

function scoreFor(outcome: RatedOutcome) {
  if (outcome === "win") return 1;
  if (outcome === "loss") return 0;
  return 0.5;
}

function expectedScore(rating: number, opponentRating: number) {
  return 1 / (1 + 10 ** ((opponentRating - rating) / RATING_RULES.scale));
}

function clampRating(value: number) {
  return Math.max(RATING_RULES.minimumRating, Math.round(value));
}

export function calculateRatingPair(
  firstRating: number,
  secondRating: number,
  firstOutcome: RatedOutcome,
): RatingPairResult {
  const firstScore = scoreFor(firstOutcome);
  const secondScore = 1 - firstScore;
  const firstExpected = expectedScore(firstRating, secondRating);
  const secondExpected = expectedScore(secondRating, firstRating);
  const firstAfter = clampRating(firstRating + RATING_RULES.kFactor * (firstScore - firstExpected));
  const secondAfter = clampRating(secondRating + RATING_RULES.kFactor * (secondScore - secondExpected));

  return {
    firstBefore: firstRating,
    secondBefore: secondRating,
    firstAfter,
    secondAfter,
    firstDelta: firstAfter - firstRating,
    secondDelta: secondAfter - secondRating,
  };
}
