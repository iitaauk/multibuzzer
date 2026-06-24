import React from 'react';
import { Container } from 'react-bootstrap';

export function FooterSimple() {
  return (
    <div id="footer-simple">
      <a
        target="_blank"
        rel="noopener noreferrer"
        href="https://github.com/iitaauk/multibuzzer"
      >
        Get the source
      </a>
    </div>
  );
}

/**
 * Footer component
 * @param {bool} mobileOnly - only display on mobile devices, <768 px
 */
export default function Footer({ mobileOnly = false }) {
  return (
    <footer className={mobileOnly ? 'd-block d-md-none' : null}>
      <Container>
        <div>
          <a
            target="_blank"
            rel="noopener noreferrer"
            href="https://github.com/iitaauk/multibuzzer"
          >
            Get the source
          </a>
        </div>
      </Container>
    </footer>
  );
}
