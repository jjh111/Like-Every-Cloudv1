import { defineConfig, type Plugin } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Dev-only middleware. Lets the in-browser edit gizmo persist hero
// placements back to public/heroes/manifest.json — the source of truth
// loaded on next refresh.
//
// `apply: 'serve'` keeps this out of `vite build`, so production has no
// exposed write endpoint. Path is hard-pinned to the heroes manifest; the
// body must round-trip through JSON.parse before we touch disk.
function manifestWriter(): Plugin {
  return {
    name: 'lec-manifest-writer',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__lec/save-manifest', (req, res, next) => {
        if (req.method !== 'POST') {
          next();
          return;
        }
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString('utf8'); });
        req.on('end', () => {
          try {
            // Validate by parsing; only the shape check uses the parsed value.
            // The bytes that hit disk are the raw body — the client owns
            // formatting so the hand-curated layout is preserved.
            const parsed = JSON.parse(body) as { heroes?: unknown };
            if (!parsed || !Array.isArray(parsed.heroes)) {
              res.statusCode = 400;
              res.end('expected { heroes: [...] }');
              return;
            }
            const out = resolve(process.cwd(), 'public/heroes/manifest.json');
            const trailingNewline = body.endsWith('\n') ? '' : '\n';
            writeFileSync(out, body + trailingNewline);
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ saved: out }));
          } catch (e) {
            res.statusCode = 400;
            res.end(String(e));
          }
        });
        req.on('error', () => {
          res.statusCode = 500;
          res.end('stream error');
        });
      });
    },
  };
}

// Same shape as manifestWriter but writes the morning-shaft atmosphere config.
// Kept as a separate route + path so the safety boundary is explicit per file.
function atmosphereWriter(): Plugin {
  return {
    name: 'lec-atmosphere-writer',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__lec/save-atmosphere', (req, res, next) => {
        if (req.method !== 'POST') {
          next();
          return;
        }
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString('utf8'); });
        req.on('end', () => {
          try {
            const parsed = JSON.parse(body) as { shafts?: unknown };
            if (!parsed || !Array.isArray(parsed.shafts)) {
              res.statusCode = 400;
              res.end('expected { shafts: [...] }');
              return;
            }
            const out = resolve(process.cwd(), 'public/atmosphere/morning-shaft.json');
            mkdirSync(dirname(out), { recursive: true });
            const trailingNewline = body.endsWith('\n') ? '' : '\n';
            writeFileSync(out, body + trailingNewline);
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ saved: out }));
          } catch (e) {
            res.statusCode = 400;
            res.end(String(e));
          }
        });
        req.on('error', () => {
          res.statusCode = 500;
          res.end('stream error');
        });
      });
    },
  };
}

// Same pattern as the other writers — pinned to one file path, dev-only.
function cameraWriter(): Plugin {
  return {
    name: 'lec-camera-writer',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__lec/save-camera', (req, res, next) => {
        if (req.method !== 'POST') {
          next();
          return;
        }
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString('utf8'); });
        req.on('end', () => {
          try {
            const parsed = JSON.parse(body) as { exterior?: unknown };
            if (!parsed || typeof parsed.exterior !== 'object') {
              res.statusCode = 400;
              res.end('expected { exterior: { position, target } }');
              return;
            }
            const out = resolve(process.cwd(), 'public/camera/positions.json');
            mkdirSync(dirname(out), { recursive: true });
            const trailingNewline = body.endsWith('\n') ? '' : '\n';
            writeFileSync(out, body + trailingNewline);
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ saved: out }));
          } catch (e) {
            res.statusCode = 400;
            res.end(String(e));
          }
        });
        req.on('error', () => {
          res.statusCode = 500;
          res.end('stream error');
        });
      });
    },
  };
}

export default defineConfig({
  publicDir: 'public',
  plugins: [manifestWriter(), atmosphereWriter(), cameraWriter()],
  server: {
    port: 5173,
    open: false,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
