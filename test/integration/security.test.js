// Negative-path / authorization coverage not already exercised by
// lobby.test.js, kick.test.js, and leave.test.js. Uses node-fetch directly
// (same as setup.js) for the two malformed-body cases, since setup.js's
// `request` helper always JSON.stringifies a real object.
const fetch = require('node-fetch');
const {
  startTestServer,
  createRoom,
  joinRoom,
  reclaimRoom,
  kickPlayer,
  leaveRoom,
} = require('./setup');

describe('negative paths and authorization', () => {
  let testServer;

  beforeEach(async () => {
    testServer = await startTestServer();
  });

  afterEach(async () => {
    await testServer.close();
  });

  test('joining a room where every seat is already named is rejected (409) with a max-players message', async () => {
    const { data: room } = await createRoom(testServer.baseUrl, 2);
    await joinRoom(testServer.baseUrl, room.matchID, 0, 'Alice');
    await joinRoom(testServer.baseUrl, room.matchID, 1, 'Bob');

    // No playerID given: boardgame.io's own /join auto-assigns the first
    // free seat, which is the "room is full" path (distinct from posting to
    // a specific already-named seat, which lobby.test.js already covers).
    const res = await fetch(`${testServer.baseUrl}/games/buzzer/${room.matchID}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerName: 'Carol' }),
    });
    // ctx.throw(status, message) inside boardgame.io's own route sends the
    // message as plain text (Koa's default error body), not JSON like the
    // app's own custom routes do - read as text rather than trying res.json().
    const text = await res.text();
    expect(res.status).toBe(409);
    expect(text).toMatch(/maximum number of players/i);
  });

  test('joining a nonexistent match 404s', async () => {
    const res = await joinRoom(testServer.baseUrl, 'ZZZZZZ', 0, 'Alice');
    expect(res.status).toBe(404);
  });

  test('/reclaim with a missing body (no playerID/playerName) 404s rather than crashing', async () => {
    const { data: room } = await createRoom(testServer.baseUrl, 2);
    await joinRoom(testServer.baseUrl, room.matchID, 0, 'Alice');

    const res = await fetch(`${testServer.baseUrl}/games/buzzer/${room.matchID}/reclaim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });

  test('/reclaim with a malformed (non-JSON) body fails gracefully, not with a 500', async () => {
    const { data: room } = await createRoom(testServer.baseUrl, 2);
    await joinRoom(testServer.baseUrl, room.matchID, 0, 'Alice');

    const res = await fetch(`${testServer.baseUrl}/games/buzzer/${room.matchID}/reclaim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not valid json',
    });
    // The custom /reclaim route parses the body before its own try/catch,
    // so a parse failure is handled by Koa's default error handling rather
    // than the route's own JSON error responses - assert it doesn't crash
    // the server or come back as an opaque 500.
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  test('/reclaim on a nonexistent match 404s', async () => {
    const res = await reclaimRoom(testServer.baseUrl, 'ZZZZZZ', 0, 'Alice');
    expect(res.status).toBe(404);
  });

  test('/kick with a missing body 404s rather than crashing', async () => {
    const { data: room } = await createRoom(testServer.baseUrl, 2);
    await joinRoom(testServer.baseUrl, room.matchID, 0, 'Alice');

    const res = await fetch(`${testServer.baseUrl}/games/buzzer/${room.matchID}/kick`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });

  test('/kick on a nonexistent match 404s', async () => {
    const res = await kickPlayer(testServer.baseUrl, 'ZZZZZZ', 0, 0, 'whatever');
    expect(res.status).toBe(404);
  });

  test('/leave with a missing playerID is rejected (403)', async () => {
    const { data: room } = await createRoom(testServer.baseUrl, 2);
    const alice = await joinRoom(testServer.baseUrl, room.matchID, 0, 'Alice');

    const res = await fetch(`${testServer.baseUrl}/games/buzzer/${room.matchID}/leave`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credentials: alice.data.playerCredentials }),
    });
    expect(res.status).toBe(403);
  });

  test('/leave with wrong credentials is rejected (403)', async () => {
    const { data: room } = await createRoom(testServer.baseUrl, 2);
    await joinRoom(testServer.baseUrl, room.matchID, 0, 'Alice');

    const res = await leaveRoom(testServer.baseUrl, room.matchID, 0, 'not-the-real-credentials');
    expect(res.status).toBe(403);
  });

  test('/leave on a nonexistent match 404s', async () => {
    const res = await leaveRoom(testServer.baseUrl, 'ZZZZZZ', 0, 'whatever');
    expect(res.status).toBe(404);
  });
});
