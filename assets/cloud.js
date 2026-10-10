/* ===== 班级期刊 · 云端连接（所有页面共用） ===== */
var JW = {
  url: 'https://wvqrnkgjwnlhjhfuonts.supabase.co',
  key: 'sb_publishable_cGy9MFHh3-t2i0kEnbHeeg_A1-rUMaF',
  bucket: 'avatars',
  timeoutMs: 10000,
  proxy: ['https://arid-bluejay-4932.messialowo.deno.net'],
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
      var list = JW.proxy.slice();
      function attempt(i) {
        if (i >= list.length) return fetch(url, init);
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
