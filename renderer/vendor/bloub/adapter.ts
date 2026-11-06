import { BotEngine } from './src/bot/engine';
import { EXPRESSION_BY_ID } from './src/bot/expressions';
// Adapt the upstream's pure engine to the existing vanilla renderer.
window.YanCallAvatar = {
  create(svg) {
    const engine = new BotEngine(100, 'idle', null, EXPRESSION_BY_ID.get('attentif'));
    const ns = 'http://www.w3.org/2000/svg';
    svg.setAttribute('viewBox', '-130 -130 260 260');
    const body = document.createElementNS(ns, 'path');
    body.setAttribute('fill', '#0a0a0c'); svg.append(body);
    const eyes = [0, 1].map(() => {
      const eye = document.createElementNS(ns, 'path');
      eye.setAttribute('fill', '#fafafa'); svg.append(eye); return eye;
    });
    return {
      draw(seconds) {
        const frame = engine.sample(seconds);
        body.setAttribute('d', frame.bodyPath);
        frame.eyes.forEach((value, i) => {
          eyes[i].setAttribute('d', value.d);
          eyes[i].setAttribute('transform', value.matrix);
          eyes[i].setAttribute('opacity', String(value.alpha));
        });
      }
    };
  }
};
