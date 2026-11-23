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
    /* 纸面高度 = 正文自然高度。批注列只向两侧延伸，不反向拉长纸面：
       此前 col 取 max(H, 卡片总高) 再配合 align-items:stretch，
       会把纸面一起撑到 3000+px，正文只占顶上 1/4，页面大面积空白。 */
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
        return H - c.offsetHeight - 6;
      });
      var r = stack(cs, H, GAPMIN, GAPMAX, want);
      cs.forEach(function (c, i) { c.style.transform = 'none'; c.style.top = Math.round(r.tops[i]) + 'px'; });
      var ch = Math.max(H, r.need);
      col.style.height = ch + 'px';
      col.style.minHeight = ch + 'px';
      if (ch > maxCol) maxCol = ch;
    });
    /* 纸面钉住自然高度（不随批注列变高）；白板高度取两者较大值，
       以便卡片多时整块仍被完整包住、不被下一段压过来。 */
    sheet.style.height = H + 'px';
    bd.style.minHeight = Math.max(H, maxCol) + 'px';
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
  /* 批注卡字号比正文小一号，形成「原文大、批注小」的层次：
     正文 19/17.5/16.5/15.5/14.5，批注 16.5/15/14.5/13.5/12.5，各档差 2.5px */
  var PDF_ECFS = 16.5;        /* PDF 批注卡正文字号（比正文小一号） */
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
        /* 文本板 PDF 流式重排：把批注块插到对应段落之后，
           正文全宽 + 批注两卡一行，自然分页、字号正常、无大片空白。
           （三栏绝对定位在批注多时会把整板撑得极高，整页适配缩到 3pt 字） */
        var body = bd.querySelector('.t-body');
        if (body) {
          bd.querySelectorAll('.tflow').forEach(function (fl) {
            var pi = parseInt(fl.getAttribute('data-after-pi'), 10);
            if (pi >= 0) {
              var p = body.querySelector('p[data-pi="' + pi + '"]');
              if (p && p.nextSibling !== fl) p.parentNode.insertBefore(fl, p.nextSibling);
            } else {
              body.appendChild(fl);   /* 整篇批注挂文末 */
            }
          });
          /* 整篇批注（.tloose）保留：流式下它就是正文末尾的紧凑附注，
             没有卡片副本，无需隐藏。 */
        }
        /* 关键：清掉首次排版（非 PDF 三栏模式）写死的固定高度。
           否则 tsheet 被 align-items:stretch 撑成旧高度，流式正文
           溢出纸面、末尾批注块压到下一张 sheet 的标题上。 */
        bd.style.height = '';
        bd.style.minHeight = '';
        var ts = bd.querySelector('.tsheet');
        if (ts) { ts.style.height = ''; ts.style.minHeight = ''; }
        /* 流式板不做整页 transform 缩放（理由见下方第二遍注释）：
           字号在第二遍按页数与末页填充率逐档挑选，最低仍有 13.5px，
           远高于旧方案整页缩放后的 3pt。 */
        var w0 = bd.offsetWidth, h0 = sh.offsetHeight;
        if (w0 > maxBoardW) maxBoardW = w0;
        boards.push({ sh: sh, bd: bd, w: w0, h: h0, flow: true, tbody: tbody });
        return;
      }
      var w = bd.offsetWidth, h = sh.offsetHeight;
      if (w > maxBoardW) maxBoardW = w;
      boards.push({ sh: sh, bd: bd, w: w, h: h });
    });
    /* 报告四页也纳入适配：此前只遍历原稿白板，概览页加入错别字汇总后
       轻微溢出就被拆成「上一页 96% + 本页两行」的碎片页。 */
    document.querySelectorAll('.doc .sheet').forEach(function (sh) {
      if (sh.classList.contains('sheet-board')) return;
      sh.style.transform = '';
      sh.style.transformOrigin = '';
      sh.style.marginBottom = '';
      boards.push({ sh: sh, normal: true, h: sh.offsetHeight });
    });

    /* 文档宽跟随最宽白板（原始宽）：主进程 CDP 视口=文档宽，
       打印管线按视口把整页缩到页宽，白板恰好铺满页宽、两侧批注不越界。
       原稿页不做放大（MAX_FIT=1.0）：放大需同步扩视口，易与分页管线
       相互作用导致错位/裁切；铺满由「重排高瘦比例 + 视口缩放」保证。 */
    var MAX_FIT = 1.0;
    var doc = document.querySelector('.doc');
    var docW = Math.max(1032, maxBoardW);
    if (doc && maxBoardW > 1032) doc.style.minWidth = maxBoardW + 'px';
    /* 真实打印比例：printToPDF 按「可印区宽度 / 文档宽」缩放。
       此前用 PAGE_W_PX(733)/docW 得到 0.71，比实际的 0.534 偏大 33%，
       于是「可用高度」被高估（1368px 恰好等于估出来的上限），
       所有超高页都判定为「刚好放得下」，永远不触发压缩与分页修正。 */
    var viewportScale = (PAGE_W_PX - 40) / docW;

    /* 第二遍：处理超高页。
       · 图片白板：整体 transform 缩小防拆（transform 内联写入，
         margin-bottom 补偿占位差），保证三栏完整落在一页内。
       · 文本板（flow）：不能靠 transform——它不改变布局高度，
         视觉压小了分页仍按原高度拆。改为逐档收字号减少页数。 */
    boards.forEach(function (b) {
      if (!b.h) return;
      if (b.normal) {
        /* 报告页轻微溢出（≥0.90）用 zoom 压进一页。
           不能用 transform：它只改绘制、不改布局高度，分页仍按原高度切，
           结果就是「上一页占满 + 下一页只剩一行」的碎片页（实测概览页
           加了错别字汇总后必然出现）。zoom 同时改布局与绘制。 */
        var availN = (PAGE_H_PX - HEAD_RESERVE) / viewportScale;
        var fitN = availN / b.h;
        /* 0.85：错别字汇总并入「写作建议」后该页常到 0.88 左右，
           阈值放 0.90 会漏掉这类轻微溢出、退回碎片页。 */
        if (fitN < 1.0 && fitN >= 0.85) {
          b.sh.style.zoom = fitN.toFixed(4);
        } else if (fitN < 0.85 && b.sh.previousElementSibling &&
                   b.sh.previousElementSibling.classList.contains('sheet')) {
          /* 溢出太多不强缩（会看不清），让本页从新页开始 */
          b.sh.style.setProperty('break-before', 'page');
        }
        return;
      }
      var reserve = HEAD_RESERVE;
      var prev = b.sh.previousElementSibling;
      var dh = document.querySelector('.doc-head');
      /* doc-head 已并入第一张 sheet 时，其高度已计入 b.h，不能再重复预留 */
      if (b.sh.contains(dh)) {
        reserve = 24;
      } else if (!prev || !prev.classList.contains('sheet')) {
        if (dh) reserve += dh.offsetHeight + 12;
      }
      var target = PAGE_H_PX - reserve;

      if (b.flow) {
        /* 流式文本板：按「正文 + 批注块」自然分页。
           目标不是死压一页（批注多时会把字缩到看不清），而是
           ① 在字号仍可读的前提下尽量减少页数；② 让末页不留大片空白。
           做法：逐档试字号（同时收紧行距），取「页数最少、字号最大」的那一档。
           availPx 已换算到文档坐标系，与 b.sh.offsetHeight 同一口径。 */
        var availPx = target / viewportScale - 70;   /* 70px 留给分页避让余量 */
        if (availPx < 400) availPx = 400;
        var bd = b.bd, body = b.tbody;
        /* 每档「正文 / 批注 / 行距」：批注始终比正文小 2.5px，
           靠字号差把批注与原文分开；字号下限 12.5px（换算约 9pt，仍可读）。 */
        var steps = [
          [19, 16.5, 2.05],
          [17.5, 15, 2.0],
          [16.5, 14, 1.95],
          [15.5, 13, 1.9],
          [14.5, 12.5, 1.85]
        ];
        var best = null;
        for (var si = 0; si < steps.length; si++) {
          var tfs = steps[si][0], ecfs = steps[si][1], lh = steps[si][2];
          if (body) { body.style.fontSize = tfs + "px"; body.style.lineHeight = lh; }
          bd.style.setProperty("--ecfs", ecfs + "px");
          var hh = b.sh.offsetHeight;
          var pages = Math.ceil(hh / availPx);
          /* 末页填充率：越接近 1 越好，低于 0.45 说明那一页几乎是空的 */
          var lastFill = (hh - (pages - 1) * availPx) / availPx;
          if (!best || pages < best.pages ||
              (pages === best.pages && lastFill > best.fill)) {
            best = { pages: pages, h: hh, fill: lastFill, tfs: tfs, ecfs: ecfs, lh: lh };
          }
          /* 首个能把页数压到 1 的档位即最优（字号只会更小，无需再试） */
          if (pages === 1) break;
        }
        if (body) { body.style.fontSize = best.tfs + "px"; body.style.lineHeight = best.lh; }
        bd.style.setProperty("--ecfs", best.ecfs + "px");
        b.h = b.sh.offsetHeight;
        return;
      }

      var fit = target / (b.h * viewportScale);
      if (fit > MAX_FIT) fit = MAX_FIT;
      /* 轻微溢出（≥0.80）整体缩放收进一页，避免「上一页占用 96%、
         本页只有两行」的碎片页；溢出更多时保持自然分页，不强缩。 */
      if (fit < 0.98 && fit >= 0.80) {
        b.sh.style.transform = 'scale(' + fit.toFixed(4) + ')';
        b.sh.style.transformOrigin = 'top center';
        b.sh.style.marginBottom = Math.round(b.h * (fit - 1)) + 'px';
      } else if (fit < 0.98 && fit < 0.80 && b.sh.previousElementSibling &&
                 b.sh.previousElementSibling.classList.contains('sheet')) {
        /* 无法收进一页：让本页从新页开始，别在上一页尾部留残行 */
        b.sh.style.setProperty('break-before', 'page');
      }
    });
  }
  /* 供 PDF 主进程在 printToPDF 前调用：进入 PDF 模式并重新适配 */
  window.__zpPdfFit = function () {
    document.documentElement.classList.add('pdf-export');
    /* 总标题并入第一张 sheet：避免 doc-head 独占一页（94% 空白）。
       把 doc-head 移到第一个 sheet 的 sheet-head 之前。 */
    var dh = document.querySelector('.doc-head');
    var first = document.querySelector('.doc .sheet');
    if (dh && first && dh.parentNode !== first) {
      first.insertBefore(dh, first.firstChild);
    }
    fitBoards();
    return true;
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fix);
  } else { fix(); }
  window.addEventListener('load', fix);
})();