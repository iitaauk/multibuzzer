// Unit tests for src/lib/store.js's four moves, called directly with a
// hand-built { G } context - no server needed. Matches the long-form move
// shape boardgame.io uses internally: Buzzer.phases.play.moves.<name>.move.
const { Buzzer } = require('../../src/lib/store');

const { buzz, resetBuzzer, resetBuzzers, toggleLock } = Buzzer.phases.play.moves;

describe('store.js moves', () => {
  describe('buzz', () => {
    test('adds a queue entry for a first-time buzzer', () => {
      const G = { queue: {}, locked: false };
      buzz.move({ G }, '0');
      expect(G.queue['0']).toBeDefined();
      expect(G.queue['0'].id).toBe('0');
      expect(typeof G.queue['0'].timestamp).toBe('number');
    });

    test('double-entry guard: a second buzz for an id already in the queue is a no-op', () => {
      const G = { queue: { '0': { id: '0', timestamp: 12345 } }, locked: false };
      buzz.move({ G }, '0');
      // Must still be the original entry, not overwritten with a new timestamp.
      expect(G.queue['0']).toEqual({ id: '0', timestamp: 12345 });
    });

    test('does not disturb other players already in the queue', () => {
      const G = { queue: { '1': { id: '1', timestamp: 1 } }, locked: false };
      buzz.move({ G }, '0');
      expect(G.queue['1']).toEqual({ id: '1', timestamp: 1 });
      expect(G.queue['0'].id).toBe('0');
    });
  });

  describe('resetBuzzer', () => {
    test('removes only the given id, leaving others intact', () => {
      const G = {
        queue: { '0': { id: '0', timestamp: 1 }, '1': { id: '1', timestamp: 2 } },
        locked: false,
      };
      resetBuzzer.move({ G }, '1');
      expect(G.queue['1']).toBeUndefined();
      expect(G.queue['0']).toEqual({ id: '0', timestamp: 1 });
    });

    test('on an id that was never in the queue is a no-op, not a crash', () => {
      const G = { queue: { '0': { id: '0', timestamp: 1 } }, locked: false };
      expect(() => resetBuzzer.move({ G }, 'never-there')).not.toThrow();
      expect(G.queue).toEqual({ '0': { id: '0', timestamp: 1 } });
    });

    test('on an already-empty queue is a no-op, not a crash', () => {
      const G = { queue: {}, locked: false };
      expect(() => resetBuzzer.move({ G }, '0')).not.toThrow();
      expect(G.queue).toEqual({});
    });
  });

  describe('resetBuzzers', () => {
    test('clears every entry', () => {
      const G = {
        queue: { '0': { id: '0', timestamp: 1 }, '1': { id: '1', timestamp: 2 } },
        locked: false,
      };
      resetBuzzers.move({ G });
      expect(G.queue).toEqual({});
    });

    test('on an already-empty queue is a no-op, not a crash', () => {
      const G = { queue: {}, locked: false };
      expect(() => resetBuzzers.move({ G })).not.toThrow();
      expect(G.queue).toEqual({});
    });
  });

  describe('toggleLock', () => {
    test('toggles false -> true -> false', () => {
      const G = { queue: {}, locked: false };
      toggleLock.move({ G });
      expect(G.locked).toBe(true);
      toggleLock.move({ G });
      expect(G.locked).toBe(false);
    });

    test('toggles true -> false starting from a locked state', () => {
      const G = { queue: {}, locked: true };
      toggleLock.move({ G });
      expect(G.locked).toBe(false);
    });
  });
});
