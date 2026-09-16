PRAGMA foreign_keys = ON;

ALTER TABLE users ADD COLUMN fixable_aircraft_id TEXT;

CREATE TABLE IF NOT EXISTS rated_matches (
  match_id TEXT PRIMARY KEY,
  first_user_id TEXT NOT NULL,
  second_user_id TEXT NOT NULL,
  first_outcome TEXT NOT NULL,
  reason TEXT NOT NULL,
  first_rating_before INTEGER NOT NULL,
  first_rating_after INTEGER NOT NULL,
  second_rating_before INTEGER NOT NULL,
  second_rating_after INTEGER NOT NULL,
  completed_at_ms INTEGER NOT NULL,
  applied INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (first_user_id) REFERENCES users(user_id),
  FOREIGN KEY (second_user_id) REFERENCES users(user_id),
  CHECK (first_outcome IN ('win', 'loss', 'draw')),
  CHECK (applied IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_rated_matches_first_user
  ON rated_matches (first_user_id, completed_at_ms DESC);

CREATE INDEX IF NOT EXISTS idx_rated_matches_second_user
  ON rated_matches (second_user_id, completed_at_ms DESC);
