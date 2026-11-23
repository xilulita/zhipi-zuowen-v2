/* ============================================================
   笔墨生香 · 渲染模块
   纸张骨架 / 正文与批注 / 引线定位 / 报告面板
   通过 ZP.Render.bind(state) 注入应用状态
   ============================================================ */
(function (ZP) {
  "use strict";

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var S = { weights: ZP.DEFAULT_WEIGHTS, zoom: 1, view: "text" };

  var TYPE_LABEL = { red: "错别字 / 病句", amber: "润色语句", green: "优秀好句", violet: "修改建议" };
  var TYPE_SHORT = { red: "错别字", amber: "润色", green: "好句", violet: "建议" };
  var TYPE_COLOR = { red: "#cf4436", amber: "#c8912a", green: "#2f8f6b", violet: "#7a5cc4" };

  /* ---------------- 批注优先级 ----------------
     学生面对一屏十几条批注常常无从下手，所以给每条判一个「要不要改」
     的优先级，并把最该动手的几条顶到前面。
     判据按「能不能马上改、改完有没有明显收益」排序：
       错别字     → 必改：一次就能改对，且直接扣规范分
       病句       → 必改：句子不通，读者会卡住
       修改建议   → 建议改：涉及内容与结构，需要想一想
       润色语句   → 可选：锦上添花
       优秀好句   → 保留：不需要动，是范例
     类型判断优先看 tag（模型会给出更细的「病句」「错别字」）。 */
  var PRIO_ORDER = ["must", "should", "optional", "keep"];
  var PRIO_META = {
    must:     { label: "必改", cls: "p-must",   hint: "先改这些" },
    should:   { label: "建议改", cls: "p-should", hint: "有余力再改" },
    optional: { label: "可选", cls: "p-opt",    hint: "锦上添花" },
    keep:     { label: "保留", cls: "p-keep",   hint: "不用动，是范例" }
  };

  function annPriority(a) {
    if (!a) return "optional";
    var tag = String(a.tag || "");
    if (a.type === "red") return "must";
    if (tag.indexOf("病句") >= 0) return "must";
    if (tag.indexOf("错别字") >= 0) return "must";
    if (a.type === "violet" || tag.indexOf("建议") >= 0) return "should";
    if (a.type === "green" || tag.indexOf("好句") >= 0) return "keep";
    if (a.type === "amber") return "optional";
    return "optional";
  }

  /* 统计各类优先级条数（供筛选条与提示使用） */
  function prioCounts(list) {
    var c = { must: 0, should: 0, optional: 0, keep: 0 };
    (list || []).forEach(function (a) {
      var p = annPriority(a);
      if (c[p] !== undefined) c[p]++;
    });
    return c;
  }

  function fmt(n) { return (n || 0).toLocaleString("zh-CN"); }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  /* 允许批注里极少量内联标记：<del> <ins> <b> */
  function rich(s) {
    return esc(s)
      .replace(/&lt;(\/?)(del|ins|b)&gt;/g, "<$1$2>");
  }

  /* 以 rect 实测，兼容行内元素与 CSS zoom 缩放 */
  /* ---------------- 批注微调（人工拖动后的偏移） ----------------
     每条批注可带 adj 字段，单位是原稿图片的百分比：
       adj.band  = { y, x1, x2 }  荧光划线的位置与长度
       adj.no    = { dx, dy }    编号相对划线端点的位移
       adj.card  = { dy }        批注卡在纸面上的纵向位移（px，未缩放）
     偏移量随结果一起存进历史与作文队列，刷新后依然生效。 */
  /* 编号元素的实际占位宽度（px） */
  var NUM_W = 21;

  /* 写作思路分段用：按换行或「1. 2. 3.」序号切分（用 RegExp 构造，避免源码转义） */
  var NL_OR_NUM = new RegExp(String.fromCharCode(10) + "|(?=[0-9]{1,2}[.、])");

  function num() {
    for (var i = 0; i < arguments.length; i++) {
      var v = arguments[i];
      if (typeof v === "number" && isFinite(v)) return v;
      if (typeof v === "string" && v.trim() !== "" && isFinite(Number(v))) return Number(v);
    }
    return 0;
  }

  /* 批注里的「修改内容」块：
     - 错别字 / 病句（red）：只给正确写法，标签用「正确写法」，不再套「改写例句」
     - 润色、建议（amber / violet）：仍给完整的改写例句
     这样错别字一眼看到就是「改成什么」，不用读一整句范文。 */
  function fixBlock(item, escFn, esc2) {
    var fix = item && item.fix ? String(item.fix).trim() : "";
    if (!fix) return "";
    var isRed = item.type === "red";
    var label = isRed ? "正确写法" : "改写例句";
    var e = escFn || function (t) { return String(t); };
    var inner = esc2 ? esc2(fix) : e(fix);
    return '<div class="annot-fix' + (isRed ? " fix-short" : "") + '">' +
      '<span class="fix-label">' + label + "</span>" + inner + "</div>";
  }

  function adjOf(a) {
    if (!a.adj || typeof a.adj !== "object") a.adj = {};
    if (!a.adj.band || typeof a.adj.band !== "object") a.adj.band = {};
    if (!a.adj.no || typeof a.adj.no !== "object") a.adj.no = {};
    if (!a.adj.card || typeof a.adj.card !== "object") a.adj.card = {};
    return a.adj;
  }

  function bandPos(a, fb) {
    var ad = (a && a.adj) || null;
    var b = (ad && ad.band) || null;
    if (!b) return fb;
    var n = function (v, d) { return (typeof v === "number" && isFinite(v)) ? v : d; };
    return {
      y: Math.max(0, Math.min(97, n(b.y, fb.y))),
      x1: Math.max(0, Math.min(98, n(b.x1, fb.x1))),
      x2: Math.max(1, Math.min(100, n(b.x2, fb.x2)))
    };
  }

  function noShift(a) {
    var ad = (a && a.adj) || null;
    var n = (ad && ad.no) || null;
    return {
      dx: n && typeof n.dx === "number" && isFinite(n.dx) ? n.dx : 0,
      dy: n && typeof n.dy === "number" && isFinite(n.dy) ? n.dy : 0
    };
  }

  function cardShift(a) {
    var ad = (a && a.adj) || null;
    var c = (ad && ad.card) || null;
    return c && typeof c.dy === "number" && isFinite(c.dy) ? c.dy : 0;
  }

  /* 是否有任何手工微调（用于显示「已微调」提示与一键还原） */
  function hasAdj(a) {
    if (!a || !a.adj) return false;
    var b = a.adj.band || {}, n = a.adj.no || {}, c = a.adj.card || {};
    return typeof b.y === "number" || typeof b.x1 === "number" || typeof b.x2 === "number" ||
           typeof n.dx === "number" || typeof n.dy === "number" || typeof c.dy === "number";
  }

  /**
   * 引线层的坐标体系必须与「测量时」完全一致。
   * 之前用 offsetWidth/offsetHeight 当 viewBox，再配 preserveAspectRatio="none"，
   * 只要这两个值与真实渲染尺寸差一点（内边距、边框、图片加载后高度变化），
   * 整张引线图就会被非等比拉伸，虚线随之歪出图片两侧。
   * 这里直接取 getBoundingClientRect 的实际像素尺寸，保证坐标 1:1。
   */
  /* 让批注列按内容高度撑开。
   * .annot 是绝对定位，不会推动父元素；这里放一个 0 宽的占位块撑高列，
   * 列高了 → .paper-grid 行高变高 → .paper 变高 → .stage-scroll 可滚动。
   * 同时保证纸张本身至少和批注列一样高，避免批注超出纸面被裁。 */
  function fitAnnCols(leftCol, rightCol, bottomL, bottomR) {
    [ [leftCol, bottomL], [rightCol, bottomR] ].forEach(function (pair) {
      var col = pair[0], bottom = pair[1];
      if (!col) return;
      var need = Math.ceil(bottom + 12);
      var spacer = col.querySelector(".ann-spacer");
      if (!spacer) {
        spacer = document.createElement("div");
        spacer.className = "ann-spacer";
        spacer.setAttribute("aria-hidden", "true");
        col.appendChild(spacer);
      }
      spacer.style.height = Math.max(0, need) + "px";
    });
    var paper = document.querySelector("#paper");
    if (paper) {
      var h = Math.ceil(Math.max(bottomL || 0, bottomR || 0) + 12);
      // 纸张内容区至少与批注一样高，否则批注会伸到纸外
      paper.style.minHeight = h ? h + "px" : "";
    }
  }

  function syncLeaderViewBox(paper, svg) {
    if (!paper || !svg) return;
    var r = paper.getBoundingClientRect();
    if (!r.width || !r.height) return;
    svg.setAttribute("viewBox", "0 0 " + r.width + " " + r.height);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.style.width = "100%";
    svg.style.height = "100%";
    svg.dataset.vbW = String(Math.round(r.width));
    svg.dataset.vbH = String(Math.round(r.height));
  }


  function measure(ancestor, el) {
    var b = ancestor.getBoundingClientRect();
    var scale = ancestor.offsetWidth ? (b.width / ancestor.offsetWidth) : 1;
    if (!scale || !isFinite(scale)) scale = 1;
    var r = el.getBoundingClientRect();
    return {
      left: (r.left - b.left) / scale,
      top: (r.top - b.top) / scale,
      w: r.width / scale,
      h: r.height / scale,
      scale: scale
    };
  }
  function lineHeightOf(el) {
    var lh = parseFloat(getComputedStyle(el).lineHeight);
    return isFinite(lh) && lh > 0 ? lh : 24;
  }

  /* ---------------- 纸张骨架 ---------------- */
  function shell() {
    var paper = $("#paper");
    paper.classList.remove("image-mode");
    paper.style.width = "";
    paper.innerHTML =
      '<div class="paper-inner" id="paperInner">' +
        '<div class="paper-grid" id="paperGrid">' +
          '<div class="ann-col" id="annLeft"></div>' +
          '<div class="essay-col" id="essayCol"></div>' +
          '<div class="ann-col" id="annRight"></div>' +
        "</div>" +
      "</div>" +
      '<svg class="leaders" id="leaders" aria-hidden="true"></svg>' +
      '<div class="paper-loading" id="paperLoading" hidden>' +
        '<div class="load-ring"></div>' +
        '<p class="load-title" id="loadTitle">AI 正在批改</p>' +
        '<p class="load-sub" id="loadSub">正在分析结构、语言与规范</p>' +
        '<div class="load-bar"><i id="loadBar"></i></div>' +
      "</div>";
    return paper;
  }

  function head(title, student, meta, words) {
    var div = document.createElement("div");
    div.className = "essay-head";
    div.innerHTML =
      "<h2>" + esc(title) + "</h2>" +
      '<div class="meta"><em>' + esc(student) + "</em><i></i><em>" + esc(meta) +
      "</em><i></i><em>" + fmt(words) + " 字</em></div>";
    return div;
  }

  /* ---------------- 正文 + 批注 ---------------- */
  function essay(result) {
    var paper = shell();
    var col = $("#essayCol");
    col.appendChild(head(result.title, result.student, result.meta, result.wordCount));

    var body = document.createElement("div");
    body.className = "essay-body";
    col.appendChild(body);

    var items = [];
    /* 字段兼容：界面内部用 annotations / paragraphs，
       而历史记录与 AI 归一化结果是 annos / essay.paras。
       只认前者会导致「从历史打开的报告一条批注都不显示」。 */
    var anns = result.annotations || result.annos || [];
    var paras = result.paragraphs || (result.essay && result.essay.paras) || [];

    paras.forEach(function (para, pi) {
      var p = document.createElement("p");
      p.dataset.para = pi;

      if (Array.isArray(para)) {
        para.forEach(function (sent) {
          /* 段落是「句子数组」时，sent.a 直接把整句当标记。
             错别字只该标出错的那几个字，这里同样走词级收窄，
             否则一条错别字会把整句 50+ 字刷红。 */
          if (sent.a && sent.a.type === "red" && String(sent.t || "").length > 8) {
            var pickS = narrowTypo(String(sent.t || ""), sent.a);
            if (pickS && pickS.len < String(sent.t).length) {
              var preTxt = String(sent.t).slice(0, pickS.at);
              var postTxt = String(sent.t).slice(pickS.at + pickS.len);
              if (preTxt) {
                var psp = document.createElement("span");
                psp.className = "sent";
                psp.textContent = preTxt;
                p.appendChild(psp);
              }
              var wsp = document.createElement("span");
              wsp.className = "sent a-red";
              wsp.dataset.typo = "1";
              wsp.textContent = pickS.word;
              p.appendChild(wsp);
              var wdot = document.createElement("span");
              wdot.className = "dot-mark dot-typo red";
              p.appendChild(wdot);
              if (postTxt) {
                var qsp = document.createElement("span");
                qsp.className = "sent";
                qsp.textContent = postTxt;
                p.appendChild(qsp);
              }
              return;
            }
          }
          var span = document.createElement("span");
          span.className = "sent";
          span.textContent = sent.t;
          p.appendChild(span);
          if (sent.a) {
            span.classList.add("a-" + sent.a.type);
            if (sent.a.type === "red") {
              /* 错别字不建卡片，只标句中 */
              span.dataset.typo = "1";
              var tdot = document.createElement("span");
              tdot.className = "dot-mark dot-typo red";
              p.insertBefore(tdot, span);
              return;
            }
            var idx = items.length;
            items.push({
              para: pi, type: sent.a.type, tag: sent.a.tag,
              sentence: sent.t, note: sent.a.note, fix: sent.a.fix
            });
            span.dataset.ann = idx;
            /* 编号放在句子开头，作为定位线起点 */
            var dot = document.createElement("span");
            dot.className = "dot-mark " + sent.a.type;
            dot.textContent = idx + 1;
            dot.dataset.ann = idx;
            p.insertBefore(dot, span);
            bindSentence(span, idx);
            bindDot(dot, idx);
          }
        });
      } else {
        /* 与导出模块共用同一套「句子↔批注」对齐逻辑（ZP.matchMarks），
           保证屏幕上的高亮位置与导出报告完全一致 */
        var built = buildMarked(p, String(para), pi, anns);
        built.items.forEach(function (it) {
          /* 错别字：只留句中标记，序号在「错别字汇总」里统一编，
             这里不占批注卡编号 */
          if (it.typo) {
            it.span.dataset.typo = "1";
            it.dot.className = "dot-mark dot-typo " + it.item.type;
            it.dot.textContent = "";
            return;
          }
          var idx = items.length;
          items.push(it.item);
          it.span.dataset.ann = idx;
          it.dot.textContent = idx + 1;
          /* 圆点也要记编号：优先级筛选要按编号同步隐藏，
             只藏卡片会让正文里留下一排孤立的彩色圆点（实测如此） */
          it.dot.dataset.ann = idx;
          bindSentence(it.span, idx);
          bindDot(it.dot, idx);
        });
      }
      body.appendChild(p);
    });

    var end = document.createElement("div");
    end.className = "essay-end";
    end.innerHTML = "<i></i><span>全文完</span><i></i>";
    col.appendChild(end);

    var wc = document.createElement("div");
    wc.className = "wordcount";
    wc.textContent = "全文约 " + fmt(result.wordCount) + " 字";
    $("#paperInner").appendChild(wc);

    layout(items);
    return paper;
  }

  /* 真实文本：把批注句子切出来；定位不到时按相似度兜底，绝不丢批注。
     纯计算层：返回按位置排序的 marks（start/end/a），不碰 DOM。
     导出模块（report-export.js）复用同一函数，保证高亮口径一致。 */
  function matchMarks(text, pi, anns) {
    var mine = anns.filter(function (a) { return a.para === pi; });
    var marks = [];

    function overlaps(st, en) {
      return marks.some(function (m) { return st < m.end && en > m.start; });
    }
    function addMark(st, en, a) {
      if (en <= st || overlaps(st, en)) return false;
      marks.push({ start: st, end: en, a: a });
      return true;
    }

    /* 1) 精确匹配原文引句 */
    var pending = [];
    mine.forEach(function (a) {
      /* 引句字段：AI 新结果用 sentence，历史记录里存的是 quote，两者都要认 */
      var s = a.sentence || a.quote || "";
      if (!s) { pending.push(a); return; }
      var idx = text.indexOf(s);
      if (idx >= 0 && addMark(idx, idx + s.length, a)) return;
      /* 去掉引号、省略号后再试一次 */
      var clean = s.replace(/[「」『』"“”'‘’…\s]/g, "");
      if (clean && clean !== s) {
        var i2 = text.indexOf(clean);
        if (i2 >= 0 && addMark(i2, i2 + clean.length, a)) return;
      }
      /* 引句常被截断成「我坐在书桌前，笔尖停在纸上，像被什么东西…」，
         直接 indexOf 必然失败。取省略号前的前缀再试，命中后按前缀长度标注。 */
      var head = s.split(/[….]+/)[0].replace(/[「」『』"“”'‘’\s]/g, "");
      if (head && head.length >= 4 && head !== clean) {
        var i3 = text.indexOf(head);
        if (i3 >= 0 && addMark(i3, i3 + head.length, a)) return;
      }
      pending.push(a);
    });

    /* 2) 分句后按字面重合度找最接近的一句 */
    if (pending.length) {
      var clauses = splitClauses(text);
      pending.forEach(function (a) {
        var best = null, bestScore = 0;
        clauses.forEach(function (c) {
          var sc = dice(a.sentence || a.quote || "", c.text);
          if (sc > bestScore) { bestScore = sc; best = c; }
        });
        if (best && bestScore >= 0.30) addMark(best.start, best.end, a);
      });
    }

    /* 3) 仍未定位：整段兜底，保证批注与原文至少能对应上 */
    var stillPending = pending.filter(function (a) {
      return !marks.some(function (m) { return m.a === a; });
    });
    if (stillPending.length && !marks.length) {
      addMark(0, text.length, stillPending[0]);
    }

    marks.sort(function (x, y) { return x.start - y.start; });
    return marks;
  }

  /* 错别字词级收窄：模型给的引句常是整句（演示里「应运题」那条引句
     整整 59 字），直接整句标红会像「整句都是错字」。
     这里从 fix / note 里提取「X 应为 Y」「X→Y」的错词，回到句中定位。 */
  function narrowTypo(text, a) {
    if (!text || !a) return null;
    var cands = [];
    var fix = String(a.fix || "");
    var note = String(a.note || a.html || a.comment || "");
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
      if (at >= 0) return { at: at, len: w.length, word: w };
    }
    return null;
  }

  /* DOM 构建层：按 marks 把段落切成 span，返回带 span/dot 的条目，
     由调用方决定编号、事件绑定（界面）或转成静态 HTML（导出）。 */
  function buildMarked(p, text, pi, anns) {
    var marks = matchMarks(text, pi, anns);
    var out = [];

    function plain(t) {
      var s = document.createElement("span");
      s.className = "sent";
      s.textContent = t;
      p.appendChild(s);
    }

    if (!marks.length) { plain(text); return { marks: marks, items: out }; }

    var cursor = 0;
    marks.forEach(function (m) {
      if (m.start > cursor) plain(text.slice(cursor, m.start));
      /* 错别字：把整句收窄到真正出错的词，只标那几个字。
         不加这一步时，一条错别字批注会把整句 50+ 字划红（实测 59 字）。 */
      var segTxt = text.slice(m.start, m.end);
      if (m.a.type === "red" && segTxt.length > 8) {
        var pick = narrowTypo(segTxt, m.a);
        if (pick && pick.len < segTxt.length) {
          if (pick.at > 0) plain(segTxt.slice(0, pick.at));
          var spWord = document.createElement("span");
          spWord.className = "sent a-red";
          spWord.textContent = pick.word;
          p.appendChild(spWord);
          var dWord = document.createElement("span");
          dWord.className = "dot-mark dot-typo red";
          dWord.textContent = "";
          p.appendChild(dWord);
          if (pick.at + pick.len < segTxt.length) plain(segTxt.slice(pick.at + pick.len));
          return;
        }
      }
      var span = document.createElement("span");
      span.className = "sent a-" + m.a.type;
      span.textContent = segTxt;
      p.appendChild(span);

      var dot = document.createElement("span");
      dot.className = "dot-mark " + m.a.type;
      p.insertBefore(dot, span);
      /* 错别字与导出报告同口径：只在句中留彩色标记，
         不生成左右批注卡（清单集中到「写作建议」页的汇总）。
         否则演示作文里仍会冒出「错别字」卡片，占掉最有价值的语句批注位。 */
      if (m.a.type === "red") {
        out.push({ span: span, dot: dot, typo: true, item: {
          para: pi, type: m.a.type, tag: m.a.tag,
          sentence: m.a.sentence || m.a.quote,
          note: m.a.note || m.a.html || m.a.comment || "", fix: m.a.fix
        }});
        return;
      }
      out.push({
        span: span, dot: dot,
        item: {
          para: pi, type: m.a.type, tag: m.a.tag,
          sentence: m.a.sentence || m.a.quote,
          /* 正文：AI 新结果用 note，历史记录里存的是 html */
          note: m.a.note || m.a.html || m.a.comment || "", fix: m.a.fix
        }
      });
      cursor = m.end;
    });

    if (cursor < text.length) plain(text.slice(cursor));
    return { marks: marks, items: out };
  }

  /* 按中文标点切分句，保留偏移 */
  function splitClauses(text) {
    var out = [], buf = "", start = 0;
    for (var i = 0; i < text.length; i++) {
      buf += text[i];
      if ("。！？；!?;\n".indexOf(text[i]) >= 0) {
        if (buf.trim()) out.push({ start: start, end: start + buf.length, text: buf });
        start = i + 1;
        buf = "";
      }
    }
    if (buf.trim()) out.push({ start: start, end: text.length, text: buf });
    return out.length ? out : [{ start: 0, end: text.length, text: text }];
  }

  /* 字符二元组重合度（Dice），对中文改写较稳健 */
  function dice(a, b) {
    var x = String(a || "").replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, "");
    var y = String(b || "").replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, "");
    if (!x || !y) return 0;
    if (x === y) return 1;
    if (x.length < 2 || y.length < 2) return x === y ? 1 : 0;
    var map = {}, hit = 0;
    for (var i = 0; i < x.length - 1; i++) {
      var g = x.substr(i, 2);
      map[g] = (map[g] || 0) + 1;
    }
    for (var j = 0; j < y.length - 1; j++) {
      var h = y.substr(j, 2);
      if (map[h]) { map[h]--; hit++; }
    }
    return (2 * hit) / ((x.length - 1) + (y.length - 1));
  }

  function bindSentence(span, idx) {
    span.addEventListener("click", function () {
      focusAnn(idx);
    });
  }

  function bindDot(dot, idx) {
    dot.addEventListener("click", function (e) {
      e.stopPropagation();
      focusAnn(idx);
    });
  }

  /* ---------------- 批注排布 + 引线 ---------------- */
  function layout(items) {
    var paper = $("#paper");
    var leftCol = $("#annLeft");
    var rightCol = $("#annRight");
    var svg = $("#leaders");
    if (!paper || !leftCol || !rightCol || !svg) return;

    leftCol.innerHTML = "";
    rightCol.innerHTML = "";
    svg.innerHTML = "";

    var list = items.filter(function (x) { return x.note || x.fix || x.html; });
    if (!list.length) return;

    /* 全部以纸张为参照系：SVG 覆盖整张纸 */
    var lp = measure(paper, leftCol);
    var rp = measure(paper, rightCol);

    var bottomL = 0, bottomR = 0;

    list.forEach(function (item, i) {
      var sent = $('.sent[data-ann="' + i + '"]');
      if (!sent) return;

      var m = measure(paper, sent);
      var lh = lineHeightOf(sent) * (m.scale || 1);
      var firstLineY = m.top + Math.min(lh, m.h) / 2;

      var prio = annPriority(item);
      var pm = PRIO_META[prio] || PRIO_META.optional;
      var el = document.createElement("div");
      el.className = "annot " + item.type + " " + pm.cls;
      el.dataset.ann = i;
      el.dataset.prio = prio;
      el.innerHTML =
        '<span class="annot-no">' + (i + 1) + "</span>" +
        '<span class="annot-tag">' + esc(item.tag || TYPE_SHORT[item.type]) + "</span>" +
        '<span class="prio-chip ' + pm.cls + '">' + pm.label + "</span>" +
        '<div class="annot-body">' + rich(item.note || "") +
        fixBlock(item, esc, rich) +
        "</div>";

      /* 文本稿：左右交替排布，放不下的一侧往下让位 */
      var goLeft = bottomL <= bottomR;
      var colEl = goLeft ? leftCol : rightCol;
      var cp = goLeft ? lp : rp;
      var lastBottom = goLeft ? bottomL : bottomR;

      colEl.appendChild(el);
      var h = el.offsetHeight || 54;
      var top = firstLineY - h / 2 - cp.top;
      /* 只允许向下避让，绝不回顶覆盖上一张卡 */
      if (top < lastBottom + 9) top = lastBottom + 9;
      el.style.top = Math.max(0, top) + "px";

      if (goLeft) bottomL = top + h;
      else bottomR = top + h;

      var annCenter = cp.top + top + h / 2;   /* 已含卡片微调 */
      var startX = goLeft ? cp.left + cp.w : cp.left;
      var endX = goLeft ? m.left - 6 : m.left + m.w + 6;
      var endY = firstLineY;
      var midX = startX + (endX - startX) * 0.5;
      var color = TYPE_COLOR[item.type] || "#7a5cc4";

      var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", "M" + startX + " " + annCenter +
        " C" + midX + " " + annCenter + " " + midX + " " + endY + " " + endX + " " + endY);
      path.setAttribute("stroke", color);
      path.setAttribute("stroke-opacity", ".62");
      path.setAttribute("stroke-dasharray", "3 3");
      /* 引线挂上批注编号：优先级筛选时要连引线一起隐藏，
         否则卡片没了、虚线还悬在原句旁边 */
      path.setAttribute("data-ann", i);
      svg.appendChild(path);

      var dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      dot.setAttribute("cx", endX);
      dot.setAttribute("cy", endY);
      dot.setAttribute("r", "2");
      dot.setAttribute("fill", color);
      dot.setAttribute("fill-opacity", ".85");
      dot.setAttribute("data-ann", i);
      svg.appendChild(dot);

      el.addEventListener("click", function () { focusAnn(i); });
      sent.addEventListener("click", function () { focusAnn(i); });
    });

    /* 批注是 position:absolute，不会撑开父容器。只设 minHeight 时，
       .paper-grid 的行高仍由纸张决定，超出的批注会被裁在网格外：
       既看不见、也让外层 .stage-scroll 没有可滚动内容。
       这里按批注实际底部撑开列高，再同步撑开纸张内边距，
       让整页变高后画板能纵向滚动。 */
    fitAnnCols(leftCol, rightCol, bottomL, bottomR);

    syncLeaderViewBox(paper, svg);

    /* 文本稿的批注直接以「彩色底纹 + 波浪线」标在原句上，无需荧光层；
       荧光笔只用于原稿图片（见 paintHighlights） */

    /* 批注一多学生看不过来：先给出「先改哪几处」，再让他们按需筛选 */
    refreshPrioBar(items);
  }

  /* ============================================================
     批注优先级条：摘要 + 按级别筛选
     ------------------------------------------------------------
     一屏十几条批注时，学生不知道从哪下手。这里先算出「必改 2 处、
     建议改 3 处…」，把最该动手的顶到前面，其余可一键隐藏。 */
  var prioFilter = "all";     /* all | must | should | optional | keep */

  function refreshPrioBar(items) {
    var bar = $("#prioBar");
    var tabs = $("#prioTabs");
    var lead = $("#prioLead");
    if (!bar || !tabs || !lead) return;

    var list = (items || []).filter(function (x) { return x.note || x.fix || x.html; });
    /* ★ 错别字已被移出批注卡（只在句中留角标、清单进「写作建议」页），
       但它恰恰是最该先改的一类。这里把它补计进「必改」，
       否则优先级条会显示「没有硬伤」，与事实相反。 */
    var typoN = 0;
    var annsCur = annList(S.result);
    var parasCur = paraList(S.result);
    if (annsCur.length) {
      if (parasCur.length) {
        parasCur.forEach(function (pp, pi) {
          var tx = Array.isArray(pp) ? pp.map(function (x) { return x.t || ""; }).join("") : String(pp || "");
          matchMarks(tx, pi, annsCur).forEach(function (m) { if (m.a.type === "red") typoN++; });
        });
      } else {
        annsCur.forEach(function (a) { if (a.type === "red") typoN++; });
      }
    }
    if (!list.length && !typoN) { bar.hidden = true; return; }

    var c = prioCounts(list);
    c.must += typoN;
    /* 摘要句：直接告诉学生先动几处 */
    var mustN = c.must, shouldN = c.should;
    if (mustN) {
      lead.textContent = "先改这 " + mustN + " 处" + (shouldN ? "，再处理 " + shouldN + " 处建议" : "");
      lead.className = "prio-lead hot";
    } else if (shouldN) {
      lead.textContent = "先从这 " + shouldN + " 处建议改起";
      lead.className = "prio-lead";
    } else if (c.optional) {
      lead.textContent = "没有硬伤，可以打磨 " + c.optional + " 处语句";
      lead.className = "prio-lead calm";
    } else {
      lead.textContent = "通篇没有需要改的地方";
      lead.className = "prio-lead calm";
    }

    /* 「全部」要把错别字也算上：它有角标、也在汇总里，
       只报卡片数会与「必改 1」自相矛盾（7 vs 1）。 */
    var opts = [{ k: "all", label: "全部", n: list.length + typoN }];
    PRIO_ORDER.forEach(function (k) {
      if (c[k]) opts.push({ k: k, label: PRIO_META[k].label, n: c[k] });
    });

    tabs.innerHTML = opts.map(function (o) {
      var on = prioFilter === o.k ? " on" : "";
      return '<button type="button" class="prio-tab' + on + '" data-prio="' + o.k + '">' +
        o.label + '<b>' + o.n + "</b></button>";
    }).join("");
    bar.hidden = false;

    /* 按钮事件只绑一次：用 onclick 覆盖，避免重复绑定 */
    tabs.onclick = function (e) {
      var btn = e.target.closest("[data-prio]");
      if (!btn) return;
      var k = btn.getAttribute("data-prio");
      prioFilter = (prioFilter === k && k !== "all") ? "all" : k;
      applyPrioFilter();
      refreshPrioBar(items);
    };

    applyPrioFilter();
  }

  function countVisibleCards(paper) {
    var n = 0;
    paper.querySelectorAll(".annot").forEach(function (el) {
      if (el.style.display !== "none") n++;
    });
    return n;
  }

  /* 按当前筛选隐藏/显示批注：卡片、引线、原句标记一起处理，
     只藏卡片会留下孤零零的虚线和底色。 */
  function applyPrioFilter() {
    var paper = $("#paper");
    if (!paper) return;
    var keep = prioFilter;
    paper.querySelectorAll(".annot").forEach(function (el) {
      var p = el.getAttribute("data-prio") || "optional";
      el.style.display = (keep === "all" || p === keep) ? "" : "none";
    });
    var svg = $("#leaders");
    if (svg) {
      svg.querySelectorAll("[data-ann]").forEach(function (n) {
        var idx = n.getAttribute("data-ann");
        var card = paper.querySelector('.annot[data-ann="' + idx + '"]');
        var show = true;
        if (card) {
          var p2 = card.getAttribute("data-prio") || "optional";
          show = (keep === "all" || p2 === keep);
        }
        n.style.display = show ? "" : "none";
      });
    }
    /* 原句上的编号点与底色：按级别同步淡出，避免「字上还有标记、卡片没了」 */
    paper.querySelectorAll(".essay-body .sent[data-ann]").forEach(function (sp) {
      var idx2 = sp.getAttribute("data-ann");
      var card2 = paper.querySelector('.annot[data-ann="' + idx2 + '"]');
      var show2 = true;
      if (card2) {
        var p3 = card2.getAttribute("data-prio") || "optional";
        show2 = (keep === "all" || p3 === keep);
      }
      sp.classList.toggle("dimmed", !show2);
    });
    /* 错别字没有卡片，按「原句标记」单独处理：
       筛其它级别时淡出，筛「必改」时保持可见。 */
    paper.querySelectorAll(".essay-body .sent[data-typo],.dot-typo").forEach(function (n) {
      var showT = (keep === "all" || keep === "must");
      if (n.classList.contains("sent")) {
        n.classList.toggle("dimmed", !showT);
        /* 只在「必改」筛选时加重，平时保持轻量下划线 */
        n.classList.toggle("typo-focus", keep === "must");
      } else {
        n.style.display = showT ? "" : "none";
      }
    });

    /* 筛「必改」时若只剩错别字（它没有卡片），纸面会显得空荡荡：
       给一条定位指引，并让错别字标记临时加重，肉眼才找得到。 */
    var hint = paper.querySelector(".typo-only-hint");
    if (keep === "must" && !countVisibleCards(paper)) {
      if (!hint) {
        hint = document.createElement("div");
        hint.className = "typo-only-hint";
        hint.innerHTML = '<i></i>必改项是错别字：原文里已标红，完整清单见「写作建议」页的错别字汇总';
        var ph = paper.querySelector(".essay-head");
        if (ph && ph.parentNode) ph.parentNode.insertBefore(hint, ph.nextSibling);
      }
      hint.style.display = "";
    } else if (hint) {
      hint.style.display = "none";
    }

    paper.querySelectorAll(".dot-mark[data-ann]").forEach(function (d) {
      var idx3 = d.getAttribute("data-ann");
      var card3 = paper.querySelector('.annot[data-ann="' + idx3 + '"]');
      var show3 = true;
      if (card3) {
        var p4 = card3.getAttribute("data-prio") || "optional";
        show3 = (keep === "all" || p4 === keep);
      }
      d.style.display = show3 ? "" : "none";
    });
  }

  /* 文本稿：定位到某条批注，同时高亮原句与卡片 */
  var activeIdx = -1;
  function focusAnn(i, opt) {
    var prevSent = activeIdx >= 0 ? $('.sent[data-ann="' + activeIdx + '"]') : null;
    var prevAnn = activeIdx >= 0 ? $('.annot[data-ann="' + activeIdx + '"]') : null;
    if (prevSent) prevSent.classList.remove("hl");
    if (prevAnn) prevAnn.classList.remove("active");

    activeIdx = i;
    var sent = $('.sent[data-ann="' + i + '"]');
    var ann = $('.annot[data-ann="' + i + '"]');
    if (sent) sent.classList.add("hl");
    if (ann) ann.classList.add("active");

    var band = $('.hl[data-ann="' + i + '"]');
    Array.prototype.forEach.call(document.querySelectorAll(".hl.active"), function (x) { x.classList.remove("active"); });
    if (band) band.classList.add("active");

    var sc = $("#stageScroll");
    var anchor = ann || sent;
    /* opt.noScroll：拖动结束后的联动高亮，不要改动用户的浏览位置 */
    if (!anchor || !sc || (opt && opt.noScroll)) return;
    var top = anchor.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 80;
    if (top < sc.scrollTop || top > sc.scrollTop + sc.clientHeight - 180) {
      sc.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    }
  }

  /**
   * 在图片上画荧光笔痕迹。
   * 没有逐行 OCR 坐标，就按段落号把每段映射成图片上的一条横向色带，
   * 位置与两侧批注锚点一致，保证「卡片—色带—编号」三者对得上。
   */
  function paintHighlights(anns, sp, all, anchorByAnn) {
    var list = Array.isArray(all) ? all : (anns || []);
    var layer = $("#hlLayer");
    if (!layer || !sp.h) return;
    layer.innerHTML = "";

    /* 坐标聚集兜底：模型偶尔把所有 box 估到同一角落（挤成一团、线极短）。
       检测到本页批注纵向分布 <15% 且横向中心 <20% 时，整组忽略 box，
       退回按序号均分——保证线分开、够长、可拖。历史旧数据同样受保护。 */
    var boxed = anns.filter(function (a) { return a.box; });
    var clustered = false;
    if (boxed.length >= 3) {
      var ys = boxed.map(function (a) { return a.box.y; });
      var xs = boxed.map(function (a) { return (a.box.x1 + a.box.x2) / 2; });
      var spread = function (arr) { return Math.max.apply(null, arr) - Math.min.apply(null, arr); };
      clustered = spread(ys) < 15 && spread(xs) < 20;
    }

    anns.forEach(function (a, i) {
      var box = clustered ? null : a.box;
      var fbY, fbX1, fbX2;
      /* 卡片侧已算好的锚点（绝对像素，相对纸面）：优先复用，
         保证荧光条与批注卡引线落在同一行，不再各算一套。
         ★ 键必须用全局序号：anchorByAnn 按 gidx 写入，
         用本页序号 i 取值时第 2 页起全部取空、退回旧公式。 */
      var gkS = list.indexOf(a);
      var shared = anchorByAnn ? anchorByAnn[gkS >= 0 ? gkS : i] : undefined;
      if (shared !== undefined) {
        /* 换算成相对图片的百分比：sp.top 是图片顶在纸面内的坐标 */
        fbY = Math.max(0, Math.min(100, (shared - sp.top) / (sp.h || 1) * 100));
        fbX1 = 4; fbX2 = 96;
        if (box) { fbX1 = box.x1; fbX2 = box.x2; }
      } else if (box) {
        fbY = box.y; fbX1 = box.x1; fbX2 = box.x2;
      } else {
        /* 模型没给位置（或坐标聚集被整组作废）：按本页批注序号纵向均分，
           线画整幅宽——保证每条线分开、够长、可拖动。
           旧逻辑按 para 估算，图片稿 para 全是 0 时所有线挤在同一行。 */
        var n = Math.max(1, anns.length);
        fbY = Math.min(94, Math.max(5, ((i + 0.5) / n) * 88 + 5));
        fbX1 = 4; fbX2 = 96;
      }
      /* 应用人工微调：位置与起止点都以调整后的为准 */
      var pos = bandPos(a, { y: fbY, x1: fbX1, x2: fbX2 });
      var y = pos.y, x1 = pos.x1, x2 = pos.x2;

      /* 全文序号：翻页时也能对上两侧批注卡上的编号。
         必须在用到之前算好——否则真实浏览器会在下一行直接抛错，
         整页荧光与编号都画不出来。 */
      var gk = list.indexOf(a);
      var gk2 = (gk >= 0 ? gk : i) + 1;

      /* 划线条：贴在该行文字上的一道细高亮 */
      var band = document.createElement("div");
      band.className = "hl hl-band hl-" + a.type;
      band.style.top = y + "%";
      band.style.left = x1 + "%";
      band.style.width = Math.max(6, Math.min(100 - x1, x2 - x1)) + "%";
      band.title = "#" + gk2 + " " + annText(a);
      /* 全局序号必须先算：下面 dataset.ann 与事件绑定都要用它，
         写在赋值之后会因 var 提升取到 undefined，
         导致荧光条没有 data-ann、拖拽时反查不到元素。 */
      var gidx = gk >= 0 ? gk : i;
      band.dataset.ann = gidx;
      band.dataset.y = y;
      band.dataset.x1 = x1;
      band.dataset.x2 = x2;
      band.addEventListener("click", function (e) {
        e.stopPropagation();
        /* 拖动刚结束不要误触选中 */
        if (band.dataset.dragged === "1") { band.dataset.dragged = ""; return; }
        focusAnn(gidx);
      });
      /* 悬停时只让这一条进入可编辑态（加粗一点、显示自己的端点） */
      band.addEventListener("pointerenter", function () { band.classList.add("band-hover"); });
      band.addEventListener("pointerleave", function () {
        if (!dragState || dragState.gid !== gidx) band.classList.remove("band-hover");
      });
      layer.appendChild(band);

      /* 左右两个端点把手：只属于这条线，默认隐藏。
         鼠标碰到哪条，就只让那条的把手出现，互不干扰。 */
      ["x1", "x2"].forEach(function (edge) {
        var grip = document.createElement("span");
        grip.className = "hl-grip hl-grip-" + edge;
        grip.style.top = y + "%";
        /* 编号默认贴在 x1 左侧 / x2 右侧；同侧把手往「线内」缩一点，
           避免圆点把手和编号圆环叠在一起 */
        var insetPct = Math.max(1.4, 7 / (sp.w || 300) * 100);
        var gpos = edge === "x1" ? Math.min(x2 - 1, x1 + insetPct) : Math.max(x1 + 1, x2 - insetPct);
        grip.style.left = gpos + "%";
        grip.dataset.ann = gidx;
        grip.dataset.owner = gidx;
        grip.dataset.edge = edge;
        grip.dataset.y = y;
        grip.dataset.x1 = x1;
        grip.dataset.x2 = x2;
        grip.title = "拖动调整线段端点";
        /* 夹在本条线的层里：只有这条线 hover 时才会显示 */
        band.appendChild(grip);
        if (typeof ZP.onBandGripMounted === "function") ZP.onBandGripMounted(grip, gidx, edge);
      });

      if (typeof ZP.onBandMounted === "function") ZP.onBandMounted(band, gidx);

      /* 编号：贴在划线两端，左侧在起点、右侧在终点，离字只留一点空隙 */
      var leftSide = (i % 2 === 0);
      var num = document.createElement("span");
      num.className = "hl-no hl-no-" + a.type + (leftSide ? " at-start" : " at-end");
      num.textContent = gk2;
      num.style.top = y + "%";
      /* 编号实际宽度约 21px（15px 内容 + 6px 内边距），按图片宽度换算后夹紧 */
      var numPct = Math.max(2.6, Math.min(96, NUM_W / (sp.w || 300) * 100));
      var lx = leftSide ? (x1 - numPct) : (x2 + 0.6);
      lx = Math.max(0.4, Math.min(100 - numPct - 0.4, lx));
      /* 编号自身的微调（百分比） */
      var ns = noShift(a);
      if (ns.dx) lx = Math.max(0, Math.min(100 - numPct, lx + ns.dx));
      var ntY = y + ns.dy;
      ntY = Math.max(0, Math.min(99, ntY));
      num.style.left = lx + "%";
      num.style.top = ntY + "%";
      num.dataset.ann = gidx;
      num.title = "#" + (gk2) + " " + annText(a);
      num.addEventListener("click", function (e) {
        e.stopPropagation();
        if (num.dataset.dragged === "1") { num.dataset.dragged = ""; return; }
        focusAnn(gidx);
      });
      if (typeof ZP.onHlNoMounted === "function") ZP.onHlNoMounted(num, gidx);
      layer.appendChild(num);
    });
  }

  /* ===== 批注/段落字段统一取值 =====
   * 界面内部历史上用 annotations / paragraphs，
   * 而 AI 归一化结果与历史记录里存的是 annos / essay.paras。
   * 之前各处直接读 annotations，导致「打开历史记录或图片模式时批注整块消失」，
   * 也连带让批注列撑不开高度、画板滚不动。这里统一收敛，避免再漏。 */
  function annList(result) {
    if (!result) return [];
    if (Array.isArray(result.annotations)) return result.annotations;
    if (Array.isArray(result.annos)) return result.annos;
    return [];
  }
  function paraList(result) {
    if (!result) return [];
    if (Array.isArray(result.paragraphs)) return result.paragraphs;
    if (result.essay && Array.isArray(result.essay.paras)) return result.essay.paras;
    return [];
  }
  /* 单条批注正文：新结果用 note，历史记录用 html */
  function annText(a) {
    if (!a) return "";
    return a.note || a.html || a.comment || "";
  }

  /* 判断批注是否带真实位置，用于提示文案 */
  function hasBox(result) {
    var list = annList(result);
    var n = 0;
    list.forEach(function (a) { if (a.box) n++; });
    return n > 0 && n >= Math.ceil(list.length / 2);
  }

  /* ---------------- 图片稿（含左右留白批注） ---------------- */
  function imageSheet(src, img, result) {
    var paper = shell();
    paper.classList.add("image-mode");
    /* 宽度交给内容决定：两侧固定批注栏 + 原稿实际宽度 */
    paper.style.width = "";
    paper.style.maxWidth = "";
    var col = $("#essayCol");
    var ratio = img && img.width && img.height ? img.height / img.width : 1.414;
    var maxW = img && img.width ? Math.min(img.width, 640) : 640;

    var hasAnns = !!(annList(result).length && S.view === "image");

    col.innerHTML =
      '<div class="essay-sheet" style="max-width:' + maxW + 'px">' +
        '<img src="' + src + '" alt="作文原稿" style="aspect-ratio:' + (1 / ratio) + '">' +
        '<div class="hl-layer" id="hlLayer" aria-hidden="true"></div>' +
      "</div>" +
      '<p class="img-hint">' +
        (hasAnns
          ? (hasBox(result)
              ? "划线与编号按原句位置标注；点任意编号可联动左右批注"
              : "原句位置由模型估算，个别行可能有偏差；切到「识别文本」可看逐句精确批注")
          : "原稿已压缩至 " + (img ? fmt(img.width) + "×" + fmt(img.height) : "标准尺寸") +
            " · 批改后批注将分布在左右留白") +
      "</p>";

    /* 多页原稿：底部翻页条 */
    var pages = (S.images && S.images.length) || 1;
    if (pages > 1) {
      var cur = S.imgPage || 0;
      var bar = document.createElement("div");
      bar.className = "page-bar";
      bar.innerHTML =
        '<button class="pg-btn" type="button" data-pg="prev"' + (cur <= 0 ? " disabled" : "") + ">‹ 上一页</button>" +
        '<span class="pg-info">第 <b>' + (cur + 1) + "</b> / " + pages + " 页</span>" +
        '<button class="pg-btn" type="button" data-pg="next"' + (cur >= pages - 1 ? " disabled" : "") + ">下一页 ›</button>";
      col.appendChild(bar);
    }

    if (hasAnns) layoutImageAnnotations(paper, img, result);

    /* 图片是异步解码的：加载完成或尺寸变了，锚点会移动，必须重排一次引线，
       否则虚线仍停在按旧尺寸算出的位置上。 */
    var sizeKey = "";
    var relayout = function () {
      if (!hasAnns) return;
      var r = paper.getBoundingClientRect();
      var k = Math.round(r.width) + "x" + Math.round(r.height);
      if (k === sizeKey) return;
      sizeKey = k;
      layoutImageAnnotations(paper, img, result);
    };
    var imgEl = $(".essay-sheet img", paper);
    if (imgEl && !imgEl.complete) {
      imgEl.addEventListener("load", relayout);
    }
    if (typeof ResizeObserver !== "undefined") {
      if (paper.__zpRO) { try { paper.__zpRO.disconnect(); } catch (e) {} }
      var ro = new ResizeObserver(function () { relayout(); });
      ro.observe(paper);
      paper.__zpRO = ro;
    }

    /* 微调提示条：只在有批注时出现，含一键还原 */
    if (hasAnns) {
      var bar = document.createElement("div");
      bar.className = "adjust-bar";
      var anyAdj = annList(result).some(hasAdj);
      bar.innerHTML =
        '<span class="ab-hint"><i></i>拖线身整条移动，拖两端圆点改长短；编号与批注卡也能拖</span>' +
        '<button type="button" id="adjReset"' + (anyAdj ? '' : ' hidden') + '>还原位置</button>';
      col.appendChild(bar);
    }
    return paper;
  }

  /**
   * 图片模式批注排布：
   * 无 OCR 行框，按「段落序号 → 图片纵向相对位置」估算锚点，
   * 只在图片边缘标注位置，不横穿原稿以免遮挡书写。
   */
  function layoutImageAnnotations(paper, img, result) {
    var leftCol = $("#annLeft");
    var rightCol = $("#annRight");
    var svg = $("#leaders");
    var sheet = $(".essay-sheet", paper);
    if (!leftCol || !rightCol || !svg || !sheet) return;

    var all = annList(result);
    var curPage = S.imgPage || 0;
    /* 多页原稿：本页只显示属于这一页的批注 */
    var anns = all.filter(function (a) { return (a.page || 0) === curPage; });
    if (!anns.length && all.length && !all.some(function(a){ return a.page !== undefined; })) {
      anns = all; /* 老数据没有 page 字段时退回显示全部 */
    }
    var totalPara = Math.max(1, paraList(result).length || 1);
    var sheetRect = sheet.getBoundingClientRect();

    leftCol.innerHTML = "";
    rightCol.innerHTML = "";
    svg.innerHTML = "";

    var lp = measure(paper, leftCol);
    var rp = measure(paper, rightCol);
    var sp = measure(paper, sheet);

    /* 左右各占一半，同侧内部按段落从上到下均匀分布，
       避免多条批注挤在中部、上半页留白过多 */
    var bottomL = 0, bottomR = 0;
    var leftItems = anns.filter(function (_, k) { return k % 2 === 0; });
    var rightItems = anns.filter(function (_, k) { return k % 2 === 1; });

    /* 锚点纵向位置：一律优先按「批注所属段落」定位。
       此前多条的走「同栏均分」，同一栏两条直接被推到页首 6% 和页尾 94%，
       批注条离它说的那句话隔了半页——这正是「位置还是不对」的来源。
       均分只作为「拿不到段落信息」时的兜底。 */
    function slotY(list, idx, item) {
      var n = Math.max(1, list.length);
      var paraOf = function (it) {
        var p = it && typeof it.para === "number" ? it.para : -1;
        return p >= 0 && p < totalPara ? p : -1;
      };
      var p = paraOf(item);
      if (p >= 0) {
        /* 段落中心：0.5/总段数 会落在两段之间，用 (p+0.5)/totalPara 居中 */
        return sp.top + sp.h * Math.max(0.06, Math.min(0.94, (p + 0.5) / totalPara));
      }
      if (n === 1) {
        var p0 = Math.max(0, Math.min(totalPara - 1, (list[0] && list[0].para) | 0));
        return sp.top + sp.h * Math.max(0.08, Math.min(0.92, (p0 + 0.5) / totalPara));
      }
      var usableTop = sp.top + sp.h * 0.06;
      var usableH = sp.h * 0.88;
      return usableTop + usableH * (idx / (n - 1));
    }

    /* 两列各自独立计数：左列序号 0,1,2…；右列序号 0,1,2…
       否则两列会共用同一组纵向位置，出现卡片整体对齐的呆板感 */
    var leftSeen = 0, rightSeen = 0;

    /* 全局编号：与报告里的「逐句批注」列表保持一致 */
    function gi(item) {
      var k = all.indexOf(item);
      return k >= 0 ? k : 0;
    }

    /* ★ 锚点共用：卡片位置与图片荧光条必须落在同一纵向坐标。
       此前卡片按「左右分栏各自均分」，荧光条按「本页全部批注均分」，
       两套公式不同，必有一条对不上原文（第 2 页起尤其明显）。
       这里把算好的 anchorY 存进批注对象，paintHighlights 直接复用。 */
    var anchorByAnn = {};

    anns.forEach(function (item, i) {
      var goLeft = i % 2 === 0;
      var anchorY = goLeft ? slotY(leftItems, leftSeen++, item) : slotY(rightItems, rightSeen++, item);
      var gno = gi(item) + 1;
      anchorByAnn[gi(item)] = anchorY;

      var prio = annPriority(item);
      var pm = PRIO_META[prio] || PRIO_META.optional;
      var el = document.createElement("div");
      el.className = "annot " + item.type + " " + pm.cls;
      el.dataset.ann = gi(item);
      el.dataset.prio = prio;
      el.innerHTML =
        '<span class="annot-no">' + gno + "</span>" +
        '<span class="annot-tag">' + esc(item.tag || TYPE_SHORT[item.type]) + "</span>" +
        '<span class="prio-chip ' + pm.cls + '">' + pm.label + "</span>" +
        '<div class="annot-body">' + rich(item.note || "") +
        fixBlock(item, esc, rich) +
        "</div>";

      var colEl = goLeft ? leftCol : rightCol;
      var cp = goLeft ? lp : rp;
      var lastBottom = goLeft ? bottomL : bottomR;

      colEl.appendChild(el);
      var h = el.offsetHeight || 54;
      var top = anchorY - h / 2 - cp.top;
      if (top < lastBottom + 9) top = lastBottom + 9;
      /* 人工微调过的卡片优先按自己的位置摆放 */
      var cdy = cardShift(item);
      if (cdy) top = Math.max(0, top + cdy);
      el.style.top = Math.max(0, top) + "px";
      if (cdy) el.classList.add("moved");
      el.dataset.side = goLeft ? "left" : "right";
      /* 拖动把手：挂在卡片上，交给主逻辑绑定事件 */
      el.setAttribute("draggable", "false");
      el.title = "按住拖动可微调这条批注的位置";
      if (typeof ZP.onAnnotMounted === "function") ZP.onAnnotMounted(el, gi(item));

      if (goLeft) bottomL = top + h;
      else bottomR = top + h;

      var annCenter = cp.top + top + h / 2;   /* 已含卡片微调 */
      var startX = goLeft ? cp.left + cp.w : cp.left;
      var endX = goLeft ? sp.left - 6 : sp.left + sp.w + 6;
      var midX = startX + (endX - startX) * 0.5;
      var color = TYPE_COLOR[item.type] || "#7a5cc4";

      var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", "M" + startX + " " + annCenter +
        " C" + midX + " " + annCenter + " " + midX + " " + anchorY + " " + endX + " " + anchorY);
      path.setAttribute("stroke", color);
      path.setAttribute("stroke-opacity", ".62");
      path.setAttribute("stroke-dasharray", "3 3");
      svg.appendChild(path);

      // 图片边缘的位置标记（短竖线 + 圆点），指示大致段落位置
      var tick = document.createElementNS("http://www.w3.org/2000/svg", "path");
      tick.setAttribute("d", "M" + endX + " " + (anchorY - 5) + " L" + endX + " " + (anchorY + 5));
      tick.setAttribute("stroke", color);
      tick.setAttribute("stroke-width", "1.6");
      tick.setAttribute("stroke-linecap", "round");
      tick.setAttribute("stroke-opacity", ".85");
      svg.appendChild(tick);

      var dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      dot.setAttribute("cx", endX);
      dot.setAttribute("cy", anchorY);
      dot.setAttribute("r", "2.6");
      dot.setAttribute("fill", color);
      svg.appendChild(dot);

      /* 编号只保留两处：批注卡片角标 + 原稿荧光条端头的编号。
         引线末端不再画编号圆点，避免同一个数字在一页里出现三次。 */
      var badgeX = goLeft ? (sp.left + 12) : (sp.left + sp.w - 12);

      /* 引线从荧光条端头直接连到卡片 */
      path.setAttribute("d", "M" + badgeX + " " + anchorY +
        " C" + midX + " " + anchorY + " " + midX + " " + annCenter + " " + startX + " " + annCenter);

      var gid = gi(item);
      el.addEventListener("click", function () { focusAnn(gid); });
    });

    /* 批注是 position:absolute，不会撑开父容器。只设 minHeight 时，
       .paper-grid 的行高仍由纸张决定，超出的批注会被裁在网格外：
       既看不见、也让外层 .stage-scroll 没有可滚动内容。
       这里按批注实际底部撑开列高，再同步撑开纸张内边距，
       让整页变高后画板能纵向滚动。 */
    fitAnnCols(leftCol, rightCol, bottomL, bottomR);

    syncLeaderViewBox(paper, svg);

    /* 原稿图片上同步绘制荧光笔：直接把卡片侧的锚点按图片坐标换算，
       保证每一条荧光条都落在它那张卡片引线的落点上。 */
    paintHighlights(anns, sp, all, anchorByAnn);
  }

  /* ============================================================
     批注微调：拖动批注卡 / 荧光划线 / 划线端点 / 线端编号
     所有位移都会写进 annotation.adj，随结果一起持久化。
     ============================================================ */
  var dragState = null;

  function annOfGid(gid) {
    var list = annList(S.result);
    if (!list.length) return null;
    var a = list[gid];
    return a && typeof a === "object" ? a : null;
  }

  /* 松手后立刻重绘，让引线、卡片、编号全部对齐新位置 */
  function repaintAfterDrag() {
    if (!S.result || S.view !== "image" || !S.image) return;
    /* 重绘会重建整张纸，必须原样恢复滚动位置，否则画面会跳回顶部 */
    var sc = $("#stageScroll");
    var keepTop = sc ? sc.scrollTop : 0;
    var keepLeft = sc ? sc.scrollLeft : 0;
    imageSheet(S.image.dataUrl, S.image, S.result);
    if (sc) {
      sc.scrollTop = keepTop;
      sc.scrollLeft = keepLeft;
      /* 浏览器可能在下一帧重算布局，再兜一次 */
      requestAnimationFrame(function () {
        if (sc.scrollTop !== keepTop) sc.scrollTop = keepTop;
      });
    }
  }

  function commitAdjust() {
    /* 同步进当前份，并落盘（历史与作文队列都靠它） */
    if (typeof ZP.onAnnotAdjust === "function") ZP.onAnnotAdjust(S.result);
  }

  function startDrag(kind, ev, gid, el, meta) {
    var a = annOfGid(gid);
    if (!a) return;
    if (ev.button !== undefined && ev.button !== 0) return;

    var img = $("#essayCol .essay-sheet img");
    if (!img) return;
    var rect = img.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    var ad = adjOf(a);
    dragState = {
      kind: kind, gid: gid, el: el, meta: meta || {},
      startX: ev.clientX, startY: ev.clientY,
      rectW: rect.width, rectH: rect.height,
      moved: false,
      base: {
        /* 以「屏幕上此刻画出来的位置」为基准，拖动的增量才和手感一致 */
        band: {
          y: num(el.dataset.y, ad.band.y),
          x1: num(el.dataset.x1, ad.band.x1),
          x2: num(el.dataset.x2, ad.band.x2)
        },
        no: { dx: ad.no.dx || 0, dy: ad.no.dy || 0 },
        card: { dy: ad.card.dy || 0 }
      },
      annEl: $('.annot[data-ann="' + gid + '"]'),
      bandEl: $('.hl-band[data-ann="' + gid + '"]'),
      noEl: $('.hl-no[data-ann="' + gid + '"]'),
      grips: document.querySelectorAll('.hl-grip[data-ann="' + gid + '"]')
    };
    document.body.classList.add("adjusting");
    if (dragState.bandEl) dragState.bandEl.classList.add("band-hover");
    if (ev.preventDefault) ev.preventDefault();
    if (el.setPointerCapture && ev.pointerId !== undefined) {
      try { el.setPointerCapture(ev.pointerId); } catch (e) { /* 部分环境不支持，忽略 */ }
    }
  }

  function moveDrag(ev) {
    if (!dragState) return;
    var st = dragState;
    var dx = ev.clientX - st.startX;
    var dy = ev.clientY - st.startY;
    if (!st.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
    st.moved = true;

    var dPctX = dx / st.rectW * 100;
    var dPctY = dy / st.rectH * 100;
    var a = annOfGid(st.gid);
    if (!a) return;
    var ad = adjOf(a);

    if (st.kind === "band") {
      var ny = Math.max(0, Math.min(97, st.base.band.y + dPctY));
      var nx1 = Math.max(0, Math.min(98, st.base.band.x1 + dPctX));
      var nx2 = Math.max(1, Math.min(100, st.base.band.x2 + dPctX));
      /* 整条平移时不改变长度：超出边界就整体贴边 */
      var w = st.base.band.x2 - st.base.band.x1;
      if (nx2 > 100) { nx2 = 100; nx1 = 100 - w; }
      if (nx1 < 0) { nx1 = 0; nx2 = w; }
      ad.band.y = ny; ad.band.x1 = nx1; ad.band.x2 = nx2;
      paintBandOnly(st, ny, nx1, nx2);
    } else if (st.kind === "grip") {
      var edge = st.meta.edge;
      var gy = st.base.band.y;
      var gx1 = st.base.band.x1;
      var gx2 = st.base.band.x2;
      if (edge === "x1") {
        gx1 = Math.max(0, Math.min(gx2 - 4, gx1 + dPctX));
      } else {
        gx2 = Math.max(gx1 + 4, Math.min(100, gx2 + dPctX));
      }
      /* 三个值一次性写全：只写一个会让另外两个退回默认值（y 变 0） */
      ad.band.y = gy;
      ad.band.x1 = gx1;
      ad.band.x2 = gx2;
      paintBandOnly(st, gy, gx1, gx2);
    } else if (st.kind === "no") {
      var numPct = NUM_W / st.rectW * 100;
      ad.no.dx = Math.max(-st.base.band.x1, Math.min(100 - numPct - st.base.band.x1, st.base.no.dx + dPctX));
      ad.no.dy = Math.max(-st.base.band.y, Math.min(99 - st.base.band.y, st.base.no.dy + dPctY));
      /* 直接按新值重算，避免累加误差 */
      paintNoOnly(st, ad);
    } else if (st.kind === "card") {
      /* 卡片 top 用的是纸面内坐标（逻辑像素），指针位移要除以缩放比 */
      var dTop = dy / (st.scale || 1);
      ad.card.dy = st.base.card.dy + dTop;
      if (st.annEl) {
        st.annEl.classList.add("moved", "dragging");
        st.annEl.style.top = Math.max(0, st.baseCardTop + dTop) + "px";
      }
    }
    ev.preventDefault && ev.preventDefault();
  }

  function paintBandOnly(st, y, x1, x2) {
    var b = st.bandEl;
    if (!b) return;
    b.classList.add("moved");
    b.style.top = y + "%";
    b.style.left = x1 + "%";
    b.style.width = Math.max(6, Math.min(100 - x1, x2 - x1)) + "%";
    /* ★ dataset 必须同步：startDrag 以 dataset 作为下一次拖动的基准，
       只改 style 不改 dataset，第二次拖动会拿旧基准算，出现「拖了不动/瞬移」 */
    b.dataset.y = y;
    b.dataset.x1 = x1;
    b.dataset.x2 = x2;
    st.grips && Array.prototype.forEach.call(st.grips, function (g) {
      g.style.top = y + "%";
      g.style.left = (g.dataset.edge === "x1" ? x1 : x2) + "%";
      g.dataset.y = y;
      g.dataset.x1 = x1;
      g.dataset.x2 = x2;
    });
  }

  function paintNoOnly(st, ad) {
    var n = st.noEl;
    if (!n) return;
    n.classList.add("moved");
    var b = ad.band || {};
    var y = typeof b.y === "number" ? b.y : st.base.band.y;
    var x1 = typeof b.x1 === "number" ? b.x1 : st.base.band.x1;
    var x2 = typeof b.x2 === "number" ? b.x2 : st.base.band.x2;
    var numPct = NUM_W / st.rectW * 100;
    var leftSide = n.classList.contains("at-start");
    var lx = leftSide ? (x1 - numPct) : (x2 + 0.6);
    lx = Math.max(0.4, Math.min(100 - numPct - 0.4, lx + (ad.no.dx || 0)));
    n.style.left = lx + "%";
    n.style.top = Math.max(0, Math.min(99, y + (ad.no.dy || 0))) + "%";
  }

  function endDrag() {
    if (!dragState) return;
    var st = dragState;
    var moved = st.moved;
    dragState = null;
    document.body.classList.remove("adjusting");
    if (st.annEl) st.annEl.classList.remove("dragging");
    if (st.bandEl) st.bandEl.classList.remove("band-hover");
    if (!moved) return;

    if (st.el) st.el.dataset.dragged = "1";
    if (st.kind === "card") {
      if (st.annEl) st.annEl.dataset.dragged = "1";
    }
    commitAdjust();
    repaintAfterDrag();
  }

  /* 事件挂载点：由 paintHighlights / layoutImageAnnotations 调用 */
  ZP.onBandMounted = function (band, gid) {
    /* 悬停即显示端点把手（可直接拖改长短）；Alt 不再是必需 */
    band.addEventListener("pointermove", function (e) {
      var onGrip = e.target && e.target.classList && e.target.classList.contains("hl-grip");
      band.style.cursor = onGrip ? "ew-resize" : "grab";
    });
    band.addEventListener("pointerleave", function () {
      band.classList.remove("grip-mode");
      band.style.cursor = "";
    });

    band.addEventListener("pointerdown", function (e) {
      /* 点在端点圆点上：直接改长短；点在线身：整条平移 */
      var onGrip = e.target && e.target.classList && e.target.classList.contains("hl-grip");
      if (onGrip) return;   /* 交给 grip 自己的监听 */
      startDrag("band", e, gid, band);
    });
  };

  ZP.onBandGripMounted = function (grip, gid, edge) {
    grip.addEventListener("pointerdown", function (e) {
      /* 端点直接拖动改长短，无需 Alt */
      e.stopPropagation();
      startDrag("grip", e, gid, grip, { edge: edge });
    });
  };

  ZP.onHlNoMounted = function (num, gid) {
    num.addEventListener("pointerdown", function (e) {
      startDrag("no", e, gid, num);
    });
  };

  ZP.onAnnotMounted = function (el, gid) {
    el.addEventListener("pointerdown", function (e) {
      /* 点到卡片里的链接/按钮时不拖动 */
      if (e.target && e.target.closest && e.target.closest("a,button,input")) return;
      var paper = $("#paper");
      var scale = 1;
      if (paper && paper.offsetWidth) {
        scale = paper.getBoundingClientRect().width / paper.offsetWidth || 1;
      }
      startDrag("card", e, gid, el, {});
      if (dragState) {
        dragState.scale = scale;
        dragState.baseCardTop = parseFloat(el.style.top) || 0;
      }
    });
  };

  document.addEventListener("pointermove", moveDrag, { passive: false });
  document.addEventListener("pointerup", endDrag);
  document.addEventListener("pointercancel", endDrag);

  /* ---------------- 待批改 ---------------- */
  function pending() {
    if (S.view === "image" && S.image) {
      imageSheet(S.image.dataUrl, S.image);
      return;
    }
    if (S.text) {
      var paper = shell();
      var col = $("#essayCol");
      col.appendChild(head(S.title || "未命名作文", S.student || "未署名",
        ZP.getGrade(S.grade).name + " · " + S.genre, ZP.countChars(S.text)));
      var body = document.createElement("div");
      body.className = "essay-body";
      ZP.splitParagraphs(S.text).forEach(function (t) {
        var p = document.createElement("p");
        p.textContent = t;
        body.appendChild(p);
      });
      col.appendChild(body);
      return;
    }
    if (S.image) {
      imageSheet(S.image.dataUrl, S.image);
      return;
    }
    emptyPaper();
  }

  function emptyPaper() {
    var paper = shell();
    var col = $("#essayCol");
    col.innerHTML =
      '<div class="paper-empty">' +
        '<div class="pe-icon"><svg viewBox="0 0 44 44" fill="none"><path d="M11 9.5h15.5L34 17v17.5H11z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M26 9.5V17h8" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M16.5 23.5h12M16.5 28h8.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg></div>' +
        '<h3>等待作文原稿</h3>' +
        '<p>拖入作文照片，或在左侧粘贴正文文字。<br>载入后点击「开始 AI 批改」生成四维报告。</p>' +
        '<button class="pe-demo" type="button" data-demo="1">' +
          '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M7 2.6 8.6 5.6 12 6.1 9.5 8.5 10.1 12 7 10.4 3.9 12 4.5 8.5 2 6.1 5.4 5.6z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>' +
          "看演示效果" +
        "</button>" +
      "</div>";
  }

  /* ---------------- 报告 ---------------- */
  function report(r) {
    if (!r) { emptyReport(); return; }
    $("#reportEmpty").hidden = true;
    $("#reportBody").hidden = false;

    $("#rName").textContent = r.student || "未署名";
    $("#rMeta").textContent = r.meta || "";
    var lv = $("#rLevel");
    lv.textContent = r.level;
    lv.className = "level-badge " + (r.levelCls || "");

    $("#rScore").textContent = r.score;
    $("#rMiniDims").innerHTML = ZP.DIMS.map(function (d) {
      var hit = (r.dims || []).filter(function (x) { return x.key === d.key; })[0] || { score: 0 };
      return '<div class="mini-dim" style="--c:' + d.color + '"><i></i><span>' + d.name +
        "</span><b>" + hit.score + "</b></div>";
    }).join("");

    var pill = $("#statusPill");
    pill.textContent = r.isDemo ? "演示" : "已完成";
    pill.className = "status-pill" + (r.isDemo ? "" : " done");

    drawRadar(r);
    renderOverview(r);
    renderOutline(r);
    renderDrills(r);
    renderPolished(r);
  }

  function emptyReport() {
    $("#reportBody").hidden = true;
    $("#reportEmpty").hidden = false;
    var pill = $("#statusPill");
    pill.textContent = "待批改";
    pill.className = "status-pill live";

    if (S.image) {
      $("#emptyDesc").textContent = "已载入《" + (S.image.name || "作文图片") + "》，压缩后 " +
        ZP.fmtSize(S.image.size) + "。确认年级与权重后点击「开始 AI 批改」。";
      $("#reportSub").textContent = "原稿待批改 · 尚未生成报告";
    } else if (S.text) {
      $("#emptyDesc").textContent = "已载入 " + fmt(ZP.countChars(S.text)) + " 字正文，等待生成报告。";
      $("#reportSub").textContent = "正文已就绪 · 尚未生成报告";
    } else {
      $("#emptyDesc").textContent = "上传作文照片或粘贴正文，选择年级与权重后，点击「开始 AI 批改」。";
      $("#reportSub").textContent = "四维评分 · 逐句批注 · 升格范文";
    }
  }

  /* ---- 雷达图 ---- */
  function drawRadar(r) {
    var cv = $("#radar");
    if (!cv) return;
    var wrap = cv.parentElement;
    /* 雷达现在放在右侧小栏里：完全按容器实际宽度绘制，不再钳制最小 250px */
    var cssW = Math.max(140, Math.floor((wrap ? wrap.clientWidth : 190)));
    var cssH = Math.round(cssW * 0.84);
    var dpr = Math.min(window.devicePixelRatio || 1, 2);

    cv.width = Math.round(cssW * dpr);
    cv.height = Math.round(cssH * dpr);
    cv.style.width = cssW + "px";
    cv.style.height = cssH + "px";

    var ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    var axes = ZP.DIMS, n = axes.length;
    var cx = cssW / 2, cy = cssH / 2;
    /* 窄栏下字号随宽度缩放，保证 4 个轴标签都能放下 */
    var narrow = cssW < 220;
    /* 报告栏字号上调后同步放大雷达标签，窄画布下也不再压到 8px */
    var fName = narrow ? 9.6 : (cssW < 300 ? 10.4 : 11.2);
    var fScore = narrow ? 9.4 : (cssW < 300 ? 10.2 : 11);
    /* 文字边距按比例收缩：窄栏留 22px，宽栏仍留 38px */
    /* 左右要能完整放下 4 字轴标签（约 4×字号），上下要放下「名称＋分值」两行 */
    var padX = narrow ? Math.max(Math.ceil(fName * 4 * 0.95), Math.round(cssW * 0.17)) : 38;
    var padY = narrow ? Math.max(Math.ceil(fScore * 3.1), Math.round(cssH * 0.13)) : 26;

    var R = Math.max(20, Math.min(cssW / 2 - padX, cssH / 2 - padY));

    function pt(i, ratio) {
      var ang = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      return { x: cx + Math.cos(ang) * R * ratio, y: cy + Math.sin(ang) * R * ratio };
    }

    [0.25, 0.5, 0.75, 1].forEach(function (ring, ri) {
      ctx.beginPath();
      for (var i = 0; i < n; i++) {
        var p = pt(i, ring);
        i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
      }
      ctx.closePath();
      if (ri === 3) { ctx.fillStyle = "rgba(252,249,241,.9)"; ctx.fill(); }
      ctx.strokeStyle = ri === 3 ? "#cdc0a8" : "#e4dccc";
      ctx.lineWidth = 1.1;
      ctx.stroke();
    });

    for (var i = 0; i < n; i++) {
      var pe = pt(i, 1);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(pe.x, pe.y);
      ctx.strokeStyle = "#e2dac9";
      ctx.lineWidth = 1.1;
      ctx.stroke();
    }

    var vals = axes.map(function (d) {
      var hit = (r.dims || []).filter(function (x) { return x.key === d.key; })[0];
      return hit ? Math.max(0, Math.min(100, hit.score)) / 100 : 0;
    });

    ctx.beginPath();
    vals.forEach(function (v, i) {
      var p = pt(i, v);
      i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
    });
    ctx.closePath();
    var grad = ctx.createRadialGradient(cx, cy, 4, cx, cy, R);
    grad.addColorStop(0, "rgba(168,69,47,.17)");
    grad.addColorStop(1, "rgba(192,122,51,.09)");
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = "#a8452f";
    ctx.lineWidth = 1.6;
    ctx.stroke();

    vals.forEach(function (v, i) {
      var p = pt(i, v);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.8, 0, Math.PI * 2);
      ctx.fillStyle = "#fffdf9";
      ctx.fill();
      ctx.strokeStyle = "#a8412c";
      ctx.lineWidth = 1.4;
      ctx.stroke();
    });

    /* 标签：按实测文字宽度夹在画布内，绝不被裁切 */
    axes.forEach(function (d, i) {
      var hit = (r.dims || []).filter(function (x) { return x.key === d.key; })[0];
      var sc = hit ? hit.score : 0;
      var p = pt(i, 1);

      var dx = p.x - cx, dy = p.y - cy;
      var align = Math.abs(dx) < R * 0.22 ? "center" : (dx > 0 ? "left" : "right");
      var gap = narrow ? 5 : 8;
      var lx = p.x + (dx === 0 ? 0 : (dx > 0 ? gap : -gap));
      var ly = p.y + (dy > 0 ? (narrow ? 9 : 12) : (dy < 0 ? (narrow ? -9 : -12) : 0));

      ctx.textAlign = align;
      ctx.textBaseline = "middle";

      ctx.font = '500 ' + fName + 'px "PingFang SC","Microsoft YaHei",sans-serif';
      var nw = ctx.measureText(d.name).width;
      if (align === "left") lx = Math.min(lx, cssW - nw - 3);
      else if (align === "right") lx = Math.max(lx, nw + 3);
      else lx = Math.min(Math.max(lx, nw / 2 + 3), cssW - nw / 2 - 3);

      var off = narrow ? 6 : 8;
      var nameY = align === "center" ? ly - off : ly;
      ctx.fillStyle = "#717885";
      ctx.fillText(d.name, lx, Math.max(fName * 0.62, Math.min(nameY, cssH - fName * 0.62)));

      ctx.font = '700 ' + fScore + 'px "SF Pro Display","Helvetica Neue",Arial,sans-serif';
      var sw = ctx.measureText(String(sc)).width;
      var sx = lx;
      if (align === "left") sx = Math.min(lx, cssW - sw - 4);
      else if (align === "right") sx = Math.max(lx, sw + 4);
      else sx = Math.min(Math.max(lx, sw / 2 + 4), cssW - sw / 2 - 4);

      var scoreY = align === "center" ? ly + (narrow ? 7 : 9) : ly + (narrow ? 9 : 11);
      ctx.fillStyle = d.color;
      ctx.fillText(String(sc), sx, Math.max(fScore * 0.62, Math.min(scoreY, cssH - fScore * 0.62)));
    });
  }

  /* ---- Tab 1 ---- */
  function renderOverview(r) {
    var m = r.metrics || {};
    var html =
      '<div class="blk">' +
        '<div class="blk-head"><h4>整篇研判</h4><i></i><span class="blk-meta">' +
        esc(r.meta) + "</span></div>" +
        '<div class="comment-card">' +
          '<div class="overall-text">' +
            (String(r.overall || "").split(/\n+/).filter(Boolean)
              .map(function (p) { return "<p>" + rich(p) + "</p>"; }).join("")) +
          "</div>" +
          '<div class="overall-metrics">' +
            '<div class="metric"><b>' + fmt(m.words) + "</b><span>全文用字</span></div>" +
            '<div class="metric"><b>' + fmt(m.paras) + "</b><span>段落</span></div>" +
            '<div class="metric"><b>' + fmt(m.marks) + "</b><span>批注</span></div>" +
            '<div class="metric"><b>' + fmt(m.good) + "</b><span>好句</span></div>" +
          "</div>" +
        "</div>" +
      "</div>" +
      '<div class="blk">' +
        '<div class="blk-head"><h4>四维具体信息</h4><i></i><span class="blk-meta">按权重折算</span></div>' +
        '<div class="dim-list">' +
          ZP.DIMS.map(function (d) {
            var hit = (r.dims || []).filter(function (x) { return x.key === d.key; })[0] || { score: 0, comment: "", tagline: "" };
            var w = S.weights[d.key];
            var got = Math.round(hit.score * w / 100 * 10) / 10;
            var isLow = hit.score < 60;
            return '<div class="dim-item' + (isLow ? " is-low" : "") + '" style="--c:' + d.color + '">' +
              '<div class="dim-item-top">' +
                '<span class="nm">' + d.name + "</span>" +
                '<span class="bar"><b style="width:' + hit.score + '%"></b></span>' +
                '<span class="sc">' + hit.score + "<em>/100</em></span>" +
              "</div>" +
              "<p>" + rich(hit.comment || d.desc) + "</p>" +
              (hit.tagline ? '<span class="tagline">' + esc(hit.tagline) + "</span>" : "") +
              '<div class="dim-item-w" style="--c:' + d.color + '">权重 ' + w + " 分 · 折合 " + got + " 分</div>" +
            "</div>";
          }).join("") +
        "</div>" +
      "</div>" +
      /* 批注已直接展示在作文两侧（画板批注卡 / 导出原稿页），
         报告概览里不再重复输出「逐句批注」列表 */
      "";

    $("#panelOverview").innerHTML = html;

    Array.prototype.forEach.call($("#panelOverview").querySelectorAll(".ann-row"), function (row) {
      row.addEventListener("click", function () {
        var i = Number(row.dataset.ann);
        focusAnn(i);
      });
    });
  }

  /* annSummary（逐句批注列表）已移除：批注统一在作文两侧展示，
     概览页不再重复罗列。 */

  /* ---- Tab 2 ---- */
  /* 错别字汇总（界面版）：与 report-export.js 的 typoBlock 同数据、同口径。
     错别字在原稿页只留词级角标，完整清单集中列在这里。 */
  /* 汇总「原句」截断：与 report-export.js 的 typoSnippet 同口径。
     引句常整段上百字，一格塞不下也读不出重点。 */
  function typoSnippet(say, a) {
    var s = String(say || "").replace(/[\s　]+/g, " ").trim();
    if (s.length <= 42) return s;
    var w = String(a && a.fix || "").replace(/[「」『』（）、，。；：\s]/g, "");
    var at = w && w.length <= 6 ? s.indexOf(w) : -1;
    if (at < 0) return s.slice(0, 40) + "…";
    var from = Math.max(0, at - 14);
    var to = Math.min(s.length, at + w.length + 14);
    return (from > 0 ? "…" : "") + s.slice(from, to) + (to < s.length ? "…" : "");
  }

  function renderTypoBlock(r) {
    var anns = annList(r);
    var paras = paraList(r);
    var texts = paras.map(function (p) {
      return Array.isArray(p) ? p.map(function (x) { return x.t || ""; }).join("") : String(p || "");
    });
    var rows = [];
    if (texts.length) {
      var located = [];
      texts.forEach(function (t, pi) {
        matchMarks(t, pi, anns).forEach(function (m) {
          located.push(m.a);
          if (m.a.type !== "red") return;
          var say = String(m.a.sentence || m.a.quote || "").trim();
          if (!say && t) say = t.slice(m.start, m.end).trim();
          rows.push({ a: m.a, say: say });
        });
      });
      anns.forEach(function (a) {
        if (a.type === "red" && located.indexOf(a) < 0) {
          rows.push({ a: a, say: String(a.sentence || a.quote || "").trim() });
        }
      });
    } else {
      anns.forEach(function (a) {
        if (a.type === "red") rows.push({ a: a, say: String(a.sentence || a.quote || "").trim() });
      });
    }
    if (!rows.length) return "";

    return '<div class="blk"><div class="blk-head"><h4>错别字汇总</h4><i></i>' +
      '<span class="blk-meta">共 ' + rows.length + ' 处 · 原稿句中以红色角标标注</span></div>' +
      '<div class="typo-list">' +
        rows.map(function (r, i) {
          var a = r.a;
          var fixTxt = String(a.fix || "").trim();
          var say = typoSnippet(r.say !== undefined ? r.say : String(a.sentence || a.quote || "").trim(), a);
          return '<div class="typo-row">' +
            '<div class="typo-hd">' +
              '<span class="typo-no">' + (i + 1) + "</span>" +
              (say ? '<q class="typo-say">' + esc(say) + "</q>"
                   : '<q class="typo-say typo-say-none">原句未定位</q>') +
              (fixTxt ? '<span class="typo-arrow">→</span><span class="typo-fix">' + esc(fixTxt) + "</span>" : "") +
              '<span class="typo-note">' + rich(a.note || a.html || a.comment || "") + "</span>" +
            "</div>" +
          "</div>";
        }).join("") +
      "</div></div>";
  }

  function renderOutline(r) {
    /* issues 为后加字段：旧报告没有，缺失时整块不渲染 */
    var o = r.outline || {};
    var steps = [o.begin, o.middle, o.end].filter(Boolean);
    var issues = Array.isArray(r.issues) ? r.issues : [];

    var html = "";

    /* ---- 参考写作思路：按「开头 / 中间 / 结尾」给可直接照做的路径 ---- */
    if (steps.length) {
      html += '<div class="blk">' +
        '<div class="blk-head"><h4>参考写作思路</h4><i></i><span class="blk-meta">' +
        esc((r.meta || "").split(" · ")[0]) + " 重写提纲</span></div>" +
        '<div class="ol-note">按本文题目与内容生成，可作为重新构思一篇作文时的客观提纲。</div>' +
        '<div class="outline-flow">' +
          steps.map(function (st) {
            var text = rich(st.text || "");
            /* 模型用「1. 2. 3.」分条时转成有序列表，与参考样式一致 */
            var lines = (st.text || "").split(NL_OR_NUM).map(function (x) { return x.trim(); })
              .filter(Boolean);
            var numRe = /^[0-9]{1,2}[.、]\s*/;
            var hasNum = lines.some(function (x) { return numRe.test(x); });
            var body;
            if (hasNum) {
              /* 首句可能是不带序号的引导语，单独成段；其余按序号转成有序列表 */
              var lead = [], items = [], started = false;
              lines.forEach(function (ln) {
                if (numRe.test(ln)) { started = true; items.push(ln.replace(numRe, "")); }
                else if (!started) lead.push(ln);
                else if (items.length) items[items.length - 1] += ln;
              });
              body = (lead.length ? "<p>" + rich(lead.join("")) + "</p>" : "") +
                (items.length
                  ? '<ol class="ol-list">' + items.map(function (ln) {
                      return "<li>" + rich(ln) + "</li>";
                    }).join("") + "</ol>"
                  : "");
            } else {
              body = "<p>" + text + "</p>";
            }
            return '<div class="ol-step"><div class="ol-tag">' + esc(st.title) + "</div>" + body + "</div>";
          }).join("") +
        "</div>" +
      "</div>";
    }

    /* ---- 具体问题与修改思路：整篇层面的问题归纳，每条含方向与步骤 ---- */
    if (issues.length) {
      html += '<div class="blk">' +
        '<div class="blk-head"><h4>具体问题与修改思路</h4><i></i><span class="blk-meta">' +
        issues.length + " 项 · 按优先级排列</span></div>" +
        issues.map(function (it, i) {
          var stepsHtml = (it.steps || []).length
            ? '<ol class="fix-steps">' + it.steps.map(function (t) { return "<li>" + rich(t) + "</li>"; }).join("") + "</ol>"
            : "";
          return '<div class="issue">' +
            '<div class="issue-top"><span class="issue-no">' + (it.no || i + 1) + "</span>" +
              '<p class="issue-problem">' + rich(it.problem || "") + "</p></div>" +
            (it.advice
              ? '<div class="issue-advice"><span class="ia-lb">修改思路</span><p>' + rich(it.advice) + "</p></div>"
              : "") +
            (stepsHtml ? '<div class="issue-steps"><span class="ia-lb">怎么做</span>' + stepsHtml + "</div>" : "") +
          "</div>";
        }).join("") +
      "</div>";
    }

    /* ---- 错别字汇总：与导出报告同一份数据、同一套对齐规则 ---- */
    html += renderTypoBlock(r);

    if (!html) {
      html = '<div class="blk"><div class="comment-card overall-text">本次未生成写作建议，可点击「开始 AI 批改」重新生成。</div></div>';
    }

    $("#panelOutline").innerHTML = html;
  }

  /* ---- Tab 3 ---- */
  /* 素材积累：按「标签：句子」逐条展示；模型用换行分隔，旧数据可能是
     一整段（<b>素材示例</b>：①…②…），按 ①②③ / 换行拆条兜底 */
  function drillMaterials(text) {
    var raw = String(text || "").trim();
    if (!raw) return "";
    /* 去旧格式前缀 */
    raw = raw.replace(/<b>\s*素材示例\s*<\/b>\s*[:：]?/g, "")
             .replace(/<b>\s*可用句式\s*<\/b>\s*[:：]?/g, "\n句式：");
    var parts = raw.split(/\n+|(?=[①②③④⑤])/).map(function (s) {
      return s.replace(/^[①②③④⑤]\s*/, "").trim();
    }).filter(Boolean);
    if (!parts.length) return "";
    return '<ul class="drill-mat-list">' + parts.map(function (p) {
      /* 「标签：句子」拆成徽章 + 正文；无标签就整句展示 */
      var m = p.match(/^([^：:]{1,6})[：:]\s*([\s\S]+)$/);
      if (m) return '<li><span class="mat-tag">' + esc(m[1]) + "</span><span>" + rich(m[2]) + "</span></li>";
      return "<li><span>" + rich(p) + "</span></li>";
    }).join("") + "</ul>";
  }

  function renderDrills(r) {
    var ds = r.drills || [];
    if (!ds.length) {
      $("#panelDrill").innerHTML = '<div class="blk"><div class="comment-card overall-text">本次未生成小练笔，可点击「开始 AI 批改」重新生成。</div></div>';
      return;
    }
    $("#panelDrill").innerHTML =
      '<div class="blk">' +
        '<div class="blk-head"><h4>写作能力小练笔</h4><i></i><span class="blk-meta">3 题 · 通用能力训练</span></div>' +
        '<div class="drill-note">按本篇暴露的能力短板出题，练笔场景与本文无关——练什么、怎么写、攒素材，课下即可动笔。</div>' +
        ds.map(function (d) {
          /* 新旧字段兼容：skill/how 为新结构，problem/think 为旧报告 */
          var skill = d.skill || d.problem || "";
          var how = d.how || d.think || "";
          return '<div class="drill">' +
            '<div class="drill-top"><span class="drill-no">' + (d.no || 1) + "</span>" +
              "<h5>" + esc(d.title) + "</h5></div>" +
            (skill ? '<div class="drill-sec"><div class="lb s1">练什么</div><p>' + rich(skill) + "</p></div>" : "") +
            (how ? '<div class="drill-sec"><div class="lb s2">怎么写</div><p>' + rich(how) + "</p></div>" : "") +
            (d.material ? '<div class="drill-sec"><div class="lb s3">素材积累</div>' +
              '<div class="material">' + drillMaterials(d.material) + "</div></div>" : "") +
            '<div class="drill-task"><span>练笔任务</span><span>' + esc(d.task || "") + "</span></div>" +
          "</div>";
        }).join("") +
      "</div>";
  }

  /* ---- Tab 4 ---- */
  /* 润色稿正文：把 <m1>…</m4> 转成对应手法的底色与字色。
     标记之外的文字保持正文色，避免整篇单色难辨重点。 */
  function techBody(text) {
    return ZP.paintTechMarks(text, esc, function (k, inner) {
      var mk = ZP.techMarkOf(k);
      if (!mk) return inner;
      return '<span class="tech-span" style="--c:' + mk.color + '">' + inner + "</span>";
    });
  }

  /* 颜色图例：只列出本篇实际出现的标记，没出现的类别不占位 */
  function legendHtml(p) {
    var body = (p.paras || []).join("");
    var used = ZP.TECH_MARKS.filter(function (t) { return body.indexOf("<" + t.key + ">") >= 0; });
    if (!used.length) return "";
    return '<div class="tech-legend">' + used.map(function (t) {
      return '<span style="--c:' + t.color + '"><i></i>' + esc(t.name) + "</span>";
    }).join("") + "</div>";
  }

  function renderPolished(r) {
    var p = r.polished || { paras: [], words: 0 };
    var g = ZP.getGrade(r.grade || S.grade);
    var words = p.words || ZP.countChars(ZP.stripTechMarks((p.paras || []).join("")));
    var inRange = words >= g.words[0] && words <= g.words[1];

    /* 范文没生成出来：给出可执行的原因与下一步，不再只留一片空白 */
    if (!(p.paras || []).length) {
      var why = r.polishFailed === "no_source"
        ? "这次的批改没有取到原文句子（图片稿的批注可能未带原句），生成范文缺少依据。"
        : (r.polishFailed ? "生成范文时出错：" + esc(String(r.polishFailed).slice(0, 120)) : "");
      $("#panelPolished").innerHTML =
        '<div class="blk"><div class="blk-head"><h4>润色后文章</h4><i></i>' +
          '<span class="blk-meta">本次未生成</span></div>' +
          '<div class="comment-card overall-text">' +
            (why ? "<p>" + why + "</p>" : "") +
            '<p>可这样处理：① 在左侧「稿源文本」里粘贴作文正文后重新批改；' +
            '② 或换用能逐字照抄原句的视觉模型；③ 已生成的评分与批注仍然有效，不受影响。</p>' +
          "</div></div>";
      return;
    }

    var html =
      '<div class="blk">' +
        '<div class="polished-head">' +
          '<span class="ph-l">' + esc(g.name) + "要求 " + g.words[0] + "–" + g.words[1] + " 字</span>" +
          '<span class="ph-r">' + fmt(words) + "<em>字</em></span>" +
        "</div>" +
        legendHtml(p) +
        '<div class="polished-body">' +
          "<h5>" + esc(p.title || r.title) + "</h5>" +
          (p.paras || []).map(function (t) { return "<p>" + techBody(t) + "</p>"; }).join("") +
        "</div>" +
        '<div class="range-note' + (inRange ? "" : " warn") + '">' +
          (inRange ? "字数落在本年级区间内" : "字数偏离本年级要求区间，建议增删细节后重试") +
        "</div>" +
      "</div>";

    /* 本次使用的润色手法：旧报告与被字数校准覆盖时可能缺该字段，缺失则整块不渲染 */
    var tech = (Array.isArray(p.techniques) ? p.techniques : []).filter(function (t) {
      return t && (typeof t === "object" ? String(t.text || "").trim() : String(t).trim());
    });
    if (tech.length) {
      html += '<div class="blk tech-blk">' +
        '<div class="blk-head"><h4>本次使用的润色手法</h4><i></i><span class="blk-meta">' +
        tech.length + " 条 · 对照原文查看改动</span></div>" +
        '<ul class="tech-list">' +
          tech.map(function (t) {
            var mk = ZP.techMarkOf(t && t.mark);
            var label = mk ? '<b class="tech-key" style="--c:' + mk.color + '">' + esc(mk.name) + "</b>" : "";
            var body = String((t && t.text) || t || "");
            return "<li" + (mk ? ' style="--c:' + mk.color + '"' : "") + ">" + label + "<span>" + rich(body) + "</span></li>";
          }).join("") +
        "</ul>" +
      "</div>";
    }

    $("#panelPolished").innerHTML = html;
  }

  /* ---- 载入动画 ---- */
  function loading(on, title, sub, pct) {
    var box = $("#paperLoading");
    if (!box) return;
    if (on) {
      box.hidden = false;
      if (title) $("#loadTitle").textContent = title;
      if (sub) $("#loadSub").textContent = sub;
      if (pct != null) $("#loadBar").style.width = pct + "%";
    } else {
      box.hidden = true;
      $("#loadBar").style.width = "0%";
    }
  }

  /* 耗时与 token 分析卡片 */
  /* ============================================================
     白板导出
     ----------
     三栏：左卡 | 原稿 | 右卡，用 flex 并排（宽度不足时整块横向滚动，
     永不挤压、永不重叠）。卡片在栏内绝对定位，top 直接取该条批注
     在图片上的纵向百分比，与荧光条严格同高。

     每张卡的高度不预估——生成后由导出的脚本用真实 DOM 高度做一次
     「防重叠校正」：若卡片压住上一张，就整体下移，绝不让内容被遮。
     ============================================================ */
  function exportBoardHtml(result, opts) {
    opts = opts || {};
    var images = opts.images || [];
    var page = opts.page || 0;
    var all = annList(result);
    var anns = all.filter(function (a) { return (a.page || 0) === page; });
    if (!anns.length && all.length && !all.some(function (a) { return a.page !== undefined; })) anns = all;
    if (!anns.length) return "";

    var img = images[page];
    if (!img || !img.dataUrl) return "";

    var CARD_W = 200, GAP = 26, SHEET_W = 520;
    var ratio = (img.width && img.height) ? (img.height / img.width) : 1.414;
    var SHEET_H = Math.round(SHEET_W * ratio);

    var totalPara = Math.max(4, anns.reduce(function (m, a) {
      return Math.max(m, (a.para | 0) + 1);
    }, 0));

    var esc = function (t) {
      return String(t == null ? "" : t).replace(/[&<>"']/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
      });
    };

    var posOf = function (a) {
      var fbY, fbX1, fbX2;
      if (a.box) { fbY = a.box.y; fbX1 = a.box.x1; fbX2 = a.box.x2; }
      else {
        fbY = Math.min(94, (((a.para | 0) + 0.5) / totalPara) * 100);
        fbX1 = 4; fbX2 = 96;
      }
      return bandPos(a, { y: fbY, x1: fbX1, x2: fbX2 });
    };

    var leftList = [], rightList = [];
    anns.forEach(function (a, i) {
      var gk = all.indexOf(a);
      var it = {
        a: a,
        no: (gk >= 0 ? gk : i) + 1,
        pos: posOf(a),
        color: TYPE_COLOR[a.type] || "#7a5cc4"
      };
      (i % 2 === 0 ? leftList : rightList).push(it);
    });

    /* 卡片：绝对定位，top 与该条划线同高；data-top 供脚本做防重叠校正 */
    var cardHtml = function (it) {
      return '<div class="bcard" data-top="' + it.pos.y.toFixed(2) + '"' +
          ' style="top:' + it.pos.y.toFixed(2) + "%;border-left-color:" + it.color + '">' +
          '<span class="bno" style="background:' + it.color + '">' + it.no + "</span>" +
          '<div class="btag" style="color:' + it.color + '">' + esc(it.a.tag || TYPE_SHORT[it.a.type] || "") + "</div>" +
          '<div class="bnote">' + esc(annText(it.a)) + "</div>" +
          (it.a.fix ? '<div class="bfix' + (it.a.type === "red" ? " fix-short" : "") + '"><i>' +
            (it.a.type === "red" ? "正确写法" : "改写例句") + "</i>" + esc(it.a.fix) + "</div>" : "") +
        "</div>";
    };

    /* 荧光条 + 编号：坐标以图片自身为基准 */
    var bands = anns.map(function (a, i) {
      var gk = all.indexOf(a);
      var pos = posOf(a);
      var w = Math.max(6, Math.min(100 - pos.x1, pos.x2 - pos.x1));
      var goLeft = (i % 2 === 0);
      var NUM_W = 5.0;
      var nx = goLeft
        ? Math.max(0.5, Math.min(100 - NUM_W - 0.5, pos.x1 - NUM_W * 0.55))
        : Math.max(0.5, Math.min(100 - NUM_W - 0.5, pos.x2 - NUM_W * 0.45));
      return '<div class="bled b-' + a.type + '" style="top:' + pos.y.toFixed(2) + "%;left:" +
        pos.x1.toFixed(2) + "%;width:" + w.toFixed(2) + '%"></div>' +
        '<div class="bnum n-' + a.type + '" style="top:' + pos.y.toFixed(2) + "%;left:" +
        nx.toFixed(2) + '%">' + ((gk >= 0 ? gk : i) + 1) + "</div>";
    }).join("");

    /* 引线：只走图片两侧留白 */
    var lines = anns.map(function (a, i) {
      var goLeft = (i % 2 === 0);
      var pos = posOf(a);
      var color = TYPE_COLOR[a.type] || "#7a5cc4";
      return '<div class="bline ' + (goLeft ? "left" : "right") + '" style="top:' + pos.y.toFixed(2) +
        "%;--c:" + color + '"></div>';
    }).join("");

    var BOARD_W = CARD_W * 2 + GAP * 2 + SHEET_W;

    var css = ''
      /* 白板固定逻辑宽度，外层按可用宽度等比缩放（scale），
         这样导出到 A4 时三栏完整可见，不会被容器裁掉右侧。 */
      + '.bwrap{overflow:hidden;padding:2px 0 8px}'
      + '.bscale{transform-origin:top left;width:var(--bw)' + 'px}'
      + '.brow{position:relative;display:flex;align-items:flex-start;gap:' + GAP + 'px;'
      +   'width:' + BOARD_W + 'px;min-height:' + SHEET_H + 'px;margin:0 auto}'
      + '.bcol{position:relative;flex:0 0 ' + CARD_W + 'px;width:' + CARD_W + 'px;height:' + SHEET_H + 'px}'
      + '.bsheet{position:relative;flex:0 0 ' + SHEET_W + 'px;width:' + SHEET_W + 'px;height:' + SHEET_H + 'px;'
      +   'background:#fff;border:1px solid #e7e1d4;border-radius:2px;box-shadow:0 10px 28px -20px rgba(30,26,18,.5);overflow:hidden}'
      + '.bsheet img{display:block;width:100%;height:100%;object-fit:contain}'
      + '.bled{position:absolute;height:9px;border-radius:5px;transform:translateY(-50%)}'
      + '.bled.b-red{background:linear-gradient(90deg,rgba(224,74,60,.45),rgba(224,74,60,.26))}'
      + '.bled.b-amber{background:linear-gradient(90deg,rgba(240,186,52,.58),rgba(240,186,52,.32))}'
      + '.bled.b-green{background:linear-gradient(90deg,rgba(58,166,120,.46),rgba(58,166,120,.26))}'
      + '.bled.b-violet{background:linear-gradient(90deg,rgba(140,110,214,.46),rgba(140,110,214,.26))}'
      + '.bnum{position:absolute;transform:translateY(-50%);min-width:15px;height:15px;padding:0 3px;box-sizing:border-box;'
      +   'display:flex;align-items:center;justify-content:center;border-radius:8px;'
      +   'font-family:ui-monospace,Menlo,Consolas,monospace;font-size:9px;font-weight:700;color:#fff;'
      +   'box-shadow:0 1px 4px rgba(20,22,26,.28)}'
      + '.bnum.n-red{background:#cf4436}.bnum.n-amber{background:#d99a24}'
      + '.bnum.n-green{background:#2f8f6b}.bnum.n-violet{background:#7a5cc4}'
      + /* 卡片：top 是中心，用 translateY(-50%) 让卡片以划线为中心 */
        '.bcard{position:absolute;left:0;width:100%;transform:translateY(-50%);box-sizing:border-box;'
      +   'background:#fff;border:1px solid #ece6d8;border-left-width:2px;border-radius:8px;'
      +   'padding:10px 12px;box-shadow:0 6px 18px -14px rgba(30,26,18,.5);font-size:11px;line-height:1.65}'
      + '.bno{position:absolute;top:-6px;left:-6px;min-width:14px;height:14px;padding:0 3px;box-sizing:border-box;'
      +   'display:flex;align-items:center;justify-content:center;border-radius:7px;color:#fff;'
      +   'font-family:ui-monospace,Menlo,Consolas,monospace;font-size:8px;font-weight:700;box-shadow:0 1px 3px rgba(20,22,26,.25)}'
      + '.btag{font-size:9px;font-weight:600;letter-spacing:.04em;margin-bottom:3px}'
      + '.bnote{color:#3f4652}'
      + '.bfix{margin-top:6px;padding:5px 7px;background:#faf7ef;border-left:2px solid #dcc9a5;border-radius:0 4px 4px 0;'
      +   'font-size:10.5px;line-height:1.6;color:#6b6047}'
      + '.bfix i{display:block;font-style:normal;font-size:9px;color:#a89e8b;margin-bottom:2px;letter-spacing:.05em}'
      + '.bline{position:absolute;height:0;border-top:1px dashed var(--c);opacity:.62;width:' + GAP + 'px}'
      + '.bline.left{left:' + CARD_W + 'px}'
      + '.bline.right{right:' + CARD_W + 'px}';

    return '<div class="bwrap" data-w="' + BOARD_W + '" data-h="' + (SHEET_H + 10) + '" ' +
      'style="--bw:' + BOARD_W + ';height:' + (SHEET_H + 10) + 'px">' +
      '<style>' + css + "</style>" +
      '<div class="bscale">' +
      '<div class="brow">' +
        '<div class="bcol">' + leftList.map(cardHtml).join("") + "</div>" +
        '<div class="bsheet">' +
          '<img src="' + img.dataUrl + '" alt="作文原稿">' + bands +
          lines +
        "</div>" +
        '<div class="bcol">' + rightList.map(cardHtml).join("") + "</div>" +
      "</div></div></div>";
  }

  /* 导出后校正：卡片按真实高度防重叠，纸面高度按两栏实际需要撑开。
     由导出页在 DOM 就绪后调用一次；不依赖任何估算值。 */
  /**
   * 白板卡片排布（导出与画板共用）
   * ------------------------------------------------------------
   * 核心约束：
   * 1) 纸面高度永远等于原稿图片的自然高度，绝不被撑高——
   *    一旦撑高，图片会被拉长、比例失真，白板也就不再“所见即所得”。
   * 2) 两侧批注卡必须落在纸面垂直范围内（0 ~ sheetH），不得越过图片上下沿。
   * 3) 卡片之间不允许重叠；空间不够时优先压缩间距，其次允许侧栏比纸面略长，
   *    但超出部分只能出现在纸面外沿的一点点安全区内，不能压到别的区块。
   */
  function fixBoardLayout(host) {
    var root = host || document;
    var rows = root.querySelectorAll(".brow");

    Array.prototype.forEach.call(rows, function (row) {
      var cols = row.querySelectorAll(".bcol");
      var sheet = row.querySelector(".bsheet");
      var sheetH = sheet ? sheet.offsetHeight : 0;
      if (!sheetH) return;

      var GAP_MIN = 10;     /* 卡片最小间隙（整齐下排时用） */
      var GAP_MAX = 14;     /* 卡片理想间隙（放得下时用） */
      var maxColH = sheetH; /* 两列中最高的那一列，用于决定整行高度 */

      Array.prototype.forEach.call(cols, function (col) {
        var cards = Array.prototype.slice.call(col.querySelectorAll(".bcard"));
        if (!cards.length) return;

        /* 1) 清掉 transform 与临时 top，量真实高度 */
        cards.forEach(function (c) {
          c.style.transform = "none";
          c.style.top = "0px";
        });
        var hs = cards.map(function (c) { return c.offsetHeight; });
        var totalH = hs.reduce(function (a, b) { return a + b; }, 0);

        /* 2) 理想位置：卡片中心对齐各自划线 */
        var want = cards.map(function (c, i) {
          var pct = parseFloat(c.getAttribute("data-top")) || 0;
          return pct / 100 * sheetH - hs[i] / 2;
        });

        /* 3) 排布策略：
              · 放得下 → 卡片中心对齐划线，卡片之间保持理想间距；
              · 放不下 → 不压缩、不重叠，按顺序整齐下排，允许越过图片下沿
                （用户接受白板下方留白，只要卡片本身完整、彼此不叠）。 */
        var needMin = totalH + GAP_MIN * (cards.length - 1);
        var fits = needMin <= sheetH;

        var tops = want.slice();
        var prevBottom = -1e9;
        var gap = GAP_MAX;

        if (fits) {
          for (var i = 0; i < tops.length; i++) {
            if (tops[i] < prevBottom + gap) tops[i] = prevBottom + gap;
            if (tops[i] < 0) tops[i] = 0;
            prevBottom = tops[i] + hs[i];
          }
          /* 放得下却整体越界：整体上移即可 */
          var over0 = prevBottom - sheetH;
          if (over0 > 0.5) {
            var sh0 = Math.min(over0, tops[0]);
            if (sh0 > 0) tops = tops.map(function (t) { return t - sh0; });
          }
        } else {
          /* 放不下：从 0 开始顺序排列，保证不重叠、不压住 */
          var acc = 0;
          for (var j = 0; j < tops.length; j++) {
            tops[j] = acc;
            acc = acc + hs[j] + GAP_MIN;
          }
        }

        /* 6) 写回：卡片 top 为绝对值，卡片自身不再做 translateY */
        cards.forEach(function (c, i) {
          c.style.transform = "none";
          c.style.top = Math.round(tops[i]) + "px";
        });

        /* 7) 侧栏高度：至少与纸面同高；卡片实在放不下时允许向下延伸
              （用户接受下方留白），但绝不再撑高纸面。 */
        var needCol = Math.ceil(tops[tops.length - 1] + hs[hs.length - 1] + 8);
        var colH = Math.max(sheetH, needCol);
        col.style.height = colH + "px";
        col.style.minHeight = colH + "px";
        if (colH > maxColH) maxColH = colH;
      });

      /* 8) 纸面高度锁死为图片高度：绝不因卡片而改变图片比例 */
      if (sheet) {
        sheet.style.minHeight = "";
        sheet.style.height = sheetH + "px";
      }
      /* 整行高度取「纸面」与「最高的侧栏」，保证向下延伸的部分可见 */
      row.style.minHeight = Math.max(sheetH, maxColH) + "px";
    });
  }

  /* 导出模块共用：把一条批注解析成「最终位置」（含人工微调）。
     无 box（或整组坐标聚集）时按「同页批注序号」纵向均分，
     与界面 paintHighlights 同口径——图片稿 para 全 0 不再挤同一行。 */
  function boardPos(a, res) {
    var all = (res && res.annotations) || [];
    var page = a.page || 0;
    var peers = all.filter(function (x) { return (x.page || 0) === page; });
    if (!peers.length) peers = all;
    /* 聚集检测：与界面同规则 */
    var boxed = peers.filter(function (x) { return x.box; });
    var clustered = false;
    if (boxed.length >= 3) {
      var ys = boxed.map(function (x) { return x.box.y; });
      var xs = boxed.map(function (x) { return (x.box.x1 + x.box.x2) / 2; });
      var spread = function (arr) { return Math.max.apply(null, arr) - Math.min.apply(null, arr); };
      clustered = spread(ys) < 15 && spread(xs) < 20;
    }
    var fbY, fbX1, fbX2;
    if (a.box && !clustered) { fbY = a.box.y; fbX1 = a.box.x1; fbX2 = a.box.x2; }
    else {
      var i = peers.indexOf(a);
      if (i < 0) i = 0;
      var n = Math.max(1, peers.length);
      fbY = Math.min(94, Math.max(5, ((i + 0.5) / n) * 88 + 5));
      fbX1 = 4; fbX2 = 96;
    }
    return bandPos(a, { y: fbY, x1: fbX1, x2: fbX2 });
  }

  function typeColor(t) { return TYPE_COLOR[t] || "#7a5cc4"; }

  ZP.Render = {
    boardPos: boardPos,
    matchMarks: matchMarks,
    typeColor: typeColor,
    exportBoardHtml: exportBoardHtml,
    fixBoardLayout: fixBoardLayout,
    adjOf: adjOf,
    hasAdj: hasAdj,
    clearAdj: function (a) { if (a) a.adj = {}; },
    bind: function (state) { S = state; return ZP.Render; },
    essay: essay,
    imageSheet: imageSheet,
    pending: pending,
    emptyPaper: emptyPaper,
    report: report,
    emptyReport: emptyReport,
    drawRadar: drawRadar,
    loading: loading,
    focusAnn: focusAnn,
    esc: esc,
    rich: rich,
    fmt: fmt,
    TYPE_LABEL: TYPE_LABEL,
    TYPE_COLOR: TYPE_COLOR
  };
})(window.ZP);
