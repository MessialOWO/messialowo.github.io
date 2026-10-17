/* ===== 班级期刊 · 云端连接（所有页面共用） ===== */
var JW = {
  url: 'https://wvqrnkgjwnlhjhfuonts.supabase.co',
  key: 'sb_publishable_cGy9MFHh3-t2i0kEnbHeeg_A1-rUMaF',
  bucket: 'avatars',
  timeoutMs: 10000,
  /* 中转线路列表（按顺序尝试）
     ⚠ 国内直连 Supabase 会被重置，所以实际全靠中转。
     Cloudflare Pages 额度无限，放第一位；Deno 额度紧张，只作备用。 */
  proxy: [
    'https://jw-relay.pages.dev',
    'https://arid-bluejay-4932.messialowo.deno.net'
  ],
  /* 中转健康状态：连续失败就暂时跳过，直接连主库，避免每次白等超时 */
  _proxyFail: {}, _proxySkipUntil: 0,
  _directOK: null, _directFailCount: 0, _directSkipUntil: 0,
  /* 用户手动选择：'direct' 只直连 / 'relay' 走中转 / null 未选（先试直连） */
  lineMode: null, _asking: false,      // null=默认(直连优先+5秒询问) / 'direct' / 'relay'
  LINE_KEY: 'jw_line_mode',
  sb: null, uid: '', deviceId: '', ready: false, error: null, _waiters: [],
  whenReady: function (cb) { if (JW.ready) cb(JW.error); else JW._waiters.push(cb); },
  _settle: function (err) {
    JW.error = err || null; JW.ready = true;
    JW._waiters.splice(0).forEach(function (cb) { try { cb(JW.error); } catch (e) { console.error(e); } });
    try { document.dispatchEvent(new Event('jw:ready')); } catch (e) {}
  },
  withTimeout: function (p, ms, what) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var t = setTimeout(function () {
        if (done) return; done = true;
        reject(new Error('连接超时：' + (what || '请求') + '（' + Math.round(ms / 1000) + ' 秒无响应）'));
      }, ms);
      Promise.resolve(p).then(function (v) { if (done) return; done = true; clearTimeout(t); resolve(v); },
        function (e) { if (done) return; done = true; clearTimeout(t); reject(e); });
    });
  },
  retry: function (fn, times) {
    times = times === undefined ? 2 : times;
    var n = 0;
    var run = function () {
      n++;
      return Promise.resolve().then(fn).catch(function (e) {
        if (n >= times) throw e;
        return new Promise(function (r) { setTimeout(r, 1200); }).then(run);
      });
    };
    return run();
  },
  makeFetch: function () {
    var BASE = JW.url;
    return function (input, init) {
      var url = (typeof input === 'string') ? input : (input && input.url) || '';
      var rel = null;
      try {
        var u = new URL(url, BASE);
        if (u.origin === BASE) rel = u.pathname + u.search;
      } catch (e) {}
      if (!rel || !JW.proxy || !JW.proxy.length) return fetch(input, init);

      /* 文件存储：国内直连 Supabase 会被重置，所以也走中转（Cloudflare 带宽无限） */

      /* ===== 连接策略 =====
         实测：国内直连 Supabase 会被 RST 重置，所以默认直接走中转。
         中转顺序：Cloudflare Pages（额度无限）→ Deno（额度紧张，备用）
         用户可在「用户中心 → 连接线路」里改成只连官方（海外网络适用）。
         所有中转都失败时，最后再试直连兜底。 */
      var cleanList = JW.proxy.map(function (x) { return String(x).replace(/\/$/, ''); });

      function viaRelay() {
        if (!cleanList.length) return fetch(url, init);
        function attempt(i) {
          if (i >= cleanList.length) {
            console.warn('所有中转都失败，最后试直连');
            return fetch(url, init);
          }
          var clean = cleanList[i];
          return fetch(clean + rel, init).then(function (res) {
            if (!res || res.status >= 500) throw new Error('中转返回 ' + (res && res.status));
            return res;
          }).catch(function (e) {
            console.warn('中转失败：' + clean, e && e.message);
            return attempt(i + 1);
          });
        }
        return attempt(0);
      }

      // 用户明确选「只连官方」→ 直连
      if (JW.lineMode === 'direct') return fetch(url, init);

      // 默认 / 「只用中转」→ 走中转
      return viaRelay();
    };
  }
};
/* 图片/音视频的公开地址：国内直连 Supabase 会被重置，所以走中转
   （Cloudflare Pages 带宽无限，图片走它不心疼） */
JW.storagePublic = (JW.proxy && JW.proxy.length ? String(JW.proxy[0]).replace(/\/$/, '') : JW.url)
                 + '/storage/v1/object/public/' + JW.bucket + '/';

(function () {
  /* ---- 连接线路：读用户手动选择；不选就是「自动」 ---- */
  try {
    var lm = localStorage.getItem(JW.LINE_KEY);
    if (lm === 'direct' || lm === 'relay') JW.lineMode = lm;
  } catch (e) {}

  JW.setLine = function (mode) {
    JW.lineMode = (mode === 'direct' || mode === 'relay') ? mode : null;
    try {
      if (JW.lineMode) localStorage.setItem(JW.LINE_KEY, JW.lineMode);
      else localStorage.removeItem(JW.LINE_KEY);
    } catch (e) {}
    return JW.lineMode;
  };
  JW.getLine = function () { return JW.lineMode; };
  JW.proxyList = function () { return JW.proxy.slice(); };

  function newDeviceId() {
    if (window.crypto && window.crypto.randomUUID) return 'gb-' + window.crypto.randomUUID();
    return 'gb-' + Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  }
  JW.deviceId = localStorage.getItem('jiangwan_gb_device') || '';
  if (!JW.deviceId || JW.deviceId.length < 8 || JW.deviceId.length > 64) {
    JW.deviceId = newDeviceId();
    try { localStorage.setItem('jiangwan_gb_device', JW.deviceId); } catch (e) {}
  }
  function boot() {
    if (typeof window.supabase === 'undefined' || !window.supabase.createClient) {
      JW._settle(new Error('云端组件没加载到（vendor/supabase.js）'));
      return;
    }
    try {
      JW.sb = window.supabase.createClient(JW.url, JW.key, {
        auth: { persistSession: true, autoRefreshToken: true },
        global: JW.proxy && JW.proxy.length ? { fetch: JW.makeFetch() } : undefined
      });
    } catch (e) { JW._settle(e); return; }
    JW.sb.auth.getSession().then(function (r) {
      var u = r && r.data && r.data.session && r.data.session.user;
      if (u && u.id) JW.uid = u.id;
      return null;
    }).catch(function () { return null; })
      .then(function () {
        if (JW.uid) return null;
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
