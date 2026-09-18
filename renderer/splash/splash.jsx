import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import GhostFibers from './vendor/GhostFibers';

// Keep the upstream shader and every demo default intact.
// Mount synchronously so ready-to-show includes the first WebGL frame.
const root = createRoot(document.getElementById('background'));
flushSync(() => root.render(<GhostFibers />));
window.addEventListener('pagehide', () => root.unmount(), { once: true });
