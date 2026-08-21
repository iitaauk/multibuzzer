const { startTestServer, createRoom, joinRoom, getRoom, makeClient, waitUntil } = require('./setup');

describe('connection status tracking', () => {
  let testServer;

  beforeEach(async () => {
    testServer = await startTestServer();
  });

  afterEach(async () => {
    await testServer.close();
  });

  test('isConnected cycles undefined -> true -> false across connect/disconnect', async () => {
    const { data: room } = await createRoom(testServer.baseUrl, 2);
    const alice = await joinRoom(testServer.baseUrl, room.matchID, 0, 'Alice');

    const before = await getRoom(testServer.baseUrl, room.matchID);
    expect(before.data.players[0].isConnected).toBeUndefined();

    const client = makeClient(testServer.baseUrl, room.matchID, 0, alice.data.playerCredentials);
    await waitUntil(async () => {
      const res = await getRoom(testServer.baseUrl, room.matchID);
      return res.data.players[0].isConnected === true;
    });

    client.stop();
    await waitUntil(async () => {
      const res = await getRoom(testServer.baseUrl, room.matchID);
      return res.data.players[0].isConnected === false;
    });
  });
});
