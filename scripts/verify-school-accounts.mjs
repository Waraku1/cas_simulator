const base = process.env.SCHOOL_URL ?? "http://127.0.0.1:5173";
const suffix = Math.random().toString(36).slice(2, 8);
const loginId = `pilot_${suffix}`;
const password = `school-${suffix}-pass`;
const displayName = `Pilot ${suffix}`;

async function request(path, options = {}, cookie = "") {
  const headers = new Headers(options.headers ?? {});
  if (options.body) headers.set("content-type", "application/json");
  if (cookie) headers.set("cookie", cookie);
  const response = await fetch(`${base}${path}`, { ...options, headers });
  let body;
  try { body = await response.json(); } catch { body = null; }
  return { response, body, setCookie: response.headers.get("set-cookie") ?? "" };
}

function sessionCookie(setCookie) {
  return setCookie.split(";")[0];
}

const registration = await request("/api/auth/register", {
  method: "POST",
  body: JSON.stringify({ loginId, displayName, password }),
});
if (!registration.response.ok || !registration.body?.ok || registration.body.user.rating !== 1200) {
  throw new Error(`Registration failed: ${JSON.stringify(registration.body)}`);
}
const cookie = sessionCookie(registration.setCookie);
if (!cookie.startsWith("cas_session=")) throw new Error("Registration did not issue a session cookie.");

const session = await request("/api/auth/session", {}, cookie);
if (!session.response.ok || session.body?.user?.loginId !== loginId) {
  throw new Error(`Session lookup failed: ${JSON.stringify(session.body)}`);
}

const duplicate = await request("/api/auth/register", {
  method: "POST",
  body: JSON.stringify({ loginId, displayName: "Duplicate", password }),
});
if (duplicate.response.status !== 409 || duplicate.body?.code !== "LOGIN_ID_TAKEN") {
  throw new Error("Duplicate login ID was not rejected.");
}

const badLogin = await request("/api/auth/login", {
  method: "POST",
  body: JSON.stringify({ loginId, password: `${password}-wrong` }),
});
if (badLogin.response.status !== 401 || badLogin.body?.code !== "INVALID_CREDENTIALS") {
  throw new Error("Invalid password was not rejected.");
}

const leaderboard = await request("/api/leaderboard");
if (!leaderboard.response.ok || !leaderboard.body?.entries?.some((entry) => entry.userId === registration.body.user.userId)) {
  throw new Error("Registered user was missing from leaderboard.");
}

const logout = await request("/api/auth/logout", { method: "POST" }, cookie);
if (!logout.response.ok) throw new Error("Logout failed.");
const afterLogout = await request("/api/auth/session", {}, cookie);
if (afterLogout.response.status !== 401 || afterLogout.body?.code !== "NOT_AUTHENTICATED") {
  throw new Error("Logged-out session remained valid.");
}

console.log(JSON.stringify({
  ok: true,
  gate: "C4D_SCHOOL_ACCOUNT_SMOKE",
  registered: loginId,
  initialRating: registration.body.user.rating,
  leaderboardVisible: true,
  logoutInvalidatedSession: true,
}, null, 2));
