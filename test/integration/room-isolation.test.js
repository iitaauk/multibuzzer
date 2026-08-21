// Confirms a kick/leave/buzz in one room never observably affects another.
//
// Choice: two independent rooms on a single startTestServer() instance,
// rather than two separate server instances. The real isolation risk here
// is the shared, in-process state a single server holds across rooms - one
// CappedInMemory db (test/unit/db.test.js already covers per-matchID
// key isolation there in isolation) and one activeSockets Map keyed by
// socket id but filtered by gameID in server.js's /kick and /leave
// broadcast loops. That shared-state boundary is what this file is meant
// to exercise; two separate OS-level server processes wouldn't touch it at
// all (and every other integration test file already proves servers don't
// interfere with each other, since each boots its own instance).
const {
  startTestServer,
  createRoom,
  joinRoom,
  kickPlayer,
  leaveRoom,
  makeClient,
  waitUntil,
} = require('./setup');

describe('room isolation', () => {
  let testServer;

  beforeEach(async () => {
    testServer = await startTestServer();
  });

  afterEach(async () => {
    await testServer.close();
  });

  async function setupRoom(numPlayers = 3) {
    const { data: room } = await createRoom(testServer.baseUrl, numPlayers);
    const host = await joinRoom(testServer.baseUrl, room.matchID, 0, 'Host');
    const other = await joinRoom(testServer.baseUrl, room.matchID, 1, 'Other');
    const hostClient = makeClient(testServer.baseUrl, room.matchID, 0, host.data.playerCredentials);
    const otherClient = makeClient(testServer.baseUrl, room.matchID, 1, other.data.playerCredentials);
    await waitUntil(() => hostClient.getState() !== null && otherClient.getState() !== null);
    return { matchID: room.matchID, host, other, hostClient, otherClient };
  }

  test('a buzz in room A does not appear in room B\'s queue', async () => {
    const roomA = await setupRoom();
    const roomB = await setupRoom();

    roomA.hostClient.moves.buzz('0');
    await waitUntil(() => roomA.hostClient.getState().G.queue['0']);

    // Give room B a moment to (not) receive anything cross-wired.
    await waitUntil(() => roomA.otherClient.getState().G.queue['0']);
    expect(Object.keys(roomB.hostClient.getState().G.queue)).toHaveLength(0);
    expect(Object.keys(roomB.otherClient.getState().G.queue)).toHaveLength(0);

    roomA.hostClient.stop();
    roomA.otherClient.stop();
    roomB.hostClient.stop();
    roomB.otherClient.stop();
  });

  test('kicking a player in room A does not touch room B\'s roster or queue', async () => {
    const roomA = await setupRoom();
    const roomB = await setupRoom();

    roomB.otherClient.moves.buzz('1');
    await waitUntil(() => roomB.hostClient.getState().G.queue['1']);

    const kick = await kickPlayer(
      testServer.baseUrl,
      roomA.matchID,
      1,
      0,
      roomA.host.data.playerCredentials
    );
    expect(kick.status).toBe(200);

    await waitUntil(() => !roomA.hostClient.matchData.some((p) => String(p.id) === '1' && p.name));

    // Room B's player 1 (same playerID, different room) must be untouched:
    // still named, still connected, and their buzz still in the queue.
    expect(roomB.hostClient.matchData.find((p) => String(p.id) === '1').name).toBe('Other');
    expect(roomB.hostClient.getState().G.queue['1']).toBeDefined();

    roomA.hostClient.stop();
    roomA.otherClient.stop();
    roomB.hostClient.stop();
    roomB.otherClient.stop();
  });

  test('a player leaving room A does not affect room B\'s roster', async () => {
    const roomA = await setupRoom();
    const roomB = await setupRoom();

    const leave = await leaveRoom(testServer.baseUrl, roomA.matchID, 1, roomA.other.data.playerCredentials);
    expect(leave.status).toBe(200);

    await waitUntil(() => !roomA.hostClient.matchData.some((p) => String(p.id) === '1' && p.name));

    // Room B's seat 1 is a completely separate player/seat and must still
    // show as named.
    expect(roomB.hostClient.matchData.find((p) => String(p.id) === '1').name).toBe('Other');

    roomA.hostClient.stop();
    roomB.hostClient.stop();
    roomB.otherClient.stop();
  });
});
