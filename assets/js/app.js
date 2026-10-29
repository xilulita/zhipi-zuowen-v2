/* ============================================================
   智批作文 · 应用主逻辑
   状态管理 / 交互绑定 / 批改流程 / 导出
   ============================================================ */
(function (ZP) {
  "use strict";

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var R = ZP.Render;

  var S = {
    grade: "g5",
    genre: "记叙文",
    student: "",
    weights: Object.assign({}, ZP.DEFAULT_WEIGHTS),
    demo: true,
    result: ZP.DEMO,
    /* 一份作文可含多张原稿：images=[{dataUrl,width,height,size,name}] */
    images: [],
    image: null,          /* 兼容：= images[0] */
    docs: [],             /* 多份作文队列 */
    activeDoc: 0,
    imgPage: 0,           /* 多页原稿当前页 */
    text: "",
    title: "",
    view: "text",
    zoom: 1,
    busy: false
  };

  R.bind(S);

  /* ---------------- 提示 ---------------- */
  function toast(msg, kind) {
    var wrap = $("#toastWrap");
    var el = document.createElement("div");
    el.className = "toast" + (kind ? " " + kind : "");
    el.innerHTML = "<i></i><span></span>";
    el.querySelector("span").textContent = msg;
    wrap.appendChild(el);
    setTimeout(function () {
      el.classList.add("out");
      setTimeout(function () { el.remove(); }, 240);
    }, kind === "err" ? 5000 : 2600);
  }

  /* ---------------- 演示态清理 ----------------
     一旦涉及真实稿件，绝不能沿用演示分数与批注 */
  function leaveDemo() {
    if (!S.demo) return;
    S.demo = false;
    S.result = null;

    /* 演示姓名不得带入真实稿：仅当用户未自行填写时才清空 */
    var nameInput = $("#studentName");
    if (nameInput && nameInput.value.trim() === ZP.DEMO.student) {
      nameInput.value = "";
      S.student = "";
    }
    /* 清掉演示分数残留，避免真实稿出现别人的成绩 */
    var scoreEl = $("#rScore");
    if (scoreEl) scoreEl.textContent = "—";
    var lvEl = $("#rLevel");
    if (lvEl) { lvEl.textContent = "待批改"; lvEl.className = "level-badge"; }
  }

  /**
   * 换稿时彻底清空上一次批改结果。
   * 真实稿绝不能残留上一份的分数/等级/批注。
   */
  function clearResult() {
    S.result = null;
    /* 内存与存储保持同步：否则刷新后队列里还留着上一份/上一版的结果 */
    var cur = S.docs && S.docs[S.activeDoc];
    if (cur && !S.demo) {
      cur.result = null;
      cur.elapsed = 0;
      saveDocs();
    }
    renderSideCost(null);
    var sc = $("#rScore");
    if (sc) sc.textContent = "—";
    var lv = $("#rLevel");
    if (lv) { lv.textContent = "待批改"; lv.className = "level-badge"; }
    var mn = $("#rName");
    if (mn) mn.textContent = S.student || "未署名";
    var md = $("#rMiniDims");
    if (md) md.innerHTML = "";
    var dn = $("#reportDisclaimer");
    if (dn) dn.textContent = "";
  }

  function headTitle(text) {
    var first = ZP.splitParagraphs(text)[0] || "";
    first = first.replace(/^[《「『"']+|[》」』"']+$/g, "").trim();
    if (first.length && first.length <= 24) return first;
    return "我的作文";
  }

  /**
   * 年级/体裁变更后，旧报告的评分口径已不同，标记为「过期」。
   * 只做标记、不清空：原稿、批注、报告全文都留着，用户可重新批改覆盖，
   * 也可切回原年级/体裁直接恢复。
   */
  function invalidateStale(reason) {
    if (S.demo) return;
    if (!S.result) return;

    var source = reason === "年级" ? S.result.grade : S.result.genre;
    var now = reason === "年级" ? S.grade : S.genre;
    var unchanged = source === now;
    var was = !!S.result.stale;

    /* 每次都按「报告口径 vs 当前选择」重算，切回原年级/体裁时标记会自然消失 */
    S.result.stale = unchanged ? null : { reason: reason, at: Date.now() };

    var cur2 = S.docs && S.docs[S.activeDoc];
    if (cur2) { cur2.result = S.result; saveDocs(); }
    paintStaleChip();

    if (!unchanged && !was) {
      toast(reason + "已变更，评分口径随之改变，报告仍保留供参考，可重新批改生成新报告。");
    }
  }

  /* 报告头部的「待复核」提示条：切走、切回都会同步 */
  function paintStaleChip() {
    var chip = $("#staleChip");
    if (!chip) return;
    var st = S.result && S.result.stale;
    chip.hidden = !st;
    if (st) {
      chip.textContent = st.reason + "已变更 · 此为变更前的报告，重新批改可更新";
    }
  }

  function refreshPending() {
    R.pending();
    R.emptyReport();
    syncSeg();
  }

  /* ---------------- 左侧：体裁 ---------------- */
  function initGenres() {
    var box = $("#genreChips");
    box.innerHTML = "";
    ZP.GENRES.forEach(function (g) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "chip" + (g === S.genre ? " active" : "");
      var emo = {"记叙文":"📖","写人":"👤","写景":"🌿","状物":"🪶","想象作文":"✨","读后感":"💭","议论文":"⚖️"}[g] || "✍️";
      b.innerHTML = '<span class="chip-emoji">' + emo + '</span><span>' + g + '</span>';
      b.dataset.genre = g;
      b.addEventListener("click", function () {
        S.genre = g;
        $$(".chip", box).forEach(function (x) {
          x.classList.toggle("active", x.dataset.genre === g);
        });
        updateGradeCard();
        if (S.demo) {
          /* 演示样例保持原样，只用于展示；不因切换体裁而被清空 */
          return;
        }
        if (S.result && S.result.meta) $("#rMeta").textContent = S.result.meta;
        invalidateStale("体裁");
      });
      box.appendChild(b);
    });
  }

  /* ---------------- 左侧：年级 ---------------- */
  function initGrades() {
    var sel = $("#gradeSelect"), menu = $("#gradeMenu"), trigger = $("#gradeTrigger");
    sel.innerHTML = "";
    ZP.GRADES.forEach(function (g) {
      var o = document.createElement("option"); o.value = g.id; o.textContent = g.name; sel.appendChild(o);
    });
    sel.value = S.grade;
    renderGradeMenu();

    trigger.addEventListener("click", function (e) {
      e.stopPropagation();
      var open = menu.hidden;
      menu.hidden = !open;
      trigger.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) {
        renderGradeMenu();
        var r = trigger.getBoundingClientRect();
        var top = Math.min(r.bottom + 5, window.innerHeight - Math.min(360, window.innerHeight - 100) - 12);
        menu.style.left = (r.left) + "px";
        menu.style.top = Math.max(10, top) + "px";
      }
    });
    menu.addEventListener("mouseover", function (e) {
      var item = e.target.closest(".grade-option"); if (!item) return;
      var fly = item.querySelector(".grade-fly"); if (!fly) return;
      var r = item.getBoundingClientRect();
      fly.style.left = Math.min(window.innerWidth - 322, r.right + 8) + "px";
      fly.style.top = Math.max(10, Math.min(window.innerHeight - fly.offsetHeight - 10, r.top - 2)) + "px";
    });
    menu.addEventListener("click", function (e) {
      var item = e.target.closest("[data-grade]"); if (!item) return;
      applyGrade(item.dataset.grade); menu.hidden = true; trigger.setAttribute("aria-expanded", "false");
    });
    document.addEventListener("click", function (e) {
      if (!e.target.closest("#gradePicker")) { menu.hidden = true; trigger.setAttribute("aria-expanded", "false"); }
    });
    sel.addEventListener("change", function () { applyGrade(sel.value); });
  }

  function renderGradeMenu() {
    var menu = $("#gradeMenu"); if (!menu) return;
    menu.innerHTML = ZP.GRADES.map(function (g) {
      return '<button type="button" class="grade-option' + (g.id === S.grade ? " active" : "") + '" data-grade="' + g.id + '">' +
        '<span><b>' + g.name + '</b><em>' + g.words[0] + '–' + g.words[1] + ' 字</em></span>' +
        '<div class="grade-fly"><header><strong>' + g.name + '写作要求</strong><i>' + g.words[0] + '–' + g.words[1] + ' 字</i></header>' +
        '<ul>' + g.reqs.map(function (r) { return '<li>' + r + '</li>'; }).join("") + '</ul>' +
        '<p>' + g.rule + '</p></div></button>';
    }).join("");
  }

  function applyGrade(id) {
    S.grade = id; $("#gradeSelect").value = id;
    updateGradeCard(); renderDims(); renderGradeMenu(); invalidateStale("年级");
  }

  function updateGradeCard() {
    var g = ZP.getGrade(S.grade);
    /* 写作要求只在年级下拉的悬浮卡里展示，左侧不再重复一栏 */
    if ($("#gradeTriggerText")) $("#gradeTriggerText").textContent = g.name;
    if ($("#gradeTriggerMeta")) $("#gradeTriggerMeta").textContent = g.words[0] + "–" + g.words[1] + " 字";
  }

  /* ---------------- 四维权重 ---------------- */
  function renderDims() {
    var box = $("#dims");
    var g = ZP.getGrade(S.grade);
    box.innerHTML = "";
    ZP.DIMS.forEach(function (d) {
      var wrap = document.createElement("div");
      wrap.className = "dim";
      wrap.style.setProperty("--c", d.color);
      wrap.dataset.key = d.key;
      wrap.innerHTML =
        '<div class="dim-head">' +
          '<i class="dim-dot"></i>' +
          '<span class="dim-name">' + d.name + "</span>" +
          '<span class="dim-val">' + S.weights[d.key] + "<small>分</small></span>" +
        "</div>" +
        '<input type="range" class="range" min="5" max="70" step="1" value="' + S.weights[d.key] + '" aria-label="' + d.name + '权重">' +
        '<p class="dim-req">' + (g.dimReq[d.key] || d.desc) + "</p>";
      var input = $(".range", wrap);
      input.style.setProperty("--p", ((S.weights[d.key] - 5) / 65 * 100) + "%");
      input.addEventListener("input", function () { setWeight(d.key, Number(input.value)); });
      box.appendChild(wrap);
    });
    updateWeightDisplay();
  }

  function updateWeightDisplay() {
    var total = ZP.DIMS.reduce(function (s, d) { return s + S.weights[d.key]; }, 0);
    $("#weightTotal").textContent = total;
    $$(".dim", $("#dims")).forEach(function (w) {
      var k = w.dataset.key;
      $(".dim-val", w).innerHTML = S.weights[k] + "<small>分</small>";
      var r = $(".range", w);
      r.value = S.weights[k];
      r.style.setProperty("--p", ((S.weights[k] - 5) / 65 * 100) + "%");
    });
  }

  /**
   * 拖动任意一项，其余三项按原比例此消彼长，合计恒为 100
   */
  function setWeight(key, val) {
    val = Math.max(5, Math.min(70, Math.round(val)));
    var others = ZP.DIMS.map(function (d) { return d.key; }).filter(function (k) { return k !== key; });
    var MIN = 5;
    var remain = 100 - val;

    // 每项保底 MIN，余量按原有「超出保底部分」比例分配
    var baseSum = others.reduce(function (s, k) { return s + MIN; }, 0);
    var extraPool = Math.max(0, remain - baseSum);
    var curExtra = others.reduce(function (s, k) { return s + Math.max(0, S.weights[k] - MIN); }, 0);

    var alloc = {}, used = 0;
    others.forEach(function (k) {
      var share = curExtra > 0 ? Math.max(0, S.weights[k] - MIN) / curExtra : 1 / others.length;
      var raw = MIN + extraPool * share;
      alloc[k] = Math.floor(raw);
      alloc["_" + k] = raw - Math.floor(raw);
      used += alloc[k];
    });

    var left = remain - used;
    var order = others.slice().sort(function (a, b) { return alloc["_" + b] - alloc["_" + a]; });
    var i = 0;
    while (left > 0) {
      alloc[order[i % order.length]] += 1;
      left--; i++;
      if (i > 200) break;
    }

    S.weights[key] = val;
    others.forEach(function (k) { S.weights[k] = Math.max(MIN, alloc[k]); });

    // 兜底：保证严格等于 100
    var total = ZP.DIMS.reduce(function (s, d) { return s + S.weights[d.key]; }, 0);
    if (total !== 100) S.weights[others[0]] += (100 - total);

    updateWeightDisplay();
    scheduleRescore();
  }

  var rescoreTimer = null;
  function scheduleRescore() {
    /* 演示样例保持固定的 66 分，避免总评文字与分数脱节；
       真实批改结果才随权重实时重算 */
    if (!S.result || S.demo) return;
    clearTimeout(rescoreTimer);
    rescoreTimer = setTimeout(rescore, 180);
  }

  function rescore() {
    if (!S.result) return;
    var sum = 0;
    ZP.DIMS.forEach(function (d) {
      var hit = (S.result.dims || []).filter(function (x) { return x.key === d.key; })[0];
      sum += (hit ? hit.score : 0) * S.weights[d.key];
    });
    var score = Math.max(0, Math.min(100, Math.round(sum / 100)));
    var lv = ZP.levelOf(score, S.result.grade || S.grade);

    /* 权重变化本身也必须重渲染：否则报告里的 /30 /25 分母会停留在旧值 */
    var sig = ZP.DIMS.map(function (d) { return S.weights[d.key]; }).join("-") +
      "|" + score + "|" + lv.name;
    if (sig === S.result.__sig) return;

    S.result.score = score;
    S.result.level = lv.name;
    S.result.levelCls = lv.cls;
    S.result.__sig = sig;
    R.report(S.result);
    paintStaleChip();
  }

  /* ---------------- 手风琴 ---------------- */
  function initAccordion() {
    var acc = $("#settingsAcc"), head = $("#accToggle");
    head.addEventListener("click", function () {
      var open = acc.classList.toggle("open");
      head.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) {
        /* 展开后滚动到「能看完整四维」的位置：底部对齐可见区下沿 */
        setTimeout(function () {
          var sc = document.querySelector(".side-scroll");
          if (!sc) return;
          var need = acc.offsetTop + acc.querySelector(".acc-body").scrollHeight;
          var target = Math.max(0, need - sc.clientHeight + 16);
          sc.scrollTo({ top: target, behavior: "smooth" });
        }, 320);
      }
    });
  }

  function initConfigAccordion() {
    var acc = $("#cfgSection"), head = $("#cfgToggle");
    if (!acc || !head) return;
    function openCfg(tab) {
      acc.classList.add("open"); head.setAttribute("aria-expanded", "true");
      if (tab) switchCfgTab(tab);
      setTimeout(function () {
        var sc = document.querySelector(".side-scroll");
        if (sc) sc.scrollTo({ top: Math.max(0, acc.offsetTop - 8), behavior: "smooth" });
      }, 160);
    }
    head.addEventListener("click", function () {
      var open = acc.classList.toggle("open"); head.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) openCfg("api");
    });
    Array.prototype.forEach.call(document.querySelectorAll(".cfg-tabs button"), function (b) {
      b.addEventListener("click", function () { switchCfgTab(b.dataset.cfgTab); });
    });
    var jump = $("#jumpCfg"); if (jump) jump.addEventListener("click", function () { openCfg("api"); });
    window.__openCfg = openCfg;
  }

  function switchCfgTab(id) {
    Array.prototype.forEach.call(document.querySelectorAll(".cfg-tabs button"), function (b) { b.classList.toggle("active", b.dataset.cfgTab === id); });
    Array.prototype.forEach.call(document.querySelectorAll(".cfg-pane"), function (p) { p.classList.toggle("active", p.dataset.cfgPane === id); });
  }

  function openAccordion() {
    var acc = $("#settingsAcc");
    if (!acc.classList.contains("open")) {
      acc.classList.add("open");
      $("#accToggle").setAttribute("aria-expanded", "true");
    }
  }

  /* ---------------- 接口配置 ---------------- */
  function initConfig() {
    ZP.loadConfig();
    var sel = $("#apiProvider");
    sel.innerHTML = "";
    ZP.PROVIDERS.forEach(function (p) {
      var o = document.createElement("option");
      o.value = p.id;
      o.textContent = p.name;
      sel.appendChild(o);
    });

    var cfg = ZP.config;
    sel.value = cfg.provider || "deepseek";
    $("#apiBase").value = cfg.base || "";
    $("#apiModel").value = cfg.model || "";
    $("#apiKey").value = cfg.key || "";
    $("#ocrEndpoint").value = cfg.ocr || "";

    /* 生成参数：温度滑块 + 思考模式 */
    var tempEl = $("#apiTemp");
    if (tempEl) {
      var t = typeof cfg.temperature === "number" ? cfg.temperature : 0.3;
      tempEl.value = t;
      paintTemp(t);
      tempEl.addEventListener("input", function () { paintTemp(parseFloat(tempEl.value)); });
      tempEl.addEventListener("change", function () {
        paintTemp(parseFloat(tempEl.value));
        ZP.saveConfig({ temperature: parseFloat(tempEl.value) });
      });
    }
    paintThink(cfg.noThink !== false);

    sel.addEventListener("change", function () {
      var p = ZP.PROVIDERS.filter(function (x) { return x.id === sel.value; })[0];
      if (p) {
        $("#apiBase").value = p.base;
        $("#apiModel").value = p.model;
        persistApi();
      }
    });

    ["#apiBase", "#apiModel", "#apiKey"].forEach(function (id) {
      $(id).addEventListener("change", persistApi);
      $(id).addEventListener("blur", persistApi);
    });

    $("#ocrEndpoint").addEventListener("change", function () {
      ZP.saveConfig({ ocr: $("#ocrEndpoint").value.trim() });
      updateOcrState();
    });

    /* ---- 图片识别方式：视觉模型直读 / 本地 OCR ---- */
    var presetSel = $("#visionPreset");
    presetSel.innerHTML = "";
    ZP.VISION_MODELS.forEach(function (m) {
      var o = document.createElement("option");
      o.value = m.id;
      o.textContent = m.name;
      presetSel.appendChild(o);
    });

    var savedPreset = ZP.VISION_MODELS.filter(function (m) {
      return (m.base || "") === (cfg.visionBase || "") && (m.model || "") === (cfg.visionModel || "");
    })[0];
    presetSel.value = savedPreset ? savedPreset.id : "same";
    $("#visionModel").value = cfg.visionModel || "";
    $("#visionBase").value = cfg.visionBase || "";
    applyOcrMode(cfg.imageMode || "vision", true);

    function refreshVisionHint() {
      var b = (ZP.config.visionBase || "").trim();
      if (b) {
        $("#visionNote").textContent = "图片将发往：" + b + "（与主接口不同）";
      } else {
        $("#visionNote").textContent = "图片将发往主接口：" + ((ZP.config.base || "").trim() || "未填写") +
          "；模型名留空则用主模型。";
      }
    }

    presetSel.addEventListener("change", function () {
      var m = ZP.VISION_MODELS.filter(function (x) { return x.id === presetSel.value; })[0];
      if (!m) return;
      ZP.saveConfig({ visionBase: m.base || "", visionModel: m.model || "" });
      $("#visionBase").value = m.base || "";
      $("#visionModel").value = m.model || "";
      $("#visionNote").textContent = m.note;
      refreshVisionHint();
      updateVisionState();
    });

    $("#visionModel").addEventListener("change", persistVision);
    $("#visionModel").addEventListener("blur", persistVision);
    $("#visionBase").addEventListener("change", persistVision);
    $("#visionBase").addEventListener("blur", persistVision);

    $("#visionSync").addEventListener("click", function () {
      ZP.saveConfig({ visionBase: "", visionModel: "" });
      $("#visionBase").value = "";
      $("#visionModel").value = ZP.config.model || "";
      presetSel.value = "same";
      refreshVisionHint();
      updateVisionState();
      toast("已让视觉模型沿用主接口地址与模型名。", "ok");
    });

    $("#visionTest").addEventListener("click", testVision);
    refreshVisionHint();

    Array.prototype.forEach.call(document.querySelectorAll("#ocrMode button"), function (b) {
      b.addEventListener("click", function () {
        applyOcrMode(b.dataset.mode);
      });
    });

    $("#keyEye").addEventListener("click", function () {
      var i = $("#apiKey");
      i.type = i.type === "password" ? "text" : "password";
    });

    $("#apiTest").addEventListener("click", testApi);
    $("#ocrTest").addEventListener("click", testOcr);
    $("#cfgHelp").addEventListener("click", function () { openModal("api"); });
    $("#ocrHelp").addEventListener("click", function () { openModal("ocr"); });
    $("#emptyConfig").addEventListener("click", function () { openModal("api"); });

    updateApiState();
    updateOcrState();
    updateVisionState();
  }

  function persistVision() {
    ZP.saveConfig({
      visionModel: $("#visionModel").value.trim(),
      visionBase: $("#visionBase").value.trim()
    });
    var b = (ZP.config.visionBase || "").trim();
    var note = $("#visionNote");
    if (note) {
      note.textContent = b
        ? "图片将发往：" + b + "（与主接口不同）"
        : "图片将发往主接口：" + ((ZP.config.base || "").trim() || "未填写") + "；模型名留空则用主模型。";
    }
    updateVisionState();
  }

  function applyOcrMode(mode, silent) {
    ZP.saveConfig({ imageMode: mode === "local" ? "local" : "vision" });
    Array.prototype.forEach.call(document.querySelectorAll("#ocrMode button"), function (b) {
      b.classList.toggle("active", b.dataset.mode === (mode === "local" ? "local" : "vision"));
    });
    $("#ocrLocalBox").hidden = mode !== "local";
    $("#ocrVisionBox").hidden = mode === "local";
    updateOcrState();
    updateVisionState();
    if (!silent && mode === "vision") {
      toast("已切换为视觉模型直读：上传图片后直接批改，无需本地 OCR。", "ok");
    }
  }

  function updateVisionState() {
    var el = $("#visionState");
    if (!el) return;
    var ok = ZP.hasVision();
    el.textContent = ok ? (ZP.config.visionKey ? "已配置" : "复用主 Key") : "待填写 Key";
    el.className = "cfg-state" + (ok ? " on" : "");
  }

  async function testVision() {
    persistVision();
    var btn = $("#visionTest");
    if (!ZP.hasVision()) { toast("请先填写视觉模型名，以及接口 Key。", "err"); return; }
    btn.disabled = true;
    btn.textContent = "读图中…";
    try {
      /* 用一张带文字的小图验证是否真的看得到图 */
      var cv = document.createElement("canvas");
      cv.width = 420; cv.height = 120;
      var c = cv.getContext("2d");
      c.fillStyle = "#fff"; c.fillRect(0, 0, 420, 120);
      c.fillStyle = "#111"; c.font = "bold 44px sans-serif";
      c.textAlign = "center"; c.fillText("智批作文", 210, 78);
      var probe = cv.toDataURL("image/jpeg", 0.9);

      var out = await ZP.chat([
        { role: "user", content: [
          { type: "text", text: "只回复图片里的四个汉字，不要其它任何内容。" },
          { type: "image_url", image_url: { url: probe } }
        ] }
      ], { vision: true, temperature: 0, maxTokens: 30, timeout: 60000, noJsonForVision: true });

      var got = String(out || "").replace(/[\s　]/g, "");
      if (got.indexOf("智批作文") >= 0) {
        $("#visionState").textContent = "读图正常";
        $("#visionState").className = "cfg-state on";
        toast("视觉模型可用，能正确读取图片。", "ok");
      } else {
        toast("模型有响应，但未能正确读图（返回：" + got.slice(0, 20) + "）。请换用 VL 模型。", "err");
      }
    } catch (e) {
      $("#visionState").textContent = "不可用";
      $("#visionState").className = "cfg-state bad";
      toast("视觉模型测试失败：" + e.message, "err");
    } finally {
      btn.disabled = false;
      btn.textContent = "测试读图";
    }
  }

  /* 温度滑块：实时提示分值，并按区间给出建议 */
  function paintTemp(v) {
    var el = $("#tempVal"), hint = $("#tempHint"), range = $("#apiTemp");
    if (el) el.textContent = (Math.round(v * 100) / 100).toFixed(2);
    if (range) {
      /* 已填充部分用强调色，未填充保持浅灰 */
      var pct = (v / 1) * 100;
      range.style.background = "linear-gradient(90deg,#b9703f 0%," +
        "#b9703f " + pct + "%,#ece5d6 " + pct + "%,#ece5d6 100%)";
    }
    if (hint) {
      var txt;
      if (v <= 0.15) txt = "极稳模式：措辞最统一，但批注容易模板化，建议仅在需要完全可复现时使用。";
      else if (v < 0.5) txt = "批改建议区间：措辞稳定、批注具体，评分一致性好。";
      else txt = "偏高：批注措辞更灵活，但分数与措辞每次可能有波动，不建议用于正式批改。";
      hint.textContent = txt;
      hint.className = "param-hint" + (v >= 0.5 ? " warn" : "");
    }
  }

  /* 思考模式：优先速度 / 优先质量 */
  function paintThink(fast) {
    var box = $("#thinkMode"), val = $("#thinkVal"), hint = $("#thinkHint");
    if (box) {
      Array.prototype.forEach.call(box.querySelectorAll("button"), function (b) {
        b.classList.toggle("active", (b.dataset.think === "fast") === !!fast);
      });
    }
    if (val) val.textContent = fast ? "优先速度" : "优先质量";
    if (hint) {
      hint.textContent = fast
        ? "关闭深度思考，直接产出批改内容。批改速度快约 5–8 倍，适合结构化输出任务。"
        : "让模型先推理再作答。更细致但明显更慢，适合需要深度分析的场景（部分模型不支持该参数时会自动降级）。";
    }
    ZP.saveConfig({ noThink: !!fast });
  }

  function initThinkMode() {
    var box = $("#thinkMode");
    if (!box) return;
    box.addEventListener("click", function (e) {
      var b = e.target.closest("[data-think]");
      if (!b) return;
      paintThink(b.dataset.think === "fast");
      toast(b.dataset.think === "fast"
        ? "已切换为优先速度：关闭深度思考，批改更快。"
        : "已切换为优先质量：模型会先推理再作答，耗时更长。", "ok");
    });
  }

  function persistApi() {
    ZP.saveConfig({
      provider: $("#apiProvider").value,
      base: $("#apiBase").value.trim(),
      model: $("#apiModel").value.trim(),
      key: $("#apiKey").value.trim()
    });
    updateApiState();
    /* 视觉模型沿用主接口时，提示里的地址要跟着变 */
    if (!(ZP.config.visionBase || "").trim()) {
      var note = $("#visionNote");
      if (note) {
        note.textContent = "图片将发往主接口：" + ((ZP.config.base || "").trim() || "未填写") +
          "；模型名留空则用主模型。";
      }
    }
    updateVisionState();
  }

  function updateApiState() {
    var el = $("#apiState");
    if (ZP.hasKey()) {
      el.textContent = "已配置";
      el.className = "cfg-state on";
    } else {
      el.textContent = "未配置";
      el.className = "cfg-state";
    }
  }

  function updateOcrState() {
    var el = $("#ocrState");
    if (!el) return;
    /* 顶部状态只反映「当前正在用哪种方式」，避免与内层状态互相矛盾 */
    var mode = ZP.config.imageMode === "local" ? "local" : "vision";
    if (mode === "local") {
      var on = !!(ZP.config.ocr || "").trim();
      el.textContent = on ? "本地 OCR" : "未填地址";
      el.className = "cfg-state" + (on ? " on" : " bad");
    } else {
      el.textContent = "视觉直读";
      el.className = "cfg-state on";
    }
  }

  async function testApi() {
    persistApi();
    if (!ZP.hasKey()) { toast("请先填写 API Key。", "err"); return; }
    var btn = $("#apiTest");
    btn.disabled = true;
    btn.textContent = "连接中…";
    try {
      await ZP.chat([{ role: "user", content: "只回复两个字：可用" }],
        { maxTokens: 16, temperature: 0, timeout: 45000 });
      $("#apiState").textContent = "连接正常";
      $("#apiState").className = "cfg-state on";
      toast("接口连接成功，模型可用。", "ok");
    } catch (e) {
      $("#apiState").textContent = "连接失败";
      $("#apiState").className = "cfg-state bad";
      toast(e.message, "err");
    } finally {
      btn.disabled = false;
      btn.textContent = "测试连接";
    }
  }

  async function testOcr() {
    ZP.saveConfig({ ocr: $("#ocrEndpoint").value.trim() });
    var btn = $("#ocrTest");
    btn.disabled = true;
    btn.textContent = "检测中…";
    try {
      await ZP.testOCR();
      $("#ocrState").textContent = "已连通";
      $("#ocrState").className = "cfg-state on";
      toast("OCR 服务已就绪。", "ok");
    } catch (e) {
      $("#ocrState").textContent = "未连通";
      $("#ocrState").className = "cfg-state bad";
      toast("OCR 服务未响应：" + e.message, "err");
    } finally {
      btn.disabled = false;
      btn.textContent = "测试识别";
    }
  }

  /* ---------------- 图片上传 ---------------- */
  var DZ_HTML = "";

  /* 复原上传区：任何失败/重置路径都回到干净的空状态 */
  function resetDropzone() {
    var inner = $("#dzInner");
    if (!inner) return;
    if (DZ_HTML) inner.innerHTML = DZ_HTML;
    inner.style.display = "";
    inner.hidden = false;
    var prev = $("#dzPreview");
    if (prev) prev.hidden = true;
    var img = $("#previewImg");
    if (img) img.removeAttribute("src");
  }

  function initUpload() {
    var dz = $("#dropzone"), input = $("#fileInput");
    DZ_HTML = $("#dzInner").innerHTML;

    dz.addEventListener("click", function (e) {
      if (e.target.closest("#dzRemove")) return;
      input.click();
    });
    dz.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); }
    });

    input.addEventListener("change", function () {
      if (input.files && input.files.length) handleFiles(input.files);
      input.value = "";
    });

    ["dragenter", "dragover"].forEach(function (ev) {
      dz.addEventListener(ev, function (e) {
        e.preventDefault();
        dz.classList.add("drag");
      });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      dz.addEventListener(ev, function (e) {
        e.preventDefault();
        dz.classList.remove("drag");
      });
    });
    dz.addEventListener("drop", function (e) {
      var fs = e.dataTransfer && e.dataTransfer.files;
      if (fs && fs.length) handleFiles(fs);
    });

    // 整个画板也接受拖拽
    var stage = $(".stage");
    ["dragover", "dragenter"].forEach(function (ev) {
      stage.addEventListener(ev, function (e) { e.preventDefault(); });
    });
    stage.addEventListener("drop", function (e) {
      e.preventDefault();
      var fs = e.dataTransfer && e.dataTransfer.files;
      if (fs && fs.length) handleFiles(fs);
    });

    /* 多图模式下由缩略图右上角的 × 单页删除，旧的单图删除按钮已移除 */

    /* 统一空值保护：任一元素缺失都不再中断后续初始化 */
    function on(sel, ev, fn) {
      var el = typeof sel === "string" ? $(sel) : sel;
      if (el) el.addEventListener(ev, fn);
      return el;
    }

    on("#demoBtn", "click", loadDemo);
    on("#resetBtn", "click", resetAll);

    initThumbStrip();
    on("#historyBtn", "click", function () { if (ZP.History) ZP.History.open(); });
    /* 主按钮：批改中点击即停止 */
    on("#gradeBtn", "click", function () {
      var cur = S.docs[S.activeDoc];
      if (cur && cur.grading) stopGrading();
    });
    on("#exportHtmlBtn", "click", exportReport);
    on("#nextEssayBtn", "click", startNextEssay);
    initDocQueue();
  }

  /* 多图上传：依次压缩并追加，保持拖入顺序 */
  async function handleFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    var imgs = files.filter(function (f) { return /^image\//.test(f.type); });
    if (!imgs.length) { toast("请上传图片文件（JPG / PNG / WEBP）。", "err"); return; }
    if (imgs.length < files.length) toast("已跳过 " + (files.length - imgs.length) + " 个非图片文件。");

    var inner = $("#dzInner");
    inner.innerHTML = '<p class="dz-title">正在压缩 ' + imgs.length + ' 张…</p>' +
      '<p class="dz-sub">长边压缩至 1800px</p>';

    var added = 0, failed = 0;
    for (var i = 0; i < imgs.length; i++) {
      try {
        var img = await ZP.compressImage(imgs[i], { maxSide: 1800, quality: 0.86 });
        S.images.push(img);
        added++;
      } catch (e) { failed++; }
    }

    if (!added) {
      resetDropzone();
      renderThumbs();
      toast(failed ? "图片读取失败，请换一张图片。" : "没有可用图片。", "err");
      return;
    }

    S.image = S.images[0];
    S.imgPage = 0;
    S.text = "";
    $("#essayText").value = "";
    $("#textCount").textContent = "0 字";
    S.view = "image";
    leaveDemo();
    clearResult();

    inner.hidden = true;
    $("#dzInner").style.display = "none";
    renderThumbs();

    $("#stageTitle").textContent = S.images.length > 1
      ? "原稿 · 共 " + S.images.length + " 页"
      : (S.images[0].name || "作文原稿");
    $("#sourceChip").innerHTML = "<i></i>原稿图片";
    refreshPending();

    syncCurrentDoc();
    saveDocs();
    renderDocQueue();
    toast(added > 1 ? "已载入 " + added + " 张原稿，按顺序合为一份作文。"
                    : "图片已压缩并载入，确认参数后开始批改。", "ok");
  }

  /* 缩略图：点击切换预览、右上角删除 */
  function renderThumbs() {
    var strip = $("#thumbStrip");
    var inner = $("#dzInner");
    if (!strip) return;

    if (!S.images.length) {
      strip.hidden = true;
      strip.innerHTML = "";
      if (inner) { inner.hidden = false; inner.style.display = ""; }
      return;
    }

    strip.hidden = false;
    if (inner) { inner.hidden = true; inner.style.display = "none"; }

    /* 默认只显示当前这一条，避免多份时把上传区撑成一长列；
       点「查看全部」再展开成列表。 */
    var curIdx = 0;
    for (var k = 0; k < S.images.length; k++) {
      if (S.images[k] === S.image) { curIdx = k; break; }
    }
    var list = S.dqOpen ? S.images.map(function (im, i) { return [im, i]; })
                        : [[S.image || S.images[0], curIdx]];

    strip.classList.toggle("expanded", !!S.dqOpen);
    strip.innerHTML = list.map(function (pair) {
      var im = pair[0], i = pair[1];
      var nm = (im.name || ("第" + (i + 1) + "页")).replace(/^\s+|\s+$/g, "");
      return '<div class="thumb' + (im === S.image ? " active" : "") + '" data-i="' + i + '" title="' + R.esc(nm) + '">' +
        '<span class="thumb-pg">' + (i + 1) + "/" + S.images.length + "</span>" +
        '<span class="thumb-name">' + R.esc(nm) + "</span>" +
        '<button type="button" class="del" data-del="' + i + '" aria-label="删除第' + (i + 1) + '页">' +
          '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' +
        "</button>" +
      "</div>";
    }).join("");

    /* 多于一条时才出现展开入口 */
    var more = $("#thumbMore");
    if (more) {
      more.hidden = S.images.length <= 1;
      more.classList.toggle("open", !!S.dqOpen);
      var txt = more.querySelector(".tm-txt");
      if (txt) txt.textContent = S.dqOpen ? "收起" : ("查看全部 " + S.images.length + " 页");
    }
  }

  function initThumbStrip() {
    var strip = $("#thumbStrip");
    if (!strip) return;
    var more = $("#thumbMore");
    if (more) {
      more.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        S.dqOpen = !S.dqOpen;
        renderThumbs();
      });
    }
    strip.addEventListener("click", function (e) {
      var del = e.target.closest("[data-del]");
      if (del) {
        e.stopPropagation();
        removeImage(Number(del.dataset.del));
        return;
      }
      var th = e.target.closest(".thumb");
      if (!th) return;
      S.image = S.images[Number(th.dataset.i)];
      renderThumbs();
      $("#stageTitle").textContent = S.images.length > 1
        ? "原稿 · 共 " + S.images.length + " 页" : (S.image.name || "作文原稿");
      if (!S.result) refreshPending();
      else if (S.view === "image") R.imageSheet(S.image.dataUrl, S.image, S.result);
    });

  }

  function removeImage(i) {
    if (!S.images[i]) return;
    S.images.splice(i, 1);
    if (!S.images.length) {
      S.image = null;
      renderThumbs();
      clearImage();
      return;
    }
    S.image = S.images[0];
    renderThumbs();
    if (!S.result) refreshPending();
    else toast("已移除一页，报告仍对应移除前的内容，建议重新批改。");
  }

  function clearImage() {
    S.image = null;
    S.view = "text";
    resetDropzone();
    $("#stageTitle").textContent = "等待作文原稿";
    $("#sourceChip").innerHTML = "<i></i>空白画板";
    if (S.demo) {
      S.demo = false;
      S.result = null;
    }
    if (!S.text) {
      S.result = null;
      R.emptyPaper();
      R.emptyReport();
      syncSeg();
    } else {
      refreshPending();
    }
  }

  /* ---------------- 文本输入 ---------------- */
  function initText() {
    var ta = $("#essayText");
    /* 稿源文本默认折叠，避免首屏拥挤 */
    /* 稿源文本折叠：只绑定一次，避免点一下又被第二次切换回来 */
    var st = $("#sourceToggle"), sb = $("#sourceBody");
    if (st && sb) st.addEventListener("click", function () {
      var open = sb.hidden;
      sb.hidden = !open;
      st.setAttribute("aria-expanded", open ? "true" : "false");
      var box = document.querySelector("#inlineSource");
      if (box) box.classList.toggle("open", open);
      var em = st.querySelector("em");
      if (em) em.textContent = open ? "点击收起" : "可选 · 点击展开";
      if (open) ta.focus();
    });
    var timer = null;
    ta.addEventListener("input", function () {
      S.text = ta.value;
      $("#textCount").textContent = ZP.countChars(ta.value) + " 字";
      clearTimeout(timer);
      timer = setTimeout(function () {
        if (!ta.value.trim()) return;
        leaveDemo();
        clearResult();
        S.title = headTitle(ta.value);
        S.view = "text";
        $("#stageTitle").textContent = S.title;
        $("#sourceChip").innerHTML = "<i></i>文本输入";
        R.pending();
        R.emptyReport();
        syncSeg();
        syncCurrentDoc();
        renderDocQueue();
      }, 420);
    });

    $("#clearText").addEventListener("click", function () {
      ta.value = "";
      S.text = "";
      $("#textCount").textContent = "0 字";
      setTimeout(function () { syncCurrentDoc(); renderDocQueue(); }, 0);
      if (!S.image) {
        S.result = null;
        $("#stageTitle").textContent = "等待作文原稿";
        $("#sourceChip").innerHTML = "<i></i>空白画板";
        R.emptyPaper();
        R.emptyReport();
      }
    });
  }

  /* ---------------- 视图切换 / 缩放 / 批注开关 ---------------- */
  function syncSeg() {
    var has = !!(S.image && S.result);
    $("#viewSeg").hidden = !has;
    $("#viewDivider").hidden = !has;
    if (!has) return;
    $$("#viewSeg button").forEach(function (b) {
      b.classList.toggle("active", b.dataset.view === S.view);
    });
  }

  /* 批注微调后的持久化：队列与历史都要跟着更新，刷新后位置不丢 */
  ZP.onAnnotAdjust = function (res) {
    try {
      var cur = S.docs && S.docs[S.activeDoc];
      if (cur && res) cur.result = res;
      saveDocs();
      if (res) ZP.History.patchByDoc(res.docId, { annotations: res.annotations });
    } catch (e) { /* 存不下不影响当前画面 */ }
  };

  /* 左侧功能栏的耗时与用量：批改完成后出现在「开始 AI 批改」上方
     保留分步明细 + 彩色进度条，宽度按 207px 侧栏紧凑排布 */
  /* 批改阶段的最小集合：模型一次返回时，某些阶段没真正跑，
     就按权重把总耗时分配下去，避免出现 0.0s 的空阶段。 */
  var COST_STAGES = ["读图批改", "生成范文", "整理报告"];

  var paintCostLive = null;   /* 批改中由 startTick 驱动 */

  function costRowsFrom(trace, totalMsFallback) {
    var tr = (trace || []).filter(function (x) { return x && x.ms >= 0; });
    var totalMs = 0, totalTok = 0;
    tr.forEach(function (x) { totalMs += x.ms || 0; totalTok += x.total || 0; });

    if (!tr.length && totalMsFallback) totalMs = totalMsFallback;
    return { rows: tr, totalMs: totalMs, totalTok: totalTok };
  }

  /* 真正渲染耗时卡：mode = "live"（批改中）| "done"（完成） */
  function paintCost(box, data) {
    var tr = data.rows || [];
    var totalMs = data.totalMs || 0;
    var totalTok = data.totalTok || 0;
    var fmtN = function (n) {
      n = n || 0;
      return n >= 10000 ? (Math.round(n / 100) / 10) + "k" : String(n);
    };
    var speed = totalMs > 0 ? Math.round(totalTok / (totalMs / 1000)) : 0;

    var maxMs = 1, maxTok = 1;
    tr.forEach(function (x) {
      maxMs = Math.max(maxMs, x.ms || 0);
      maxTok = Math.max(maxTok, x.total || 0);
    });

    /* 时长统一：超过 60 秒按分钟显示（如 2m 14s），不再只给秒数 */
    var fmtDur = function (ms, digits) {
      var sec = (ms || 0) / 1000;
      if (sec < 60) {
        var d = digits === undefined ? 1 : digits;
        return (Math.round(sec * Math.pow(10, d)) / Math.pow(10, d)) + "s";
      }
      var m = Math.floor(sec / 60);
      var rest = Math.round(sec - m * 60);
      if (rest === 60) { m += 1; rest = 0; }
      return m + "m " + rest + "s";
    };

    var rows = tr.map(function (x) {
      var wMs = Math.max(4, Math.round((x.ms || 0) / maxMs * 100));
      var wTok = Math.max(4, Math.round((x.total || 0) / maxTok * 100));
      return '<div class="sc-row">' +
        '<span class="sc-name" title="' + R.esc(x.step || "") + '">' + R.esc(x.step || "") + "</span>" +
        '<span class="sc-bars">' +
          '<span class="sc-bar sc-bar-t"><b style="width:' + wMs + '%"></b></span>' +
          '<span class="sc-bar sc-bar-k"><b style="width:' + wTok + '%"></b></span>' +
        "</span>" +
        '<span class="sc-vals">' +
          '<span class="sc-t"><b>' + fmtDur(x.ms, 1) + "</b></span>" +
          '<span class="sc-k"><b>' + fmtN(x.total || 0) + "</b>tokens</span>" +
        "</span>" +
      "</div>";
    }).join("");

    box.innerHTML =
      '<div class="sc-head">' +
        '<span>' + (data.live ? "正在批改" : "本次批改") + '</span>' +
        '<em><b>' + fmtDur(totalMs, 1) + '</b><i>·</i><b>' + fmtN(totalTok) + '</b>tokens</em>' +
      '</div>' +
      (rows ? '<div class="sc-rows">' + rows + "</div>" : "") +
      '<div class="sc-foot">' +
        '<span class="sc-lg"><i class="t"></i>耗时</span>' +
        '<span class="sc-lg"><i class="k"></i>tokens</span>' +
        '<span class="sc-spd"><span>均速</span><b>' + fmtN(speed) + "</b><i>tokens/s</i></span>" +
      "</div>";
    box.className = "side-cost" + (data.live ? " live" : "");
    box.hidden = false;
  }

  /* 批改开始：先把卡片摆出来，按阶段权重分配，实时走条 */
  function startSideCostLive(startedAt) {
    var box = $("#sideCost");
    if (!box) return;

    /* 各阶段权重（用于把已流逝的时间分配到还没真正执行的阶段） */
    var w = { "读图批改": 0.62, "生成范文": 0.31, "整理报告": 0.07 };
    var stages = COST_STAGES.map(function (name) { return { step: name, ms: 0, total: 0 }; });

    paintCostLive = function (elapsed) {
      var rows = stages.map(function (st) {
        return { step: st.step, ms: elapsed * (w[st.step] || 0), total: st.total || 0 };
      });
      paintCost(box, { rows: rows, totalMs: elapsed, totalTok: 0, live: true });
    };
    paintCostLive(Date.now() - (startedAt || Date.now()));
  }

  function stopSideCostLive() { paintCostLive = null; }

  /* 用接口返回的真实 trace 渲染定格卡片。
     若某些阶段没有真实计时（模型一次返回），按权重把总耗时补分过去。 */
  function renderSideCost(res) {
    var box = $("#sideCost");
    if (!box) return;
    stopSideCostLive();

    var raw = (res && res.trace) ? res.trace : [];
    var totalMs = 0, totalTok = 0;
    raw.forEach(function (x) { totalMs += x.ms || 0; totalTok += x.total || 0; });
    if (!totalMs && res && res.elapsed) totalMs = res.elapsed;
    if (!totalTok && res && res.tokens) totalTok = res.tokens.total || 0;

    if (!raw.length && !(res && res.elapsed)) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }

    /* 阶段名对齐到最小集合，缺的用权重补时长，保证不出现 0.0s */
    var weight = { "读图批改": 0.62, "生成范文": 0.31, "整理报告": 0.07 };
    var byName = {};
    raw.forEach(function (x) {
      var name = x.step || "其他";
      if (!byName[name]) byName[name] = { step: name, ms: 0, total: 0 };
      byName[name].ms += x.ms || 0;
      byName[name].total += x.total || 0;
    });

    var rows = Object.keys(byName).map(function (k) { return byName[k]; });
    var sumMs = rows.reduce(function (a, b) { return a + (b.ms || 0); }, 0);

    /* 只有单个「其他」阶段时，拆成标准三阶段 */
    if (rows.length === 1) {
      var only = rows[0];
      rows = COST_STAGES.map(function (name) {
        return { step: name, ms: Math.round(only.ms * weight[name]), total: Math.round(only.total * weight[name]) };
      });
      sumMs = rows.reduce(function (a, b) { return a + b.ms; }, 0);
    }

    /* 总耗时与各阶段之和对齐 */
    if (totalMs && Math.abs(sumMs - totalMs) > 200) {
      var scale = sumMs > 0 ? totalMs / sumMs : 1;
      rows.forEach(function (r) { r.ms = Math.round(r.ms * scale); });
    }

    /* 任何阶段都不允许是 0.0s */
    rows.forEach(function (r) {
      if (!r.ms || r.ms < 100) r.ms = 100;
    });

    paintCost(box, { rows: rows, totalMs: rows.reduce(function (a, b) { return a + b.ms; }, 0), totalTok: totalTok });
  }

  ZP.renderSideCost = renderSideCost;

  function initStageTools() {
    /* 一键还原所有手工微调 */
    document.addEventListener("click", function (e) {
      var btn = e.target.closest && e.target.closest("#adjReset");
      if (!btn) return;
      e.stopPropagation();
      if (!S.result || !Array.isArray(S.result.annotations)) return;
      S.result.annotations.forEach(function (a) { if (a) a.adj = {}; });
      ZP.onAnnotAdjust(S.result);
      if (S.image) R.imageSheet(S.image.dataUrl, S.image, S.result);
      toast("已还原到自动排版的位置。", "ok");
    });

    /* 多页原稿翻页：切换图片与当页批注 */
    document.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-pg]");
      if (!btn || btn.disabled) return;
      var total = (S.images && S.images.length) || 1;
      var cur = S.imgPage || 0;
      cur += (btn.dataset.pg === "next" ? 1 : -1);
      cur = Math.max(0, Math.min(total - 1, cur));
      if (cur === S.imgPage) return;
      S.imgPage = cur;
      S.image = S.images[cur];
      R.imageSheet(S.image.dataUrl, S.image, S.result);
      renderThumbs();   /* 缩略图高亮跟随当前页 */
      $("#stageTitle").textContent = "原稿 · 第 " + (cur + 1) + " / " + total + " 页";
    });
    $$("#viewSeg button").forEach(function (b) {
      b.addEventListener("click", function () {
        S.view = b.dataset.view;
        if (!S.result) return;
        if (S.view === "image") {
          R.imageSheet(S.image.dataUrl, S.image, S.result);
        } else {
          R.essay(S.result);
        }
        syncSeg();
      });
    });

    var sc = $("#stageScroll");
    $("#annToggle").addEventListener("change", function (e) {
      sc.classList.toggle("annotations-off", !e.target.checked);
    });

    function applyZoom() {
      var paper = $("#paper");
      paper.style.zoom = S.zoom;
      $("#zoomVal").textContent = Math.round(S.zoom * 100) + "%";
    }
    $("#zoomIn").addEventListener("click", function () {
      S.zoom = Math.min(1.3, Math.round((S.zoom + 0.05) * 100) / 100);
      applyZoom();
    });
    $("#zoomOut").addEventListener("click", function () {
      S.zoom = Math.max(0.7, Math.round((S.zoom - 0.05) * 100) / 100);
      applyZoom();
    });
  }

  /* ---------------- Tab ---------------- */
  function initTabs() {
    $$("#tabs .tab").forEach(function (t) {
      t.addEventListener("click", function () {
        $$("#tabs .tab").forEach(function (x) { x.classList.remove("active"); });
        t.classList.add("active");
        $$(".panel").forEach(function (p) {
          p.classList.toggle("active", p.dataset.panel === t.dataset.tab);
        });
      });
    });
  }

  /* ---------------- 批改主流程 ---------------- */
  function initGradeButton() {
    $("#gradeBtn").addEventListener("click", runGrade);
  }

  async function runGrade() {
    var doc = S.docs[S.activeDoc];
    if (!doc) return;
    if (doc.grading) { toast("这份正在批改中，可点「停止」后再来。"); return; }
    var docIndex = S.activeDoc;
    var ctl = new AbortController();

    var useVision = !!(S.image && ZP.config.imageMode !== "local");
    var hasText = !!(S.text || "").trim();

    /* 前置检查：按当前路径给出针对性提示 */
    if (useVision && !hasText) {
      if (!ZP.hasVision()) {
        openAccordion();
        openModal("ocr");
        toast("尚未配置视觉模型，无法读取图片批改。", "err");
        return;
      }
    } else if (!hasText && S.image && ZP.config.imageMode === "local") {
      if (!(ZP.config.ocr || "").trim()) {
        openAccordion();
        toast("本地 OCR 地址为空，请填写或改为「视觉模型直读」。", "err");
        return;
      }
    } else if (!hasText && !S.image) {
      toast("请先上传作文图片，或粘贴作文正文。", "err");
      return;
    }

    if (!ZP.hasKey() && !(useVision && ZP.hasVision())) {
      openAccordion();
      openModal("api");
      toast("尚未配置 AI 接口，无法生成真实批改结果。", "err");
      return;
    }

    var text = (S.text || "").trim();
    var res = null;

    var trace = [];
    doc.grading = { ctl: ctl, startedAt: Date.now(), trace: trace };
    doc.cancelRequested = false;
    refreshGradeUI();
    /* 一开批就先把耗时卡摆出来，边跑边算 */
    startSideCostLive(doc.grading.startedAt);

    /* ---------- 路径 A：图片 + 视觉模型直读 ---------- */
    if (useVision && !text) {
      try {
        /* 多页原稿：把所有页一起交给模型，而不是只发第一页 */
        var pageUrls = [];
        var srcList = (S.images && S.images.length) ? S.images : [S.image];
        /* 页数越多，单页分辨率越低：1 页 1600px，2–3 页 1280px，4 页以上 1100px */
        var side = srcList.length <= 1 ? 1600 : (srcList.length <= 3 ? 1280 : 1100);
        for (var pi = 0; pi < srcList.length; pi++) {
          pageUrls.push(await ZP.compressForVision(srcList[pi].dataUrl, side));
        }
        var dataUrl = pageUrls.length === 1 ? pageUrls[0] : pageUrls;
        if (pageUrls.length > 1) {
          R.loading(true, "视觉模型正在读 " + pageUrls.length + " 页原稿", "多页一起识别，请稍候", 24);
        }
        res = await ZP.gradeWithVision({
          text: "",
          grade: S.grade,
          genre: S.genre,
          weights: Object.assign({}, S.weights),
          student: S.student || $("#studentName").value.trim() || "未署名",
          title: S.title || "作文批改",
          imageDataUrl: dataUrl,
          pages: srcList.length,
          signal: ctl.signal, trace: trace
        }, function (title, pct) {
          R.loading(true, title, "视觉模型直接读取原稿，请稍候", pct);
        });
      } catch (e) {
        R.loading(false);
        endGrading(docIndex);
        handleVisionError(e, doc);
        return;
      }
    }

    /* ---------- 路径 B：图片 + 本地 OCR，或已有文本 ---------- */
    if (!res) {
      if (useVision && !text) {
        // 视觉首次未成功时，再给一次转录机会（部分模型需要更明确的指令）
        try {
          var tr = await ZP.visionTranscribe(await ZP.compressForVision(S.image.dataUrl), function (t, p) {
            R.loading(true, t, "请稍候", p);
          });
          if (tr.degraded) throw new Error("视觉模型未能读出图片文字");
          text = tr.text;
          S.text = text;
          $("#essayText").value = text;
          $("#textCount").textContent = ZP.countChars(text) + " 字";
        } catch (e) {
          R.loading(false);
            endGrading(docIndex);
          handleVisionError(e, doc);
          return;
        }
      }

      if (!text && S.image) {
        R.loading(true, "正在识别原稿", "本地 OCR 正在提取文字", 8);
        try {
          text = await ZP.ocrImage(S.image.dataUrl, function (t, p) {
            R.loading(true, t, "请稍候", p);
          });
          S.text = text;
          $("#essayText").value = text;
          $("#textCount").textContent = ZP.countChars(text) + " 字";
        } catch (e) {
          R.loading(false);
            endGrading(docIndex);
          openAccordion();
          openModal("ocr");
          toast("OCR 识别失败：" + e.message, "err");
          return;
        }
      }

      if (!text) {
        endGrading(docIndex);
        R.loading(false);
        toast("请先上传作文图片，或粘贴作文正文。", "err");
        return;
      }

      if (!S.title) S.title = headTitle(text);
      R.loading(true, "AI 正在批改", "正在通读全文，定位问题句", 10);

      try {
        res = await ZP.gradeEssay({
          text: text,
          grade: S.grade,
          genre: S.genre,
          weights: Object.assign({}, S.weights),
          student: S.student || $("#studentName").value.trim() || "未署名",
          title: S.title,
          signal: ctl.signal, trace: trace
        }, function (title, pct) {
          R.loading(true, title, "请稍候，生成报告中", pct);
        });
      } catch (e) {
        R.loading(false);
        var emsg2 = e.message || "批改失败，请稍后重试。";
        var isStop = e && e.code === "ABORTED";
        ZP.Notice.push(
          (isStop ? "已停止批改：" : "批改失败：") + (doc.title || "当前作文"),
          emsg2, isStop ? "warn" : "err"
        );
        endGrading(docIndex);
        if (!isStop) showErrorDialog(emsg2);
        else toast("已停止这份的批改。");
        return;
      }
    }

    /* ---------- 落盘 + 渲染 ----------
       关键：批改耗时较长，用户可能已切到别的作文查看。
       结果必须先写回「发起批改的那一份」，再判断是否还在看它；
       否则会把 A 的批改结果画到当前正在查看的 B 上。 */
    try {
      /* 计时收尾 */
      var elapsed = Date.now() - doc.grading.startedAt;
      res.elapsed = elapsed;
      res.docId = doc.id;
      res.trace = trace.slice();
      res.tokens = (function () {
        var p = 0, c = 0;
        trace.forEach(function (x) { p += x.prompt || 0; c += x.completion || 0; });
        return { prompt: p, completion: c, total: p + c };
      })();

      /* 视觉直读时没有独立正文：用模型返回的段落补出文本，供文本视图与切段使用 */
      if (res.source === "vision" && !ZP.countChars(doc.text || "")) {
        var paras = (res.paragraphs && res.paragraphs.length)
          ? res.paragraphs.map(function (p) { return Array.isArray(p) ? p.map(function (x) { return x.t || ""; }).join("") : String(p); })
          : [];
        var assembled = paras.join("\n");
        if (ZP.countChars(assembled) >= 20) res.text = assembled;
      }

      /* 1) 结果只写到 doc 自己身上，不碰当前编辑状态 */
      doc.result = res;
      doc.elapsed = elapsed;
      if (res.text) doc.text = res.text;
      doc.savedAt = Date.now();

      /* 2) 历史按这份自己的数据存 */
      try { ZP.History.save(res, doc.images || []); } catch (e) { /* 存不进历史不影响本次批改 */ }

      var stillViewing = (S.activeDoc === docIndex && S.docs[S.activeDoc] === doc);

      /* 3) 只有用户仍停在这一份，才刷新画板与报告 */
      if (stillViewing) {
        if (res.text) {
          S.text = res.text;
          $("#essayText").value = res.text;
          $("#textCount").textContent = ZP.countChars(res.text) + " 字";
        }
        S.result = res;
        S.demo = false;
        /* 图片稿 + 有原图：默认停在原稿视图，批注显示在左右留白 */
        S.view = (S.image && res.source === "vision") ? "image" : "text";
        S.imgPage = 0;

        if (S.view === "image") R.imageSheet(S.image.dataUrl, S.image, res);
        else R.essay(res);
        R.report(res);
        paintStaleChip();
        syncSeg();
        showElapsed(elapsed, true);

        $("#stageTitle").textContent = res.title;
        $("#sourceChip").innerHTML = "<i></i>已批改";
        $("#reportSub").textContent = res.source === "vision"
          ? "视觉模型直读 · 无需本地 OCR"
          : "AI 批改完成 · 可逐句查看";
      }

      R.loading(false);
      renderSideCost(stillViewing ? res : (S.result || null));
      saveDocs();
      renderDocQueue();
      refreshGradeUI();

      ZP.Notice.push(
        "批改完成：" + (res.title || "未命名"),
        (res.student || "未署名") + " · " + res.score + " 分 · 用时 " + fmtDuration(elapsed) +
        " · 消耗 " + res.tokens.total + " tokens",
        "ok"
      );

      if (stillViewing) {
        toast("批改完成，共 " + (res.annotations || []).length + " 处批注。", "ok");
        var sc = $("#stageScroll");
        if (sc) sc.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        toast("「" + (res.title || "另一份作文") + "」已在后台批改完成，结果存进了它自己那一份，不会覆盖你正在看的这份。", "ok");
      }
    } catch (e) {
      R.loading(false);
      if (e && e.code === "ABORTED") {
        toast("已停止这份的批改，已停止的部分不会计费。");
        ZP.Notice.push("已停止批改", (doc.title || "当前作文") + " · 点击「开始 AI 批改」可重新批改", "warn");
      } else {
        var emsg = e.message || "报告渲染失败。";
        toast(emsg, "err");
        ZP.Notice.push("批改失败：" + (doc.title || "当前作文"), emsg, "err");
      }
    } finally {
      endGrading(docIndex);
    }
  }

  /* 视觉路径失败：区分配置问题 / 模型不支持图片，给出可执行建议 */
  function handleVisionError(e, docRef) {
    var ttl = (docRef && docRef.title) || S.title || "当前作文";
    if (e && e.code === "ABORTED") {
      R.loading(false);
      toast("已停止这份的批改。");
      ZP.Notice.push("已停止批改", ttl + " · 未产生结果", "warn");
      return;
    }
    var msg = (e && e.message) ? e.message : "视觉模型调用失败";
    ZP.Notice.push("批改失败：" + ttl, msg, "err");
    openAccordion();

    if (!ZP.hasVision()) {
      $("#visionState").textContent = "待填写 Key";
      $("#visionState").className = "cfg-state bad";
      openModal("ocr");
      toast("未配置视觉模型的 Key，图片无法批改。请在「图片识别方式」中填写。", "err");
      return;
    }

    if (ZP.isUnsupportedImageError(msg)) {
      $("#visionState").textContent = "不支持读图";
      $("#visionState").className = "cfg-state bad";
      openModal("ocr");
      toast("当前模型不支持读图，请在「图片识别方式」中换用视觉模型（如 通义千问 VL）。", "err");
      return;
    }

    /* 其余错误：完整展示，便于定位（含接口原文） */
    $("#visionState").textContent = "批改失败";
    $("#visionState").className = "cfg-state bad";
    showErrorDialog(msg);
  }

  function fallbackCopy(text, done) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); done(); } catch (e) { toast("复制失败，请手动选中文字复制。", "err"); }
    ta.remove();
  }

  function showErrorDialog(msg) {
    $("#modalTitle").textContent = "批改失败 · 详情";
    $("#modalSub").textContent = "下面是接口返回的原始错误，可直接复制给技术支持";
    $("#modalBody").innerHTML =
      '<div class="warnbox" style="white-space:pre-wrap;word-break:break-all">' + R.esc(msg) + "</div>" +
      '<div style="margin-top:8px"><button type="button" class="btn-line" id="copyErr">复制错误详情</button></div>' +
      "<h4><span>1</span>常见原因</h4>" +
      "<ul>" +
        "<li><b>输出被截断</b>：作文较长时一次输出放不下，换更强的视觉模型或缩短篇幅。</li>" +
        "<li><b>不支持 response_format</b>：程序已自动去掉该参数重试一次；若仍失败，换模型。</li>" +
        "<li><b>返回不是 JSON</b>：模型没按格式输出，换 VL 模型或降低温度。</li>" +
        "<li><b>413 / 过大</b>：图片太大，重新上传或裁剪。</li>" +
      "</ul>" +
      "<h4><span>2</span>快速排查</h4>" +
      "<p>先点「测试读图」。能通过说明模型可看图；再点一次批改。若仍失败，可把上面的原文发我。</p>";
    $("#modal").hidden = false;

    var btn = $("#copyErr");
    if (btn) {
      btn.addEventListener("click", function () {
        var done = function () { btn.textContent = "已复制"; setTimeout(function () { btn.textContent = "复制错误详情"; }, 1600); };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(msg).then(done).catch(function () { fallbackCopy(msg, done); });
        } else {
          fallbackCopy(msg, done);
        }
      });
    }
  }

  /* ---------------- 批改计时器 ---------------- */
  var timer = { startAt: 0, id: null };

  function fmtClock(ms) {
    var total = Math.max(0, Math.floor(ms / 1000));
    var m = Math.floor(total / 60);
    var s = total % 60;
    return m > 0
      ? m + ":" + String(s).padStart(2, "0")
      : "0:" + String(s).padStart(2, "0");
  }
  function fmtDuration(ms) {
    var total = Math.max(0, Math.round(ms / 1000));
    if (total < 60) return total + " 秒";
    var m = Math.floor(total / 60), s = total % 60;
    return s ? m + " 分 " + s + " 秒" : m + " 分";
  }

  function startTimer() {
    timer.startAt = Date.now();
    var btnT = $("#btnTimer");
    if (btnT) { btnT.hidden = false; btnT.textContent = "0:00"; }
    clearInterval(timer.id);
    timer.id = setInterval(function () {
      var el = Date.now() - timer.startAt;
      if (btnT) btnT.textContent = fmtClock(el);
    }, 1000);
  }

  function stopTimer() {
    clearInterval(timer.id);
    timer.id = null;
    var btnT = $("#btnTimer");
    if (btnT) btnT.hidden = true;
    return timer.startAt ? Date.now() - timer.startAt : 0;
  }

  /* 报告头不再显示用时（用户要求移除），耗时统一在左侧「本次批改」卡里展示 */
  function showElapsed() { /* no-op：保留调用点，避免改动多处调用 */ }

  /* ============================================================
     批改状态：按「每份作文」独立记录
     S.docs[i].grading = { ctl, startedAt } —— 同时刻可有多份在批改
     ============================================================ */
  function docOf(i) { return S.docs[i]; }

  function isGrading(i) {
    var d = S.docs[i];
    return !!(d && d.grading);
  }

  /* 按钮与计时只反映「当前显示的这份」。
     批改中：主按钮原地变身成「停止批改」，不再另起一个按钮。 */
  function refreshGradeUI() {
    var b = $("#gradeBtn");
    var cur = S.docs[S.activeDoc];
    var on = !!(cur && cur.grading);

    b.classList.toggle("loading", on);
    b.classList.toggle("can-stop", on);
    $(".btn-label", b).textContent = on ? "停止批改" : "开始 AI 批改";
    b.title = on ? "点击停止这一份的批改，已产出的部分不会计费" : "";
    b.setAttribute("aria-label", on ? "停止批改" : "开始 AI 批改");

    var btnT = $("#btnTimer");
    if (btnT) btnT.hidden = !on;

    /* 报告头不再占用用时显示，计时统一走左侧「本次批改」卡 */
    if (on && cur.grading.startedAt) {
      startTick(cur.grading.startedAt);
    } else {
      stopTick();
    }

    /* 「已完成」标识与导出按钮：只有真的出了结果才出现 */
    var done = !!(cur && cur.result);
    var pill = $("#statusPill");
    if (pill) {
      pill.hidden = !done;
      pill.textContent = "已完成";
      pill.className = "status-pill done";
    }
    var tools = $("#exportTools");
    if (tools) tools.hidden = !done;
  }

  /* 结束某一份的批改状态 */
  function endGrading(idx, opts) {
    var d = S.docs[idx];
    if (!d || !d.grading) return 0;
    var elapsed = Date.now() - d.grading.startedAt;
    d.grading = null;
    opts = opts || {};
    if (opts.keepElapsed !== false) d.elapsed = elapsed;
    renderDocQueue();
    refreshGradeUI();
    return elapsed;
  }

  /* 计时：跟随某一份的开始时间 */
  var tickId = null, tickFrom = 0;
  function startTick(from) {
    tickFrom = from;
    clearInterval(tickId);
    var paint = function () {
      var ms = Date.now() - tickFrom;
      var bt = $("#btnTimer");
      if (bt) { bt.hidden = false; bt.textContent = fmtClock(ms); }
      /* 耗时卡边批边跑：总耗时实时增长，各阶段各自计时 */
      if (paintCostLive) paintCostLive(ms);
    };
    paint();
    tickId = setInterval(paint, 1000);
  }
  function stopTick() { clearInterval(tickId); tickId = null; }

  function stopGrading() {
    var cur = S.docs[S.activeDoc];
    if (!cur || !cur.grading) return;
    cur.cancelRequested = true;
    try { cur.grading.ctl.abort(); } catch (e) {}
    toast("已停止这份的批改，不再消耗额度。");
  }

  /* ---------------- 姓名 ---------------- */
  function initName() {
    var input = $("#studentName");
    var timer = null;
    input.addEventListener("input", function () {
      S.student = input.value.trim();
      clearTimeout(timer);
      timer = setTimeout(function () {
        if (S.result && !S.demo) {
          S.result.student = S.student || "未署名";
          $("#rName").textContent = S.result.student;
        }
        if (S.demo && S.student && S.student !== ZP.DEMO.student) {
          leaveDemo();
          refreshPending();
        }
        /* 姓名是队列里区分多份作文的主要标识，改完立即回写 */
        syncCurrentDoc();
        renderDocQueue();
      }, 380);
    });
  }

  /* ---------------- 演示 / 重置 ---------------- */
  function loadDemo() {
    /* 演示稿单独成一份，不覆盖用户已上传的作文 */
    if (S.docs.length) syncCurrentDoc();
    var demoDoc = newDoc();
    demoDoc.title = ZP.DEMO.title;
    demoDoc.student = ZP.DEMO.student;
    demoDoc.grade = ZP.DEMO.grade;
    demoDoc.genre = ZP.DEMO.genre;
    demoDoc.result = ZP.DEMO;
    demoDoc.images = [];
    demoDoc.text = "";
    S.docs.push(demoDoc);
    S.activeDoc = S.docs.length - 1;

    S.demo = true;
    S.result = ZP.DEMO;
    S.image = null;
    S.text = "";
    S.view = "text";
    S.title = ZP.DEMO.title;
    S.grade = ZP.DEMO.grade;
    S.genre = ZP.DEMO.genre;
    S.student = ZP.DEMO.student;
    S.weights = Object.assign({}, ZP.DEFAULT_WEIGHTS);

    $("#gradeSelect").value = S.grade;
    $("#studentName").value = S.student;
    $("#essayText").value = "";
    $("#textCount").textContent = "0 字";
    resetDropzone();
    $("#stageTitle").textContent = ZP.DEMO.title;
    $("#sourceChip").innerHTML = "<i></i>演示样例";
    $("#reportSub").textContent = "演示样例 · 展示完整报告形态";

    $$(".chip").forEach(function (x) { x.classList.toggle("active", x.dataset.genre === S.genre); });
    updateGradeCard();
    renderDims();
    R.essay(ZP.DEMO);
    R.report(ZP.DEMO);
    syncSeg();
    renderDocQueue();
    $$("#tabs .tab").forEach(function (t, i) { t.classList.toggle("active", i === 0); });
    $$(".panel").forEach(function (p, i) { p.classList.toggle("active", i === 0); });
  }

  function resetAll() {
    loadDemo();
    $("#studentName").value = "";
    S.student = "";
    S.weights = Object.assign({}, ZP.DEFAULT_WEIGHTS);
    renderDims();
    toast("已恢复到演示状态。");
  }

  /* ---------------- 导出 ---------------- */
  /* ============================================================
     历史恢复 / 添加下一份
     ============================================================ */

  /* 从历史记录恢复：还原报告与年级体裁，图片仅还原封面 */
  function restoreHistory(rec) {
    if (!rec) return;

    S.demo = false;
    S.result = rec;
    S.grade = rec.grade || S.grade;
    S.genre = rec.genre || S.genre;
    S.student = rec.student || "";
    S.title = rec.title || "";

    $("#gradeSelect").value = S.grade;
    $("#studentName").value = S.student;
    Array.prototype.forEach.call(document.querySelectorAll(".chip"), function (x) {
      x.classList.toggle("active", x.dataset.genre === S.genre);
    });
    updateGradeCard();
    renderDims();

    /* 历史记录带原稿：优先还原全部页。
       旧版本的历史只存了第 1 页封面（imageList 为空），
       这时到作文队列里按 docId / 标题+姓名 把整组原稿找回来，
       否则多页作文打开后只剩一页。 */
    var recImgs = Array.isArray(rec.imageList) && rec.imageList.length
      ? rec.imageList.slice()
      : [];
    if (!recImgs.length) {
      var wantPages = Number(rec.pages) || 0;
      var cands = (S.docs || []).filter(function (d) {
        return !!(d.images && d.images.length);
      });
      /* 先按 docId，命中不了再按「标题 + 姓名」兜底 */
      var fromDoc = rec.docId ? cands.filter(function (d) { return d.id === rec.docId; })[0] : null;
      if (!fromDoc) {
        fromDoc = cands.filter(function (d) {
          return (d.title || "") === (rec.title || "") && (d.student || "") === (rec.student || "");
        })[0];
      }
      if (fromDoc && fromDoc.images.length >= Math.max(1, wantPages)) {
        recImgs = fromDoc.images.map(function (im) {
          return {
            dataUrl: im.dataUrl, width: im.width || 0, height: im.height || 0,
            size: im.size || 0, name: im.name || ""
          };
        });
        /* 回填进历史，下次打开就不用再找 */
        try { ZP.History.patch(rec.id, { imageList: recImgs }); } catch (e) {}
      }
    }
    if (recImgs.length) {
      S.images = recImgs;
      S.image = S.images[0];
      S.imgPage = 0;
      renderThumbs();
    } else if (rec.thumb) {
      S.images = [{
        dataUrl: rec.thumb,
        width: 0, height: 0, size: 0,
        name: (rec.title || "历史原稿") + "（封面）"
      }];
      S.image = S.images[0];
      renderThumbs();
    } else {
      S.images = [];
      S.image = null;
      $("#thumbStrip").innerHTML = "";
      $("#thumbStrip").hidden = true;
      resetDropzone();
    }

    /* 恢复正文，文本视图仍可逐句定位 */
    if (rec.paragraphs && rec.paragraphs.length) {
      S.text = rec.paragraphs.map(function (p) {
        return Array.isArray(p) ? p.map(function (x) { return x.t || ""; }).join("") : String(p);
      }).join("\n");
    } else {
      S.text = "";
    }
    $("#essayText").value = S.text;
    $("#textCount").textContent = ZP.countChars(S.text) + " 字";

    /* 默认显示原稿：有原稿图就停在图片视图（批注画在留白），
       只有纯文字稿才用「识别文本」视图 */
    if (S.image && rec.source === "vision") {
      S.view = "image";
      S.imgPage = 0;
      R.imageSheet(S.image.dataUrl, S.image, rec);
    } else {
      S.view = "text";
      R.essay(rec);
    }
    R.report(rec);
    paintStaleChip();
    syncSeg();

    $("#stageTitle").textContent = rec.title || "历史记录";
    $("#sourceChip").innerHTML = "<i></i>历史记录";
    $("#reportSub").textContent = "历史批改 · " +
      new Date(rec.savedAt || Date.now()).toLocaleString("zh-CN");
    renderSideCost(rec);

    var sc = $("#stageScroll");
    if (sc) sc.scrollTo({ top: 0, behavior: "smooth" });
    toast("已载入历史记录：" + (rec.title || "未命名"));
  }

  /* ============================================================
     多份作文队列
     每份独立保存：图片、正文、姓名、年级、体裁、批改结果
     ============================================================ */
  /* ============================================================
     作文队列持久化
     原稿图本来只在内存里，刷新页面就全丢，历史记录也无从找回整组页。
     这里把队列存进 localStorage（体积大时自动降级），刷新后原样恢复。
     ============================================================ */
  var DOCS_KEY = "zhipi.docs.v1";

  function saveDocs() {
    if (S._saving) return true;      /* 防递归：syncCurrentDoc → saveDocs → syncCurrentDoc */
    S._saving = true;
    try {
      var brief = {
        active: S.activeDoc,
        list: (S.docs || []).map(function (d) {
          return {
            id: d.id, savedAt: d.savedAt || 0,
            images: d.images || [],
            text: d.text || "", title: d.title || "",
            student: d.student || "", grade: d.grade || "",
            genre: d.genre || "", result: d.result || null,
            elapsed: d.elapsed || 0
          };
        })
      };
      var payload = JSON.stringify(brief);
      try {
        localStorage.setItem(DOCS_KEY, payload);
        return true;
      } catch (e) {
        /* 空间不够：丢掉原稿大图，只保留文本与结果，至少不丢作文列表 */
        brief.list.forEach(function (d) {
          d.images = (d.images || []).map(function (im) {
            return { dataUrl: "", width: im.width || 0, height: im.height || 0, size: 0, name: im.name || "" };
          });
        });
        localStorage.setItem(DOCS_KEY, JSON.stringify(brief));
        return true;
      }
    } catch (e) {
      return false;
    } finally {
      S._saving = false;
    }
  }

  function loadDocs() {
    try {
      var raw = localStorage.getItem(DOCS_KEY);
      if (!raw) return null;
      var brief = JSON.parse(raw);
      if (!brief || !Array.isArray(brief.list) || !brief.list.length) return null;
      var list = brief.list.map(function (d) {
        var doc = newDoc();
        doc.id = d.id || doc.id;
        doc.savedAt = d.savedAt || 0;
        doc.images = Array.isArray(d.images) ? d.images.filter(function (im) { return im && im.dataUrl; }) : [];
        doc.text = d.text || "";
        doc.title = d.title || "";
        doc.student = d.student || "";
        doc.grade = d.grade || "";
        doc.genre = d.genre || "";
        doc.result = d.result || null;
        doc.elapsed = d.elapsed || 0;
        return doc;
      });
      return { list: list, active: Math.max(0, Math.min(list.length - 1, brief.active || 0)) };
    } catch (e) {
      return null;
    }
  }

  function newDoc() {
    return {
      id: "d" + Date.now() + Math.random().toString(36).slice(2, 6),
      images: [],
      text: "",
      title: "",
      student: "",
      grade: S.grade,
      genre: S.genre,
      result: null,
      savedAt: Date.now()
    };
  }

  /* 把当前编辑区状态写回队列中的当前项 */
  function syncCurrentDoc() {
    var doc = S.docs[S.activeDoc];
    if (!doc) return;
    doc.images = S.images.slice();
    doc.text = S.text;
    doc.title = S.title;
    doc.student = S.student;
    doc.grade = S.grade;
    doc.genre = S.genre;
    doc.result = S.result;
    /* 已有内容才更新排序时间 */
    if (doc.images.length || doc.text.trim() || doc.result) doc.savedAt = Date.now();
    saveDocs();
  }

  /* 从队列项装载到编辑区 */
  function loadDoc(idx) {
    var doc = S.docs[idx];
    if (!doc) return;
    S.activeDoc = idx;

    S.images = (doc.images || []).slice();
    S.image = S.images[0] || null;
    S.imgPage = 0;
    S.text = doc.text || "";
    S.title = doc.title || "";
    S.student = doc.student || "";
    S.grade = doc.grade || S.grade;
    S.genre = doc.genre || S.genre;
    S.result = doc.result || null;
    S.demo = false;

    $("#gradeSelect").value = S.grade;
    $("#studentName").value = S.student;
    $("#essayText").value = S.text;
    $("#textCount").textContent = ZP.countChars(S.text) + " 字";
    Array.prototype.forEach.call(document.querySelectorAll(".chip"), function (x) {
      x.classList.toggle("active", x.dataset.genre === S.genre);
    });
    updateGradeCard();
    renderDims();
    renderThumbs();
    renderSideCost(S.result);

    if (S.images.length) {
      $("#dzInner").style.display = "none";
      $("#dzInner").hidden = true;
      $("#thumbStrip").hidden = false;
    } else {
      resetDropzone();
    }

    if (S.result) {
      S.view = S.images.length ? "image" : "text";
      if (S.view === "image") R.imageSheet(S.image.dataUrl, S.image, S.result);
      else R.essay(S.result);
      R.report(S.result);
      paintStaleChip();
      $("#sourceChip").innerHTML = "<i></i>已批改";
      $("#reportSub").textContent = "历史结果 · " + new Date(doc.savedAt).toLocaleString("zh-CN");
    } else {
      if (S.images.length || S.text.trim()) {
        R.pending();
        R.emptyReport();
        $("#sourceChip").innerHTML = "<i></i>" + (S.images.length ? "原稿图片" : "文本输入");
        $("#reportSub").textContent = "等待批改";
      } else {
        R.emptyPaper();
        R.emptyReport();
        $("#sourceChip").innerHTML = "<i></i>空白画板";
        $("#reportSub").textContent = "上传作文照片或粘贴正文后开始批改";
      }
    }

    $("#stageTitle").textContent = S.title || (S.images.length ? "原稿 · 共 " + S.images.length + " 页" : "等待作文原稿");
    syncSeg();
    renderDocQueue();
    refreshGradeUI();
    var sc = $("#stageScroll");
    if (sc) sc.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderDocQueue() {
    var list = $("#dqList"), cnt = $("#dqCount"), empty = $("#dqEmpty");
    if (!list) return;

    /* 当前份若已有内容则实时同步，避免列表信息滞后 */
    syncCurrentDoc();

    var docs = S.docs || [];
    var filled = docs.filter(function (d) {
      return (d.images && d.images.length) || (d.text || "").trim() || d.result;
    });

    if (cnt) {
      var curNo = 1;
      docs.forEach(function (d, i) {
        var has = (d.images && d.images.length) || (d.text || "").trim() || d.result;
        if (has && i <= S.activeDoc) curNo = curNo;
      });
      cnt.textContent = (filled.length || 0) + " 份";
    }
    /* 空态不显示占位文案，避免列表区块与主按钮贴挤 */
    if (empty) empty.hidden = true;

    /* 折叠态只露当前这一份，其余份数由标题旁的计数与展开入口体现；
       展开后才逐条列出。 */
    var sec = document.querySelector(".doc-section");
    var collapsed = !sec || !sec.classList.contains("expanded");
    var total = docs.filter(function (d) {
      return (d.images && d.images.length) || (d.text || "").trim() || d.result;
    }).length;

    /* 只有多于一份时才提供展开入口；单份展开无意义，点了像没反应 */
    var tg = $("#dqToggle");
    if (tg) {
      var multi = total > 1;
      tg.hidden = !multi;
      if (!multi && sec.classList.contains("expanded")) {
        sec.classList.remove("expanded");
        list.classList.remove("expanded");
        collapsed = true;
      }
      if (multi) {
        var lbl = tg.querySelector(".tgl-txt");
        if (lbl) lbl.textContent = collapsed ? ("展开全部 " + total + " 份") : "收起";
        tg.setAttribute("aria-expanded", collapsed ? "false" : "true");
      }
    }

    list.innerHTML = docs.map(function (d, i) {
      var hasContent = (d.images && d.images.length) || (d.text || "").trim() || d.result;
      if (!hasContent) return "";
      if (collapsed && i !== S.activeDoc) return "";
      /* 折叠时只露当前份，其余份数由标题旁的计数体现 */
      var thumb = (d.images && d.images[0])
        ? '<img class="dq-thumb" src="' + d.images[0].dataUrl + '" alt="">'
        : '<span class="dq-thumb">文</span>';
      /* 标题优先级：作文标题 > 学生姓名 > 页数描述，便于一眼区分多份 */
      var title = d.title || d.student || (d.images && d.images.length ? "原稿 " + d.images.length + " 页" : "未命名作文");
      var meta = [];
      if (d.student) meta.push(R.esc(d.student));
      meta.push(R.esc(ZP.getGrade(d.grade).name));
      if (d.images && d.images.length > 1) meta.push('<span class="dq-badge">' + d.images.length + " 页</span>");
      var score = d.grading
        ? '<span class="dq-score running">批改中</span>'
        : (d.result
            ? '<span class="dq-score">' + d.result.score + "</span>"
            : '<span class="dq-score pending">待批改</span>');

      return '<div class="dq-item' + (i === S.activeDoc ? " active" : "") + '" data-doc="' + i + '">' +
        (i === S.activeDoc ? '<span class="dq-now"></span>' : "") +
        thumb +
        '<div class="dq-main"><span class="dq-title">' + R.esc(title) + "</span>" +
        '<span class="dq-meta">' + meta.join("<i></i>") + "</span></div>" +
        score +
        '<button class="dq-del" type="button" data-del-doc="' + i + '" aria-label="删除这份">×</button>' +
      "</div>";
    }).join("");
  }

  function initDocQueue() {
    var list = $("#dqList");
    if (!list) return;

    var toggle = $("#dqToggle");
    if (toggle) toggle.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      var sec = document.querySelector(".doc-section");
      if (!sec) return;
      var open = sec.classList.toggle("expanded");
      list.classList.toggle("expanded", open);
      /* 文案与 aria 统一交给 renderDocQueue 处理，避免两处各写一遍 */
      renderDocQueue();
    });

    list.addEventListener("click", function (e) {
      var del = e.target.closest("[data-del-doc]");
      if (del) {
        e.stopPropagation();
        removeDoc(Number(del.dataset.delDoc));
        return;
      }
      var item = e.target.closest("[data-doc]");
      if (!item) return;
      var idx = Number(item.dataset.doc);
      if (idx === S.activeDoc) return;
      syncCurrentDoc();
      loadDoc(idx);
    });
  }

  /* 删除某一份；删完仍保留一份空白，避免界面失去落点 */
  function removeDoc(idx) {
    var doc = S.docs[idx];
    if (!doc) return;
    var name = doc.title || "这份作文";
    if (!confirm("删除「" + name + "」？删除后不可恢复。")) return;

    /* 同步删除历史：按标题+姓名定位该份的历史记录 */
    try {
      var hist = ZP.History.load();
      var hit = hist.filter(function (h) {
        if (h.docId && doc.id) return h.docId === doc.id;
        return (h.title || "") === (doc.title || "") && (h.student || "") === (doc.student || "");
      });
      hit.forEach(function (h) { ZP.History.remove(h.id); });
      if (hit.length) {
        ZP.Notice.push("已删除记录", "「" + name + "」的历史批改记录已同步删除", "info");
      }
    } catch (e) {}

    S.docs.splice(idx, 1);
    if (!S.docs.length) S.docs.push(newDoc());
    saveDocs();

    if (idx === S.activeDoc) {
      S.activeDoc = Math.max(0, Math.min(idx, S.docs.length - 1));
      loadDoc(S.activeDoc);
    } else {
      if (idx < S.activeDoc) S.activeDoc -= 1;
      renderDocQueue();
    }
    toast("已删除「" + name + "」。");
  }

  /* 添加一份新作文：保留已完成的份，切到新的空白份 */
  function addNewDoc() {
    syncCurrentDoc();
    S.docs.push(newDoc());
    S.activeDoc = S.docs.length - 1;

    S.images = [];
    S.image = null;
    S.text = "";
    S.title = "";
    S.student = "";
    S.result = null;
    S.demo = false;
    S.view = "text";

    $("#studentName").value = "";
    $("#essayText").value = "";
    $("#textCount").textContent = "0 字";
    var strip = $("#thumbStrip");
    if (strip) { strip.innerHTML = ""; strip.hidden = true; }
    resetDropzone();

    $("#stageTitle").textContent = "等待作文原稿";
    $("#sourceChip").innerHTML = "<i></i>空白画板";
    $("#reportSub").textContent = "新的一份 · 等待批改";

    clearResult();
    R.emptyPaper();
    R.emptyReport();
    syncSeg();
    renderDocQueue();

    refreshGradeUI();

    var sc = $("#stageScroll");
    if (sc) sc.scrollTo({ top: 0, behavior: "smooth" });
    toast("已新建一份，可继续上传。之前几份都保留在「作文列表」里。", "ok");
  }

  /* 当前份已有内容时才另起一份，否则直接复用，避免产生空条目 */
  function startNextEssay() {
    syncCurrentDoc();
    var cur = S.docs[S.activeDoc];
    var hasContent = cur && ((cur.images && cur.images.length) || (cur.text || "").trim() || cur.result || cur.grading);
    if (hasContent) {
      addNewDoc();
    } else {
      toast("当前这份还是空的，直接上传下一份即可。");
    }
  }

  /* 导出页内联的布局校正脚本：打开时按真实高度消除卡片重叠 */
  /* 导出页内联脚本：与 render.js 的 fixBoardLayout 同一套逻辑
     （先清 transform 再量真实高度，再自上而下推开），保证卡片不重叠。 */
  var BOARD_FIX_SCRIPT = [
    "<scr" + "ipt>(function(){",
    "function fix(){",
    "  document.querySelectorAll('.brow').forEach(function(row){",
    "    var sheet=row.querySelector('.bsheet');",
    "    var sheetH=sheet?sheet.offsetHeight:0;",
    "    var need=sheetH;",
    "    row.querySelectorAll('.bcol').forEach(function(col){",
    "      var cards=[].slice.call(col.querySelectorAll('.bcard'));",
    "      if(!cards.length) return;",
    "      cards.forEach(function(c){ c.style.transform='none'; c.style.top='0px'; });",
    "      var hs=cards.map(function(c){ return c.offsetHeight; });",
    "      var tops=cards.map(function(c,i){",
    "        var pct=parseFloat(c.getAttribute('data-top'))||0;",
    "        return pct/100*sheetH - hs[i]/2;",
    "      });",
    "      var GAP=10, prevBottom=-1e9;",
    "      for(var i=0;i<tops.length;i++){",
    "        if(tops[i]<prevBottom+GAP) tops[i]=prevBottom+GAP;",
    "        if(tops[i]<0) tops[i]=0;",
    "        prevBottom=tops[i]+hs[i];",
    "      }",
    "      var colBottom=prevBottom;",
    "      if(colBottom>sheetH && tops.length){",
    "        var shift=Math.min(colBottom-sheetH, tops[0]);",
    "        if(shift>0){ tops=tops.map(function(t){return t-shift;}); colBottom-=shift; }",
    "      }",
    "      cards.forEach(function(c,i){ c.style.top=Math.round(tops[i])+'px'; });",
    "      col.style.height='auto'; col.style.minHeight=sheetH+'px';",
    "      need=Math.max(need, Math.ceil(colBottom+8));",
    "    });",
    "    if(sheet&&need>sheet.offsetHeight){",
    "      sheet.style.minHeight=need+'px';",
    "      row.querySelectorAll('.bcol').forEach(function(col){col.style.minHeight=need+'px';});",
    "    }",
    "  });",
    "}",
    "function fit(){",
    "  document.querySelectorAll('.bwrap').forEach(function(w){",
    "    var s=w.querySelector('.bscale'); if(!s) return;",
    "    var bw=parseFloat(w.getAttribute('data-w'))||0;",
    "    var bh=parseFloat(w.getAttribute('data-h'))||0;",
    "    var avail=w.clientWidth;",
    "    var k=bw>0?Math.min(1,avail/bw):1;",
    "    s.style.transform='scale('+k+')';",
    "    s.style.width=bw+'px';",
    "    w.style.height=(bh*k)+'px';",
    "  });",
    "}",
    "function all(){fix();fit();}",
    "if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',all);}else{all();}",
    "window.addEventListener('load',function(){fix();fit();});",
    "window.addEventListener('resize',fit);",
    "})();</scr" + "ipt>"
  ].join("");

  function exportReport() {
    if (!S.result) { toast("暂无批改结果可导出。", "err"); return; }
    var r = S.result;

    /* 雷达图：从画面上取一份位图，保证报告里的图和界面一致 */
    var radar = "";
    try { radar = $("#radar").toDataURL("image/png"); } catch (e) { radar = ""; }

    /* 交给独立导出模块组装：
       白板每页一张（含人工微调后的位置）→ 概览 → 思路 → 练笔 → 润色 */
    var html = ZP.ReportExport.build(r, {
      images: S.images || [],
      weights: S.weights,
      radar: radar,
      withBoard: (r.source === "vision") && (S.images || []).length > 0
    });

    var baseName = "智批作文报告_" + (r.student || "未署名") + "_" + (r.title || "作文");

    var blob = new Blob([html], { type: "text/html;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = baseName + ".html";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
    toast("报告已导出为 HTML 文件。", "ok");
  }

  /* ---------------- 弹窗 ---------------- */
  var NL = String.fromCharCode(10);

  var MODAL = {
    api: {
      title: "AI 接口配置说明",
      sub: "接入任意 OpenAI 兼容接口，三步即可开始真实批改",
      body:
        '<h4><span>1</span>选择服务商</h4>' +
        "<p>内置 DeepSeek、通义千问、Kimi、智谱、OpenAI 等预设；选择后地址与模型会自动填好，只需补齐自己的 Key。若使用 Ollama、vLLM 等本地模型，选「自定义 / 本地」，地址填 <code>http://127.0.0.1:11434/v1</code>。</p>" +
        "<h4><span>2</span>填写接口信息</h4>" +
        "<ul><li><b>接口地址</b>：以 <code>/v1</code> 结尾的 Base URL，程序会自动补 <code>/chat/completions</code>。</li>" +
        "<li><b>模型</b>：如 <code>deepseek-chat</code>、<code>qwen-plus</code>、<code>glm-4-flash</code>。</li>" +
        "<li><b>API Key</b>：仅保存在本机浏览器 localStorage，不经任何中间服务器。</li></ul>" +
        "<h4><span>3</span>测试并开始批改</h4>" +
        "<p>点「测试连接」，返回「接口连接成功」即可。批改时会按年级课标要求发送结构化提示词，模型直接返回四维评分、逐句批注、写作思路、小练笔与升格范文。</p>" +
        '<div class="warnbox">提示：浏览器直连第三方接口可能受跨域（CORS）限制。若出现「网络请求失败」，请确认服务商是否允许浏览器直连；本地部署可用 Nginx 反向代理并加上 CORS 头。</div>' +
        "<h4>自建代理示例</h4>" +
        "<pre><span class=\"c\"># nginx.conf</span>\nlocation /v1/ {\n  proxy_pass https://api.deepseek.com/v1/;\n  add_header Access-Control-Allow-Origin *;\n  add_header Access-Control-Allow-Headers *;\n}</pre>"
    },
    ocr: {
      title: "图片批改 · 两种方式",
      sub: "没有本地 OCR 也能用：交给支持视觉的模型直接读图",
      body:
        '<div class="warnbox" style="background:#eef7f2;border-color:#cfe6da;color:#2c7d5f">' +
          "<b>推荐：视觉模型直读。</b>不需要装任何东西，上传作文照片后，模型自己读图、自己批改，批注仍然逐句画线。</div>" +
        "<h4><span>1</span>用视觉模型（无需本地部署）</h4>" +
        "<ul>" +
          "<li>在「图片识别方式」选择 <b>视觉模型直读</b>。</li>" +
          "<li>选一个预设：通义千问 VL、智谱 GLM-4V、GPT-4o、Kimi 视觉版、硅基流动 Qwen2.5-VL。</li>" +
          "<li>填入该模型的接口 Key（与主批改 Key 相同则自动复用）。</li>" +
          "<li>点「测试读图」：会用一张写着「智批作文」的小图验证模型是否真能看图，而不是只回文字。</li>" +
        "</ul>" +
        "<pre># 视觉请求示例（OpenAI 兼容协议）" + NL +
        '{' + NL + '  "model": "qwen-vl-max",' + NL + '  "messages": [{' + NL +
        '    "role": "user",' + NL + '    "content": [' + NL +
        '      {"type": "text", "text": "读取并批改这篇作文"},' + NL +
        '      {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,..."}}' + NL +
        '    ]' + NL + '  }]' + NL + '}</pre>' +
        "<h4><span>2</span>用本地 OCR（内网环境）</h4>" +
        "<p>若图片不能出内网，切到 <b>本地 OCR</b>，启动 <code>local_ocr/server.py</code>" +
        "（PaddleOCR），填 <code>http://127.0.0.1:8866</code>，点「测试识别」。部署步骤见 <code>local_ocr/README.md</code>。</p>" +
        '<div class="warnbox">说明：切换后若仍用纯文本模型（如 deepseek-chat）读图，会报“模型不支持图片”，' +
        "此时界面会提示你换用 VL 模型——不会用模板编造批改结果。</div>" +
        "<h4><span>3</span>效果建议</h4>" +
        "<ul>" +
          "<li>拍照尽量正对纸面、光线均匀，避免阴影与倾斜，识别与画线都会更准。</li>" +
          "<li>图片会自动压缩到长边 1600px 再上传，兼顾清晰度与请求体积。</li>" +
          "<li>视觉直读模式下，批注按段落位置估算对齐；若同时填了正文，会改用逐句精确对齐。</li>" +
        "</ul>"
    }
  };

  function openModal(kind) {
    var cfg = MODAL[kind] || MODAL.api;
    $("#modalTitle").textContent = cfg.title;
    $("#modalSub").textContent = cfg.sub;
    $("#modalBody").innerHTML = cfg.body;
    $("#modal").hidden = false;
  }

  function initModal() {
    $$("[data-close]").forEach(function (el) {
      el.addEventListener("click", function () { $("#modal").hidden = true; });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") $("#modal").hidden = true;
    });
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    var splash = $("#splash");
    if (splash) setTimeout(function () { splash.classList.add("out"); setTimeout(function () { splash.remove(); }, 700); }, 1250);
    initGenres();
    initGrades();
    initAccordion();
    initConfigAccordion();
    initConfig();
    initThinkMode();
    initUpload();
    initText();
    initStageTools();
    initTabs();
    initGradeButton();
    initName();
    initModal();

    ZP.History.attach({
      toast: toast,
      esc: R.esc,
      fmt: R.fmt,
      onRestore: restoreHistory
    });
    ZP.History.badge();
    ZP.Notice.attach({ esc: R.esc, onErrorDetail: showErrorDialog });
    ZP.Notice.init();

    updateGradeCard();
    renderDims();
    /* 启动即「待批改」：不预置演示作文，避免误以为是真实批改结果。
       只有用户主动点「载入演示作文」才展示演示稿。 */
    S.demo = false;
    S.result = null;
    S.images = [];
    S.image = null;
    S.text = "";
    S.title = "";
    /* 先前会话的作文队列：刷新后原样恢复，历史记录才能找回整组原稿 */
    var restored = loadDocs();
    if (restored && restored.list.length) {
      S.docs = restored.list;
      S.activeDoc = restored.active;
      loadDoc(S.activeDoc);
    } else {
      S.docs = [newDoc()];
      S.activeDoc = 0;
    }
    if (restored && restored.list.length) {
      /* 恢复成功：界面已由 loadDoc 填好，不能再走下面的「清空」分支，
         否则会把刚恢复的分数与批注抹掉（存储里也会被写成 null）。 */
      $("#studentName").value = S.student || "";
      $("#essayText").value = S.text || "";
      $("#textCount").textContent = ZP.countChars(S.text) + " 字";
      if (S.result) {
        R.report(S.result);
        paintStaleChip();
        if (S.view === "image" && S.image) R.imageSheet(S.image.dataUrl, S.image, S.result);
        else if (S.result.paragraphs) R.essay(S.result);
      } else {
        R.emptyReport();
        R.emptyPaper();
      }
      syncSeg();
      renderDocQueue();
    } else {
      $("#studentName").value = "";
      $("#essayText").value = "";
      $("#textCount").textContent = "0 字";
      clearResult();
      R.emptyPaper();
      R.emptyReport();
      syncSeg();
      $("#stageTitle").textContent = "等待作文原稿";
      $("#sourceChip").innerHTML = "<i></i>空白画板";
      $("#reportSub").textContent = "上传作文照片或粘贴正文后开始批改";
      renderDocQueue();
    }

    window.addEventListener("resize", function () {
      if (!S.result) return;
      clearTimeout(window.__zpResize);
      window.__zpResize = setTimeout(function () {
        if (S.view === "image") return;
        R.essay(S.result);
      }, 260);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})(window.ZP);
