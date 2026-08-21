// Room cleanup cron, using startRoomCleanupCron's now-parameterized
// intervalMs/maxAgeMs/maxIdleMs directly against a startTestServer()
// instance at short, test-scale values - no scratch copies of server.js
// needed.
const { startTestServer, createRoom, joinRoom, getRoom, makeClient, waitUntil, wait } = require('./setup');

describe('room cleanup cron', () => {
  let testServer;
  let cronHandle;

  beforeEach(async () => {
    testServer = await startTestServer();
  });

  afterEach(async () => {
    if (cronHandle) {
      clearInterval(cronHandle);
      cronHandle = null;
    }
    await testServer.close();
  });

  test('an idle room gets wiped after maxIdleMs', async () => {
    const { data: room } = await createRoom(testServer.baseUrl, 2);
    await joinRoom(testServer.baseUrl, room.matchID, 0, 'Alice');

    cronHandle = testServer.startRoomCleanupCron(testServer.server, 100, 10000, 400);

    // Still present well before maxIdleMs.
    await wait(150);
    let res = await getRoom(testServer.baseUrl, room.matchID);
    expect(res.status).toBe(200);

    // Wiped once idle exceeds maxIdleMs (400ms), given the 100ms poll
    // interval to notice it.
    await waitUntil(
      async () => {
        const r = await getRoom(testServer.baseUrl, room.matchID);
        return r.status === 404;
      },
      { timeout: 3000 }
    );
  });

  test('activity (a move) resets the idle timer, so an active room survives past the original idle deadline', async () => {
    const { data: room } = await createRoom(testServer.baseUrl, 2);
    const host = await joinRoom(testServer.baseUrl, room.matchID, 0, 'Host');
    await joinRoom(testServer.baseUrl, room.matchID, 1, 'Alice');
    const hostClient = makeClient(testServer.baseUrl, room.matchID, 0, host.data.playerCredentials);
    await waitUntil(() => hostClient.getState() !== null);

    // maxIdleMs 500ms, poll every 100ms, generous maxAgeMs so only idle
    // matters here.
    cronHandle = testServer.startRoomCleanupCron(testServer.server, 100, 10000, 500);

    // Move at ~300ms, before the original 500ms idle deadline would fire,
    // to push the deadline out.
    await wait(300);
    hostClient.moves.buzz('0');
    await waitUntil(() => hostClient.getState().G.queue['0']);

    // At 300ms + 350ms = 650ms since room creation, the room would already
    // be wiped if the move hadn't reset the idle clock (original deadline
    // was ~500ms from creation). It should still be alive here.
    await wait(350);
    let res = await getRoom(testServer.baseUrl, room.matchID);
    expect(res.status).toBe(200);

    // But with no further activity, it does eventually get wiped once
    // idle exceeds 500ms from the last move.
    await waitUntil(
      async () => {
        const r = await getRoom(testServer.baseUrl, room.matchID);
        return r.status === 404;
      },
      { timeout: 3000 }
    );

    hostClient.stop();
  });

  test('a continuously active room is still wiped once maxAgeMs is hit, regardless of activity', async () => {
    const { data: room } = await createRoom(testServer.baseUrl, 2);
    const host = await joinRoom(testServer.baseUrl, room.matchID, 0, 'Host');
    const hostClient = makeClient(testServer.baseUrl, room.matchID, 0, host.data.playerCredentials);
    await waitUntil(() => hostClient.getState() !== null);

    // maxAgeMs 500ms (short), maxIdleMs generously long so only age matters.
    cronHandle = testServer.startRoomCleanupCron(testServer.server, 100, 500, 10000);

    // Keep the room continuously active with moves throughout, well under
    // maxIdleMs at every point, but total age will still cross maxAgeMs.
    const activityInterval = setInterval(() => {
      hostClient.moves.toggleLock();
    }, 100);

    await waitUntil(
      async () => {
        const r = await getRoom(testServer.baseUrl, room.matchID);
        return r.status === 404;
      },
      { timeout: 3000 }
    );
    clearInterval(activityInterval);

    hostClient.stop();
  });
});
