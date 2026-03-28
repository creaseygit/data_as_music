import { build } from 'esbuild';

build({
  entryPoints: ['strudel-entry.mjs'],
  bundle: true,
  format: 'iife',
  outfile: '../strudel-bundle.js',
  minify: true,
  sourcemap: true,
  target: ['es2020'],
  // Suppress warnings about top-level this in ESM modules
  logLevel: 'info',
}).then(() => {
  console.log('Bundle built: frontend/strudel-bundle.js');
}).catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
