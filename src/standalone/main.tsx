import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { StandaloneApp } from './StandaloneApp';
import { STANDALONE_IDS } from '../lib/standalone-runtime';
import '../styles/design-tokens.css';
import '../styles/styles.css';

createRoot(document.getElementById(STANDALONE_IDS.root)!).render(
  <StrictMode><StandaloneApp /></StrictMode>
);
