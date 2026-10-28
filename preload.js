/* 最小预加载：只暴露版本号，不开放 Node 能力 */
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("zhipiDesktop", Object.freeze({
  isDesktop: true,
  platform: process.platform
}));
