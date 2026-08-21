import React from 'react';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Howl } from 'howler';
import Table from './Table';

jest.mock('../lib/endpoints', () => ({
  kickPlayer: jest.fn(),
  getRoom: jest.fn(),
}));

function baseGame(overrides = {}) {
  return {
    G: { queue: {}, locked: false },
    ctx: {},
    playerID: '0',
    isConnected: true,
    matchID: 'ABCDEF',
    moves: {
      buzz: jest.fn(),
      resetBuzzer: jest.fn(),
      resetBuzzers: jest.fn(),
      toggleLock: jest.fn(),
    },
    matchData: [
      { id: 0, name: 'Host', isConnected: true },
      { id: 1, name: 'Alice', isConnected: true },
    ],
    headerData: {
      setAuth: jest.fn(),
      credentials: 'creds',
      playerID: '0',
      roomID: 'ABCDEF',
    },
    ...overrides,
  };
}

describe('Table buzz sound', () => {
  let playSpy;

  beforeEach(() => {
    // Table.js constructs a new Howl on every render, so spy on the
    // prototype method rather than mocking the module/constructor - that
    // way every instance, across every render, shares the same spy.
    playSpy = jest.spyOn(Howl.prototype, 'play').mockImplementation(() => {});
  });

  afterEach(() => {
    playSpy.mockRestore();
  });

  test('plays a sound for every distinct buzz, not just the first', () => {
    const game = baseGame();
    const { rerender } = render(<Table {...game} />);
    expect(playSpy).toHaveBeenCalledTimes(0);

    // Player 0 buzzes.
    rerender(<Table {...baseGame({ G: { queue: { '0': { id: '0', timestamp: 1 } }, locked: false } })} />);
    expect(playSpy).toHaveBeenCalledTimes(1);

    // Player 1 buzzes too, no reset in between - this is the bug: previously
    // this second, distinct buzz produced zero additional sound.
    rerender(
      <Table
        {...baseGame({
          G: {
            queue: {
              '0': { id: '0', timestamp: 1 },
              '1': { id: '1', timestamp: 2 },
            },
            locked: false,
          },
        })}
      />
    );
    expect(playSpy).toHaveBeenCalledTimes(2);
  });

  test('a player reset via resetBuzzer sounds again on their next buzz', () => {
    const { rerender } = render(<Table {...baseGame()} />);

    // Player 1 buzzes for the first time, after mount - not part of the
    // initial (non-sounding) mount state, unlike the "joining mid-round"
    // case above.
    rerender(
      <Table {...baseGame({ G: { queue: { '1': { id: '1', timestamp: 1 } }, locked: false } })} />
    );
    expect(playSpy).toHaveBeenCalledTimes(1);

    // Host resets just player 1's buzz.
    rerender(<Table {...baseGame({ G: { queue: {}, locked: false } })} />);
    expect(playSpy).toHaveBeenCalledTimes(1);

    // Player 1 buzzes again - must sound, not be silenced by stale state.
    rerender(
      <Table
        {...baseGame({ G: { queue: { '1': { id: '1', timestamp: 2 } }, locked: false } })}
      />
    );
    expect(playSpy).toHaveBeenCalledTimes(2);
  });

  test('joining mid-round with an already non-empty queue does not sound on mount', () => {
    const game = baseGame({
      G: { queue: { '1': { id: '1', timestamp: 1 } }, locked: false },
    });
    render(<Table {...game} />);
    expect(playSpy).toHaveBeenCalledTimes(0);
  });

  test('re-rendering with an unchanged queue does not replay the sound', () => {
    const queueState = { queue: { '1': { id: '1', timestamp: 1 } }, locked: false };
    const { rerender } = render(<Table {...baseGame()} />);
    rerender(<Table {...baseGame({ G: queueState })} />);
    expect(playSpy).toHaveBeenCalledTimes(1);

    // Same queue content, new object reference (as a real move broadcast
    // would produce even for an unrelated field like `locked`).
    rerender(<Table {...baseGame({ G: { ...queueState, locked: true } })} />);
    expect(playSpy).toHaveBeenCalledTimes(1);
  });
});
