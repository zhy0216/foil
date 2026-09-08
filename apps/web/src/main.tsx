import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@foil/editor';
import favicon from '@foil/editor/brand/foil-favicon.svg';
import '@foil/editor/styles/design-tokens.css';
import '@foil/editor/styles/styles.css';

document.querySelector<HTMLLinkElement>('link[rel="icon"]')!.href = favicon;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
