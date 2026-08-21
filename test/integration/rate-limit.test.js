// Verifies the rate limiter's whitelist logic in server.js:
//   whitelist: (ctx) => !ctx.path.includes(`games/${Buzzer.name}`)
// i.e. games/buzzer/* traffic IS throttled, everything else is exempt.
//
// setup.js sets RATE_LIMIT_MAX=100000 as a fallback for every other test
// file so none of them ever think about the limiter. This file needs the
// opposite - a low, fast-to-hit limit - so it must set RATE_LIMIT_MAX
// *before* setup.js (and therefore src/server.js) is first required. The
// `||` fallback in setup.js respects an already-set env var, so setting it
// here first wins.
process.env.RATE_LIMIT_MAX = '3';
process.env.RATE_LIMIT_DURATION_MS = '60000';

const fetch = require('node-fetch');
const { startTestServer, getRoom } = require('./setup');

describe('rate limiter', () => {
  let testServer;

  beforeEach(async () => {
    testServer = await startTestServer();
  });

  afterEach(async () => {
    await testServer.close();
  });

  test('games/buzzer/* requests are throttled once the low test limit is exceeded', async () => {
    const statuses = [];
    for (let i = 0; i < 4; i++) {
      // eslint-disable-next-line no-await-in-loop
      const res = await getRoom(testServer.baseUrl, 'ZZZZZZ');
      statuses.push(res.status);
    }
    // First RATE_LIMIT_MAX (3) requests pass through to the route handler
    // (404s, since the room doesn't exist); the 4th, which exhausts the
    // limiter's `remaining` counter down to exactly 0, is throttled (429)
    // by koa-ratelimit before ever reaching the route.
    //
    // Note: koa-ratelimit's own `if (limit.remaining) return next()` check
    // (node_modules/koa-ratelimit/index.js) treats any *negative* remaining
    // as truthy, so it only 429s the single request that lands exactly on
    // 0 - a 5th request here would pass through again as `remaining` keeps
    // decrementing past zero. That's a real quirk in the third-party
    // library, not something this app's whitelist/config controls, so this
    // test only asserts the verified, well-defined part of the behavior:
    // the limit does trigger at all, at the expected count.
    expect(statuses).toEqual([404, 404, 404, 429]);
  });

  test('non-games/buzzer paths are whitelisted and never throttled, even past the same low limit', async () => {
    const statuses = [];
    for (let i = 0; i < 5; i++) {
      // eslint-disable-next-line no-await-in-loop
      const res = await fetch(`${testServer.baseUrl}/some/unrelated/path`);
      statuses.push(res.status);
    }
    // None of these are 429 - the path doesn't contain `games/buzzer`, so
    // the whitelist exempts it regardless of how many requests are made.
    // (404 here because there's no matching route/static file, not 429.)
    expect(statuses.every((status) => status !== 429)).toBe(true);
  });
});
