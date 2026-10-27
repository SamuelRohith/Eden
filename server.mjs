import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './server/config.mjs';
import { createAPI } from './server/api.mjs';
import { createBackendRouter } from './server/backend.mjs';

const root = fileURLToPath(new URL('./dist/', import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
const api = createAPI();
async function readJSON(req) {
  const chunks=[];let size=0;
  for await (const chunk of req) {size+=chunk.length;if(size>1500000)throw new Error('Request too large');chunks.push(chunk);}
  const content=Buffer.concat(chunks).toString('utf8');
  return content?JSON.parse(content):{};
}
const handleAPI=createBackendRouter(config,api);
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if(pathname.startsWith('/api/')) {
      // The local server is loopback-only; reject cross-origin browser writes.
      if(req.headers.origin && new URL(req.headers.origin).host!==req.headers.host){res.writeHead(403).end();return;}
      const body=req.method==='POST'?await readJSON(req):{};
      const result=await handleAPI(pathname,req.method,body);
      res.writeHead(result.status,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify(result.json));return;
    }
    const path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!path.startsWith(root.endsWith(sep) ? root : root + sep)) { res.writeHead(403).end(); return; }
    const content = await readFile(path);
    res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }).end(content);
  } catch { res.writeHead(404).end('Not found'); }
});
server.listen(config.port, '127.0.0.1', () => console.log(`Local: http://127.0.0.1:${config.port} · AI: ${config.model} · cloud ${config.cloud?'enabled':'disabled'}`));

server.on('close',()=>api.close());
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{api.close();server.close(()=>process.exit(0));});
