  /* ============================================================
     多份作文队列
     每份独立保存：图片、正文、姓名、年级、体裁、批改结果
     ============================================================ */
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
  }

  /* 从队列项装载到编辑区 */
  function loadDoc(idx) {
    var doc = S.docs[idx];
    if (!doc) return;
    S.activeDoc = idx;

    S.images = (doc.images || []).slice();
    S.image = S.images[0] || null;
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

    if (S.images.length) {
      $("#dzInner").style.display = "none";
      $("#dzInner").hidden = true;
      $("#thumbStrip").hidden = false;
      $("#dzAddMore").hidden = false;
    } else {
      resetDropzone();
    }

    if (S.result) {
      S.view = S.images.length ? "image" : "text";
      if (S.view === "image") R.imageSheet(S.image.dataUrl, S.image, S.result);
      else R.essay(S.result);
      R.report(S.result);
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

    if (cnt) cnt.textContent = (filled.length || 0) + " 份";
    if (empty) empty.hidden = filled.length > 0;

    list.innerHTML = docs.map(function (d, i) {
      var hasContent = (d.images && d.images.length) || (d.text || "").trim() || d.result;
      if (!hasContent) return "";
      var thumb = (d.images && d.images[0])
        ? '<img class="dq-thumb" src="' + d.images[0].dataUrl + '" alt="">'
        : '<span class="dq-thumb">文</span>';
      var title = d.title || (d.images && d.images.length ? "原稿 " + d.images.length + " 页" : "未命名作文");
      var meta = [];
      if (d.student) meta.push(R.esc(d.student));
      meta.push(R.esc(ZP.getGrade(d.grade).name));
      if (d.images && d.images.length > 1) meta.push('<span class="dq-badge">' + d.images.length + " 页</span>");
      var score = d.result
        ? '<span class="dq-score">' + d.result.score + "</span>"
        : '<span class="dq-score pending">待批改</span>';

      return '<div class="dq-item' + (i === S.activeDoc ? " active" : "") + '" data-doc="' + i + '">' +
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

    S.docs.splice(idx, 1);
    if (!S.docs.length) S.docs.push(newDoc());

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
    var add = $("#dzAddMore");
    if (add) add.hidden = true;
    resetDropzone();

    $("#stageTitle").textContent = "等待作文原稿";
    $("#sourceChip").innerHTML = "<i></i>空白画板";
    $("#reportSub").textContent = "新的一份 · 等待批改";

    clearResult();
    R.emptyPaper();
    R.emptyReport();
    syncSeg();
    renderDocQueue();

    var sc = $("#stageScroll");
    if (sc) sc.scrollTo({ top: 0, behavior: "smooth" });
    toast("已新建一份，可继续上传。之前几份都保留在「作文列表」里。", "ok");
  }

  /* 当前份已有内容时才另起一份，否则直接复用，避免产生空条目 */
  function startNextEssay() {
    syncCurrentDoc();
    var cur = S.docs[S.activeDoc];
    var hasContent = cur && ((cur.images && cur.images.length) || (cur.text || "").trim() || cur.result);
    if (hasContent) {
      addNewDoc();
    } else {
      toast("当前这份还是空的，直接上传下一份即可。");
    }
  }
