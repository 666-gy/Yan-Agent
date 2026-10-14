import React from 'react';
import { createRoot } from 'react-dom/client';
import ShapeWaves from './ShapeWaves.jsx';

// React Bits demo defaults plus the exact parameters from the requested URL.
window.YanShapeWaves = {
  mount(container) {
    const root = createRoot(container);
    root.render(<ShapeWaves text="</>" backgroundColor="#120f17"
      introDuration={1} speed={1.2} cellSize={12} glow={0.65}
      onError={error => {
        container.dataset.error = error.message;
        console.error('Shape Waves:', error);
      }} />);
    return () => root.unmount();
  }
};
