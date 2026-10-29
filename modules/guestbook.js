/* ========== 留言板：云端持久化 + 回复评论 + 置顶 ========== */
(function () {
  var PW_SALT = 'jw-salt-2026';        // 只用来算哈希，密码明文不在代码里
  var NAME_KEY   = 'jiangwan_gb_name';
  var LOOK_KEY   = 'jiangwan_gb_look';
  var DEVICE_KEY = 'jiangwan_gb_device';
  var LIKED_KEY  = 'jiangwan_gb_liked';
  var PAGE_SIZE  = 80;
  var AVATAR_BUCKET = 'avatars';
  var EMOJIS = ['🙂','🐹','🐰','🦊','🐼','🐨','🐯','🦁','🐸','🐧','🐳','🦄','🌻','🌙','⚡','🍀'];
  var COLORS = ['#c0392b','#e67e22','#d4a017','#27ae60','#16a085','#2980b9','#8e44ad','#d95f8f','#5d6d7e','#2c3e50'];

  var $ = function (id) { return document.getElementById(id); };
  var statusEl = $('gb-status'), listEl = $('gb-list');
  var nameInput = $('gb-name'), contentInput = $('gb-content');
  var previewEl = $('avatar-preview'), emojiRow = $('emoji-row'), colorRow = $('color-row');
  var submitBtn = $('gb-submit');
  var modeBtnEmoji = $('mode-emoji'), modeBtnImage = $('mode-image');
  var panelEmoji = $('panel-emoji'), panelImage = $('panel-image');
  var avatarFile = $('gb-avatar-file'), avatarClearBtn = $('btn-avatar-clear');

  var selectedEmoji = '🙂', selectedColor = COLORS[0];
  var avatarMode = 'emoji', selectedImage = '', selectedImagePath = '';
  var currentUserId = '', deviceId = '';
  var sb = null, messages = [], repliesByMsg = {}, likedSet = {};
  var connected = false, busy = false, retryTimer = null;
  var pendingImgs = [];            // 待发送的配图 [{file, url}]
  var MAX_IMGS = 4;
  var msgImages = {};              // message_id -> [图片行]

  /* ---------------- 本机身份与偏好 ---------------- */
  var savedLook = null;
  try { savedLook = JSON.parse(localStorage.getItem(LOOK_KEY) || 'null'); } catch (e) { savedLook = null; }
  if (savedLook && typeof savedLook === 'object') {
    if (EMOJIS.indexOf(savedLook.emoji) >= 0) selectedEmoji = savedLook.emoji;
    if (COLORS.indexOf(savedLook.color) >= 0) selectedColor = savedLook.color;
    if (savedLook.mode === 'image' || savedLook.mode === 'emoji') avatarMode = savedLook.mode;
    if (typeof savedLook.image === 'string' && /^https:\/\//.test(savedLook.image)) selectedImage = savedLook.image;
    if (typeof savedLook.imagePath === 'string' && /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(savedLook.imagePath)) selectedImagePath = savedLook.imagePath;
  } else {
    selectedEmoji = EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
    selectedColor = COLORS[Math.floor(Math.random() * COLORS.length)];
  }
  if (avatarMode === 'image' && !selectedImage) avatarMode = 'emoji';
  nameInput.value = localStorage.getItem(NAME_KEY) || '';

  function saveLook() {
    try {
      localStorage.setItem(LOOK_KEY, JSON.stringify({
        mode: avatarMode, emoji: selectedEmoji, color: selectedColor,
        image: selectedImage, imagePath: selectedImagePath
      }));
    } catch (e) {}
  }

  function avatarUrl(path) {
    var base = (window.JW && JW.storagePublic) || '';
    if (!base) return '';
    if (typeof path !== 'string' || !/^[A-Za-z0-9-]{1,64}\/[A-Za-z0-9._-]{1,80}$/.test(path)) return '';
    return base + path;
  }

  /* ---------------- 小工具 ---------------- */
  function fmt(ts) {
    var d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    var p = function (n) { return n < 10 ? '0' + n : '' + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function status(text, kind) {
    if (!statusEl) return;
    if (!text) { statusEl.hidden = true; statusEl.textContent = ''; return; }
    statusEl.hidden = false;
    statusEl.className = 'gb-status' + (kind ? ' ' + kind : '');
    statusEl.textContent = text;
  }
  function withTimeout(p, ms, what) {
    if (window.JW && JW.withTimeout) return JW.withTimeout(p, ms, what);
    return p;
  }
  function sha256Hex(text) {
    if (window.crypto && window.crypto.subtle && window.TextEncoder) {
      return window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (buf) {
        return Array.prototype.map.call(new Uint8Array(buf), function (b) {
          return ('0' + b.toString(16)).slice(-2);
        }).join('');
      });
    }
    return Promise.reject(new Error('这个浏览器不支持加密接口，请换 Chrome 或系统浏览器'));
  }
  function isBadPw(e) {
    var m = (e && e.message) ? e.message : String(e || '');
    return /bad password/i.test(m);
  }
  function friendlyError(err, doingWhat) {
    if (!err) return '操作失败，请稍后再试';
    var m = err.message || String(err);
    if (/bad password/i.test(m)) return '密码不对。';
    if (/message not found/i.test(m)) return '这条留言可能已被删除。';
    if (err.code === '42501' || /row-level security/i.test(m)) {
      return doingWhat === '点赞' ? '点赞失败了，刷新页面后再试。'
        : '发得太快了：同一台设备 1 分钟最多发 3 条留言 / 6 条回复，歇一会儿再发～';
    }
    if (/Failed to fetch|NetworkError|Load failed|timeout|超时|Connection reset|ETIMEDOUT/i.test(m)) {
      return '连不上服务器（网络问题），稍等会自动重试，也可以下拉刷新。';
    }
    return (doingWhat || '操作') + '失败：' + m;
  }
  function copyText(text, tip) {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(
        function () { alert('已复制到剪贴板。\n' + tip); },
        function () { prompt('自动复制失败，请长按全选手动复制：', text); }
      );
    } else {
      prompt('请长按全选手动复制下面的内容：', text);
    }
  }

  /* ---------------- 头像 ---------------- */
  function avatarNode(color, emoji, path, size) {
    var el = document.createElement('div');
    el.className = 'avatar-circle ' + (size === 'small' ? 'small' : 'big');
    var url = avatarUrl(path);
    if (url) {
      var img = document.createElement('img');
      img.src = url; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
      img.onerror = function () {
        el.textContent = emoji || '🙂';
        el.style.background = /^#[0-9a-fA-F]{6}$/.test(color || '') ? color : COLORS[0];
      };
      el.style.background = '#f0f0f0';
      el.appendChild(img);
    } else {
      el.style.background = /^#[0-9a-fA-F]{6}$/.test(color || '') ? color : COLORS[0];
      el.textContent = emoji || '🙂';
    }
    return el;
  }
  function avatarPayload() {
    if (avatarMode === 'image' && selectedImagePath) {
      return { avatar_mode: 'image', avatar_path: selectedImagePath, avatar_color: selectedColor, avatar_emoji: selectedEmoji };
    }
    return { avatar_mode: 'emoji', avatar_path: null, avatar_color: selectedColor, avatar_emoji: selectedEmoji };
  }
  function refreshPreview() {
    previewEl.textContent = '';
    if (avatarMode === 'image') {
      if (selectedImage) {
        var img = document.createElement('img');
        img.src = selectedImage; img.alt = '头像预览';
        previewEl.appendChild(img);
      } else previewEl.textContent = '未选择';
    } else {
      previewEl.appendChild(avatarNode(selectedColor, selectedEmoji, '', 'big'));
    }
    if (avatarClearBtn) avatarClearBtn.hidden = !(avatarMode === 'image' && selectedImage);
  }
  function setMode(mode) {
    avatarMode = (mode === 'image') ? 'image' : 'emoji';
    panelEmoji.hidden = avatarMode !== 'emoji';
    panelImage.hidden = avatarMode !== 'image';
    modeBtnEmoji.className = 'mode-btn' + (avatarMode === 'emoji' ? ' on' : '');
    modeBtnImage.className = 'mode-btn' + (avatarMode === 'image' ? ' on' : '');
    saveLook(); refreshPreview();
  }
  function buildPickers() {
    emojiRow.textContent = '';
    EMOJIS.forEach(function (em) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'emoji-pick' + (em === selectedEmoji ? ' on' : '');
      b.textContent = em;
      b.setAttribute('aria-label', '选择头像 ' + em);
      b.onclick = function () { selectedEmoji = em; saveLook(); buildPickers(); refreshPreview(); };
      emojiRow.appendChild(b);
    });
    colorRow.textContent = '';
    COLORS.forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'color-pick' + (c === selectedColor ? ' on' : '');
      b.style.background = c;
      b.setAttribute('aria-label', '选择底色 ' + c);
      b.onclick = function () { selectedColor = c; saveLook(); buildPickers(); refreshPreview(); };
      colorRow.appendChild(b);
    });
  }
  modeBtnEmoji.onclick = function () { setMode('emoji'); };
  modeBtnImage.onclick = function () { setMode('image'); };
  if (avatarClearBtn) {
    avatarClearBtn.onclick = function () { selectedImage = ''; selectedImagePath = ''; saveLook(); setMode('emoji'); };
  }
  function toBlob(canvas, quality) {
    return new Promise(function (resolve, reject) {
      if (canvas.toBlob) {
        canvas.toBlob(function (b) { b ? resolve(b) : reject(new Error('图片编码失败')); }, 'image/jpeg', quality);
      } else {
        try {
          var dataUrl = canvas.toDataURL('image/jpeg', quality);
          var bin = atob(dataUrl.split(',')[1]);
          var arr = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          resolve(new Blob([arr], { type: 'image/jpeg' }));
        } catch (e) { reject(e); }
      }
    });
  }
  function compressImage(file, maxEdge, quality) {
    return new Promise(function (resolve, reject) {
      if (!file.type || file.type.indexOf('image/') !== 0) return reject(new Error('这不是图片文件'));
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        var scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
        var w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
        var cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        var ctx = cv.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(cv.toDataURL('image/jpeg', quality));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('图片解码失败（HEIC 请先转成 JPG）')); };
      img.src = url;
    });
  }
  avatarFile.onchange = function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { alert('图片太大了（超过 8MB），请换一张小一点的。'); e.target.value = ''; return; }
    if (!currentUserId) { status('还在连接服务器，请等状态条显示「已连接」后再传头像。', 'err'); e.target.value = ''; return; }
    status('正在压缩并上传头像……');
    compressImage(file, 256, 0.85).then(function (dataUrl) {
      return new Promise(function (res, rej) {
        var im = new Image();
        im.onload = function () { res(im); };
        im.onerror = function () { rej(new Error('图片读取失败')); };
        im.src = dataUrl;
      });
    }).then(function (img) {
      var cv = document.createElement('canvas');
      cv.width = 256; cv.height = 256;
      var ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 256, 256);
      var side = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 256, 256);
      return toBlob(cv, 0.85);
    }).then(function (blob) {
      var path = currentUserId + '/' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8) + '.jpg';
      return sb.storage.from(AVATAR_BUCKET).upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false })
        .then(function (r) { if (r.error) throw r.error; return path; });
    }).then(function (path) {
      selectedImagePath = path; selectedImage = avatarUrl(path);
      saveLook(); setMode('image');
      status('头像已上传 ✅', 'ok');
      setTimeout(function () { if (statusEl.textContent === '头像已上传 ✅') status(''); }, 2500);
    }).catch(function (err) {
      console.error(err);
      var m = err && err.message ? err.message : String(err);
      if (/Bucket not found/i.test(m)) m = '存储桶还没建好（请先执行第三步 SQL）';
      else if (/row-level security|AccessDenied|403/i.test(m)) m = '没有上传权限（请确认匿名登录已开启）';
      status('头像上传失败：' + m, 'err');
    }).then(function () { e.target.value = ''; });
  };

  function currentUserName() {
    return (nameInput.value || localStorage.getItem(NAME_KEY) || '').trim();
  }

  /* ---------------- 分区 ---------------- */
  var sections = [];          // 全部分区
  var curSection = '';        // '' = 全部；'none' = 未分区；其他 = 分区 id
  var SECTION_CACHE = 'jiangwan_gb_sections_v1';

  function readSecCache() {
    try {
      var c = JSON.parse(localStorage.getItem(SECTION_CACHE) || 'null');
      return (c && c.length) ? c : null;
    } catch (e) { return null; }
  }
  function writeSecCache(list) {
    try { localStorage.setItem(SECTION_CACHE, JSON.stringify(list || [])); } catch (e) {}
  }

  function secName(id) {
    if (!id) return '未分区';
    for (var i = 0; i < sections.length; i++) if (sections[i].id === id) return sections[i].name;
    return '未分区';
  }

  function loadSections() {
    return withTimeout(sb.from('gb_sections')
      .select('id,name,sort_order,is_default,created_at')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }), 12000, '读取分区')
      .then(function (r) {
        if (r.error) throw r.error;
        sections = r.data || [];
        writeSecCache(sections);
      });
  }

  /* 分区栏渲染 */
  function renderSections() {
    var box = $('gb-sections');
    if (!box) return;
    box.textContent = '';

    // 「全部」和「未分区」在最前
    var all = [{ id: '', name: '全部' }, { id: 'none', name: '未分区' }];
    all.concat(sections.filter(function (x) { return !x.is_default; }))
       .forEach(function (sec) {
      var b = document.createElement('button');
      b.type = 'button';
      var key = sec.id;
      b.className = 'gb-sec-chip' + (curSection === key ? ' on' : '');
      var n = messages.filter(function (m) {
        return key === '' ? true : (key === 'none' ? !m.section_id : m.section_id === key);
      }).length;
      b.textContent = sec.name + (n ? ' ' + n : '');
      b.onclick = function () {
        curSection = key;
        renderSections();
        render();
      };
      box.appendChild(b);
    });

    // 删除分区（要密码）
    if (curSection && curSection !== 'none') {
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'gb-sec-chip del';
      del.textContent = '🗑 删除此分区';
      del.onclick = function () { deleteSection(curSection); };
      box.appendChild(del);
    }

    // 新建分区（不需要密码）
    var add = document.createElement('button');
    add.type = 'button';
    add.className = 'gb-sec-chip add';
    add.textContent = '＋ 新建分区';
    add.onclick = newSection;
    box.appendChild(add);
  }

  function newSection() {
    var name = prompt('新建分区\n名称不超过 5 个汉字或 10 个字母：');
    if (name === null || !name.trim()) return;
    var v = name.trim();
    var cjk = (v.match(/[\u4e00-\u9fff]/g) || []).length;
    var lat = v.replace(/[\u4e00-\u9fff]/g, '').length;
    if (cjk > 5 || lat > 10) { alert('名称太长：最多 5 个汉字或 10 个字母'); return; }
    status('正在新建分区……');
    sb.rpc('create_gb_section', { p_name: v, p_device_id: deviceId }).then(function (r) {
      if (r.error) throw r.error;
      var o = r.data; if (typeof o === 'string') { try { o = JSON.parse(o); } catch (e) {} }
      status('分区已新建 ✅', 'ok');
      setTimeout(function () { if (/分区已新建/.test(statusEl.textContent)) status(''); }, 2000);
      return loadSections().then(function () {
        if (o && o.id) curSection = o.id;
        renderSections(); render();
      });
    }).catch(function (e) {
      console.error(e);
      var m = (e && e.message) || String(e);
      status(/duplicate key/i.test(m) ? '已经有同名分区了。'
        : (/too long/i.test(m) ? '名称太长：最多 5 个汉字或 10 个字母' : ('新建分区失败：' + m)), 'err');
    });
  }

  function deleteSection(id) {
    if (!confirm('删除分区「' + secName(id) + '」？\n里面的帖子会自动归到「未分区」，不会被删。')) return;
    var pw = prompt('删除分区需要管理密码：');
    if (pw === null || !pw.trim()) return;
    status('正在校验密码……');
    sha256Hex(PW_SALT + '|' + pw.trim()).then(function (h) {
      return sb.rpc('delete_gb_section', { p_section_id: id, p_pw_hash: h });
    }).then(function (r) {
      if (r.error) throw r.error;
      var o = r.data; if (typeof o === 'string') { try { o = JSON.parse(o); } catch (e) {} }
      if (!o || o.deleted !== true) throw new Error('bad password');
      status('分区已删除，帖子已归到「未分区」✅', 'ok');
      curSection = '';
      return loadAll().then(function () {
        renderSections(); render();
        setTimeout(function () { if (/分区已删除/.test(statusEl.textContent)) status(''); }, 3000);
      });
    }).catch(function (e) {
      console.error(e);
      var m = (e && e.message) || String(e);
      status(/bad password/i.test(m) ? '密码不对，分区没有删除。'
        : (/cannot delete default/i.test(m) ? '「未分区」不能删除。' : ('删除失败：' + m)), 'err');
    });
  }

  /* ---------------- 数据读写 ---------------- */
  function scheduleRetry() {
    if (retryTimer) return;
    retryTimer = setTimeout(function () {
      retryTimer = null;
      if (!sb) { scheduleRetry(); return; }
      loadAll().then(function () {
        connected = true; render();
        status('已重新连上云端 ✅', 'ok');
        setTimeout(function () { if (/已重新连上/.test(statusEl.textContent)) status(''); }, 2500);
      }).catch(function () { scheduleRetry(); });
    }, 15000);
  }
  function reloadError(e) {
    console.error(e);
    connected = false;
    render();
    if (readGbCache()) {
      status('当前网络连不上服务器，显示的是上次加载的留言。可以正常浏览，暂时发不了新内容。', 'err');
    } else {
      status(friendlyError(e, '加载留言'), 'err');
    }
    scheduleRetry();
  }

  var GB_CACHE = 'jiangwan_gb_cache_v1';
  function readGbCache() {
    try {
      var c = JSON.parse(localStorage.getItem(GB_CACHE) || 'null');
      return (c && c.messages && c.messages.length) ? c : null;
    } catch (e) { return null; }
  }
  function writeGbCache(msgs, replies) {
    try {
      localStorage.setItem(GB_CACHE, JSON.stringify({
        at: Date.now(),
        messages: (msgs || []).slice(-60),
        replies: (replies || []).slice(-200)
      }));
    } catch (e) {}
  }

  function loadAll() {
    if (!sb) return Promise.reject(new Error('云端未就绪'));
    return withTimeout(sb.from('messages')
      .select('id,created_at,name,content,avatar_color,avatar_emoji,avatar_path,avatar_mode,like_count,reply_count,is_pinned,pinned_at,section_id')
      .eq('hidden', false)
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE), 15000, '读取留言')
      .then(function (res) {
        if (res.error) throw res.error;
        messages = res.data || [];                          // 已经是时间倒序（新的在前）
        messages.sort(function (a, b) {                     // 置顶的抽到最前面，其余保持新的在前
          if (!!a.is_pinned !== !!b.is_pinned) return a.is_pinned ? -1 : 1;
          return new Date(b.created_at) - new Date(a.created_at);
        });
        var ids = messages.map(function (m) { return m.id; });
        if (!ids.length) { repliesByMsg = {}; msgImages = {}; writeGbCache(messages, []); return null; }
        return withTimeout(sb.from('replies')
          .select('id,message_id,created_at,name,content,avatar_color,avatar_emoji,avatar_path,avatar_mode,reply_to_id,reply_to_name')
          .in('message_id', ids)
          .order('created_at', { ascending: true })
          .limit(600), 15000, '读取回复')
          .then(function (r2) {
            if (r2.error) throw r2.error;
            repliesByMsg = {};
            var flat = [];
            (r2.data || []).forEach(function (r) {
              (repliesByMsg[r.message_id] = repliesByMsg[r.message_id] || []).push(r);
              flat.push(r);
            });
            writeGbCache(messages, flat);
            return loadMsgImages(ids);
          });
      });
  }
  function loadLiked() {
    if (!sb) return Promise.resolve();
    return withTimeout(sb.rpc('liked_message_ids', { p_device_id: deviceId }), 12000, '读取点赞')
      .then(function (res) {
        if (res.error) return null;
        var raw = res.data;
        if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch (e) { raw = []; } }
        if (!Array.isArray(raw)) raw = raw ? [raw] : [];
        var next = {};
        raw.forEach(function (row) {
          var id = (row && typeof row === 'object') ? (row.liked_message_ids || row.message_id || row.id) : row;
          if (id) next[id] = true;
        });
        likedSet = next;
        try { localStorage.setItem(LIKED_KEY, JSON.stringify(likedSet)); } catch (e) {}
        return null;
      }).catch(function () { return null; });
  }

  /* ---------------- 回复输入框 ---------------- */
  function openReplyBox(msg, replyTo, host) {
    var old = host.querySelector('.gb-reply-form-inline');
    if (old) old.remove();
    var box = document.createElement('div');
    box.className = 'reply-form gb-reply-form-inline';
    var input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 300;
    input.placeholder = replyTo ? ('回复 ' + replyTo.name + '……') : ('回复 ' + msg.name + '……');
    var send = document.createElement('button');
    send.type = 'button'; send.className = 'btn-main'; send.textContent = '发送';
    var cancel = document.createElement('button');
    cancel.type = 'button'; cancel.className = 'btn-ghost'; cancel.textContent = '取消';
    cancel.onclick = function () { box.remove(); };
    function doSend() {
      if (busy) return;
      var name = currentUserName();
      if (!name) { alert('请先在上方填写你的名字'); nameInput.focus(); return; }
      var text = input.value.trim();
      if (!text) { alert('回复内容不能为空'); input.focus(); return; }
      if (!connected) { status('还没连上服务器，暂时发不了。', 'err'); return; }
      busy = true; send.disabled = true; send.textContent = '…';
      var av = avatarPayload();
      sb.from('replies').insert({
        message_id: msg.id, device_id: deviceId,
        name: name.slice(0, 20), content: text.slice(0, 300),
        reply_to_id: replyTo ? replyTo.id : null,
        reply_to_name: replyTo ? replyTo.name : null,
        avatar_mode: av.avatar_mode, avatar_path: av.avatar_path,
        avatar_color: av.avatar_color, avatar_emoji: av.avatar_emoji
      }).then(function (res) {
        if (res.error) throw res.error;
        box.remove();
        status('回复成功 ✅', 'ok');
        setTimeout(function () { if (statusEl.textContent === '回复成功 ✅') status(''); }, 2000);
        return loadAll().then(render);
      }).catch(function (e) {
        console.error(e); status(friendlyError(e, '回复'), 'err');
      }).then(function () { busy = false; send.disabled = false; send.textContent = '发送'; });
    }
    send.onclick = doSend;
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); doSend(); } });
    box.appendChild(input); box.appendChild(send); box.appendChild(cancel);
    host.appendChild(box);
    input.focus();
  }

  /* ---------------- 置顶 ---------------- */
  function togglePin(msg, btn) {
    if (busy || !connected) return;
    var pw = prompt((msg.is_pinned ? '取消置顶' : '把这条留言置顶') + '\n请输入管理密码：');
    if (pw === null || !pw.trim()) return;
    busy = true;
    if (btn) { btn.disabled = true; btn.textContent = '处理中…'; }
    sha256Hex(PW_SALT + '|' + pw.trim()).then(function (hash) {
      return sb.rpc('set_message_pinned', {
        p_message_id: msg.id, p_pinned: !msg.is_pinned, p_pw_hash: hash
      });
    }).then(function (res) {
      if (res.error) throw res.error;
      var out = res.data;
      if (typeof out === 'string') { try { out = JSON.parse(out); } catch (e) {} }
      status(out && out.is_pinned ? '已置顶 📌 它会显示在留言板最上面' : '已取消置顶', 'ok');
      setTimeout(function () { if (/置顶/.test(statusEl.textContent)) status(''); }, 3000);
      return loadAll().then(render);
    }).catch(function (e) {
      console.error(e);
      status(isBadPw(e) ? '密码不对，置顶没有生效。' : friendlyError(e, '置顶'), 'err');
      if (btn) { btn.disabled = false; btn.textContent = '📌'; }
    }).then(function () { busy = false; });
  }
  function clearAllPins() {
    var pw = prompt('取消所有置顶\n请输入管理密码：');
    if (pw === null || !pw.trim()) return;
    sha256Hex(PW_SALT + '|' + pw.trim()).then(function (hash) {
      return sb.rpc('clear_all_pins', { p_pw_hash: hash });
    }).then(function (res) {
      if (res.error) throw res.error;
      status('已取消全部置顶', 'ok');
      setTimeout(function () { if (/全部置顶/.test(statusEl.textContent)) status(''); }, 2500);
      return loadAll().then(render);
    }).catch(function (e) {
      console.error(e);
      status(isBadPw(e) ? '密码不对。' : friendlyError(e, '取消置顶'), 'err');
    });
  }

  /* ---------------- 删除（需密码） ---------------- */
  function deleteWithPassword(confirmText, rpcName, argName, id) {
    if (!confirm(confirmText)) return Promise.resolve(false);
    var pw = prompt('删除需要管理密码：');
    if (pw === null || !pw.trim()) return Promise.resolve(false);
    status('正在校验密码并删除……');
    return sha256Hex(PW_SALT + '|' + pw.trim()).then(function (hash) {
      var arg = {};
      arg[argName] = id;
      arg.p_pw_hash = hash;
      return sb.rpc(rpcName, arg);
    }).then(function (res) {
      if (res.error) throw res.error;
      var out = res.data;
      if (typeof out === 'string') { try { out = JSON.parse(out); } catch (e) {} }
      if (!out || out.deleted !== true) throw new Error('bad password');
      status('已删除 ✅', 'ok');
      setTimeout(function () { if (/已删除/.test(statusEl.textContent)) status(''); }, 2000);
      return loadAll().then(function () { render(); return true; });
    }).catch(function (e) {
      console.error(e);
      status(isBadPw(e) ? '密码不对，没有删除。' : friendlyError(e, '删除'), 'err');
      return false;
    });
  }
  function deleteMessage(msg) {
    return deleteWithPassword('删除这条留言？\n它的所有回复和点赞会一起删掉，不可恢复。', 'delete_message', 'p_message_id', msg.id);
  }
  function deleteReply(reply) {
    return deleteWithPassword('删除这条回复？', 'delete_reply', 'p_reply_id', reply.id);
  }

  /* ---------------- 渲染 ---------------- */
  function createReplyEl(reply, msg, host) {
    var rEl = document.createElement('div');
    rEl.className = 'gb-reply';
    rEl.appendChild(avatarNode(reply.avatar_color, reply.avatar_emoji, reply.avatar_path, 'small'));

    var body = document.createElement('div');
    body.className = 'gb-reply-body';
    var head = document.createElement('div');
    var nm = document.createElement('span');
    nm.className = 'gb-reply-name';
    nm.textContent = reply.name;
    head.appendChild(nm);
    if (reply.reply_to_name) {
      var to = document.createElement('span');
      to.className = 'gb-reply-to';
      to.textContent = '回复 ' + reply.reply_to_name;
      head.appendChild(to);
    }
    var tm = document.createElement('span');
    tm.className = 'gb-reply-time';
    tm.textContent = fmt(reply.created_at);
    head.appendChild(tm);

    var ct = document.createElement('div');
    ct.className = 'gb-reply-content';
    ct.textContent = reply.content;
    body.appendChild(head); body.appendChild(ct);

    var acts = document.createElement('div');
    acts.className = 'gb-reply-actions';
    var reBtn = document.createElement('button');
    reBtn.type = 'button';
    reBtn.className = 'gb-action-btn';
    reBtn.textContent = '↩';
    reBtn.title = '回复';
    reBtn.onclick = function () { openReplyBox(msg, reply, host); };
    var delR = document.createElement('button');
    delR.type = 'button';
    delR.className = 'gb-action-btn';
    delR.textContent = '🗑';
    delR.title = '删除';
    delR.onclick = function () { deleteReply(reply); };
    acts.appendChild(reBtn);
    acts.appendChild(delR);
    body.appendChild(acts);

    rEl.appendChild(body);
    return rEl;
  }

  function createPostEl(msg) {
    var item = document.createElement('div');
    item.className = 'gb-item' + (msg.is_pinned ? ' pinned' : '');
    item.appendChild(avatarNode(msg.avatar_color, msg.avatar_emoji, msg.avatar_path, 'big'));

    var body = document.createElement('div');
    body.className = 'gb-body';

    var header = document.createElement('div');
    header.className = 'gb-header';
    if (msg.is_pinned) {
      var pin = document.createElement('span');
      pin.className = 'gb-pin-badge';
      pin.textContent = '📌 置顶';
      header.appendChild(pin);
    }
    var nameEl = document.createElement('span');
    nameEl.className = 'gb-name';
    nameEl.textContent = msg.name;
    var timeEl = document.createElement('span');
    timeEl.className = 'gb-time';
    timeEl.textContent = fmt(msg.created_at);
    header.appendChild(nameEl); header.appendChild(timeEl);
    var secTag = document.createElement('span');
    secTag.className = 'gb-sec-tag';
    secTag.textContent = secName(msg.section_id);
    header.appendChild(secTag);

    var content = document.createElement('div');
    content.className = 'gb-content';
    content.textContent = msg.content;

    var replies = repliesByMsg[msg.id] || [];
    var repliesEl = document.createElement('div');
    repliesEl.className = 'gb-replies';
    if (!replies.length) repliesEl.hidden = true;
    replies.forEach(function (r) { repliesEl.appendChild(createReplyEl(r, msg, body)); });

    var actions = document.createElement('div');
    actions.className = 'gb-actions';

    var liked = !!likedSet[msg.id];
    var likeBtn = document.createElement('button');
    likeBtn.type = 'button';
    likeBtn.className = 'gb-action-btn' + (liked ? ' liked' : '');
    likeBtn.textContent = '👍 ' + (msg.like_count || 0);
    likeBtn.title = '点赞';
    likeBtn.onclick = function () {
      if (busy || !connected) return;
      busy = true;
      sb.rpc('like_message', { p_message_id: msg.id, p_device_id: deviceId }).then(function (res) {
        if (res.error) throw res.error;
        var out = res.data;
        if (typeof out === 'string') { try { out = JSON.parse(out); } catch (e) {} }
        if (out && typeof out === 'object') {
          msg.like_count = out.like_count;
          if (out.liked) likedSet[msg.id] = true; else delete likedSet[msg.id];
          try { localStorage.setItem(LIKED_KEY, JSON.stringify(likedSet)); } catch (e) {}
          likeBtn.className = 'gb-action-btn' + (out.liked ? ' liked' : '');
          likeBtn.textContent = '👍 ' + out.like_count;
        }
      }).catch(function (e) { console.error(e); status(friendlyError(e, '点赞'), 'err'); })
        .then(function () { busy = false; });
    };

    var replyBtn = document.createElement('button');
    replyBtn.type = 'button';
    replyBtn.className = 'gb-action-btn';
    replyBtn.textContent = '💬' + (replies.length ? ' ' + replies.length : '');
    replyBtn.title = '回复';
    replyBtn.onclick = function () { openReplyBox(msg, null, body); };

    var copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'gb-action-btn';
    copyBtn.textContent = '📋';
    copyBtn.title = '复制内容';
    copyBtn.onclick = function () { copyText(msg.content, '内容已复制'); };

    var pinBtn = document.createElement('button');
    pinBtn.type = 'button';
    pinBtn.className = 'gb-action-btn';
    pinBtn.textContent = '📌';
    pinBtn.title = msg.is_pinned ? '取消置顶' : '置顶';
    pinBtn.className = 'gb-action-btn' + (msg.is_pinned ? ' pinned-on' : '');
    pinBtn.onclick = function () { togglePin(msg, pinBtn); };

    var delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'gb-action-btn danger';
    delBtn.textContent = '🗑';
    delBtn.title = '删除';
    delBtn.onclick = function () { deleteMessage(msg); };

    actions.appendChild(likeBtn);
    actions.appendChild(replyBtn);
    actions.appendChild(copyBtn);
    actions.appendChild(pinBtn);
    actions.appendChild(delBtn);

    body.appendChild(header);
    body.appendChild(content);
    renderMsgImages(body, msg);
    body.appendChild(actions);
    body.appendChild(repliesEl);

    item.appendChild(body);
    return item;
  }

  function render() {
    renderSections();
    listEl.textContent = '';
    if (!messages.length) {
      var empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = connected ? '还没有留言，来发第一条吧～' : '留言加载中……';
      listEl.appendChild(empty);
      return;
    }
    messages.filter(function (m) {
      if (!curSection) return true;                       // 全部
      if (curSection === 'none') return !m.section_id;     // 未分区
      return m.section_id === curSection;
    }).forEach(function (msg) { listEl.appendChild(createPostEl(msg)); });

    if (!listEl.childNodes.length) {
      var none = document.createElement('div');
      none.className = 'empty';
      none.textContent = '这个分区还没有帖子。';
      listEl.appendChild(none);
    }

    if (messages.some(function (m) { return m.is_pinned; })) {
      var bar = document.createElement('div');
      bar.className = 'gb-clear-pins';
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'gb-action-btn';
      b.textContent = '📌 全部取消';
      b.onclick = clearAllPins;
      bar.appendChild(b);
      listEl.appendChild(bar);
    }
  }

  /* ---------------- 留言配图（最多 4 张） ---------------- */
  function renderImgPick() {
    var box = $('gb-img-preview');
    var cnt = $('gb-img-count');
    if (!box) return;
    box.textContent = '';
    pendingImgs.forEach(function (it, i) {
      var w = document.createElement('div');
      w.className = 'gb-pick-thumb';
      var im = document.createElement('img');
      im.src = it.url; im.alt = '';
      var del = document.createElement('button');
      del.type = 'button'; del.textContent = '×'; del.title = '移除';
      del.onclick = function () {
        URL.revokeObjectURL(it.url);
        pendingImgs.splice(i, 1);
        renderImgPick();
  var secCached = readSecCache();
  if (secCached) { sections = secCached; renderSections(); }
      };
      w.appendChild(im); w.appendChild(del);
      box.appendChild(w);
    });
    if (cnt) {
      cnt.textContent = pendingImgs.length
        ? ('已选 ' + pendingImgs.length + ' 张，还可以加 ' + (MAX_IMGS - pendingImgs.length) + ' 张')
        : '还没选图片（最多 ' + MAX_IMGS + ' 张）';
    }
  }

  var imgInput = $('gb-images');
  if (imgInput) {
    imgInput.onchange = function (e) {
      var files = Array.prototype.slice.call(e.target.files || []);
      files.forEach(function (f) {
        if (pendingImgs.length >= MAX_IMGS) return;
        if (!f.type || f.type.indexOf('image/') !== 0) return;
        if (f.size > 20 * 1024 * 1024) { alert('「' + (f.name || '图片') + '」超过 20MB，跳过了'); return; }
        pendingImgs.push({ file: f, url: URL.createObjectURL(f) });
      });
      if (files.length && pendingImgs.length >= MAX_IMGS) {
        alert('最多只能发 ' + MAX_IMGS + ' 张图');
      }
      renderImgPick();
  var secCached = readSecCache();
  if (secCached) { sections = secCached; renderSections(); }
      e.target.value = '';
    };
  }

  /* 压缩到 1600px 再上传（省流量，画质够用） */
  function compressForMsg(file) {
    return compressImage(file, 1600, 0.85).then(function (dataUrl) {
      return new Promise(function (res, rej) {
        var im = new Image();
        im.onload = function () { res(im); };
        im.onerror = function () { rej(new Error('图片读取失败')); };
        im.src = dataUrl;
      });
    }).then(function (img) {
      var maxEdge = 1600;
      var sc = Math.min(1, maxEdge / Math.max(img.width, img.height));
      var w = Math.max(1, Math.round(img.width * sc));
      var h = Math.max(1, Math.round(img.height * sc));
      var cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      var ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      return toBlob(cv, 0.85);
    });
  }

  /* 把图片上传到存储桶，并在数据库登记 */
  function uploadMsgImages(messageId) {
    if (!pendingImgs.length || !currentUserId) return Promise.resolve();
    var total = pendingImgs.length;
    return pendingImgs.reduce(function (chain, item, idx) {
      return chain.then(function () {
        status('正在上传配图 ' + (idx + 1) + '/' + total + '……');
        return compressForMsg(item.file).then(function (blob) {
          var path = currentUserId + '/msg-' + Date.now().toString(36) + '-'
            + Math.random().toString(36).slice(2, 8) + '.jpg';
          return sb.storage.from(AVATAR_BUCKET).upload(path, blob, {
            contentType: 'image/jpeg', cacheControl: '31536000', upsert: false
          }).then(function (r) {
            if (r.error) throw r.error;
            return sb.from('message_images').insert({
              message_id: messageId, device_id: deviceId,
              image_path: path, sort_order: idx
            });
          }).then(function (r) {
            if (r && r.error) throw r.error;
            return null;
          });
        });
      });
    }, Promise.resolve());
  }

  /* 清理已发送的预览 */
  function clearImgPick() {
    pendingImgs.forEach(function (it) { URL.revokeObjectURL(it.url); });
    pendingImgs = [];
    renderImgPick();
  var secCached = readSecCache();
  if (secCached) { sections = secCached; renderSections(); }
  }

  /* 留言里的图片：点击看大图 */
  function renderMsgImages(host, msg) {
    var list = msgImages[msg.id] || [];
    if (!list.length) return;
    var box = document.createElement('div');
    box.className = 'gb-msg-images';
    list.forEach(function (im) {
      var url = avatarUrl(im.image_path);
      if (!url) return;
      var img = document.createElement('img');
      img.src = url; img.alt = '留言配图'; img.loading = 'lazy';
      img.onclick = function () {
        if (window.__jwOpenImage) window.__jwOpenImage(url, '留言配图');
        else window.open(url, '_blank');
      };
      box.appendChild(img);
    });
    if (box.childNodes.length) host.appendChild(box);
  }

  /* 加载所有留言的配图 */
  function loadMsgImages(ids) {
    if (!ids.length) { msgImages = {}; return Promise.resolve(); }
    return withTimeout(sb.from('message_images')
      .select('id,message_id,image_path,sort_order')
      .in('message_id', ids).eq('hidden', false)
      .order('sort_order', { ascending: true })
      .limit(400), 15000, '读取留言配图')
      .then(function (r) {
        if (r.error) throw r.error;
        msgImages = {};
        (r.data || []).forEach(function (x) {
          (msgImages[x.message_id] = msgImages[x.message_id] || []).push(x);
        });
      }).catch(function (e) {
        console.warn('留言配图加载失败（不影响文字）', e);
        msgImages = {};
      });
  }

  /* ---------------- 发布留言 ---------------- */
  submitBtn.onclick = function () {
    var name = nameInput.value.trim();
    var content = contentInput.value.trim();
    if (!name) { alert('请填写你的名字'); nameInput.focus(); return; }
    if (!content) { alert('请写点内容再发布'); contentInput.focus(); return; }
    if (avatarMode === 'image' && !selectedImagePath) {
      alert('你选了「上传图片」头像，但还没上传成功。请先选一张图片，或者切回 emoji 头像。');
      return;
    }
    if (!connected) { status('当前网络连不上服务器，暂时发不了。可以正常浏览已有内容，网络恢复后会自动重连。', 'err'); return; }
    if (busy) return;
    busy = true; submitBtn.disabled = true; submitBtn.textContent = '发送中…';
    var av = avatarPayload();
    sb.from('messages').insert({
      device_id: deviceId, name: name.slice(0, 20), content: content.slice(0, 500),
      avatar_mode: av.avatar_mode, avatar_path: av.avatar_path,
      avatar_color: av.avatar_color, avatar_emoji: av.avatar_emoji,
      section_id: (curSection && curSection !== 'none' && curSection !== '') ? curSection : null
    }).select('id').then(function (res) {
      if (res.error) throw res.error;
      var newId = (res.data && res.data[0] && res.data[0].id) || '';
      contentInput.value = '';
      try { localStorage.setItem(NAME_KEY, name); } catch (e) {}
      return uploadMsgImages(newId).then(function () {
        clearImgPick();
        status('发布成功 ✅' + (pendingImgs.length ? '' : ''), 'ok');
        setTimeout(function () { if (/发布成功/.test(statusEl.textContent)) status(''); }, 2500);
        return loadAll().then(render);
      });
    }).catch(function (e) {
      console.error(e); status(friendlyError(e, '发布'), 'err');
    }).then(function () { busy = false; submitBtn.disabled = false; submitBtn.textContent = '发布留言'; });
  };


  /* ---------------- 启动 ---------------- */
  buildPickers();
  setMode(avatarMode);
  renderImgPick();
  var secCached = readSecCache();
  if (secCached) { sections = secCached; renderSections(); }
  render();
  status('正在连接留言服务器……');

  function boot2() {
    if (!window.JW || !JW.sb) {
      status('留言组件加载失败。页面其它内容正常可用，请换网络或稍后刷新重试。', 'err');
      return;
    }
    sb = JW.sb;
    currentUserId = JW.uid || '';
    deviceId = JW.deviceId || localStorage.getItem(DEVICE_KEY) || '';
    // 先用本地缓存把留言显示出来，网络不通时也不至于空白
    var gbCached = readGbCache();
    if (gbCached) {
      messages = gbCached.messages.slice();
      messages.sort(function (a, b) {
        if (!!a.is_pinned !== !!b.is_pinned) return a.is_pinned ? -1 : 1;
        return new Date(b.created_at) - new Date(a.created_at);
      });
      repliesByMsg = {};
      (gbCached.replies || []).forEach(function (r) {
        (repliesByMsg[r.message_id] = repliesByMsg[r.message_id] || []).push(r);
      });
      render();
      status('正在更新留言……');
    }
    try {
      var cached = JSON.parse(localStorage.getItem(LIKED_KEY) || '{}');
      if (cached && typeof cached === 'object') likedSet = cached;
    } catch (e) { likedSet = {}; }
    loadSections().then(loadAll).then(loadLiked).then(function () {
      connected = true;
      render();
      var icon = (avatarMode === 'image' && selectedImage) ? '（图片头像）' : selectedEmoji;
      status('已连接云端 · 共 ' + messages.length + ' 条留言（你的头像：' + icon + '，留言全部匿名）', 'ok');
    }).catch(reloadError);
  }

  function startWhenSharedReady() {
    if (window.JW) {
      JW.whenReady(function (err) {
        if (err) {
          connected = false; render();
          status('连不上云端：' + (err.message || err) + '。会自动重试，也可以下拉刷新。', 'err');
          scheduleRetry();
          return;
        }
        boot2();
      });
    } else {
      status('留言组件没加载到，请下拉刷新页面。', 'err');
    }
  }

  nameInput.addEventListener('input', function () {
    try { localStorage.setItem(NAME_KEY, nameInput.value.trim()); } catch (e) {}
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startWhenSharedReady);
  } else {
    startWhenSharedReady();
  }
})();
