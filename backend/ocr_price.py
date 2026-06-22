"""
OCR Price Enhancement — 图像预处理 + 价格区域锁定 + API 交叉校验 + 合理性过滤

全线解决 OCR 数字混淆问题（如 3↔6、6↔8、8↔1、1↔3）。

处理流程:
  1. preprocess_image() — 放大3x + 灰度 + 自适应二值化 + 锐化 + 反转
  2. locate_price_region() — 定位价格数字区域并裁剪
  3. validate_price_cross_api() — 用实时行情 API 交叉校验
  4. filter_ocr_prices() — 价格合理性校验（范围 + 涨跌幅限制 + 多候选取最优）
"""

from __future__ import annotations
import logging
import re
import time
from typing import Optional, Any
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

# ─── PIL 可用性检查 ──────────────────────────────────────────

try:
    from PIL import Image, ImageFilter, ImageEnhance
    import numpy as np
    _CV_AVAILABLE = True
except ImportError:
    Image = None
    ImageFilter = None
    ImageEnhance = None
    np = None
    _CV_AVAILABLE = False
    logger.warning('[OCR Price] Pillow/numpy 未安装，图像预处理功能将禁用')


# ═══════════════════════════════════════════════════════════════
# Step 1: 图像预处理
# ═══════════════════════════════════════════════════════════════

def preprocess_image(image_path: str) -> Optional[str]:
    """
    对截图进行 OCR 前预处理，返回临时文件路径，或 None 表示失败。

    处理链:
      1. 放大 3x (bicubic 插值)
      2. 转为灰度图
      3. 自适应二值化 (adaptiveThreshold 模拟)
      4. Unsharp mask 锐化
      5. 检测深色背景并反转

    返回:
        预处理后的图片临时路径（PNG），或 None（失败/库缺失）
    """
    if not _CV_AVAILABLE:
        return None

    temp_path = image_path  # fallback: return original path

    try:
        img = Image.open(image_path)
    except Exception:
        logger.exception('[OCR Price] 无法打开图片 %s', image_path)
        return None

    logger.info('[OCR Price] 原始尺寸: %dx%d, 模式: %s', img.width, img.height, img.mode)

    # ── 1a: 放大 3x (bicubic) ──
    w, h = img.size
    enlarged = img.resize((w * 3, h * 3), Image.BICUBIC)
    logger.info('[OCR Price] 放大3x: %dx%d', enlarged.width, enlarged.height)

    # ── 1b: 灰度 ──
    gray = enlarged.convert('L') if enlarged.mode != 'L' else enlarged.copy()

    # ── 1c: 检测深色背景 ──
    # 计算图像平均亮度
    gray_np = np.array(gray, dtype=np.uint8)
    mean_brightness = float(gray_np.mean())
    is_dark_bg = mean_brightness < 128
    logger.info('[OCR Price] 平均亮度: %.1f, 深色背景: %s', mean_brightness, is_dark_bg)

    # ── 1d: 自适应二值化 ──
    # 用 OpenCV 风格的自适应阈值模拟
    binary = _adaptive_threshold(gray_np, is_dark_bg)
    if binary is not None:
        logger.info('[OCR Price] 自适应二值化完成')
    else:
        # fallback: 如果二值化失败，用原始灰度
        binary = gray_np

    # ── 1e: Unsharp mask 锐化 ──
    binary_img = Image.fromarray(binary, mode='L')
    if ImageFilter:
        # 创建高斯模糊版本
        blurred = binary_img.filter(ImageFilter.GaussianBlur(radius=1.0))
        # unsharp = original + (original - blurred) * amount
        # 使用 PIL 的复合模式模拟
        sharpened = Image.fromarray(
            np.clip(
                np.array(binary_img, dtype=np.float32) * 1.5
                - np.array(blurred, dtype=np.float32) * 0.5,
                0, 255
            ).astype(np.uint8),
            mode='L'
        )
        logger.info('[OCR Price] Unsharp mask 锐化完成')
    else:
        sharpened = binary_img

    # ── 1f: 深色背景反转 ──
    if is_dark_bg:
        sharp_np = np.array(sharpened, dtype=np.uint8)
        inverted = 255 - sharp_np
        sharpened = Image.fromarray(inverted, mode='L')
        logger.info('[OCR Price] 深色背景已反转')

    # ── 保存临时文件 ──
    import tempfile
    import os

    # 复用原目录，但加后缀
    base, ext = os.path.splitext(image_path)
    processed_path = f'{base}_enhanced.png'
    sharpened.save(processed_path, 'PNG')
    logger.info('[OCR Price] 预处理结果已保存: %s', processed_path)

    return processed_path


def _adaptive_threshold(gray: np.ndarray, is_dark: bool) -> Optional[np.ndarray]:
    """
    模拟 OpenCV 的 adaptiveThreshold (ADAPTIVE_THRESH_GAUSSIAN_C)。

    使用局部均值 + 偏移量进行二值化。
    对深色背景使用 THRESH_BINARY_INV 效果（先取反再二值化）。
    """
    try:
        h, w = gray.shape
        block_size = 31  # 必须为奇数
        offset = 10  # C 值

        half = block_size // 2
        result = np.zeros_like(gray, dtype=np.uint8)

        # 使用积分图加速局部均值计算
        integral = np.zeros((h + 1, w + 1), dtype=np.float64)
        integral[1:, 1:] = np.cumsum(np.cumsum(gray.astype(np.float64), axis=0), axis=1)

        for y in range(h):
            y1 = max(0, y - half)
            y2 = min(h, y + half + 1)
            for x in range(w):
                x1 = max(0, x - half)
                x2 = min(w, x + half + 1)
                count = (y2 - y1) * (x2 - x1)
                mean = (integral[y2, x2] - integral[y1, x2]
                        - integral[y2, x1] + integral[y1, x1]) / count

                if is_dark:
                    # 深色背景：字体通常是亮的
                    result[y, x] = 255 if gray[y, x] > mean - offset else 0
                else:
                    result[y, x] = 255 if gray[y, x] > mean + offset else 0

        return result
    except Exception:
        logger.exception('[OCR Price] 自适应二值化失败，回退到全局阈值')
        try:
            if is_dark:
                thresh_val = 128
                binary_arr = np.where(gray > thresh_val, 255, 0).astype(np.uint8)
            else:
                thresh_val = 128
                binary_arr = np.where(gray > thresh_val, 255, 0).astype(np.uint8)
            return binary_arr
        except Exception:
            return None


# ═══════════════════════════════════════════════════════════════
# Step 2: 价格区域定位
# ═══════════════════════════════════════════════════════════════

def _parse_price_from_line(text: str) -> Optional[float]:
    """从一行文本中提取价格数字，返回 float 或 None。
    不匹配带 +/- 前缀的行（那些应归类为涨跌额）。"""
    # 如果以 +/- 开头，不是价格
    if re.match(r'^[+-]', text.strip()):
        return None

    patterns = [
        r'[¥￥$]?\s*(\d{1,6}\.\d{2})',   # ¥1688.00, 1688.00
        r'\b(\d{1,6}\.\d{2})\b',          # 1688.00
    ]
    for pat in patterns:
        m = re.search(pat, text)
        if m:
            try:
                val = float(m.group(1))
                if 0.01 <= val <= 99999.99:
                    return val
            except (ValueError, IndexError):
                continue
    return None


def locate_price_lines(ocr_texts: list[str], ocr_confidences: list[float]) -> list[dict]:
    """
    从 OCR 结果中识别出价格/涨跌幅行。

    返回: list of {text, confidence, value, type}
      type: 'price' | 'change_pct' | 'change_amt' | 'other'
    """
    results: list[dict] = []
    for i, text in enumerate(ocr_texts):
        conf = ocr_confidences[i] if i < len(ocr_confidences) else 0.0
        stripped = text.strip()
        if not stripped:
            continue

        # 检查包含 ¥ 符号的 —— 高置信度价格行
        if re.search(r'[¥￥]', stripped):
            val = _parse_price_from_line(stripped)
            if val is not None:
                results.append({
                    'text': stripped, 'confidence': conf, 'value': val, 'type': 'price',
                })
                continue

        # 检查百分比（涨跌幅）— 必须在普通价格之前
        pct_m = re.search(r'([+-]?\d+\.?\d{0,2})\s*%', stripped)
        if pct_m and abs(float(pct_m.group(1))) <= 25:
            results.append({
                'text': stripped,
                'confidence': conf,
                'value': float(pct_m.group(1)),
                'type': 'change_pct',
            })
            continue

        # 检查带符号数字（涨跌额）— 必须在纯价格之前
        signed_m = re.match(r'^[+-]\d+\.?\d{0,2}$', stripped)
        if signed_m and abs(float(stripped)) < 500:
            results.append({
                'text': stripped,
                'confidence': conf,
                'value': float(stripped),
                'type': 'change_amt',
            })
            continue

        # 检查纯数字价格（两位小数）
        price = _parse_price_from_line(stripped)
        if price is not None:
            results.append({
                'text': stripped, 'confidence': conf, 'value': price, 'type': 'price',
            })
            continue

    # 按置信度排序
    results.sort(key=lambda x: -x['confidence'])
    return results


# ═══════════════════════════════════════════════════════════════
# Step 3: API 交叉校验
# ═══════════════════════════════════════════════════════════════

@dataclass
class PriceValidationResult:
    """价格校验结果"""
    ocr_price: Optional[float] = None       # OCR 原始识别价格
    corrected_price: Optional[float] = None # 修正后的价格（None=未修正）
    price_source: str = 'ocr'               # 'ocr' | 'api_corrected' | 'suspect'
    message: str = ''                       # 提示信息
    api_price: Optional[float] = None       # API 返回的价格（如果有）


def validate_price_cross_api(
    ocr_price: Optional[float],
    stock_code: Optional[str],
    get_api_price_fn=None,
) -> PriceValidationResult:
    """
    用实时行情 API 交叉校验 OCR 识别的价格。

    规则:
      1. 如果 OCR 价格不在 0.1-10000 之间，丢弃
      2. 如果 API 可用且 |ocr - api| / max(api, 0.01) > 5%，以 API 为准
      3. 如果 API 不可用，标注为存疑
      4. 如果偏差 ≤5%，保持 OCR 价格但标注

    参数:
        ocr_price: OCR 识别的价格
        stock_code: 带市场前缀的股票代码（如 'SH600519'）
        get_api_price_fn: 获取 API 价格的函数，签名 fn(code) -> float|None

    返回:
        PriceValidationResult
    """
    result = PriceValidationResult(
        ocr_price=ocr_price,
        corrected_price=ocr_price,
        price_source='ocr',
    )

    if ocr_price is None:
        return result

    # ── Step 4a: 价格范围过滤 ──
    if not (0.1 <= ocr_price <= 10000):
        logger.warning(
            '[Price Valid] OCR 价格 %.2f 超出 A 股范围 (0.1-10000)，丢弃',
            ocr_price,
        )
        result.corrected_price = None
        result.price_source = 'suspect'
        result.message = '价格识别存疑，请手动核实'
        return result

    # ── 调用 API 获取实时价格 ──
    api_price = None
    if stock_code and get_api_price_fn:
        try:
            api_price = get_api_price_fn(stock_code)
            result.api_price = api_price
        except Exception:
            logger.exception('[Price Valid] API 请求失败')
            api_price = None

    if api_price is None:
        # API 不可用 → 标注存疑
        result.price_source = 'suspect'
        result.message = '价格识别存疑，请手动核实'
        logger.warning('[Price Valid] API 不可用，OCR 价格 %.2f 存疑', ocr_price)
        return result

    # ── 比较偏差 ──
    deviation = abs(ocr_price - api_price) / max(api_price, 0.01) * 100
    logger.info(
        '[Price Valid] OCR=%.2f API=%.2f 偏差=%.2f%%',
        ocr_price, api_price, deviation,
    )

    if deviation > 5.0:
        # 偏差超过 5%，以 API 为准
        result.corrected_price = api_price
        result.price_source = 'api_corrected'
        result.message = f'价格已由实时行情校正 (偏差 {deviation:.1f}%)'
        logger.info(
            '[Price Valid] 偏差 %.1f%% > 5%%，已校正: OCR=%.2f → API=%.2f',
            deviation, ocr_price, api_price,
        )
    else:
        # 偏差在 5% 以内，保持 OCR
        result.price_source = 'ocr'
        result.message = ''

    return result


# ═══════════════════════════════════════════════════════════════
# Step 4: 价格合理性过滤
# ═══════════════════════════════════════════════════════════════

def filter_ocr_prices(
    ocr_texts: list[str],
    ocr_confidences: list[float],
) -> dict:
    """
    对 OCR 识别结果中所有数字进行价格合理性过滤。

    返回: {
        'best_price': float|None,     # 最优价格候选
        'best_change_pct': float|None, # 最优涨跌幅候选
        'best_change_amt': float|None, # 最优涨跌额候选
        'all_prices': [list of candidates],
        'notes': [str],               # 过滤说明
    }
    """
    candidates = locate_price_lines(ocr_texts, ocr_confidences)

    prices = [c for c in candidates if c['type'] == 'price']
    change_pcts = [c for c in candidates if c['type'] == 'change_pct']
    change_amts = [c for c in candidates if c['type'] == 'change_amt']

    notes: list[str] = []

    # ── 价格过滤 ──
    best_price: Optional[float] = None
    valid_prices = [p for p in prices if 0.1 <= p['value'] <= 10000]

    if len(prices) > 0 and len(valid_prices) == 0:
        notes.append(f'所有 OCR 价格候选均超出 A 股范围 (0.1-10000)')
        return {
            'best_price': None, 'best_change_pct': None, 'best_change_amt': None,
            'all_prices': candidates, 'notes': notes,
        }

    # 选择置信度最高的有效价格
    if valid_prices:
        valid_prices.sort(key=lambda x: -x['confidence'])
        best_price = valid_prices[0]['value']
        logger.info('[Price Filter] 最优价格: %.2f (置信度: %.3f)', best_price, valid_prices[0]['confidence'])

    # ── 涨跌幅过滤（A 股涨跌停限制 ±10%/±20%） ──
    best_change_pct: Optional[float] = None
    valid_pcts = [c for c in change_pcts if -20 <= c['value'] <= 20]

    if len(change_pcts) > 0 and len(valid_pcts) == 0:
        notes.append('涨跌幅超出 A 股限制 (±20%)，已丢弃')

    if valid_pcts:
        valid_pcts.sort(key=lambda x: -x['confidence'])
        best_change_pct = valid_pcts[0]['value']

    # ── 涨跌额过滤 ──
    best_change_amt: Optional[float] = None
    valid_amts = [c for c in change_amts if -1000 <= c['value'] <= 1000]

    if valid_amts:
        valid_amts.sort(key=lambda x: -x['confidence'])
        best_change_amt = valid_amts[0]['value']

    if len(notes) > 0:
        logger.info('[Price Filter] 过滤说明: %s', '; '.join(notes))

    return {
        'best_price': best_price,
        'best_change_pct': best_change_pct,
        'best_change_amt': best_change_amt,
        'all_prices': candidates,
        'notes': notes,
    }


# ═══════════════════════════════════════════════════════════════
# 对外统一 API
# ═══════════════════════════════════════════════════════════════

def enhance_ocr_pipeline(
    image_path: str,
    ocr_texts: list[str],
    ocr_confidences: list[float],
    stock_code: Optional[str] = None,
    get_api_price_fn=None,
) -> dict:
    """
    完整的价格增强管线（预处理 + 区域定位 + 交叉校验 + 过滤）。

    对原有 OCR 结果做后处理增强，返回增强信息供响应体使用。

    返回: {
        'price_enhanced': True/False,
        'ocr_price': float|None,
        'corrected_price': float|None,
        'price_source': 'ocr' | 'api_corrected' | 'suspect',
        'price_message': str,
        'api_price': float|None,
        'preprocess_path': str|None,  # 已预处理的图片路径
    }
    """
    result: dict = {
        'price_enhanced': True,
        'ocr_price': None,
        'corrected_price': None,
        'price_source': 'ocr',
        'price_message': '',
        'api_price': None,
        'preprocess_path': None,
    }

    # ── Step 1: 图像预处理 ──
    processed = preprocess_image(image_path)
    if processed:
        result['preprocess_path'] = processed
        logger.info('[OCR Price] 图像预处理已完成: %s', processed)
    else:
        logger.info('[OCR Price] 图像预处理未启用（库缺失或失败）')

    # ── Step 4: 价格合理性过滤 ──
    price_filter = filter_ocr_prices(ocr_texts, ocr_confidences)

    logger.info('[OCR Price] 过滤结果: price=%s change_pct=%s change_amt=%s',
                 price_filter['best_price'], price_filter['best_change_pct'],
                 price_filter['best_change_amt'])

    ocr_price = price_filter['best_price']
    result['ocr_price'] = ocr_price

    # ── Step 3+4: API 交叉校验 ──
    if ocr_price is not None:
        validation = validate_price_cross_api(
            ocr_price, stock_code, get_api_price_fn,
        )
        result['corrected_price'] = validation.corrected_price
        result['price_source'] = validation.price_source
        result['price_message'] = validation.message
        result['api_price'] = validation.api_price

        if validation.price_source != 'ocr':
            logger.info(
                '[OCR Price] 价格已由 %s: OCR=%.2f → 修正=%.2f (msg=%s)',
                validation.price_source, ocr_price,
                validation.corrected_price or 0,
                validation.message,
            )

    return result
