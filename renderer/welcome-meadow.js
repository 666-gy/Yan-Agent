/* Welcome meadow, approved in preview/meadow-logo. Shadow DOM isolates SVG styles and IDs. */
(() => {
  const host = document.getElementById('welcomeMeadow');
  if (!host || host.shadowRoot) return;
  const root = host.attachShadow({mode:'open'});
  root.innerHTML = `<style>:host{display:block;width:260px;max-width:100%;line-height:0;opacity:1}svg{display:block;width:100%;height:auto;overflow:visible}.stem{fill:none;stroke:#648447;stroke-width:1.8;stroke-linecap:round}.vein{fill:none;stroke:#759255;stroke-width:.55;opacity:.65}#butterfly:focus{outline:none}#butterfly:focus-visible{outline:1px dashed #8ba577;outline-offset:3px}</style><svg id="meadow" viewBox="0 0 360 230" role="group" aria-labelledby="sceneTitle sceneDesc">
<title id="sceneTitle">草坪、野花与蝴蝶</title><desc id="sceneDesc">一只淡黄色蝴蝶在野花间飞舞，偶尔停在花瓣上。草叶随微风轻轻摇动。</desc>
<defs>
 <radialGradient id="ground"><stop stop-color="#91a66a" stop-opacity=".25"/><stop offset="1" stop-color="#91a66a" stop-opacity="0"/></radialGradient>
 <linearGradient id="blade" x1="0" y1="1" x2=".3" y2="0"><stop stop-color="#547545"/><stop offset="1" stop-color="#a1b777"/></linearGradient>
 <linearGradient id="wing" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff4b3"/><stop offset=".65" stop-color="#efcd74"/><stop offset="1" stop-color="#d6a052"/></linearGradient>
 <linearGradient id="whitePetal" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#fffef7"/><stop offset="1" stop-color="#e5e8d6"/></linearGradient>
 <g id="daisy"><g fill="url(#whitePetal)" stroke="#d9ddc8" stroke-width=".45"><ellipse cy="-7" rx="3" ry="6"/><ellipse cy="-7" rx="3" ry="6" transform="rotate(45)"/><ellipse cy="-7" rx="3" ry="6" transform="rotate(90)"/><ellipse cy="-7" rx="3" ry="6" transform="rotate(135)"/><ellipse cy="-7" rx="3" ry="6" transform="rotate(180)"/><ellipse cy="-7" rx="3" ry="6" transform="rotate(225)"/><ellipse cy="-7" rx="3" ry="6" transform="rotate(270)"/><ellipse cy="-7" rx="3" ry="6" transform="rotate(315)"/></g><circle r="4.2" fill="#dfb754"/><circle cx="-1" cy="-1" r="2.7" fill="#f1d477"/><g fill="#bd943d"><circle cx="1.4" cy="1" r=".55"/><circle cx="-1.6" cy=".8" r=".5"/><circle cy="-1.3" r=".5"/></g></g>
 <g id="pinkFlower"><g fill="#cc9fb2"><ellipse cy="-5" rx="3.8" ry="5.8"/><ellipse cy="-5" rx="3.8" ry="5.8" transform="rotate(72)"/><ellipse cy="-5" rx="3.8" ry="5.8" transform="rotate(144)"/><ellipse cy="-5" rx="3.8" ry="5.8" transform="rotate(216)"/><ellipse cy="-5" rx="3.8" ry="5.8" transform="rotate(288)"/></g><circle r="2.6" fill="#f0d18a"/></g>
</defs>
<ellipse cx="180" cy="200" rx="136" ry="20" fill="url(#ground)"/>
<g id="backGrass"></g>
<g id="flowers">
 <g class="plant" data-x="113" data-y="192" data-phase="0"><path class="stem" d="M113 192 Q105 159 115 133"/><path fill="#83a265" d="M110 173 Q94 173 94 159 Q107 160 110 173 M110 163 Q125 162 128 150 Q114 151 110 163"/><use href="#daisy" transform="translate(115 132) rotate(-12)"/></g>
 <g class="plant" data-x="167" data-y="196" data-phase="1.7"><path class="stem" d="M167 196 Q180 168 169 151"/><path fill="#799b5a" d="M172 177 Q184 179 189 167 Q177 167 172 177"/><use href="#pinkFlower" transform="translate(169 149) scale(.8)"/></g>
 <g class="plant" data-x="222" data-y="194" data-phase="2.8"><path class="stem" d="M222 194 Q209 155 222 117"/><path fill="#7d9e5b" d="M216 167 Q200 167 199 151 Q212 153 216 167 M216 153 Q229 151 233 138 Q220 140 216 153"/><path class="vein" d="M216 167 L201 154 M217 153 L231 141"/><use href="#daisy" transform="translate(222 115) rotate(14) scale(1.05)"/></g>
 <g class="plant" data-x="256" data-y="193" data-phase="4"><path class="stem" d="M256 193 Q263 173 254 158"/><path fill="#829d63" d="M259 181 Q274 180 276 170 Q264 169 259 181"/><use href="#pinkFlower" transform="translate(254 157) rotate(25) scale(.68)"/></g>
 <g class="plant" data-x="140" data-y="195" data-phase="5"><path class="stem" d="M140 195 Q134 180 141 167"/><use href="#daisy" transform="translate(141 167) rotate(25) scale(.5)"/></g>
</g>
<g id="frontGrass"></g>
<g id="butterfly" role="button" tabindex="0" aria-label="点击蝴蝶让它飞起"><circle r="25" fill="transparent" pointer-events="all"/><g id="butterflyTilt">
 <g id="leftWing"><path d="M0 0 C-7-18-22-22-22-11 C-22-4-13 3-5 4 C-19 0-20 11-12 13 C-6 15-2 7 0 2Z" fill="url(#wing)" stroke="#bc934d" stroke-width=".65"/><path d="M-1 1 Q-10-4-17-12 M-2 3 L-11 9" stroke="#bd9956" opacity=".5" fill="none" stroke-width=".6"/><circle cx="-17" cy="-10" r="1.3" fill="#fff8d3"/></g>
 <g id="rightWing"><path d="M0 0 C7-18 22-22 22-11 C22-4 13 3 5 4 C19 0 20 11 12 13 C6 15 2 7 0 2Z" fill="url(#wing)" stroke="#bc934d" stroke-width=".65"/><path d="M1 1 Q10-4 17-12 M2 3 L11 9" stroke="#bd9956" opacity=".5" fill="none" stroke-width=".6"/><circle cx="17" cy="-10" r="1.3" fill="#fff8d3"/></g>
 <ellipse cy="1" rx="1.4" ry="7.5" fill="#7f704b"/><circle cy="-6" r="1.9" fill="#6d6746"/><path d="M-1-7 Q-4-13-6-12 M1-7 Q4-13 6-12" fill="none" stroke="#7f704b" stroke-width=".8" stroke-linecap="round"/>
</g></g>
</svg>`;
  const $ = id => root.getElementById(id);
  const ns = 'http://www.w3.org/2000/svg';
  let seed = 28;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const grasses = [];
  // Sway a few layers together instead of invalidating 92 SVG paths per frame.
  const grassLayers = new Map();
  for (let i = 0; i < 92; i++) {
    const x = 63 + random() * 234;
    const envelope = Math.sin((x - 63) / 234 * Math.PI);
    const y = 191 + random() * 13;
    const height = (10 + random() * 40) * (.35 + .65 * envelope);
    const lean = (random() - .5) * 28;
    const width = 1.3 + random() * 2.8;
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', `M${x} ${y} Q${x + lean * .15 - width} ${y - height * .55} ${x + lean} ${y - height} Q${x + lean * .4 + width} ${y - height * .35} ${x + width} ${y}Z`);
    path.setAttribute('fill', ['#8ba76b', '#6e9258', '#a3b77d', 'url(#blade)'][i % 4]);
    path.setAttribute('opacity', i < 55 ? '.7' : '.9');
    const phase = random() * 6.28;
    const parent = i < 55 ? 'backGrass' : 'frontGrass';
    const bucket = Math.floor(phase / (Math.PI / 2));
    const key = `${parent}-${bucket}`;
    if (!grassLayers.has(key)) {
      const layer = document.createElementNS(ns, 'g');
      $(parent).append(layer);
      grassLayers.set(key, layer);
      grasses.push({path: layer, x:180, y:195, phase:(bucket + .5) * Math.PI / 2});
    }
    grassLayers.get(key).append(path);
  }
  const plants = [...root.querySelectorAll('.plant')].map(el => ({el, x:+el.dataset.x,y:+el.dataset.y,phase:+el.dataset.phase}));
  const sway = (t, phase) => Math.sin(t * 1.2 + phase) * 2.1 + Math.sin(t * .47) * .95;
  function perch(t, index, x, y) {
    const p = plants[index], a = sway(t, p.phase) * Math.PI / 180;
    return [p.x + (x-p.x)*Math.cos(a)-(y-p.y)*Math.sin(a), p.y + (x-p.x)*Math.sin(a)+(y-p.y)*Math.cos(a)];
  }
  const bezier = (a,b,c,d,u) => a.map((_,i) => (1-u)**3*a[i] + 3*(1-u)**2*u*b[i] + 3*(1-u)*u*u*c[i] + u**3*d[i]);
  let flightOffset = 0;
  // A continuous 26-second cycle: rest, travel, rest, an airy loop, return.
  function pose(t) {
    const s = (t + flightOffset) % 26, a = perch(t,0,115,120), b = perch(t,2,222,103);
    if (s < 4) return {p:a,rest:true};
    if (s < 10) {
      const u=(s-4)/6, e=u*u*(3-2*u);
      const p=bezier(a,[137,31],[279,39],b,e);
      p[1] += Math.sin(u*Math.PI*6)*3*Math.sin(Math.PI*u);
      return {p,rest:false};
    }
    if (s < 15) return {p:b,rest:true};
    const points = [b,[300,77],[241,33],[91,65],a];
    const controls = [[[239,69],[283,107]],[[326,33],[280,16]],[[190,52],[125,15]],[[57,107],[102,93]]];
    const u=(s-15)/11*4, i=Math.min(3,Math.floor(u)), v=u-i;
    const p=bezier(points[i],controls[i][0],controls[i][1],points[i+1],v*v*(3-2*v));
    return {p,rest:false};
  }
  function render(t) {
    for (const p of plants) p.el.setAttribute('transform',`rotate(${sway(t,p.phase)} ${p.x} ${p.y})`);
    for (const g of grasses) g.path.setAttribute('transform',`rotate(${sway(t,g.phase)*1.8} ${g.x} ${g.y})`);
    const {p,rest}=pose(t), next=pose(t+.02).p;
    const bank=rest ? -16 : Math.max(-28,Math.min(28,(next[0]-p[0])*48));
    $('butterfly').setAttribute('transform',`translate(${p[0]} ${p[1]}) scale(.7)`);
    $('butterflyTilt').setAttribute('transform',`rotate(${bank})`);
    const flap=rest ? .48+.23*Math.sin(t*2.4) : .18+.82*(.5+.5*Math.sin(t*37));
    $('leftWing').setAttribute('transform',`scale(${flap} 1)`);
    $('rightWing').setAttribute('transform',`scale(${rest ? flap*.7 : flap} 1)`);
    $('butterfly').style.cursor=rest ? 'pointer' : 'default';
    $('butterfly').setAttribute('aria-disabled', String(!rest));
    $('butterfly').setAttribute('aria-label', rest ? '蝴蝶在花上小憩，点击让它飞起' : '蝴蝶正在飞舞');
  }
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  // Play the introduction once, then rest on a flower without scheduling frames.
  // A click starts the next flight and stops again at its destination.
  const frameMs = 1000 / 24;
  let paused=reduced.matches, visible=false, elapsed=0, previous=null, frame=null;
  let stopAt=10, lastPaint=null;
  function tick(now) {
    frame=null;
    if (previous !== null) elapsed = Math.min(stopAt, elapsed + Math.min((now-previous)/1000,.1));
    previous=now;
    if (lastPaint === null || now-lastPaint >= frameMs || elapsed >= stopAt) {
      render(elapsed); lastPaint=now;
    }
    if (elapsed >= stopAt) paused=true;
    if (!paused && visible && !document.hidden) frame=requestAnimationFrame(tick);
  }
  function sync() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame=null; previous=null; lastPaint=null;
    if (!paused && visible && !document.hidden) frame=requestAnimationFrame(tick);
  }
  function takeOff() {
    if (reduced.matches || !pose(elapsed).rest) return;
    const phase=(elapsed + flightOffset) % 26;
    // Skip only the remaining rest; the wind clock and perch position stay continuous.
    flightOffset += (phase < 4 ? 4 : 15) - phase;
    stopAt = elapsed + (phase < 4 ? 6 : 11);
    paused=false;
    render(elapsed);
    sync();
  }
  $('butterfly').addEventListener('click',takeOff);
  $('butterfly').addEventListener('keydown',event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      takeOff();
    }
  });
  document.addEventListener('visibilitychange',sync);
  reduced.addEventListener('change',e => {
    // Disabling reduced motion must not revive an already settled scene.
    paused=e.matches || elapsed >= stopAt;
    sync();
  });
  // Stop rendering when the welcome header is hidden by a conversation or another page.
  const observer = new IntersectionObserver(entries => {
    visible = entries[0].isIntersecting;
    sync();
  });
  observer.observe(host);
  window.addEventListener('pagehide', () => {
    observer.disconnect();
    if (frame !== null) cancelAnimationFrame(frame);
  }, {once:true});
  render(0);sync();
})();
