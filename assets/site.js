/* ===== 班级期刊 · 全站共享脚本（侧边栏 + 云端连接） ===== */
var SITE = {
  name: '班级期刊',
  school: '达州市高级中学',
  pages: [
    { href: './',                  label: '首页',       en: 'Home',      key: 'home' },
    { href: './gallery.html',      label: '画廊',       en: 'Gallery',   key: 'gallery' },
    { href: './guestbook.html',    label: '留言板',     en: 'Guestbook', key: 'guestbook' },
    { href: './journal/',          label: '期刊投稿',   en: 'Journal',   key: 'journal' },
    { href: './about-school.html', label: '关于学校',   en: 'About School', key: 'school' },
    { href: './about-site.html',   label: '关于本站',   en: 'About Site',   key: 'site' }
  ]
};

/* 生成侧边栏 + 顶栏（每个页面只需调用 SITE.shell('key')） */
SITE.shell = function (activeKey) {
  var links = SITE.pages.map(function (p) {
    return '<a href="' + p.href + '"' + (p.key === activeKey ? ' class="on"' : '') + '>'
      + p.label + '<small>' + p.en + '</small></a>';
  }).join('');

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
    + '<div class="sub">' + SITE.school + ' · 学生自建</div>'
    + '</div>'
    + '<nav>' + links + '</nav>'
    + '<footer>由学生自费维护<br>非学校官方网站</footer>';

  document.body.insertBefore(aside, document.body.firstChild);
  document.body.insertBefore(mask, document.body.firstChild);
  document.body.insertBefore(bar, document.body.firstChild);

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
    '<p>班级期刊 · ' + SITE.school + ' 学生自建</p>'
    + '<p class="contact-line">联系方式</p>'
    + '<p class="contact-list">'
    + '<span>微信：<b>MessialOWO</b></span>'
    + '<span>QQ：<a href="https://qm.qq.com/cgi-bin/qm/qr?k=&amp;uin=2961001891" target="_blank" rel="noopener">2961001891</a></span>'
    + '<span>邮箱：<a href="mailto:equalacorn28027@outlook.com">equalacorn28027@outlook.com</a></span>'
    + '</p>'
    + '<p><a href="./about-site.html">关于本站</a> · <a href="./about-school.html">关于学校</a></p>';
  el.appendChild(f);
};
