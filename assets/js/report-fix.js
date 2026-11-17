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

  /* PDF 导出专用：原稿页整页自适应铺满 A4（既缩也放）。
   * 页边距 8mm → 可印区约 733×1062px（96dpi）。
   * 目标：白板等比缩放到「宽 ≤ 可印宽 且 高 ≤ 可印高」的最大比例，
   * 一张图/一篇原文连同两侧批注完整占满一页，不拆页、不留大空白。
   * 原稿页字号独立：作文正文与批注卡都比报告正文更大（PDF_ECFS/PDF_TFS）。
   * 实现：transform:scale 内联写入（Chromium 打印管线重置 zoom，
   * @media print 不稳定），margin-bottom 补偿占位高度差。 */
  var PAGE_W_PX = 733;        /* A4 宽 210mm - 16mm 边距 ≈ 733px */
  var PAGE_H_PX = 1062;       /* A4 高 297mm - 16mm 边距 ≈ 1062px */
  var HEAD_RESERVE = 90;      /* 页眉（sheet-head）预留高度 */
  var PDF_SW = 780;           /* PDF 图片列基准宽（重排用） */
  var PDF_CW = 150;           /* PDF 批注卡列宽（容纳大字号） */
  var PDF_GP = 12;            /* PDF 栏间距 */
  var PDF_ECFS = 17;          /* PDF 批注卡正文字号（独立，大于报告正文） */
  var PDF_TFS = 19;           /* PDF 原稿作文字号（文本板独立） */

  function fitBoards() {
    if (!document.documentElement.classList.contains('pdf-export')) return;
    /* 第一遍：重排 + 排卡，量出各白板原始尺寸，确定文档宽 */
    var boards = [];
    var maxBoardW = 0;
    document.querySelectorAll('.sheet-board').forEach(function (sh) {
      var bd = sh.querySelector('.eboard');
      if (!bd) return;
      sh.style.transform = '';
      sh.style.transformOrigin = '';
      sh.style.marginBottom = '';
      /* 原稿页独立字号：批注卡 + 作文正文都放大 */
      bd.style.setProperty('--ecfs', PDF_ECFS + 'px');
      var tbody = bd.querySelector('.t-body');
      if (tbody) tbody.style.fontSize = PDF_TFS + 'px';
      if (!bd.classList.contains('text-board')) {
        bd.style.setProperty('--sw', PDF_SW + 'px');
        bd.style.setProperty('--cw', PDF_CW + 'px');
        bd.style.setProperty('--gp', PDF_GP + 'px');
        var st = bd.querySelector('.esheet');
        if (st) { st.style.height = ''; st.style.minHeight = ''; }
        bd.style.height = '';
        bd.style.minHeight = '';
        bd.querySelectorAll('.ecol').forEach(function (c) { c.style.height = ''; c.style.minHeight = ''; });
        var newH = st ? st.offsetHeight : 0;
        bd.querySelectorAll('.ecol').forEach(function (c) { c.style.height = newH + 'px'; });
        bd.style.minHeight = newH + 'px';
        fixImage(bd);
      } else {
        fixText(bd);
      }
      var w = bd.offsetWidth, h = sh.offsetHeight;
      if (w > maxBoardW) maxBoardW = w;
      boards.push({ sh: sh, bd: bd, w: w, h: h });
    });
    /* 文档宽跟随最宽白板（原始宽）：主进程 CDP 视口=文档宽，
       打印管线按视口把整页缩到页宽，白板恰好铺满页宽、两侧批注不越界。
       原稿页不做放大（MAX_FIT=1.0）：放大需同步扩视口，易与分页管线
       相互作用导致错位/裁切；铺满由「重排高瘦比例 + 视口缩放」保证。 */
    var MAX_FIT = 1.0;
    var doc = document.querySelector('.doc');
    var docW = Math.max(1032, maxBoardW);
    if (doc && maxBoardW > 1032) doc.style.minWidth = maxBoardW + 'px';
    var viewportScale = PAGE_W_PX / docW;

    /* 第二遍：超高页整体缩小防拆（最终高 = h × fit × viewportScale ≤ 可印高）。
       transform 内联写入，margin-bottom 补偿占位差。 */
    boards.forEach(function (b) {
      if (!b.h) return;
      var reserve = HEAD_RESERVE;
      var prev = b.sh.previousElementSibling;
      if (!prev || !prev.classList.contains('sheet')) {
        var dh = document.querySelector('.doc-head');
        if (dh) reserve += dh.offsetHeight + 12;
      }
      var target = PAGE_H_PX - reserve;
      var fit = target / (b.h * viewportScale);
      if (fit > MAX_FIT) fit = MAX_FIT;
      if (fit < 0.98) {
        b.sh.style.transform = 'scale(' + fit.toFixed(4) + ')';
        b.sh.style.transformOrigin = 'top center';
        b.sh.style.marginBottom = Math.round(b.h * (fit - 1)) + 'px';
      }
    });
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