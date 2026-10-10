/* ===== Liquid Glass · 原生实现 =====
   算法直接取自 shuding/liquid-glass（MIT）的 Shader 类：
   https://github.com/shuding/liquid-glass
   思路：用 roundedRectSDF + smoothStep 算出每个像素该位移多少，
        生成一张位移图（位移图只在元素尺寸变化时重算一次），
        再交给 feDisplacementMap 做真实折射。
   关键特征：折射只发生在边缘，中间完全不变形。 */
(function () {
  'use strict';

  /* ---------- 以下工具函数与 shuding 原版一致 ---------- */
  function smoothStep(a, b, t) {
    t = Math.max(0, Math.min(1, (t - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }
  function length(x, y) { return Math.sqrt(x * x + y * y); }
  function roundedRectSDF(x, y, width, height, radius) {
    var qx = Math.abs(x) - width + radius;
    var qy = Math.abs(y) - height + radius;
    return Math.min(Math.max(qx, qy), 0) + length(Math.max(qx, 0), Math.max(qy, 0)) - radius;
  }

  var DPI = 1;   // 位移图分辨率倍率，1 足够（放大只会更糊）

  function makeShader(el, opts) {
    var w = Math.max(8, Math.round(el.offsetWidth));
    var h = Math.max(8, Math.round(el.offsetHeight));
    var key = 'lg' + Math.random().toString(36).slice(2, 9);

    // ---- 位移图：逐像素算边缘折射量（与原版 updateShader 等价）----
    var cw = w * DPI, ch = h * DPI;
    var canvas = document.createElement('canvas');
    canvas.width = cw; canvas.height = ch;
    var ctx = canvas.getContext('2d');
    var data = new Uint8ClampedArray(cw * ch * 4);
    var maxScale = 0;
    var raw = [];

    for (var i = 0; i < data.length; i += 4) {
      var x = (i / 4) % cw;
      var y = Math.floor(i / 4 / cw);
      var ux = x / cw, uy = y / ch;
      // 原版片段着色器：距离边缘越近位移越大，中间为 0
      var ix = ux - 0.5, iy = uy - 0.5;
      var d = roundedRectSDF(ix, iy, opts.w, opts.h, opts.r);
      var displacement = smoothStep(0.8, 0, d - 0.15);
      var scaled = smoothStep(0, 1, displacement);
      var px = ix * scaled + 0.5;
      var py = iy * scaled + 0.5;
      var dx = px * cw - x;
      var dy = py * ch - y;
      if (Math.abs(dx) > maxScale) maxScale = Math.abs(dx);
      if (Math.abs(dy) > maxScale) maxScale = Math.abs(dy);
      raw.push(dx, dy);
    }
    maxScale *= 0.5;
    if (maxScale <= 0) maxScale = 1;

    var k = 0;
    for (var j = 0; j < data.length; j += 4) {
      data[j]     = (raw[k++] / maxScale + 0.5) * 255;   // R：水平位移
      data[j + 1] = (raw[k++] / maxScale + 0.5) * 255;   // G：垂直位移
      data[j + 2] = 0;
      data[j + 3] = 255;
    }
    ctx.putImageData(new ImageData(data, cw, ch), 0, 0);

    // ---- SVG 滤镜 ----
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
    svg.style.cssText = 'position:absolute;pointer-events:none';
    var defs = document.createElementNS(NS, 'defs');
    var filter = document.createElementNS(NS, 'filter');
    filter.setAttribute('id', key + '_f');
    filter.setAttribute('filterUnits', 'userSpaceOnUse');
    filter.setAttribute('colorInterpolationFilters', 'sRGB');
    filter.setAttribute('x', '0'); filter.setAttribute('y', '0');
    filter.setAttribute('width', String(w)); filter.setAttribute('height', String(h));

    var feImage = document.createElementNS(NS, 'feImage');
    feImage.setAttribute('width', String(w));
    feImage.setAttribute('height', String(h));
    feImage.setAttributeNS('http://www.w3.org/1999/xlink', 'href', canvas.toDataURL());

    var disp = document.createElementNS(NS, 'feDisplacementMap');
    disp.setAttribute('in', 'SourceGraphic');
    disp.setAttribute('in2', key + '_map');
    disp.setAttribute('xChannelSelector', 'R');
    disp.setAttribute('yChannelSelector', 'G');
    disp.setAttribute('scale', String(maxScale / DPI));

    feImage.setAttribute('id', key + '_map');
    filter.appendChild(feImage);
    filter.appendChild(disp);
    defs.appendChild(filter);
    svg.appendChild(defs);
    document.body.appendChild(svg);

    return { id: key + '_f', svg: svg, w: w, h: h };
  }

  /* 对匹配到的元素应用玻璃：只在尺寸变化时重算 */
  var applied = new WeakMap();

  function apply(el, opts) {
    if (applied.has(el)) return applied.get(el);
    if (!el.offsetWidth || !el.offsetHeight) return null;
    var sh = makeShader(el, opts);
    var blur = (opts && opts.blur) || 0.4;
    el.style.backdropFilter = 'url(#' + sh.id + ') blur(' + blur + 'px) saturate(180%)';
    el.style.webkitBackdropFilter = 'url(#' + sh.id + ') blur(' + blur + 'px) saturate(180%)';
    el.style.background = 'rgba(255,255,255,.10)';
    var rec = { sh: sh, w: sh.w, h: sh.h };
    applied.set(el, rec);

    // 尺寸变了就重新生成（防抖）
    if (window.ResizeObserver) {
      var t = null;
      var ro = new ResizeObserver(function () {
        clearTimeout(t);
        t = setTimeout(function () {
          if (Math.abs(el.offsetWidth - rec.w) < 4 && Math.abs(el.offsetHeight - rec.h) < 4) return;
          sh.svg.remove();
          applied.delete(el);
          apply(el, opts);
        }, 300);
      });
      ro.observe(el);
      rec.ro = ro;
    }
    return rec;
  }

  function boot() {
    // 只给"少而大"的容器做真折射；列表里的小卡片用 CSS 半透明模拟
    // 圆角半径按元素高度归一化（0.5 ≈ 胶囊，越小越方）
    var jobs = [
      ['.sidebar', { w: .5,  h: .5,  r: .12, blur: .3 }],
      ['.topbar',  { w: .5,  h: .5,  r: .12, blur: .3 }],
      ['.card-box',{ w: .5,  h: .5,  r: .06, blur: .5 }],
      ['.issue-bar',{ w: .5, h: .5,  r: .06, blur: .5 }]
    ];
    jobs.forEach(function (job) {
      var els = document.querySelectorAll(job[0]);
      Array.prototype.forEach.call(els, function (el) { apply(el, job[1]); });
    });
  }
  window.liquidGlass = { apply: apply, boot: boot };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 60); });
  else setTimeout(boot, 60);
  // 动态插入的元素（比如期刊面板）也补上
  window.addEventListener('load', function () { setTimeout(boot, 400); });
})();
