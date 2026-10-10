/**
 * 江湾期刊 · Supabase 中转站（Render 版）
 * 与 Deno 版功能完全一致，只是换了个运行时。
 */
const http = require('http');

const UPSTREAM = 'https://wvqrnkgjwnlhjhfuonts.supabase.co';
const PORT = process.env.PORT || 10000;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS,HEAD',
  'access-control-allow-headers': '*',
  'access-control-expose-headers': 'content-range, content-length, x-total-count',
  'access-control-max-age': '86400',
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    return res.end();
  }

  const url = new URL(req.url, 'http://localhost');
  // 只放行 Supabase 的接口路径，避免被人当通用代理
  if (!/^\/(auth|rest|storage|functions|realtime)\//.test(url.pathname)) {
    res.writeHead(403, { ...CORS, 'content-type': 'application/json' });
    return res.end(JSON.stringify({ error: 'only supabase paths allowed' }));
  }

  // 读请求体
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);

  const headers = { ...req.headers };
  delete headers.host;
  delete headers.connection;
  delete headers['content-length'];

  try {
    const up = await fetch(UPSTREAM + url.pathname + url.search, {
      method: req.method,
      headers,
      body: body.length ? body : undefined,
      redirect: 'manual',
    });

    const out = {};
    up.headers.forEach((v, k) => {
      if (['content-encoding', 'content-length', 'transfer-encoding'].includes(k.toLowerCase())) return;
      out[k] = v;
    });
    Object.assign(out, CORS);

    const buf = Buffer.from(await up.arrayBuffer());
    res.writeHead(up.status, out);
    res.end(buf);
  } catch (e) {
    res.writeHead(502, { ...CORS, 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'upstream failed', detail: String(e) }));
  }
});

server.listen(PORT, () => console.log('relay listening on ' + PORT));
