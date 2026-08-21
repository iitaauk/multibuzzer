import React, { useState } from 'react';
import { Navbar, Modal } from 'react-bootstrap';
import { isNil } from 'lodash';
import { useHistory } from 'react-router';
import {
  AiOutlineBell,
  AiOutlineQrcode,
  AiOutlineSound,
  AiOutlineAudioMuted,
  AiOutlineLogout,
} from 'react-icons/ai';
import { leaveRoom } from '../lib/endpoints';
import { QRCodeSVG } from 'qrcode.react';

export default function Header({
  auth = {},
  clearAuth,
  sound = null,
  setSound,
  isHost = false,
}) {
  const history = useHistory();
  const [showQR, setShowQR] = useState(false);
  const qrUrl = auth.roomID ? `${window.location.origin}/${auth.roomID}` : '';

  // leave current game
  async function leave() {
    try {
      await leaveRoom(auth.roomID, auth.playerID, auth.credentials);
      clearAuth();
      history.push('/');
    } catch (error) {
      console.log('leave error', error);
      clearAuth();
      history.push('/');
    }
  }

  return (
    <header>
      <Navbar>
        <span className="navbar-brand">
          <AiOutlineBell />
          Buzzer
        </span>
        <div className="nav-buttons">
          {isHost && auth.roomID ? (
            <button
              className="icon-button"
              title="Show Room QR"
              aria-label="Show Room QR"
              onClick={() => setShowQR(true)}
            >
              <AiOutlineQrcode />
            </button>
          ) : null}
          {!isNil(sound) ? (
            <button
              className="icon-button"
              title={sound ? 'Turn off sound' : 'Turn on sound'}
              aria-label={sound ? 'Turn off sound' : 'Turn on sound'}
              onClick={() => setSound()}
            >
              {sound ? <AiOutlineSound /> : <AiOutlineAudioMuted />}
            </button>
          ) : null}
          {clearAuth ? (
            <button
              className="icon-button"
              title="Leave game"
              aria-label="Leave game"
              onClick={() => leave()}
            >
              <AiOutlineLogout />
            </button>
          ) : null}
        </div>
      </Navbar>
      <Modal
        show={showQR}
        onHide={() => setShowQR(false)}
        centered
        dialogClassName="qr-modal"
      >
        <Modal.Header closeButton>
          <Modal.Title>Room QR Code</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="dim">
            Scan this QR code with a mobile device to join Room{' '}
            <strong>{auth.roomID}</strong>:
          </p>
          <div className="qr-container">
            {qrUrl ? <QRCodeSVG value={qrUrl} size={200} /> : null}
          </div>
          <div>
            <a href={qrUrl} target="_blank" rel="noopener noreferrer">
              {qrUrl}
            </a>
          </div>
        </Modal.Body>
      </Modal>
    </header>
  );
}
