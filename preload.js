/* 最小预加载：暴露版本号 + 一键导出 PDF 通道，不开放其他 Node 能力 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("zhipiDesktop", Object.freeze({
  isDesktop: true,
  platform: process.platform,
  /* 一键导出 PDF：把报告 HTML 交给主进程排版并保存，返回 {ok, filePath} */
  exportPdf: (payload) => ipcRenderer.invoke("export-pdf", payload)
}));