/* ============================================================
   智批作文 · Electron 主进程
   纯本地运行：不加载任何远程页面，只读本地 index.html
   ============================================================ */
const { app, BrowserWindow, shell, Menu, dialog } = require("electron");
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
      title: "智批作文",
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

  app.setAppUserModelId("com.zhipi.zuowen");

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
            label: "关于智批作文",
            click: () => {
              dialog.showMessageBox({
                type: "info",
                title: "关于",
                message: "智批作文 " + app.getVersion(),
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
