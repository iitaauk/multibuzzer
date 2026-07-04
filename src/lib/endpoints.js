import { Buzzer } from '../lib/store';

const hostname = window.location.hostname;
const port = window.location.port;
const protocol = window.location.protocol;
const gameport = process.env.PORT || 4001;
const url = protocol + '//' + hostname + (port ? ':' + port : '');
const localUrl = `${protocol}//${hostname}:${gameport}`;

const LOBBY_SERVER = process.env.NODE_ENV === 'production' ? url : localUrl;
export const GAME_SERVER =
  process.env.NODE_ENV === 'production' ? url : localUrl;

async function request(url, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...options.headers,
  };

  try {
    const response = await fetch(url, {
      ...options,
      headers,
    });

    let data = null;
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      try {
        data = await response.json();
      } catch (e) {
        // Handle cases where content-type is json but body is empty or invalid
      }
    }

    return {
      status: response.status,
      data,
    };
  } catch (error) {
    return {
      status: 500,
      data: { error: error.message || 'Network error' },
    };
  }
}

export async function getRoom(roomId) {
  // convert to uppercase
  const cleanRoomId = roomId.toUpperCase();
  return request(`${LOBBY_SERVER}/games/${Buzzer.name}/${cleanRoomId}`, {
    method: 'GET',
  });
}

export async function createRoom() {
  return request(`${LOBBY_SERVER}/games/${Buzzer.name}/create`, {
    method: 'POST',
    body: JSON.stringify({
      numPlayers: 200,
    }),
  });
}

export async function joinRoom(roomID, playerID, playerName) {
  return request(`${LOBBY_SERVER}/games/${Buzzer.name}/${roomID}/join`, {
    method: 'POST',
    body: JSON.stringify({
      playerID,
      playerName,
    }),
  });
}

export async function leaveRoom(roomID, playerID, credentials) {
  return request(`${LOBBY_SERVER}/games/${Buzzer.name}/${roomID}/leave`, {
    method: 'POST',
    body: JSON.stringify({
      playerID,
      credentials,
    }),
  });
}

export async function kickPlayer(roomID, playerID, hostPlayerID, credentials) {
  return request(`${LOBBY_SERVER}/games/${Buzzer.name}/${roomID}/kick`, {
    method: 'POST',
    body: JSON.stringify({
      playerID,
      hostPlayerID,
      credentials,
    }),
  });
}
