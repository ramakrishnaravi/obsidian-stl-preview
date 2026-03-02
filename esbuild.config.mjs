import esbuild from 'esbuild';
import fs      from 'fs';
import process from 'process';

const watch = process.argv.includes('--watch');

// ── Build 1: Obsidian plugin (CommonJS, obsidian externalized) ────────────────

const pluginCtx = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle:      true,
  external:    ['obsidian', 'electron'],
  format:      'cjs',
  target:      'es2018',
  logLevel:    'info',
  // Inline sourcemaps only in watch/dev mode — production builds stay lean.
  sourcemap:   watch ? 'inline' : false,
  outfile:     'main.js',
});

// ── Build 2: Standalone HTML viewer (IIFE, everything bundled) ────────────────
//   Emits to memory, then inlines into the HTML template.

async function buildViewer() {
  const template = fs.readFileSync('src/viewer.html', 'utf8');
  const result = await esbuild.build({
    entryPoints: ['src/viewer.ts'],
    bundle:      true,
    format:      'iife',
    target:      'es2018',
    minify:      !watch,   // readable in watch/dev mode
    write:       false,    // capture output in memory
  });

  const js   = result.outputFiles[0].text;
  const html = template.replace(
    '<!-- BUNDLED_SCRIPT -->',
    `<script>\n${js}\n</script>`,
  );
  fs.writeFileSync('stl-viewer.html', html, 'utf8');
  console.log(`[viewer] stl-viewer.html  (${(html.length / 1024).toFixed(0)} KB)`);
}

if (watch) {
  // plugin: use esbuild watch API
  await pluginCtx.watch();

  // viewer: re-build on source changes via esbuild's onEnd plugin
  const viewerCtx = await esbuild.context({
    entryPoints: ['src/viewer.ts'],
    bundle:      true,
    format:      'iife',
    target:      'es2018',
    write:       false,
    plugins: [{
      name: 'write-html',
      setup(b) {
        b.onEnd(result => {
          if (result.errors.length > 0) return;  // skip write on build errors
          const js       = result.outputFiles?.[0]?.text ?? '';
          const template = fs.readFileSync('src/viewer.html', 'utf8');
          const html     = template.replace('<!-- BUNDLED_SCRIPT -->', `<script>\n${js}\n</script>`);
          fs.writeFileSync('stl-viewer.html', html, 'utf8');
          console.log(`[viewer] rebuilt stl-viewer.html  (${(html.length / 1024).toFixed(0)} KB)`);
        });
      },
    }],
  });
  await viewerCtx.watch();
  console.log('Watching for changes…');

} else {
  // One-shot build
  await pluginCtx.rebuild();
  await pluginCtx.dispose();

  await buildViewer();
}
