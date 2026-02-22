import { defineConfig } from 'vite';
import { resolve } from 'path';
import fs from 'fs';
import type { Connect } from 'vite';

export default defineConfig({
  // Set base path for GitHub Pages deployment
  base: process.env.GITHUB_ACTIONS ? '/ATC/' : '/',
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@data': resolve(__dirname, './data')
    }
  },
  plugins: [
    {
      name: 'taxiway-save-endpoint',
      configureServer(server) {
        // POST /api/save-taxiways → writes data/custom_taxiways.json to disk
        server.middlewares.use(
          '/api/save-taxiways',
          (req: Connect.IncomingMessage, res, _next) => {
            if (req.method !== 'POST') {
              res.statusCode = 405;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Method not allowed' }));
              return;
            }
            let body = '';
            req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
            req.on('end', () => {
              try {
                JSON.parse(body); // validate
              } catch {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: 'Invalid JSON body' }));
                return;
              }
              const outPath = resolve(__dirname, 'data/custom_taxiways.json');
              fs.writeFile(outPath, body, 'utf-8', (err) => {
                res.setHeader('Content-Type', 'application/json');
                if (err) {
                  res.statusCode = 500;
                  res.end(JSON.stringify({ error: err.message }));
                } else {
                  res.statusCode = 200;
                  res.end(JSON.stringify({ ok: true, path: 'data/custom_taxiways.json' }));
                }
              });
            });
          },
        );
      },
    },
  ],
  server: {
    port: 3000,
    open: true
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  }
});
