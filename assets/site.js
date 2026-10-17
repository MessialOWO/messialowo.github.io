/* ===== 班级期刊 · 全站共享脚本（侧边栏 + 云端连接） ===== */
var SITE = {
  name: '达高中墙Board',
  school: '达州市高级中学',
  pages: [
    { href: './',                  label: '首页',       en: 'Home',      key: 'home' },
    { href: './gallery.html',      label: '画廊',       en: 'Gallery',   key: 'gallery' },
    { href: './guestbook.html',    label: '留言板',     en: 'Guestbook', key: 'guestbook' },
    { href: './journal.html',      label: '期刊投稿',   en: 'Journal',   key: 'journal' }
  ],
  /* 「用户中心」折叠组 */
  userPages: [
    { href: './auth.html',          label: '登录 / 注册', en: 'Sign in',  key: 'auth' },
    { href: './user.html#fold-msg',      label: '消息中心', en: 'Messages', key: 'user' },
    { href: './user.html#fold-settings', label: '账户设置', en: 'Settings', key: 'user-settings' },
    { href: './user.html#fold-bg',       label: '背景',     en: 'Theme',    key: 'user-bg' }
  ],
  /* 「关于」折叠组 */
  aboutPages: [
    { href: './about-school.html', label: '关于学校',   en: 'About School', key: 'school' },
    { href: './about-site.html',   label: '关于本站',   en: 'About Site',   key: 'site' },
    { href: './changelog.html',    label: '更新日志',   en: 'Changelog',    key: 'changelog' },
    { href: './developer.html',    label: '一个孤零零的开发者想说的话', en: '', key: 'developer', faint: true }
  ]
};

/* 是否已登录 */
SITE.loggedIn = function () {
  try {
    var a = JSON.parse(localStorage.getItem('jw_account') || 'null');
    return !!(a && a.username);
  } catch (e) { return false; }
};
SITE.account = function () {
  try { return JSON.parse(localStorage.getItem('jw_account') || 'null'); } catch (e) { return null; }
};

/* 生成侧边栏 + 顶栏（每个页面只需调用 SITE.shell('key')） */
SITE.shell = function (activeKey) {
  var links = SITE.pages.map(function (p) {
    return '<a href="' + p.href + '"' + (p.key === activeKey ? ' class="on"' : '') + '>'
      + p.label + '<small>' + p.en + '</small></a>';
  }).join('');

  // 「用户中心」折叠组
  var logged = SITE.loggedIn();
  // 已登录后不再显示「登录 / 注册」
  var userItems = SITE.userPages.filter(function (p) {
    return !(logged && p.key === 'auth');
  });
  var userOpen = userItems.some(function (p) { return p.key === activeKey; })
                 || ['auth','user','user-settings','user-bg'].indexOf(activeKey) >= 0;
  var userLinks = userItems.map(function (p) {
    return '<a class="sub-link" href="' + p.href + '"' + (p.key === activeKey ? ' class="on"' : '') + '>'
      + p.label + '<small>' + p.en + '</small></a>';
  }).join('');
  links += '<div class="nav-group' + (userOpen ? ' open' : '') + '" id="nav-user">'
    + '<button type="button" class="nav-group-btn' + (userOpen ? ' on' : '') + '" id="nav-user-btn">'
    + (logged && SITE.account() && SITE.account().username
        ? SITE.account().username.replace(/^@/, '') + '<small>已登录</small>'
        : '用户中心<small>Account</small>')
    + '<i class="caret">▾</i></button>'
    + '<div class="nav-group-body">' + userLinks + '</div>'
    + '</div>';

  // 「关于」折叠组：关于学校 / 关于本站
  var aboutOpen = SITE.aboutPages.some(function (p) { return p.key === activeKey; });
  var aboutLinks = SITE.aboutPages.map(function (p) {
    var cls = 'sub-link' + (p.faint ? ' sub-link-faint' : '') + (p.key === activeKey ? ' on' : '');
    var small = p.en ? '' : '';
    return '<a class="' + cls + '" href="' + p.href + '">' + p.label + small + '</a>';
  }).join('');
  links += '<div class="nav-group' + (aboutOpen ? ' open' : '') + '" id="nav-about">'
    + '<button type="button" class="nav-group-btn' + (aboutOpen ? ' on' : '') + '" id="nav-about-btn">'
    + '关于<small>About</small><i class="caret">▾</i></button>'
    + '<div class="nav-group-body">' + aboutLinks + '</div>'
    + '</div>';

  var bar = document.createElement('div');
  bar.className = 'topbar';
  bar.innerHTML = '<button id="nav-toggle" aria-label="菜单">☰</button>'
    + '<span class="title">' + SITE.name + '</span>';

  var mask = document.createElement('div');
  mask.className = 'mask';
  mask.id = 'nav-mask';
  mask.hidden = true;

  var aside = document.createElement('aside');
  aside.className = 'sidebar';
  aside.innerHTML =
    '<div class="brand">'
    + '<img src="./img/logo.png" alt="校徽">'
    + '<div class="name">' + SITE.name + '</div>'
    + '<div class="sub">Unofficial</div>'
    + '</div>'
    + '<nav>' + links + '</nav>'
    ;

  document.body.insertBefore(aside, document.body.firstChild);
  document.body.insertBefore(mask, document.body.firstChild);
  document.body.insertBefore(bar, document.body.firstChild);

  var userBtn = aside.querySelector('#nav-user-btn');
  if (userBtn) {
    userBtn.onclick = function () {
      var g = aside.querySelector('#nav-user');
      var open = g.classList.toggle('open');
      try { localStorage.setItem('jw_user_open', open ? '1' : '0'); } catch (e) {}
    };
    if (!userOpen) {
      try {
        if (localStorage.getItem('jw_user_open') === '1') aside.querySelector('#nav-user').classList.add('open');
      } catch (e) {}
    }
  }

  var aboutBtn = aside.querySelector('#nav-about-btn');
  if (aboutBtn) {
    aboutBtn.onclick = function () {
      var g = aside.querySelector('#nav-about');
      var open = g.classList.toggle('open');
      try { localStorage.setItem('jw_about_open', open ? '1' : '0'); } catch (e) {}
    };
    // 记住上次展开状态（只要不是当前页在关于里）
    if (!aboutOpen) {
      try {
        if (localStorage.getItem('jw_about_open') === '1') aside.querySelector('#nav-about').classList.add('open');
      } catch (e) {}
    }
  }

  bar.querySelector('#nav-toggle').onclick = function () {
    document.body.classList.toggle('nav-open');
    mask.hidden = !document.body.classList.contains('nav-open');
  };
  mask.onclick = function () {
    document.body.classList.remove('nav-open');
    mask.hidden = true;
  };
};

/* 页脚 */
SITE.footer = function (host) {
  var el = host || document.querySelector('.main') || document.body;
  var f = document.createElement('footer');
  f.className = 'site-footer';
  f.innerHTML =
    '<p class="contact-line">联系方式</p>'
    + '<p class="contact-list">'
    + '<span>微信：<b>MessialOWO</b></span>'
    + '<span>QQ：<a href="https://qm.qq.com/cgi-bin/qm/qr?k=&amp;uin=2961001891" target="_blank" rel="noopener">2961001891</a></span>'
    + '<span>邮箱：<a href="mailto:equalacorn28027@outlook.com">equalacorn28027@outlook.com</a></span>'
    + '</p>'
    + '<p><a href="./about-site.html">关于本站</a> · <a href="./about-school.html">关于学校</a> · 非官方网站</p>';
  el.appendChild(f);
};

/* ==========================================================================
   自定义背景（只存本地 localStorage，不上传、不入库）
   jw_bg_src : 压缩后的原图 dataURL（最长边 1600px，JPEG）
   jw_bg_cfg : { dim: 0~80 暗度, blur: 0~24 模糊 }
   做法：用 canvas 预先把图模糊掉再当背景，避免实时 filter 拖慢滚动。
   ========================================================================== */
SITE.BG = (function () {
  var SRC_KEY = 'jw_bg_src', CFG_KEY = 'jw_bg_cfg';
  var _blurCache = { key: '', url: '' };

  function readCfg() {
    try {
      var c = JSON.parse(localStorage.getItem(CFG_KEY) || 'null');
      if (!c) return { dim: 35, blur: 6 };
      return {
        dim: Math.max(0, Math.min(80, +c.dim || 0)),
        blur: Math.max(0, Math.min(24, +c.blur || 0))
      };
    } catch (e) { return { dim: 35, blur: 6 }; }
  }
  function readSrc() {
    try { return localStorage.getItem(SRC_KEY) || ''; } catch (e) { return ''; }
  }
  function saveCfg(cfg) {
    try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) {}
  }
  function saveSrc(dataUrl) {
    try { localStorage.setItem(SRC_KEY, dataUrl); return true; }
    catch (e) { return false; }   // 超出配额
  }

  /* 把图压缩到最长边 max 像素 */
  function compress(file, max, quality) {
    return new Promise(function (res, rej) {
      var im = new Image();
      im.onload = function () {
        var sc = Math.min(1, max / Math.max(im.width, im.height));
        var w = Math.max(1, Math.round(im.width * sc));
        var h = Math.max(1, Math.round(im.height * sc));
        var cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        var cx = cv.getContext('2d');
        cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h);
        cx.drawImage(im, 0, 0, w, h);
        res(cv.toDataURL('image/jpeg', quality || 0.82));
      };
      im.onerror = function () { rej(new Error('图片打不开（HEIC 请先转 JPG）')); };
      var fr = new FileReader();
      fr.onload = function () { im.src = fr.result; };
      fr.onerror = function () { rej(new Error('读取文件失败')); };
      fr.readAsDataURL(file);
    });
  }

  /* 生成模糊后的背景图（缩到 900px 再模糊，够用且快） */
  function blurImage(dataUrl, px) {
    return new Promise(function (res, rej) {
      if (!px || px < 0.5) return res(dataUrl);
      var im = new Image();
      im.onload = function () {
        var max = 900;
        var sc = Math.min(1, max / Math.max(im.width, im.height));
        var w = Math.max(1, Math.round(im.width * sc));
        var h = Math.max(1, Math.round(im.height * sc));
        var pad = Math.ceil(px * 3);            // 留出模糊需要的边，避免四边发白
        var cv = document.createElement('canvas');
        cv.width = w + pad * 2; cv.height = h + pad * 2;
        var cx = cv.getContext('2d');
        try { cx.filter = 'blur(' + px + 'px)'; } catch (e) {}
        cx.drawImage(im, pad, pad, w, h);
        // 裁掉留边，回到正常比例
        var out = document.createElement('canvas');
        out.width = w; out.height = h;
        out.getContext('2d').drawImage(cv, -pad, -pad);
        res(out.toDataURL('image/jpeg', 0.78));
      };
      im.onerror = function () { rej(new Error('处理失败')); };
      im.src = dataUrl;
    });
  }

  /* 把配置应用到页面 */
  function apply(src, cfg) {
    var body = document.body;
    if (!body) return;
    if (!src) {
      // 恢复默认背景
      body.style.backgroundImage = '';
      body.style.backgroundSize = '';
      body.style.backgroundPosition = '';
      body.style.backgroundAttachment = '';
      body.style.backgroundRepeat = '';
      body.style.backgroundColor = '';
      body.classList.remove('has-custom-bg');
      return;
    }
    var url;
    var key = src.slice(-48) + '|' + cfg.blur;
    if (_blurCache.key === key && _blurCache.url) {
      url = _blurCache.url;
    } else {
      url = src;   // 先立即用原图顶上，避免白屏
      blurImage(src, cfg.blur).then(function (u) {
        _blurCache = { key: key, url: u };
        paint(body, u, cfg);
      }).catch(function () {});
    }
    paint(body, url, cfg);
    body.classList.add('has-custom-bg');
  }

  function paint(body, url, cfg) {
    var d = (cfg.dim / 100).toFixed(3);
    body.style.backgroundColor = '#f6f4ef';
    body.style.backgroundImage =
      'linear-gradient(rgba(0,0,0,' + d + '), rgba(0,0,0,' + d + ')), url("' + url + '")';
    body.style.backgroundSize = 'auto, cover';
    body.style.backgroundPosition = '0 0, center center';
    body.style.backgroundAttachment = 'scroll, fixed';
    body.style.backgroundRepeat = 'repeat, no-repeat';
  }

  /* 启动时立即应用（脚本在 body 末尾，此时 body 已存在） */
  function boot() {
    var src = readSrc(), cfg = readCfg();
    if (!src) return;
    // 大图先测体积，超配额就放弃
    apply(src, cfg);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  return {
    getSrc: readSrc,
    getCfg: readCfg,
    saveCfg: saveCfg,
    saveSrc: saveSrc,
    compress: compress,
    apply: function () { apply(readSrc(), readCfg()); },
    preview: function (src, cfg) { apply(src || readSrc(), cfg || readCfg()); },
    clear: function () {
      try { localStorage.removeItem(SRC_KEY); localStorage.removeItem(CFG_KEY); } catch (e) {}
      apply('', {});
    }
  };
})();
