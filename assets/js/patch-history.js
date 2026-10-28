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

    /* 历史记录若带封面图，回填到上传区，便于再次查看原稿 */
    if (rec.thumb) {
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
      $("#dzAddMore").hidden = true;
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

    S.view = "text";
    R.essay(rec);
    R.report(rec);
    syncSeg();

    $("#stageTitle").textContent = rec.title || "历史记录";
    $("#sourceChip").innerHTML = "<i></i>历史记录";
    $("#reportSub").textContent = "历史批改 · " +
      new Date(rec.savedAt || Date.now()).toLocaleString("zh-CN");

    var sc = $("#stageScroll");
    if (sc) sc.scrollTo({ top: 0, behavior: "smooth" });
    toast("已载入历史记录：" + (rec.title || "未命名"));
  }

  /* 添加下一份：归档当前结果，清空工作区开始新稿 */
  function startNextEssay() {
    if (S.result && !S.demo) ZP.History.save(S.result, S.images);

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
    ZP.History.badge();

    var sc = $("#stageScroll");
    if (sc) sc.scrollTo({ top: 0, behavior: "smooth" });
    toast("已归档上一份，可以开始新的一份了。", "ok");
  }
