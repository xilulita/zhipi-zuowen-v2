# 本地 OCR 服务（智批作文）

作文照片在内网识别，图片不上传到任何第三方服务。

## 1. 安装

```bash
cd local_ocr
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt
```

> 首次启动 PaddleOCR 会自动下载中文识别模型（约 20–90 MB），需要可访问外网；
> 下载完成后即可完全离线运行。

## 2. 启动

```bash
python server.py
```

默认监听 `http://127.0.0.1:8866`。可改端口：

```bash
set ZHIPI_OCR_PORT=9000    # Windows
export ZHIPI_OCR_PORT=9000 # macOS / Linux
python server.py
```

## 3. 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 健康检查，返回 `{"ok": true}` |
| POST | `/ocr` | 识别，请求体 `{"image": "<base64 或 dataURL>"}`，返回 `{"text": "...", "lines": [...], "chars": 123}` |

自测：

```bash
curl -X POST http://127.0.0.1:8866/ocr ^
  -H "Content-Type: application/json" ^
  -d "{\"image\":\"<base64>\"}"
```

## 4. 在前端启用

1. 打开智批作文页面；
2. 展开左侧「批改功能选项」；
3. 在「本地 OCR 识别」里填 `http://127.0.0.1:8866`；
4. 点「测试识别」，状态变为「已连通」即可。

之后上传图片，点「开始 AI 批改」会先识别再批改。前端同时兼容
`/ocr`、`/predict`、`/api/ocr`、`/v1/ocr` 四个路由，以及 `text`、
`result`、`lines`、`rec_texts` 等返回结构，方便替换成自己的服务。

## 5. 说明

- 服务仅监听 `127.0.0.1`，不会暴露到局域网；如需跨机调用请自行加鉴权与 HTTPS。
- 识别质量取决于拍摄角度与光线，建议正对纸面、避免阴影和倾斜。
- 未启动 OCR 时，前端会明确提示去配置，不会用模板伪造批改结果。
