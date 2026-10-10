/* ========== 江湾期刊 · 云端连接模块（首页与文章页共用） ==========
   解决的问题：手机访问 *.supabase.co 有时会「挂住不返回」，
   浏览器默认超时几十秒，页面就一直停在"正在连接云端"，看起来像网站坏了。
   这里做三件事：① 每个请求最多等 10 秒 ② 失败自动重试 1 次
                ③ 彻底失败时给出明确提示，不装死
*/
var JW = {
  url: 'https://wvqrnkgjwnlhjhfuonts.supabase.co',
  key: 'sb_publishable_cGy9MFHh3-t2i0kEnbHeeg_A1-rUMaF',
  bucket: 'avatars',
  timeoutMs: 10000,
  /* 中转站（按顺序尝试，前一个失败自动换下一个；全挂则回退直连官方域名）
     [0] Deno Deploy —— 现在在用，但官方已宣布 Deno Deploy 约 2027 年 4 月关闭
     [1] Render      —— 备用，部署方法见仓库 relay-render.md，拿到网址填这里
     想改回直连：把数组清空成 proxy: [] 即可。 */
  proxy: [
    'https://arid-bluejay-4932.messialowo.deno.net'
    // , 'https://你的render服务.onrender.com'
  ],
  sb: null,
  uid: '',
  deviceId: '',
  ready: false,
  error: null,
  _waiters: [],
  whenReady: function (cb) { if (JW.ready) cb(JW.error); else JW._waiters.push(cb); },
  _settle: function (err) {
    JW.error = err || null;
    JW.ready = true;
    JW._waiters.splice(0).forEach(function (cb) { try { cb(JW.error); } catch (e) { console.error(e); } });
    try { document.dispatchEvent(new Event('jw:ready')); } catch (e) {}
  },
  /* 构造一个 fetch：优先走中转域名，中转失败直接回落官方域名。
     中转只需转发两类路径：/auth/v1/* 和 /rest/v1/*、/storage/v1/* */
  makeFetch: function () {
    var BASE = JW.url;
    function relPath(url) {
      try {
        var u = new URL(url, BASE);
        if (u.origin !== BASE) return null;          // 不是打给 Supabase 的，不动
        return u.pathname + u.search;
      } catch (e) { return null; }
    }
    function rawFetch(target, init, input) {
      if (target === null) return fetch(input, init);
      return fetch(target, init);
    }
    return function (input, init) {
      var url = (typeof input === 'string') ? input : (input && input.url) || '';
      var rel = relPath(url);
      if (!rel || !JW.proxy || !JW.proxy.length) return fetch(input, init);

      var list = JW.proxy.slice();
      // 依次尝试各个中转，最后兜底直连官方域名
      function attempt(i) {
        if (i >= list.length) return fetch(url, init);         // 全挂了 → 直连
        var clean = String(list[i]).replace(/\/$/, '');
        return fetch(clean + rel, init).then(function (res) {
          if (!res || res.status >= 500) throw new Error('中转 ' + clean + ' 返回 ' + (res && res.status));
          return res;
        }).catch(function (e) {
          console.warn('中转失败，换下一个：' + clean, e && e.message);
          return attempt(i + 1);
        });
      }
      return attempt(0);
    };
  },

  /* 给任意 promise 加超时（supabase-js 自己没有超时参数） */
  withTimeout: function (p, ms, what) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var t = setTimeout(function () {
        if (done) return;
        done = true;
        reject(new Error('连接超时：' + (what || '请求') + '（' + Math.round(ms / 1000) + ' 秒无响应）'));
      }, ms);
      Promise.resolve(p).then(function (v) {
        if (done) return; done = true; clearTimeout(t); resolve(v);
      }, function (e) {
        if (done) return; done = true; clearTimeout(t); reject(e);
      });
    });
  },
  /* 失败重试一次 */
  retry: function (fn, times) {
    times = times === undefined ? 2 : times;
    var attempt = 0;
    var run = function () {
      attempt++;
      return Promise.resolve().then(fn).catch(function (e) {
        if (attempt >= times) throw e;
        return new Promise(function (r) { setTimeout(r, 1200); }).then(run);
      });
    };
    return run();
  }
};
JW.storagePublic = JW.url + '/storage/v1/object/public/' + JW.bucket + '/';

(function () {
  function newDeviceId() {
    if (window.crypto && window.crypto.randomUUID) return 'gb-' + window.crypto.randomUUID();
    return 'gb-' + Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  }
  JW.deviceId = localStorage.getItem('jiangwan_gb_device') || '';
  if (!JW.deviceId || JW.deviceId.length < 8 || JW.deviceId.length > 64) {
    JW.deviceId = newDeviceId();
    try { localStorage.setItem('jiangwan_gb_device', JW.deviceId); } catch (e) {}
  }

  var FALLBACK_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';
  var triedFallback = false;

  function loadFallbackSdk() {
    return new Promise(function (resolve, reject) {
      if (triedFallback) return reject(new Error('备用地址也失败过'));
      triedFallback = true;
      var s = document.createElement('script');
      s.src = FALLBACK_CDN;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('备用地址也加载不了')); };
      document.head.appendChild(s);
      setTimeout(function () { reject(new Error('备用地址超时')); }, 12000);
    });
  }

  function getSessionUid() {
    return JW.withTimeout(JW.sb.auth.getSession(), 6000, '读取本地会话')
      .then(function (r) {
        var u = r && r.data && r.data.session && r.data.session.user;
        if (u && u.id) JW.uid = u.id;
        return null;
      }).catch(function () { return null; });
  }

  function boot() {
    if (typeof window.supabase === 'undefined' || !window.supabase.createClient) {
      // SDK 没加载到：先用本地会话判断是否登录过，尝试备用 CDN
      return loadFallbackSdk().then(boot).catch(function (e) {
        JW._settle(new Error('云端组件加载失败（vendor/supabase.js 没加载到，备用地址也不通）'));
      });
    }
    var clientOpts = { auth: { persistSession: true, autoRefreshToken: true } };
    if (JW.proxy) clientOpts.global = { fetch: JW.makeFetch() };
    try {
      JW.sb = window.supabase.createClient(JW.url, JW.key, clientOpts);
    } catch (e) { JW._settle(e); return; }

    return getSessionUid()
      .then(function () {
        if (JW.uid) return null;      // 本地已有身份，省一次网络往返
        return JW.retry(function () {
          return JW.withTimeout(JW.sb.auth.signInAnonymously(), JW.timeoutMs, '登录匿名身份');
        }, 2).then(function (res) {
          if (res && res.error) throw new Error(res.error.message || '匿名登录被拒绝');
          if (res && res.data && res.data.user) JW.uid = res.data.user.id || '';
          return null;
        });
      })
      .then(function () { JW._settle(null); })
      .catch(function (e) { JW._settle(e); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
