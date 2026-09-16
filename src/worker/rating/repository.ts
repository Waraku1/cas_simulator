import { calculateRatingPair, type RatedOutcome } from "../../shared/rating";
import type { MatchResultReason } from "../../shared/product";
import type { D1DatabaseLike } from "../auth/repository";

export type ApplyRatedMatchInput = Readonly<{
  matchId: string;
  firstUserId: string;
  secondUserId: string;
  firstOutcome: RatedOutcome;
  reason: MatchResultReason;
  completedAtMs: number;
}>;

export type AppliedRatedMatch = Readonly<{
  applied: boolean;
  firstRatingBefore: number;
  firstRatingAfter: number;
  secondRatingBefore: number;
  secondRatingAfter: number;
}>;

type RatingRow = Readonly<{ rating: number }>;
type LedgerRow = Readonly<{
  first_rating_before: number;
  first_rating_after: number;
  second_rating_before: number;
  second_rating_after: number;
  applied: number;
}>;

export class D1RatingRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async applyMatch(input: ApplyRatedMatchInput): Promise<AppliedRatedMatch> {
    const existing = await this.db.prepare(`
      SELECT first_rating_before, first_rating_after, second_rating_before, second_rating_after, applied
      FROM rated_matches WHERE match_id = ? LIMIT 1
    `).bind(input.matchId).first<LedgerRow>();

    if (existing?.applied === 1) {
      return {
        applied: false,
        firstRatingBefore: existing.first_rating_before,
        firstRatingAfter: existing.first_rating_after,
        secondRatingBefore: existing.second_rating_before,
        secondRatingAfter: existing.second_rating_after,
      };
    }

    const first = await this.db.prepare("SELECT rating FROM users WHERE user_id = ? LIMIT 1")
      .bind(input.firstUserId)
      .first<RatingRow>();
    const second = await this.db.prepare("SELECT rating FROM users WHERE user_id = ? LIMIT 1")
      .bind(input.secondUserId)
      .first<RatingRow>();
    if (!first || !second) throw new Error("Rated match references an unknown user.");

    const calculated = calculateRatingPair(first.rating, second.rating, input.firstOutcome);
    const firstWin = input.firstOutcome === "win" ? 1 : 0;
    const firstLoss = input.firstOutcome === "loss" ? 1 : 0;
    const firstDraw = input.firstOutcome === "draw" ? 1 : 0;
    const secondWin = firstLoss;
    const secondLoss = firstWin;
    const secondDraw = firstDraw;

    if (!this.db.batch) throw new Error("D1 batch support is required for rating transactions.");
    const statements = [
      this.db.prepare(`
        INSERT OR IGNORE INTO rated_matches (
          match_id, first_user_id, second_user_id, first_outcome, reason,
          first_rating_before, first_rating_after, second_rating_before, second_rating_after,
          completed_at_ms, applied
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      `).bind(
        input.matchId,
        input.firstUserId,
        input.secondUserId,
        input.firstOutcome,
        input.reason,
        calculated.firstBefore,
        calculated.firstAfter,
        calculated.secondBefore,
        calculated.secondAfter,
        input.completedAtMs,
      ),
      this.db.prepare(`
        UPDATE users
        SET rating = ?, wins = wins + ?, losses = losses + ?, draws = draws + ?, updated_at_ms = ?
        WHERE user_id = ?
          AND EXISTS (SELECT 1 FROM rated_matches WHERE match_id = ? AND applied = 0)
      `).bind(
        calculated.firstAfter,
        firstWin,
        firstLoss,
        firstDraw,
        input.completedAtMs,
        input.firstUserId,
        input.matchId,
      ),
      this.db.prepare(`
        UPDATE users
        SET rating = ?, wins = wins + ?, losses = losses + ?, draws = draws + ?, updated_at_ms = ?
        WHERE user_id = ?
          AND EXISTS (SELECT 1 FROM rated_matches WHERE match_id = ? AND applied = 0)
      `).bind(
        calculated.secondAfter,
        secondWin,
        secondLoss,
        secondDraw,
        input.completedAtMs,
        input.secondUserId,
        input.matchId,
      ),
      this.db.prepare(`
        UPDATE rated_matches SET applied = 1 WHERE match_id = ? AND applied = 0
      `).bind(input.matchId),
    ];

    const results = await this.db.batch(statements);
    if (results.some((result) => !result.success)) throw new Error("D1 rating transaction failed.");

    return {
      applied: true,
      firstRatingBefore: calculated.firstBefore,
      firstRatingAfter: calculated.firstAfter,
      secondRatingBefore: calculated.secondBefore,
      secondRatingAfter: calculated.secondAfter,
    };
  }
}
