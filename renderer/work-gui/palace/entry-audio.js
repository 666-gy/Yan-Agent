(() => {
  'use strict';
  const audio=new Audio('assets/entry-music.mp3');audio.preload='auto';audio.loop=false;audio.volume=.65;
  const button=document.createElement('button');button.id='music-replay';button.type='button';button.title='重播入阙音乐';button.setAttribute('aria-label','重播入阙音乐');
  // Lucide music-2 geometry (ISC).
  button.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13"/><path d="m9 9 12-2"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
  document.querySelector('.top-actions').prepend(button);let playedEntry=false,attempt=0;
  async function play(){const token=++attempt;audio.pause();audio.currentTime=0;button.setAttribute('aria-busy','true');try{await audio.play();if(token!==attempt)return;button.classList.add('playing');button.title='正在播放 · 点击从头重播';}catch(e){if(token!==attempt)return;button.title='点击播放入阙音乐';document.querySelector('#announcement').textContent=audio.error?'音乐加载失败，请点击音符重试。':'点击音符即可播放入阙音乐。';}finally{if(token===attempt)button.removeAttribute('aria-busy');}}
  button.onclick=play;audio.addEventListener('ended',()=>{button.classList.remove('playing');button.title='重播入阙音乐';});
  // Called synchronously inside the door click to satisfy browser autoplay policy.
  window.TiangongEntryAudio={playOnce(){if(playedEntry)return;playedEntry=true;void play();}};
  function stop(){attempt++;audio.pause();button.classList.remove('playing');button.removeAttribute('aria-busy');}
  window.addEventListener('message',e=>{if(e.source===window.parent&&e.data?.source==='yan-palace-host'&&e.data.kind==='pause')stop();});
  window.addEventListener('pagehide',()=>{stop();audio.removeAttribute('src');audio.load();});
})();
