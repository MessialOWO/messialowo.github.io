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
  function ensureToolbar() {
    if (document.getElementById('jr-tools')) return;
    var bar = $('section-tabs').parentNode.insertBefore(document.createElement('div'), $('section-tabs'));
    bar.id = 'jr-tools';
    bar.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;margin:14px 0';
    bar.innerHTML = '<button class="btn-ghost" id="jr-newboard" type="button">＋ 新建板块</button>'
      + '<button class="btn-ghost" id="jr-refresh" type="button">↻ 刷新</button>';
    document.getElementById('jr-newboard').onclick = function () { newBoard(); };
    document.getElementById('jr-refresh').onclick = function () {
      status('正在刷新……');
      loadAll().then(function () { refresh(); status('已刷新', 'ok'); setTimeout(function () { status(''); }, 1200); })
        .catch(function (e) { status('刷新失败：' + ((e && e.message) || e), 'err'); });
    };
  }

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
    box.className = 'card-box';
    box.style.position = 'relative';

    if (art) {
      var h = document.createElement('h3');
      h.style.cssText = 'font-size:1.4rem;margin-bottom:8px';
      h.textContent = art.title;
      var meta = document.createElement('div');
      meta.style.cssText = 'color:var(--muted);font-size:.86rem;margin-bottom:14px';
      meta.textContent = '作者：' + art.author + ' · 发布：' + fmt(art.created_at);
      var preview = document.createElement('div');
      preview.style.cssText = 'white-space:pre-wrap;max-height:340px;overflow:hidden';
      preview.textContent = art.body.slice(0, 400) + (art.body.length > 400 ? '…' : '');
      box.appendChild(h); box.appendChild(meta); box.appendChild(preview);

      var acts = document.createElement('div');
      acts.style.cssText = 'margin-top:16px;display:flex;gap:10px;flex-wrap:wrap';
      var read = document.createElement('a');
      read.className = 'btn btn-main'; read.href = 'article.html?board=' + board.id;
      read.textContent = '阅读全文';
      read.style.cssText = 'display:inline-block;text-decoration:none';
      var edit = document.createElement('button');
      edit.className = 'btn-ghost'; edit.type = 'button'; edit.textContent = '✏️ 修改';
      edit.onclick = function () { openEditor(board, art); };
      var del = document.createElement('button');
      del.className = 'btn-ghost'; del.type = 'button'; del.textContent = '🗑 删掉这篇';
      del.onclick = function () { deleteArticle(board, art); };
      acts.appendChild(read); acts.appendChild(edit); acts.appendChild(del);
      box.appendChild(acts);
    } else {
      var tip = document.createElement('div');
      tip.className = 'empty';
      tip.textContent = '「' + board.name + '」还没有文章。';
      box.appendChild(tip);
      var bar = document.createElement('div');
      bar.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;margin-top:14px';
      var w1 = document.createElement('button');
      w1.className = 'btn-main'; w1.type = 'button'; w1.textContent = '＋ 写这一板块的文章';
      w1.onclick = function () { openEditor(board, null); };
      var d1 = document.createElement('button');
      d1.className = 'btn-ghost'; d1.type = 'button'; d1.textContent = '🗑 删掉这个板块';
      d1.onclick = function () { deleteBoard(board); };
      bar.appendChild(w1); bar.appendChild(d1);
      box.appendChild(bar);
    }
    panel.appendChild(box);
  }

  /* ---------------- 写 / 改 文章 ---------------- */
  function openEditor(board, article) {
    var old = document.getElementById('editor');
    if (old) old.remove();
    var form = document.createElement('div');
    form.id = 'editor';
    form.className = 'card-box';
    form.style.marginBottom = '22px';
    form.innerHTML =
      '<h3 style="font-size:1.15rem;margin-bottom:14px">' + (article ? '修改' : '写') + '「' + esc(board.name) + '」的文章</h3>'
      + '<div style="font-size:.82rem;color:var(--muted);margin-bottom:14px">正文排版：空行分段，一行以「## 」开头是小标题，以「> 」开头是引用。</div>'
      + '<label style="display:block;font-size:.85rem;color:var(--muted);margin-bottom:6px">标题</label>'
      + '<input type="text" id="ed-title" maxlength="60" placeholder="文章标题" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:1rem;margin-bottom:14px">'
      + '<label style="display:block;font-size:.85rem;color:var(--muted);margin-bottom:6px">作者</label>'
      + '<input type="text" id="ed-author" maxlength="20" placeholder="作者姓名" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:1rem;margin-bottom:14px">'
      + '<label style="display:block;font-size:.85rem;color:var(--muted);margin-bottom:6px">正文</label>'
      + '<textarea id="ed-body" placeholder="把文章粘到这里……" style="width:100%;min-height:260px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:1rem;line-height:1.8;margin-bottom:14px;resize:vertical"></textarea>'
      + '<label style="display:block;font-size:.85rem;color:var(--muted);margin-bottom:6px">管理密码</label>'
      + '<input type="password" id="ed-pw" placeholder="写/改文章需要密码" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:1rem;margin-bottom:16px">'
      + '<div style="display:flex;gap:10px"><button class="btn-main" id="ed-save" type="button">' + (article ? '保存修改' : '发布文章') + '</button>'
      + '<button class="btn-ghost" id="ed-cancel" type="button">取消</button></div>';

    var panel = $('panel');
    panel.insertBefore(form, panel.firstChild);
    form.scrollIntoView({ block: 'start' });

    $('ed-title').value = article ? article.title : '';
    $('ed-author').value = article ? article.author : (localStorage.getItem('jw_art_author') || '');
    $('ed-body').value = article ? article.body : '';
    $('ed-cancel').onclick = function () { form.remove(); };

    $('ed-save').onclick = function () {
      if (busy) return;
      var t = $('ed-title').value.trim(), a = $('ed-author').value.trim();
      var b = $('ed-body').value.trim(), pw = $('ed-pw').value;
      if (!t) { alert('请填标题'); return; }
      if (!a) { alert('请填作者'); return; }
      if (!b) { alert('正文不能空着'); return; }
      if (!pw.trim()) { alert('请输入管理密码'); return; }
      var save = this;
      busy = true; save.disabled = true; save.textContent = '提交中…';
      status('正在校验密码并提交……');
      sha256(PW_SALT + '|' + pw.trim()).then(function (h) {
        return JW.sb.rpc('save_article', {
          p_board_id: board.id, p_title: t, p_author: a, p_body: b,
          p_cover_path: article ? (article.cover_path || null) : null,
          p_pw_hash: h, p_device_id: deviceId
        });
      }).then(function (r) {
        if (r.error) throw r.error;
        try { localStorage.setItem('jw_art_author', a); } catch (e) {}
        status('已保存 ✅', 'ok');
        form.remove();
        return loadAll().then(refresh);
      }).catch(function (e) {
        status(isBadPw(e) ? '密码不对，没有保存。' : ((e && e.message) || String(e)), 'err');
      }).then(function () { busy = false; save.disabled = false; save.textContent = article ? '保存修改' : '发布文章'; });
    };
  }

  function deleteArticle(board, article) {
    if (!confirm('删掉《' + article.title + '》？不可恢复。')) return;
    var pw = prompt('删除需要管理密码：');
    if (pw === null || !pw.trim()) return;
    status('正在校验密码……');
    sha256(PW_SALT + '|' + pw.trim()).then(function (h) {
      return JW.sb.rpc('delete_article', { p_article_id: article.id, p_pw_hash: h });
    }).then(function (r) {
      if (r.error) throw r.error;
      var o = r.data; if (typeof o === 'string') { try { o = JSON.parse(o); } catch (e) {} }
      if (!o || o.deleted !== true) throw new Error('bad password');
      status('文章已删除，这个板块可以写新的了。', 'ok');
      return loadAll().then(refresh);
    }).catch(function (e) {
      status(isBadPw(e) ? '密码不对，没有删除。' : ((e && e.message) || String(e)), 'err');
    });
  }

  function deleteBoard(board) {
    if (!confirm('删掉板块「' + board.name + '」？里面的文章、评论会一起删掉。')) return;
    var pw = prompt('删除需要管理密码：');
    if (pw === null || !pw.trim()) return;
    status('正在校验密码……');
    sha256(PW_SALT + '|' + pw.trim()).then(function (h) {
      return JW.sb.rpc('delete_board', { p_board_id: board.id, p_pw_hash: h });
    }).then(function (r) {
      if (r.error) throw r.error;
      var o = r.data; if (typeof o === 'string') { try { o = JSON.parse(o); } catch (e) {} }
      if (!o || o.deleted !== true) throw new Error('bad password');
      status('板块已删除。', 'ok');
      if (curBoard === board.id) curBoard = '';
      return loadAll().then(refresh);
    }).catch(function (e) {
      status(isBadPw(e) ? '密码不对，没有删除。' : ((e && e.message) || String(e)), 'err');
    });
  }

  /* ---------------- 新建板块（需要密码） ---------------- */
  function newBoard() {
    if (!curIssue) { status('请先新建一期期刊。', 'err'); return; }
    var name = prompt('在「' + issueName(curIssue) + ' · ' + sectionById(curSection).name + '」新建板块\n请输入板块名：');
    if (name === null || !name.trim()) return;
    var pw = prompt('请输入管理密码：');
    if (pw === null || !pw.trim()) return;
    status('正在新建板块……');
    sha256(PW_SALT + '|' + pw.trim()).then(function (h) {
      return JW.sb.rpc('create_board', {
        p_issue_id: curIssue, p_section: curSection, p_name: name.trim(), p_pw_hash: h
      });
    }).then(function (r) {
      if (r.error) throw r.error;
      var o = r.data; if (typeof o === 'string') { try { o = JSON.parse(o); } catch (e) {} }
      status('板块已新建 ✅', 'ok');
      return loadAll().then(function () {
        if (o && o.id) curBoard = o.id;
        refresh();
      });
    }).catch(function (e) {
      var m = (e && e.message) || String(e);
      status(isBadPw(e) ? '密码不对。' : (/duplicate key/i.test(m) ? '这个区已经有同名板块了。' : m), 'err');
    });
  }

  window.__journalNewBoard = newBoard;

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
  function refresh() { ensureToolbar(); renderIssues(); renderSections(); renderBoards(); renderPanel(); }

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
