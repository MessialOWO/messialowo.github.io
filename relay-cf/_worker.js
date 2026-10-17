/**
 * Cloudflare Pages 中转站（Pages Functions 高级模式）
 * 把请求转发到 Supabase，解决国内直连不稳的问题。
 *
 * 部署方式见同目录 README.md
 * 访问形态：https://<项目名>.pages.dev/rest/v1/messages?select=*
 */

const UPSTREAM = 'https://wvqrnkgjwnlhjhfuonts.supabase.co';

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // 根路径给个说明页，方便确认部署成功
    if (url.pathname === '/' || url.pathname === '') {
      return new Response(
        '班级网站中转站运行中\n\n' +
        '可用路径：/rest/v1/*  /auth/v1/*  /storage/v1/*\n' +
        '直接把本地址当作 Supabase 的前缀使用。\n',
        { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' } }
      );
    }

    // 只放行这三类路径，避免被当成开放代理
    const ok = url.pathname.startsWith('/rest/v1/') ||
               url.pathname.startsWith('/auth/v1/') ||
               url.pathname.startsWith('/storage/v1/');
    if (!ok) {
      return new Response('不支持的路径：' + url.pathname, {
        status: 404,
        headers: { 'content-type': 'text/plain; charset=utf-8' }
      });
    }

    const target = UPSTREAM + url.pathname + url.search;

    // 原样转发请求头（去掉会误导上游的几个）
    const headers = new Headers(request.headers);
    headers.delete('host');
    headers.delete('cf-connecting-ip');
    headers.delete('cf-ipcountry');
    headers.delete('cf-ray');
    headers.delete('cf-visitor');
    headers.delete('x-forwarded-proto');
    headers.delete('x-real-ip');

    const init = {
      method: request.method,
      headers,
      redirect: 'follow',
    };

    // 只有带 body 的方法才传 body
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = request.body;
      init.duplex = 'half';
    }

    const res = await fetch(target, init);

    // 原样返回，补上允许跨域的响应头
    const out = new Headers(res.headers);
    out.set('access-control-allow-origin', '*');
    out.set('access-control-allow-headers', '*');
    out.set('access-control-allow-methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
    out.set('access-control-expose-headers', '*');
    out.delete('content-security-policy');
    out.delete('x-frame-options');

    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: out,
    });
  },
};
