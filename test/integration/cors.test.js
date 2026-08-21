// CORS coverage for the three custom routes (/kick, /reclaim, /leave) plus
// boardgame.io's own native routes (create/join/leave), which are
// configured via `origins: [Origins.LOCALHOST_IN_DEVELOPMENT]` in
// server.js.
//
// Jest sets NODE_ENV=test by default (not overridden anywhere in this
// repo's config), and Origins.LOCALHOST_IN_DEVELOPMENT only differs from
// the permissive `LOCALHOST` regex when NODE_ENV === 'production'
// (boardgame.io/dist/cjs/server.js). So under Jest this behaves exactly
// like a real (non-production) dev run - not like production - and these
// assertions are written against that, confirmed by manually inspecting
// process.env.NODE_ENV under `node --require ... jest` before writing them.
const fetch = require('node-fetch');
const { startTestServer, createRoom, joinRoom } = require('./setup');

describe('CORS', () => {
  let testServer;

  beforeEach(async () => {
    testServer = await startTestServer();
  });

  afterEach(async () => {
    await testServer.close();
  });

  describe('custom routes (/kick, /reclaim): hand-rolled wildcard CORS', () => {
    test.each(['kick', 'reclaim'])(
      '%s preflight OPTIONS is allowed for any origin with a 204 and wildcard ACAO',
      async (route) => {
        const res = await fetch(`${testServer.baseUrl}/games/buzzer/ABCDEF/${route}`, {
          method: 'OPTIONS',
          headers: {
            Origin: 'http://totally-untrusted.example.com',
            'Access-Control-Request-Method': 'POST',
          },
        });
        expect(res.status).toBe(204);
        expect(res.headers.get('access-control-allow-origin')).toBe('*');
        expect(res.headers.get('access-control-allow-methods')).toMatch(/POST/);
      }
    );

    test.each(['kick', 'reclaim'])(
      '%s actual POST response also carries the wildcard ACAO header regardless of origin',
      async (route) => {
        const { data: room } = await createRoom(testServer.baseUrl, 2);
        const res = await fetch(`${testServer.baseUrl}/games/buzzer/${room.matchID}/${route}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'http://totally-untrusted.example.com',
          },
          body: JSON.stringify({}),
        });
        // Regardless of the (404, since the body is empty) outcome, CORS
        // headers are set unconditionally by this route's own middleware.
        expect(res.headers.get('access-control-allow-origin')).toBe('*');
      }
    );
  });

  describe('native boardgame.io routes: origin-restricted per Origins.LOCALHOST_IN_DEVELOPMENT', () => {
    test('create from an allowed localhost origin gets that origin echoed back in ACAO', async () => {
      const res = await fetch(`${testServer.baseUrl}/games/buzzer/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:4000' },
        body: JSON.stringify({ numPlayers: 2 }),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:4000');
    });

    test('create from a disallowed origin still succeeds server-side but carries no ACAO header', async () => {
      // boardgame.io's cors middleware only withholds the header when the
      // origin doesn't match - it does not block the request itself, so
      // the browser (not the server) is what would actually enforce this.
      const res = await fetch(`${testServer.baseUrl}/games/buzzer/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://totally-untrusted.example.com' },
        body: JSON.stringify({ numPlayers: 2 }),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });

    test('join preflight from an allowed localhost origin gets a 204 with that origin echoed', async () => {
      const { data: room } = await createRoom(testServer.baseUrl, 2);
      const res = await fetch(`${testServer.baseUrl}/games/buzzer/${room.matchID}/join`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:4000',
          'Access-Control-Request-Method': 'POST',
        },
      });
      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:4000');
    });

    test('leave preflight from a disallowed origin carries no ACAO header', async () => {
      const { data: room } = await createRoom(testServer.baseUrl, 2);
      await joinRoom(testServer.baseUrl, room.matchID, 0, 'Alice');
      const res = await fetch(`${testServer.baseUrl}/games/buzzer/${room.matchID}/leave`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://totally-untrusted.example.com',
          'Access-Control-Request-Method': 'POST',
        },
      });
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });
  });
});
