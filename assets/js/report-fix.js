/* 导出报告打开后的排版修正：卡片防重叠、页面高度贴合内容。
 * 独立成同源文件，是为了在严格 CSP（script-src 'self'）下仍能执行：
 * 导出文档里若用内联脚本会被拦截，卡片位置错乱会导致截图失败。
 * v2：新增文本原稿板（.text-board）支持——批注卡按对应句子的
 *     实际 offsetTop 对齐，纸面高度随正文自然增长。 */
(function () {
  function stack(cs, H, GAPMIN, GAPMAX, want) {
    var hs = cs.map(function (c) { return c.offsetHeight; });
    if (!cs.length) return { hs: hs, tops: [], need: 0 };
    var total = hs.reduce(function (a, b) { return a + b; }, 0);
    var needMin = total + GAPMIN * (cs.length - 1);
    var fits = needMin <= H;
    var tops = want.slice();
    var prev = -1e9;
    if (fits) {
      for (var i = 0; i < tops.length; i++) {
        if (tops[i] < prev + GAPMAX) tops[i] = prev + GAPMAX;
        if (tops[i] < 0) tops[i] = 0;
        prev = tops[i] + hs[i];
      }
      var o0 = prev - H;
      if (o0 > 0.5) {
        var s0 = Math.min(o0, tops[0]);
        if (s0 > 0) tops = tops.map(function (t) { return t - s0; });
      }
    } else {
      var acc = 0;
      for (var j = 0; j < tops.length; j++) { tops[j] = acc; acc = acc + hs[j] + GAPMIN; }
    }
    var need = Math.ceil(tops[tops.length - 1] + hs[hs.length - 1] + 8);
    return { hs: hs, tops: tops, need: need };
  }

  /* 元素的 offsetTop 换算到参照容器坐标系 */
  function topIn(el, ref) {
    var y = 0, n = el;
    while (n && n !== ref) { y += n.offsetTop; n = n.offsetParent; }
    return y;
  }

  function fixImage(bd) {
    var sheet = bd.querySelector('.esheet');
    var H = sheet ? sheet.offsetHeight : 0;
    if (!H) return;
    var maxCol = H, GAPMIN = 10, GAPMAX = 14;
    bd.querySelectorAll('.ecol').forEach(function (col) {
      var cs = [].slice.call(col.querySelectorAll('.ecard'));
      if (!cs.length) return;
      cs.forEach(function (c) { c.style.transform = 'none'; c.style.top = '0px'; });
      var want = cs.map(function (c) {
        var p = parseFloat(c.getAttribute('data-top')) || 0;
        return p / 100 * H - c.offsetHeight / 2;
      });
      var r = stack(cs, H, GAPMIN, GAPMAX, want);
      cs.forEach(function (c, i) { c.style.transform = 'none'; c.style.top = Math.round(r.tops[i]) + 'px'; });
      var ch = Math.max(H, r.need);
      col.style.height = ch + 'px';
      col.style.minHeight = ch + 'px';
      if (ch > maxCol) maxCol = ch;
    });
    if (sheet) { sheet.style.minHeight = ''; sheet.style.height = H + 'px'; }
    bd.style.minHeight = Math.max(H, maxCol) + 'px';
    /* 与文本板同理：白板高度按批注延伸后的实际高度撑开，
       保证 PDF 整页适配量高完整、打印不拆页 */
    bd.style.height = Math.max(H, maxCol) + 'px';
  }

  function fixText(bd) {
    var sheet = bd.querySelector('.tsheet');
    if (!sheet) return;
    /* 先还原自然高度再测量，避免上一次结果影响本次 */
    sheet.style.height = '';
    bd.style.minHeight = '';
    var H = sheet.offsetHeight;
    if (!H) return;
    var maxCol = H, GAPMIN = 10, GAPMAX = 14;
    bd.querySelectorAll('.tcol').forEach(function (col) {
      col.style.height = '';
      col.style.minHeight = '';
      var cs = [].slice.call(col.querySelectorAll('.tcard'));
      if (!cs.length) return;
      cs.forEach(function (c) { c.style.transform = 'none'; c.style.top = '0px'; });
      var want = cs.map(function (c) {
        var no = c.getAttribute('data-tno');
        var sent = no ? sheet.querySelector('.tsent[data-tno="' + no + '"]') : null;
        if (sent) return topIn(sent, sheet) + sent.offsetHeight / 2 - c.offsetHeight / 2;
        /* 整篇批注（无对应句子）：贴到正文末尾附近 */
        return H - c.offsetHeight - 6;
      });
      var r = stack(cs, H, GAPMIN, GAPMAX, want);
      cs.forEach(function (c, i) { c.style.transform = 'none'; c.style.top = Math.round(r.tops[i]) + 'px'; });
      var ch = Math.max(H, r.need);
      col.style.height = ch + 'px';
      col.style.minHeight = ch + 'px';
      if (ch > maxCol) maxCol = ch;
    });
    bd.style.minHeight = Math.max(H, maxCol) + 'px';
    /* 白板自身高度也要撑到批注延伸后的实际高度：
       否则 section 量高只按正文纸面算，PDF 整页适配会漏算卡片，
       打印时卡片溢出被拆到下一页。 */
    bd.style.height = Math.max(H, maxCol) + 'px';
    /* 排版完成标记：供一键导出 PDF 等待布局就绪 */
    bd.setAttribute('data-fixed', '1');
  }

  function fix() {
    document.querySelectorAll('.eboard').forEach(function (bd) {
      if (bd.classList.contains('text-board')) fixText(bd);
      else fixImage(bd);
    });
    fitBoards();
    try { document.documentElement.setAttribute('data-layout-done', '1'); } catch (e) {}
  }

  /* PDF 导出专用：图片原稿页铺满 A4。
   * 思路：三栏白板默认 972×796（宽高比 1.22）太「扁」，等比放大铺满页宽时
   * 只占页高 ~55%，下方大片空白。PDF 模式下重排比例——加大中间图片列、
   * 收窄批注卡列，让白板更高瘦；图片等比放大不裁切，批注卡仍两侧。
   * 步骤：① 改 CSS 变量重排 → ② 重新排卡（fixImage）→ ③ 量高，
   * 若仍超预算再整体 transform 缩小防拆页。屏幕 HTML 不受影响。 */
  var FIT_BUDGET = 1330;      /* 白板可用逻辑高度预算（扣页眉与余量） */
  var PDF_SW = 720;           /* PDF 图片列宽 */
  var PDF_CW = 165;           /* PDF 批注卡列宽（加宽容纳更大字号） */
  var PDF_GP = 14;            /* PDF 栏间距 */
  var PDF_ECFS = 15.5;        /* PDF 批注卡正文字号（屏幕默认 12） */

  function fitBoards() {
    if (!document.documentElement.classList.contains('pdf-export')) return;
    var maxBoardW = 0;
    document.querySelectorAll('.sheet-board').forEach(function (sh) {
      var bd = sh.querySelector('.eboard');
      if (!bd) return;
      /* 还原 transform，避免上次结果影响量高 */
      sh.style.transform = '';
      sh.style.transformOrigin = '';
      sh.style.marginBottom = '';
      /* 批注卡字号：PDF 单独放大（图片页与文本页都生效），
         子元素用 em 跟随，卡片整体协调变大 */
      bd.style.setProperty('--ecfs', PDF_ECFS + 'px');
      if (!bd.classList.contains('text-board')) {
        /* 图片页：重排为高瘦比例，图片等比放大 */
        bd.style.setProperty('--sw', PDF_SW + 'px');
        bd.style.setProperty('--cw', PDF_CW + 'px');
        bd.style.setProperty('--gp', PDF_GP + 'px');
        /* 先清掉 fix() 锁死的内联高度，让 esheet 的 calc(宽×比例) 生效，
           再量新纸面高度；否则量到的还是旧宽度的高度 */
        var st = bd.querySelector('.esheet');
        if (st) { st.style.height = ''; st.style.minHeight = ''; }
        bd.style.height = '';
        bd.style.minHeight = '';
        bd.querySelectorAll('.ecol').forEach(function (c) { c.style.height = ''; c.style.minHeight = ''; });
        var newH = st ? st.offsetHeight : 0;
        bd.querySelectorAll('.ecol').forEach(function (c) { c.style.height = newH + 'px'; });
        bd.style.minHeight = newH + 'px';
        fixImage(bd);   /* 按新纸面高度 + 新字号重新排卡 */
      } else {
        /* 文本页：字号变大后卡片更高，重新排卡防重叠 */
        fixText(bd);
      }
      /* 整页防拆：超高才整体缩小（transform 打印管线保留）。
         字号放大后若某页批注特别多导致超高，这里自动微缩兜底，
         保证一页装得下、不拆页。 */
      var h = sh.offsetHeight;
      if (!h) return;
      var fit = FIT_BUDGET / h;
      if (fit < 1) {
        sh.style.transform = 'scale(' + fit.toFixed(4) + ')';
        sh.style.transformOrigin = 'top center';
        sh.style.marginBottom = Math.round(h * (fit - 1)) + 'px';
      }
      var bw = bd.offsetWidth;
      if (bw > maxBoardW) maxBoardW = bw;
    });
    /* 文档宽跟随最宽白板（printToPDF 前主进程会用 CDP 把视口设为文档宽，
       打印按视口缩放，白板即可完整铺满页宽、两侧批注不越界） */
    var doc = document.querySelector('.doc');
    if (doc && maxBoardW > 1032) doc.style.minWidth = maxBoardW + 'px';
  }
  /* 供 PDF 主进程在 printToPDF 前调用：进入 PDF 模式并重新适配 */
  window.__zpPdfFit = function () {
    document.documentElement.classList.add('pdf-export');
    fitBoards();
    return true;
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fix);
  } else { fix(); }
  window.addEventListener('load', fix);
})();