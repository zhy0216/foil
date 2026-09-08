import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@foil/editor';
import '@foil/editor/styles/design-tokens.css';
import '@foil/editor/styles/styles.css';
import { resolveShareBaseUrl } from './config';
import { OpenSharedLink } from './components/OpenSharedLink';

const shareBaseUrl = resolveShareBaseUrl(import.meta.env.VITE_FOIL_SHARE_BASE_URL);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App shareBaseUrl={shareBaseUrl} headerActions={<OpenSharedLink />} />
  </StrictMode>,
);
