import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createStaticServer } from './app.mjs';

const buildRoot = fileURLToPath(new URL('../build/', import.meta.url));
await access(new URL('../build/index.html', import.meta.url));
const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 4006);
const server = await createStaticServer(buildRoot);
server.listen(port, host, () => console.log('rollerball serving on http://' + host + ':' + port));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  });
}
