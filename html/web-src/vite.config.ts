import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';

const configDir = path.dirname(fileURLToPath(import.meta.url));
const engineWebappDir = path.resolve(configDir, '../build/dist/webapp');
const engineAssetRoots = new Set([
  'app.js',
  'engine-worker-boot.js',
  'engine-worker.js',
  'worker-boot.js',
  'worker.js',
]);

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.ini': 'text/plain; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
};

/**
 * During frontend-only development, Vite owns the app shell/HMR while the
 * already-built TeaVM output remains the source of truth for engine files.
 * This removes the need to rebuild + copy Vite's dist/ into webapp/ after
 * every UI edit.
 */
function serveBuiltEngineArtifacts(): Plugin {
  return {
    name: 'serve-built-engine-artifacts',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || (req.method !== 'GET' && req.method !== 'HEAD')) {
          next();
          return;
        }

        const pathname = decodeURIComponent(new URL(req.url, 'http://vite.local').pathname);
        const relativePath = pathname.replace(/^\/+/, '');
        const firstSegment = relativePath.split('/')[0];
        const isEngineArtifact =
          engineAssetRoots.has(relativePath) ||
          firstSegment === 'assets' ||
          firstSegment === 'scripts';

        if (!isEngineArtifact) {
          next();
          return;
        }

        const filePath = path.resolve(engineWebappDir, relativePath);
        const relativeToWebapp = path.relative(engineWebappDir, filePath);
        if (
          relativeToWebapp.startsWith('..') ||
          path.isAbsolute(relativeToWebapp) ||
          !fs.existsSync(filePath) ||
          !fs.statSync(filePath).isFile()
        ) {
          next();
          return;
        }

        const contentType = contentTypes[path.extname(filePath)];
        if (contentType) {
          res.setHeader('Content-Type', contentType);
        }
        res.setHeader('Cache-Control', 'no-store');

        if (req.method === 'HEAD') {
          res.end();
          return;
        }

        fs.createReadStream(filePath).pipe(res);
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [serveBuiltEngineArtifacts(), preact()],
  build: { outDir: 'dist' },
});
