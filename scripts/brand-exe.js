/* 打包后处理：给 win-unpacked 的 exe 写入图标与版本信息。
 * electron-builder 自带 rcedit 与 asar-integrity 存在时序冲突
 * （Unable to commit changes），因此 signAndEditExecutable=false，
 * 由本脚本在打包完成后独立执行 rcedit（已验证稳定）。
 * 用法：node scripts/brand-exe.js（npm run dist 后自动调用） */
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const root = path.join(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const productName = pkg.build.productName || pkg.productName || pkg.name;
const version = pkg.version;

/* 定位 rcedit：electron-builder 缓存 */
const cacheBase = path.join(os.homedir(), "AppData", "Local", "electron-builder", "Cache", "winCodeSign");
let rcedit = null;
if (fs.existsSync(cacheBase)) {
  for (const d of fs.readdirSync(cacheBase)) {
    const p = path.join(cacheBase, d, "rcedit-x64.exe");
    if (fs.existsSync(p)) { rcedit = p; break; }
  }
}
if (!rcedit) { console.error("rcedit not found in electron-builder cache"); process.exit(1); }

/* 定位 exe */
const unpacked = path.join(root, "dist", "win-unpacked");
const exe = fs.readdirSync(unpacked).filter(f => f.endsWith(".exe"))
  .map(f => path.join(unpacked, f))[0];
if (!exe) { console.error("exe not found in dist/win-unpacked"); process.exit(1); }

const icon = path.join(root, "build", "icon.ico");
const args = [exe,
  "--set-icon", icon,
  "--set-version-string", "FileDescription", productName + " · AI 作文批改工作台",
  "--set-version-string", "ProductName", productName,
  "--set-version-string", "LegalCopyright", "Copyright © 2026 " + productName,
  "--set-file-version", version,
  "--set-product-version", version + ".0",
  "--set-version-string", "InternalName", productName,
  "--set-version-string", "CompanyName", productName
];
/* execFileSync 带重试：electron-builder 刚写完 exe 时文件锁/杀毒扫描
可能短暂占用，rcedit 会报 "Unable to commit changes"，等 2 秒重试即可。 */
let lastErr = null;
for (let attempt = 1; attempt <= 5; attempt++) {
  try {
    execFileSync(rcedit, args, { stdio: "inherit" });
    lastErr = null;
    break;
  } catch (e) {
    lastErr = e;
    console.log("brand-exe: rcedit attempt " + attempt + " failed, retrying in 2s...");
    const wait = (ms) => { const t = Date.now() + ms; while (Date.now() < t) {} };
    wait(2000);
  }
}
if (lastErr) throw lastErr;
console.log("brand-exe: icon + version info written to", path.basename(exe));