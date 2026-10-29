/* ===== 班级期刊 · 留言板（两级分区 + 标签 + 搜索）=====
   大分区固定 11 个（未分区/学习/新闻/作品/失物招领/游戏/二次元/内娱/学校吐槽/意见建议/其他）
   小分区 用户可在某个大分区下自建（≤5汉字或10字母），删除要密码
   帖子支持 #标签，自动识别，点击跳搜索
   ===== */
var GB = (function () {
  var PW_SALT = 'jw-salt-2026';
  var MAINS = ['未分区','学习','新闻','作品','失物招领','游戏','二次元','内娱','学校吐槽','意见建议','其他'];
  var EMOJIS = ['🙂','🐹','🐰','🦊','🐼','🐨','🐯','🦁','🐸','🐧','🐳','🦄','🌻','🌙','⚡','🍀'];
  var COLORS = ['#c0392b','#e67e22','#d4a017','#27ae60','#16a085','#2980b9','#8e44ad','#d95f8f','#5d6d7e','#2c3e50'];
  var PAGE_SIZE = 100;
  var $ = function (id) { return document.getElementById(id); };
  function scrollToEl(el, block) {
    if (el && typeof el.scrollIntoView === 'function') {
      try { el.scrollIntoView({ block: block || 'center', behavior: 'smooth' }); } catch (e) {}
    }
  }

  var sb = null, uid = '', deviceId = '', connected = false, busy = false;
  var sections = [], subs = [], messages = [], msgImages = {}, repliesByMsg = {}, likedSet = {};
  var profileMap = {};      // 小写用户名 -> 账户最新资料（用于覆盖帖子里的旧资料）
  var curMain = '', curSub = '';
  var sortMode = 'default';      // default | time | hot
  var REPLY_FOLD = 1;            // 默认只显示 1 条评论
  var REPLY_STEP = 5;            // 每次展开再多显示 5 条
  var replyShown = {};           // msgId -> 当前显示的顶层评论条数
  var expandedPost = '';         // 当前展开了评论的帖子（只允许一个展开）
  var selEmoji = '🙂', selColor = COLORS[0], avatarMode = 'emoji', selImage = '', selImagePath = '';
  var uploadingAvatar = false;
  var pendingFiles = [], MAX_FILES = 4;   // 图片/音频/视频，共最多 4 个
  var MAX_IMAGE_MB = 15, MAX_AUDIO_MB = 20, MAX_VIDEO_MB = 20;   // 受中转单文件限制

  function kindOf(file) {
    var t = (file.type || '').toLowerCase();
    if (t.indexOf('image/') === 0) return 'image';
    if (t.indexOf('audio/') === 0) return 'audio';
    if (t.indexOf('video/') === 0) return 'video';
    var n = (file.name || '').toLowerCase();
    if (/\.(jpg|jpeg|png|gif|webp|bmp|heic)$/.test(n)) return 'image';
    if (/\.(mp3|wav|m4a|aac|ogg|flac|opus|amr)$/.test(n)) return 'audio';
    if (/\.(mp4|mov|webm|mkv|avi|m4v|3gp)$/.test(n)) return 'video';
    return '';
  }
  function iconOf(kind) { return kind === 'audio' ? '🎵' : kind === 'video' ? '🎬' : '🖼'; }
  function limitOf(kind) { return kind === 'audio' ? MAX_AUDIO_MB : kind === 'video' ? MAX_VIDEO_MB : MAX_IMAGE_MB; }

  function status(t, kind) {
    var el = $('gb-status');
    if (!el) return;
    if (!t) { el.hidden = true; el.textContent = ''; return; }
    el.hidden = false; el.className = 'gb-status' + (kind ? ' ' + kind : ''); el.textContent = t;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
  function fmt(ts) { var d=new Date(ts); if(isNaN(d))return ''; var p=function(n){return n<10?'0'+n:''+n}; return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+' '+p(d.getHours())+':'+p(d.getMinutes()); }
  function secName(id) { for (var i=0;i<subs.length;i++) if (subs[i].id===id) return subs[i].name; return ''; }
  function sha(t) {
    if (window.crypto && crypto.subtle) return crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)).then(function(b){
      return Array.prototype.map.call(new Uint8Array(b), function(x){return ('0'+x.toString(16)).slice(-2);}).join('');
    });
    return Promise.reject(new Error('浏览器不支持加密'));
  }
  function badPw(e){ return /bad password/i.test((e&&e.message)||''); }
  function avatarUrl(p){ if(typeof p!=='string'||!/^[A-Za-z0-9-]{1,64}\/[A-Za-z0-9._-]{1,80}$/.test(p))return ''; return (window.JW&&JW.storagePublic||'')+p; }

  /* ---------- 标签解析：从正文里抓 #标签 ---------- */
  // 规则：# 后面跟字母/数字/汉字，最长 12 个字符，中间不能有空格
  function parseTags(text) {
    var out = [], re = /#([A-Za-z0-9_\u4e00-\u9fff]{1,12})/g, m;
    while ((m = re.exec(text || '')) !== null) {
      if (out.indexOf(m[1]) < 0) out.push(m[1]);
      if (out.length >= 5) break;
    }
    return out;
  }
  // 渲染正文：把 #标签 变成可点击
  function renderContent(host, text) {
    host.textContent = '';
    var re = /#([A-Za-z0-9_\u4e00-\u9fff]{1,12})/g;
    var last = 0, m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) host.appendChild(document.createTextNode(text.slice(last, m.index)));
      var a = document.createElement('a');
      a.href = './search.html?tag=' + encodeURIComponent(m[1]);
      a.className = 'gb-tag';
      a.textContent = '#' + m[1];
      host.appendChild(a);
      last = m.index + m[0].length;
    }
    if (last < text.length) host.appendChild(document.createTextNode(text.slice(last)));
  }

  /* ---------- 渲染 ---------- */
  function renderSortBar() {
    var box = $('gb-sort');
    if (!box) return;
    box.textContent = '';
    var opts = [['default','默认'],['time','时间'],['hot','热度']];
    var lab = document.createElement('span');
    lab.className = 'gb-sort-label';
    lab.textContent = '排序：';
    box.appendChild(lab);
    opts.forEach(function (o) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'gb-sec-chip' + (sortMode === o[0] ? ' on' : '');
      b.textContent = o[1];
      b.onclick = function () {
        if (sortMode === o[0]) return;
        sortMode = o[0];
        var exp = expandedPost; expandedPost = '';
        renderSortBar(); render();
        if (exp) setTimeout(function(){ scrollToEl(document.getElementById('p-'+exp)); }, 60);
      };
      box.appendChild(b);
    });
    var tip = document.createElement('span');
    tip.className = 'gb-sort-tip';
    tip.textContent = sortMode === 'default' ? '置顶在最上面' : '置顶不再排到最前（仍带📌标签）';
    box.appendChild(tip);
  }

  function renderSubBar() {
    var box = $('gb-subs');
    if (!box) return;
    box.textContent = '';
    var list = subs.filter(function (x) { return x.main_section === curMain; });
    if (!curMain) return;          // 只有大分区页才有小分区栏

    if (!list.length) {
      var hint = document.createElement('span');
      hint.style.cssText = 'font-size:.78rem;color:var(--muted);align-self:center;white-space:nowrap';
      hint.textContent = '还没有小分区，先建一个：';
      box.appendChild(hint);
    }
    // 只有一个小分区时不需要「全部」
    if (curSub && list.length > 1) {
      var all = document.createElement('button');
      all.type = 'button'; all.className = 'gb-sec-chip';
      all.textContent = '全部';
      all.onclick = function () { curSub = ''; renderSubBar(); render(); scrollChipIntoView(all); };
      box.appendChild(all);
    }
    list.forEach(function (sec) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'gb-sec-chip' + (curSub === sec.id ? ' on' : '');
      var n = messages.filter(function (m) { return m.sub_section_id === sec.id; }).length;
      b.textContent = sec.name + (n ? ' ' + n : '');
      // 点小分区就是选中它，不做"再点取消"（否则会跳回"全部"，看起来像丢了分区）
      b.onclick = function () {
        if (curSub === sec.id) return;
        curSub = sec.id;
        renderSubBar(); render();
        scrollChipIntoView(b);
      };
      box.appendChild(b);
    });
    // 「未分类」是每个大分区的固定小分区，不允许删除
    var curObj = null;
    for (var ci = 0; ci < list.length; ci++) if (list[ci].id === curSub) curObj = list[ci];
    var isFixed = curObj && /(未分组|未分类|未归类|默认)$/.test(btrimName(curObj.name));
    if (curSub && !isFixed) {
      var del = document.createElement('button');
      del.type = 'button'; del.className = 'gb-sec-chip del'; del.textContent = '🗑 删除';
      del.onclick = function () { deleteSub(curSub); };
      box.appendChild(del);
    } else if (isFixed) {
      var fix = document.createElement('span');
      fix.style.cssText = 'font-size:.72rem;color:var(--muted);align-self:center;white-space:nowrap';
      fix.textContent = '默认分区';
      box.appendChild(fix);
    }
    var add = document.createElement('button');
    add.type = 'button'; add.className = 'gb-sec-chip add'; add.textContent = '＋ 新建';
    add.onclick = newSub;
    box.appendChild(add);
  }

  /* 加载中的占位 */
  function showLoading(text) {
    var listEl = $('gb-list');
    if (!listEl) return;
    listEl.textContent = '';
    var box = document.createElement('div');
    box.className = 'gb-loading';
    box.innerHTML = '<span class="gb-spin"></span><span>' + (text || '正在加载留言……') + '</span>';
    listEl.appendChild(box);
  }

  function render() {
    renderSortBar();
    var listEl = $('gb-list');
    if (!listEl) return;
    listEl.textContent = '';
    var show = messages.filter(function (m) {
      if (curMain && m.main_section !== curMain) return false;
      if (curSub && m.sub_section_id !== curSub) return false;
      return true;
    });
    // 排序
    if (sortMode === 'time') {
      show = show.slice().sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });
    } else if (sortMode === 'hot') {
      show = show.slice().sort(function (a, b) {
        var d = (b.like_count || 0) - (a.like_count || 0);
        return d !== 0 ? d : (new Date(b.created_at) - new Date(a.created_at));
      });
    } else {
      // 默认：置顶的单独提到最前面，其余按时间倒序
      var pinned = show.filter(function (m) { return m.is_pinned; });
      var rest = show.filter(function (m) { return !m.is_pinned; });
      pinned.sort(function (a, b) { return new Date(b.pinned_at || b.created_at) - new Date(a.pinned_at || a.created_at); });
      rest.sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });
      show = pinned.concat(rest);
    }
    if (!show.length) {
      var e = document.createElement('div');
      e.className = 'empty';
      if (!connected) { showLoading(); return; }
      e.textContent = curSub ? '这个小分区还没有帖子，你可以发第一条。' : '这里还没有帖子。';
      listEl.appendChild(e);
      return;
    }
    show.forEach(function (m) { listEl.appendChild(postEl(m)); });
  }

  function postEl(msg) {
    var item = document.createElement('div');
    item.className = 'gb-item' + (msg.is_pinned ? ' pinned' : '');
    item.id = 'p-' + msg.id;
    item.classList.add('gb-clickable');
    item.setAttribute('data-post-id', msg.id);
    // 点卡片空白处进详情页；按钮/图片/链接等交互元素不跳
    item.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      if (t.closest('button, a, input, textarea, select, audio, video, .gb-action-btn, .gb-attach, .gb-img, .gb-fold-bar, [data-no-nav]')) return;
      // 有选区（用户刚选中文字）时不跳
      try { if (String(window.getSelection() || '').length > 0) return; } catch (err) {}
      location.href = './post.html?id=' + encodeURIComponent(msg.id);
    });
    var ef = effective(msg);
    item.appendChild(avatarNode(ef.color, ef.emoji, ef.path, 'big', ef.username || msg.name));

    var body = document.createElement('div');
    body.className = 'gb-body';

    var head = document.createElement('div');
    head.className = 'gb-header';
    if (msg.is_pinned) {
      var pin = document.createElement('span'); pin.className = 'gb-pin-badge'; pin.textContent = '📌 置顶'; head.appendChild(pin);
    }
    var nmWrap = document.createElement('span');
    nmWrap.className = 'gb-name-wrap';
    var nm = document.createElement('span'); nm.className = 'gb-name'; nm.textContent = ef.name;
    nmWrap.appendChild(nm);
    var uname = ef.username || msg.author_username;
    if (uname) {
      var uid = document.createElement('span');
      uid.className = 'gb-uid';
      uid.textContent = '@' + String(uname).replace(/^@+/, '');
      uid.setAttribute('data-profile', String(uname).replace(/^@+/, ''));
      uid.style.cursor = 'pointer';
      nmWrap.appendChild(uid);
    }
    head.appendChild(nmWrap);
    var tm = document.createElement('span'); tm.className = 'gb-time'; tm.textContent = fmt(msg.created_at); head.appendChild(tm);
    var tag = document.createElement('span'); tag.className = 'gb-sec-tag';
    tag.textContent = (msg.main_section || '未分区') + (msg.sub_section_id && secName(msg.sub_section_id) ? ' · ' + secName(msg.sub_section_id) : '');
    head.appendChild(tag);

    var ct = document.createElement('div'); ct.className = 'gb-content';
    renderContent(ct, msg.content);

    body.appendChild(head); body.appendChild(ct);
    renderImages(body, msg);
    body.appendChild(actionsEl(msg, body));
    renderReplies(body, msg);
    item.appendChild(body);
    return item;
  }

  function avatarNode(color, emoji, path, size, username) {
    var el = document.createElement('div');
    el.className = 'avatar-circle ' + (size === 'small' ? 'small' : 'big');
    if (username) {
      el.setAttribute('data-profile', String(username).replace(/^@+/, ''));
      el.style.cursor = 'pointer';
      el.title = '查看「' + String(username).replace(/^@+/, '') + '」的资料';
    }
    var url = avatarUrl(path);
    if (url) {
      var im = document.createElement('img'); im.src = url; im.alt = ''; im.loading = 'lazy';
      im.onerror = function () { el.textContent = emoji || '🙂'; el.style.background = color || COLORS[0]; };
      el.style.background = '#f0f0f0'; el.appendChild(im);
    } else {
      el.style.background = /^#[0-9a-fA-F]{6}$/.test(color || '') ? color : COLORS[0];
      el.textContent = emoji || '🙂';
    }
    return el;
  }

  function renderImages(host, msg) {
    var list = msgImages[msg.id] || [];
    if (!list.length) return;

    var imgs = [], others = [];
    list.forEach(function (it) {
      var url = avatarUrl(it.image_path);
      if (!url) return;
      it._url = url;
      if ((it.media_type || 'image') === 'image') imgs.push(it);
      else others.push(it);
    });

    // 图片：缩略图网格
    if (imgs.length) {
      var box = document.createElement('div');
      box.className = 'gb-msg-images';
      imgs.forEach(function (it) {
        var el = document.createElement('img');
        el.src = it._url; el.loading = 'lazy'; el.alt = '图片';
        el.onclick = function () {
          if (window.__jwOpenImage) window.__jwOpenImage(it._url, '图片');
          else window.open(it._url, '_blank');
        };
        box.appendChild(el);
      });
      host.appendChild(box);
    }

    // 音频 / 视频 / 其它
    if (others.length) {
      var wrap = document.createElement('div');
      wrap.className = 'gb-media-list';
      others.forEach(function (it) {
        if (it.media_type === 'audio') {
          var au = document.createElement('audio');
          au.controls = true; au.preload = 'metadata'; au.src = it._url;
          wrap.appendChild(au);
        } else if (it.media_type === 'video') {
          var vd = document.createElement('video');
          vd.controls = true; vd.preload = 'metadata'; vd.src = it._url;
          vd.setAttribute('playsinline', '');
          wrap.appendChild(vd);
        } else {
          var a = document.createElement('a');
          a.className = 'gb-media-chip'; a.href = it._url; a.target = '_blank'; a.rel = 'noopener';
          var ic = document.createElement('b');
          ic.textContent = '📎';
          var nm = document.createElement('span');
          nm.textContent = it.file_name || '附件';
          a.appendChild(ic); a.appendChild(nm);
          wrap.appendChild(a);
        }
      });
      host.appendChild(wrap);
    }
  }

  function actionsEl(msg, host) {
    var acts = document.createElement('div'); acts.className = 'gb-actions';
    var liked = !!likedSet[msg.id];
    var like = document.createElement('button');
    like.type = 'button'; like.className = 'gb-action-btn' + (liked ? ' liked' : '');
    like.textContent = '👍 ' + (msg.like_count || 0); like.title = '点赞';
    like.onclick = function () {
      if (busy || !connected) return; busy = true;
      sb.rpc('like_message', { p_message_id: msg.id, p_device_id: deviceId }).then(function (r) {
        if (r.error) throw r.error;
        var o = r.data; if (typeof o === 'string') { try { o = JSON.parse(o); } catch (e) {} }
        if (o) { msg.like_count = o.like_count; if (o.liked) likedSet[msg.id]=true; else delete likedSet[msg.id];
                 like.className = 'gb-action-btn' + (o.liked ? ' liked' : ''); like.textContent = '👍 ' + o.like_count; }
      }).catch(function (e) { status('点赞失败：' + ((e&&e.message)||e), 'err'); }).then(function(){ busy=false; });
    };
    var rep = document.createElement('button');
    rep.type = 'button'; rep.className = 'gb-action-btn';
    var n = (repliesByMsg[msg.id] || []).length;
    rep.textContent = '💬' + (n ? ' ' + n : ''); rep.title = '回复';
    rep.onclick = function () { openReply(msg, null, host); };
    var cp = document.createElement('button');
    cp.type = 'button'; cp.className = 'gb-action-btn'; cp.textContent = '📋'; cp.title = '复制内容';
    cp.onclick = function () { if (navigator.clipboard) navigator.clipboard.writeText(msg.content); else prompt('复制：', msg.content); };
    var pin = document.createElement('button');
    pin.type = 'button'; pin.className = 'gb-action-btn' + (msg.is_pinned ? ' pinned-on' : '');
    pin.textContent = '📌'; pin.title = msg.is_pinned ? '取消置顶' : '置顶';
    pin.onclick = function () { togglePin(msg); };
    var del = document.createElement('button');
    del.type = 'button'; del.className = 'gb-action-btn danger'; del.textContent = '🗑'; del.title = '删除';
    del.onclick = function () { deleteMessage(msg); };
    acts.appendChild(like); acts.appendChild(rep); acts.appendChild(cp); acts.appendChild(pin); acts.appendChild(del);
    return acts;
  }

  function renderReplies(host, msg) {
    var all = repliesByMsg[msg.id] || [];
    if (!all.length) return;

    /* 全部回复平铺显示（不再分层）。
       原来的嵌套结构在"回复的回复"很长的链上会把后面的内容吞掉，
       这里统一按时间平铺，用「回复 XX」标签表达对象关系。 */
    var limit = replyShown[msg.id] || REPLY_FOLD;
    var shown = all.slice(0, limit);

    var box = document.createElement('div');
    box.className = 'gb-replies';

    shown.forEach(function (r) {
      box.appendChild(replyEl(msg, r, host));
    });

    var bar = document.createElement('div');
    bar.className = 'gb-fold-bar';

    if (all.length > limit) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'gb-fold-btn';
      btn.textContent = '展开更多（还有 ' + (all.length - limit) + ' 条）▾';
      btn.onclick = function () {
        replyShown[msg.id] = limit + REPLY_STEP;
        render();
        var el = document.getElementById('p-' + msg.id);
        if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' });
      };
      bar.appendChild(btn);
    } else if (limit > REPLY_FOLD) {
      var btn2 = document.createElement('button');
      btn2.type = 'button';
      btn2.className = 'gb-fold-btn';
      btn2.textContent = '收起评论 ▴';
      btn2.onclick = function () {
        replyShown[msg.id] = REPLY_FOLD;
        render();
        var el2 = document.getElementById('p-' + msg.id);
        if (el2 && el2.scrollIntoView) el2.scrollIntoView({ block: 'start' });
      };
      bar.appendChild(btn2);
    }

    if (bar.childNodes.length) box.appendChild(bar);
    host.appendChild(box);
  }

  /* 单条回复（可带"回评折叠"：展开后才有子回复） */
  function replyEl(msg, r, host) {
    var el = document.createElement('div'); el.className = 'gb-reply';
    var ref = effective(r);
    el.appendChild(avatarNode(ref.color, ref.emoji, ref.path, 'small', ref.username || r.name));
    var b = document.createElement('div'); b.className = 'gb-reply-body';
    var h = document.createElement('div');
    var nWrap = document.createElement('span'); nWrap.className = 'gb-name-wrap';
    var n = document.createElement('span'); n.className = 'gb-reply-name'; n.textContent = ref.name;
    nWrap.appendChild(n);
    var runame = ref.username || r.author_username;
    if (runame) {
      var ru = document.createElement('span'); ru.className = 'gb-uid';
      ru.textContent = '@' + String(runame).replace(/^@+/, '');
      ru.setAttribute('data-profile', String(runame).replace(/^@+/, ''));
      ru.style.cursor = 'pointer';
      nWrap.appendChild(ru);
    }
    h.appendChild(nWrap);
    if (r.reply_to_name) { var to = document.createElement('span'); to.className = 'gb-reply-to'; to.textContent = '回复 ' + r.reply_to_name; h.appendChild(to); }
    var t = document.createElement('span'); t.className = 'gb-reply-time'; t.textContent = fmt(r.created_at); h.appendChild(t);
    var c = document.createElement('div'); c.className = 'gb-reply-content';
    renderContent(c, r.content);
    b.appendChild(h); b.appendChild(c);

    var ra = document.createElement('div'); ra.className = 'gb-reply-actions';
    var rb = document.createElement('button'); rb.type='button'; rb.className='gb-action-btn'; rb.textContent='↩'; rb.title='回复';
    rb.onclick = function () { openReply(msg, r, host); };
    var db = document.createElement('button'); db.type='button'; db.className='gb-action-btn'; db.textContent='🗑'; db.title='删除';
    db.onclick = function () { deleteReply(r); };
    ra.appendChild(rb); ra.appendChild(db); b.appendChild(ra);

    el.appendChild(b);
    return el;
  }

  /* ---------- 回复 ---------- */
  function openReply(msg, replyTo, host) {
    var old = host.querySelector('.gb-reply-form-inline');
    if (old) old.remove();
    var box = document.createElement('div'); box.className = 'reply-form gb-reply-form-inline';
    var inp = document.createElement('input'); inp.type='text'; inp.maxLength=300;
    inp.placeholder = replyTo ? ('回复 ' + replyTo.name + '……') : ('回复 ' + msg.name + '……');
    var send = document.createElement('button'); send.type='button'; send.className='btn-main'; send.textContent='发送';
    var cancel = document.createElement('button'); cancel.type='button'; cancel.className='btn-ghost'; cancel.textContent='取消';
    cancel.onclick = function () { box.remove(); };
    send.onclick = function () {
      var name = (localStorage.getItem('jiangwan_gb_name') || '').replace(/^\s+|\s+$/g, '');
      if (!isLoggedIn()) {
        alert('登录后才能回复。');
        location.href = './auth.html?next=' + encodeURIComponent(location.pathname.split('/').pop() + location.search);
        return;
      }
      if (!name) { alert('还没设名字，先去「用户中心」设一下。'); return; }
      var text = inp.value.trim();
      if (!text) { alert('回复不能为空'); return; }
      if (busy || !connected) { status('还没连上服务器，暂时发不了。', 'err'); return; }
      busy = true; send.disabled = true; send.textContent = '…';
      var av = avatarPayload();
      sb.from('replies').insert({
        message_id: msg.id, device_id: deviceId, name: name.slice(0,20), content: text.slice(0,300),
        reply_to_id: replyTo ? replyTo.id : null, reply_to_name: replyTo ? replyTo.name : null,
        author_username: currentUsername() || null,
        avatar_mode: av.avatar_mode, avatar_path: av.avatar_path, avatar_color: av.avatar_color, avatar_emoji: av.avatar_emoji
      }).then(function (r) { if (r.error) throw r.error; box.remove(); return loadAll().then(render); })
        .catch(function (e) { status('回复失败：' + ((e&&e.message)||e), 'err'); })
        .then(function () { busy = false; send.disabled = false; send.textContent = '发送'; });
    };
    box.appendChild(inp); box.appendChild(send); box.appendChild(cancel);
    host.appendChild(box); inp.focus();
  }

  /* ---------- 置顶 / 删除 ---------- */
  function togglePin(msg) {
    var pw = prompt((msg.is_pinned ? '取消置顶' : '置顶这条帖子') + '\n请输入管理密码：');
    if (pw === null || !pw.trim()) return;
    status('正在校验密码……');
    sha(PW_SALT + '|' + pw.trim()).then(function (h) {
      return sb.rpc('set_message_pinned', { p_message_id: msg.id, p_pinned: !msg.is_pinned, p_pw_hash: h });
    }).then(function (r) {
      if (r.error) throw r.error;
      var o = r.data; if (typeof o === 'string') { try { o = JSON.parse(o); } catch (e) {} }
      status(o && o.is_pinned ? '已置顶 📌' : '已取消置顶', 'ok');
      return loadAll().then(render);
    }).catch(function (e) { status(badPw(e) ? '密码不对。' : ('置顶失败：' + ((e&&e.message)||e)), 'err'); });
  }
  function deleteMessage(msg) {
    var mine = isMine(msg);
    var tip = mine
      ? '删除自己发布的这条帖子？\n回复和配图会一起删掉，不可恢复。'
      : '删除别人发布的这条帖子？\n需要管理密码，回复和配图会一起删掉。';
    if (!confirm(tip)) return;

    if (mine) {
      var pw = accountPw();
      if (!pw) { status('本机没有登录密码记录，请重新登录后再删。', 'err'); return; }
      status('正在删除……');
      sha(PW_SALT + '|' + pw).then(function (h) {
        return sb.rpc('delete_own_message', {
          p_message_id: msg.id, p_username: currentUsername(), p_pw_hash: h
        });
      }).then(function (r) {
        if (r.error) throw r.error;
        var o = r.data; if (typeof o === 'string') { try { o = JSON.parse(o); } catch (e) {} }
        if (!o || o.deleted !== true) throw new Error('failed');
        status('已删除 ✅', 'ok');
        return loadAll().then(render);
      }).catch(function (e) {
        var m = (e && e.message) || String(e);
        status(/bad password/i.test(m) ? '登录状态已失效，请重新登录。'
          : (/not yours/i.test(m) ? '这条不是你发的，删除需要管理密码。' : ('删除失败：' + m)), 'err');
      });
      return;
    }

    var pw2 = prompt('这是别人的帖子，删除需要管理密码：');
    if (pw2 === null || !pw2.trim()) return;
    sha(PW_SALT + '|' + pw2.trim()).then(function (h) {
      return sb.rpc('delete_message', { p_message_id: msg.id, p_pw_hash: h });
    }).then(function (r) {
      if (r.error) throw r.error;
      var o = r.data; if (typeof o === 'string') { try { o = JSON.parse(o); } catch (e) {} }
      if (!o || o.deleted !== true) throw new Error('bad password');
      status('已删除 ✅', 'ok'); return loadAll().then(render);
    }).catch(function (e) { status(badPw(e) ? '密码不对，没有删除。' : ('删除失败：' + ((e && e.message) || e)), 'err'); });
  }

  function deleteReply(r) {
    var mine = isMine(r);
    if (!confirm(mine ? '删除自己的这条回复？' : '删除别人的回复？需要管理密码。')) return;

    if (mine) {
      var pw = accountPw();
      if (!pw) { status('本机没有登录密码记录，请重新登录后再删。', 'err'); return; }
      sha(PW_SALT + '|' + pw).then(function (h) {
        return sb.rpc('delete_own_reply', {
          p_reply_id: r.id, p_username: currentUsername(), p_pw_hash: h
        });
      }).then(function (res) {
        if (res.error) throw res.error;
        var o = res.data; if (typeof o === 'string') { try { o = JSON.parse(o); } catch (e) {} }
        if (!o || o.deleted !== true) throw new Error('failed');
        status('已删除 ✅', 'ok');
        return loadAll().then(render);
      }).catch(function (e) {
        var m = (e && e.message) || String(e);
        status(/bad password/i.test(m) ? '登录状态已失效，请重新登录。'
          : (/not yours/i.test(m) ? '这条不是你发的，删除需要管理密码。' : ('删除失败：' + m)), 'err');
      });
      return;
    }

    var pw2 = prompt('这是别人的回复，删除需要管理密码：');
    if (pw2 === null || !pw2.trim()) return;
    sha(PW_SALT + '|' + pw2.trim()).then(function (h) {
      return sb.rpc('delete_reply', { p_reply_id: r.id, p_pw_hash: h });
    }).then(function (res) {
      if (res.error) throw res.error;
      var o = res.data; if (typeof o === 'string') { try { o = JSON.parse(o); } catch (e) {} }
      if (!o || o.deleted !== true) throw new Error('bad password');
      status('已删除 ✅', 'ok'); return loadAll().then(render);
    }).catch(function (e) { status(badPw(e) ? '密码不对。' : ('删除失败：' + ((e && e.message) || e)), 'err'); });
  }

  /* ---------- 小分区增删 ---------- */
  function newSub() {
    if (!curMain) { status('请先从左侧进入某个大分区。', 'err'); return; }
    var name = prompt('在「' + curMain + '」下面新建小分区\n名称不超过 5 个汉字或 10 个字母：');
    if (name === null || !name.trim()) return;
    var v = name.trim();
    var cjk = (v.match(/[\u4e00-\u9fff]/g) || []).length;
    var lat = v.replace(/[\u4e00-\u9fff]/g, '').length;
    if (cjk > 5 || lat > 10) { alert('名称太长：最多 5 个汉字或 10 个字母'); return; }
    status('正在新建小分区……');
    sb.rpc('create_gb_subsection', { p_main: curMain, p_name: v, p_device: deviceId }).then(function (r) {
      if (r.error) throw r.error;
      var o = r.data; if (typeof o === 'string') { try { o = JSON.parse(o); } catch (e) {} }
      status('小分区已新建 ✅', 'ok');
      return loadSections().then(function () { if (o && o.id) curSub = o.id; renderSubBar(); render(); });
    }).catch(function (e) {
      var m = (e && e.message) || String(e);
      status(/duplicate/i.test(m) ? '这个分区里已经有同名小分区了。' : (/too long/i.test(m) ? '名称太长：最多 5 个汉字或 10 个字母' : ('新建失败：' + m)), 'err');
    });
  }
  function deleteSub(id) {
    if (/(未分组|未分类|未归类|默认)$/.test(btrimName(secName(id)))) { alert('这是默认小分区，不能删除。'); return; }
    if (!confirm('删除小分区「' + secName(id) + '」？\n里面的帖子会回到大分区，不会被删。')) return;
    var pw = prompt('删除小分区需要管理密码：');
    if (pw === null || !pw.trim()) return;
    sha(PW_SALT + '|' + pw.trim()).then(function (h) {
      return sb.rpc('delete_gb_subsection', { p_id: id, p_pw_hash: h });
    }).then(function (r) {
      if (r.error) throw r.error;
      var o = r.data; if (typeof o === 'string') { try { o = JSON.parse(o); } catch (e) {} }
      if (!o || o.deleted !== true) throw new Error('bad password');
      status('小分区已删除，帖子已回到「' + curMain + '」✅', 'ok');
      curSub = '';
      return loadAll().then(function () { renderSubBar(); render(); });
    }).catch(function (e) { status(badPw(e) ? '密码不对。' : ('删除失败：' + ((e&&e.message)||e)), 'err'); });
  }

  /* ---------- 头像/配图 ---------- */
  function avatarPayload() {
    if (avatarMode === 'image' && selImagePath) return { avatar_mode:'image', avatar_path: selImagePath, avatar_color: selColor, avatar_emoji: selEmoji };
    return { avatar_mode:'emoji', avatar_path: null, avatar_color: selColor, avatar_emoji: selEmoji };
  }

  /* ---------- 数据 ---------- */
  function loadSections() {
    return sb.from('gb_sections').select('id,name,main_section,sort_order,is_default').order('sort_order')
      .then(function (r) {
        if (r.error) throw r.error;
        sections = r.data || [];
        subs = sections.filter(function (x) { return !x.is_default; });
        // 当前选中的小分区若不属于这个大分区，清掉
        if (curSub) {
          var ok = subs.some(function (x) { return x.id === curSub && x.main_section === curMain; });
          if (!ok) curSub = '';
        }
        // 默认选中的小分区：按后缀识别用户自己的命名
        // （各分区不同：学习未分组 / 2次元未分组 / 招领未分组 / 吐槽未分组 / 建议未分组）
        if (curSub) {
          var mine2 = subs.filter(function (x) { return x.main_section === curMain; });
          var stillOk = mine2.some(function (x) { return x.id === curSub; });
          if (!stillOk) curSub = '';
        }
        if (!curSub) {
          var mine = subs.filter(function (x) { return x.main_section === curMain; });
          var target = null;
          for (var mi = 0; mi < mine.length; mi++) {
            if (/(未分组|未分类|未归类|默认)$/.test(btrimName(mine[mi].name))) { target = mine[mi]; break; }
          }
          if (!target && mine.length) target = mine[0];
          if (target) curSub = target.id;
        }
      });
  }

  /* 把横滑条里点中的按钮滚到可见位置 */
  function scrollChipIntoView(btn) {
    try {
      var row = btn.closest ? btn.closest('.gb-scroll') : null;
      if (!row) return;
      var r = btn.getBoundingClientRect(), rr = row.getBoundingClientRect();
      if (r.left < rr.left + 16) row.scrollLeft -= (rr.left + 16 - r.left);
      else if (r.right > rr.right - 16) row.scrollLeft += (r.right - rr.right + 16);
    } catch (e) {}
  }

  /* 是否已登录 */
  function isLoggedIn() {
    try {
      var a = JSON.parse(localStorage.getItem('jw_account') || 'null');
      return !!(a && a.username);
    } catch (e) { return false; }
  }

  /* 当前登录账户的用户名（不带 @），没登录返回空 */
  function currentUsername() {
    try {
      var a = JSON.parse(localStorage.getItem('jw_account') || 'null');
      if (a && a.username) return String(a.username).replace(/^@+/, '');
    } catch (e) {}
    return '';
  }

  /* 这条内容是不是当前登录账户发的 */
  function isMine(item) {
    var me = currentUsername();
    var owner = item && item.author_username;
    if (!me || !owner) return false;
    return String(owner).replace(/^@+/, '').toLowerCase() === String(me).toLowerCase();
  }

  /* 当前账户的密码（登录时存在本地） */
  function accountPw() {
    try { return localStorage.getItem('jw_account_pw') || ''; } catch (e) { return ''; }
  }

  function btrimName(x) { return String(x == null ? '' : x).replace(/^\s+|\s+$/g, ''); }

  /* 拉取这批帖子的账户资料，用于覆盖显示（头像/昵称跟账户保持一致） */
  function loadProfiles(list) {
    var keys = [];
    list.forEach(function (m) {
      var u = m && m.author_username;
      if (!u) return;
      var k = String(u).replace(/^@+/, '').toLowerCase();
      if (k && keys.indexOf(k) < 0) keys.push(k);
    });
    // 名字列表（用于查不到用户名时兜底）
    var names = [];
    list.forEach(function (m) {
      var n = m && m.name ? btrimName(m.name) : '';
      if (n && names.indexOf(n.toLowerCase()) < 0) names.push(n);
    });

    var jobs = [];
    if (keys.length) {
      jobs.push(sb.rpc('get_profiles', { p_usernames: keys }).then(function (r) {
        if (r.error) return;
        var arr = r.data;
        if (typeof arr === 'string') { try { arr = JSON.parse(arr); } catch (e) { arr = []; } }
        (arr || []).forEach(function (p) {
          var k = String(p.username).replace(/^@+/, '').toLowerCase();
          if (k) profileMap[k] = p;
        });
      }).catch(function () {}));
    }
    // 按显示名逐个查（昵称兜底），最多查 20 个避免请求过多
    names.slice(0, 20).forEach(function (n) {
      jobs.push(sb.rpc('get_profile', { p_username: n }).then(function (r) {
        if (r.error || !r.data) return;
        var p = r.data;
        if (typeof p === 'string') { try { p = JSON.parse(p); } catch (e) { return; } }
        if (!p) return;
        profileMap['#name:' + n.toLowerCase()] = p;
      }).catch(function () {}));
    });
    return Promise.all(jobs);
  }

  /* 取一条内容最终该显示的头像和名字 */
  function effective(m) {
    var u = m && m.author_username;
    var p = u ? profileMap[String(u).replace(/^@+/, '').toLowerCase()] : null;
    // 账户里没有这个用户名（比如改名后旧数据没同步）→ 用显示名再试一次
    if (!p && m && m.name) {
      p = profileMap['#name:' + btrimName(m.name).toLowerCase()] || null;
    }
    if (!p) {
      return {
        color: m.avatar_color, emoji: m.avatar_emoji,
        path: (m.avatar_mode === 'image' ? m.avatar_path : null),
        name: m.name, username: u || null
      };
    }
    return {
      color: p.avatar_color, emoji: p.avatar_emoji,
      path: (p.avatar_mode === 'image' ? p.avatar_path : null),
      name: p.nickname || m.name,
      username: p.username || u
    };
  }

  function loadAll() {
    return sb.from('messages')
      .select('id,created_at,name,content,avatar_color,avatar_emoji,avatar_path,avatar_mode,like_count,reply_count,is_pinned,pinned_at,main_section,sub_section_id,tags,author_username')
      .eq('hidden', false)
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE)
      .then(function (r) {
        if (r.error) throw r.error;
        messages = r.data || [];
        var ids = messages.map(function (m) { return m.id; });
        if (!ids.length) { repliesByMsg = {}; msgImages = {}; return null; }
        return sb.from('message_images').select('id,message_id,image_path,sort_order,media_type,mime,file_name').in('message_id', ids).eq('hidden', false).limit(400)
          .then(function (r2) {
            msgImages = {};
            if (!r2.error) (r2.data || []).forEach(function (x) { (msgImages[x.message_id] = msgImages[x.message_id] || []).push(x); });
            return sb.from('replies').select('id,message_id,created_at,name,content,avatar_color,avatar_emoji,avatar_path,avatar_mode,reply_to_id,reply_to_name,author_username')
              .in('message_id', ids).order('created_at', { ascending: true }).limit(600);
          }).then(function (r3) {
            repliesByMsg = {};
            var allReplies = [];
            if (r3 && !r3.error) (r3.data || []).forEach(function (x) { (repliesByMsg[x.message_id] = repliesByMsg[x.message_id] || []).push(x); allReplies.push(x); });
            // 帖子和回复的账户资料一起拉
            return loadProfiles(messages.concat(allReplies));
          });
      });
  }

  /* ---------- 发帖 ---------- */
  function submit() {
    var ctEl = $('gb-content');
    var name = (localStorage.getItem('jiangwan_gb_name') || '').replace(/^\s+|\s+$/g, '');
    var content = ctEl ? ctEl.value.trim() : '';
    if (!isLoggedIn()) {
      alert('登录后才能发帖。');
      location.href = './auth.html?next=' + encodeURIComponent(location.pathname.split('/').pop() + location.search);
      return;
    }
    if (!name) { alert('还没设名字。点页面上方「去设置」，或进「用户中心」设好再发。'); return; }
    if (!content) { alert('请写点内容'); ctEl && ctEl.focus(); return; }
    if (!curSub) {
      alert('请先选一个小分区再发帖。\n\n如果这个分区里还没有小分区，点「＋ 新建小分区」建一个（不用密码），建好后会自动选中。');
      var bar = $('gb-subs');
      if (bar && typeof bar.scrollIntoView === 'function') {
        try { bar.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {}
      }
      return;
    }
    if (avatarMode === 'image' && !selImagePath) { alert('头像还没上传成功'); return; }
    if (!connected) { status('还没连上云端，暂时发不了。', 'err'); return; }
    if (busy) return;
    busy = true;
    var btn = $('gb-submit'); if (btn) { btn.disabled = true; btn.textContent = '发送中…'; }
    var tags = parseTags(content);
    var av = avatarPayload();
    sb.from('messages').insert({
      device_id: deviceId, name: name.slice(0,20), content: content.slice(0,500),
      main_section: curMain || '未分区',
      sub_section_id: curSub || null,
      tags: tags,
      author_username: currentUsername() || null,
      avatar_mode: av.avatar_mode, avatar_path: av.avatar_path,
      avatar_color: av.avatar_color, avatar_emoji: av.avatar_emoji
    }).select('id').then(function (r) {
      if (r.error) throw r.error;
      if (ctEl) ctEl.value = '';
      try { localStorage.setItem('jiangwan_gb_name', name); } catch (e) {}
      var nid = (r.data && r.data[0] && r.data[0].id) || '';
      return uploadImgs(nid);
    }).then(function () {
      var comp = $('gb-composer');
      if (comp) comp.hidden = true;
      document.body.style.overflow = '';
      status('已发布 ✅' + (parseTags(content).length ? '（识别到标签：' + parseTags(content).map(function(t){return '#'+t;}).join(' ') + '）' : ''), 'ok');
      setTimeout(function () { status(''); }, 3000);
      return loadAll().then(render);
    }).catch(function (e) {
      status('发布失败：' + ((e&&e.message)||e), 'err');
    }).then(function () { busy = false; if (btn) { btn.disabled = false; btn.textContent = '发布'; } });
  }

  function uploadImgs(mid) {
    if (!pendingFiles.length || !uid || !mid) return Promise.resolve();
    var total = pendingFiles.length;
    return pendingFiles.reduce(function (chain, item, i) {
      return chain.then(function () {
        status('上传 ' + (i + 1) + '/' + total + '……');
        return prepareBlob(item).then(function (blob) {
          var ext = item.kind === 'image' ? 'jpg'
                  : (item.kind === 'audio' ? (item.file.name.split('.').pop() || 'mp3').toLowerCase().slice(0, 5)
                  : (item.file.name.split('.').pop() || 'mp4').toLowerCase().slice(0, 5));
          var path = uid + '/msg-' + Date.now().toString(36) + '-' +
                     Math.random().toString(36).slice(2, 8) + '.' + ext;
          var mime = item.kind === 'image' ? 'image/jpeg' : (item.file.type || 'application/octet-stream');
          return sb.storage.from('avatars')
            .upload(path, blob, { contentType: mime, upsert: false })
            .then(function (r) {
              if (r.error) throw r.error;
              return sb.from('message_images').insert({
                message_id: mid, device_id: deviceId, image_path: path, sort_order: i,
                media_type: item.kind, mime: mime,
                file_name: (item.file.name || '').slice(0, 80),
                size_bytes: blob.size || 0
              });
            })
            .then(function (r) { if (r && r.error) throw r.error; return null; });
        });
      });
    }, Promise.resolve()).then(function () {
      pendingFiles.forEach(function (x) { try { if (x.url) URL.revokeObjectURL(x.url); } catch (e) {} });
      pendingFiles = [];
      renderImgPick();
    });
  }

  /* 图片压缩；音视频原样上传 */
  function prepareBlob(item) {
    if (item.kind !== 'image') return Promise.resolve(item.file);
    return new Promise(function (res, rej) {
      var im = new Image();
      im.onload = function () {
        var cv = document.createElement('canvas');
        var sc = Math.min(1, 1600 / Math.max(im.width, im.height));
        cv.width = Math.max(1, Math.round(im.width * sc));
        cv.height = Math.max(1, Math.round(im.height * sc));
        var cx = cv.getContext('2d');
        cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height);
        cx.drawImage(im, 0, 0, cv.width, cv.height);
        cv.toBlob(function (b) { b ? res(b) : rej(new Error('图片编码失败')); }, 'image/jpeg', 0.86);
      };
      im.onerror = function () { rej(new Error('图片打不开（HEIC 请先转 JPG）')); };
      var fr = new FileReader();
      fr.onload = function () { im.src = fr.result; };
      fr.onerror = function () { rej(new Error('读取文件失败')); };
      fr.readAsDataURL(item.file);
    });
  }

  function renderImgPick() {
    var box = $('gb-img-preview'), cnt = $('gb-file-count');
    if (!box) return;
    box.textContent = '';
    pendingFiles.forEach(function (it, i) {
      var w = document.createElement('div');
      w.className = 'gb-attach';
      if (it.kind === 'image' && it.url) {
        var im = document.createElement('img');
        im.src = it.url; im.alt = '';
        w.appendChild(im);
      } else {
        var ic = document.createElement('div');
        ic.className = 'gb-attach-icon';
        ic.textContent = iconOf(it.kind);
        w.appendChild(ic);
        var ext = document.createElement('div');
        ext.className = 'gb-attach-ext';
        ext.textContent = (it.file.name || '').split('.').pop().slice(0, 6).toUpperCase();
        w.appendChild(ext);
      }
      var del = document.createElement('button');
      del.type = 'button'; del.textContent = '×'; del.title = '移除';
      del.onclick = function () {
        try { if (it.url) URL.revokeObjectURL(it.url); } catch (e) {}
        pendingFiles.splice(i, 1);
        renderImgPick();
      };
      w.appendChild(del);
      box.appendChild(w);
    });
    if (cnt) {
      if (!pendingFiles.length) cnt.textContent = '还没选文件';
      else {
        var c = { image: 0, audio: 0, video: 0 };
        pendingFiles.forEach(function (x) { c[x.kind]++; });
        var parts = [];
        if (c.image) parts.push('图片 ' + c.image);
        if (c.audio) parts.push('音频 ' + c.audio);
        if (c.video) parts.push('视频 ' + c.video);
        cnt.textContent = parts.join(' · ') + '（共 ' + pendingFiles.length + '/' + MAX_FILES + '）';
      }
    }
  }

  /* ---------- 启动 ---------- */
  function boot(opts) {
    curMain = (opts && opts.main) || '';
    sb = JW.sb; uid = JW.uid || ''; deviceId = JW.deviceId;
    // 头像偏好
    try {
      var look = JSON.parse(localStorage.getItem('jiangwan_gb_look') || 'null');
      if (look) {
        if (look.emoji) selEmoji = look.emoji;
        if (look.color) selColor = look.color;
        if (look.mode) avatarMode = look.mode;
        if (look.image) selImage = look.image;
        if (look.imagePath) selImagePath = look.imagePath;
      }
    } catch (e) {}
    

    // 显示当前身份（在用户中心设置）
    renderWho();
    renderImgPick();
    gatePosting();
    if (window.PROFILE && $('gb-list')) PROFILE.bind($('gb-list'));

    // 附件选择（图片/音频/视频）
    var fi = $('gb-files');
    if (fi) fi.onchange = function (e) {
      var files = Array.prototype.slice.call(e.target.files || []);
      var rejected = [];
      files.forEach(function (f) {
        if (pendingFiles.length >= MAX_FILES) { rejected.push(f.name + '（最多 ' + MAX_FILES + ' 个）'); return; }
        var kind = kindOf(f);
        if (!kind) { rejected.push(f.name + '（不支持的类型）'); return; }
        var mb = f.size / 1024 / 1024;
        if (mb > limitOf(kind)) { rejected.push(f.name + '（超过 ' + limitOf(kind) + 'MB）'); return; }
        pendingFiles.push({
          file: f, kind: kind,
          url: (kind === 'image' && window.URL && URL.createObjectURL) ? URL.createObjectURL(f) : ''
        });
      });
      if (rejected.length) alert('这些没加上：\n' + rejected.join('\n'));
      renderImgPick();
      e.target.value = '';
    };

    var sub = $('gb-submit');
    if (sub) sub.onclick = submit;

    // ---- 底部发帖条交互 ----
    var composer = $('gb-composer');
    var trigger = $('gb-composer-trigger');
    var mask = $('gb-composer-mask');
    var closeBtn = $('gb-composer-close');
    var fakeBtn = $('gb-trigger-fake');
    var contentEl = $('gb-content');

    function openComposer() {
      if (!isLoggedIn()) {
        alert('登录后才能发帖。');
        location.href = './auth.html?next=' + encodeURIComponent(location.pathname.split('/').pop() + location.search);
        return;
      }
      if (!curSub) {
        alert('请先选一个小分区再发帖。');
        renderSubBar();
        return;
      }
      if (!composer) return;
      composer.hidden = false;
      document.body.style.overflow = 'hidden';
      var sec = $('gb-composer-sec');
      if (sec) sec.textContent = curMain + (secName(curSub) ? ' · ' + secName(curSub) : '');
      setTimeout(function () { if (contentEl) contentEl.focus(); }, 80);
    }
    function closeComposer() {
      if (!composer) return;
      composer.hidden = true;
      document.body.style.overflow = '';
    }
    if (fakeBtn) fakeBtn.onclick = openComposer;
    if (closeBtn) closeBtn.onclick = closeComposer;
    if (mask) mask.onclick = closeComposer;
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && composer && !composer.hidden) closeComposer();
    });

    // 输入框自适应高度
    if (contentEl) contentEl.addEventListener('input', function () {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, Math.round(window.innerHeight * 0.4)) + 'px';
    });

    showLoading('加载中，请耐心等待…');
    loadSections().then(loadAll).then(function () {
      connected = true;
      renderSortBar(); renderSubBar(); render();
      status('');
      // 旧的 ?post=<id> 链接：自动转到帖子详情页
      var pid = new URLSearchParams(location.search).get('post');
      if (pid) {
        location.replace('./post.html?id=' + encodeURIComponent(pid));
      }
    }).catch(function (e) {
      status('加载失败：' + ((e && e.message) || e), 'err');
      var listEl = $('gb-list');
      if (listEl) {
        listEl.textContent = '';
        var box = document.createElement('div');
        box.className = 'empty';
        box.textContent = '加载失败，请检查网络后刷新页面。';
        listEl.appendChild(box);
      }
    });
  }

  /* ---------- 头像：emoji 或 上传图片 ---------- */
  function setMode(mode) {
    avatarMode = (mode === 'image') ? 'image' : 'emoji';
    var pe = $('panel-emoji'), pi = $('panel-image');
    if (pe) pe.hidden = avatarMode !== 'emoji';
    if (pi) pi.hidden = avatarMode !== 'image';
    var be = $('mode-emoji'), bi = $('mode-image');
    if (be) be.className = 'gb-sec-chip' + (avatarMode === 'emoji' ? ' on' : '');
    if (bi) bi.className = 'gb-sec-chip' + (avatarMode === 'image' ? ' on' : '');
    var clr = $('btn-avatar-clear');
    if (clr) clr.hidden = !(avatarMode === 'image' && selImage);
    saveLook();
  }

  function uploadAvatar(file) {
    return new Promise(function (res, rej) {
      var im = new Image();
      im.onload = function () {
        var cv = document.createElement('canvas');
        cv.width = 256; cv.height = 256;
        var cx = cv.getContext('2d');
        cx.fillStyle = '#fff'; cx.fillRect(0, 0, 256, 256);
        var side = Math.min(im.width, im.height);
        cx.drawImage(im, (im.width - side) / 2, (im.height - side) / 2, side, side, 0, 0, 256, 256);
        cv.toBlob(function (b) {
          if (!b) return rej(new Error('图片编码失败'));
          var path = uid + '/avatar-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8) + '.jpg';
          sb.storage.from('avatars').upload(path, b, { contentType: 'image/jpeg', upsert: false })
            .then(function (r) { if (r.error) throw r.error; res(path); })
            .catch(rej);
        }, 'image/jpeg', 0.85);
      };
      im.onerror = function () { rej(new Error('图片打不开（HEIC 请先转 JPG）')); };
      var fr = new FileReader();
      fr.onload = function () { im.src = fr.result; };
      fr.onerror = function () { rej(new Error('读取文件失败')); };
      fr.readAsDataURL(file);
    });
  }

  function statusEl() { return $('gb-status'); }

  /* 未登录：把发帖区收起来，换成登录按钮 */
  function gatePosting() {
    var box = $('gb-login-gate');
    var trig = $('gb-composer-trigger');
    var comp = $('gb-composer');
    var logged = isLoggedIn();

    if (box) box.hidden = logged;
    if (trig) trig.hidden = !logged;
    if (comp && !logged) comp.hidden = true;

    if (!logged) {
      var sub = $('gb-login-gate-sub');
      if (sub) sub.textContent = '登录后才能在这个分区发帖。';
      var btn = $('gb-login-gate-btn');
      if (btn) btn.href = './auth.html?next=' + encodeURIComponent(location.pathname.split('/').pop() + location.search);
    }
  }

  /* 显示当前身份（来自用户中心的设置） */
  function renderWho() {
    var box = $('gb-who-avatar'), nm = $('gb-who-name');
    if (box) {
      box.textContent = '';
      var el = avatarNode(selColor, selEmoji, (avatarMode === 'image' ? selImagePath : ''), 'small');
      el.style.width = '40px'; el.style.height = '40px'; el.style.fontSize = '1.2rem';
      box.appendChild(el);
    }
    if (nm) {
      var n = localStorage.getItem('jiangwan_gb_name') || '';
      nm.textContent = n || '还没设名字（点「去设置」）';
      nm.style.color = n ? '' : 'var(--accent)';
    }
  }

  function saveLook() {
    try { localStorage.setItem('jiangwan_gb_look', JSON.stringify({ mode:avatarMode, emoji:selEmoji, color:selColor, image:selImage, imagePath:selImagePath })); } catch (e) {}
    var pv = $('avatar-preview');
    if (pv) { pv.textContent=''; pv.appendChild(avatarNode(selColor, selEmoji, selImagePath, 'big')); }
  }


  return { boot: boot, parseTags: parseTags, MAINS: MAINS };
})();
