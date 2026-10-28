"""
智批作文 · 本地 OCR 服务（PaddleOCR）
------------------------------------------------------------
用途：把作文照片在本地识别成文字，图片不出内网。
接口：POST /ocr   {"image": "<base64 或 dataURL>"}  ->  {"text": "..."}
      GET  /health                                ->  {"ok": true}

启动：
    pip install -r requirements.txt
    python server.py
默认监听 http://127.0.0.1:8866
"""

import base64
import io
import logging
import os
from typing import Any, Dict, List

import numpy as np
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from PIL import Image

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("zhipi-ocr")

try:
    from paddleocr import PaddleOCR
except ImportError:  # pragma: no cover
    PaddleOCR = None

app = FastAPI(title="智批作文 · 本地 OCR", version="1.0.0")

# 允许前端页面（file:// 或 localhost）直接调用
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

_ocr = None


def get_ocr():
    """惰性初始化，避免启动时阻塞。"""
    global _ocr
    if _ocr is None:
        if PaddleOCR is None:
            raise HTTPException(
                status_code=503,
                detail="未安装 PaddleOCR，请执行：pip install paddleocr paddlepaddle",
            )
        log.info("初始化 PaddleOCR（首次运行会下载模型）…")
        _ocr = PaddleOCR(use_angle_cls=True, lang="ch", show_log=False)
        log.info("PaddleOCR 就绪")
    return _ocr


class OCRRequest(BaseModel):
    image: str


def decode_image(payload: str) -> Image.Image:
    """兼容纯 base64 与 data:image/jpeg;base64,... 两种写法。"""
    if not payload:
        raise HTTPException(status_code=400, detail="缺少 image 字段")
    raw = payload.split(",", 1)[1] if payload.startswith("data:") else payload
    try:
        data = base64.b64decode(raw)
    except Exception:
        raise HTTPException(status_code=400, detail="image 不是合法的 base64")
    try:
        img = Image.open(io.BytesIO(data))
    except Exception:
        raise HTTPException(status_code=400, detail="无法解析图片内容")
    return img.convert("RGB")


def to_lines(result: Any) -> List[str]:
    """把 PaddleOCR 各种版本的返回结构统一成文本行。"""
    lines: List[str] = []
    if not result:
        return lines

    # 新版本可能返回 [{'rec_texts': [...]}]
    if isinstance(result, dict):
        for key in ("rec_texts", "text", "texts"):
            if isinstance(result.get(key), list):
                return [str(x) for x in result[key]]
        for value in result.values():
            lines.extend(to_lines(value))
        return lines

    if isinstance(result, (list, tuple)):
        # [[ [box, (text, score)], ... ]] 经典结构
        for page in result:
            if page is None:
                continue
            if isinstance(page, dict):
                lines.extend(to_lines(page))
                continue
            for item in page:
                if isinstance(item, (list, tuple)) and len(item) >= 2:
                    second = item[1]
                    if isinstance(second, (list, tuple)) and second:
                        lines.append(str(second[0]))
                    elif isinstance(second, str):
                        lines.append(second)
                elif isinstance(item, str):
                    lines.append(item)
    return lines


def merge_by_columns(lines: List[str]) -> str:
    """
    作文照片常是横排多行；这里按识别顺序拼接，
    过滤空行与明显的单字符噪声。
    """
    cleaned = []
    for line in lines:
        text = (line or "").strip()
        if not text:
            continue
        cleaned.append(text)
    return "\n".join(cleaned)


@app.get("/health")
def health() -> Dict[str, Any]:
    return {"ok": True, "engine": "paddleocr", "ready": _ocr is not None}


@app.post("/ocr")
def ocr(req: OCRRequest) -> Dict[str, Any]:
    img = decode_image(req.image)
    engine = get_ocr()
    try:
        result = engine.ocr(np.array(img), cls=True)
    except TypeError:
        # 部分版本不支持 cls 参数
        result = engine.ocr(np.array(img))

    lines = to_lines(result)
    text = merge_by_columns(lines)
    if not text:
        raise HTTPException(status_code=422, detail="未识别到文字，请检查图片清晰度或换一张")

    log.info("识别完成：%d 行 / %d 字", len(lines), len(text.replace("\n", "")))
    return {"text": text, "lines": lines, "chars": len(text.replace("\n", ""))}


if __name__ == "__main__":
    port = int(os.environ.get("ZHIPI_OCR_PORT", "8866"))
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")
