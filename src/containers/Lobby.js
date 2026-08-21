import React, { useState } from 'react';
import { Container, Form } from 'react-bootstrap';
import { useLocation, useHistory } from 'react-router-dom';
import { get } from 'lodash';
import { AiOutlineTeam, AiOutlineMobile, AiOutlineHeart } from 'react-icons/ai';
import { joinRoom, reclaimRoom, getRoom, createRoom } from '../lib/endpoints';
import Header from '../components/Header';
import Footer, { FooterSimple } from '../components/Footer';

const ERROR_TYPE = {
  emptyCode: 'emptyCode',
  roomCode: 'roomCode',
  name: 'name',
  hostRoom: 'hostRoom',
  fullRoom: 'fullRoom',
  dupName: 'dupName',
};

const ERROR_MESSAGE = {
  [ERROR_TYPE.emptyCode]: 'Please enter a room code',
  [ERROR_TYPE.roomCode]: 'Unable to join room with this code',
  [ERROR_TYPE.name]: 'Please enter your player name',
  [ERROR_TYPE.dupName]: 'Player name already taken',
  [ERROR_TYPE.hostRoom]: 'Unable to create room, please try again',
  [ERROR_TYPE.fullRoom]: 'Room has reached capacity',
};

export default function Lobby({ setAuth }) {
  const location = useLocation();
  const prefilledRoomID = get(location, 'state.roomID');

  const history = useHistory();
  const [name, setName] = useState('');
  const [room, setRoom] = useState(prefilledRoomID || '');
  const [joinMode, setJoinMode] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // enter room: find room, then join it
  async function enterRoom(roomId, hosting = false) {
    if (!hosting) {
      setLoading(true);
    }

    try {
      // get room
      const roomRes = await getRoom(roomId);
      if (roomRes.status !== 200) {
        throw new Error(ERROR_TYPE.roomCode);
      }
      const room = roomRes.data;

      // determine seat to take
      const playerSeat = room.players.find((player) => player.name === name);
      const freeSeat = room.players.find((player) => !player.name);

      if (playerSeat && playerSeat.isConnected) {
        throw new Error(ERROR_TYPE.dupName);
      }
      if (!playerSeat && !freeSeat) {
        throw new Error(ERROR_TYPE.fullRoom);
      }
      const playerID = get(playerSeat, 'id', get(freeSeat, 'id'));
      // a seat with our name that's currently disconnected is ours to
      // reclaim; an empty seat is joined the normal way
      const joinRes = playerSeat
        ? await reclaimRoom(room.matchID, playerID, name)
        : await joinRoom(room.matchID, playerID, name);
      if (joinRes.status !== 200) {
        throw new Error(ERROR_TYPE.roomCode);
      }
      const creds = joinRes.data;
      const auth = {
        playerID,
        credentials: creds.playerCredentials,
        roomID: room.matchID,
      };

      // save auth and go to room
      setAuth(auth);
      setLoading(false);
      history.push(`/${room.matchID}`);
    } catch (error) {
      setLoading(false);
      setError(ERROR_MESSAGE[error.message]);
    }
  }

  // make room: create room, then join it
  async function makeRoom() {
    setLoading(true);
    try {
      const createRes = await createRoom();
      if (createRes.status !== 200) {
        throw new Error(ERROR_TYPE.hostRoom);
      }
      const roomID = createRes.data.matchID;
      await enterRoom(roomID, true);
    } catch (error) {
      setLoading(false);
      setError(ERROR_MESSAGE[error.message]);
    }
  }

  function handleSubmit(event) {
    event.preventDefault();

    // validate room and/or player name has been filled
    if (joinMode) {
      if (room.trim().length === 0) {
        setError(ERROR_MESSAGE[ERROR_TYPE.emptyCode]);
      } else if (name.trim().length === 0) {
        setError(ERROR_MESSAGE[ERROR_TYPE.name]);
      } else if (room.trim().length !== 6) {
        setError(ERROR_MESSAGE[ERROR_TYPE.roomCode]);
      } else {
        enterRoom(room);
      }
    } else {
      if (name.trim().length === 0) {
        setError(ERROR_MESSAGE[ERROR_TYPE.name]);
      } else {
        makeRoom();
      }
    }
  }

  const modeTabs = (
    <div className="mode-tabs" role="tablist">
      <button
        type="button"
        role="tab"
        aria-selected={joinMode}
        className={joinMode ? 'active' : ''}
        onClick={() => {
          setError('');
          setJoinMode(true);
        }}
      >
        Join a game
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={!joinMode}
        className={!joinMode ? 'active' : ''}
        onClick={() => {
          setError('');
          setJoinMode(false);
        }}
      >
        Host a game
      </button>
    </div>
  );

  const form = joinMode ? (
    <Form className="lobby-form" onSubmit={(e) => handleSubmit(e)}>
      {modeTabs}
      <Form.Group controlId="room">
        <Form.Label>Room code</Form.Label>
        <Form.Control
          value={room}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="characters"
          spellCheck="false"
          onChange={(e) => {
            setError('');
            setRoom(e.target.value);
          }}
        />
      </Form.Group>

      <Form.Group controlId="name">
        <Form.Label>Your name</Form.Label>
        <Form.Control
          value={name}
          onChange={(e) => {
            setError('');
            setName(e.target.value);
          }}
        />
      </Form.Group>

      <div className="error-message">{error}</div>
      <button type="submit" disabled={loading}>
        {loading ? 'Joining...' : 'Join'}
      </button>
    </Form>
  ) : (
    <Form className="lobby-form" onSubmit={(e) => handleSubmit(e)}>
      {modeTabs}
      <Form.Group controlId="name">
        <Form.Label>Your name</Form.Label>
        <Form.Control
          value={name}
          onChange={(e) => {
            setError('');
            setName(e.target.value);
          }}
        />
      </Form.Group>

      <div className="error-message">{error}</div>
      <button type="submit" disabled={loading}>
        {loading ? 'Creating...' : 'Host'}
      </button>
    </Form>
  );

  const touts = (
    <div className="touts">
      <div className="tout">
        <AiOutlineTeam className="tout-icon" />
        <div>
          <h4>Simple multiplayer buzzer system</h4>
          <p>Host a room and invite up to 200 people to join</p>
        </div>
      </div>
      <div className="tout">
        <AiOutlineMobile className="tout-icon" />
        <div>
          <h4>Join on any device</h4>
          <p>
            Use your computer, smartphone, or tablet to join and start buzzing
          </p>
        </div>
      </div>
      <div className="tout">
        <AiOutlineHeart className="tout-icon" />
        <div>
          <h4>Free to use</h4>
          <p>
            Perfect for online quiz bowl, trivia night, or a classroom activity
          </p>
        </div>
      </div>
    </div>
  );

  return (
    <main id="lobby">
      <section className="primary d-none d-md-flex">
        <div id="lobby-left">
          <div>
            <Header />
            <section className="container-half">{touts}</section>
          </div>
          <section className="container-half">
            <FooterSimple />
          </section>
        </div>
        <div id="lobby-right">
          <section className="container-half">{form}</section>
        </div>
      </section>
      <section className="primary d-block d-md-none">
        <Header />
        <Container className="container-mobile">{form}</Container>
        <div className="divider" />
        <Container className="container-mobile">{touts}</Container>
      </section>
      <Footer mobileOnly />
    </main>
  );
}
