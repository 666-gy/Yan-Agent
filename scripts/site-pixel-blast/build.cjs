const path = require('node:path');
require('esbuild').buildSync({
  entryPoints: [path.join(__dirname, 'entry.jsx')],
  outfile: path.join(__dirname, '../../docs/site-pixel-blast.js'),
  bundle: true,
  minify: true,
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  legalComments: 'linked',
});
