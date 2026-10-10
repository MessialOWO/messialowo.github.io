/* ===== 班级期刊 · 期刊投稿（期刊 → 专区 → 板块 → 文章） ===== */
(function () {
  var PW_SALT = 'jw-salt-2026';
  var SECTIONS = [
    { id: 'essay',   name: '散文',       en: 'Prose',  icon: '🖋' },
    { id: 'poem',    name: '诗歌',       en: 'Poetry', icon: '🌾' },
    { id: 'opinion', name: '议论',       en: 'Essay',  icon: '💬' },
    { id: 'news',    name: '班级新闻',   en: 'News',   icon: '📰' },
    { id: 'study',   name: '学习与知识', en: 'Study',  icon: '📚' }
  ];
  var $ = function (id) { return document.getElementById(id); };
  var sb = null, uid = '', deviceId = '', connected = false;
  var issues = [], boards = [], articles = [];
  var curIssue = '', curSection = 'essay';
  var busy = false;

  function status(t, kind) {
    var el = $('status');
    if (!el) return;
    if (!t) { el.hidden = true; el.textContent = ''; return; }
    el.hidden = false; el.className = 'status' + (kind ? ' ' + kind : ''); el.textContent = t;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function fmt(ts) {
    var d = new Date(ts); if (isNaN(d)) return '';
    var p = function (n) { return n < 10 ? '0' + n : '' + n; };
    return d.getFullYear() + '-' + p(d.getMonth()+1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function sha256(t) {
    if (window.crypto && window.crypto.subtle && window.TextEncoder) {
      return crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)).then(function (b) {
        return Array.prototype.map.call(new Uint8Array(b), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
      });
    }
    return Promise.reject(new Error('浏览器不支持加密接口'));
  }
  function isBadPw(e) { return /bad password/i.test((e && e.message) || ''); }
  function issueName(id) {
    for (var i = 0; i < issues.length; i++) if (issues[i].id === id) return issues[i].name;
    return '';
  }
  function sectionById(id) {
    for (var i = 0; i < SECTIONS.length; i++) if (SECTIONS[i].id === id) return SECTIONS[i];
    return SECTIONS[0];
  }
  function articleOf(boardId) {
    for (var i = 0; i < articles.length; i++) if (articles[i].board_id === boardId) return articles[i];
    return null;
  }

  /* ---- 渲染 ---- */
  function renderIssues() {
    var box = $('issue-bar'); box.textContent = '';
    var lab = document.createElement('span'); lab.className = 'label'; lab.textContent = '期刊：';
    box.appendChild(lab);
    issues.forEach(function (it) {
      var done = boards.filter(function (b) { return b.issue_id === it.id && articleOf(b.id); }).length;
      var all = boards.filter(function (b) { return b.issue_id === it.id; }).length;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'issue-pick' + (it.id === curIssue ? ' on' : '');
      b.innerHTML = esc(it.name) + '<small>' + done + '/' + all + ' 篇</small>';
      b.onclick = function () {
        if (curIssue === it.id) return;
        curIssue = it.id; curSection = 'essay'; hideForm();
        renderIssues(); renderSections(); renderBoards(); renderPanel();
      };
      box.appendChild(b);
    });
    if (window.__journalAdmin) {
      var add = document.createElement('button');
      add.type = 'button'; add.className = 'issue-add'; add.textContent = '＋ 新建期刊';
      add.onclick = newIssue; box.appendChild(add);
    }
  }
  function renderSections() {
    var box = $('section-tabs'); box.textContent = '';
    SECTIONS.forEach(function (s) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'section-tab' + (s.id === curSection ? ' on' : '');
      b.innerHTML = '<b>' + s.icon + ' ' + esc(s.name) + '</b><small>' + esc(s.en) + '</small>';
      b.onclick = function () {
        if (curSection === s.id) return;
        curSection = s.id; curBoard = ''; hideForm();
        renderSections(); renderBoards(); renderPanel();
      };
      box.appendChild(b);
    });
  }
  var curBoard = '';
  function renderBoards() {
    var box = $('boards'); box.textContent = '';
    var list = boards.filter(function (b) { return b.issue_id === curIssue && b.section === curSection; });
    if (!list.length) {
      var t = document.createElement('div');
      t.style.cssText = 'color:var(--muted);font-size:.9rem;padding:6px 0';
      t.textContent = (issueName(curIssue) || '本期') + ' 的「' + sectionById(curSection).name + '」还没有板块。';
      box.appendChild(t);
      return;
    }
    list.forEach(function (b) {
      var art = articleOf(b.id);
      var chip = document.createElement('a');
      chip.className = 'board-chip' + (b.id === curBoard ? ' on' : '') + (art ? ' has' : '');
      chip.href = art ? ('article.html?board=' + b.id) : 'javascript:void(0)';
      chip.innerHTML = '<span class="dot"></span>' + esc(b.name);
      if (!art) chip.onclick = function () { curBoard = b.id; renderBoards(); renderPanel(); };
      box.appendChild(chip);
    });
  }
  function renderPanel() {
    var panel = $('panel'); panel.textContent = '';
    if (!issues.length) {
      panel.innerHTML = '<div class="empty">还没有任何期刊。</div>';
      return;
    }
    var list = boards.filter(function (b) { return b.issue_id === curIssue && b.section === curSection; });
    if (!list.length) { panel.innerHTML = '<div class="empty">这个区还没有板块。</div>'; return; }
    if (!curBoard || !list.some(function (b) { return b.id === curBoard; })) curBoard = list[0].id;
    var board = list.filter(function (b) { return b.id === curBoard; })[0];
    var art = articleOf(board.id);
    var box = document.createElement('div');
    if (art) {
      box.className = 'card-box';
      box.innerHTML = '<h3 style="font-size:1.4rem;margin-bottom:8px">' + esc(art.title) + '</h3>'
        + '<div style="color:var(--muted);font-size:.86rem;margin-bottom:14px">'
        + '作者：' + esc(art.author) + ' · 发布：' + fmt(art.created_at) + '</div>'
        + '<div style="white-space:pre-wrap;max-height:340px;overflow:hidden">' + esc(art.body.slice(0, 400)) + '…</div>'
        + '<div style="margin-top:16px"><a class="btn btn-main" style="display:inline-block;text-decoration:none" href="article.html?board=' + board.id + '">阅读全文 →</a></div>';
    } else {
      box.className = 'empty';
      box.textContent = '「' + board.name + '」还没有文章。';
    }
    panel.appendChild(box);
  }

  /* ---- 数据 ---- */
  function loadAll() {
    return JW.sb.from('issues').select('id,name,slug,sort_order').order('sort_order')
      .then(function (r) {
        if (r.error) throw r.error;
        issues = r.data || [];
        if (!curIssue || !issues.some(function (i) { return i.id === curIssue; })) curIssue = issues.length ? issues[0].id : '';
        return JW.sb.from('boards').select('id,issue_id,section,name,sort_order').order('sort_order');
      })
      .then(function (r) {
        if (r.error) throw r.error;
        boards = r.data || [];
        return JW.sb.from('articles').select('id,board_id,title,author,body,cover_path,like_count,created_at').eq('hidden', false).limit(300);
      })
      .then(function (r) {
        if (r.error) throw r.error;
        articles = r.data || [];
      });
  }
  function refresh() { renderIssues(); renderSections(); renderBoards(); renderPanel(); }

  /* ---- 新建期刊（需要密码） ---- */
  function newIssue() {
    var name = prompt('新建一期期刊\n请输入期号名（例如：期刊3）：');
    if (name === null || !name.trim()) return;
    var pw = prompt('请输入管理密码：');
    if (pw === null || !pw.trim()) return;
    status('正在新建期刊……');
    sha256(PW_SALT + '|' + pw.trim())
      .then(function (h) { return JW.sb.rpc('create_issue', { p_name: name.trim(), p_pw_hash: h }); })
      .then(function (r) {
        if (r.error) throw r.error;
        status('期刊已新建 ✅', 'ok');
        return loadAll().then(refresh);
      })
      .catch(function (e) { status(isBadPw(e) ? '密码不对。' : (e.message || e), 'err'); });
  }
  function hideForm() {}

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
  function start() {
    JW.whenReady(function (err) {
      if (err) { status('连不上云端：' + (err.message || err), 'err'); return; }
      sb = JW.sb;
      JW.retry(function () { return JW.withTimeout(loadAll(), 20000, '加载期刊'); }, 2)
        .then(function () { connected = true; refresh(); status(''); })
        .catch(function (e) { status('加载失败：' + (e.message || e), 'err'); });
    });
  }
})();
