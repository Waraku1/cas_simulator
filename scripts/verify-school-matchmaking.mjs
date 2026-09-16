const baseUrl = process.env.SCHOOL_URL ?? "http://127.0.0.1:5173";
const wsUrl = `${baseUrl.replace(/^http/, "ws")}/api/matchmaking/ws`;
const AIRCRAFT_IDS = new Set(["orbit-a1", "strata-b2", "kite-c3"]);

function connect(label) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    const messages = [];
    const timeout = setTimeout(() => reject(new Error(`${label} matchmaking timeout`)), 6_000);

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ type: "enqueue", fixedAircraftId: null }));
    });
    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      const value = JSON.parse(event.data);
      messages.push(value);
      if (value.type === "match_found") {
        clearTimeout(timeout);
        resolve({ socket, messages, assignment: value.assignment });
      }
    });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error(`${label} matchmaking websocket error`));
    });
  });
}

const [client1, client2] = await Promise.all([connect("client1"), connect("client2")]);
const a = client1.assignment;
const b = client2.assignment;

if (!client1.messages.some((message) => message.type === "queued")) throw new Error("client1 never entered queue");
if (!client2.messages.some((message) => message.type === "queued")) throw new Error("client2 never entered queue");
if (a.matchId !== b.matchId) throw new Error("match ids differ");
if (a.roomCode !== b.roomCode) throw new Error("room codes differ");
if (typeof a.joinToken !== "string" || a.joinToken.length < 16) throw new Error("client1 missing join token");
if (typeof b.joinToken !== "string" || b.joinToken.length < 16) throw new Error("client2 missing join token");
if (a.joinToken === b.joinToken) throw new Error("join tokens must be participant-specific");
if (a.spawnSide === b.spawnSide) throw new Error("spawn sides are not opposite");
if (!AIRCRAFT_IDS.has(a.aircraftId) || !AIRCRAFT_IDS.has(b.aircraftId)) throw new Error("invalid assigned aircraft");
if (a.peerAircraftId !== b.aircraftId || b.peerAircraftId !== a.aircraftId) throw new Error("peer aircraft assignment mismatch");
if (!(a.activeAtMs > a.assignmentEndsAtMs)) throw new Error("invalid client1 countdown timing");
if (!(b.activeAtMs > b.assignmentEndsAtMs)) throw new Error("invalid client2 countdown timing");

client1.socket.close(1000, "verification complete");
client2.socket.close(1000, "verification complete");

console.log(JSON.stringify({
  ok: true,
  gate: "C4B_SCHOOL_MATCHMAKING_SMOKE",
  matchId: a.matchId,
  roomCode: a.roomCode,
  aircraft: [a.aircraftId, b.aircraftId],
  spawnSides: [a.spawnSide, b.spawnSide],
  participantTokens: 2,
}, null, 2));
