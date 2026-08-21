import React, { useState, useEffect, useRef } from 'react';
import { get, some, values, sortBy, orderBy, isEmpty, round } from 'lodash';
import { Howl } from 'howler';
import { AiOutlineDisconnect } from 'react-icons/ai';
import { Container } from 'react-bootstrap';
import Header from '../components/Header';
import { kickPlayer, getRoom } from '../lib/endpoints';

export default function Table(game) {
  const [loaded, setLoaded] = useState(false);
  const [buzzed, setBuzzer] = useState(
    some(game.G.queue, (o) => o.id === game.playerID)
  );
  const [lastBuzz, setLastBuzz] = useState(null);
  const [sound, setSound] = useState(true);
  const buzzButton = useRef(null);
  const queueRef = useRef(null);
  // Tracks which player ids currently in the queue we've already played a
  // sound for, so every *distinct* buzz gets its own sound instead of just
  // the first one per round.
  const playedBuzzIdsRef = useRef(new Set());

  const buzzSound = new Howl({
    src: [
      `${process.env.PUBLIC_URL}/shortBuzz.webm`,
      `${process.env.PUBLIC_URL}/shortBuzz.mp3`,
    ],
    volume: 0.5,
    rate: 1.5,
  });

  const playSound = () => {
    if (sound) {
      buzzSound.play();
    }
  };

  useEffect(() => {
    // reset buzzer based on game
    if (!game.G.queue[game.playerID]) {
      // delay the reset, in case game state hasn't reflected your buzz yet
      if (lastBuzz && Date.now() - lastBuzz < 500) {
        setTimeout(() => {
          const queue = queueRef.current;
          if (queue && !queue[game.playerID]) {
            setBuzzer(false);
          }
        }, 500);
      } else {
        // immediate reset, if it's been awhile
        setBuzzer(false);
      }
    }

    // Play a sound for every player whose buzz newly lands in the queue.
    // playedBuzzIdsRef is kept in sync with queue membership: an id is
    // forgotten as soon as it leaves the queue (via resetBuzzer or
    // resetBuzzers), so if that same player buzzes again later they get a
    // fresh sound rather than being silenced by a stale "already played"
    // flag.
    const playedIds = playedBuzzIdsRef.current;
    const currentIds = Object.keys(game.G.queue);
    playedIds.forEach((id) => {
      if (!game.G.queue[id]) {
        playedIds.delete(id);
      }
    });
    currentIds.forEach((id) => {
      if (!playedIds.has(id)) {
        playedIds.add(id);
        // Don't sound on initial mount for buzzes already in the queue
        // (e.g. joining mid-round) - only for buzzes that land afterward.
        if (loaded) {
          playSound();
        }
      }
    });

    if (!loaded) {
      setLoaded(true);
    }

    queueRef.current = game.G.queue;
  }, [game.G.queue]);

  const attemptBuzz = () => {
    if (!buzzed) {
      playSound();
      // Mark our own id as already sounded so the useEffect above doesn't
      // play a second, duplicate sound once the move round-trips and
      // confirms our buzz in the queue.
      playedBuzzIdsRef.current.add(game.playerID);
      game.moves.buzz(game.playerID);
      setBuzzer(true);
      setLastBuzz(Date.now());
    }
  };

  // spacebar will buzz
  useEffect(() => {
    function onKeydown(e) {
      if (e.keyCode === 32 && !e.repeat) {
        buzzButton.current.click();
        e.preventDefault();
      }
    }
    window.addEventListener('keydown', onKeydown);
    return () => window.removeEventListener('keydown', onKeydown);
  }, []);

  // check if kicked out of room
  useEffect(() => {
    if (loaded && game.matchData && game.playerID) {
      const myMeta = game.matchData.find(
        (p) => String(p.id) === String(game.playerID)
      );
      if (!myMeta || !myMeta.name) {
        game.headerData.setAuth({
          playerID: null,
          credentials: null,
          roomID: null,
        });
        alert('You have been removed from the room.');
      }
    }
  }, [loaded, game.matchData, game.playerID, game.headerData]);

  // check if kicked out of room when disconnected
  useEffect(() => {
    let interval;
    if (!game.isConnected && game.playerID && game.matchID) {
      const checkKicked = async () => {
        try {
          const res = await getRoom(game.matchID);
          if (res.status === 200) {
            const room = res.data;
            const myMeta = room.players.find(
              (p) => String(p.id) === String(game.playerID)
            );
            if (!myMeta || !myMeta.name) {
              game.headerData.setAuth({
                playerID: null,
                credentials: null,
                roomID: null,
              });
              alert('You have been removed from the room.');
            }
          }
        } catch (err) {
          console.error(err);
        }
      };

      checkKicked();
      interval = setInterval(checkKicked, 5000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [game.isConnected, game.playerID, game.matchID, game.headerData]);

  const handleKick = async (idToKick) => {
    const playerToKick =
      game.matchData &&
      game.matchData.find((p) => String(p.id) === String(idToKick));
    const nameToKick = playerToKick ? playerToKick.name : 'this player';
    if (window.confirm(`Are you sure you want to kick ${nameToKick}?`)) {
      try {
        const response = await kickPlayer(
          game.matchID,
          idToKick,
          game.playerID,
          game.headerData.credentials
        );
        if (response.status !== 200) {
          alert(response.data.error || 'Failed to kick player');
        }
      } catch (err) {
        console.error(err);
        alert('Failed to kick player');
      }
    }
  };

  const players = !game.matchData
    ? []
    : game.matchData
        .filter((p) => p.name)
        .map((p) => ({
          ...p,
          id: String(p.id),
          connected: !!p.isConnected,
        }));
  // host is lowest active user
  const firstPlayer =
    get(
      sortBy(players, (p) => parseInt(p.id, 10)).filter((p) => p.connected),
      '0'
    ) || null;
  const isHost = get(firstPlayer, 'id') === game.playerID;

  const queue = sortBy(values(game.G.queue), ['timestamp']);
  const buzzedPlayers = queue
    .map((p) => {
      const player = players.find((player) => player.id === p.id);
      if (!player) {
        return {};
      }
      return {
        ...p,
        name: player.name,
        connected: player.connected,
      };
    })
    .filter((p) => p.name);
  // active players who haven't buzzed
  const activePlayers = orderBy(
    players.filter((p) => !some(queue, (q) => q.id === p.id)),
    ['connected', 'name'],
    ['desc', 'asc']
  );

  const timeDisplay = (delta) => {
    if (delta > 1000) {
      return `+${round(delta / 1000, 2)} s`;
    }
    return `+${delta} ms`;
  };

  return (
    <div>
      <Header
        auth={game.headerData}
        clearAuth={() =>
          game.headerData.setAuth({
            playerID: null,
            credentials: null,
            roomID: null,
          })
        }
        sound={sound}
        setSound={() => setSound(!sound)}
        isHost={isHost}
      />
      <Container>
        <section>
          <p id="room-title">Room {game.matchID}</p>
          {!game.isConnected ? (
            <p className="warning">Disconnected - attempting to reconnect...</p>
          ) : null}
          <div id="buzzer">
            <button
              ref={buzzButton}
              disabled={buzzed || game.G.locked}
              onClick={() => {
                if (!buzzed && !game.G.locked) {
                  attemptBuzz();
                }
              }}
            >
              {game.G.locked ? 'Locked' : buzzed ? 'Buzzed' : 'Buzz'}
            </button>
          </div>
          {isHost ? (
            <div className="settings">
              <div className="button-container">
                <button
                  className="text-button"
                  onClick={() => game.moves.toggleLock()}
                >
                  {game.G.locked ? 'Unlock buzzers' : 'Lock buzzers'}
                </button>
              </div>
              <div className="button-container">
                <button
                  disabled={isEmpty(game.G.queue)}
                  onClick={() => game.moves.resetBuzzers()}
                >
                  Reset all buzzers
                </button>
              </div>
              <div className="divider" />
            </div>
          ) : null}
        </section>
        <div className="queue">
          <p>Players Buzzed</p>
          <ul>
            {buzzedPlayers.map(({ id, name, timestamp, connected }, i) => (
              <li key={id} className={isHost ? 'resettable' : null}>
                <div className="player-row">
                  <div
                    className="player-sign"
                    onClick={() => {
                      if (isHost) {
                        game.moves.resetBuzzer(id);
                      }
                    }}
                  >
                    <div className={`name ${!connected ? 'dim' : ''}`}>
                      {name}
                      {!connected ? (
                        <AiOutlineDisconnect className="disconnected" />
                      ) : (
                        ''
                      )}
                    </div>
                    {i > 0 ? (
                      <div className="mini">
                        {timeDisplay(timestamp - queue[0].timestamp)}
                      </div>
                    ) : null}
                  </div>
                  {isHost && id !== game.playerID && (
                    <button
                      className="kick-button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleKick(id);
                      }}
                    >
                      Kick
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="queue">
          <p>Other Players</p>
          <ul>
            {activePlayers.map(({ id, name, connected }) => (
              <li key={id}>
                <div className="player-row">
                  <div className={`name ${!connected ? 'dim' : ''}`}>
                    {name}
                    {!connected ? (
                      <AiOutlineDisconnect className="disconnected" />
                    ) : (
                      ''
                    )}
                  </div>
                  {isHost && id !== game.playerID && (
                    <button
                      className="kick-button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleKick(id);
                      }}
                    >
                      Kick
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </Container>
    </div>
  );
}
