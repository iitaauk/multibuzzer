const { startTestServer, createRoom, joinRoom, makeClient, wait, waitUntil } = require('./setup');

describe('buzzing', () => {
  let testServer;

  beforeEach(async () => {
    testServer = await startTestServer();
  });

  afterEach(async () => {
    await testServer.close();
  });

  test('20 simultaneous buzzes all land, none dropped by stale-stateID', async () => {
    const N = 20;
    const { data: room } = await createRoom(testServer.baseUrl, N);
    const clients = [];
    for (let i = 0; i < N; i++) {
      const join = await joinRoom(testServer.baseUrl, room.matchID, i, `Player${i}`);
      clients.push(makeClient(testServer.baseUrl, room.matchID, i, join.data.playerCredentials));
    }

    // transport.isConnected flips true as soon as the socket connects, which
    // can be before the client has received its initial synced state - wait
    // for the actual state instead, or an early move sees ctx as undefined.
    await waitUntil(() => clients.every((c) => c.getState() !== null));

    clients.forEach((c, i) => c.moves.buzz(String(i)));

    await waitUntil(() => Object.keys(clients[0].getState().G.queue).length === N, {
      timeout: 5000,
    });

    const queue = clients[0].getState().G.queue;
    for (let i = 0; i < N; i++) {
      expect(queue[String(i)]).toBeDefined();
    }

    clients.forEach((c) => c.stop());
  });

  test('a second buzz for the same player is a no-op, not a duplicate/overwrite', async () => {
    const { data: room } = await createRoom(testServer.baseUrl, 2);
    const join = await joinRoom(testServer.baseUrl, room.matchID, 0, 'Alice');
    const client = makeClient(testServer.baseUrl, room.matchID, 0, join.data.playerCredentials);
    await waitUntil(() => client.getState() !== null);

    client.moves.buzz('0');
    await waitUntil(() => client.getState().G.queue['0']);
    // The client's own optimistic timestamp gets overwritten by the
    // server's authoritative one shortly after (store.js does this
    // deliberately) - wait for that round-trip to settle before treating
    // this as the baseline, or it looks like a spurious second write.
    await wait(150);
    const firstTimestamp = client.getState().G.queue['0'].timestamp;

    client.moves.buzz('0');
    await wait(200);

    expect(client.getState().G.queue['0'].timestamp).toBe(firstTimestamp);
    client.stop();
  });

  test('resetBuzzer clears one player without touching others', async () => {
    const { data: room } = await createRoom(testServer.baseUrl, 3);
    const host = await joinRoom(testServer.baseUrl, room.matchID, 0, 'Host');
    const alice = await joinRoom(testServer.baseUrl, room.matchID, 1, 'Alice');
    const hostClient = makeClient(testServer.baseUrl, room.matchID, 0, host.data.playerCredentials);
    const aliceClient = makeClient(testServer.baseUrl, room.matchID, 1, alice.data.playerCredentials);
    await waitUntil(() => hostClient.getState() !== null && aliceClient.getState() !== null);

    hostClient.moves.buzz('0');
    aliceClient.moves.buzz('1');
    await waitUntil(() => Object.keys(hostClient.getState().G.queue).length === 2);

    hostClient.moves.resetBuzzer('1');
    await waitUntil(() => !hostClient.getState().G.queue['1']);

    expect(hostClient.getState().G.queue['0']).toBeDefined();
    expect(hostClient.getState().G.queue['1']).toBeUndefined();

    hostClient.stop();
    aliceClient.stop();
  });

  test('resetBuzzers clears everyone at once', async () => {
    const { data: room } = await createRoom(testServer.baseUrl, 3);
    const host = await joinRoom(testServer.baseUrl, room.matchID, 0, 'Host');
    const alice = await joinRoom(testServer.baseUrl, room.matchID, 1, 'Alice');
    const hostClient = makeClient(testServer.baseUrl, room.matchID, 0, host.data.playerCredentials);
    const aliceClient = makeClient(testServer.baseUrl, room.matchID, 1, alice.data.playerCredentials);
    await waitUntil(() => hostClient.getState() !== null && aliceClient.getState() !== null);

    hostClient.moves.buzz('0');
    aliceClient.moves.buzz('1');
    await waitUntil(() => Object.keys(hostClient.getState().G.queue).length === 2);

    hostClient.moves.resetBuzzers();
    await waitUntil(() => Object.keys(hostClient.getState().G.queue).length === 0);

    hostClient.stop();
    aliceClient.stop();
  });

  test('toggleLock racing against a flurry of buzzes is not dropped by stale-stateID', async () => {
    const N = 10;
    const { data: room } = await createRoom(testServer.baseUrl, N + 1);
    const hostJoin = await joinRoom(testServer.baseUrl, room.matchID, N, 'Host');
    const hostClient = makeClient(testServer.baseUrl, room.matchID, N, hostJoin.data.playerCredentials);
    const clients = [hostClient];
    for (let i = 0; i < N; i++) {
      const join = await joinRoom(testServer.baseUrl, room.matchID, i, `Player${i}`);
      clients.push(makeClient(testServer.baseUrl, room.matchID, i, join.data.playerCredentials));
    }
    // transport.isConnected flips true as soon as the socket connects, which
    // can be before the client has received its initial synced state - wait
    // for the actual state instead, or an early move sees ctx as undefined.
    await waitUntil(() => clients.every((c) => c.getState() !== null));

    // Fire the lock in the middle of the buzz flurry, not before/after it.
    clients.slice(1).forEach((c, i) => c.moves.buzz(String(i)));
    hostClient.moves.toggleLock();

    await waitUntil(() => hostClient.getState().G.locked === true, { timeout: 5000 });
    expect(hostClient.getState().G.locked).toBe(true);

    clients.forEach((c) => c.stop());
  });
});
