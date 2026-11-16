/* ============================================================
   笔墨生香 · Electron 主进程
   纯本地运行：不加载任何远程页面，只读本地 index.html
   ============================================================ */
const { app, BrowserWindow, shell, Menu, dialog, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");

/* 单实例：重复双击时聚焦已有窗口 */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  let win = null;

  function createWindow() {
    win = new BrowserWindow({
      width: 1440,
      height: 920,
      minWidth: 1180,
      minHeight: 720,
      backgroundColor: "#f3f0e9",
      title: "笔墨生香",
      icon: path.join(__dirname, "build", "icon.ico"),
      show: false,
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false
      }
    });

    const indexPath = path.join(__dirname, "index.html");
    win.loadFile(indexPath);

    win.once("ready-to-show", () => {
      win.show();
      win.focus();
    });

    /* 页面内若出现外链，用系统浏览器打开，不在应用内跳走 */
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) shell.openExternal(url);
      return { action: "deny" };
    });

    win.webContents.on("will-navigate", (e, url) => {
      if (url.startsWith("file://")) return;
      e.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    });

    win.on("closed", () => { win = null; });
  }

  app.setAppUserModelId("com.bimo.shengxiang");

  /* 极简菜单：只保留退出的快捷键，避免默认英文菜单 */
  function buildMenu() {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      {
        label: "文件",
        submenu: [
          { label: "重新载入", accelerator: "CmdOrCtrl+R", click: () => win && win.reload() },
          { type: "separator" },
          { label: "退出", accelerator: "Alt+F4", role: "quit" }
        ]
      },
      {
        label: "视图",
        submenu: [
          { label: "放大", accelerator: "CmdOrCtrl+=", click: () => stepZoom(0.1) },
          { label: "缩小", accelerator: "CmdOrCtrl+-", click: () => stepZoom(-0.1) },
          { label: "实际大小", accelerator: "CmdOrCtrl+0", click: () => win && (win.webContents.setZoomFactor(1)) },
          { type: "separator" },
          { label: "全屏", role: "togglefullscreen" }
        ]
      },
      {
        label: "帮助",
        submenu: [
          {
            label: "关于笔墨生香",
            click: () => {
              dialog.showMessageBox({
                type: "info",
                title: "关于",
                message: "笔墨生香 " + app.getVersion(),
                detail: "AI 作文批改工作台\n\n数据与 API Key 仅保存在本机，不上传任何服务器。",
                buttons: ["好的"]
              });
            }
          }
        ]
      }
    ]));
  }

  function stepZoom(delta) {
    if (!win) return;
    const now = win.webContents.getZoomFactor();
    const next = Math.min(2, Math.max(0.6, Math.round((now + delta) * 100) / 100));
    win.webContents.setZoomFactor(next);
  }

  /* ---------------- 一键导出 PDF ----------------
     点击即弹出「保存到」对话框（唯一一步用户操作），选完位置后
     后台隐藏窗口加载报告 HTML → 等排版脚本跑完 → printToPDF
     （A4、保留背景色，原稿页三栏整体同页）→ 直接写盘。
     全程不出现打印界面，与导出 HTML 完全同一份文档、同一套版式。 */
  let pdfBusy = false;
  ipcMain.handle("export-pdf", async (event, payload) => {
    if (pdfBusy) return { ok: false, error: "busy" };
    pdfBusy = true;
    let tmpPath = "";
    let pdfWin = null;
    try {
      const html = payload && payload.html;
      const baseName = String((payload && payload.baseName) || "笔墨生香报告")
        .replace(/[\\/:*?"<>|]/g, "_").slice(0, 120);
      if (!html || typeof html !== "string") return { ok: false, error: "no-html" };

      /* 第一步就弹保存框：用户点击按钮后立即看到保存位置界面 */
      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        title: "导出 PDF 报告",
        defaultPath: path.join(app.getPath("documents"), baseName + ".pdf"),
        filters: [{ name: "PDF 文件", extensions: ["pdf"] }]
      });
      if (canceled || !filePath) return { ok: false, canceled: true };

      /* 报告是 fully self-contained 的 HTML（样式内联、图片 dataURL、
         排版脚本内联），落临时文件后 file:// 加载即可，无网络依赖 */
      tmpPath = path.join(app.getPath("temp"), "zhipi-report-" + Date.now() + ".html");
      fs.writeFileSync(tmpPath, html, "utf8");

      pdfWin = new BrowserWindow({
        show: false,
        width: 1100,
        height: 1500,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          spellcheck: false
        }
      });
      await pdfWin.loadFile(tmpPath);

      /* 等排版脚本完成（report-fix.js 会打 data-layout-done 标记），
         再等一帧确保卡片位置写回已生效；最多等 8 秒 */
      try {
        await pdfWin.webContents.executeJavaScript(
          "new Promise(function(res){var t0=Date.now();(function ck(){" +
          "if(document.documentElement.getAttribute('data-layout-done')==='1'){setTimeout(res,120);}" +
          "else if(Date.now()-t0>8000){res(1);}" +
          "else{setTimeout(ck,80);}})();})",
          true
        );
      } catch (e) { /* 页面脚本异常不阻塞导出 */ }

      /* PDF 模式：图片页重排铺满 + 超高页防拆 */
      let docW = 0;
      try {
        docW = await pdfWin.webContents.executeJavaScript(
          "(function(){window.__zpPdfFit&&window.__zpPdfFit();" +
          "var d=document.querySelector('.doc');return d?Math.ceil(d.getBoundingClientRect().width):0;})()", true);
      } catch (e) { /* 旧版报告无此函数时忽略 */ }

      /* printToPDF 按视口宽度做页宽缩放：用 CDP 把布局视口精确设为文档宽，
         保证白板完整缩进页内、两侧批注不越界，且图片尽可能大 */
      if (docW && docW > 1000) {
        try {
          pdfWin.webContents.debugger.attach("1.3");
          await pdfWin.webContents.debugger.sendCommand("Emulation.setDeviceMetricsOverride", {
            width: docW, height: 1500, deviceScaleFactor: 1, mobile: false
          });
          await new Promise(r => setTimeout(r, 250));
        } catch (e) { /* 调试器不可用时退回默认视口 */ }
      }

      const pdfData = await pdfWin.webContents.printToPDF({
        printBackground: true,
        preferCSSPageSize: true,   /* 尊重报告里的 @page A4 设置 */
        /* 页宽缩放由打印管线自动完成（报告 1032px → A4 可印区），
           原稿页的整页适配由报告内联 transform 完成，这里不再叠 scale */
        displayHeaderFooter: false,
        margins: { top: 0, bottom: 0, left: 0, right: 0 }
      });

      fs.writeFileSync(filePath, pdfData);
      return { ok: true, filePath };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    } finally {
      pdfBusy = false;
      if (pdfWin && !pdfWin.isDestroyed()) pdfWin.destroy();
      if (tmpPath) { try { fs.unlinkSync(tmpPath); } catch (e) { /* 忽略 */ } }
    }
  });

  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    /* 把图标也放到安装目录供窗口/任务栏使用 */
    try {
      const iconSrc = path.join(__dirname, "build", "icon.ico");
      if (!fs.existsSync(iconSrc)) {
        /* 缺失时不影响启动，Electron 会用默认图标 */
      }
    } catch (e) { /* 忽略 */ }

    buildMenu();
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
