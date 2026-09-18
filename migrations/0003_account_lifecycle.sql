PRAGMA foreign_keys = ON;

ALTER TABLE users ADD COLUMN deleted_at_ms INTEGER;

CREATE INDEX IF NOT EXISTS idx_users_deleted_at
  ON users (deleted_at_ms);

CREATE INDEX IF NOT EXISTS idx_users_leaderboard_active
  ON users (deleted_at_ms, rating DESC, wins DESC, user_id ASC);
