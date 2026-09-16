PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  login_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  rating INTEGER NOT NULL DEFAULT 1200,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  draws INTEGER NOT NULL DEFAULT 0,
  fixed_aircraft_id TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  CHECK (rating >= 0),
  CHECK (wins >= 0),
  CHECK (losses >= 0),
  CHECK (draws >= 0)
);

CREATE TABLE IF NOT EXISTS sessions (
  session_token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_users_rating
  ON users (rating DESC, user_id ASC);

CREATE INDEX IF NOT EXISTS idx_sessions_user
  ON sessions (user_id);

CREATE INDEX IF NOT EXISTS idx_sessions_expiry
  ON sessions (expires_at_ms);
