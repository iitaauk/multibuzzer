const { startTestServer, createRoom, joinRoom, kickPlayer, makeClient, waitUntil } = require('./setup');

describe('/kick', () => {
  let testServer;

  beforeEach(async () => {
    testServer = await startTestServer();
  });

  afterEach(async () => {
    await testServer.close();
  });

  async function setupHostAndAlice(numPlayers = 3) {
    const { data: room } = await createRoom(testServer.baseUrl, numPlayers);
    const host = await joinRoom(testServer.baseUrl, room.matchID, 0, 'Host');
    const alice = await joinRoom(testServer.baseUrl, room.matchID, 1, 'Alice');
    const hostClient = makeClient(testServer.baseUrl, room.matchID, 0, host.data.playerCredentials);
    const aliceClient = makeClient(testServer.baseUrl, room.matchID, 1, alice.data.playerCredentials);
    await waitUntil(() => hostClient.transport.isConnected && aliceClient.transport.isConnected);
    return { matchID: room.matchID, host, alice, hostClient, aliceClient };
  }

  test('host can kick a player, clearing their queue entry too', async () => {
    const { matchID, host, alice, hostClient, aliceClient } = await setupHostAndAlice();

    aliceClient.moves.buzz('1');
    await waitUntil(() => hostClient.getState().G.queue['1']);

    const kick = await kickPlayer(testServer.baseUrl, matchID, 1, 0, host.data.playerCredentials);
    expect(kick.status).toBe(200);

    await waitUntil(() => Object.keys(hostClient.getState().G.queue).length === 0);

    // A new player backfilling the vacated seat must be able to buzz - a
    // stale ghost entry here previously blocked them permanently.
    const bob = await joinRoom(testServer.baseUrl, matchID, 1, 'Bob');
    const bobClient = makeClient(testServer.baseUrl, matchID, 1, bob.data.playerCredentials);
    await waitUntil(() => bobClient.transport.isConnected);
    bobClient.moves.buzz('1');
    await waitUntil(() => hostClient.getState().G.queue['1']);
    expect(hostClient.getState().G.queue['1'].id).toBe('1');

    hostClient.stop();
    aliceClient.stop();
    bobClient.stop();
  });

  test('a non-host cannot kick (403)', async () => {
    const { matchID, alice } = await setupHostAndAlice();
    const kick = await kickPlayer(testServer.baseUrl, matchID, 0, 1, alice.data.playerCredentials);
    expect(kick.status).toBe(403);
  });

  test('kicking with wrong credentials is rejected (403)', async () => {
    const { matchID } = await setupHostAndAlice();
    const kick = await kickPlayer(testServer.baseUrl, matchID, 1, 0, 'not-the-real-credentials');
    expect(kick.status).toBe(403);
  });

  test('kicking a player not in the room 404s', async () => {
    const { matchID, host } = await setupHostAndAlice();
    const kick = await kickPlayer(testServer.baseUrl, matchID, 2, 0, host.data.playerCredentials);
    expect(kick.status).toBe(404);
  });
});
