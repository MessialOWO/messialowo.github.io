/* ===== 班级期刊 · 云端连接（所有页面共用） ===== */
var JW = {
  url: 'https://wvqrnkgjwnlhjhfuonts.supabase.co',
  key: 'sb_publishable_cGy9MFHh3-t2i0kEnbHeeg_A1-rUMaF',
  bucket: 'avatars',
  timeoutMs: 10000,
  /* 中转线路列表（按顺序尝试）
     - Deno Deploy：原来的主力
     - Cloudflare Pages：部署后把地址填进来（xxx.pages.dev）
     注意：不要填 workers.dev，那个在国内被墙。 */
  proxy: [
    'https://arid-bluejay-4932.messialowo.deno.net'
    /* 部署 Cloudflare Pages 后，在上面这行后面加英文逗号，再填你的地址，例如：
       , 'https://jw-relay.pages.dev'
    */
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

      /* 文件存储（上传/下载/删除）不走中转：
         Storage 本身就是对象存储 CDN，国内访问比数据库 API 稳；
         而且大文件经中转转发会占用大量"内存×时间"额度，把免费额度耗尽。
         所以 storage 直连，失败再退回中转。 */
      if (rel.indexOf('/storage/v1/') === 0) {
        return fetch(url, init).catch(function (e) {
          console.warn('Storage 直连失败，改走中转', e && e.message);
          var list0 = JW.proxy.slice();
          function tryRelay(i) {
            if (i >= list0.length) throw e;
            var clean = String(list0[i]).replace(/\/$/, '');
            return fetch(clean + rel, init).then(function (res) {
              if (!res || res.status >= 500) throw new Error('中转 ' + clean + ' 返回 ' + (res && res.status));
              return res;
            }).catch(function () { return tryRelay(i + 1); });
          }
          return tryRelay(0);
        });
      }
      /* ===== 连接策略 =====
         默认（自动）：直连优先，5 秒没响应或失败 → 自动切中转，不打扰用户
         手动：用户可在「用户中心 → 连接线路」里指定「只直连」或「只中转」
         文件存储（storage）已在上面单独处理，不走这里 */
      var DIRECT_TIMEOUT = 5000;
      var cleanList = JW.proxy.map(function (x) { return String(x).replace(/\/$/, ''); });

      function viaRelay() {
        if (!cleanList.length) return fetch(url, init);
        function attempt(i) {
          if (i >= cleanList.length) return fetch(url, init);
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

      if (JW.lineMode === 'relay') return viaRelay();     // 用户选了只走中转
      if (JW.lineMode === 'direct') return fetch(url, init);  // 用户选了只直连

      // 自动：先直连，超时就自动切中转
      return new Promise(function (resolve) {
        var done = false;
        var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        var merged = init ? Object.assign({}, init) : {};
        if (ctl) merged.signal = ctl.signal;

        var timer = setTimeout(function () {
          if (done) return;
          done = true;
          if (ctl) { try { ctl.abort(); } catch (e) {} }
          console.warn('直连超过 ' + (DIRECT_TIMEOUT / 1000) + ' 秒，自动切换中转');
          JW._directOK = false;
          resolve(viaRelay());
        }, DIRECT_TIMEOUT);

        fetch(url, merged).then(function (res) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          JW._directOK = true;
          resolve(res);
        }).catch(function (e) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          console.warn('直连失败，自动切换中转：', e && e.message);
          JW._directOK = false;
          resolve(viaRelay());
        });
      });
    };
  }
};
JW.storagePublic = JW.url + '/storage/v1/object/public/' + JW.bucket + '/';

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
