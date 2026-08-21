import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import Header from './Header';
import { leaveRoom } from '../lib/endpoints';

jest.mock('../lib/endpoints', () => ({
  leaveRoom: jest.fn(),
}));

function renderHeader(props = {}) {
  return render(
    <MemoryRouter>
      <Header {...props} />
    </MemoryRouter>
  );
}

describe('Header', () => {
  beforeEach(() => {
    leaveRoom.mockReset();
  });

  test('leave button calls leaveRoom with auth details, then clearAuth', async () => {
    leaveRoom.mockResolvedValue({ status: 200 });
    const clearAuth = jest.fn();
    const auth = { roomID: 'ABCDEF', playerID: '0', credentials: 'creds-123' };

    renderHeader({ auth, clearAuth });

    fireEvent.click(screen.getByRole('button', { name: 'Leave game' }));

    await waitFor(() => expect(clearAuth).toHaveBeenCalledTimes(1));
    expect(leaveRoom).toHaveBeenCalledWith('ABCDEF', '0', 'creds-123');
  });

  test('leave button still calls clearAuth even if leaveRoom rejects', async () => {
    leaveRoom.mockRejectedValue(new Error('network error'));
    const clearAuth = jest.fn();
    const auth = { roomID: 'ABCDEF', playerID: '0', credentials: 'creds-123' };
    // Swallow the console.log the component's own catch block emits.
    jest.spyOn(console, 'log').mockImplementation(() => {});

    renderHeader({ auth, clearAuth });
    fireEvent.click(screen.getByRole('button', { name: 'Leave game' }));

    await waitFor(() => expect(clearAuth).toHaveBeenCalledTimes(1));
    console.log.mockRestore();
  });

  test('leave button is not rendered when clearAuth is not provided', () => {
    renderHeader({ auth: { roomID: 'ABCDEF' } });
    expect(
      screen.queryByRole('button', { name: 'Leave game' })
    ).not.toBeInTheDocument();
  });

  test('sound toggle button reflects current sound state and calls setSound', () => {
    const setSound = jest.fn();
    const { rerender } = render(
      <MemoryRouter>
        <Header sound={false} setSound={setSound} />
      </MemoryRouter>
    );
    expect(
      screen.getByRole('button', { name: 'Turn on sound' })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Turn on sound' }));
    expect(setSound).toHaveBeenCalledTimes(1);

    rerender(
      <MemoryRouter>
        <Header sound={true} setSound={setSound} />
      </MemoryRouter>
    );
    expect(
      screen.getByRole('button', { name: 'Turn off sound' })
    ).toBeInTheDocument();
  });

  test('sound toggle button is absent when sound is null (default)', () => {
    renderHeader();
    expect(
      screen.queryByRole('button', { name: /turn (on|off) sound/i })
    ).not.toBeInTheDocument();
  });

  test('"Show Room QR" is only rendered for the host with a roomID', () => {
    const { rerender } = renderHeader({ isHost: false, auth: { roomID: 'ABCDEF' } });
    expect(
      screen.queryByRole('button', { name: 'Show Room QR' })
    ).not.toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <Header isHost auth={{ roomID: 'ABCDEF' }} />
      </MemoryRouter>
    );
    expect(
      screen.getByRole('button', { name: 'Show Room QR' })
    ).toBeInTheDocument();
  });

  test('QR modal opens on click and can be closed', async () => {
    renderHeader({ isHost: true, auth: { roomID: 'ABCDEF' } });

    expect(screen.queryByText('Room QR Code')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show Room QR' }));
    expect(screen.getByText('Room QR Code')).toBeInTheDocument();
    expect(screen.getByText('ABCDEF')).toBeInTheDocument();
    expect(screen.getByText('http://localhost/ABCDEF')).toBeInTheDocument();

    // react-bootstrap Modal's own close (X) button - it has no aria-label,
    // just a visually-hidden "Close" span, so query by that text.
    fireEvent.click(screen.getByText('Close'));
    // The modal unmounts after its fade-out transition, not synchronously.
    await waitFor(() => expect(screen.queryByText('Room QR Code')).not.toBeInTheDocument());
  });
});
