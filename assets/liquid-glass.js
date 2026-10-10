/* ===== 班级期刊 · 液玻璃（Liquid Glass）=====
   原理（和 shuding/liquid-glass 一致）：
   ① 一张位移贴图 PNG 内联成 data URL（关键：feImage 用外链会静默失败）
   ② SVG 滤镜里用 feDisplacementMap 做折射，可选色散（RGB 分离再相加）
   ③ 元素用 backdrop-filter: url(#lg-refract) 把身后的内容"折射"过来
   原生实现，不依赖任何框架。 */
(function () {
  var MAP = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAgAAAAIACAIAAAB7GkOtAAAF2ElEQVR42u3cOwqAMBBAwVU8uPc2HyshYi9mnSFI6m0em8KllL1GHMMp9+946nB5nnZ9x0u/X/rjxPUF4E1bVEMA+GcADkMAEAAABAAAAQAgZQCKIQDYAACwAQBgAwDABgCAAAAgAAAIAAACAMC3A+BvoAA2AAAEAID0AfAEBCAAAAgAAAIAgAAAIAAACAAAUwagGQKADQAAGwAAAgBAygB4AgKwAQAgAACkD0A3BAAbAAACAED2AHgCArABAGADAEAAABAAAAQAAAEAQAAAmMVqBAA2AABsAAAIAAACAIAAACAAAAgAAAIAgAAAIAAACAAAAgCAAAAgAAAIAAACAIAAACAAAAgAAAIAgAAAIAAACACAAAAgAAAIAAACAIAAACAAAAgAAAIAgAAAIAAACAAAAgCAAAAgAAAIAAACAIAAACAAAAgAAAIAgAAAIAAACACAAAAgAAAIAAACAIAAACAAAAgAAAIAgAAAIAAACAAAAgCAAAAgAAAIAAACAIAAACAAAAgAAAIAgAAAIAAACAAAAgAgAAAIAAACAIAAACAAAAgAAAIAgAAAIAAACAAAAgCAAAAgAAAIAAACAIAAACAAAAgAAAIAgAAAIAAACAAAAgAgAAAIAAACAIAAACAAAAgAAAIAgAAAIAAACAAAAgCAAAAgAAAIAAACAIAAACAAAAgAAAIAgAAAIAAACAAAAgCAAAAIAAACAIAAACAAAAgAAAIAgAAAIAAACAAAAgCAAAAgAAAIAAACAIAAACAAAAgAAAIAgAAAIAAACAAAAgCAAAAIAAACAIAAACAAAAgAAAIAgAAAIAAACAAAAgCAAAAgAAAIAAACAIAAACAAAAgAAAIAgAAAIAAACAAAAgCAAAAgAAACAIAAACAAAAgAAAIAgAAAIAAACAAAAgCAAAAgAAAIAAACAIAAACAAAAgAAAIAgAAAIAAACAAAAgCAAAAgAAACAIAAACAAAAgAAAIAgAAAIAAACAAAAgCAAAAgAAAIAAACAIAAACAAAAgAAAIAgAAAIAAACAAAAgCAAAAgAAAIAIAAACAAAAgAAAIAgAAAIAAACAAAAgCAAAAgAAAIAAACAIAAACAAAAgAAAIAgAAAIAAACAAAAgCAAAAgAAAIAIAAACAAAAgAAAIAgAAAIAAACAAAAgCAAAAgAAAIAAACAIAAACAAAAgAAAIAgAAAIAAACAAAAgCAAAAgAAAIAIAAGAGAAAAgAAAIAAACAIAAACAAAAgAAAIAgAAAIAAACAAAAgCAAAAgAAAIAAACAIAAACAAAAgAAAIAgAAAIAAACACAAAAgAAAIAAACAIAAACAAAAgAAAIAgAAAIAAACAAAAgCAAAAgAAAIAAACAIAAACAAAAgAAAIAgAAAIAAACACAAAAgAAAIAAACAIAAACAAAAgAAAIAgAAAIAAACAAAAgCAAAAgAAAIAAACAIAAACAAAAgAAAIAgAAAIAAACAAAAgAgAAAIAAACAIAAACAAAAgAAAIAgAAAIAAACAAAAgCAAAAgAAAIAAACAIAAACAAAAgAAAIAgAAAIAAACAAAAgAgAAAIAAACAIAAACAAAAgAAAIAgAAAIAAACAAAAgCAAAAgAAAIAAACAIAAACAAAAgAAAIAgAAAIAAACAAAAgCAAAAIAAACAIAAACAAAAgAAAIAgAAAIAAACAAAAgCAAAAgAAAIAAACAIAAACAAAAgAAAIAgAAAIAAACAAAAgCAAAAIAAACAIAAACAAAAgAAAIAgAAAIAAACAAAAgCAAAAgAAAIAAACAIAAACAAAAgAAAIAgAAAIAAACAAAAgCAAAAgAAACAIAAACAAAAgAAAIAgAAAIAAACAAAAgCAAAAgAAAIAAACAIAAACAAAAgAAAIAgAAAIAAACAAAAgCAAAAgAAACAIAAACAAAAgAAAIAgAAAIAAACAAAAgCAAAAgAAAIAAACAIAAACAAAAgAAAIAgAAAIAAACAAAAgCAAAAgAACcdqJb1vjbq2YAAAAASUVORK5CYII=';
  var svg = ''
    + '<svg width="0" height="0" style="position:absolute;pointer-events:none" aria-hidden="true">'
    + '<defs>'
    // 标准折射：位移贴图 + 高光
    + '<filter id="lg-refract" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB">'
    + '  <feImage href="' + MAP + '" result="map" preserveAspectRatio="none"/>'
    + '  <feDisplacementMap in="SourceGraphic" in2="map" scale="9" xChannelSelector="R" yChannelSelector="G" result="disp"/>'
    + '  <feColorMatrix in="disp" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0"/>'
    + '</filter>'
    // 带色散（彩边）：蓝/红通道各自位移不同，最后相加
    + '<filter id="lg-refract-ca" x="-12%" y="-12%" width="124%" height="124%" color-interpolation-filters="sRGB">'
    + '  <feImage href="' + MAP + '" result="map" preserveAspectRatio="none"/>'
    + '  <feDisplacementMap in="SourceGraphic" in2="map" scale="7" xChannelSelector="R" yChannelSelector="G" result="d1"/>'
    + '  <feColorMatrix in="d1" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="red"/>'
    + '  <feDisplacementMap in="SourceGraphic" in2="map" scale="13" xChannelSelector="R" yChannelSelector="G" result="d2"/>'
    + '  <feColorMatrix in="d2" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0" result="gb"/>'
    + '  <feBlend in="red" in2="gb" mode="screen"/>'
    + '</filter>'
    + '</defs></svg>';

  function inject() {
    if (document.getElementById('lg-svg')) return;
    var d = document.createElement('div');
    d.id = 'lg-svg';
    d.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    d.innerHTML = svg;
    document.body.appendChild(d);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject);
  else inject();
})();
