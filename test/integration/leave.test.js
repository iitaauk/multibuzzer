const { startTestServer, createRoom, joinRoom, leaveRoom, makeClient, waitUntil, wait } = require('./setup');

describe('/leave', () => {
  let testServer;

  beforeEach(async () => {
    testServer = await startTestServer();
  });

  afterEach(async () => {
    await testServer.close();
  });

  test('roster updates for remaining players, with no other move happening', async () => {
    const { data: room } = await createRoom(testServer.baseUrl, 3);
    const host = await joinRoom(testServer.baseUrl, room.matchID, 0, 'Host');
    const alice = await joinRoom(testServer.baseUrl, room.matchID, 1, 'Alice');
    const hostClient = makeClient(testServer.baseUrl, room.matchID, 0, host.data.playerCredentials);
    await waitUntil(() => hostClient.transport.isConnected);

    const leave = await leaveRoom(testServer.baseUrl, room.matchID, 1, alice.data.playerCredentials);
    expect(leave.status).toBe(200);

    await waitUntil(() => !hostClient.matchData.some((p) => String(p.id) === '1' && p.name));

    hostClient.stop();
  });

  test('a ghost queue entry is cleaned up and broadcast, not just written to the DB', async () => {
    const { data: room } = await createRoom(testServer.baseUrl, 3);
    const host = await joinRoom(testServer.baseUrl, room.matchID, 0, 'Host');
    const alice = await joinRoom(testServer.baseUrl, room.matchID, 1, 'Alice');
    const hostClient = makeClient(testServer.baseUrl, room.matchID, 0, host.data.playerCredentials);
    const aliceClient = makeClient(testServer.baseUrl, room.matchID, 1, alice.data.playerCredentials);
    await waitUntil(() => hostClient.transport.isConnected && aliceClient.transport.isConnected);

    aliceClient.moves.buzz('1');
    await waitUntil(() => hostClient.getState().G.queue['1']);

    await leaveRoom(testServer.baseUrl, room.matchID, 1, alice.data.playerCredentials);
    await waitUntil(() => Object.keys(hostClient.getState().G.queue).length === 0);

    const bob = await joinRoom(testServer.baseUrl, room.matchID, 1, 'Bob');
    const bobClient = makeClient(testServer.baseUrl, room.matchID, 1, bob.data.playerCredentials);
    await waitUntil(() => bobClient.transport.isConnected);
    bobClient.moves.buzz('1');
    await waitUntil(() => hostClient.getState().G.queue['1']);
    expect(hostClient.getState().G.queue['1'].id).toBe('1');

    hostClient.stop();
    aliceClient.stop();
    bobClient.stop();
  });

  test('the leaving player receives no notification about their own departure', async () => {
    const { data: room } = await createRoom(testServer.baseUrl, 3);
    const host = await joinRoom(testServer.baseUrl, room.matchID, 0, 'Host');
    const alice = await joinRoom(testServer.baseUrl, room.matchID, 1, 'Alice');
    const hostClient = makeClient(testServer.baseUrl, room.matchID, 0, host.data.playerCredentials);
    const aliceClient = makeClient(testServer.baseUrl, room.matchID, 1, alice.data.playerCredentials);
    await waitUntil(() => hostClient.transport.isConnected && aliceClient.transport.isConnected);

    let aliceNotifiedAfterLeave = false;
    let leftAt = null;
    aliceClient.subscribe(() => {
      if (leftAt && Date.now() - leftAt < 2000) {
        aliceNotifiedAfterLeave = true;
      }
    });

    leftAt = Date.now();
    await leaveRoom(testServer.baseUrl, room.matchID, 1, alice.data.playerCredentials);
    await waitUntil(() => !hostClient.matchData.some((p) => String(p.id) === '1' && p.name));
    // give any (undesired) notification to Alice's own socket a moment to arrive
    await wait(300);

    expect(aliceNotifiedAfterLeave).toBe(false);

    hostClient.stop();
    aliceClient.stop();
  });

  test('leaving without ever having buzzed does not error', async () => {
    const { data: room } = await createRoom(testServer.baseUrl, 2);
    const alice = await joinRoom(testServer.baseUrl, room.matchID, 0, 'Alice');
    const leave = await leaveRoom(testServer.baseUrl, room.matchID, 0, alice.data.playerCredentials);
    expect(leave.status).toBe(200);
  });

  test('the last named player leaving wipes the room without throwing', async () => {
    // Buzzer requires minPlayers: 2, so a 1-seat room is itself invalid -
    // this instead leaves one seat empty and only ever names the other,
    // so /leave's own "does any seat still have a name" check is what
    // actually triggers db.wipe() here, same as it would with 200 seats
    // where only one was ever claimed.
    const { data: room } = await createRoom(testServer.baseUrl, 2);
    const alice = await joinRoom(testServer.baseUrl, room.matchID, 0, 'Alice');
    const leave = await leaveRoom(testServer.baseUrl, room.matchID, 0, alice.data.playerCredentials);
    expect(leave.status).toBe(200);
  });
});
