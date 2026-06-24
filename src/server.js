import path from 'path';
import serve from 'koa-static';
import ratelimit from 'koa-ratelimit';
import { v4 as uuidv4 } from 'uuid';

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
