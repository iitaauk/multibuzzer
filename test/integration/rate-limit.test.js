const fetch = require('node-fetch');
const { startTestServer, createRoom, getRoom, joinRoom } = require('./setup');

describe('rate limiter', () => {
  let testServer;

  async function start(max) {
    process.env.RATE_LIMIT_MAX = String(max);
    process.env.RATE_LIMIT_DURATION_MS = '60000';
    testServer = await startTestServer();
  }

  afterEach(async () => {
    await testServer.close();
    delete process.env.RATE_LIMIT_MAX;
    delete process.env.RATE_LIMIT_DURATION_MS;
  });

  test('games/buzzer POSTs are throttled once the limit is exceeded, and stay throttled', async () => {
    await start(3);
    const statuses = [];
    for (let i = 0; i < 5; i++) {
      // eslint-disable-next-line no-await-in-loop
      const res = await createRoom(testServer.baseUrl);
      statuses.push(res.status);
    }
    expect(statuses).toEqual([200, 200, 200, 429, 429]);
  });

  test('each CF-Connecting-IP gets its own budget', async () => {
    await start(1);
    const post = (ip) =>
      fetch(`${testServer.baseUrl}/games/buzzer/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
        body: JSON.stringify({ numPlayers: 2 }),
      }).then((res) => res.status);

    expect(await post('203.0.113.1')).toBe(200);
    expect(await post('203.0.113.1')).toBe(429);
    expect(await post('203.0.113.2')).toBe(200);
  });

  test('games/buzzer GETs are never throttled', async () => {
    await start(3);
    const statuses = [];
    for (let i = 0; i < 10; i++) {
      // eslint-disable-next-line no-await-in-loop
      const res = await getRoom(testServer.baseUrl, 'ZZZZZZ');
      statuses.push(res.status);
    }
    expect(statuses).toEqual(Array(10).fill(404));
  });

  test('non-games/buzzer paths are never throttled', async () => {
    await start(3);
    const statuses = [];
    for (let i = 0; i < 5; i++) {
      // eslint-disable-next-line no-await-in-loop
      const res = await fetch(`${testServer.baseUrl}/some/unrelated/path`);
      statuses.push(res.status);
    }
    expect(statuses.every((status) => status !== 429)).toBe(true);
  });

  test('a host and 10 players on one IP can join and poll for a minute at the default limit', async () => {
    await start(25);
    const statuses = [];
    const created = await createRoom(testServer.baseUrl, 11);
    statuses.push(created.status);
    const { matchID } = created.data;

    for (let playerID = 0; playerID < 11; playerID++) {
      // eslint-disable-next-line no-await-in-loop
      statuses.push((await getRoom(testServer.baseUrl, matchID)).status);
      // eslint-disable-next-line no-await-in-loop
      const joined = await joinRoom(testServer.baseUrl, matchID, playerID, `P${playerID}`);
      statuses.push(joined.status);
    }

    for (let poll = 0; poll < 12 * 11; poll++) {
      // eslint-disable-next-line no-await-in-loop
      statuses.push((await getRoom(testServer.baseUrl, matchID)).status);
    }

    expect(statuses.filter((status) => status !== 200)).toEqual([]);
  });
});
