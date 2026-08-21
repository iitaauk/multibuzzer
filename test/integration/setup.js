// Shared harness for integration tests. Each test file boots its own real
// server instance on an OS-assigned free port (so files never collide, even
// running serially) and tears it down afterward via boardgame.io's own
// server.kill(). Every requester of src/server needs the rate limit raised
// *before* that module is first required, since it's read once at module
// load time - do that here, not in individual test files.
process.env.RATE_LIMIT_MAX = process.env.RATE_LIMIT_MAX || '100000';

const { Client } = require('boardgame.io/client');
const { SocketIO } = require('boardgame.io/multiplayer');
const { Buzzer } = require('../../src/lib/store');
// Jest's Node test environment doesn't expose the global `fetch` that a
// plain `node script.js` run would have - use an explicit implementation
// instead of relying on that. node-fetch@2.x specifically: v3+ is
// ESM-only and these are CommonJS test files.
const fetch = require('node-fetch');

async function startTestServer() {
  // Each call needs a fresh module instance (fresh CappedInMemory db,
  // fresh activeSockets map) so tests don't see each other's rooms.
  jest.resetModules();
  const serverModule = require('../../src/server');
  const servers = await serverModule.startServer(0);
  const port = servers.appServer.address().port;
  const baseUrl = `http://localhost:${port}`;

  return {
    port,
    baseUrl,
    server: serverModule.server,
    startRoomCleanupCron: serverModule.startRoomCleanupCron,
    roomLifetimes: serverModule.roomLifetimes,
    async close() {
      serverModule.server.kill(servers);
    },
  };
}

async function request(baseUrl, path, options = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    // no/invalid body
  }
  return { status: res.status, data };
}

function createRoom(baseUrl, numPlayers = 4) {
  return request(baseUrl, '/games/buzzer/create', {
    method: 'POST',
    body: JSON.stringify({ numPlayers }),
  });
}

function joinRoom(baseUrl, matchID, playerID, playerName) {
  return request(baseUrl, `/games/buzzer/${matchID}/join`, {
    method: 'POST',
    body: JSON.stringify({ playerID: String(playerID), playerName }),
  });
}

function reclaimRoom(baseUrl, matchID, playerID, playerName) {
  return request(baseUrl, `/games/buzzer/${matchID}/reclaim`, {
    method: 'POST',
    body: JSON.stringify({ playerID: String(playerID), playerName }),
  });
}

function leaveRoom(baseUrl, matchID, playerID, credentials) {
  return request(baseUrl, `/games/buzzer/${matchID}/leave`, {
    method: 'POST',
    body: JSON.stringify({ playerID: String(playerID), credentials }),
  });
}

function kickPlayer(baseUrl, matchID, playerID, hostPlayerID, credentials) {
  return request(baseUrl, `/games/buzzer/${matchID}/kick`, {
    method: 'POST',
    body: JSON.stringify({ playerID: String(playerID), hostPlayerID, credentials }),
  });
}

function getRoom(baseUrl, matchID) {
  return request(baseUrl, `/games/buzzer/${matchID}`, { method: 'GET' });
}

// A real boardgame.io/client instance over a real socket, same as the app's
// own Game.js. Caller is responsible for calling .stop() during cleanup.
function makeClient(baseUrl, matchID, playerID, credentials) {
  const client = Client({
    game: Buzzer,
    multiplayer: SocketIO({ server: baseUrl }),
    matchID,
    playerID: String(playerID),
    credentials,
  });
  client.start();
  return client;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Polls until `check` returns truthy or the timeout elapses, instead of a
// single fixed sleep - keeps tests fast on a quiet machine and less flaky
// under load, without hardcoding a "should be enough" delay everywhere.
async function waitUntil(check, { timeout = 3000, interval = 50 } = {}) {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const result = await check();
    if (result) return result;
    if (Date.now() - start > timeout) {
      throw new Error(`waitUntil: condition not met within ${timeout}ms`);
    }
    await wait(interval);
  }
}

module.exports = {
  startTestServer,
  createRoom,
  joinRoom,
  reclaimRoom,
  leaveRoom,
  kickPlayer,
  getRoom,
  makeClient,
  wait,
  waitUntil,
};
