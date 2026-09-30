import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

const types = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'], ['.json', 'application/json'],
  ['.svg', 'image/svg+xml'], ['.png', 'image/png'], ['.webp', 'image/webp'],
  ['.jpg', 'image/jpeg'], ['.ico', 'image/x-icon'], ['.woff2', 'font/woff2'],
  ['.wasm', 'application/wasm']
]);

// Caddy strips the app prefix. Only the compiled public directory is readable.
export async function createStaticServer(buildRoot) {
  const root = await realpath(buildRoot);
  return createServer(async (request, response) => {
    const end = (status, text) => {
      response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(request.method === 'HEAD' ? undefined : text);
    };
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.setHeader('Allow', 'GET, HEAD');
      end(405, 'Method Not Allowed');
      return;
    }
    try {
      let pathname;
      try {
        pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      } catch {
        end(400, 'Bad Request');
        return;
      }
      if (pathname.includes('\\') || pathname.includes('\0') ||
          pathname.split('/').some((part) => part.startsWith('.'))) {
        end(403, 'Forbidden');
        return;
      }
      const requested = path.join(root, pathname.endsWith('/') ? pathname + 'index.html' : pathname);
      const file = await realpath(requested).catch(() => null);
      if (!file) { end(404, 'Not Found'); return; }
      const relative = path.relative(root, file);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        end(403, 'Forbidden');
        return;
      }
      const info = await stat(file);
      if (!info.isFile()) { end(404, 'Not Found'); return; }
      response.writeHead(200, {
        'Content-Type': types.get(path.extname(file)) ?? 'application/octet-stream',
        'Content-Length': info.size,
        'Cache-Control': relative.replaceAll('\\', '/').startsWith('_app/immutable/')
          ? 'public, max-age=31536000, immutable' : 'no-cache',
        'X-Content-Type-Options': 'nosniff'
      });
      if (request.method === 'HEAD') response.end();
      else createReadStream(file).on('error', () => response.destroy()).pipe(response);
    } catch (error) {
      console.error(error);
      if (response.headersSent) response.destroy();
      else end(500, 'Internal Server Error');
    }
  });
}
