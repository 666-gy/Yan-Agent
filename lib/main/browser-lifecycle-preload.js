'use strict';
const { ipcRenderer } = require('electron');
// Remember edits even if the user subsequently clears the field. Frames also
// protect their parent tab. A navigation creates a fresh document/guard.
let reported = false;
document.addEventListener('input', () => {
  if (reported) return;
  reported = true;
  ipcRenderer.send('browser:tab-edited');
}, true);
