"""
PaddleOCR Engine — 本地 OCR 识别模块

使用 PaddleOCR 进行图片文字识别，返回文本行和置信度。
懒加载单例模式，仅在首次调用时初始化模型。
"""

from __future__ import annotations
import base64
import logging
import time
import tempfile
import os
from typing import Optional

logger = logging.getLogger(__name__)

# ─── 全局单例 ──────────────────────────────────────────────────
_ocr_instance = None


def _get_ocr():
    """懒加载 PaddleOCR 实例"""
    global _ocr_instance
    if _ocr_instance is None:
        try:
            from paddleocr import PaddleOCR
            logger.info('[PaddleOCR] 正在初始化模型（首次调用会下载模型文件）...')
            t0 = time.time()
            _ocr_instance = PaddleOCR(
                use_angle_cls=True,
                lang='ch',
                show_log=False,
                use_gpu=False,
            )
            elapsed = round((time.time() - t0) * 1000)
            logger.info('[PaddleOCR] 模型初始化完成, 耗时 %dms', elapsed)
        except ImportError:
            logger.error('[PaddleOCR] paddleocr 未安装，请执行: pip install paddleocr')
            return None
        except Exception as e:
            logger.exception('[PaddleOCR] 初始化失败: %s', e)
            return None
    return _ocr_instance


def run_paddle_ocr(
    image_path: str = None,
    image_base64: str = None,
) -> dict:
    """执行 PaddleOCR 文字识别。

    支持 image_path（文件路径）或 image_base64（base64 字符串）两种入参。

    返回:
        {
            'success': True,
            'texts': ['行1', '行2', ...],
            'confidences': [0.98, 0.95, ...],
            'elapsed_ms': 1234,
        }
        或 {'success': False, 'error': '错误信息'}
    """
    ocr = _get_ocr()
    if ocr is None:
        return {'success': False, 'error': 'PaddleOCR 模型不可用'}

    # ── 处理输入 ──
    cleanup_path = None
    if image_base64:
        # 将 base64 写入临时文件（PaddleOCR 需要文件路径或 numpy array）
        try:
            raw = base64.b64decode(image_base64)
            suffix = '.png'
            # 简略检测格式
            if len(raw) >= 4:
                if raw[:4] == b'\x89PNG':
                    suffix = '.png'
                elif raw[:2] in (b'\xFF\xD8',):
                    suffix = '.jpg'
            tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
            tmp.write(raw)
            tmp.close()
            effective_path = tmp.name
            cleanup_path = tmp.name
        except Exception as e:
            return {'success': False, 'error': f'Base64 解码失败: {str(e)}'}
    elif image_path:
        if not os.path.isfile(image_path):
            return {'success': False, 'error': f'图片文件不存在: {image_path}'}
        effective_path = image_path
    else:
        return {'success': False, 'error': '需要 image_path 或 image_base64 参数'}

    # ── 执行 OCR ──
    logger.info('[PaddleOCR] 正在识别: %s', effective_path)
    t0 = time.time()

    try:
        # paddleocr.ocr() 返回 list[list[bbox, (text, confidence)]]
        result = ocr.ocr(effective_path, cls=True)
    except Exception as e:
        logger.exception('[PaddleOCR] 识别异常')
        if cleanup_path:
            try:
                os.unlink(cleanup_path)
            except Exception:
                pass
        return {'success': False, 'error': f'OCR 识别异常: {str(e)}'}

    elapsed = round((time.time() - t0) * 1000)

    # 清理临时文件
    if cleanup_path:
        try:
            os.unlink(cleanup_path)
        except Exception:
            pass

    # ── 解析结果 ──
    texts: list[str] = []
    confidences: list[float] = []

    if result and len(result) > 0:
        # result[0] 是单张图片的结果列表
        for line in result[0]:
            if line and len(line) == 2:
                bbox, (text, conf) = line
                if text and text.strip():
                    texts.append(text.strip())
                    confidences.append(float(conf))

    logger.info(
        '[PaddleOCR] 识别完成, 耗时 %dms, 文本行数 %d',
        elapsed, len(texts),
    )

    return {
        'success': True,
        'texts': texts,
        'confidences': confidences,
        'elapsed_ms': elapsed,
    }
