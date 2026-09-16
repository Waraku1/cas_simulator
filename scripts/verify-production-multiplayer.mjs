import { randomBytes } from "node:crypto";

const targetUrl = process.env.PRODUCTION_URL ?? process.env.SCHOOL_URL;
if (!targetUrl) throw new Error("PRODUCTION_URL or SCHOOL_URL is required");
if (typeof WebSocket !== "function") throw new Error("Global WebSocket is unavailable in this Node runtime");

const gate = process.env.PRODUCTION_URL
  ? "C3_MULTIPLAYER_SMOKE"
  : "SCHOOL_LOCAL_MULTIPLAYER_SMOKE";

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const random = randomBytes(6);
let roomCode = "";
for (const byte of random) roomCode += alphabet[byte % alphabet.length];

const wsBase = targetUrl.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
const roomUrl = `${wsBase}/api/rooms/${roomCode}/ws`;
const timeoutMs = 8_000;

function makeClient(label) {
  const socket = new WebSocket(roomUrl);
  const queue = [];
  const waiters = [];

  const settle = (message) => {
    const index = waiters.findIndex(({ predicate }) => predicate(message));
    if (index >= 0) {
      const [{ resolve, timer }] = waiters.splice(index, 1);
      clearTimeout(timer);
      resolve(message);
      return;
    }
    queue.push(message);
  };

  socket.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return;
    settle(JSON.parse(event.data));
  });

  const opened = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} open timeout`)), timeoutMs);
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error(`${label} WebSocket error before open`));
    }, { once: true });
  });

  const waitFor = (predicate, description) => {
    const queuedIndex = queue.findIndex(predicate);
    if (queuedIndex >= 0) return Promise.resolve(queue.splice(queuedIndex, 1)[0]);

    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, timer: null };
      waiter.timer = setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) waiters.splice(index, 1);
        reject(new Error(`${label} timeout waiting for ${description}`));
      }, timeoutMs);
      waiters.push(waiter);
    });
  };

  return { socket, opened, waitFor };
}

const client1 = makeClient("client1");
await client1.opened;
const welcome1 = await client1.waitFor((m) => m?.type === "welcome", "welcome");
if (welcome1.roomCode !== roomCode || welcome1.slot !== 1) {
  throw new Error(`Unexpected client1 welcome: ${JSON.stringify(welcome1)}`);
}

const client2 = makeClient("client2");
await client2.opened;
const welcome2 = await client2.waitFor((m) => m?.type === "welcome", "welcome");
if (welcome2.roomCode !== roomCode || welcome2.slot !== 2) {
  throw new Error(`Unexpected client2 welcome: ${JSON.stringify(welcome2)}`);
}

await client1.waitFor(
  (m) => m?.type === "presence" && m.peerConnected === true && m.playerCount === 2,
  "two-player presence",
);
await client2.waitFor(
  (m) => m?.type === "presence" && m.peerConnected === true && m.playerCount === 2,
  "two-player presence",
);

const pose = {
  type: "pose",
  pose: {
    latitudeDeg: 35.3606,
    longitudeDeg: 138.7274,
    altitudeM: 5400,
    orientation: { w: 1, x: 0, y: 0, z: 0 },
    sequence: 1,
    clientTimeMs: 1,
  },
};
client1.socket.send(JSON.stringify(pose));

const relayed = await client2.waitFor(
  (m) => m?.type === "peer_pose" && m.pose?.sequence === 1,
  "peer pose relay",
);
if (relayed.playerId !== welcome1.playerId) {
  throw new Error("Relayed player identity does not match client1");
}
if (relayed.pose.altitudeM !== pose.pose.altitudeM) {
  throw new Error("Relayed pose payload changed unexpectedly");
}

client1.socket.close(1000, "smoke complete");
client2.socket.close(1000, "smoke complete");

console.log(JSON.stringify({
  ok: true,
  gate,
  roomCode,
  players: 2,
  relaySequence: relayed.pose.sequence,
}, null, 2));
