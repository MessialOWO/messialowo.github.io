/* ===== 个人资料卡（点帖子头像弹出） ===== */
var PROFILE = (function () {
  var $ = function (id) { return document.getElementById(id); };
  var cache = {};          // username -> profile
  var cur = null;

  function storageUrl(p) {
    if (typeof p !== 'string' || !/^[A-Za-z0-9-]{1,64}\/[A-Za-z0-9._-]{1,80}$/.test(p)) return '';
    return (window.JW && JW.storagePublic || '') + p;
  }
  function fmtDate(ts) {
    var d = new Date(ts); if (isNaN(d)) return '';
    return d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月加入';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* 建弹层（只建一次） */
  function ensureDom() {
    if ($('pc-modal')) return;
    var box = document.createElement('div');
    box.className = 'pc-modal';
    box.id = 'pc-modal';
    box.hidden = true;
    box.innerHTML =
      '<div class="pc-mask" id="pc-mask"></div>' +
      '<div class="pc-card" role="dialog" aria-modal="true">' +
      '  <div class="pc-cover" id="pc-cover"></div>' +
      '  <button class="pc-close" id="pc-close" type="button" aria-label="关闭">✕</button>' +
      '  <div class="pc-body">' +
      '    <div class="pc-avatar" id="pc-avatar"></div>' +
      '    <div class="pc-name" id="pc-name"></div>' +
      '    <div class="pc-uid" id="pc-uid"></div>' +
      '    <div class="pc-bio" id="pc-bio"></div>' +
      '    <div class="pc-meta" id="pc-meta"></div>' +
      '    <div class="pc-actions" id="pc-actions"></div>' +
      '  </div>' +
      '</div>';
    document.body.appendChild(box);

    $('pc-mask').onclick = close;
    $('pc-close').onclick = close;
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !box.hidden) close();
    });
  }

  function close() {
    var box = $('pc-modal');
    if (box) box.hidden = true;
    document.body.style.overflow = '';
    cur = null;
  }

  function render(p) {
    var cover = $('pc-cover');
    cover.style.backgroundImage = '';
    if (p.cover_path) {
      var cu = storageUrl(p.cover_path);
      if (cu) cover.style.backgroundImage = 'url("' + cu + '")';
    }
    cover.classList.toggle('no-cover', !p.cover_path);

    var av = $('pc-avatar');
    av.textContent = '';
    var el = document.createElement('div');
    el.className = 'avatar-circle';
    el.style.cssText = 'width:76px;height:76px;font-size:2.1rem;border:3px solid #fff;box-shadow:0 3px 12px rgba(0,0,0,.16)';
    if (p.avatar_mode === 'image' && p.avatar_path) {
      var im = document.createElement('img');
      im.src = storageUrl(p.avatar_path); im.alt = '';
      im.onerror = function () { el.textContent = p.avatar_emoji || '🙂'; el.style.background = p.avatar_color || '#c0392b'; };
      el.appendChild(im);
    } else {
      el.textContent = p.avatar_emoji || '🙂';
      el.style.background = /^#[0-9a-fA-F]{6}$/.test(p.avatar_color || '') ? p.avatar_color : '#c0392b';
    }
    av.appendChild(el);

    $('pc-name').textContent = p.nickname || p.username;
    $('pc-uid').textContent = p.username;

    var bio = $('pc-bio');
    if (p.bio) { bio.textContent = p.bio; bio.hidden = false; }
    else { bio.textContent = '这个人还没写简介'; bio.hidden = false; bio.classList.add('empty-bio'); }

    var meta = $('pc-meta');
    meta.textContent = '';
    if (p.posts != null) {
      var s1 = document.createElement('span');
      s1.textContent = p.posts + ' 条帖子';
      meta.appendChild(s1);
    }
    if (p.created_at) {
      var s2 = document.createElement('span');
      s2.textContent = fmtDate(p.created_at);
      meta.appendChild(s2);
    }

    // 查看完整个人主页
    var acts = $('pc-actions');
    if (acts) {
      acts.textContent = '';
      var uname = String(p.username || '').replace(/^@+/, '');
      if (uname) {
        var go = document.createElement('button');
        go.type = 'button';
        go.className = 'pc-btn-main';
        go.textContent = '查看完整主页';
        go.onclick = function () { location.href = './profile.html?u=' + encodeURIComponent(uname); };
        acts.appendChild(go);
      }
    }
  }

  function openByUsername(username) {
    if (!username) return;
    var key = String(username).replace(/^@+/, '').toLowerCase();
    ensureDom();
    var box = $('pc-modal');
    box.hidden = false;
    document.body.style.overflow = 'hidden';

    if (cache[key]) { render(cache[key]); return; }

    // 先占位
    $('pc-name').textContent = '加载中……';
    $('pc-uid').textContent = '@' + username;
    $('pc-bio').textContent = '';
    $('pc-meta').textContent = '';
    $('pc-avatar').textContent = '';
    $('pc-cover').style.backgroundImage = '';
    $('pc-cover').classList.add('no-cover');

    if (!window.JW || !JW.sb) {
      $('pc-name').textContent = '连不上服务器';
      return;
    }
    JW.sb.rpc('get_profile', { p_username: username }).then(function (r) {
      if (r.error) throw r.error;
      var p = r.data;
      if (typeof p === 'string') { try { p = JSON.parse(p); } catch (e) {} }
      if (!p) { $('pc-name').textContent = '找不到这个用户'; return; }
      cache[key] = p;
      render(p);
    }).catch(function (e) {
      $('pc-name').textContent = '加载失败：' + ((e && e.message) || e);
    });
  }

  function bind(container) {
    if (!container) return;
    container.addEventListener('click', function (e) {
      var trigger = e.target.closest ? e.target.closest('[data-profile]') : null;
      if (!trigger) return;
      e.preventDefault();
      e.stopPropagation();
      openByUsername(trigger.getAttribute('data-profile'));
    });
  }

  return { open: openByUsername, bind: bind, close: close, clearCache: function () { cache = {}; } };
})();
