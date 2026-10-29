/* ========== 通用小工具 ========== */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function safeSrc(s) {
  return /^(data:image\/(png|jpeg|jpg|webp|gif);base64,|https?:\/\/)/i.test(s || '') ? s : '';
}
function copyText(text, tip) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(
      () => alert('已复制到剪贴板。\n' + tip),
      () => prompt('自动复制失败，请长按全选手动复制：', text)
    );
  } else {
    prompt('请长按全选手动复制下面的代码：', text);
  }
}
/* 图片压缩工具：留言板头像压缩用（作品集已改成传原图，不压缩） */
function compressImage(file, maxEdge, quality) {
  return new Promise((resolve, reject) => {
    if (!file.type || file.type.indexOf('image/') !== 0) return reject(new Error('这不是图片文件'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      resolve(cv.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片解码失败（HEIC 请先在相册里转成 JPG 再上传）'));
    };
    img.src = url;
  });
}
