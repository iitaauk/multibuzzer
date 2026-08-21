const { ActivePlayers } = require('boardgame.io/core');

// All moves ignore stale stateID: many players can buzz within the same
// server tick, and rejecting a move whose client-side state has been
// superseded by another player's buzz would silently drop it instead of
// queuing it.
function resetBuzzers({ G }) {
  G.queue = {};
}

function resetBuzzer({ G }, id) {
  const newQueue = { ...G.queue };
  delete newQueue[id];
  G.queue = newQueue;
}

function toggleLock({ G }) {
  G.locked = !G.locked;
}

function buzz({ G }, id) {
  const newQueue = {
    ...G.queue,
  };
  if (!newQueue[id]) {
    // buzz on server will overwrite the client provided timestamp
    newQueue[id] = { id, timestamp: new Date().getTime() };
  }
  G.queue = newQueue;
}

const Buzzer = {
  name: 'buzzer',
  minPlayers: 2,
  maxPlayers: 200,
  setup: () => ({ queue: {}, locked: false }),
  phases: {
    play: {
      start: true,
      moves: {
        buzz: { move: buzz, ignoreStaleStateID: true },
        resetBuzzer: { move: resetBuzzer, ignoreStaleStateID: true },
        resetBuzzers: { move: resetBuzzers, ignoreStaleStateID: true },
        toggleLock: { move: toggleLock, ignoreStaleStateID: true },
      },
      turn: {
        activePlayers: ActivePlayers.ALL,
      },
    },
  },
};

module.exports = { Buzzer };
