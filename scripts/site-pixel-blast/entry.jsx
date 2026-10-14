import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import PixelBlast from './PixelBlast.jsx';

function Background({ container, color = '#97cdcf', patternDensity = 1.25 }) {
  const [active, setActive] = useState(!document.hidden);
  useEffect(() => {
    let visible = true;
    const update = () => setActive(visible && !document.hidden);
    const observer = new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting);
      update();
    });
    observer.observe(container);
    document.addEventListener('visibilitychange', update);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', update);
    };
  }, [container]);
  return active ? <PixelBlast color={color} patternScale={8}
    patternDensity={patternDensity} speed={1} pixelSize={4} edgeFade={0.25}
    variant="square" liquid={false} noiseAmount={0} /> : null;
}

window.YanPixelBlast = {
  mount(container, settings = {}) {
    const root = createRoot(container);
    root.render(<Background container={container} {...settings} />);
    return () => root.unmount();
  }
};
