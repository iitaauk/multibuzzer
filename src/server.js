const path = require('path');
const serve = require('koa-static');
const ratelimit = require('koa-ratelimit');
const { v4: uuidv4 } = require('uuid');
const koaBody = require('koa-body');

const Server = require('boardgame.io/server').Server;
const Buzzer = require('./lib/store').Buzzer;
const server = Server({ games: [Buzzer], generateCredentials: () => uuidv4() });

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

function randomString(length, chars) {
  let result = '';
  // eslint-disable-next-line no-plusplus
  for (let i = length; i > 0; --i)
    result += chars[Math.floor(Math.random() * chars.length)];
  return result;
}

// rate limiter
const db = new Map();
app.use(
  ratelimit({
    driver: 'memory',
    db: db,
    // 1 min window
    duration: 60000,
    errorMessage: 'Too many requests',
    id: (ctx) => ctx.ip,
    max: 25,
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

        // Verify if hostPlayerID is the actual host (lowest registered player ID with a name)
        const registeredPlayers = Object.entries(metadata.players)
          .filter(([id, p]) => p.name)
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
            state.G.queue = newQueue;
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
            connected: p.connected || false,
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

const roomLifetimes = new Map();

function startRoomCleanupCron(serverInstance, intervalMs = 60000) {
  setInterval(() => {
    try {
      const gameIDs = serverInstance.db.listGames({ gameName: Buzzer.name });
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

        const maxAgeMs = 6 * 60 * 60 * 1000; // 6 hours
        const maxIdleMs = 1 * 60 * 60 * 1000; // 1 hour

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

server.run(
  {
    port: PORT,
    lobbyConfig: { uuid: () => randomString(6, 'ABCDEFGHJKLMNPQRSTUVWXYZ') },
  },
  () => {
    // Start the room cleanup cron
    startRoomCleanupCron(server);

    // Start the daily restart scheduler
    scheduleDailyRestart();

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
  }
);
