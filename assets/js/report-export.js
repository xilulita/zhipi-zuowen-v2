/* ============================================================
   笔墨生香 · 报告导出（所见即所得）
   ------------------------------------------------------------
   设计目标：
   1) 白板与软件中间画板同一套三栏布局（左卡—原稿—右卡），不按 A4 硬塞
   2) 页面宽度随内容自适应，保证两侧批注完整可见，不被裁切
   3) 多页原稿：第 1 页、第 2 页…各自独立成页，顺序优先
   4) 报告四个 Tab 各自独立分页；单页装不下时自动续页
   5) 沿用软件里的背景、卡片、配色，排版规整
   6) 导出的是屏幕上的最终位置（含人工微调），所见即所得
   ============================================================ */
(function (ZP) {
  "use strict";

  var NL = String.fromCharCode(10);

  function esc(t) {
    return String(t == null ? "" : t).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  /* 允许批注里极少量内联标记：<del>/<ins>/<b>，与界面 render.js 的 rich() 同规则。
     改写示例常写成「改成：<del>原文</del><ins>改写</ins>」，
     直接 esc 会把标签当普通文字显示出来（实测卡片里出现 &lt;del&gt; 字面量）。 */
  function rich(t) {
    return esc(t)
      .replace(/&lt;(\/?)(del|ins|b)&gt;/g, function (m, slash, tag) {
        return "<" + slash + tag + ">";
      });
  }

  /* 四维配色：与界面同一套暖色阶梯 */
  var DIM_COLORS = {
    content: "#a8452f",
    structure: "#c07a33",
    language: "#6e7f4b",
    norm: "#8a6b7d"
  };

  /* 批注类型色（沿用界面） */
  var TYPE_COLORS = {
    red: "#cf4436", amber: "#d1952a", green: "#2f8f6b", violet: "#7a5cc4"
  };

  /* ---------------- 版式参数（与软件画板对齐） ---------------- */
  var L = {
    cardW: 200,        /* 批注卡宽 */
    gap: 26,           /* 卡与纸面的留白 */
    sheetW: 520,       /* 纸面宽 */
    padX: 30,          /* 页面左右安全边距 */
    padY: 34           /* 页面上下安全边距 */
  };
  L.boardW = L.cardW * 2 + L.gap * 2 + L.sheetW;   /* 972 */

  /* 导出页的固定逻辑宽度：白板宽度 + 两侧安全边距 */
  var PAGE_W = L.boardW + L.padX * 2;

  /* 打印缩放：A4（210mm）减去左右边距 10mm×2 后可印区约 190mm ≈ 718px，
     报告逻辑宽 PAGE_W=1032px，等比缩放到页宽，版式与屏幕一致 */
  var PRINT_SCALE = (718 / PAGE_W).toFixed(4);

  /* ---------------- 基础样式 ---------------- */
  function baseCss() {
    return ""
      + "*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}"
      + "body{margin:0;background:#f3f0e9;font-family:'PingFang SC','Microsoft YaHei',sans-serif;"
      +   "color:#2b3038;font-size:18px;line-height:1.75}"
      /* 每页独立成块，打印时各自一页 */
      /* 不分页：所有内容放进同一张长文档，一次性连续展示 */
      + ".doc{width:" + PAGE_W + "px;margin:0 auto;background:#fffdf9;"
      +   "border:1px solid #e7e3da;border-radius:10px;"
      +   "padding:" + L.padY + "px " + L.padX + "px}"
      /* 文档总标题 */
      + ".doc-head{margin:0 0 22px;text-align:center}"
      + ".doc-head h1{margin:0;font-size:26px;font-weight:650;letter-spacing:.14em;color:#2b3038}"
      + ".doc-meta{margin-top:7px;font-size:11px;color:#a9a293;letter-spacing:.04em}"
      + ".sheet{width:100%;margin:0;padding:0;background:transparent;border:0}"
      /* 段落之间用分隔线隔开（原来靠分页区分） */
      + ".sheet + .sheet{margin-top:26px;padding-top:24px;border-top:1px solid #eee5d5}"
      /* 页眉 */
      + ".sheet-head{display:flex;align-items:flex-end;justify-content:space-between;"
      +   "gap:14px;padding-bottom:2px;margin-bottom:14px}"
      + ".sheet-head h2{margin:0;font-size:19px;letter-spacing:.1em;color:#2b3038}"
      + ".sheet-head .sh-sub{font-size:10.5px;color:#a9a293;letter-spacing:.04em}"
      + ".sheet-head .sh-tag{font-size:10px;color:#8d8477;flex:0 0 auto}"
      /* ---- 打印 / 另存为 PDF ----
         每张 sheet 独立成页；卡片、图表、表格避免被横切。
         注意：Chromium 打印管线会重置 CSS zoom，整体缩放交给
         printToPDF 的 scale 参数（主进程）、浏览器打印交给
         transform 方案（见 html.pdf-export 规则），这里不写 zoom。
         页边距收窄到 8mm：两侧空白尽量少，内容铺满页宽。 */
      + "@page{size:A4;margin:8mm}"
      + "@media print{"
      +   "html,body{background:#fff !important}"
      +   "body{-webkit-print-color-adjust:exact;print-color-adjust:exact}"
      +   ".doc{border:0;border-radius:0;width:auto;min-width:" + PAGE_W + "px;padding:0;box-shadow:none;background:#fff}"
      /* 总标题并入第一张 sheet 同页：不再单独占一行导致
         「第一页只有标题、第二页空白、第三页才是内容」 */
      +   ".doc-head{margin:0 0 12px;text-align:left}"
      +   ".doc-head h1{font-size:20px;letter-spacing:.1em}"
      +   ".doc-meta{margin-top:3px}"
      +   ".sheet{break-inside:auto;page-break-inside:auto}"
      /* 除最后一张外，每张报告分段另起一页 */
      +   ".sheet + .sheet{break-before:page;page-break-before:always;"
      +     "margin-top:0;padding-top:0;border-top:0}"
      /* 原稿白板：图片板三栏必须整体同页；文本板 PDF 走流式布局，
         允许自然分页（批注多时不硬缩成小字） */
      +   ".sheet-board{break-inside:avoid-page;page-break-inside:avoid}"
      +   ".eboard,.ecol,.esheet{break-inside:avoid-page;page-break-inside:avoid}"
      +   ".text-sheet,.text-board,.text-board .eboard,.text-board .tsheet{"
      +     "break-inside:auto;page-break-inside:auto}"
      +   ".text-board .t-body p{break-inside:avoid;page-break-inside:avoid}"
      /* 批注卡允许在页内自然排布（整板已 avoid，卡不再单独 avoid，
         避免「板放不下→整体推下页→前页大片空白」） */
      +   ".drill,.issue,.card,.pol,.hero,.tk-legend,.tech,.tip-card,img{"
      +     "break-inside:avoid;page-break-inside:avoid}"
      +   ".blk-head{break-after:avoid;page-break-after:avoid}"
      +   ".radar{max-width:200px}"
      +   "a{color:inherit;text-decoration:none}"
      + "}"
      /* ---- PDF 专用：原稿页整页适配 ----
         适配由排版脚本 __zpPdfFit 直接写内联 transform:scale +
         margin-bottom 补偿完成（Chromium 打印管线会重置 zoom、
         @media print 规则在 printToPDF 路径下不稳定，内联最可靠）。
         此处只保留超高页防拆规则。 */
      + "@media print{"
      +   "html.pdf-export .sheet-board{break-inside:avoid-page;page-break-inside:avoid}"
      +   ".text-sheet{break-inside:auto;page-break-inside:auto}"
      +   ".text-board{break-inside:auto;page-break-inside:auto}"
      + "}";
  }

  /* ============================================================
     一、原稿批注白板（每页原稿一张）
     ============================================================ */
  function sheetPage(res, opt) {
    var images = opt.images || [];
    var page = opt.page || 0;
    var total = opt.total || 1;
    var all = (res && res.annotations) || [];
    var anns = all.filter(function (a) { return (a.page || 0) === page; });
    if (!anns.length && all.length && !all.some(function (a) { return a.page !== undefined; })) anns = all;

    var img = images[page];
    if (!img || !img.dataUrl) return "";

    var ratio = (img.width && img.height) ? (img.height / img.width) : 1.414;
    var sheetH = Math.round(L.sheetW * ratio);

    /* 左右交替 */
    var leftList = [], rightList = [];
    anns.forEach(function (a, i) {
      var pos = ZP.Render.boardPos(a, res);
      var item = {
        a: a,
        no: (all.indexOf(a) >= 0 ? all.indexOf(a) : i) + 1,
        pos: pos,
        color: ZP.Render.typeColor(a.type)
      };
      (i % 2 === 0 ? leftList : rightList).push(item);
    });

    /* 卡片：绝对定位到各自划线高度；导出时由脚本按真实高度推开防重叠 */
    function card(it) {
      var isRed = it.a.type === "red";
      var fixTxt = String(it.a.fix || "").trim();
      return '<div class="ecard ' + (isRed ? "is-red" : "") + '"' +
          ' data-top="' + it.pos.y.toFixed(2) + '"' +
          ' style="border-left-color:' + it.color + '">' +
          '<span class="ecard-no" style="background:' + it.color + '">' + it.no + "</span>" +
          '<div class="ecard-tag" style="color:' + it.color + '">' +
            esc(it.a.tag || "") + "</div>" +
          '<div class="ecard-note">' + rich(it.a.note || "") + "</div>" +
          (fixTxt ? '<div class="ecard-fix' + (isRed ? " fix-short" : "") + '"><i>' +
            (isRed ? "正确写法" : "改写例句") + "</i>" + rich(fixTxt) + "</div>" : "") +
        "</div>";
    }

    /* 荧光条 + 编号（坐标基于图片自身） */
    var bands = anns.map(function (a, i) {
      var pos = ZP.Render.boardPos(a, res);
      var w = Math.max(6, Math.min(100 - pos.x1, pos.x2 - pos.x1));
      var goLeft = (i % 2 === 0);
      var NUM = 5.0;
      var nx = goLeft
        ? Math.max(0.5, Math.min(100 - NUM - 0.5, pos.x1 - NUM * 0.55))
        : Math.max(0.5, Math.min(100 - NUM - 0.5, pos.x2 - NUM * 0.45));
      return '<div class="eband type-' + a.type + '" style="top:' + pos.y.toFixed(2) + "%;left:" +
          pos.x1.toFixed(2) + "%;width:" + w.toFixed(2) + '%"></div>' +
        '<div class="enum type-' + a.type + '" style="top:' + pos.y.toFixed(2) + "%;left:" +
          nx.toFixed(2) + '%">' + ((all.indexOf(a) >= 0 ? all.indexOf(a) : i) + 1) + "</div>";
    }).join("");

    /* 尺寸用 CSS 变量驱动：屏幕 HTML 用默认值（与软件画板一致），
       PDF 模式由排版脚本改写变量——加大图片列、收窄批注列，
       让白板更高瘦以铺满 A4 高度（图片等比不裁切）。 */
    var css = ""
      + ".eboard{--sw:" + L.sheetW + "px;--cw:" + L.cardW + "px;--gp:" + L.gap + "px;"
      +   "position:relative;display:flex;align-items:flex-start;gap:var(--gp);"
      +   "width:calc(var(--sw) + var(--cw)*2 + var(--gp)*2);"
      +   "min-width:calc(var(--sw) + var(--cw)*2 + var(--gp)*2);margin:0 auto;"
      +   "min-height:" + sheetH + "px}"
      + ".ecol{position:relative;flex:0 0 var(--cw);width:var(--cw);height:" + sheetH + "px}"
      + ".esheet{position:relative;flex:0 0 var(--sw);width:var(--sw);"
      +   "height:calc(var(--sw)*" + ratio.toFixed(4) + ");"
      +   "background:#fff;border:1px solid #e6e0d2;border-radius:2px;overflow:hidden;"
      +   "box-shadow:0 10px 28px -20px rgba(30,26,18,.5)}"
      + ".esheet img{display:block;width:100%;height:100%;object-fit:contain}"
      + ".eband{position:absolute;height:9px;border-radius:5px;transform:translateY(-50%)}"
      + ".eband.type-red{background:linear-gradient(90deg,rgba(224,74,60,.45),rgba(224,74,60,.26))}"
      + ".eband.type-amber{background:linear-gradient(90deg,rgba(240,186,52,.6),rgba(240,186,52,.32))}"
      + ".eband.type-green{background:linear-gradient(90deg,rgba(58,166,120,.48),rgba(58,166,120,.26))}"
      + ".eband.type-violet{background:linear-gradient(90deg,rgba(140,110,214,.48),rgba(140,110,214,.26))}"
      + ".enum{position:absolute;transform:translateY(-50%);min-width:15px;height:15px;padding:0 3px;"
      +   "display:flex;align-items:center;justify-content:center;border-radius:8px;color:#fff;"
      +   "font-family:ui-monospace,Menlo,Consolas,monospace;font-size:9px;font-weight:700;"
      +   "box-shadow:0 1px 4px rgba(20,22,26,.28)}"
      + ".enum.type-red{background:#cf4436}.enum.type-amber{background:#d99a24}"
      + ".enum.type-green{background:#2f8f6b}.enum.type-violet{background:#7a5cc4}"
      /* 批注卡：与软件里同一套观感 */
      + ".ecard{position:absolute;left:0;width:100%;transform:translateY(-50%);"
      +   "background:#fff;border:1px solid #ece6d8;border-left-width:2px;border-radius:8px;"
      +   "padding:9px 11px 10px;box-shadow:0 8px 20px -16px rgba(30,26,18,.5);"
      +   "font-size:var(--ecfs,14px);line-height:1.62}"
      + ".ecard-no{position:absolute;top:-6px;left:-6px;min-width:14px;height:14px;padding:0 3px;"
      +   "display:flex;align-items:center;justify-content:center;border-radius:7px;color:#fff;"
      +   "font-family:ui-monospace,Menlo,Consolas,monospace;font-size:8px;font-weight:700;"
      +   "box-shadow:0 1px 3px rgba(20,22,26,.25)}"
      + ".ecard-tag{font-size:.82em;font-weight:600;letter-spacing:.04em;margin-bottom:3px}"
      + ".ecard-note{color:#3f4652}"
      + ".ecard-fix{margin-top:6px;padding:5px 7px;background:#faf7ef;border-left:2px solid #dcc9a5;"
      +   "border-radius:0 4px 4px 0;font-size:.95em;line-height:1.55;color:#6b6047}"
      + ".ecard-fix i{display:block;font-style:normal;font-size:.8em;color:#a89e8b;margin-bottom:2px}"
      /* 改写示例里的「原文→改写」标记：删除线画掉原句，改写内容用底色强调 */
      + ".ecard-fix del,.ecard-note del{color:#a08f78;text-decoration:line-through;"
      +   "text-decoration-color:rgba(160,143,120,.55)}"
      + ".ecard-fix ins,.ecard-note ins{text-decoration:none;color:#8a3a24;"
      +   "background:#fdf1ec;border-bottom:1.5px solid rgba(207,68,54,.35);border-radius:2px;"
      +   "padding:0 1px}"
      + ".ecard-fix.fix-short{background:#fdf3f1;border-left-color:#d98b78;color:#8f3a25}"
      + ".ecard-fix.fix-short i{color:#a2492f}";

    /* 只在第一页显示标题；后续原稿页直接接续展示，不再重复“第 x / N 页” */
    var showHead = (page === 0);
    return '<section class="sheet sheet-board">' +
      (showHead
        ? '<div class="sheet-head">' +
            '<div><h2>原稿批注</h2>' +
              '<div class="sh-sub">' + esc(res.title || "作文") +
              (res.meta ? "　" + esc(res.meta) : "") + "</div></div>" +
          "</div>"
        : "") +
      '<style>' + css + "</style>" +
      '<div class="eboard">' +
        '<div class="ecol ecol-l">' + leftList.map(card).join("") + "</div>" +
        '<div class="esheet"><img src="' + img.dataUrl + '" alt="作文原稿">' + bands + "</div>" +
        '<div class="ecol ecol-r">' + rightList.map(card).join("") + "</div>" +
      "</div>" +
    "</section>";
  }

  /* ============================================================
     一-B、稿源文本批注页（粘贴正文批改时使用）
     ------------------------------------------------------------
     此前导出只有「图片白板」一种原稿页：文本批改没有 images，
     sheetPage 直接返回空串，导致导出报告缺失作文原文。
     这里补一张与软件画板同构的三栏页：左卡—原文—右卡，
     原文用荧光高亮 + 编号，句子↔批注的对齐复用界面同一套
     ZP.Render.matchMarks，保证导出与屏幕高亮一致。
     ============================================================ */
  function textSheetPage(res, opt) {
    opt = opt || {};
    var anns = (res && (res.annotations || res.annos)) || [];
    var rawParas = (res && (res.paragraphs || (res.essay && res.essay.paras))) || [];
    /* 段落兜底：老历史可能没存 paragraphs，用稿源文本现切 */
    if (!rawParas.length && opt.text) rawParas = ZP.splitParagraphs(opt.text);

    /* ★ 段内内嵌批注（sent.a）必须提出来，并补上 sentence = 该句原文。
       演示样例与「AI 分段结果」都是这种结构：真正精确的句子锚点只存在于
       段落句子里，而扁平 annotations 往往没有 sentence 字段。
       此前只拍平成字符串、丢弃 sent.a，matchMarks 找不到引句，
       整段被当成一条标记 → 正文划满整段线、其余批注全掉进「整篇批注」，
       甚至出现整段正文凭空消失。 */
    var embedded = [];
    if (rawParas.length && Array.isArray(rawParas[0])) {
      rawParas.forEach(function (sentArr, pi) {
        if (!Array.isArray(sentArr)) return;
        sentArr.forEach(function (sent) {
          if (!sent || !sent.a) return;
          embedded.push({
            para: pi,
            type: sent.a.type,
            tag: sent.a.tag,
            sentence: String(sent.t || ""),
            note: sent.a.note,
            fix: sent.a.fix
          });
        });
      });
    }
    if (embedded.length) {
      /* 内嵌批注带精确句子，直接作为唯一来源。
         扁平 annotations 与它是「同一批批注的两套文案」（演示样例里
         内嵌版更详细、扁平版是精简版），混用会把 8 条渲染成 15 条，
         或按「段落+类型」判重误删同段的第 3 条。
         只保留扁平里段落没有内嵌批注的那些（整篇级、旧数据）。 */
      var paraHasEmbed = {};
      embedded.forEach(function (a) { paraHasEmbed[a.para | 0] = true; });
      var flatKeep = anns.filter(function (a) {
        if (typeof a.para !== "number") return true;     /* 整篇级批注，保留 */
        return !paraHasEmbed[a.para | 0];
      });
      anns = embedded.concat(flatKeep);
    }

    var paras = rawParas.map(function (p) {
      if (Array.isArray(p)) return p.map(function (s) { return s.t || ""; }).join("");
      return String(p);
    }).filter(function (t) { return t.trim(); });
    /* 稿源文本常把标题也当第一段粘进来：纸面上已有居中标题，
       再排一遍就成了「标题出现两次」。
       ★ 不能直接切掉这一段：批注的 para 是原始段落序号，
         slice(1) 会让后面所有批注整体错位到别的段落
         （实测卡片全数消失、角标错配）。这里只标记「本段不渲染」，
         段落序号保持不变。 */
    var skipPara = -1;
    var titleTxt = String((res && res.title) || "").trim();
    if (titleTxt && paras.length > 1) {
      var firstT = String(paras[0] || "").replace(/[\s　]/g, "");
      if (firstT === titleTxt.replace(/[\s　]/g, "")) skipPara = 0;
    }
    if (!paras.length) return "";

    /* ------------------------------------------------------------
       批注分两类，渲染位置不同：
       · 错别字（red）——不占正文旁批注位。原文句中只留彩色角标条，
                          汇总成表放在「全文概览」页。
       · 其余批注    ——照旧挂到对应段落之后（病句/润色/建议/好句）。
       所有条目共用同一套编号：先给能定位到句子的错别字编号（汇总表用），
       再给其余批注编号（旁批注用），保证两边编号互不冲突、
       与界面上「全文序号」的顺序一致。
       ------------------------------------------------------------ */
    var TYPO = "red";
    var typoList = [];        /* 汇总表条目：{no, a, sentence} */
    var typoMarkIdx = [];     /* 原文句子上的角标序号 */
    var items = [];           /* 旁批注卡：{a, no, paraIdx} */
    var paraNos = [];         /* 每段挂的卡编号 */

    /* 先定位每条批注落在哪个句子（与界面同一套 matchMarks 规则） */
    var marksByPara = paras.map(function (text, pi) {
      return ZP.Render.matchMarks(text, pi, anns);
    });

    /* 错别字编号不预先分配：只有真正画在原文上的才占号。
       预分配会把「整段兜底、最终跳过」的条目也算进去，
       导致正文角标出现断号（实测 1..5 之后直接跳到 7）。
       编号在下面渲染时按出现顺序分配，汇总表沿用同一批号。 */
    function typoNo(a) {
      for (var i = 0; i < typoMarkIdx.length; i++) {
        if (typoMarkIdx[i].a === a) return typoMarkIdx[i].no;
      }
      var no = typoMarkIdx.length + 1;
      typoMarkIdx.push({ a: a, no: no });
      typoList.push({ no: no, a: a, sentence: (a.sentence || a.quote || "").trim() });
      return no;
    }

    /* 卡片编号必须在渲染「之前」就知道错别字占了多少号，
       否则边渲染边累加，先出现的卡片会和后出现的角标撞号
       （实测卡片 3 与角标 3 重号）。这里预扫一遍，
       用与渲染完全相同的跳过条件统计实际会画出的角标数。 */
    var typoDrawCount = 0;
    marksByPara.forEach(function (marks, pi) {
      if (pi === skipPara) return;
      var text = paras[pi];
      marks.forEach(function (m) {
        if (m.a.type !== TYPO) return;
        if (m.start <= 2 && (m.end - m.start) >= text.length - 4 && !typoHit(text, m.a)) return;
        typoDrawCount++;
      });
    });

    /* 其余批注接着编号（界面顺序：错别字在前，与汇总表一致） */
    var paraHtml = paras.map(function (text, pi) {
      if (pi === skipPara) { paraNos.push([]); return ""; }
      var marks = marksByPara[pi];
      var html = "", cursor = 0, nos = [];
      marks.forEach(function (m) {
        if (m.start > cursor) html += esc(text.slice(cursor, m.start));
        var color = ZP.Render.typeColor(m.a.type);
        if (m.a.type === TYPO) {
          /* 角标条：句中留彩色标记 + 小数字，不建卡片。
             跨越整段时（模型常把整句当「错别字」引句）只标出真正
             出问题的词，否则整段刷红会被误读成「整段都是错字」。 */
          var tno = 0;
          /* ★ 整段级兜底标记不画：matchMarks 第 3 步在定位不到引句时
             会把「整段」当作一条标记（m.start=0, m.end=段落长度）。
             对错别字尤其有害——视觉上像「整段都是错字」，段尾还会
             多出一个孤立角标。这类批注只进概览页汇总表。 */
          if (m.start <= 2 && (m.end - m.start) >= text.length - 4) {
            /* 整段级标记分两种：
               · 批注能指明具体错词（fix/note 里点了字）→ 仍要标，
                 否则错别字在原文里彻底消失，只剩概览表可查；
               · 指不出错词、说明也是段落级的 → 属于 matchMarks 兜底，
                 整段划线会像「整段都是错字」，跳过、只留汇总表。 */
            var hitProbe = typoHit(text, m.a);
            if (!hitProbe) return;      /* forEach 内 continue */
            /* 能指到具体错词：只标那个词（见下方 pick 分支） */
          }
          tno = typoNo(m.a);
          var spanTxt = text.slice(m.start, m.end);
          var pick = typoHit(spanTxt, m.a);
          if (pick && pick.len < spanTxt.length) {
            /* 长跨度：正文保持原样，只在出问题的词上加下划线与角标 */
            html += esc(text.slice(m.start, m.start + pick.at)) +
              '<span class="tsent t-' + esc(m.a.type) + '" data-typo="' + tno + '">' +
              esc(spanTxt.substr(pick.at, pick.len)) + "</span>" +
              '<span class="tmark t-' + esc(m.a.type) + '" data-typo="' + tno + '">' + tno + "</span>" +
              esc(spanTxt.slice(pick.at + pick.len));
          } else {
            /* 退化为整段/整句标记时加 long：用细下划线代替整块底色，
               避免「整段刷红 = 整段都是错字」的误读。 */
            var isLong = spanTxt.length > 18;
            html += '<span class="tsent t-' + esc(m.a.type) +
              (isLong ? " t-long" : "") + '" data-typo="' + tno + '">' +
              esc(spanTxt) + "</span>" +
              '<span class="tmark t-' + esc(m.a.type) + '" data-typo="' + tno + '">' + tno + "</span>";
          }
        } else {
          /* 编号接在错别字之后：基数是预扫出的角标总数，保证不撞号 */
          var no = typoDrawCount + items.length + 1;
          items.push({ a: m.a, no: no, paraIdx: pi });
          nos.push(no);
          /* ★ 段落级兜底标记（matchMarks 第 3 步把整段当成一条）不画整段线：
             没有引句时它铺满整段，视觉上像「整段都要改」，段首还会多出
             一个孤立编号。这类批注只在段后挂卡片，正文不加任何标记。 */
          var whole = (m.start <= 2 && (m.end - m.start) >= text.length - 4);
          if (whole) {
            /* ★ 整段兜底标记虽然不划线，但正文必须原样输出。
               只跳过 span 而不补文本，会让 cursor 直接跳到段尾，
               整段正文凭空消失（实测第一段整段不见）。 */
            html += esc(text.slice(m.start, m.end));
          } else {
            /* 句子批注按正常荧光标记：不能因为句子长就降级成下划线——
               长句是它的正常范围，降级后会出现「荧光 + 尾部一条长虚线」的怪相。 */
            html += '<span class="tno" style="background:' + color + '">' + no + "</span>" +
              '<span class="tsent t-' + esc(m.a.type || "violet") + '" data-tno="' + no + '">' +
              esc(text.slice(m.start, m.end)) + "</span>";
          }
        }
        cursor = m.end;
      });
      if (cursor < text.length) html += esc(text.slice(cursor));
      paraNos.push(nos);
      return '<p data-pi="' + pi + '">' + html + "</p>";
    });   /* 注意：这里保留数组，稍后逐段拼接自己的批注块 */

    /* 未能定位到句子的批注：错别字进汇总表（无原句），其余进「整篇批注」 */
    var located = [];
    marksByPara.forEach(function (ms) { ms.forEach(function (m) { located.push(m.a); }); });
    var unplacedTypo = [], unplaced = [];
    anns.forEach(function (a) {
      if (located.indexOf(a) >= 0) return;
      if (a.type === TYPO) {
        typoList.push({ no: typoList.length + 1, a: a, sentence: (a.sentence || a.quote || "").trim() });
      } else {
        unplaced.push(a);
      }
    });
    /* 整篇批注（无对应句子）：紧凑列表，绝不铺成卡片——卡片会占
       200+px 把纸面撑高、并在两栏里重复一次。 */
    var looseHtml = unplaced.length
      ? '<div class="tloose"><span class="tloose-lb">整篇批注</span>' +
        unplaced.map(function (a) {
          var no = typoDrawCount + items.length + 1;
          items.push({ a: a, no: no, paraIdx: -1 });
          var color = ZP.Render.typeColor(a.type);
          return '<p><span class="tno" style="background:' + color + '">' + no + "</span>" +
            (a.sentence || a.quote ? "<q>" + esc(a.sentence || a.quote) + "</q> " : "") +
            rich(a.note || a.html || a.comment || "") +
            (a.fix ? "（" + rich(a.fix) + "）" : "") + "</p>";
        }).join("") + "</div>"
      : "";

    /* 左右交替：只排「有句子的批注」，整篇批注不占列 */
    var leftList = [], rightList = [];
    items.forEach(function (it, i) {
      if (it.paraIdx < 0) return;             /* 整篇批注不进卡片列 */
      (i % 2 === 0 ? leftList : rightList).push(it);
    });

    function tcard(it) {
      var a = it.a;
      var fixTxt = String(a.fix || "").trim();
      var color = ZP.Render.typeColor(a.type);
      return '<div class="ecard tcard" data-tno="' + it.no + '"' +
          ' style="border-left-color:' + color + '">' +
          '<span class="ecard-no" style="background:' + color + '">' + it.no + "</span>" +
          '<div class="ecard-tag" style="color:' + color + '">' + esc(a.tag || "") + "</div>" +
          '<div class="ecard-note">' + rich(a.note || a.html || a.comment || "") + "</div>" +
          (fixTxt ? '<div class="ecard-fix"><i>改写例句</i>' + rich(fixTxt) + "</div>" : "") +
        "</div>";
    }

    var css = ""
      + ".eboard{position:relative;display:flex;align-items:flex-start;gap:" + L.gap + "px;"
      +   "width:" + L.boardW + "px;min-width:" + L.boardW + "px;margin:0 auto}"
      + ".ecard{position:absolute;left:0;width:100%;transform:translateY(-50%);"
      +   "background:#fff;border:1px solid #ece6d8;border-left-width:2px;border-radius:8px;"
      +   "padding:9px 11px 10px;box-shadow:0 8px 20px -16px rgba(30,26,18,.5);"
      +   "font-size:var(--ecfs,14px);line-height:1.62}"
      + ".ecard-no{position:absolute;top:-6px;left:-6px;min-width:14px;height:14px;padding:0 3px;"
      +   "display:flex;align-items:center;justify-content:center;border-radius:7px;color:#fff;"
      +   "font-family:ui-monospace,Menlo,Consolas,monospace;font-size:8px;font-weight:700;"
      +   "box-shadow:0 1px 3px rgba(20,22,26,.25)}"
      + ".ecard-tag{font-size:.82em;font-weight:600;letter-spacing:.04em;margin-bottom:3px}"
      + ".ecard-note{color:#3f4652}"
      + ".ecard-fix{margin-top:6px;padding:5px 7px;background:#faf7ef;border-left:2px solid #dcc9a5;"
      +   "border-radius:0 4px 4px 0;font-size:.95em;line-height:1.55;color:#6b6047}"
      + ".ecard-fix i{display:block;font-style:normal;font-size:.8em;color:#a89e8b;margin-bottom:2px}"
      + ".ecard-fix del,.ecard-note del{color:#a08f78;text-decoration:line-through;"
      +   "text-decoration-color:rgba(160,143,120,.6)}"
      + ".ecard-fix ins,.ecard-note ins{text-decoration:none;color:#8a3a24;"
      +   "background:#fdf1ec;border-bottom:1.5px solid rgba(207,68,54,.35);border-radius:2px;"
      +   "padding:0 1px}"
      + ".eboard.text-board{align-items:flex-start}"
      + ".tcol{position:relative;flex:0 0 " + L.cardW + "px;width:" + L.cardW + "px}"
      + ".tsheet{position:relative;flex:0 0 " + L.sheetW + "px;width:" + L.sheetW + "px;"
      +   "background:#fff;border:1px solid #e6e0d2;border-radius:2px;"
      +   "padding:26px 30px 30px;box-shadow:0 10px 28px -20px rgba(30,26,18,.5)}"
      + ".tsheet .t-title{text-align:center;margin:0 0 4px;font-size:17px;font-weight:700;"
      +   "font-family:'Songti SC',SimSun,serif;letter-spacing:.06em;color:#20232a}"
      + ".tsheet .t-meta{text-align:center;font-size:10px;color:#948b7c;letter-spacing:.08em;"
      +   "margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid #f0e9db}"
      + ".tsheet .t-body{font-family:'Songti SC',SimSun,serif;font-size:18px;line-height:2.05;"
      +   "color:#26292f;text-align:justify}"
      + ".tsheet .t-body p{margin:0 0 .35em;text-indent:2em}"
      + ".tsheet .t-body p:last-child{margin-bottom:0}"
      + ".tsent{border-radius:2px;padding:0 1px}"
      + ".tsent.t-red{background:linear-gradient(180deg,transparent 64%,rgba(207,68,54,.18) 64%)}"
      + ".tsent.t-amber{background:linear-gradient(180deg,transparent 64%,rgba(209,149,42,.19) 64%)}"
      + ".tsent.t-green{background:linear-gradient(180deg,transparent 64%,rgba(47,143,107,.16) 64%)}"
      + ".tsent.t-violet{background:linear-gradient(180deg,transparent 64%,rgba(122,92,196,.16) 64%)}"
      + ".tno{display:inline-block;width:13px;height:13px;line-height:13px;text-align:center;"
      +   "border-radius:50%;font-size:8px;font-weight:700;color:#fff;margin:0 2px;"
      +   "vertical-align:2px;font-family:ui-monospace,Menlo,Consolas,monospace;"
      +   "box-shadow:0 1px 2px rgba(0,0,0,.18);text-indent:0}"
      /* 错别字角标：句右下一个小方块，只在句中留痕，不给旁批注位 */
      + ".tmark{display:inline-block;min-width:12px;height:12px;line-height:12px;text-align:center;"
      +   "border-radius:3px;font-size:8px;font-weight:700;color:#fff;margin:0 1px;"
      +   "vertical-align:1px;font-family:ui-monospace,Menlo,Consolas,monospace;"
      +   "text-indent:0;box-shadow:0 1px 2px rgba(0,0,0,.16)}"
      + ".tmark.t-red{background:#cf4436}"
      /* 长跨度标记：只画下划线，不做整块底色 */
      + ".tsent.t-long{background:none;border-bottom:1.5px solid rgba(207,68,54,.55);"
      +   "border-radius:0;padding:0}"
      + ".tsent.t-long.t-amber{border-bottom-color:rgba(209,149,42,.6)}"
      + ".tsent.t-long.t-green{border-bottom-color:rgba(47,143,107,.55)}"
      + ".tsent.t-long.t-violet{border-bottom-color:rgba(122,92,196,.55)}"
      + ".tloose{margin-top:14px;padding-top:10px;border-top:1px dashed #e6dfd0}"
      + ".tloose-lb{display:inline-block;font-size:10px;letter-spacing:.1em;font-weight:600;"
      +   "color:#9a7c46;margin-bottom:4px}"
      + ".tloose p{margin:0 0 5px;font-size:14.5px;line-height:1.7;color:#5d6470;text-indent:0}"
      + ".tloose q{color:#8a7043;quotes:'「' '」'}"
      /* PDF 流式布局：正文全宽，批注卡两卡一行挂在对应段后。
         批注多时自然分页、字号正常、无大片空白（三栏绝对定位在
         批注多时会把整板撑得极高，整页适配缩到 3pt 字）。 */
      /* 导出的 HTML 与 PDF 共用同一套流式版式：正文全宽 + 每段后挂批注卡。
         三栏绝对定位版式只留在软件界面里——卡片一多就会互相挤压，
         HTML 打开时没有额外的排版脚本兜底，问题更明显。 */
      + ".text-board .tcol{display:none}"
      + ".text-board .tsheet{flex:1 1 auto;width:auto}"
      + ".text-board .tflow{display:block}"
      /* 流式卡片必须保留定位上下文：ecard-no 是 absolute 的编号气泡，
         若卡片改成 static，气泡会失去参照、全部堆到纸面左上角。 */
      + ".tflow .tcard{position:relative;left:auto;top:auto;transform:none;width:auto;margin:0}"
      /* 每行两张卡：行容器必须是普通块级盒——Chromium 对 flex / grid
         容器的分页支持不可靠，会把卡片从中间横切；块级盒 +
         break-inside:avoid 才真正保证一行不被页边界切开。
         行内卡片用 inline-block，彼此不独立分页。 */
      + ".tflow-row{display:block;margin:8px 0 0;"
      +   "break-inside:avoid;page-break-inside:avoid}"
      + ".tflow-row::after{content:'';display:block;clear:both}"
      + ".tflow-row .tcard{display:inline-block;vertical-align:top;"
      +   "width:calc(50% - 4px);margin:0}"
      + ".tflow-row .tcard + .tcard{margin-left:8px}"
      /* 单卡行占满整宽：只占左半边会在右侧留出等宽空白，读起来偏斜 */
      + ".tflow-row-single .tcard{width:100%}"
      + ".tflow-row:last-child{margin-bottom:14px}"
      /* 流式卡片留出上边距并把编号气泡收进卡内：
         ecard-no 原为 top:-6px 的绝对定位气泡，贴着行/页边界时
         会被切掉半个；这里改为卡内 top:3px，任何分页位置都完整。 */
      + ".tflow .tcard{padding-top:16px}"
      + ".tflow .tcard .ecard-no{top:3px}";

    /* PDF 流式批注块：每段正文后挂该段批注（两卡一行）。
       整篇批注是文末紧凑列表（.tloose），不在此列。 */
    var byNo = {};
    items.forEach(function (it) { byNo[it.no] = it; });
    /* 批注块直接拼在对应段落之后：不再统一堆到文末。
       导出 HTML 打开时没有 extra 排版脚本兜底，堆在文末会让
       「第 7 条批注」离它说的那段话隔了整整一页。 */
    function flowOf(nos, pi) {
      if (!nos.length) return "";
      var rows = "";
      for (var i = 0; i < nos.length; i += 2) {
        var grp = nos.slice(i, i + 2);
        rows += '<div class="tflow-row' + (grp.length === 1 ? " tflow-row-single" : "") + '">' +
          grp.map(function (no) { return tcard(byNo[no]); }).join("") +
          "</div>";
      }
      return '<div class="tflow" data-after-pi="' + pi + '">' + rows + "</div>";
    }
    var paraWithFlow = paraHtml.map(function (h, pi) {
      return h + flowOf(paraNos[pi], pi);
    }).join("");

    return '<section class="sheet sheet-board text-sheet">' +
      '<div class="sheet-head">' +
        '<div><h2>原稿批注</h2>' +
          '<div class="sh-sub">' + esc(res.title || "作文") +
          (res.meta ? "　" + esc(res.meta) : "") + "　稿源文本</div></div>" +
      "</div>" +
      '<style>' + css + "</style>" +
      '<div class="eboard text-board">' +
        '<div class="ecol tcol ecol-l">' + leftList.map(tcard).join("") + "</div>" +
        '<div class="esheet tsheet">' +
          '<h3 class="t-title">' + esc(res.title || "作文") + "</h3>" +
          '<div class="t-meta">' + [
            (res.student && res.student !== "未署名") ? esc(res.student) : "",
            esc(res.meta || ""),
            "全文 " + (res.wordCount || 0) + " 字"
          ].filter(Boolean).join(" · ") + "</div>" +
          '<div class="t-body">' + paraWithFlow + looseHtml + "</div>" +
        "</div>" +
        '<div class="ecol tcol ecol-r">' + rightList.map(tcard).join("") + "</div>" +
      "</div>" +
    "</section>";
  }

  /* 汇总表里的「原句」：引句常整段上百字，一格里塞不下也读不出重点。
     截到真正出问题的词附近一小段（前后各留 14 字），首尾加省略号。 */
  function typoSnippet(say, a) {
    var s = String(say || "").replace(/[\s　]+/g, " ").trim();
    if (s.length <= 42) return s;
    var hit = typoHit(s, a);
    var at = hit ? hit.at : -1;
    if (at < 0) return s.slice(0, 40) + "…";
    var from = Math.max(0, at - 14);
    var to = Math.min(s.length, at + (hit ? hit.len : 4) + 14);
    return (from > 0 ? "…" : "") + s.slice(from, to) + (to < s.length ? "…" : "");
  }

  /* 错别字命中定位：模型给的引句常是整句甚至整段，
     但真正出错的往往只有一两个字。这里从 fix / note 里提取
     「X→Y」「X 应为 Y」「X 改成 Y」形式的错词，回到引句中定位；
     定位不到就返回 null，调用方按整段标记处理。 */
  function typoHit(text, a) {
    if (!text) return null;
    var cands = [];
    var fix = String(a.fix || "");
    var note = String(a.note || a.html || a.comment || "");
    /* 「甜静」应为「恬静」 / 「X」→「Y」 / X 应为 Y */
    var pats = [
      /「(.{1,6})」\s*(?:→|应为|应改成|改为|改成)\s*「?(.{1,6})」?/,
      /(.{1,6})\s*(?:→|应为|应改成|改为|改成)\s*(.{1,6})/,
      /「(.{1,6})」/
    ];
    pats.forEach(function (re) {
      var m = fix.match(re) || note.match(re);
      if (m && m[1]) cands.push(m[1]);
    });
    for (var i = 0; i < cands.length; i++) {
      var w = cands[i].replace(/[「」『』（）、，。；：\s]/g, "");
      if (!w || w.length > 6) continue;
      var at = text.indexOf(w);
      if (at >= 0) return { at: at, len: w.length };
    }
    return null;
  }

  /* 错别字汇总块（放在「全文概览」页）：把错别字从正文旁批注里挪出来，
     一次看完，避免十几条「应为」把最有价值的语句批注挤到次要位置。 */
  function typoBlock(res) {
    var anns = (res && (res.annotations || res.annos)) || [];
    var paras = (res && (res.paragraphs || (res.essay && res.essay.paras))) || [];
    if (Array.isArray(paras)) {
      paras = paras.map(function (p) {
        if (Array.isArray(p)) return p.map(function (s) { return s.t || ""; }).join("");
        return String(p);
      }).filter(function (t) { return t.trim(); });
    } else {
      paras = [];
    }
    var rows = [];
    if (paras.length) {
      var byPara = paras.map(function (text, pi) { return ZP.Render.matchMarks(text, pi, anns); });
      byPara.forEach(function (ms, pi) {
        var text = paras[pi] || "";
        ms.forEach(function (m) {
          if (m.a.type !== "red") return;
          /* 原句优先取「模型给的引句」；没有就取实际匹配到的原文片段。
             只写 a.sentence 时，靠 para 定位、没给引句的批注会整行空白
             （实测汇总里只剩「→ 应用（yìng yòng）」）。 */
          var say = (m.a.sentence || m.a.quote || "").trim();
          if (!say && text) say = text.slice(m.start, m.end).trim();
          rows.push({ a: m.a, sentence: typoSnippet(say, m.a) });
        });
      });
      /* 定位不到的错别字也要列（没有原句时只显示说明） */
      var located = [];
      byPara.forEach(function (ms) { ms.forEach(function (m) { located.push(m.a); }); });
      anns.forEach(function (a) {
        if (a.type === "red" && located.indexOf(a) < 0) {
          rows.push({ a: a, sentence: typoSnippet((a.sentence || a.quote || "").trim(), a) });
        }
      });
    } else {
      anns.forEach(function (a) {
        if (a.type === "red") {
          rows.push({ a: a, sentence: typoSnippet((a.sentence || a.quote || "").trim(), a) });
        }
      });
    }
    if (!rows.length) return "";

    /* 编号与正文角标一致：正文里先是错别字、再是其余批注，
       所以汇总表按原顺序编号即可对上（1..n）。 */
    /* 用紧凑列表而不是 table：Chromium 打印时表格跨页会断行、
       还会丢掉首行（实测概览页被拆成两页、第 2 页只剩表头）。
       每条自带 break-inside:avoid，可安全跨页。 */
    return '<div class="blk typo-blk"><div class="blk-head"><h4>错别字汇总</h4><i></i>' +
      '<span class="meta">共 ' + rows.length + ' 处 · 原稿句中以红色角标标注</span></div>' +
      '<div class="typo-list">' +
        rows.map(function (r, i) {
          var a = r.a;
          var fixTxt = String(a.fix || "").trim();
          return '<div class="typo-row">' +
            '<div class="typo-hd">' +
              '<span class="typo-no">' + (i + 1) + "</span>" +
              (r.sentence ? '<q class="typo-say">' + esc(r.sentence) + "</q>"
                          : '<q class="typo-say typo-say-none">原句未定位</q>') +
              (fixTxt ? '<span class="typo-arrow">→</span>' +
                '<span class="typo-fix">' + esc(fixTxt) + "</span>" : "") +
              '<span class="typo-note">' + esc(a.note || a.html || a.comment || "") + "</span>" +
            "</div>" +
          "</div>";
        }).join("") +
      "</div></div>";
  }

  /* ============================================================
     二、报告各 Tab（每个 Tab 独立一页）
     ============================================================ */
  function tabCss() {
    return ""
      + ".blk{margin-bottom:18px}"
      + ".blk:last-child{margin-bottom:0}"
      + ".blk-head{display:flex;align-items:center;gap:8px;margin-bottom:9px}"
      + ".blk-head h4{margin:0;font-size:15.5px;font-weight:650;letter-spacing:.1em;color:#3f3b35}"
      + ".blk-head i{flex:1;height:1px;background:linear-gradient(90deg,#e0d8c8,transparent)}"
      + ".blk-head .meta{font-size:10.5px;color:#8d8477;letter-spacing:.03em}"
      + ".card{background:#fff;border:1px solid #ebe5d8;border-radius:9px;padding:12px 14px;"
      +   "box-shadow:0 1px 2px rgba(60,45,25,.04)}"
      /* 分数区 */
      /* 分数卡：左信息 / 右雷达，横向并排 */
      + ".hero{display:flex;align-items:center;gap:18px;margin-bottom:16px;padding:14px 16px;"
      +   "background:linear-gradient(180deg,#fffefb,#fdfbf5);border:1px solid #ebe5d8;border-radius:11px;"
      +   "box-shadow:0 1px 2px rgba(60,45,25,.04)}"
      + ".hero-l{flex:1;min-width:0;display:flex;flex-direction:column;align-items:flex-start}"
      + ".hero-r{flex:0 0 210px;display:flex;align-items:center;justify-content:center}"
      + ".stu{font-size:17px;font-weight:600;color:#2b3038;margin-bottom:8px}"
      + ".stu em{font-style:normal;font-weight:400;font-size:11px;color:#8d8477;margin-left:8px}"
      + ".hero .big{font-size:38px;font-weight:650;line-height:1;letter-spacing:-.02em;color:#2b3038}"
      + ".hero .big small{font-size:12px;color:#8d8477;font-weight:400;margin-left:2px}"
      + ".cap{font-size:9.5px;color:#a89e8b;letter-spacing:.08em;margin-top:6px}"
      + ".hero-r .hd{display:block;font-size:15.5px;color:#5d6470;line-height:1.9}"
      + ".hero-r .hd i{display:inline-block;width:5px;height:5px;border-radius:50%;margin-right:6px;vertical-align:1px}"
      + ".hero-r .hd b{float:right;font-size:12px;color:#2b3038;margin-left:12px}"
      + ".big{font-size:40px;font-weight:650;line-height:1;letter-spacing:-.02em;color:#2b3038}"
      + ".big small{font-size:12px;color:#8d8477;font-weight:400;margin-left:2px}"
      + ".lv{padding:3px 11px;border-radius:5px;font-size:14.5px;font-weight:600;"
      +   "background:linear-gradient(180deg,#f9f0dd,#f1e2c4);color:#75501c;border:1px solid #d9c39b}"
      + ".lv.l1{background:linear-gradient(180deg,#faeae1,#f2d8c8);color:#7d321c;border-color:#dcb8a0}"
      + ".lv.l2{background:linear-gradient(180deg,#eaf0e2,#d9e4cd);color:#3d4f35;border-color:#bccdab}"
      + ".lv.l3{background:linear-gradient(180deg,#f4f2ee,#e9e5dc);color:#5f574c;border-color:#d4cdbd}"
      + ".mini{display:flex;flex-wrap:wrap;gap:10px 14px;font-size:13px;color:#6f6a60}"
      + ".mini span{display:inline-flex;align-items:center}"
      + ".mini i{display:inline-block;width:6px;height:6px;border-radius:2px;margin-right:5px;"
      +   "box-shadow:0 0 0 1px rgba(255,255,255,.85) inset}"
      + ".radar{display:block;width:100%;max-width:200px;height:auto}"
      /* 总评 */
      + ".overall{white-space:pre-wrap;font-size:16.5px;line-height:1.95;color:#454b55}"
      /* 四维卡片 */
      + ".dim{background:#fff;border:1px solid #ebe5d8;border-radius:9px;padding:10px 12px;"
      +   "margin-bottom:8px;border-left:3px solid var(--c);box-shadow:0 1px 2px rgba(60,45,25,.04)}"
      + ".dim:last-child{margin-bottom:0}"
      + ".dh{display:flex;align-items:baseline;gap:8px;margin-bottom:4px}"
      + ".dh .nm{font-size:15px;font-weight:600;color:var(--c);letter-spacing:.03em}"
      + ".dh b{margin-left:auto;font-size:12px;font-weight:650;color:var(--c)}"
      + ".dh b em{font-style:normal;font-size:9.5px;color:#a89e8b;font-weight:400}"
      + ".dh .w{color:#8d8477;font-size:10px}"
      + ".dim p{margin:0;font-size:15.5px;color:#5d6470;line-height:1.7}"
      + ".dim .tagline{display:inline-block;margin-top:6px;font-size:9.5px;font-weight:600;"
      +   "color:var(--c);background:#fbf9f4;border:1px solid #dfd7c6;"
      +   "padding:2px 7px;border-radius:4px;letter-spacing:.03em}"
      /* 小练笔（与界面 app.css 同一套配色：编号徽章 + 三色标签 + 素材块） */
      + ".drill{background:#fff;border:1px solid #ebe5d8;border-radius:10px;padding:11px 12px;"
      +   "margin-bottom:9px;box-shadow:0 1px 2px rgba(60,45,25,.04)}"
      + ".drill:last-child{margin-bottom:0}"
      + ".drill-head{display:flex;align-items:center;gap:7px;margin-bottom:7px}"
      + ".drill-no{width:19px;height:19px;border-radius:5px;display:flex;align-items:center;"
      +   "justify-content:center;flex:0 0 19px;font-size:10px;font-weight:600;color:#8a6c34;"
      +   "background:linear-gradient(180deg,#fbf3e0,#f6e9ce);border:1px solid #ecdcbc}"
      + ".drill-head h5{margin:0;font-size:15px;font-weight:650;color:#2e323a;flex:1;line-height:1.4}"
      + ".drill-sec{margin-top:6px}"
      + ".drill-lb{display:inline-block;font-size:13px;letter-spacing:.1em;font-weight:600;margin-bottom:2px}"
      + ".drill-lb.s1{color:#b0552c}"
      + ".drill-lb.s2{color:#3b6ea5}"
      + ".drill-lb.s3{color:#2f7f6a}"
      + ".drill-sec p{margin:0;font-size:14.5px;line-height:1.72;color:#5d6470}"
      + ".drill-task{margin-top:7px;padding-top:6px;border-top:1px dashed #e6dfd0;"
      +   "font-size:14px;color:#8a7a5c;display:flex;justify-content:space-between;gap:8px}"
      + ".drill-task span:first-child{color:#b0a390}"
      /* 通用段落（写作思路等仍用） */
      + ".drill h5{margin:0 0 6px;font-size:12px;color:#2b3038}"
      + ".drill p{margin:0 0 4px;font-size:15.5px;color:#5d6470;line-height:1.75}"
      + ".drill p:last-child{margin-bottom:0}"
      + ".drill p b{color:#3f3b35;font-weight:600}"
      + ".drill ol{margin:0 0 4px;padding-left:18px}"
      + ".drill ol li{font-size:15.5px;color:#5d6470;line-height:1.75;margin-bottom:2px}"
      + ".drill ol li:last-child{margin-bottom:0}"
      /* 写作思路：与界面同色系，标题/标签/正文分主次 */
      + ".ol-note{font-size:10.5px;line-height:1.65;color:#9aa1ad;margin:-2px 0 10px;letter-spacing:.02em}"
      + ".outline-flow{position:relative;padding-left:16px;border-left:1px solid #e3d9c4;margin-left:3px}"
      + ".ol-step{position:relative;margin-bottom:13px}"
      + ".ol-step:last-child{margin-bottom:0}"
      + ".ol-step::before{content:'';position:absolute;left:-20px;top:5px;width:7px;height:7px;border-radius:50%;"
      +   "background:#fff;border:1.5px solid #c8ae82}"
      + ".ol-tag{font-size:14px;font-weight:650;letter-spacing:.1em;color:#9a7c46;margin-bottom:4px}"
      + ".ol-step p{font-size:15px;color:#4c535e;line-height:1.78;margin:0}"
      + ".ol-step p b{color:#2b3038;font-weight:600}"
      + ".ol-list{margin:2px 0 0;padding:0;list-style:none;counter-reset:oli}"
      + ".ol-list li{position:relative;padding-left:16px;font-size:15px;line-height:1.78;color:#4c535e;"
      +   "margin-bottom:3px;counter-increment:oli}"
      + ".ol-list li:last-child{margin-bottom:0}"
      + ".ol-list li::before{content:counter(oli) '.';position:absolute;left:0;top:0;font-size:10.5px;"
      +   "font-weight:600;color:#b89458}"
      + ".ol-list li b{color:#2b3038;font-weight:600}"
      /* 具体问题与修改思路 */
      + ".issue{background:#fff;border:1px solid #ebe5d8;border-radius:10px;padding:11px 12px;margin-bottom:9px;"
      +   "box-shadow:0 1px 2px rgba(60,45,25,.04)}"
      + ".issue:last-child{margin-bottom:0}"
      + ".issue-top{display:flex;gap:8px;align-items:flex-start;margin-bottom:7px}"
      + ".issue-no{width:18px;height:18px;border-radius:5px;display:flex;align-items:center;justify-content:center;"
      +   "flex:0 0 18px;margin-top:1px;font-size:10px;font-weight:600;color:#a8523a;"
      +   "background:linear-gradient(180deg,#fdf0ec,#f9e4dd);border:1px solid #f0d3c9}"
      + ".issue-problem{margin:0;font-size:15px;line-height:1.72;color:#2b3038;font-weight:600}"
      + ".ia-lb{display:inline-block;font-size:10px;letter-spacing:.1em;font-weight:600;color:#9a7c46;"
      +   "background:#fbf7ec;border:1px solid #ece1c9;border-radius:4px;padding:1px 5px;margin-bottom:4px}"
      + ".issue-advice{margin-top:6px}"
      + ".issue-advice p{margin:0;font-size:15px;line-height:1.75;color:#4c535e}"
      + ".issue-steps{margin-top:7px;padding-top:7px;border-top:1px dashed #e6dfd0}"
      + ".fix-steps{margin:0;padding:0;list-style:none;counter-reset:fst}"
      + ".fix-steps li{position:relative;padding-left:17px;font-size:15px;line-height:1.75;color:#6d6455;"
      +   "margin-bottom:3px;counter-increment:fst}"
      + ".fix-steps li:last-child{margin-bottom:0}"
      + ".fix-steps li::before{content:counter(fst);position:absolute;left:0;top:2px;width:12px;height:12px;"
      +   "border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:8.5px;"
      +   "font-weight:600;color:#a08a63;background:#f7f2e6;border:1px solid #e9dfc9}"
      + ".tech ul{margin:0;padding-left:16px}"
      + ".tech li{font-size:15.5px;color:#5d6470;line-height:1.8;margin-bottom:4px}"
      + ".tech li::marker{color:#c9a05c}"
      + ".tech li:last-child{margin-bottom:0}"
      + ".tech li b{display:inline-block;font-size:10px;font-weight:600;border:1px solid currentColor;"
      +   "border-radius:4px;padding:0 4px;margin-right:5px;vertical-align:1px;opacity:.9}"
      /* 润色稿重点描写方法：与界面同一套色 */
      + ".pol .tk{border-radius:2px;padding:0 1px;font-weight:600}"
      + ".tk-legend{display:flex;flex-wrap:wrap;gap:4px 12px;margin:0 0 9px;padding:7px 10px;"
      +   "background:#faf8f2;border:1px dashed #e6ddc9;border-radius:7px}"
      + ".tk-legend span{display:inline-flex;align-items:center;gap:5px;font-size:10.2px;color:#9aa1ad}"
      + ".tk-legend i{width:5px;height:5px;border-radius:50%}"
      + ".drill .mat{background:#f8f6ef;border-left:2px solid #d9c9a6;padding:7px 9px;"
      +   "border-radius:0 5px 5px 0;color:#6d6455;font-size:15.5px;line-height:1.7}"
      + ".drill .mat b{color:#4d4636;font-weight:600}"
      /* 润色稿 */
      + ".pol{background:#fff;border:1px solid #ebe5d8;border-radius:9px;padding:18px 22px;"
      +   "font-family:'Songti SC',SimSun,serif;font-size:18px;line-height:2.05;color:#2b3038;"
      +   "box-shadow:0 1px 2px rgba(60,45,25,.04)}"
      + ".pol h6{text-align:center;font-size:23px;margin:0 0 14px;font-weight:700;"
      +   "letter-spacing:.05em;line-height:1.6}"
      + ".pol p{margin:0 0 7px;text-indent:2em}"
      + ".pol p:last-child{margin-bottom:0}"
      /* 错别字汇总：一条一块，原句（宋体）→ 应改为（红），说明在下；
         块级 + break-inside:avoid，跨页时不拆断。 */
      + ".typo-list{border:1px solid #ebe5d8;border-radius:9px;overflow:hidden;"
      +   "background:#fffdf9}"
      + ".typo-row{padding:8px 11px;border-bottom:1px solid #f2ece0;"
      +   "break-inside:avoid;page-break-inside:avoid}"
      + ".typo-row:last-child{border-bottom:0}"
      + ".typo-hd{display:flex;align-items:baseline;gap:7px;flex-wrap:wrap}"
      + ".typo-no{display:inline-block;min-width:15px;height:15px;line-height:15px;"
      +   "text-align:center;border-radius:4px;background:#cf4436;color:#fff;"
      +   "font-family:ui-monospace,Menlo,Consolas,monospace;font-size:9px;font-weight:700;"
      +   "flex:0 0 auto;position:relative;top:-1px}"
      + ".typo-say{font-family:'Songti SC',SimSun,serif;font-size:14px;color:#2b3038;"
      +   "quotes:'「' '」'}"
      + ".typo-arrow{color:#b9ad96;font-size:12px}"
      + ".typo-fix{color:#a2492f;font-weight:600;font-size:13px}"
      + ".typo-say-none{color:#a9a293;font-style:normal}"
      + ".typo-note{flex:1 1 100%;margin:2px 0 0 22px;font-size:11.5px;line-height:1.6;"
      +   "color:#6b7280}"
      /* 概览页本身已接近满页：汇总块允许自然分页，
         避免出现「上一页底部只剩两行」的碎片页。 */
      + ".typo-blk,.typo-list{break-inside:auto}";
  }

  function head(titleText, subText, tagText) {
    return '<div class="sheet-head">' +
      "<div><h2>" + esc(titleText) + "</h2>" +
        (subText ? '<div class="sh-sub">' + esc(subText) + "</div>" : "") + "</div>" +
      (tagText ? '<span class="sh-tag">' + esc(tagText) + "</span>" : "") +
    "</div>";
  }

  /* 概览页 */
  function overviewPage(res, opt) {
    var dimRows = ZP.DIMS.map(function (d) {
      var hit = (res.dims || []).filter(function (x) { return x.key === d.key; })[0] ||
        { score: 0, comment: "", tagline: "" };
      var c = DIM_COLORS[d.key] || d.color;
      return '<div class="dim" style="--c:' + c + '">' +
        '<div class="dh">' +
          '<span class="nm" style="color:' + c + '">' + esc(d.name) + "</span>" +
          "<b>" + hit.score + '<em style="font-style:normal;font-size:9.5px;color:#a89e8b">/100</em></b>' +
          '<span class="w">权重 ' + (opt.weights ? opt.weights[d.key] : "") + "</span>" +
        "</div>" +
        "<p>" + esc(hit.comment || "") + "</p>" +
        (hit.tagline ? '<span class="tagline" style="color:' + c + '">' + esc(hit.tagline) + "</span>" : "") +
      "</div>";
    }).join("");

    var m = res.metrics || {};
    /* 等级样式：一类/二类/三类分别对应暖色三档 */
    var lvText = res.level || "";
    var lvCls = "lv" + (lvText.indexOf("一类") >= 0 ? " l1"
      : lvText.indexOf("二类") >= 0 ? " l2" : " l3");

    return '<section class="sheet">' +
      head("全文概览", [
        (res.student && res.student !== "未署名") ? esc(res.student) : "",
        esc(res.meta || ""),
        "全文 " + (res.wordCount || 0) + " 字"
      ].filter(Boolean).join("　")) +
      '<style>' + tabCss() + "</style>" +
      /* 分数卡：左侧信息栏（姓名 / 年级 / 总分 / 等级），右侧雷达图
         与软件内报告头一致，雷达图不再独占一行通栏 */
      '<div class="hero">' +
        '<div class="hero-l">' +
          '<div class="stu">' + esc(res.student || "未署名") +
            '<em>' + esc(res.meta || "") + "</em></div>" +
          '<div class="big">' + (res.score || 0) + "<small>/100</small></div>" +
          '<div class="' + lvCls + '">' + esc(lvText) + "</div>" +
          '<div class="cap">加权总分</div>' +
        "</div>" +
        (opt.radar
          ? '<div class="hero-r"><img class="radar" src="' + opt.radar + '" alt="四维雷达图"></div>'
          : '<div class="hero-r">' + ZP.DIMS.map(function (d) {
              var hit = (res.dims || []).filter(function (x) { return x.key === d.key; })[0] || { score: 0 };
              var c = DIM_COLORS[d.key] || d.color;
              return '<span class="hd"><i style="background:' + c + '"></i>' + esc(d.name) +
                "<b>" + hit.score + "</b></span>";
            }).join("") + "</div>") +
      "</div>" +
      '<div class="blk"><div class="blk-head"><h4>整篇研判</h4><i></i>' +
        '<span class="meta">用字 ' + (m.words || 0) + " · 段落 " + (m.paras || 0) + "</span></div>" +
        '<div class="card overall">' + esc(res.overall || "") + "</div></div>" +
      '<div class="blk"><div class="blk-head"><h4>四维评分</h4><i></i>' +
        '<span class="meta">按权重折算</span></div>' + dimRows + "</div>" +
    "</section>";
  }

  /* 写作思路页：与界面 renderOutline 同结构、同配色
     —— 金色年级标签 + 灰色说明行 + 有序列表 + 编号问题卡 + 三色小标签 */
  function outlinePage(res) {
    var ol = res.outline || {};
    var NL = String.fromCharCode(10);
    /* 只放行 <b>/<del>/<ins>，其余一律转义：与界面 rich() 行为一致 */
    function richText(s) {
      return esc(s).replace(/&lt;(\/?)(del|ins|b)&gt;/g, "<$1$2>");
    }
    /* 只保留真正有文字的步骤：模型偶尔把 text 回成空串，
       或历史记录是旧格式缺字段，这里必须过滤掉，否则会渲染出空的提纲块。 */
    var steps = [ol.begin, ol.middle, ol.end].filter(function (o) {
      return o && String(o.text || "").trim();
    });

    var olHtml = steps.length
      ? '<div class="blk"><div class="blk-head"><h4>参考写作思路</h4><i></i>' +
        '<span class="meta">' + esc((res.meta || "").split(" · ")[0] || "") + " 重写提纲</span></div>" +
        '<div class="ol-note">按本文题目与内容生成，可作为重新构思一篇作文时的客观提纲。</div>' +
        '<div class="outline-flow">' +
        steps.map(function (o) {
          var text = String(o.text || "");
          var parts = text.split(new RegExp(NL + "|(?=[0-9]{1,2}[.、])"))
            .map(function (x) { return x.trim(); }).filter(Boolean);
          var numRe = /^[0-9]{1,2}[.、]\s*/;
          var body;
          if (parts.some(function (x) { return numRe.test(x); })) {
            var lead = [], items = [], started = false;
            parts.forEach(function (ln) {
              if (numRe.test(ln)) { started = true; items.push(ln.replace(numRe, "")); }
              else if (!started) lead.push(ln);
              else if (items.length) items[items.length - 1] += ln;
            });
            body = (lead.length ? "<p>" + richText(lead.join("")) + "</p>" : "") +
              (items.length
                ? '<ol class="ol-list">' + items.map(function (ln) { return "<li>" + richText(ln) + "</li>"; }).join("") + "</ol>"
                : "");
          } else {
            body = "<p>" + richText(text) + "</p>";
          }
          return '<div class="ol-step"><div class="ol-tag">' + esc(o.title || "") + "</div>" + body + "</div>";
        }).join("") +
        "</div></div>"
      : "";

    var issues = res.issues || [];
    var issueHtml = issues.length
      ? '<div class="blk"><div class="blk-head"><h4>具体问题与修改思路</h4><i></i>' +
        '<span class="meta">' + issues.length + " 项 · 按优先级排列</span></div>" +
        issues.map(function (it, i) {
          var stepsHtml = (it.steps || []).length
            ? '<div class="issue-steps"><span class="ia-lb">怎么做</span><ol class="fix-steps">' +
              it.steps.map(function (t) { return "<li>" + richText(t) + "</li>"; }).join("") + "</ol></div>"
            : "";
          return '<div class="issue">' +
            '<div class="issue-top"><span class="issue-no">' + (it.no || i + 1) + "</span>" +
              '<p class="issue-problem">' + richText(it.problem || "") + "</p></div>" +
            (it.advice
              ? '<div class="issue-advice"><span class="ia-lb">修改思路</span><p>' + richText(it.advice) + "</p></div>"
              : "") +
            stepsHtml +
          "</div>";
        }).join("") + "</div>"
      : "";

    /* 提纲整块缺失时必须显式说明：
       只提示「本次未生成」会让这一页看着像内容丢了，
       尤其是下面还有「具体问题与修改思路」时更易误判。 */
    if (!olHtml) {
      olHtml = '<div class="blk"><div class="blk-head"><h4>参考写作思路</h4><i></i></div>' +
        '<div class="card" style="color:#8a7a5c;line-height:1.9;padding:14px 16px;' +
        'background:#fbf7ec;border:1px dashed #e5dcc6;border-radius:8px;">' +
        (issueHtml
          ? "本次批改未返回「开头／中间／结尾」提纲，下面列出的是本篇的具体问题与修改思路。"
          : "本次未生成写作思路，可重新批改后再导出。") +
        "</div></div>";
    }

    return '<section class="sheet">' +
      head("写作建议", [
        esc(res.title || ""),
        (res.student && res.student !== "未署名") ? esc(res.student) : ""
      ].filter(Boolean).join("　")) +
      '<style>' + tabCss() + "</style>" +
      olHtml + issueHtml +
      typoBlock(res) +
    "</section>";
  }

  /* 小练笔页：通用写作能力训练（练什么/怎么写/素材积累/练笔任务） */
  /* 素材拆条：与界面 render.js drillMaterials 同一套规则 */
  function drillMatHtml(text) {
    var raw = String(text || "").trim();
    if (!raw) return "";
    raw = raw.replace(/<b>\s*素材示例\s*<\/b>\s*[:：]?/g, "")
             .replace(/<b>\s*可用句式\s*<\/b>\s*[:：]?/g, "\n句式：");
    var parts = raw.split(/\n+|(?=[①②③④⑤])/).map(function (s) {
      return s.replace(/^[①②③④⑤]\s*/, "").trim();
    }).filter(Boolean);
    if (!parts.length) return "";
    return '<ul class="mat-list">' + parts.map(function (p) {
      var m = p.match(/^([^：:]{1,6})[：:]\s*([\s\S]+)$/);
      if (m) return '<li><span class="mat-tag">' + esc(m[1]) + "</span><span>" + esc(m[2]) + "</span></li>";
      return "<li><span>" + esc(p) + "</span></li>";
    }).join("") + "</ul>";
  }

  function drillPage(res) {
    var list = res.drills || [];
    var html = list.length
      ? list.map(function (d, i) {
        /* 新旧字段兼容：skill/how 为新结构，problem/think 为旧报告 */
        var skill = d.skill || d.problem || "";
        var how = d.how || d.think || "";
        return '<div class="drill">' +
          '<div class="drill-head"><span class="drill-no">' + (d.no || i + 1) + "</span>" +
            "<h5>" + esc(d.title || "练习 " + (i + 1)) + "</h5></div>" +
          (skill ? '<div class="drill-sec"><span class="drill-lb s1">练什么</span>' +
            "<p>" + esc(skill) + "</p></div>" : "") +
          (how ? '<div class="drill-sec"><span class="drill-lb s2">怎么写</span>' +
            "<p>" + esc(how) + "</p></div>" : "") +
          (d.material ? '<div class="drill-sec"><span class="drill-lb s3">素材积累</span>' +
            '<div class="mat">' + drillMatHtml(d.material) + "</div></div>" : "") +
          (d.task ? '<div class="drill-task"><span>练笔任务</span><span>' + esc(d.task) + "</span></div>" : "") +
        "</div>";
      }).join("")
      : '<div class="card">本次未生成小练笔。</div>';
    var matCss = ""
      + ".mat-list{margin:0;padding:0;list-style:none}"
      + ".mat-list li{display:flex;align-items:flex-start;gap:6px;margin-bottom:4px}"
      + ".mat-list li:last-child{margin-bottom:0}"
      + ".mat-list .mat-tag{flex:0 0 auto;font-size:12.5px;font-weight:650;color:#8a5a2b;"
      +   "background:#f3ecdc;border:1px solid #e5d7ba;border-radius:4px;"
      +   "padding:1px 6px;margin-top:2px;letter-spacing:.04em;white-space:nowrap}"
      + ".mat-list li>span:last-child{flex:1;min-width:0}";
    return '<section class="sheet">' +
      head("写作能力小练笔", esc(res.title || "") + "　共 " + list.length + " 题") +
      '<style>' + tabCss() + matCss + "</style>" +
      '<div class="blk"><div class="blk-head"><h4>通用写作能力训练</h4><i></i>' +
        '<span class="meta">按本篇短板出题 · 场景与本文无关</span></div>' +
        '<div class="ol-note">针对本篇暴露的能力短板设计，练笔场景与本文无关——练什么、怎么写、攒素材，课下即可动笔。</div>' +
        html + "</div>" +
    "</section>";
  }

  /* 润色后文章页 */
  /* 润色稿正文：与界面同一份 TECH_MARKS 定义，保证导出与屏幕颜色一致 */
  function techBody(text) {
    return ZP.paintTechMarks(text, esc, function (k, inner) {
      var mk = ZP.techMarkOf(k);
      if (!mk) return inner;
      return '<span class="tk" style="color:' + mk.color + ';background:' + mk.bg + '">' + inner + "</span>";
    });
  }

  /* 颜色图例：只列本篇实际出现的类别 */
  function legendHtml(pol) {
    var body = ((pol && pol.paras) || []).join("");
    var used = (ZP.TECH_MARKS || []).filter(function (t) { return body.indexOf("<" + t.key + ">") >= 0; });
    if (!used.length) return "";
    return '<div class="tk-legend">' + used.map(function (t) {
      return '<span><i style="background:' + t.color + '"></i>' + esc(t.name) + "</span>";
    }).join("") + "</div>";
  }

  /* 本次使用的润色手法：旧报告无该字段时整块不输出 */
  function techHtml(pol) {
    var list = (pol && Array.isArray(pol.techniques) ? pol.techniques : []).filter(function (t) {
      return t && (typeof t === "object" ? String(t.text || "").trim() : String(t).trim());
    });
    if (!list.length) return "";
    return '<div class="blk tech"><div class="blk-head"><h4>本次使用的润色手法</h4><i></i>' +
      '<span class="meta">' + list.length + " 条</span></div><ul>" +
      list.map(function (t) {
        var mk = ZP.techMarkOf(t && t.mark);
        var label = mk ? '<b style="color:' + mk.color + '">' + esc(mk.name) + "</b>" : "";
        return "<li>" + label + esc(String((t && t.text) || t || "")) + "</li>";
      }).join("") + "</ul></div>";
  }

  function polishedPage(res) {
    var pol = res.polished || { paras: [] };
    var paras = pol.paras || [];
    var words = ZP.countChars(ZP.stripTechMarks(paras.join("")));
    return '<section class="sheet">' +
      head("润色后文章", esc(res.title || "") + "　" + words + " 字") +
      '<style>' + tabCss() + "</style>" +
      '<div class="blk"><div class="blk-head"><h4>升格范文</h4><i></i></div>' +
        legendHtml(pol) +
        '<div class="pol"><h6>' + esc(pol.title || res.title || "") + "</h6>" +
          (paras.length ? paras.map(function (t) { return "<p>" + techBody(t) + "</p>"; }).join("")
                        : '<p style="text-align:center;color:#a9a293">' +
                          (res.polishFailed === "no_source"
                            ? "本次未生成升格范文：批改未取到原文句子，缺少改写依据。可在稿源文本中粘贴正文后重新批改。"
                            : "本次未生成升格范文。") + "</p>") +
        "</div></div>" +
      techHtml(pol) +
    "</section>";
  }

  /* ============================================================
     三、组装完整文档
     ============================================================ */
  /* 导出文档里引用的排版脚本地址。
   * blob iframe 的 location 是 blob:，不能直接拼接相对路径，
   * 这里按主页面的地址解析成绝对 URL（同源，满足 script-src 'self'）。 */
  function fixScriptUrl() {
    try {
      var base = (typeof document !== "undefined" && document.baseURI) ? document.baseURI : location.href;
      return new URL("assets/js/report-fix.js", base).href;
    } catch (e) {
      return "assets/js/report-fix.js";
    }
  }
  var FIX_SCRIPT_URL = fixScriptUrl();

  /* 排版修正脚本的源码：优先内联进导出的 HTML，让文件完全自包含。
   * 之前只写外链，导出文件会把主程序所在目录（开发时是
   * http://127.0.0.1:PORT/，安装后是 file:///...\resources\app.asar\app/）
   * 固化成绝对地址：把报告发给别人、或换台机器打开，脚本就 404，
   * 卡片重叠、页高不贴合。内联后离线双击也能正常排版。 */
  var FIX_SCRIPT_SRC = "";
  function fixScriptSource() {
    if (FIX_SCRIPT_SRC !== null && FIX_SCRIPT_SRC !== "") return FIX_SCRIPT_SRC;

    /* file:// 下同步 XHR 会被 CORS 拦（origin 为 null），
       因此先试 <script> 标签加载，再退回同步 XHR。
       标签加载不走 CORS，file:// 与 http:// 都可用。 */
    try {
      var xhr = new XMLHttpRequest();
      xhr.open("GET", "assets/js/report-fix.js", false);   /* 同步：build 是同步接口 */
      xhr.send(null);
      if (xhr.status === 200 || (xhr.status === 0 && xhr.responseText)) {
        /* XHR 会把 CRLF 归一成 LF：磁盘文件是 CRLF 时，responseText
           与原始字节不同。若按 responseText 算 CSP 哈希、又原样内联，
           某些加载路径（file:// 直读）按原始字节校验就会哈希不匹配、
           整段脚本被拦。这里统一归一成 LF，保证「内联内容 = 哈希输入」
           在任何加载方式下都一致。 */
        FIX_SCRIPT_SRC = String(xhr.responseText).replace(/\r\n?/g, "\n");
        return FIX_SCRIPT_SRC;
      }
    } catch (e) {
      /* file:// 常见：忽略并尝试标签法 */
    }

    FIX_SCRIPT_SRC = "";
    return FIX_SCRIPT_SRC;
  }

  /* file:// 场景：用 <script> 标签注入取得源码不可行（跨源读取被限制），
     因此改为「直接外链到 iframe」，并在 CSP 里放行该具体地址。
     这样 fix() 能执行，不依赖内联。 */
  function fixScriptExternTag() {
    return '<script src="' + FIX_SCRIPT_URL + '"><\/script>';
  }

  /* ---- 内联脚本的 CSP 哈希 ----
   * 主页面 script-src 'self' 会约束 iframe 里的文档：报告自带
   * 'unsafe-inline' 也不够（实测被父级策略压过），内联脚本必须带
   * nonce 或 sha256 白名单。静态页面没有 nonce，因此用 sha256。
   * crypto.subtle.digest 是异步接口，而 build() 是同步的，
   * 所以这里内置一个最小的 SHA-256 实现。 */
  var SHA_K = [], SHA_H0 = [];
  (function () {
    var n = 2, c = 0;
    while (c < 64) {
      var isPrime = true;
      for (var d = 2; d * d <= n; d++) { if (n % d === 0) { isPrime = false; break; } }
      if (isPrime) {
        SHA_K[c] = (Math.pow(n, 1 / 3) % 1 * 4294967296) | 0;
        SHA_H0[c] = (Math.pow(n, 1 / 2) % 1 * 4294967296) | 0;
        c++;
      }
      n++;
    }
    SHA_H0.length = 8;
  })();

  function ror(x, n) { return (x >>> n) | (x << (32 - n)); }

  function sha256Hex(bytes) {
    if (!bytes) return "";
    if (!bytes.length) return "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    var H = SHA_H0.slice(0), K = SHA_K;
    var len = bytes.length, bitLen = len * 8;
    /* 填充后需容纳 1 字节 0x80 + 8 字节长度；len%64==55 时正好跨块，
       用 ((len+9)>>6)+1 会少算一块，必须改用向上取整。 */
    var total = Math.ceil((len + 9) / 64) * 64;
    var buf = new Uint8Array(total);
    buf.set(bytes);
    buf[len] = 0x80;
    var dv = new DataView(buf.buffer);
    dv.setUint32(total - 4, bitLen >>> 0, false);
    dv.setUint32(total - 8, Math.floor(bitLen / 4294967296), false);
    var w = new Array(64);
    for (var off = 0; off < total; off += 64) {
      for (var i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
      for (var j = 16; j < 64; j++) {
        var s0 = ror(w[j - 15], 7) ^ ror(w[j - 15], 18) ^ (w[j - 15] >>> 3);
        var s1 = ror(w[j - 2], 17) ^ ror(w[j - 2], 19) ^ (w[j - 2] >>> 10);
        w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
      }
      var a = H[0], b = H[1], c2 = H[2], d2 = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (var k = 0; k < 64; k++) {
        var S1 = ror(e, 6) ^ ror(e, 11) ^ ror(e, 25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + K[k] + w[k]) | 0;
        var S0 = ror(a, 2) ^ ror(a, 13) ^ ror(a, 22);
        var maj = (a & b) ^ (a & c2) ^ (b & c2);
        var t2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d2 + t1) | 0;
        d2 = c2; c2 = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0;
      H[2] = (H[2] + c2) | 0; H[3] = (H[3] + d2) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0;
      H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    var out = "";
    for (var m = 0; m < 8; m++) out += ("00000000" + (H[m] >>> 0).toString(16)).slice(-8);
    return out;
  }

  /* 返回 "sha256-xxx"，算不出来时返回空串（此时退回外链方案） */
  function scriptHash(src) {
    try {
      if (!window.TextEncoder) return "";
      var hex = sha256Hex(new TextEncoder().encode(src));
      if (!hex) return "";
      var bin = "";
      for (var i = 0; i < hex.length; i += 2) bin += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
      return "sha256-" + btoa(bin);
    } catch (e) { return ""; }
  }

  /* 内联脚本的「内容 + 哈希」必须成套使用，因此只读一次、结果缓存：
     先前 CSP 与 <script> 各调用一次 fixScriptSource()，一旦读到的字节
     有差异（BOM、换行、asar 打包注入），CSP 哈希就和实际内容对不上，
     整段脚本被拦，排版修正不生效 —— 这正是「写作思路整页空白」的成因。 */
  var FIX_BUNDLE = null;
  function fixBundle() {
    if (FIX_BUNDLE) return FIX_BUNDLE;
    var src = fixScriptSource();
    var hash = src ? scriptHash(src) : "";
    FIX_BUNDLE = { src: src, hash: hash };
    return FIX_BUNDLE;
  }

  /* CSP 的 script-src 部分。
     内联可用时用 sha256 白名单放行；
     读不到源码时走外链，此时必须额外放行该地址——
     file:// 打开时 origin 为 null，'self' 匹配不到任何源，
     脚本会被拦、fix() 不执行、卡片叠在一起。 */
  function scriptCspTokens() {
    var b = fixBundle();
    if (b.hash) return "'self' '" + b.hash + "'";
    /* 外链兜底：只能用源表达式（'self' / file: / http:），
       不能写完整文件路径，否则 CSP 判定为非法源并整条忽略。 */
    return "'self' file: blob:";
  }

  function fixScriptTag() {
    var b = fixBundle();
    if (b.src && b.hash) return "<script>" + b.src + "<\/script>";
    /* 拿不到内容或算不出哈希：退回外链（同源，满足 'self'），
       否则脚本被 CSP 拦掉，报告卡片会叠在一起。 */
    return '<script src="' + FIX_SCRIPT_URL + '"><\/script>';
  }

  function build(res, opt) {
    opt = opt || {};
    var images = opt.images || [];
    var parts = [];

    /* 原稿白板：第 1 页优先，逐页独立 */
    var hasBoard = opt.withBoard && images.length && (res.annotations || []).length;
    if (hasBoard) {
      for (var i = 0; i < images.length; i++) {
        var one = sheetPage(res, { images: images, page: i, total: images.length });
        if (one) parts.push(one);
      }
    } else {
      /* 稿源文本批改（或图片缺失）：导出文本原稿批注页，
         保证作文原文永远出现在报告里，不再整页缺失 */
      var tPage = textSheetPage(res, { text: opt.text || "" });
      if (tPage) parts.push(tPage);
    }

    /* 报告四页：概览 / 思路 / 练笔 / 润色 */
    parts.push(overviewPage(res, { radar: opt.radar, weights: opt.weights }));
    parts.push(outlinePage(res));
    parts.push(drillPage(res));
    parts.push(polishedPage(res));

    return "<!DOCTYPE html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\">" +
      /* 导出文档自带 CSP：父页面的 script-src 'self' 会继承到 blob 文档，
         导致排版修正脚本被拦截、卡片位置错乱、截图失败。
         script-src 放开 'unsafe-inline'，是为了让修正脚本以源码内联进报告；
         其余仍按最严格处理（不加载任何外部脚本、样式与字体）。 */
      "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; " +
        "img-src 'self' data: blob:; style-src 'unsafe-inline'; " +
        "script-src " + scriptCspTokens() + "; font-src data:\">" +
      "<title>" + esc(res.title || "作文") + " · 笔墨生香报告</title>" +
      "<style>" + baseCss() + "</style></head><body>" +
      /* 全部内容放进一个 .doc 容器，连续展示，不分页 */
      '<div class="doc">' +
        '<header class="doc-head">' +
          '<h1>作文批改报告</h1>' +
          '<div class="doc-meta">' + [
            (res.student && res.student !== "未署名") ? esc(res.student) : "",
            esc(res.meta || ""),
            "全文 " + (res.wordCount || 0) + " 字"
          ].filter(Boolean).join("　") + "</div>" +
        "</header>" +
        parts.join(NL) +
      "</div>" +
      /* 打开后自动排一次版：卡片防重叠 + 页面高度贴合内容。
       * 优先内联源码，保证导出文件自包含、换机/离线可用；
       * 读不到源码时退回外链（同源绝对地址，安装包内同样满足 'self'）。 */
      fixScriptTag() +
    "</body></html>";
  }

  ZP.ReportExport = {
    build: build,
    PAGE_W: PAGE_W,
    sheetPage: sheetPage,
    textSheetPage: textSheetPage,
    overviewPage: overviewPage,
    outlinePage: outlinePage,
    drillPage: drillPage,
    polishedPage: polishedPage
  };
})(window.ZP);
