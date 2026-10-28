/* ============================================================
   智批作文 · 报告导出（所见即所得）
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

  /* ---------------- 基础样式 ---------------- */
  function baseCss() {
    return ""
      + "*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}"
      + "body{margin:0;background:#f3f0e9;font-family:'PingFang SC','Microsoft YaHei',sans-serif;"
      +   "color:#2b3038;font-size:13px;line-height:1.75}"
      /* 每页独立成块，打印时各自一页 */
      /* 不分页：所有内容放进同一张长文档，一次性连续展示 */
      + ".doc{width:" + PAGE_W + "px;margin:0 auto;background:#fffdf9;"
      +   "border:1px solid #e7e3da;border-radius:10px;"
      +   "padding:" + L.padY + "px " + L.padX + "px}"
      /* 文档总标题 */
      + ".doc-head{margin:0 0 22px;text-align:center}"
      + ".doc-head h1{margin:0;font-size:21px;font-weight:650;letter-spacing:.14em;color:#2b3038}"
      + ".doc-meta{margin-top:7px;font-size:11px;color:#a9a293;letter-spacing:.04em}"
      + ".sheet{width:100%;margin:0;padding:0;background:transparent;border:0}"
      /* 段落之间用分隔线隔开（原来靠分页区分） */
      + ".sheet + .sheet{margin-top:26px;padding-top:24px;border-top:1px solid #eee5d5}"
      /* 页眉 */
      + ".sheet-head{display:flex;align-items:flex-end;justify-content:space-between;"
      +   "gap:14px;padding-bottom:2px;margin-bottom:14px}"
      + ".sheet-head h2{margin:0;font-size:15px;letter-spacing:.1em;color:#2b3038}"
      + ".sheet-head .sh-sub{font-size:10.5px;color:#a9a293;letter-spacing:.04em}"
      + ".sheet-head .sh-tag{font-size:10px;color:#8d8477;flex:0 0 auto}"
      + "@media print{body{background:#fff}"
      +   ".doc{border:0;border-radius:0;width:auto}}"
      + "@page{margin:10mm}";
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
          '<div class="ecard-note">' + esc(it.a.note || "") + "</div>" +
          (fixTxt ? '<div class="ecard-fix' + (isRed ? " fix-short" : "") + '"><i>' +
            (isRed ? "正确写法" : "改写例句") + "</i>" + esc(fixTxt) + "</div>" : "") +
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

    var css = ""
      + ".eboard{position:relative;display:flex;align-items:flex-start;gap:" + L.gap + "px;"
      +   "width:" + L.boardW + "px;min-width:" + L.boardW + "px;margin:0 auto;"
      +   "min-height:" + sheetH + "px}"
      + ".ecol{position:relative;flex:0 0 " + L.cardW + "px;width:" + L.cardW + "px;height:" + sheetH + "px}"
      + ".esheet{position:relative;flex:0 0 " + L.sheetW + "px;width:" + L.sheetW + "px;height:" + sheetH + "px;"
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
      +   "font-size:11px;line-height:1.62}"
      + ".ecard-no{position:absolute;top:-6px;left:-6px;min-width:14px;height:14px;padding:0 3px;"
      +   "display:flex;align-items:center;justify-content:center;border-radius:7px;color:#fff;"
      +   "font-family:ui-monospace,Menlo,Consolas,monospace;font-size:8px;font-weight:700;"
      +   "box-shadow:0 1px 3px rgba(20,22,26,.25)}"
      + ".ecard-tag{font-size:9px;font-weight:600;letter-spacing:.04em;margin-bottom:3px}"
      + ".ecard-note{color:#3f4652}"
      + ".ecard-fix{margin-top:6px;padding:5px 7px;background:#faf7ef;border-left:2px solid #dcc9a5;"
      +   "border-radius:0 4px 4px 0;font-size:10.5px;line-height:1.55;color:#6b6047}"
      + ".ecard-fix i{display:block;font-style:normal;font-size:9px;color:#a89e8b;margin-bottom:2px}"
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
     二、报告各 Tab（每个 Tab 独立一页）
     ============================================================ */
  function tabCss() {
    return ""
      + ".blk{margin-bottom:18px}"
      + ".blk:last-child{margin-bottom:0}"
      + ".blk-head{display:flex;align-items:center;gap:8px;margin-bottom:9px}"
      + ".blk-head h4{margin:0;font-size:11.5px;font-weight:650;letter-spacing:.1em;color:#3f3b35}"
      + ".blk-head i{flex:1;height:1px;background:linear-gradient(90deg,#e0d8c8,transparent)}"
      + ".blk-head .meta{font-size:9.5px;color:#8d8477;letter-spacing:.03em}"
      + ".card{background:#fff;border:1px solid #ebe5d8;border-radius:9px;padding:12px 14px;"
      +   "box-shadow:0 1px 2px rgba(60,45,25,.04)}"
      /* 分数区 */
      + ".score-row{display:flex;align-items:center;gap:14px;margin-bottom:16px}"
      + ".big{font-size:40px;font-weight:650;line-height:1;letter-spacing:-.02em;color:#2b3038}"
      + ".big small{font-size:12px;color:#8d8477;font-weight:400;margin-left:2px}"
      + ".lv{padding:3px 11px;border-radius:5px;font-size:11.5px;font-weight:600;"
      +   "background:linear-gradient(180deg,#f9f0dd,#f1e2c4);color:#75501c;border:1px solid #d9c39b}"
      + ".lv.l1{background:linear-gradient(180deg,#faeae1,#f2d8c8);color:#7d321c;border-color:#dcb8a0}"
      + ".lv.l2{background:linear-gradient(180deg,#eaf0e2,#d9e4cd);color:#3d4f35;border-color:#bccdab}"
      + ".lv.l3{background:linear-gradient(180deg,#f4f2ee,#e9e5dc);color:#5f574c;border-color:#d4cdbd}"
      + ".mini{display:flex;flex-wrap:wrap;gap:10px 14px;font-size:10.5px;color:#6f6a60}"
      + ".mini span{display:inline-flex;align-items:center}"
      + ".mini i{display:inline-block;width:6px;height:6px;border-radius:2px;margin-right:5px;"
      +   "box-shadow:0 0 0 1px rgba(255,255,255,.85) inset}"
      + ".radar{display:block;margin:4px auto 12px;max-width:100%}"
      /* 总评 */
      + ".overall{white-space:pre-wrap;font-size:12.5px;line-height:1.95;color:#454b55}"
      /* 四维卡片 */
      + ".dim{background:#fff;border:1px solid #ebe5d8;border-radius:9px;padding:10px 12px;"
      +   "margin-bottom:8px;border-left:3px solid var(--c);box-shadow:0 1px 2px rgba(60,45,25,.04)}"
      + ".dim:last-child{margin-bottom:0}"
      + ".dh{display:flex;align-items:baseline;gap:8px;margin-bottom:4px}"
      + ".dh .nm{font-size:11.5px;font-weight:600;color:var(--c);letter-spacing:.03em}"
      + ".dh b{margin-left:auto;font-size:12px;font-weight:650;color:var(--c)}"
      + ".dh b em{font-style:normal;font-size:9.5px;color:#a89e8b;font-weight:400}"
      + ".dh .w{color:#8d8477;font-size:10px}"
      + ".dim p{margin:0;font-size:11.5px;color:#5d6470;line-height:1.7}"
      + ".dim .tagline{display:inline-block;margin-top:6px;font-size:9.5px;font-weight:600;"
      +   "color:var(--c);background:#fbf9f4;border:1px solid #dfd7c6;"
      +   "padding:2px 7px;border-radius:4px;letter-spacing:.03em}"
      /* 小练笔 */
      + ".drill{background:#fff;border:1px solid #ebe5d8;border-radius:9px;padding:11px 13px;"
      +   "margin-bottom:9px;box-shadow:0 1px 2px rgba(60,45,25,.04)}"
      + ".drill:last-child{margin-bottom:0}"
      + ".drill h5{margin:0 0 6px;font-size:12px;color:#2b3038}"
      + ".drill p{margin:0 0 4px;font-size:11.5px;color:#5d6470;line-height:1.75}"
      + ".drill p:last-child{margin-bottom:0}"
      + ".drill p b{color:#3f3b35;font-weight:600}"
      + ".drill .mat{background:#faf7ef;border-left:2px solid #d9c39b;padding:6px 9px;"
      +   "border-radius:0 4px 4px 0;color:#6b6047}"
      /* 润色稿 */
      + ".pol{background:#fff;border:1px solid #ebe5d8;border-radius:9px;padding:18px 22px;"
      +   "font-family:'Songti SC',SimSun,serif;font-size:13.5px;line-height:2.05;color:#2b3038;"
      +   "box-shadow:0 1px 2px rgba(60,45,25,.04)}"
      + ".pol h6{text-align:center;font-size:15px;margin:0 0 12px;font-weight:700;letter-spacing:.04em}"
      + ".pol p{margin:0 0 7px;text-indent:2em}"
      + ".pol p:last-child{margin-bottom:0}";
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
      '<div class="score-row">' +
        '<div class="big">' + (res.score || 0) + "<small>/100</small></div>" +
        '<div class="' + lvCls + '">' + esc(lvText) + "</div>" +
        '<div class="mini">' + ZP.DIMS.map(function (d) {
          var hit = (res.dims || []).filter(function (x) { return x.key === d.key; })[0] || { score: 0 };
          var c = DIM_COLORS[d.key] || d.color;
          return '<span><i style="background:' + c + '"></i>' + esc(d.name) + " " + hit.score + "</span>";
        }).join("") + "</div>" +
      "</div>" +
      (opt.radar ? '<img class="radar" src="' + opt.radar + '" alt="四维雷达图" style="width:340px">' : "") +
      '<div class="blk"><div class="blk-head"><h4>整篇研判</h4><i></i>' +
        '<span class="meta">用字 ' + (m.words || 0) + " · 段落 " + (m.paras || 0) + "</span></div>" +
        '<div class="card overall">' + esc(res.overall || "") + "</div></div>" +
      '<div class="blk"><div class="blk-head"><h4>四维评分</h4><i></i>' +
        '<span class="meta">按权重折算</span></div>' + dimRows + "</div>" +
    "</section>";
  }

  /* 写作思路页 */
  function outlinePage(res) {
    var ol = res.outline || {};
    var blk = function (o, fallback) {
      if (!o) return "";
      return '<div class="drill"><h5>' + esc(o.title || fallback) + "</h5>" +
        "<p>" + esc(o.text || "") + "</p></div>";
    };
    var keys = (ol.keys || []).length
      ? '<div class="drill"><h5>写作小技巧</h5><p>' +
        (ol.keys || []).map(esc).join("<br>") + "</p></div>"
      : "";
    return '<section class="sheet">' +
      head("写作思路", [
        esc(res.title || ""),
        (res.student && res.student !== "未署名") ? esc(res.student) : ""
      ].filter(Boolean).join("　")) +
      '<style>' + tabCss() + "</style>" +
      '<div class="blk"><div class="blk-head"><h4>段落功能梳理</h4><i></i></div>' +
        blk(ol.begin, "开头思路") + blk(ol.middle, "中间思路") + blk(ol.end, "结尾思路") +
        keys + "</div>" +
    "</section>";
  }

  /* 小练笔页 */
  function drillPage(res) {
    var list = res.drills || [];
    var html = list.length
      ? list.map(function (d, i) {
        return '<div class="drill"><h5>练习 ' + (i + 1) + "　" + esc(d.title || "") + "</h5>" +
          (d.problem ? "<p><b>本文问题：</b>" + esc(d.problem) + "</p>" : "") +
          (d.think ? "<p><b>写作思路：</b>" + esc(d.think) + "</p>" : "") +
          (d.material ? '<p class="mat"><b>素材句式：</b>' + esc(d.material) + "</p>" : "") +
          (d.task ? "<p><b>练习要求：</b>" + esc(d.task) + "</p>" : "") +
        "</div>";
      }).join("")
      : '<div class="card">本次未生成小练笔。</div>';
    return '<section class="sheet">' +
      head("小练笔", esc(res.title || "") + "　共 " + list.length + " 题") +
      '<style>' + tabCss() + "</style>" +
      '<div class="blk"><div class="blk-head"><h4>针对本文短板的三道练习</h4><i></i></div>' +
        html + "</div>" +
    "</section>";
  }

  /* 润色后文章页 */
  function polishedPage(res) {
    var pol = res.polished || { paras: [] };
    var paras = pol.paras || [];
    var words = ZP.countChars(paras.join(""));
    return '<section class="sheet">' +
      head("润色后文章", esc(res.title || "") + "　" + words + " 字") +
      '<style>' + tabCss() + "</style>" +
      '<div class="blk"><div class="blk-head"><h4>升格范文</h4><i></i></div>' +
        '<div class="pol"><h6>' + esc(pol.title || res.title || "") + "</h6>" +
          (paras.length ? paras.map(function (t) { return "<p>" + esc(t) + "</p>"; }).join("")
                        : '<p style="text-align:center;color:#a9a293">本次未生成升格范文。</p>') +
        "</div></div>" +
    "</section>";
  }

  /* ============================================================
     三、组装完整文档
     ============================================================ */
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
    }

    /* 报告四页：概览 / 思路 / 练笔 / 润色 */
    parts.push(overviewPage(res, { radar: opt.radar, weights: opt.weights }));
    parts.push(outlinePage(res));
    parts.push(drillPage(res));
    parts.push(polishedPage(res));

    return "<!DOCTYPE html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\">" +
      "<title>" + esc(res.title || "作文") + " · 智批作文报告</title>" +
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
      /* 打开后自动排一次版：卡片防重叠 + 页面高度贴合内容 */
      "<scr" + "ipt>(function(){function fix(){" +
      "document.querySelectorAll('.eboard').forEach(function(bd){" +
        "var sheet=bd.querySelector('.esheet');var H=sheet?sheet.offsetHeight:0;if(!H)return;" +
        "var maxCol=H,GAPMIN=10,GAPMAX=14;" +
        "bd.querySelectorAll('.ecol').forEach(function(col){" +
          "var cs=[].slice.call(col.querySelectorAll('.ecard'));if(!cs.length)return;" +
          /* 量真实高度：先清 transform */
          "cs.forEach(function(c){c.style.transform='none';c.style.top='0px';});" +
          "var hs=cs.map(function(c){return c.offsetHeight;});" +
          "var total=hs.reduce(function(a,b){return a+b;},0);" +
          /* 理想位置：中心对齐划线 */
          "var want=cs.map(function(c,i){var p=parseFloat(c.getAttribute('data-top'))||0;" +
            "return p/100*H-hs[i]/2;});" +
          /* 排布策略：放得下就对齐划线；放不下就顺序下排（允许越过下沿，绝不重叠） */
          "var needMin=total+GAPMIN*(cs.length-1);" +
          "var fits=needMin<=H;" +
          "var tops=want.slice();var prev=-1e9;" +
          "if(fits){" +
            "for(var i=0;i<tops.length;i++){if(tops[i]<prev+GAPMAX)tops[i]=prev+GAPMAX;" +
              "if(tops[i]<0)tops[i]=0;prev=tops[i]+hs[i];}" +
            "var o0=prev-H;" +
            "if(o0>0.5){var s0=Math.min(o0,tops[0]);if(s0>0)tops=tops.map(function(t){return t-s0;});}" +
          "}else{" +
            "var acc=0;" +
            "for(var j=0;j<tops.length;j++){tops[j]=acc;acc=acc+hs[j]+GAPMIN;}" +
          "}" +
          "cs.forEach(function(c,i){c.style.transform='none';c.style.top=Math.round(tops[i])+'px';});" +
          /* 侧栏：至少与纸面同高；放不下时允许向下延伸，但不撑高纸面 */
          "var need=Math.ceil(tops[tops.length-1]+hs[hs.length-1]+8);" +
          "var ch=Math.max(H,need);" +
          "col.style.height=ch+'px';col.style.minHeight=ch+'px';" +
          "if(ch>maxCol)maxCol=ch;" +
        "});" +
        /* 纸面高度锁死：图片比例不变 */
        "if(sheet){sheet.style.minHeight='';sheet.style.height=H+'px';}" +
        "bd.style.minHeight=Math.max(H,maxCol)+'px';" +
      "});" +
    "}if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',fix);}else{fix();}" +
    "window.addEventListener('load',fix);})();</scr" + "ipt>" +
    "</body></html>";
  }

  ZP.ReportExport = {
    build: build,
    PAGE_W: PAGE_W,
    sheetPage: sheetPage,
    overviewPage: overviewPage,
    outlinePage: outlinePage,
    drillPage: drillPage,
    polishedPage: polishedPage
  };
})(window.ZP);
