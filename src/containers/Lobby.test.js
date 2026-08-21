import React from 'react';
import { render, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import Lobby from './Lobby';
import { joinRoom, reclaimRoom, getRoom, createRoom } from '../lib/endpoints';

jest.mock('../lib/endpoints', () => ({
  joinRoom: jest.fn(),
  reclaimRoom: jest.fn(),
  getRoom: jest.fn(),
  createRoom: jest.fn(),
}));

// Lobby renders two copies of the form side by side (one for the desktop
// layout, one for the mobile layout - both always in the DOM, just
// CSS-toggled per App.css's d-none/d-block breakpoint classes), so an
// unscoped query like screen.getByText('Join') always finds two matches.
// #lobby-right is the desktop layout's unique wrapper - scope every query
// to it so tests interact with exactly one copy of the (shared-state) form.
function renderLobby(setAuth = jest.fn()) {
  const utils = render(
    <MemoryRouter>
      <Lobby setAuth={setAuth} />
    </MemoryRouter>
  );
  const screen = within(utils.container.querySelector('#lobby-right'));
  return { ...utils, screen };
}

describe('Lobby', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('host-mode vs join-mode form switching', () => {
    test('starts in join mode by default', () => {
      const { screen } = renderLobby();
      expect(screen.getByText('Join a game')).toBeInTheDocument();
      expect(screen.getByLabelText('Room code')).toBeInTheDocument();
    });

    test('"Create room" switches to host mode, hiding the room code field', () => {
      const { screen } = renderLobby();
      fireEvent.click(screen.getByText('Create room'));
      expect(screen.getByText('Host a game')).toBeInTheDocument();
      expect(screen.queryByLabelText('Room code')).not.toBeInTheDocument();
    });

    test('"Enter room" switches back to join mode', () => {
      const { screen } = renderLobby();
      fireEvent.click(screen.getByText('Create room'));
      fireEvent.click(screen.getByText('Enter room'));
      expect(screen.getByText('Join a game')).toBeInTheDocument();
    });
  });

  describe('validation errors', () => {
    test('submitting join mode with an empty room code shows the emptyCode message', () => {
      const { screen } = renderLobby();
      fireEvent.click(screen.getByText('Join'));
      expect(screen.getByText('Please enter a room code')).toBeInTheDocument();
    });

    test('submitting join mode with a room code but no name shows the name message', () => {
      const { screen } = renderLobby();
      fireEvent.change(screen.getByLabelText('Room code'), { target: { value: 'ABCDEF' } });
      fireEvent.click(screen.getByText('Join'));
      expect(screen.getByText('Please enter your player name')).toBeInTheDocument();
    });

    test('submitting join mode with a room code of the wrong length shows the roomCode message', () => {
      const { screen } = renderLobby();
      fireEvent.change(screen.getByLabelText('Room code'), { target: { value: 'ABC' } });
      fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Alice' } });
      fireEvent.click(screen.getByText('Join'));
      expect(screen.getByText('Unable to join room with this code')).toBeInTheDocument();
    });

    test('submitting host mode with no name shows the name message', () => {
      const { screen } = renderLobby();
      fireEvent.click(screen.getByText('Create room'));
      fireEvent.click(screen.getByText('Host'));
      expect(screen.getByText('Please enter your player name')).toBeInTheDocument();
    });

    test('typing into a field clears any existing error', () => {
      const { screen } = renderLobby();
      fireEvent.click(screen.getByText('Join'));
      expect(screen.getByText('Please enter a room code')).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('Room code'), { target: { value: 'A' } });
      expect(screen.queryByText('Please enter a room code')).not.toBeInTheDocument();
    });
  });

  describe('ERROR_TYPE / ERROR_MESSAGE mapping via failed API calls', () => {
    test('a nonexistent room (getRoom non-200) maps to the roomCode message', async () => {
      getRoom.mockResolvedValue({ status: 404, data: null });
      const { screen } = renderLobby();

      fireEvent.change(screen.getByLabelText('Room code'), { target: { value: 'ABCDEF' } });
      fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Alice' } });
      fireEvent.click(screen.getByText('Join'));

      await waitFor(() =>
        expect(screen.getByText('Unable to join room with this code')).toBeInTheDocument()
      );
    });

    test('a full room (no matching or free seat) maps to the fullRoom message', async () => {
      getRoom.mockResolvedValue({
        status: 200,
        data: {
          matchID: 'ABCDEF',
          players: [
            { id: 0, name: 'Bob' },
            { id: 1, name: 'Carol' },
          ],
        },
      });
      const { screen } = renderLobby();

      fireEvent.change(screen.getByLabelText('Room code'), { target: { value: 'ABCDEF' } });
      fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Alice' } });
      fireEvent.click(screen.getByText('Join'));

      await waitFor(() => expect(screen.getByText('Room has reached capacity')).toBeInTheDocument());
    });

    test('a name matching an already-connected seat maps to the dupName message', async () => {
      getRoom.mockResolvedValue({
        status: 200,
        data: {
          matchID: 'ABCDEF',
          players: [{ id: 0, name: 'Alice', isConnected: true }],
        },
      });
      const { screen } = renderLobby();

      fireEvent.change(screen.getByLabelText('Room code'), { target: { value: 'ABCDEF' } });
      fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Alice' } });
      fireEvent.click(screen.getByText('Join'));

      await waitFor(() => expect(screen.getByText('Player name already taken')).toBeInTheDocument());
    });

    test('createRoom failure in host mode maps to the hostRoom message', async () => {
      createRoom.mockResolvedValue({ status: 500, data: null });
      const { screen } = renderLobby();

      fireEvent.click(screen.getByText('Create room'));
      fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Alice' } });
      fireEvent.click(screen.getByText('Host'));

      await waitFor(() =>
        expect(screen.getByText('Unable to create room, please try again')).toBeInTheDocument()
      );
    });
  });

  describe('successful join/host flows', () => {
    test('joining a free seat calls joinRoom (not reclaimRoom) and sets auth', async () => {
      const setAuth = jest.fn();
      getRoom.mockResolvedValue({
        status: 200,
        data: { matchID: 'ABCDEF', players: [{ id: 0, name: undefined }] },
      });
      joinRoom.mockResolvedValue({ status: 200, data: { playerCredentials: 'creds-1' } });

      const { screen } = renderLobby(setAuth);
      fireEvent.change(screen.getByLabelText('Room code'), { target: { value: 'ABCDEF' } });
      fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Alice' } });
      fireEvent.click(screen.getByText('Join'));

      await waitFor(() =>
        expect(setAuth).toHaveBeenCalledWith({
          playerID: 0,
          credentials: 'creds-1',
          roomID: 'ABCDEF',
        })
      );
      expect(joinRoom).toHaveBeenCalledWith('ABCDEF', 0, 'Alice');
      expect(reclaimRoom).not.toHaveBeenCalled();
    });

    test('rejoining a disconnected seat with a matching name calls reclaimRoom instead of joinRoom', async () => {
      const setAuth = jest.fn();
      getRoom.mockResolvedValue({
        status: 200,
        data: { matchID: 'ABCDEF', players: [{ id: 0, name: 'Alice', isConnected: false }] },
      });
      reclaimRoom.mockResolvedValue({ status: 200, data: { playerCredentials: 'creds-2' } });

      const { screen } = renderLobby(setAuth);
      fireEvent.change(screen.getByLabelText('Room code'), { target: { value: 'ABCDEF' } });
      fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Alice' } });
      fireEvent.click(screen.getByText('Join'));

      await waitFor(() =>
        expect(setAuth).toHaveBeenCalledWith({
          playerID: 0,
          credentials: 'creds-2',
          roomID: 'ABCDEF',
        })
      );
      expect(reclaimRoom).toHaveBeenCalledWith('ABCDEF', 0, 'Alice');
      expect(joinRoom).not.toHaveBeenCalled();
    });
  });
});
