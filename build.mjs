// Builds the plugin main thread (dist/code.js) and a single-file UI (dist/ui.html).
// Figma loads the UI as one HTML string, so the UI bundle and CSS are inlined.
import * as esbuild from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const watch = process.argv.includes('--watch');
await mkdir('dist', { recursive: true });

const inlineUi = {
  name: 'inline-ui',
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length) return;
      const js = result.outputFiles.find((f) => f.path.endsWith('.js')).text;
      const css = await readFile('src/ui/styles.css', 'utf8');
      const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head>` +
        `<body><div id="app"></div><script>${js.replace(/<\/script>/g, '<\\/script>')}</script></body></html>`;
      await writeFile('dist/ui.html', html);
      console.log(`ui.html built (${(html.length / 1024).toFixed(1)} kB)`);
    });
  },
};

const common = { bundle: true, minify: !watch, logLevel: 'info', target: 'es2017' };

const main = await esbuild.context({ ...common, entryPoints: ['src/code.ts'], outfile: 'dist/code.js' });
const ui = await esbuild.context({
  ...common,
  entryPoints: ['src/ui/main.tsx'],
  outfile: 'dist/ui.js',
  write: false,
  jsx: 'automatic',
  jsxImportSource: 'preact',
  plugins: [inlineUi],
});

// Browser harness that fakes the main thread (dev/index.html). Never shipped.
const harness = await esbuild.context({ ...common, entryPoints: ['dev/harness.ts'], outfile: 'dev/harness.js' });

if (watch) {
  await Promise.all([main.watch(), ui.watch(), harness.watch()]);
} else {
  await Promise.all([main.rebuild(), ui.rebuild(), harness.rebuild()]);
  await Promise.all([main.dispose(), ui.dispose(), harness.dispose()]);
}
