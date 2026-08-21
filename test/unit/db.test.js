// Unit tests for src/lib/db.js's CappedInMemory. Stock boardgame.io
// InMemory keeps an unbounded move log per match and never clears it (or
// the initial-state snapshot) on wipe() - both were real bugs found during
// the migration off the frozen boardgame.io fork, so regression coverage
// here has real value.
const { CappedInMemory } = require('../../src/lib/db');

const MATCH_ID = 'TESTID';

function makeDb() {
  const db = new CappedInMemory();
  db.createMatch(MATCH_ID, {
    initialState: { G: {}, ctx: {}, _stateID: 0 },
    metadata: { gameName: 'buzzer', players: {} },
  });
  return db;
}

describe('CappedInMemory', () => {
  test('the 200-entry log cap actually caps, keeping the most recent entries', () => {
    const db = makeDb();

    for (let i = 0; i < 250; i++) {
      db.setState(MATCH_ID, { G: {}, ctx: {}, _stateID: i + 1 }, [{ seq: i }]);
    }

    const { log } = db.fetch(MATCH_ID, { log: true });
    expect(log).toHaveLength(200);
    // Entries 0-49 should have been dropped; 50-249 (the most recent 200)
    // should remain, oldest-first within the retained window.
    expect(log[0].seq).toBe(50);
    expect(log[log.length - 1].seq).toBe(249);
  });

  test('setState without a deltalog does not touch the existing log', () => {
    const db = makeDb();
    db.setState(MATCH_ID, { G: {}, ctx: {} }, [{ seq: 1 }]);
    db.setState(MATCH_ID, { G: { after: true }, ctx: {} }); // no deltalog arg
    const { log, state } = db.fetch(MATCH_ID, { log: true, state: true });
    expect(log).toEqual([{ seq: 1 }]);
    expect(state.G).toEqual({ after: true });
  });

  test('wipe() clears all four internal maps, not just state', () => {
    const db = makeDb();
    db.setState(MATCH_ID, { G: {}, ctx: {} }, [{ seq: 1 }]);

    // Sanity check everything was actually populated before wiping.
    expect(db.state.has(MATCH_ID)).toBe(true);
    expect(db.metadata.has(MATCH_ID)).toBe(true);
    expect(db.log.has(MATCH_ID)).toBe(true);
    expect(db.initial.has(MATCH_ID)).toBe(true);

    db.wipe(MATCH_ID);

    expect(db.state.has(MATCH_ID)).toBe(false);
    expect(db.metadata.has(MATCH_ID)).toBe(false);
    expect(db.log.has(MATCH_ID)).toBe(false);
    expect(db.initial.has(MATCH_ID)).toBe(false);

    // fetch() should reflect the wipe too (log defaults to [] when absent).
    const result = db.fetch(MATCH_ID, {
      state: true,
      metadata: true,
      log: true,
      initialState: true,
    });
    expect(result.state).toBeUndefined();
    expect(result.metadata).toBeUndefined();
    expect(result.log).toEqual([]);
    expect(result.initialState).toBeUndefined();
  });

  test('listMatches filters by gameName and reflects wipes', () => {
    const db = makeDb();
    db.createMatch('OTHERID', {
      initialState: { G: {}, ctx: {} },
      metadata: { gameName: 'not-buzzer', players: {} },
    });

    expect(db.listMatches({ gameName: 'buzzer' })).toEqual([MATCH_ID]);
    expect(db.listMatches()).toEqual(expect.arrayContaining([MATCH_ID, 'OTHERID']));

    db.wipe(MATCH_ID);
    expect(db.listMatches({ gameName: 'buzzer' })).toEqual([]);
  });
});
