/* ============================================================
   智批作文 · 消息中心（铃铛）
   汇总：批改成功 / 失败 / 停止 / 系统提示
   存储：localStorage，保留最近 60 条
   ============================================================ */
window.ZP = window.ZP || {};

(function (ZP) {
  "use strict";

  var KEY = "zhipi.notices.v1";
  var MAX = 60;
  var ctx = {};

  function attach(c) { Object.assign(ctx, c || {}); return ZP.Notice; }
  function esc(s) { return ctx.esc ? ctx.esc(s) : String(s == null ? "" : s); }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function persist(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX))); }
    catch (e) { /* 配额不足时忽略，不影响主流程 */ }
  }

  function timeText(ts) {
    var d = new Date(ts || Date.now());
    var now = new Date();
    var sameDay = d.toDateString() === now.toDateString();
    var hm = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    return sameDay ? hm : (d.getMonth() + 1) + "/" + d.getDate() + " " + hm;
  }

  /* level: ok | err | warn | info */
  function push(title, detail, level) {
    var list = load();
    list.unshift({
      id: "n" + Date.now() + Math.random().toString(36).slice(2, 5),
      title: String(title || "").slice(0, 80),
      detail: String(detail || "").slice(0, 400),
      level: level || "info",
      at: Date.now(),
      read: false
    });
    persist(list);
    paint();
    return list[0];
  }

  function unreadCount() {
    return load().filter(function (n) { return !n.read; }).length;
  }

  function markAllRead() {
    var list = load().map(function (n) { n.read = true; return n; });
    persist(list);
    paint();
  }

  function clear() {
    persist([]);
    paint();
  }

  function remove(id) {
    persist(load().filter(function (n) { return n.id !== id; }));
    paint();
  }

  var ICON = { ok: "✓", err: "!", warn: "!", info: "i" };

  function itemHtml(n) {
    return '<div class="nt-item ' + n.level + (n.read ? "" : " unread") + '" data-nid="' + esc(n.id) + '">' +
      '<span class="nt-dot">' + (ICON[n.level] || "i") + "</span>" +
      '<div class="nt-main"><div class="nt-top"><b>' + esc(n.title) + "</b><time>" + timeText(n.at) + "</time></div>" +
      (n.detail ? '<p>' + esc(n.detail).replace(/\n/g, "<br>") + "</p>" : "") +
      "</div></div>";
  }

  /* 绘制铃铛角标 */
  function paint() {
    var bell = document.getElementById("bellBtn");
    if (!bell) return;
    var n = unreadCount();
    bell.classList.toggle("has-unread", n > 0);
    var dot = bell.querySelector(".bell-count");
    if (dot) {
      dot.textContent = n > 9 ? "9+" : String(n);
      dot.hidden = n === 0;
    }
  }

  /* 打开消息面板 */
  function open() {
    var panel = document.getElementById("noticePanel");
    if (!panel) return;

    var list = load();
    var body = panel.querySelector(".nt-list");
    body.innerHTML = list.length
      ? list.map(itemHtml).join("")
      : '<div class="nt-empty">还没有消息。<br>批改成功、失败或停止时会在这里提醒。</div>';

    /* 面板改为固定定位，避免被 240px 侧栏裁切 */
    var r = document.getElementById("bellBtn").getBoundingClientRect();
    var pw = 300;
    var left = Math.min(Math.max(10, r.right - pw + 6), window.innerWidth - pw - 10);
    var top = Math.min(r.bottom + 8, window.innerHeight - 380);
    panel.style.left = left + "px";
    panel.style.top = Math.max(64, top) + "px";

    panel.hidden = false;
    requestAnimationFrame(function () { panel.classList.add("open"); });

    /* 打开即视为已读 */
    setTimeout(markAllRead, 700);
  }

  function close() {
    var panel = document.getElementById("noticePanel");
    if (!panel) return;
    panel.classList.remove("open");
    setTimeout(function () { panel.hidden = true; }, 220);
  }

  function init() {
    var bell = document.getElementById("bellBtn");
    var panel = document.getElementById("noticePanel");
    if (!bell || !panel) return;

    bell.addEventListener("click", function (e) {
      e.stopPropagation();
      if (panel.hidden) open(); else close();
    });
    panel.querySelector(".nt-close").addEventListener("click", close);
    document.addEventListener("click", function (e) {
      if (!panel.hidden && !e.target.closest("#noticePanel") && !e.target.closest("#bellBtn")) close();
    });
    var clearBtn = panel.querySelector(".nt-clear");
    if (clearBtn) clearBtn.addEventListener("click", function () {
      if (!confirm("清空全部消息？")) return;
      clear();
      open();
    });
    panel.querySelector(".nt-list").addEventListener("click", function (e) {
      var it = e.target.closest("[data-nid]");
      if (!it) return;
      /* 点击消息：失败类给出详情弹窗，其余仅标记已读 */
      var id = it.dataset.nid;
      var n = load().filter(function (x) { return x.id === id; })[0];
      if (n && n.level === "err" && n.detail && ctx.onErrorDetail) ctx.onErrorDetail(n.detail);
    });

    paint();
  }

  ZP.Notice = {
    attach: attach, init: init, push: push, paint: paint,
    load: load, markAllRead: markAllRead, clear: clear, remove: remove,
    unreadCount: unreadCount
  };
})(window.ZP);
