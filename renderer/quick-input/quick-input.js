(() => {
  const input = document.getElementById('quickInput');
  const submit = document.getElementById('quickSubmit');
  const bridge = window.yanQuickInput;
  if (!input || !submit || !bridge) return;

  const send = () => {
    const text = input.value.trim();
    if (!text) return;
    bridge.submit(text);
  };

  input.addEventListener('input', () => {
    submit.classList.toggle('ready', !!input.value.trim());
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      send();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      bridge.close();
    }
  });
  submit.addEventListener('click', send);
  window.addEventListener('load', () => {
    input.focus({ preventScroll: true });
  });
})();
