"""
SnapVision AI Vision Server — Flask + PaddleOCR + DeepSeek Vision

双引擎股票截图识别:
  - 默认引擎: PaddleOCR + 本地规则解析（无需 API Key）
  - 增强引擎: DeepSeek 视觉模型（可选，配置 DEEPSEEK_API_KEY 后自动启用）

环境变量:
    DEEPSEEK_API_KEY  — DeepSeek API Key (可选，配置后可启用 AI 增强分析)
    OCR_PORT          — 监听端口 (默认 5002)
"""

import base64
import json
import os
import sys
import time
import logging
import tempfile
import traceback
import threading
import urllib.request
import urllib.error

from flask import Flask, request, jsonify, g

# ─── Stock Parser ────────────────────────────────────────────
from stock_parser import parse_stock_info
from ocr_price import enhance_ocr_pipeline

# ─── PaddleOCR 本地引擎 ────────────────────────────────────
from paddle_ocr_engine import run_paddle_ocr

# ─── History Module ──────────────────────────────────────────
from history.history_service import HistoryService
from history import DB_PATH

_history_service: HistoryService | None = None


def get_history_service() -> HistoryService:
    global _history_service
    if _history_service is None:
        _history_service = HistoryService()
    return _history_service

# ─── Market Data Module ──────────────────────────────────────
from services.market_data.market_service import MarketDataService
from services.market_data.stock_api import get_stock_api

_market_service: MarketDataService | None = None


def get_market_service() -> MarketDataService:
    global _market_service
    if _market_service is None:
        _market_service = MarketDataService()
    return _market_service

# ─── 配置 ──────────────────────────────────────────────────────
DEEPSEEK_API_KEY = os.environ.get('DEEPSEEK_API_KEY', '')
DEEPSEEK_MODEL = os.environ.get('DEEPSEEK_MODEL', 'deepseek-chat')
OCR_PORT = int(os.environ.get('OCR_PORT', 5002))
HOST = '127.0.0.1'
DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions'

logging.basicConfig(
    level=logging.INFO,
    format='[AI Vision] %(asctime)s %(levelname)s %(message)s',
    datefmt='%H:%M:%S',
)
logger = logging.getLogger(__name__)

app = Flask(__name__)

# ─── 请求计时 ──────────────────────────────────────────────────

@app.before_request
def before_request():
    g.req_start = time.time()
    g.req_path = request.path
    g.req_method = request.method
    body_info = ''
    if request.is_json:
        data = request.get_json(silent=True) or {}
        if 'image_path' in data:
            body_info = f' image_path={data["image_path"]}'
        elif 'stock_code' in data:
            body_info = f' stock_code={data["stock_code"]}'
    logger.info('>>> [%s %s]%s', request.method, request.path, body_info)


@app.after_request
def after_request(response):
    elapsed = time.time() - g.get('req_start', time.time())
    resp_body_size = len(response.get_data() or b'')
    logger.info('<<< [%s %s] elapsed=%dms size=%dbytes status=%d',
                 g.get('req_method', '?'), g.get('req_path', '?'),
                 round(elapsed * 1000), resp_body_size, response.status_code)
    try:
        response.headers['Server-Timing'] = f'total;dur={round(elapsed * 1000)}'
    except Exception:
        pass
    return response


# ─── DeepSeek Vision API ────────────────────────────────────────

def _call_deepseek_vision(image_path: str = None, image_base64: str = None, image_data: str = None) -> dict:
    """调用 DeepSeek 视觉模型识别截图中的股票信息。

    支持 image_path（文件路径）或 image_base64（base64 字符串）两种入参。
    image_data 保留作向后兼容。

    启用 stream=True 流式响应，边接收边解析，一旦拿到完整 JSON 立即返回（不等全部 token 到齐）。

    返回: {success: True, data: {...}}
           {success: False, error: "错误信息"}
    """
    if not DEEPSEEK_API_KEY:
        return {'success': False, 'error': 'DEEPSEEK_API_KEY 未配置，请在环境变量中设置'}

    # ── 获取图片 base64 ──
    image_base64 = image_base64 or image_data
    if image_base64:
        image_label = 'base64_data'
    elif image_path:
        try:
            with open(image_path, 'rb') as f:
                raw = f.read()
            image_base64 = base64.b64encode(raw).decode('utf-8')
            image_label = image_path
        except FileNotFoundError:
            return {'success': False, 'error': f'图片文件不存在: {image_path}'}
        except Exception:
            return {'success': False, 'error': '图片读取失败'}
    else:
        return {'success': False, 'error': '需要 image_path 或 image_base64 参数'}

    # 检测图片格式：如果 base64 前几个字节是 PNG header，用 png；其余用 jpeg
    # 压缩后统一为 JPEG，但为了兼容保留自动检测
    if len(image_base64) > 20:
        raw_start = base64.b64decode(image_base64[:28])
        is_png = raw_start[:4] == b'\x89PNG'
    else:
        is_png = False
    mime = 'image/png' if is_png else 'image/jpeg'

    payload = {
        'model': DEEPSEEK_MODEL,
        'max_tokens': 500,
        'temperature': 0.01,
        'stream': True,
        'messages': [
            {
                'role': 'user',
                'content': [
                    {
                        'type': 'image_url',
                        'image_url': {'url': f'data:{mime};base64,{image_base64}'},
                    },
                    {
                        'type': 'text',
                        'text': (
                            '从截图中提取股票信息，只返回JSON，不要任何解释：\n'
                            '{\n'
                            '  "code": "股票代码如SZ002851或SH600519",\n'
                            '  "name": "股票名称",\n'
                            '  "price": 当前价格数字,\n'
                            '  "change": 涨跌额数字,\n'
                            '  "change_pct": "涨跌幅如-4.43%",\n'
                            '  "open": 今开,\n'
                            '  "high": 最高,\n'
                            '  "low": 最低,\n'
                            '  "prev_close": 昨收,\n'
                            '  "volume": "成交量",\n'
                            '  "amount": "成交额"\n'
                            '}\n'
                            '若无股票信息返回 {"error": "未找到股票信息"}'
                        ),
                    },
                ],
            }
        ],
    }

    req_body = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(
        DEEPSEEK_URL,
        data=req_body,
        headers={
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {DEEPSEEK_API_KEY}',
        },
        method='POST',
    )

    logger.info('[DeepSeek] 正在调用视觉模型识别: %s (stream=True)', image_label)
    t0 = time.time()

    try:
        # ── 流式读取 SSE 响应 ──
        accumulated = ''
        last_valid_result = None
        with urllib.request.urlopen(req, timeout=60) as resp:
            buf = ''
            while True:
                chunk = resp.read(1024)
                if not chunk:
                    break
                buf += chunk.decode('utf-8', errors='replace')
                # 按行处理 SSE events
                while '\n' in buf:
                    line, buf = buf.split('\n', 1)
                    line = line.strip()
                    if not line:
                        continue
                    if line.startswith('data: '):
                        data_str = line[6:]
                        if data_str == '[DONE]':
                            break
                        try:
                            sse = json.loads(data_str)
                            delta = sse.get('choices', [{}])[0].get('delta', {})
                            if 'content' in delta:
                                accumulated += delta['content']
                                # 尝试提前解析 JSON
                                cleaned = accumulated.replace('```json', '').replace('```', '').strip()
                                if cleaned.startswith('{') and '}' in cleaned:
                                    try:
                                        result = json.loads(cleaned)
                                        # 一旦拿到 code 和 name 就认为足够了
                                        if result.get('code') and result.get('name') is not None:
                                            last_valid_result = result
                                            # 继续读取少量确保 price 也到齐
                                    except json.JSONDecodeError:
                                        pass
                        except json.JSONDecodeError:
                            pass
                # 检查是否已拿到足够数据
                if last_valid_result and 'price' in last_valid_result:
                    break

        elapsed = round((time.time() - t0) * 1000)
        logger.info('[DeepSeek] 识别完成, 耗时 %dms', elapsed)
    except urllib.error.HTTPError as e:
        error_body = e.read().decode('utf-8', errors='replace')
        logger.error('[DeepSeek] HTTP %d: %s', e.code, error_body)
        return {'success': False, 'error': f'DeepSeek API 返回 {e.code}'}
    except urllib.error.URLError as e:
        logger.error('[DeepSeek] 网络错误: %s', e.reason)
        return {'success': False, 'error': 'DeepSeek API 网络请求失败'}
    except Exception as e:
        logger.exception('[DeepSeek] 请求异常')
        return {'success': False, 'error': f'DeepSeek API 请求异常: {str(e)}'}

    # ── 解析最终内容 ──
    if last_valid_result:
        result = last_valid_result
        logger.info('[DeepSeek] 提前解析命中, code=%s', result.get('code'))
    else:
        content = accumulated
        if not content.strip():
            return {'success': False, 'error': 'DeepSeek 返回内容为空'}
        cleaned = content.replace('```json', '').replace('```', '').strip()
        try:
            result = json.loads(cleaned)
        except json.JSONDecodeError:
            logger.error('[DeepSeek] 内容不是合法 JSON: %.500s', cleaned)
            return {'success': False, 'error': 'DeepSeek 返回内容解析失败'}

    return {'success': True, 'data': result, 'elapsed_ms': elapsed}


# ─── API ───────────────────────────────────────────────────────

@app.route('/health', methods=['GET'])
def health():
    """健康检查 — 服务启动即就绪，无模型加载等待"""
    return jsonify({
        'status': 'ok',
        'ready': True,
        'deepseek_configured': bool(DEEPSEEK_API_KEY),
        'paddleocr_available': True,
    })


@app.route('/stock-extract', methods=['POST'])
def stock_extract():
    """股票信息提取 — PaddleOCR → 本地解析 → (可选) DeepSeek AI 增强 → API 校验

    双引擎流水线:
      1. PaddleOCR 本地识别 → OCR 文本行（始终运行）
      2. 本地规则解析器 → 基础结构化数据（始终运行）
      3. DeepSeek Vision AI 增强（仅在配置 DEEPSEEK_API_KEY 时运行）
      4. API 交叉校验价格

    请求体 (Base64 模式): {"image_base64": "<base64字符串>"}
    请求体 (文件模式):    {"image_path": "/path/to/screenshot.png"}
    响应:                 结构化股票数据 JSON

    兼容性说明: 同时支持 image_base64 / image_data 作为 base64 字段名。
    """
    data = request.get_json(silent=True)
    if not data:
        return jsonify({'success': False, 'error': '缺少请求参数'}), 400

    image_path = data.get('image_path')
    image_base64 = data.get('image_base64') or data.get('image_data')

    if not image_path and not image_base64:
        return jsonify({'success': False, 'error': '需要 image_base64 或 image_path 参数'}), 400

    if image_base64 and isinstance(image_base64, str) and len(image_base64) > 20 * 1024 * 1024:
        return jsonify({'success': False, 'error': 'image_base64 大小超过限制（最大 20MB）'}), 400

    if image_path:
        if not isinstance(image_path, str) or not image_path.strip():
            return jsonify({'success': False, 'error': 'image_path 必须是有效路径'}), 400
        image_path = os.path.abspath(image_path)
        allowed_dirs = [os.path.expanduser('~'), '/tmp', tempfile.gettempdir()]
        if not any(image_path.startswith(d) for d in allowed_dirs):
            logger.warning('[stock-extract] 路径不在允许的目录中: %s', image_path)
            return jsonify({'success': False, 'error': '路径不在允许的目录中'}), 403
        if not os.path.isfile(image_path):
            logger.warning('[stock-extract] 文件不存在 %s', image_path)
            return jsonify({'success': False, 'error': f'文件不存在: {image_path}'}), 404

    pipeline_start = time.time()
    step_times: dict[str, int] = {}

    try:
        # ══════════════════════════════════════════════════════
        # Step 1: PaddleOCR 本地识别（始终运行）
        # ══════════════════════════════════════════════════════
        logger.info('[stock-extract] ════ PaddleOCR start ════')
        t0 = time.time()
        if image_base64:
            ocr_result = run_paddle_ocr(image_base64=image_base64)
        else:
            ocr_result = run_paddle_ocr(image_path=image_path)
        step_times['ocr_ms'] = round((time.time() - t0) * 1000)

        if not ocr_result['success']:
            error_msg = ocr_result.get('error', 'OCR 识别失败')
            logger.error('[stock-extract] PaddleOCR 识别失败: %s', error_msg)
            return jsonify({'success': False, 'error': f'OCR 识别失败: {error_msg}'}), 500

        raw_texts_all: list[str] = ocr_result.get('texts', [])
        raw_confidences_all: list[float] = ocr_result.get('confidences', [])
        logger.info('[stock-extract] ════ PaddleOCR end ════ %dms, 文本行数=%d',
                     step_times['ocr_ms'], len(raw_texts_all))

        # ══════════════════════════════════════════════════════
        # Step 2: 本地规则解析基础数据
        # ══════════════════════════════════════════════════════
        t0 = time.time()
        parsed_local = parse_stock_info(raw_texts_all)
        step_times['parse_ms'] = round((time.time() - t0) * 1000)
        logger.info('[stock-extract] 本地解析完成: %dms, code=%s name=%s',
                     step_times['parse_ms'],
                     parsed_local.get('stock_code'), parsed_local.get('stock_name'))

        # ── 从本地解析结果提取字段 ──
        stock_code_raw = parsed_local.get('stock_code') or ''
        stock_name = parsed_local.get('stock_name')
        current_price = parsed_local.get('current_price')

        # 检查是否识别到股票信息
        if not stock_code_raw or not stock_name:
            logger.info('[stock-extract] 本地未识别到股票信息')
            return jsonify({
                'success': True,
                'error': '未识别到股票信息',
                'stock_name': stock_name,
                'stock_code': stock_code_raw,
                'current_price': str(current_price) if current_price else None,
                'has_stock_data': False,
                'ai_enhanced': False,
                'recognition_source': 'paddle_ocr',
            })

        # ══════════════════════════════════════════════════════
        # Step 3: (可选) DeepSeek Vision AI 增强
        # ══════════════════════════════════════════════════════
        ai_enhanced = False
        parsed_ai = None
        if DEEPSEEK_API_KEY:
            logger.info('[stock-extract] ════ DeepSeek Vision AI 增强 start ════')
            t0 = time.time()
            if image_base64:
                vision_result = _call_deepseek_vision(image_base64=image_base64)
            else:
                vision_result = _call_deepseek_vision(image_path=image_path)
            step_times['vision_ms'] = round((time.time() - t0) * 1000)

            if vision_result['success']:
                parsed_ai = vision_result.get('data', {})
                if parsed_ai and parsed_ai.get('code') and parsed_ai.get('name'):
                    ai_enhanced = True
                    logger.info('[stock-extract] AI 增强成功: code=%s name=%s, %dms',
                                 parsed_ai.get('code'), parsed_ai.get('name'),
                                 step_times.get('vision_ms', 0))
                else:
                    logger.warning('[stock-extract] AI 未识别到有效股票数据，保留本地结果')
            else:
                logger.warning('[stock-extract] AI 增强失败 (保留本地结果): %s',
                               vision_result.get('error', ''))
        else:
            logger.info('[stock-extract] AI 增强未启用（未配置 DEEPSEEK_API_KEY）')

        # ── 合并结果：AI 数据优先（更精确）──
        if ai_enhanced and parsed_ai:
            stock_code_raw = parsed_ai.get('code', stock_code_raw)
            stock_name = parsed_ai.get('name', stock_name)
            current_price_ai = parsed_ai.get('price')
            change_pct = parsed_ai.get('change_pct')
            change_amt = parsed_ai.get('change')
            open_price = parsed_ai.get('open')
            high = parsed_ai.get('high')
            low = parsed_ai.get('low')
            prev_close = parsed_ai.get('prev_close')
            volume = parsed_ai.get('volume')
            turnover = parsed_ai.get('amount')
        else:
            # 使用本地解析的字段
            change_pct = parsed_local.get('change_percent')
            change_amt = parsed_local.get('change_amount')
            open_price = parsed_local.get('open')
            high = parsed_local.get('high')
            low = parsed_local.get('low')
            prev_close = None  # parser 不返回 prev_close
            volume = parsed_local.get('volume')
            turnover = parsed_local.get('turnover')

        # 格式化价格字符串
        # current_price 来自本地解析时已是 str，来自 AI 时是 float
        if ai_enhanced and parsed_ai and parsed_ai.get('price') is not None:
            current_price_val = parsed_ai['price']
            current_price_str = f'{current_price_val:.2f}'
        elif current_price is not None:
            current_price_str = str(current_price)
        else:
            current_price_str = None

        def _fmt_price(val) -> str | None:
            if val is None:
                return None
            try:
                return f'{float(val):.2f}'
            except (ValueError, TypeError):
                return str(val)

        price_str = _fmt_price(current_price_val if (ai_enhanced and parsed_ai and parsed_ai.get('price') is not None) else current_price)
        open_str = _fmt_price(open_price)
        high_str = _fmt_price(high)
        low_str = _fmt_price(low)
        prev_close_str = _fmt_price(prev_close)
        change_pct_str = str(change_pct) if change_pct else None
        change_amt_str = _fmt_price(change_amt)

        has_data = bool(stock_code_raw and stock_name)

        # ══════════════════════════════════════════════════════
        # Step 4: API 交叉校验价格
        # ══════════════════════════════════════════════════════
        t_price = time.time()
        price_enhance_result = enhance_ocr_pipeline(
            image_path=image_path,
            ocr_texts=raw_texts_all,
            ocr_confidences=raw_confidences_all,
            stock_code=stock_code_raw,
            get_api_price_fn=lambda code: (
                get_stock_api().getRealtimeQuote(code).get('price')
            ),
        )
        step_times['price_enhance_ms'] = round((time.time() - t_price) * 1000)

        # 应用价格校正
        final_price = price_str
        price_source = price_enhance_result.get('price_source', 'ocr')
        if price_source == 'api_corrected':
            corrected = price_enhance_result.get('corrected_price')
            if corrected is not None:
                final_price = f'{corrected:.2f}'
                logger.info('[stock-extract] 价格已校正: OCR=%s → API=%.2f',
                             price_str, corrected)

        # 确定识别来源标签
        if ai_enhanced:
            recognition_source = 'ai_enhanced' if price_source != 'api_corrected' else 'api_corrected'
        else:
            recognition_source = 'paddle_ocr'

        sync_ms = round((time.time() - pipeline_start) * 1000)
        logger.info('[stock-extract] 同步阶段完成 | '
                     'OCR: %d ms | Parse: %d ms | Vision: %d ms | PriceEnh: %d ms | Total: %d ms',
                     step_times.get('ocr_ms', 0),
                     step_times.get('parse_ms', 0),
                     step_times.get('vision_ms', 0),
                     step_times.get('price_enhance_ms', 0),
                     sync_ms)

        response = {
            'success': True,
            'ai_enhanced': ai_enhanced,
            'stock_name': stock_name,
            'stock_code': stock_code_raw,
            'current_price': final_price,
            'change_percent': change_pct_str,
            'change_amount': change_amt_str,
            'open': open_str,
            'high': high_str,
            'low': low_str,
            'prev_close': prev_close_str,
            'volume': str(volume) if volume else None,
            'turnover': str(turnover) if turnover else None,
            'has_stock_data': has_data,
            'low_confidence_warning': False,
            'confidence_warnings': [],
            'recognition_source': recognition_source,
            'price_source': price_source,
            'price_original': price_enhance_result.get('ocr_price'),
            'price_corrected': price_enhance_result.get('corrected_price'),
            'price_message': price_enhance_result.get('price_message', ''),
            '_ocr_meta': {
                'ocr_ms': step_times.get('ocr_ms', 0),
                'parse_ms': step_times.get('parse_ms', 0),
                'vision_ms': step_times.get('vision_ms', 0),
                'price_enhance_ms': step_times.get('price_enhance_ms', 0),
                'total_ms': sync_ms,
            },
        }

        if ai_enhanced and parsed_ai:
            response['_vision_raw'] = parsed_ai

        # ══════════════════════════════════════════════════════
        # 异步阶段：后台预取行情数据（历史保存由前端触发）
        # ══════════════════════════════════════════════════════
        _stock_code = str(stock_code_raw) if stock_code_raw else None

        def _background_tasks():
            bg_start = time.time()
            logger.info('[stock-extract] ──── Background start (market pre-fetch only) ────')
            # History 保存已移至前端触发 — 见 App.tsx saveHistory()
            if _stock_code:
                try:
                    t0 = time.time()
                    quote = get_market_service().fetch(_stock_code)
                    mkt_ms = round((time.time() - t0) * 1000)
                    if quote.available:
                        logger.info('[stock-extract] Market end: source=%s price=%.2f, %dms',
                                     quote.source, quote.current_price or 0, mkt_ms)
                except Exception:
                    logger.error('[stock-extract] 后台行情预取异常:\n%s', traceback.format_exc())

            bg_elapsed = round((time.time() - bg_start) * 1000)
            logger.info('[stock-extract] ──── Background end ──── Total: %dms', bg_elapsed)

        thread = threading.Thread(target=_background_tasks, daemon=True)
        thread.start()

        return jsonify(response)

    except Exception:
        logger.error('[stock-extract] 管道异常: %s', traceback.format_exc())
        return jsonify({
            'success': False,
            'error': '股票识别过程发生异常',
        }), 500


# ══════════════════════════════════════════════════════════════
# Market Data API — 实时行情查询
# ══════════════════════════════════════════════════════════════

@app.route('/market-data', methods=['POST'])
def market_data():
    """实时行情查询"""
    data = request.get_json(silent=True)
    if not data or 'stock_code' not in data:
        return jsonify({'success': False, 'error': '缺少 stock_code 参数'}), 400

    stock_code = data['stock_code']
    if not isinstance(stock_code, str) or not stock_code.strip():
        return jsonify({'success': False, 'error': 'stock_code 必须是有效字符串'}), 400

    stock_code = stock_code.strip().upper()

    try:
        t0 = time.time()
        quote = get_market_service().fetch(stock_code)
        elapsed_ms = round((time.time() - t0) * 1000)
        logger.info('[market-data] code=%s source=%s available=%s elapsed=%dms',
                     stock_code, quote.source, quote.available, elapsed_ms)
    except Exception:
        logger.error('[market-data] 查询异常 code=%s\n%s', stock_code, traceback.format_exc())
        return jsonify({
            'success': True, 'stock_code': stock_code,
            'available': False, 'source': 'fallback',
            'message': '实时行情获取失败',
        })

    response = {
        'success': True,
        'stock_name': quote.stock_name,
        'stock_code': quote.stock_code or stock_code,
        'current_price': quote.current_price,
        'change_percent': quote.change_percent,
        'change_amount': quote.change_amount,
        'open': quote.open,
        'high': quote.high,
        'low': quote.low,
        'volume': quote.volume,
        'turnover': quote.turnover,
        'turnover_rate': quote.turnover_rate,
        'source': quote.source,
        'available': quote.available,
    }

    if not quote.available:
        response['message'] = '实时行情获取失败，当前分析基于截图识别结果'

    return jsonify(response)


# ─── Limit Analysis ──────────────────────────────────────────
from limit_analysis import analyse_all

@app.route('/stock-analysis', methods=['POST'])
def stock_limit_analysis():
    """涨跌停分析 — 基于实时行情 + K 线数据

    请求体: {
        "stock_code": "SH600519",
        "stock_name": "贵州茅台",
        "price": 1688.00,
        "prev_close": 1660.00,
        "turnover_rate": 0.38,
        "amplitude": 2.15,
    }

    响应: 包含 st_status / limit / consecutive / breakout / summary
    """
    data = request.get_json(silent=True)
    if not data or 'stock_code' not in data:
        return jsonify({'success': False, 'error': '缺少 stock_code 参数'}), 400

    stock_code = data['stock_code']
    if not isinstance(stock_code, str):
        return jsonify({'success': False, 'error': 'stock_code 必须是字符串'}), 400
    stock_code = stock_code.strip().upper()
    stock_name = data.get('stock_name', '')

    # Try to fetch live market data for more complete analysis
    try:
        quote = get_market_service().fetch(stock_code)
        if quote.available:
            stock_name = stock_name or quote.stock_name or ''
            price = quote.current_price
            prev_close = quote.prev_close
            turnover_rate = quote.turnover_rate
            amplitude = quote.amplitude
        else:
            price = data.get('price')
            prev_close = data.get('prev_close')
            turnover_rate = data.get('turnover_rate')
            amplitude = data.get('amplitude')
    except Exception:
        price = data.get('price')
        prev_close = data.get('prev_close')
        turnover_rate = data.get('turnover_rate')
        amplitude = data.get('amplitude')

    # Try to fetch daily K-line data
    daily_bars = []
    try:
        from services.market_data.stock_api import get_stock_api
        kline_result = get_stock_api().getKlineData(stock_code, 'daily', 30)
        if 'bars' in kline_result and not kline_result.get('error'):
            daily_bars = kline_result['bars']
    except Exception:
        pass

    try:
        result = analyse_all(
            stock_code=stock_code,
            stock_name=stock_name,
            price=price,
            prev_close=prev_close,
            daily_bars=daily_bars,
            turnover_rate=turnover_rate,
            amplitude=amplitude,
        )
        return jsonify({'success': True, **result})
    except Exception:
        logger.exception('[stock-analysis] 分析异常')
        return jsonify({'success': False, 'error': '涨跌停分析异常'}), 500


# ══════════════════════════════════════════════════════════════
# StockAPI — 统一股票数据 API
# ══════════════════════════════════════════════════════════════

@app.route('/stock-api/realtime', methods=['POST'])
def stock_api_realtime():
    data = request.get_json(silent=True)
    if not data or 'code' not in data:
        return jsonify({'success': False, 'error': '缺少 code 参数'}), 400
    code = data['code']
    api = get_stock_api()
    result = api.getRealtimeQuote(code)
    return jsonify({'success': 'error' not in result, **result})


@app.route('/stock-api/kline', methods=['POST'])
def stock_api_kline():
    data = request.get_json(silent=True)
    if not data or 'code' not in data:
        return jsonify({'success': False, 'error': '缺少 code 参数'}), 400
    code = data['code']
    period = data.get('period', 'daily')
    try:
        count = int(data.get('count', 30))
        if count < 1 or count > 500:
            count = 30
    except (ValueError, TypeError):
        count = 30
    api = get_stock_api()
    result = api.getKlineData(code, period, count)
    return jsonify({'success': 'error' not in result, **result})


@app.route('/stock-api/search', methods=['POST'])
def stock_api_search():
    data = request.get_json(silent=True)
    if not data or 'keyword' not in data:
        return jsonify({'success': False, 'error': '缺少 keyword 参数'}), 400
    keyword = data['keyword']
    api = get_stock_api()
    result = api.searchStock(keyword)
    return jsonify({'success': 'error' not in result, **result})


# ══════════════════════════════════════════════════════════════
# DeepSeek AI Analysis API — 智能行情分析
# ══════════════════════════════════════════════════════════════

@app.route('/stock-api/ai-analysis', methods=['POST'])
def stock_api_ai_analysis():
    """调用 DeepSeek 生成 AI 行情分析

    请求体: {
        "stock_name": "贵州茅台",
        "stock_code": "SH600519",
        "price": 1688.00,
        "change_pct": "+1.23%",
        "kline_bars": [{"time":"...","open":...,"high":...,"low":...,"close":...,"volume":...}, ...]
    }
    """
    if not DEEPSEEK_API_KEY:
        return jsonify({'success': False, 'error': 'DEEPSEEK_API_KEY 未配置'}), 503

    data = request.get_json(silent=True)
    if not data or 'stock_code' not in data:
        return jsonify({'success': False, 'error': '缺少参数'}), 400

    stock_name = data.get('stock_name', '')
    stock_code = data.get('stock_code', '')
    price = data.get('price', '--')
    change_pct = data.get('change_pct', '--')
    kline_bars = data.get('kline_bars', [])

    # 取最近 K 线数据摘要（避免 token 超限）
    recent_bars = kline_bars[-10:] if len(kline_bars) > 10 else kline_bars
    kline_summary = [
        {'t': b.get('time', '')[-5:], 'o': b.get('open'), 'c': b.get('close'),
         'h': b.get('high'), 'l': b.get('low'), 'v': b.get('volume', 0)}
        for b in recent_bars
    ]

    prompt = (
        f'以下是{stock_name}({stock_code})近期K线数据：{json.dumps(kline_summary, ensure_ascii=False)}\n'
        f'当前价格{price}，涨跌幅{change_pct}。\n'
        f'请用中文给出简短的行情分析，包含：\n'
        f'1. 趋势判断（上涨/下跌/震荡）及依据\n'
        f'2. 关键支撑位和压力位\n'
        f'3. 量能分析（放量/缩量）\n'
        f'4. 综合建议（观望/关注/注意风险）\n'
        f'限100字以内，结尾加：本分析仅供参考，不构成投资建议。'
    )

    payload = {
        'model': DEEPSEEK_MODEL,
        'max_tokens': 200,
        'temperature': 0.3,
        'messages': [{'role': 'user', 'content': prompt}],
    }

    req_body = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(
        DEEPSEEK_URL,
        data=req_body,
        headers={
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {DEEPSEEK_API_KEY}',
        },
        method='POST',
    )

    logger.info('[AI Analysis] 请求 DeepSeek 分析 %s(%s)', stock_name, stock_code)
    t0 = time.time()

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            resp_body = resp.read().decode('utf-8')
        elapsed = round((time.time() - t0) * 1000)
        logger.info('[AI Analysis] 完成, %dms', elapsed)
    except urllib.error.HTTPError as e:
        return jsonify({'success': False, 'error': f'API 错误 {e.code}'}), 502
    except Exception as e:
        return jsonify({'success': False, 'error': f'请求失败: {str(e)}'}), 502

    try:
        api_data = json.loads(resp_body)
        content = api_data['choices'][0]['message']['content']
    except (KeyError, IndexError, json.JSONDecodeError):
        return jsonify({'success': False, 'error': '响应解析失败'}), 502

    return jsonify({
        'success': True,
        'stock_code': stock_code,
        'stock_name': stock_name,
        'analysis': content.strip(),
        'elapsed_ms': elapsed,
    })


# ══════════════════════════════════════════════════════════════
# History API — 历史记录 CRUD + 导出
# ══════════════════════════════════════════════════════════════

@app.route('/history/save', methods=['POST'])
def history_save():
    """
    前端识别完成后主动保存历史记录。
    请求体:
    {
        "image_path": str,
        "stock_code": str,
        "stock_name": str,
        "current_price": str | null,
        "change_percent": str | null,
        "change_amount": str | null,
        "open": str | null,
        "high": str | null,
        "low": str | null,
        "volume": str | null,
        "turnover": str | null,
        "ai_score": float | null,
        "risk_level": str | null,
        "analysis_summary": str | null,
        "raw_ocr_text": str | null,
        "source": str | null
    }
    返回: {"success": true, "id": int, "is_new": bool}
    """
    try:
        data = request.get_json(force=True)
        if not data:
            return jsonify({'success': False, 'error': '请求体为空'}), 400

        result = get_history_service().save_from_frontend(data)
        return jsonify({'success': True, **result})
    except Exception:
        logger.error('POST /history/save 失败\n%s', traceback.format_exc())
        return jsonify({'success': False, 'error': '保存历史记录失败'}), 500


@app.route('/history', methods=['GET'])
def history_list():
    search = request.args.get('search', '').strip() or None
    sort = request.args.get('sort', 'created_at_desc')
    try:
        page = max(1, int(request.args.get('page', '1')))
    except (ValueError, TypeError):
        page = 1
    try:
        page_size = min(100, max(1, int(request.args.get('page_size', '20'))))
    except (ValueError, TypeError):
        page_size = 20
    try:
        result = get_history_service().list_records(
            search=search, sort=sort, page=page, page_size=page_size)
        return jsonify({'success': True, **result})
    except Exception:
        logger.error('GET /history 失败\n%s', traceback.format_exc())
        return jsonify({'success': False, 'error': '查询历史记录失败'}), 500


@app.route('/history/<int:record_id>', methods=['GET'])
def history_detail(record_id: int):
    try:
        record = get_history_service().get_record(record_id)
        if not record:
            return jsonify({'success': False, 'error': '记录不存在'}), 404
        record.pop('_parsed', None)
        return jsonify({'success': True, 'record': record})
    except Exception:
        logger.error('GET /history/%d 失败\n%s', record_id, traceback.format_exc())
        return jsonify({'success': False, 'error': '获取记录失败'}), 500


@app.route('/history/<int:record_id>', methods=['DELETE'])
def history_delete(record_id: int):
    try:
        ok = get_history_service().delete_record(record_id)
        if not ok:
            return jsonify({'success': False, 'error': '记录不存在'}), 404
        return jsonify({'success': True})
    except Exception:
        logger.error('DELETE /history/%d 失败\n%s', record_id, traceback.format_exc())
        return jsonify({'success': False, 'error': '删除失败'}), 500


@app.route('/history', methods=['DELETE'])
def history_clear():
    try:
        count = get_history_service().clear_all()
        return jsonify({'success': True, 'deleted': count})
    except Exception:
        logger.error('DELETE /history 失败\n%s', traceback.format_exc())
        return jsonify({'success': False, 'error': '清空失败'}), 500


@app.route('/history/<int:record_id>/export', methods=['GET'])
def history_export(record_id: int):
    fmt = request.args.get('format', 'md').lower()
    if fmt not in ('md', 'json', 'txt'):
        return jsonify({'success': False, 'error': '不支持的格式'}), 400
    try:
        content = get_history_service().export(record_id, fmt)
        if content is None:
            return jsonify({'success': False, 'error': '记录不存在'}), 404
        content_type_map = {
            'md': 'text/markdown; charset=utf-8',
            'json': 'application/json; charset=utf-8',
            'txt': 'text/plain; charset=utf-8',
        }
        ext_map = {'md': '.md', 'json': '.json', 'txt': '.txt'}
        resp = app.make_response((content, 200))
        resp.headers['Content-Type'] = content_type_map.get(fmt, 'text/plain; charset=utf-8')
        resp.headers['Content-Disposition'] = (
            f'attachment; filename="snapvision-report-{record_id}{ext_map[fmt]}"')
        return resp
    except Exception:
        logger.error('GET /history/%d/export 失败\n%s', record_id, traceback.format_exc())
        return jsonify({'success': False, 'error': '导出失败'}), 500


# ─── 错误处理 ──────────────────────────────────────────────────

@app.errorhandler(404)
def not_found(_e):
    return jsonify({'success': False,
                    'error': '接口不存在（支持: GET /health, POST /stock-extract, POST /market-data, POST /stock-api/*, GET|DELETE /history）'})


@app.errorhandler(500)
def server_error(error):
    logger.error('Server error: %s', traceback.format_exc())
    return jsonify({'success': False, 'error': '服务内部错误'}), 500


# ─── 启动 ──────────────────────────────────────────────────────

if __name__ == '__main__':
    if not DEEPSEEK_API_KEY:
        logger.info('')
        logger.info('═══════════════════════════════════════')
        logger.info('  DEEPSEEK_API_KEY 未设置')
        logger.info('  AI 增强分析已禁用，使用 PaddleOCR 本地识别')
        logger.info('  如需 AI 增强，设置环境变量:')
        logger.info('    export DEEPSEEK_API_KEY=sk-xxx')
        logger.info('═══════════════════════════════════════')
        logger.info('')

    logger.info('')
    logger.info('═══════════════════════════════════════')
    logger.info('  SnapVision OCR Server (双引擎)')
    logger.info('  PID: %d', os.getpid())
    logger.info('  Python: %s', sys.version.split()[0])
    logger.info('  PaddleOCR: 就绪')
    logger.info('  DeepSeek 模型: %s', DEEPSEEK_MODEL)
    logger.info('  AI 增强: %s', '已启用' if DEEPSEEK_API_KEY else '未启用 (仅本地识别)')
    logger.info('═══════════════════════════════════════')
    logger.info('')
    logger.info('服务就绪 → http://%s:%d', HOST, OCR_PORT)
    logger.info('  健康检查     GET  /health')
    logger.info('  股票识别     POST /stock-extract')
    logger.info('  实时行情     POST /market-data')
    logger.info('  涨跌停分析   POST /stock-analysis')
    logger.info('  股票API      POST /stock-api/*')
    logger.info('  历史记录     GET|DELETE /history')
    logger.info('')

    app.run(host=HOST, port=OCR_PORT, debug=False)
