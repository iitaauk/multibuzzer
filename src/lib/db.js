const { Sync } = require('boardgame.io/internal');

const MAX_LOG_LENGTH = 200;

// boardgame.io's built-in InMemory store keeps an unbounded move log per
// match and never clears it on wipe(). For a buzzer room that can hold 200
// players and lives for hours, that log gets replayed in full to every
// reconnecting client, so it's capped here the same way the app's old
// boardgame.io fork capped it.
class CappedInMemory extends Sync {
  constructor() {
    super();
    this.state = new Map();
    this.initial = new Map();
    this.metadata = new Map();
    this.log = new Map();
  }

  createMatch(matchID, opts) {
    this.initial.set(matchID, opts.initialState);
    this.setState(matchID, opts.initialState);
    this.setMetadata(matchID, opts.metadata);
  }

  setMetadata(matchID, metadata) {
    this.metadata.set(matchID, metadata);
  }

  setState(matchID, state, deltalog) {
    if (deltalog && deltalog.length > 0) {
      const log = this.log.get(matchID) || [];
      this.log.set(matchID, [...log, ...deltalog].slice(-MAX_LOG_LENGTH));
    }
    this.state.set(matchID, state);
  }

  fetch(matchID, opts) {
    const result = {};
    if (opts.state) {
      result.state = this.state.get(matchID);
    }
    if (opts.metadata) {
      result.metadata = this.metadata.get(matchID);
    }
    if (opts.log) {
      result.log = this.log.get(matchID) || [];
    }
    if (opts.initialState) {
      result.initialState = this.initial.get(matchID);
    }
    return result;
  }

  wipe(matchID) {
    this.state.delete(matchID);
    this.metadata.delete(matchID);
    this.log.delete(matchID);
    this.initial.delete(matchID);
  }

  listMatches(opts) {
    return [...this.metadata.entries()]
      .filter(([, metadata]) => {
        if (!opts) {
          return true;
        }
        if (opts.gameName !== undefined && metadata.gameName !== opts.gameName) {
          return false;
        }
        return true;
      })
      .map(([key]) => key);
  }
}

module.exports = { CappedInMemory };
