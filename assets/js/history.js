/* ============================================================
   智批作文 · 历史批改 & 多份管理
   通过 ZP.History.attach(ctx) 注入应用回调
   ============================================================ */
window.ZP = window.ZP || {};

(function (ZP) {
  "use strict";

  var KEY = "zhipi.history.v1";
  var MAX = 40;
  var ctx = {};      /* { toast, esc, fmt, getImages, onRestore, onBadge } */

  function attach(c) {
    Object.assign(ctx, c || {});
    return ZP.History;
  }

  function esc(s) { return ctx.esc ? ctx.esc(s) : String(s == null ? "" : s); }
  function fmt(n) { return ctx.fmt ? ctx.fmt(n) : (n || 0); }
  function toast(m, k) { ctx.toast && ctx.toast(m, k); }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function persist(list) {
    var trimmed = list.slice(0, MAX);
    /* 原稿全图很占空间：存不下时按「先砍最旧的、再砍全图、最后只留封面」逐步降级，
       而不是直接把最新的原稿丢掉。返回是否成功。 */
    try {
      localStorage.setItem(KEY, JSON.stringify(trimmed));
      return true;
    } catch (e) { /* 继续降级 */ }

    try {
      var slim = trimmed.slice(0, 12).map(function (x) {
        return Object.assign({}, x, { imageList: [] });
      });
      localStorage.setItem(KEY, JSON.stringify(slim));
      return true;
    } catch (e2) { /* 继续降级 */ }

    try {
      var tinier = trimmed.slice(0, 12).map(function (x) {
        return Object.assign({}, x, { imageList: [], thumb: "" });
      });
      localStorage.setItem(KEY, JSON.stringify(tinier));
      toast("本地存储空间不足，已保留最近 12 份记录（原稿图未保存）。", "warn");
      return true;
    } catch (e3) {
      toast("本地存储已满，历史记录未能保存。", "err");
      return false;
    }
  }

  /* 只保留报告所需字段 + 一张封面缩略图，控制体积 */
  function pack(res, images) {
    var d = {
      id: "h" + Date.now(),
      savedAt: Date.now(),
      title: res.title,
      student: res.student,
      meta: res.meta,
      grade: res.grade,
      genre: res.genre,
      score: res.score,
      level: res.level,
      levelCls: res.levelCls,
      wordCount: res.wordCount,
      dims: res.dims,
      overall: res.overall,
      metrics: res.metrics,
      annotations: res.annotations,
      paragraphs: res.paragraphs,
      outline: res.outline,
      drills: res.drills,
      polished: res.polished,
      inRange: res.inRange,
      range: res.range,
      source: res.source,
      docId: res.docId || "",
      elapsed: res.elapsed || 0,
      pages: (images || []).length,
      hasImage: !!(images && images.length),
      thumb: images && images.length ? images[0].dataUrl : "",
      /* 全部页都存下来：恢复历史时要能像当时一样翻页看原稿。
         注意 docId + pages 也一并存下：旧版本只存了第 1 页封面，
         升级后可用这两项到作文队列里把整组原稿找回来。 */
      imageList: (images || []).map(function (im) {
        return {
          dataUrl: im.dataUrl,
          width: im.width || 0,
          height: im.height || 0,
          size: im.size || 0,
          name: im.name || ""
        };
      })
    };
    return d;
  }

  function save(res, images) {
    if (!res || res.isDemo) return;
    var list = load();
    var entry = pack(res, images);
    /* 同一篇重复批改：更新而不是叠加 */
    var sig = entry.title + "|" + entry.student + "|" + entry.score;
    var old = list.filter(function (x) {
      return (x.title + "|" + x.student + "|" + x.score) !== sig;
    });
    /* 保留原始时间与 id，避免重复记录时间跳变 */
    var same = list.filter(function (x) {
      return (x.title + "|" + x.student + "|" + x.score) === sig;
    })[0];
    if (same) {
      entry.id = same.id;
      entry.savedAt = Date.now();
    }
    old.unshift(entry);
    persist(old);
    badge();
    return entry;
  }

  function badge() {
    var n = load().length;
    var btn = document.getElementById("historyBtn");
    if (btn) btn.textContent = n ? "历史批改 " + n : "历史批改";
    ctx.onBadge && ctx.onBadge(n);
  }

  function remove(id) {
    persist(load().filter(function (x) { return x.id !== id; }));
    badge();
  }

  function clear() {
    localStorage.removeItem(KEY);
    badge();
  }

  function dur(ms) {
    var t = Math.max(0, Math.round((ms || 0) / 1000));
    if (t < 60) return t + " 秒";
    var m = Math.floor(t / 60), s = t % 60;
    return s ? m + " 分 " + s + " 秒" : m + " 分";
  }

  function timeText(ts) {
    var d = new Date(ts || Date.now());
    return (d.getMonth() + 1) + "月" + d.getDate() + "日 " +
      String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }

  function itemHtml(x) {
    var thumb = x.thumb
      ? '<img src="' + x.thumb + '" alt="" style="width:34px;height:44px;object-fit:cover;border-radius:4px;border:1px solid #ece5d6;flex:0 0 34px">'
      : '<span style="width:34px;height:44px;border-radius:4px;background:#f4efe4;border:1px solid #eae3d4;display:grid;place-items:center;font-size:15px;color:#bdb2a0;flex:0 0 34px">文</span>';

    return '<div class="hist-item" data-id="' + esc(x.id) + '" style="display:flex;gap:10px">' +
      thumb +
      '<div style="flex:1;min-width:0">' +
        '<div class="hist-top">' +
          '<span class="hist-title">' + esc(x.title || "未命名") + "</span>" +
          '<span class="hist-score">' + x.score + "<small>/100</small></span>" +
        "</div>" +
        '<div class="hist-meta"><span>' + esc(x.student || "未署名") + "</span><i></i><span>" +
          esc(x.meta || "") + "</span><i></i><span>" + esc(x.level || "") + "</span></div>" +
        '<div class="hist-meta" style="margin-top:3px"><span>' + timeText(x.savedAt) + "</span><i></i><span>" +
          fmt(x.wordCount || 0) + " 字</span>" +
          (x.pages > 1 ? '<span class="hist-badge">' + x.pages + " 页</span>" : "") +
          (x.elapsed ? '<span class="hist-badge hist-time">用时 ' + dur(x.elapsed) + "</span>" : "") +
        "</div>" +
      "</div>" +
      '<button class="hist-del" type="button" data-del="' + esc(x.id) + '">删除</button>' +
    "</div>";
  }

  function open() {
    var list = load();

    var mask = document.createElement("div");
    mask.className = "history-mask";
    mask.id = "historyMask";

    var panel = document.createElement("aside");
    panel.className = "history-panel";
    panel.id = "historyPanel";
    panel.innerHTML =
      '<header class="history-head"><div><h3>历史批改</h3><p>共 ' + list.length +
        " 份 · 仅保存在本机浏览器</p></div>" +
        '<button class="modal-x" id="histClose" type="button" aria-label="关闭">×</button></header>' +
      '<div class="history-tools">' +
        '<input id="histSearch" type="text" placeholder="搜索标题或姓名" spellcheck="false" />' +
        '<button class="btn-mini" id="histClear" type="button" style="flex:0 0 auto">清空</button>' +
      "</div>" +
      '<div class="history-list" id="historyList"></div>';

    document.body.appendChild(mask);
    document.body.appendChild(panel);

    function close() {
      mask.remove();
      panel.remove();
      document.removeEventListener("keydown", onKey);
    }
    function onKey(e) { if (e.key === "Escape") close(); }

    mask.addEventListener("click", close);
    document.getElementById("histClose").addEventListener("click", close);
    document.addEventListener("keydown", onKey);

    function paint(kw) {
      var box = document.getElementById("historyList");
      var arr = load();
      if (kw) {
        var k = kw.toLowerCase();
        arr = arr.filter(function (x) {
          return String(x.title || "").toLowerCase().indexOf(k) >= 0 ||
                 String(x.student || "").toLowerCase().indexOf(k) >= 0;
        });
      }
      if (!arr.length) {
        box.innerHTML = '<div class="history-empty">' +
          (kw ? "没有匹配的记录。" : "还没有批改记录。<br>完成一次真实批改后会自动存入这里。") + "</div>";
        return;
      }
      box.innerHTML = arr.map(itemHtml).join("");
    }

    paint("");

    document.getElementById("histSearch").addEventListener("input", function () {
      paint(this.value.trim());
    });

    document.getElementById("historyList").addEventListener("click", function (e) {
      var del = e.target.closest("[data-del]");
      if (del) {
        e.stopPropagation();
        remove(del.dataset.del);
        paint(document.getElementById("histSearch").value.trim());
        toast("已删除该记录。");
        return;
      }
      var item = e.target.closest(".hist-item");
      if (!item) return;
      var rec = load().filter(function (x) { return x.id === item.dataset.id; })[0];
      if (rec) { close(); ctx.onRestore && ctx.onRestore(rec); }
    });

    document.getElementById("histClear").addEventListener("click", function () {
      if (!confirm("确定清空全部历史批改记录？此操作不可恢复。")) return;
      clear();
      paint("");
      toast("历史记录已清空。");
    });
  }

  /* 局部更新一条记录（用于给旧记录补齐原稿页） */
  function patch(id, fields) {
    var list = load();
    var hit = false;
    list.forEach(function (x) {
      if (x.id !== id) return;
      Object.keys(fields || {}).forEach(function (k) { x[k] = fields[k]; });
      hit = true;
    });
    if (hit) persist(list);
    return hit;
  }

  /* 按作文队列的 docId 更新最近一条记录（微调批注位置后同步） */
  function patchByDoc(docId, fields) {
    if (!docId) return false;
    var list = load();
    for (var i = 0; i < list.length; i++) {
      if (list[i].docId === docId) {
        Object.keys(fields || {}).forEach(function (k) { list[i][k] = fields[k]; });
        persist(list);
        return true;
      }
    }
    return false;
  }

  ZP.History = {
    attach: attach,
    patch: patch,
    patchByDoc: patchByDoc,
    load: load,
    save: save,
    remove: remove,
    clear: clear,
    badge: badge,
    open: open,
    count: function () { return load().length; }
  };
})(window.ZP);
