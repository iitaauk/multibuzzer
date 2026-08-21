const path = require('path');
const serve = require('koa-static');
const ratelimit = require('koa-ratelimit');
const { randomUUID } = require('crypto');
const { koaBody } = require('koa-body');

const { Server } = require('boardgame.io/server');
const Buzzer = require('./lib/store').Buzzer;
const { CappedInMemory } = require('./lib/db');

function randomString(length, chars) {
  let result = '';
  // eslint-disable-next-line no-plusplus
  for (let i = length; i > 0; --i)
    result += chars[Math.floor(Math.random() * chars.length)];
  return result;
}

// boardgame.io's own Origins.LOCALHOST_IN_DEVELOPMENT only matches literal
// `localhost:PORT`, not a LAN IP - so `yarn dev` (client/server on separate
// ports) is unreachable from another device on the network, e.g. testing
// from a phone via the machine's LAN IP, even though the request succeeds
// server-side (missing CORS headers make the browser discard the response).
// Production is unaffected either way: client and server share one origin
// there, so this dev-only regex is never even consulted.
const DEV_ORIGINS =
  /(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}):\d+/;
const origins = process.env.NODE_ENV === 'production' ? false : DEV_ORIGINS;

const server = Server({
  games: [Buzzer],
  generateCredentials: () => randomUUID(),
  uuid: () => randomString(6, 'ABCDEFGHJKLMNPQRSTUVWXYZ'),
  origins: [origins],
  db: new CappedInMemory(),
});

const PORT = process.env.PORT || 4001;
const { app } = server;

const FRONTEND_PATH = path.join(__dirname, '../build');
app.use(
  serve(FRONTEND_PATH, {
    setHeaders: (res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
    },
  })
);

// rate limiter
// Overridable so integration tests can run many requests without tripping
// this - production behavior (25 req/min) is unchanged unless these env
// vars are explicitly set.
const RATE_LIMIT_MAX = process.env.RATE_LIMIT_MAX
  ? Number(process.env.RATE_LIMIT_MAX)
  : 25;
const RATE_LIMIT_DURATION_MS = process.env.RATE_LIMIT_DURATION_MS
  ? Number(process.env.RATE_LIMIT_DURATION_MS)
  : 60000;
const db = new Map();
app.use(
  ratelimit({
    driver: 'memory',
    db: db,
    duration: RATE_LIMIT_DURATION_MS,
    errorMessage: 'Too many requests',
    id: (ctx) => ctx.ip,
    max: RATE_LIMIT_MAX,
    whitelist: (ctx) => {
      return !ctx.path.includes(`games/${Buzzer.name}`);
    },
  })
);

const parseBody = koaBody();

app.use(async (ctx, next) => {
  const match = ctx.path.match(/^\/games\/buzzer\/([^\/]+)\/kick$/i);
  if (match) {
    // Add CORS headers for preflight and actual requests
    ctx.set('Access-Control-Allow-Origin', '*');
    ctx.set(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept'
    );
    ctx.set('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');

    if (ctx.method === 'OPTIONS') {
      ctx.status = 204;
      return;
    }

    if (ctx.method === 'POST') {
      await parseBody(ctx, async () => {});
      const gameID = match[1].toUpperCase();
      const { playerID, hostPlayerID, credentials } = ctx.request.body;

      try {
        const fetchResult = await server.db.fetch(gameID, {
          metadata: true,
          state: true,
          log: true,
          initialState: true,
        });
        const metadata = fetchResult ? fetchResult.metadata : null;

        if (!metadata) {
          ctx.status = 404;
          ctx.body = { error: `Game ${gameID} not found` };
          return;
        }

        if (!metadata.players[hostPlayerID]) {
          ctx.status = 404;
          ctx.body = { error: `Host player not found` };
          return;
        }

        if (credentials !== metadata.players[hostPlayerID].credentials) {
          ctx.status = 403;
          ctx.body = { error: 'Invalid credentials' };
          return;
        }

        // Verify if hostPlayerID is the actual host (lowest registered player ID with a name who is currently connected)
        const registeredPlayers = Object.entries(metadata.players)
          .filter(([id, p]) => p.name && p.isConnected)
          .map(([id, p]) => ({ ...p, id: parseInt(id, 10) }));

        const sortedPlayers = registeredPlayers.sort((a, b) => a.id - b.id);
        const expectedHostID =
          sortedPlayers.length > 0 ? String(sortedPlayers[0].id) : null;

        if (String(hostPlayerID) !== expectedHostID) {
          ctx.status = 403;
          ctx.body = { error: 'Only the host can kick players' };
          return;
        }

        if (!metadata.players[playerID] || !metadata.players[playerID].name) {
          ctx.status = 404;
          ctx.body = { error: `Player ${playerID} not found in this room` };
          return;
        }

        // Kick the player by removing name and credentials
        delete metadata.players[playerID].name;
        delete metadata.players[playerID].credentials;

        if (Object.values(metadata.players).some((val) => val.name)) {
          await server.db.setMetadata(gameID, metadata);
        } else {
          await server.db.wipe(gameID);
        }

        // Clean up from state G.queue if player is in it
        if (fetchResult && fetchResult.state) {
          const state = fetchResult.state;
          if (state.G && state.G.queue && state.G.queue[playerID]) {
            const newQueue = { ...state.G.queue };
            delete newQueue[playerID];
            // state.G is frozen by boardgame.io's Immer-based reducer once any
            // move has run, so it must be replaced rather than mutated in place.
            state.G = { ...state.G, queue: newQueue };
            await server.db.setState(gameID, state);
          }
        }

        // Disconnect the kicked player's socket
        const activeSockets = ctx.app.context.activeSockets;
        if (activeSockets) {
          for (const info of activeSockets.values()) {
            if (
              info.gameID === gameID &&
              String(info.playerID) === String(playerID)
            ) {
              info.socket.disconnect(true);
            }
          }
        }

        // Broadcast the sync event to all remaining connected sockets for this game
        if (activeSockets) {
          const filteredMetadata = Object.values(metadata.players).map((p) => ({
            id: p.id,
            name: p.name,
            isConnected: p.isConnected || false,
          }));
          for (const info of activeSockets.values()) {
            if (info.gameID === gameID && String(info.playerID) !== String(playerID)) {
              const syncInfo = {
                state: {
                  ...fetchResult.state,
                  deltalog: undefined,
                  _undo: [],
                  _redo: [],
                },
                log: fetchResult.log || [],
                filteredMetadata,
                initialState: fetchResult.initialState,
              };
              info.socket.emit('sync', gameID, syncInfo);
            }
          }
        }

        ctx.status = 200;
        ctx.body = { success: true };
      } catch (err) {
        console.error('Error kicking player:', err);
        ctx.status = 500;
        ctx.body = { error: 'Internal server error' };
      }
      return;
    }
  }
  await next();
});

// Reclaiming a seat: boardgame.io's own /join route refuses to hand out a
// seat that already has a name attached (409), which is correct for a seat
// that's still in use but blocks the app's own reconnect-by-name flow after
// a dropped socket. This route lets a disconnected seat be re-claimed by
// whoever knows the room code and that player's display name, by rotating
// in fresh credentials for the same seat.
app.use(async (ctx, next) => {
  const match = ctx.path.match(/^\/games\/buzzer\/([^\/]+)\/reclaim$/i);
  if (match) {
    ctx.set('Access-Control-Allow-Origin', '*');
    ctx.set(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept'
    );
    ctx.set('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');

    if (ctx.method === 'OPTIONS') {
      ctx.status = 204;
      return;
    }

    if (ctx.method === 'POST') {
      await parseBody(ctx, async () => {});
      const gameID = match[1].toUpperCase();
      const { playerID, playerName } = ctx.request.body;

      try {
        const fetchResult = await server.db.fetch(gameID, { metadata: true });
        const metadata = fetchResult ? fetchResult.metadata : null;

        if (!metadata) {
          ctx.status = 404;
          ctx.body = { error: `Game ${gameID} not found` };
          return;
        }

        const seat = metadata.players[playerID];
        if (!seat || !seat.name) {
          ctx.status = 404;
          ctx.body = { error: `Player ${playerID} not found in this room` };
          return;
        }

        if (seat.name !== playerName) {
          ctx.status = 409;
          ctx.body = { error: 'Seat does not belong to this player name' };
          return;
        }

        if (seat.isConnected) {
          ctx.status = 409;
          ctx.body = { error: 'Player is already connected' };
          return;
        }

        const playerCredentials = randomUUID();
        seat.credentials = playerCredentials;
        await server.db.setMetadata(gameID, metadata);

        ctx.status = 200;
        ctx.body = { playerID, playerCredentials };
      } catch (err) {
        console.error('Error reclaiming seat:', err);
        ctx.status = 500;
        ctx.body = { error: 'Internal server error' };
      }
      return;
    }
  }
  await next();
});

// boardgame.io's own /leave route only mutates the DB — unlike this app's
// custom /kick and /reclaim routes, it never pushes anything to already
// -connected sockets (matchData is only ever pushed by boardgame.io itself
// on a socket connect/disconnect, via onConnectionChange), so without this,
// other players' rosters go stale until something else happens to trigger
// a resync. This wraps around boardgame.io's real route (letting it run
// via next()) rather than reimplementing it, then broadcasts the fresh
// roster and cleans up the departing player's queue entry the same way
// /kick does, for the same reason: G is frozen after the first move, so a
// leftover buzz would otherwise block whoever later fills that seat.
app.use(async (ctx, next) => {
  const match = ctx.path.match(/^\/games\/buzzer\/([^\/]+)\/leave$/i);
  const isLeave = match && ctx.method === 'POST';

  await next();

  if (isLeave && ctx.status === 200) {
    const gameID = match[1].toUpperCase();
    // boardgame.io's own route (via its own per-route koaBody()) parses the
    // body during next() above, so ctx.request.body is only populated now.
    const playerID = ctx.request.body && ctx.request.body.playerID;
    try {
      let fetchResult = await server.db.fetch(gameID, {
        metadata: true,
        state: true,
        log: true,
        initialState: true,
      });
      let metadata = fetchResult ? fetchResult.metadata : null;

      // Match still exists (i.e. this wasn't the last player leaving, which
      // wipes the room entirely) - clean up and notify.
      if (metadata) {
        if (
          playerID !== null &&
          playerID !== undefined &&
          fetchResult.state &&
          fetchResult.state.G &&
          fetchResult.state.G.queue &&
          fetchResult.state.G.queue[playerID]
        ) {
          const newQueue = { ...fetchResult.state.G.queue };
          delete newQueue[playerID];
          const state = {
            ...fetchResult.state,
            G: { ...fetchResult.state.G, queue: newQueue },
          };
          await server.db.setState(gameID, state);
          // Re-fetch so the broadcast below carries the updated state, not
          // the pre-cleanup snapshot.
          fetchResult = await server.db.fetch(gameID, {
            metadata: true,
            state: true,
            log: true,
            initialState: true,
          });
          metadata = fetchResult.metadata;
        }

        const activeSockets = ctx.app.context.activeSockets;
        if (activeSockets) {
          const filteredMetadata = Object.values(metadata.players).map((p) => ({
            id: p.id,
            name: p.name,
            isConnected: p.isConnected || false,
          }));
          const syncInfo = {
            state: {
              ...fetchResult.state,
              deltalog: undefined,
              _undo: [],
              _redo: [],
            },
            log: fetchResult.log || [],
            filteredMetadata,
            initialState: fetchResult.initialState,
          };
          for (const info of activeSockets.values()) {
            // Skip the leaving player's own socket: they already know they
            // left, and this broadcast is only for everyone else's view.
            if (
              info.gameID === gameID &&
              String(info.playerID) !== String(playerID)
            ) {
              info.socket.emit('sync', gameID, syncInfo);
            }
          }
        }
      }
    } catch (err) {
      console.error('Error broadcasting after leave:', err);
    }
  }
});

const roomLifetimes = new Map();

function startRoomCleanupCron(
  serverInstance,
  intervalMs = 60000,
  maxAgeMs = 6 * 60 * 60 * 1000, // 6 hours
  maxIdleMs = 1 * 60 * 60 * 1000 // 1 hour
) {
  const interval = setInterval(() => {
    try {
      const gameIDs = serverInstance.db.listMatches({ gameName: Buzzer.name });
      const now = Date.now();

      // Clean up tracked rooms that no longer exist in db
      for (const trackedID of roomLifetimes.keys()) {
        if (!gameIDs.includes(trackedID)) {
          roomLifetimes.delete(trackedID);
        }
      }

      for (const gameID of gameIDs) {
        // Fetch current state
        const fetchResult = serverInstance.db.fetch(gameID, { state: true });
        const state = fetchResult ? fetchResult.state : null;
        const currentStateID = state ? state._stateID : 0;

        if (!roomLifetimes.has(gameID)) {
          // Initialize tracking for newly discovered room
          roomLifetimes.set(gameID, {
            createdAt: now,
            lastActivityAt: now,
            lastStateID: currentStateID,
          });
          continue;
        }

        const tracking = roomLifetimes.get(gameID);

        // Update activity if state ID changed (new move made)
        if (currentStateID !== tracking.lastStateID) {
          tracking.lastActivityAt = now;
          tracking.lastStateID = currentStateID;
        }

        const ageMs = now - tracking.createdAt;
        const idleMs = now - tracking.lastActivityAt;

        if (ageMs >= maxAgeMs || idleMs >= maxIdleMs) {
          console.log(
            `[CRON] Wiping room ${gameID}. Age: ${Math.round(
              ageMs / 60000
            )}m, Idle: ${Math.round(idleMs / 60000)}m`
          );
          serverInstance.db.wipe(gameID);
          roomLifetimes.delete(gameID);
        }
      }
    } catch (err) {
      console.error('[CRON] Error during room cleanup:', err);
    }
  }, intervalMs);
  return interval;
}

function scheduleDailyRestart() {
  const now = new Date();
  const next3AM = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      3,
      0,
      0,
      0
    )
  );

  // If it's already past 3:00 AM UTC today, target 3:00 AM UTC tomorrow
  if (now.getTime() >= next3AM.getTime()) {
    next3AM.setUTCDate(next3AM.getUTCDate() + 1);
  }

  const msToNext3AM = next3AM.getTime() - now.getTime();

  console.log(
    `[RESTART] Scheduled container exit in ${
      Math.round((msToNext3AM / 3600000) * 10) / 10
    } hours (at 3:00 AM UTC).`
  );

  setTimeout(() => {
    console.log('[RESTART] Exiting process for scheduled daily restart...');
    process.exit(0);
  }, msToNext3AM);
}

// Starts listening and wires up the active-connections tracker + SPA
// fallback. Exported (rather than run unconditionally below) so tests can
// require() this module, boot it on their own port, and tear it down with
// server.kill(...) between test files - without that, every integration
// test would need its own live yarn dev process running first.
async function startServer(port, onReady) {
  const servers = await server.run({ port }, () => {
    // Set up our active connections tracker
    const io = server.app._io;
    if (io) {
      const nsp = io.of('/buzzer');
      const activeSockets = new Map();
      server.app.context.activeSockets = activeSockets;

      nsp.on('connection', (socket) => {
        socket.on('sync', (gameID, playerID) => {
          activeSockets.set(socket.id, { gameID, playerID, socket });
        });

        socket.on('disconnect', () => {
          activeSockets.delete(socket.id);
        });
      });
    }

    // rewrite rule for catching unresolved routes and redirecting to index.html
    // for client-side routing
    server.app.use(async (ctx, next) => {
      await serve(FRONTEND_PATH)(
        Object.assign(ctx, { path: 'index.html' }),
        next
      );
    });

    if (onReady) {
      onReady();
    }
  });
  return servers;
}

/* istanbul ignore next -- exercised via `node src/server.js`, not under test */
if (require.main === module) {
  startServer(PORT, () => {
    startRoomCleanupCron(server);
    scheduleDailyRestart();
  });
}

module.exports = { server, startServer, startRoomCleanupCron, roomLifetimes };
