import React, { useState } from 'react';
import { Navbar, Modal } from 'react-bootstrap';
import { isNil } from 'lodash';
import { useHistory } from 'react-router';
import { leaveRoom } from '../lib/endpoints';
import { QRCodeSVG } from 'qrcode.react';

function Logo({ size = 25 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 95 95"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="20" cy="20" r="20" fill="#F2994A" />
      <circle cx="75" cy="20" r="20" fill="#348DF5" />
      <circle cx="20" cy="75" r="20" fill="#348DF5" />
      <circle cx="75" cy="75" r="20" fill="#348DF5" />
    </svg>
  );
}

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
        <Navbar.Brand>
          <Logo /> Multibuzzer
        </Navbar.Brand>
        <div className="nav-buttons">
          {isHost && auth.roomID ? (
            <button className="text-button" onClick={() => setShowQR(true)}>
              Show Room QR
            </button>
          ) : null}
          {!isNil(sound) ? (
            <button className="text-button" onClick={() => setSound()}>
              {sound ? 'Turn off sound' : 'Turn on sound'}
            </button>
          ) : null}
          {clearAuth ? (
            <button className="text-button" onClick={() => leave()}>
              Leave game
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
