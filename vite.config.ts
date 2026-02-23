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
            console.log(`[Taxiway Save] ${req.method} request received, headers:`, req.headers);
            
            if (req.method !== 'POST') {
              console.warn(`[Taxiway Save] Method ${req.method} not allowed, only POST`);
              res.statusCode = 405;
              res.setHeader('Content-Type', 'application/json');
              res.setHeader('Allow', 'POST');
              res.end(JSON.stringify({ error: 'Method not allowed. Use POST.' }));
              return;
            }
            let body = '';
            req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
            req.on('end', () => {
              try {
                const parsed = JSON.parse(body); // validate
                console.log(`[Taxiway Save] Valid JSON payload received, ${body.length} bytes`);
              } catch (err) {
                console.error(`[Taxiway Save] JSON parse error:`, err);
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: `Invalid JSON body: ${(err as Error).message}` }));
                return;
              }
              const outPath = resolve(__dirname, 'data/custom_taxiways.json');
              console.log(`[Taxiway Save] Writing to ${outPath}`);
              fs.writeFile(outPath, body, 'utf-8', (err) => {
                res.setHeader('Content-Type', 'application/json');
                if (err) {
                  console.error(`[Taxiway Save] Write error:`, err);
                  res.statusCode = 500;
                  res.end(JSON.stringify({ error: `Write failed: ${err.message}` }));
                } else {
                  console.log(`[Taxiway Save] Success! Wrote ${body.length} bytes`);
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
