export type StoredUser = Readonly<{
  userId: string;
  loginId: string;
  displayName: string;
  passwordHash: string;
  passwordSalt: string;
  passwordIterations: number;
  rating: number;
  wins: number;
  losses: number;
  draws: number;
  fixedAircraftId: string | null;
  createdAtMs: number;
  updatedAtMs: number;
}>;

export type NewStoredUser = StoredUser;

export type StoredSession = Readonly<{
  sessionTokenHash: string;
  userId: string;
  createdAtMs: number;
  expiresAtMs: number;
}>;

export interface AuthRepository {
  findUserByLoginId(loginId: string): Promise<StoredUser | null>;
  findUserById(userId: string): Promise<StoredUser | null>;
  createUser(user: NewStoredUser): Promise<void>;
  createSession(session: StoredSession): Promise<void>;
  findUserBySessionHash(sessionTokenHash: string, nowMs: number): Promise<StoredUser | null>;
  deleteSession(sessionTokenHash: string): Promise<void>;
  deleteExpiredSessions(nowMs: number): Promise<void>;
}

interface D1ResultLike {
  success: boolean;
}

interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  first<T>(): Promise<T | null>;
  run(): Promise<D1ResultLike>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
}

type UserRow = Readonly<{
  user_id: string;
  login_id: string;
  display_name: string;
  password_hash: string;
  password_salt: string;
  password_iterations: number;
  rating: number;
  wins: number;
  losses: number;
  draws: number;
  fixed_aircraft_id: string | null;
  created_at_ms: number;
  updated_at_ms: number;
}>;

function toStoredUser(row: UserRow): StoredUser {
  return {
    userId: row.user_id,
    loginId: row.login_id,
    displayName: row.display_name,
    passwordHash: row.password_hash,
    passwordSalt: row.password_salt,
    passwordIterations: row.password_iterations,
    rating: row.rating,
    wins: row.wins,
    losses: row.losses,
    draws: row.draws,
    fixedAircraftId: row.fixed_aircraft_id,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
  };
}

const USER_COLUMNS = `
  user_id, login_id, display_name, password_hash, password_salt,
  password_iterations, rating, wins, losses, draws, fixed_aircraft_id,
  created_at_ms, updated_at_ms
`;

export class D1AuthRepository implements AuthRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async findUserByLoginId(loginId: string) {
    const row = await this.db
      .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE login_id = ? LIMIT 1`)
      .bind(loginId)
      .first<UserRow>();
    return row ? toStoredUser(row) : null;
  }

  async findUserById(userId: string) {
    const row = await this.db
      .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE user_id = ? LIMIT 1`)
      .bind(userId)
      .first<UserRow>();
    return row ? toStoredUser(row) : null;
  }

  async createUser(user: NewStoredUser) {
    const result = await this.db.prepare(`
      INSERT INTO users (
        user_id, login_id, display_name, password_hash, password_salt,
        password_iterations, rating, wins, losses, draws, fixed_aircraft_id,
        created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      user.userId,
      user.loginId,
      user.displayName,
      user.passwordHash,
      user.passwordSalt,
      user.passwordIterations,
      user.rating,
      user.wins,
      user.losses,
      user.draws,
      user.fixedAircraftId,
      user.createdAtMs,
      user.updatedAtMs,
    ).run();
    if (!result.success) throw new Error("D1 user insert failed.");
  }

  async createSession(session: StoredSession) {
    const result = await this.db.prepare(`
      INSERT INTO sessions (session_token_hash, user_id, created_at_ms, expires_at_ms)
      VALUES (?, ?, ?, ?)
    `).bind(
      session.sessionTokenHash,
      session.userId,
      session.createdAtMs,
      session.expiresAtMs,
    ).run();
    if (!result.success) throw new Error("D1 session insert failed.");
  }

  async findUserBySessionHash(sessionTokenHash: string, nowMs: number) {
    const row = await this.db.prepare(`
      SELECT ${USER_COLUMNS.replace(/\b(user_id|login_id|display_name|password_hash|password_salt|password_iterations|rating|wins|losses|draws|fixed_aircraft_id|created_at_ms|updated_at_ms)\b/g, "u.$1")}
      FROM sessions s
      JOIN users u ON u.user_id = s.user_id
      WHERE s.session_token_hash = ? AND s.expires_at_ms > ?
      LIMIT 1
    `).bind(sessionTokenHash, nowMs).first<UserRow>();
    return row ? toStoredUser(row) : null;
  }

  async deleteSession(sessionTokenHash: string) {
    await this.db
      .prepare("DELETE FROM sessions WHERE session_token_hash = ?")
      .bind(sessionTokenHash)
      .run();
  }

  async deleteExpiredSessions(nowMs: number) {
    await this.db
      .prepare("DELETE FROM sessions WHERE expires_at_ms <= ?")
      .bind(nowMs)
      .run();
  }
}
