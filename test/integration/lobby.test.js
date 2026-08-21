const {
  startTestServer,
  createRoom,
  joinRoom,
  reclaimRoom,
  getRoom,
  makeClient,
  wait,
} = require('./setup');

describe('room creation and joining', () => {
  let testServer;

  beforeEach(async () => {
    testServer = await startTestServer();
  });

  afterEach(async () => {
    await testServer.close();
  });

  test('create returns a 6-character uppercase room code', async () => {
    const res = await createRoom(testServer.baseUrl, 4);
    expect(res.status).toBe(200);
    expect(res.data.matchID).toMatch(/^[A-Z]{6}$/);
  });

  test('a fresh room has no named players', async () => {
    const { data: room } = await createRoom(testServer.baseUrl, 4);
    const { data } = await getRoom(testServer.baseUrl, room.matchID);
    expect(data.players).toHaveLength(4);
    expect(data.players.every((p) => !p.name)).toBe(true);
  });

  test('join assigns credentials and fills the named seat', async () => {
    const { data: room } = await createRoom(testServer.baseUrl, 4);
    const join = await joinRoom(testServer.baseUrl, room.matchID, 0, 'Alice');
    expect(join.status).toBe(200);
    expect(join.data.playerID).toBe('0');
    expect(join.data.playerCredentials).toBeTruthy();

    const { data } = await getRoom(testServer.baseUrl, room.matchID);
    expect(data.players.find((p) => p.id === 0).name).toBe('Alice');
  });

  test('joining an already-named seat is rejected (409)', async () => {
    const { data: room } = await createRoom(testServer.baseUrl, 4);
    await joinRoom(testServer.baseUrl, room.matchID, 0, 'Alice');
    const second = await joinRoom(testServer.baseUrl, room.matchID, 0, 'Bob');
    expect(second.status).toBe(409);
  });

  test('joining with a missing playerName is rejected (403)', async () => {
    const { data: room } = await createRoom(testServer.baseUrl, 4);
    const res = await joinRoom(testServer.baseUrl, room.matchID, 0, undefined);
    expect(res.status).toBe(403);
  });

  test('getRoom on a nonexistent match 404s', async () => {
    const res = await getRoom(testServer.baseUrl, 'ZZZZZZ');
    expect(res.status).toBe(404);
  });
});

describe('/reclaim', () => {
  let testServer;

  beforeEach(async () => {
    testServer = await startTestServer();
  });

  afterEach(async () => {
    await testServer.close();
  });

  test('a seat that has never connected can be reclaimed by name', async () => {
    const { data: room } = await createRoom(testServer.baseUrl, 4);
    await joinRoom(testServer.baseUrl, room.matchID, 0, 'Alice');

    const reclaim = await reclaimRoom(testServer.baseUrl, room.matchID, 0, 'Alice');
    expect(reclaim.status).toBe(200);
    expect(reclaim.data.playerID).toBe('0');
    expect(reclaim.data.playerCredentials).toBeTruthy();
  });

  test('reclaiming with the wrong name is rejected (409)', async () => {
    const { data: room } = await createRoom(testServer.baseUrl, 4);
    await joinRoom(testServer.baseUrl, room.matchID, 0, 'Alice');

    const reclaim = await reclaimRoom(testServer.baseUrl, room.matchID, 0, 'Mallory');
    expect(reclaim.status).toBe(409);
  });

  test('reclaiming an empty seat 404s', async () => {
    const { data: room } = await createRoom(testServer.baseUrl, 4);
    const reclaim = await reclaimRoom(testServer.baseUrl, room.matchID, 0, 'Alice');
    expect(reclaim.status).toBe(404);
  });

  test('reclaiming a seat that is currently connected is rejected (409)', async () => {
    const { data: room } = await createRoom(testServer.baseUrl, 4);
    const join = await joinRoom(testServer.baseUrl, room.matchID, 0, 'Alice');
    const client = makeClient(testServer.baseUrl, room.matchID, 0, join.data.playerCredentials);
    await wait(800);

    const reclaim = await reclaimRoom(testServer.baseUrl, room.matchID, 0, 'Alice');
    expect(reclaim.status).toBe(409);

    client.stop();
  });
});
