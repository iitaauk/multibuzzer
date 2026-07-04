# Multibuzzer - Architecture and Codebase Guide

This document describes the high-level architecture, tech stack, and key workflows of the **Multibuzzer** application. It serves as context for developers working on this codebase.

---

## 1. Tech Stack Overview

- **Frontend**: React (built via `react-scripts`), utilizing React Router (`react-router-dom` v5) for client-side routing. UI styling is managed with a combination of `react-bootstrap` (v1) and custom vanilla CSS in `src/App.css`.
- **Backend**: Koa.js server wrapper running the `boardgame.io` Game Server.
- **State & Multiplayer**: `boardgame.io` manages room creation, seat assignment, and real-time state synchronization. It uses Socket.io (via `koa-socket-2` wrapper on the server) for WebSocket transport.
- **Runtime**: Native Node.js (v20+ / v26+ compatibility). Backend files use CommonJS syntax (`require`/`module.exports`) to run directly without pre-compilation or legacy pre-loaders like the `esm` package.

---

## 2. Codebase Directory Structure

```
├── public/                 # Static assets (sounds, icons)
├── src/
│   ├── components/
│   │   ├── Header.js       # App navigation header, contains Room QR and Leave action
│   │   ├── Footer.js       # Simple and desktop footer components
│   │   └── Table.js        # Main game board: buzzer button, lists, and host controls
│   ├── containers/
│   │   ├── Lobby.js        # Home page; Join room / Host room forms
│   │   └── Game.js         # Wrapper initiating the boardgame.io socket client
│   ├── lib/
│   │   ├── endpoints.js    # Fetch API client wrapper for backend API calls
│   │   └── store.js        # Game state definitions, moves, and boardgame.io config
│   ├── App.js              # Routing, layout, and client-side auth state
│   ├── App.css             # Main styling, custom color variables (dark mode)
│   ├── index.js            # React application root entrypoint
│   └── server.js           # Koa server, boardgame.io integration, and custom APIs
├── package.json            # Scripts, dependencies, and engines
└── ARCHITECTURE.md         # This guide
```

---

## 3. Key Concepts & Workflows

### A. Room Creation & Joining
1. **Hosting**: A host enters their name on the Lobby screen. The client makes a POST request to `/games/buzzer/create`. The backend creates the room and returns a random 6-character alphabetic `gameID` (e.g. `ABCDEF`).
2. **Seat Allocation**: The host then requests to join that room. The client finds a free seat (player slot) via the GET `/games/buzzer/:id` endpoint and claims it by posting to `/games/buzzer/:id/join`. The server returns the assigned `playerID` and unique `playerCredentials`.
3. **Joining**: Regular players follow the same sequence to claim a vacant seat and receive credentials.

### B. Client-side Routing & Auth
- Client authentication state is saved in the top-level `App` component state (`auth`: `{ playerID, credentials, roomID }`).
- When navigating to `/:id`, React Router compares the URL `:id` with `auth.roomID` and validates that `playerID` and `credentials` exist.
- If invalid or missing, it redirects the user to the Lobby (`/`) while preserving the room ID, pre-filling the join form.
- Disconnecting the client (e.g. clearing auth) instantly triggers a redirect to the Lobby and unmounts the socket client.

### C. Game Loop and Moves (`store.js` & `Table.js`)
- **State Properties**: The game state `G` contains a `queue` of buzzed players (mapping player IDs to timestamps) and a `locked` boolean representing if the buzzer is locked.
- **Moves**: Boardgame.io exposes state-modifying "moves" to the client:
  - `buzz`: Pushes the current player ID and timestamp into the queue.
  - `resetBuzzer`: Removes a specific player ID from the queue.
  - `resetBuzzers`: Empties the entire buzzer queue.
  - `toggleLock`: Locks/unlocks the buzzer.
- **Host Privileges**: The host is calculated dynamically on the client as the lowest connected player ID. The host gets access to settings (Lock/Unlock and Reset).

### D. Server-side Room Cleanup Cron
- The server runs a background interval every 60 seconds.
- It tracks room lifetimes by checking the latest state ID (move counter) of each room.
- If a room exceeds 6 hours in total age or goes completely idle (no new moves) for 1 hour, the server automatically wipes the room from the database.

---

## 4. Development & Running

- **Development Command**: `npx concurrently "PORT=4000 npx react-scripts start" "PORT=4001 node src/server.js"`
- **Production Build**: `react-scripts build`
- **Port Mapping**:
  - React development server runs on port `4000`.
  - Koa / boardgame.io backend runs on port `4001`.
  - In production, Koa serves the static build files from port `4001`, aligning both the client and API on a single port.

---

## 5. Important Implementation Rules

1. **Body Parsing**: Never register body parser middleware (like `koa-body`) globally. Doing so consumes the request stream, which causes downstream boardgame.io routes to fail with `stream is not readable`. Always scope body parsing route-specifically.
2. **ESM vs CommonJS**: Backend code should remain in CommonJS format to ensure it runs cleanly on modern Node.js versions without needing problematic packages like `esm`.
3. **CORS on Custom Routes**: Because the client (4000) and server (4001) run on different ports in development, any custom HTTP endpoints added to the server must explicitly handle CORS preflight (`OPTIONS` request) and set appropriate `Access-Control-Allow-*` response headers.
