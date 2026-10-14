(() => {
  'use strict';
  let sequence = 0;
  window.createImageDiscardDialog = panel => {
    const suffix = sequence++ ? `-${sequence}` : '';
    const dialog = document.createElement('dialog');
    dialog.className = 'image-editor-discard';
    dialog.setAttribute('aria-labelledby', `image-discard-title${suffix}`);
    dialog.setAttribute('aria-describedby', `image-discard-description${suffix}`);
    dialog.innerHTML = `<h2 id="image-discard-title${suffix}">放弃更改?</h2><p id="image-discard-description${suffix}">你的更改不会被保存</p><button type="button" class="image-discard-continue" autofocus>继续编辑</button><button type="button" class="image-discard-confirm">放弃更改</button>`;
    panel.append(dialog);
    let pending = null, resolve = null, previousFocus = null;
    function settle(discard) {
      if (!resolve) return;
      const complete = resolve; resolve = pending = null;
      dialog.close();
      if (!discard && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
      complete(discard);
    }
    dialog.querySelector('.image-discard-continue').addEventListener('click', () => settle(false));
    dialog.querySelector('.image-discard-confirm').addEventListener('click', () => settle(true));
    dialog.addEventListener('cancel', event => { event.preventDefault(); settle(false); });
    dialog.addEventListener('close', () => { if (resolve && !dialog.open) settle(false); });
    dialog.addEventListener('keydown', event => event.stopPropagation());
    return {
      ask() {
        if (pending) return pending;
        previousFocus = document.activeElement;
        pending = new Promise(complete => { resolve = complete; });
        dialog.showModal();
        dialog.querySelector('.image-discard-continue').focus();
        return pending;
      },
      cancel() { settle(false); }
    };
  };
})();
