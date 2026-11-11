"""
StockAPI — 统一股票数据服务

提供实时行情、K线数据、股票搜索。
无 Token / 无付费订阅，全部使用免费公开接口。

数据源（按优先级）:
  1. 新浪财经 (hq.sinajs.cn) — 实时行情，无需 key
  2. 腾讯财经 (qt.gtimg.cn) — 实时行情备用
  3. 东方财富 (push2.eastmoney.com) — 实时行情 + K 线 + 搜索
"""

from __future__ import annotations
import json
import logging
import re
import time
from datetime import datetime
from typing import Optional
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError
from urllib.parse import quote

from .market_service import MarketDataService
from .base_provider import MarketQuote

logger = logging.getLogger(__name__)

# ─── Trading hours detection ──────────────────────────────────

# A-share trading sessions (China Standard Time, Monday-Friday)
# Morning: 09:30-11:30, Afternoon: 13:00-15:00
# Also consider 09:15-09:25 for call auction (pre-market)

_TRADING_MORNING_START = (9, 30)
_TRADING_MORNING_END = (11, 30)
_TRADING_AFTERNOON_START = (13, 0)
_TRADING_AFTERNOON_END = (15, 0)


def is_trading_time() -> bool:
    """Check if currently within A-share trading hours (CST/UTC+8)."""
    now = datetime.now()
    # A-share market closed on weekends
    if now.weekday() >= 5:  # Saturday=5, Sunday=6
        return False

    t = (now.hour, now.minute)
    morning = _TRADING_MORNING_START <= t < _TRADING_MORNING_END
    afternoon = _TRADING_AFTERNOON_START <= t < _TRADING_AFTERNOON_END
    return morning or afternoon


def _normalise_code(code: str) -> str:
    """Normalise a raw stock code to prefixed format (e.g. 600519 -> SH600519).

    Supports: 6-digit codes (SH/SZ auto-detect), prefixed codes, or pure names.
    """
    code = code.strip().upper()

    # Already prefixed
    if len(code) >= 3 and code[:2] in ('SH', 'SZ', 'BJ', 'HK'):
        return code

    # Pure digits
    if code.isdigit():
        n = int(code)
        if len(code) == 6:
            # Classify by range
            if (600000 <= n <= 609999 or 601000 <= n <= 603999 or
                    605000 <= n <= 605999 or 688000 <= n <= 689999):
                return f'SH{code}'
            if (1 <= n <= 4999 or 2000 <= n <= 2999 or 3000 <= n <= 3999):
                return f'SZ{code}'
            if 300000 <= n <= 301999 or 200000 <= n <= 200999:
                return f'SZ{code}'
            if (400000 <= n <= 439999 or 830000 <= n <= 839999 or
                    870000 <= n <= 879999 or 920000 <= n <= 929999):
                return f'BJ{code}'
            # Default fallback
            return f'SZ{code}'
        if len(code) == 5:
            # Could be HK or short SZ
            if n >= 40000:
                return f'HK{code.zfill(5)}'
            return f'SZ{code}'

    return code


# ─── K-line constants ─────────────────────────────────────────

_EASTMONEY_KLINE_URL = 'https://push2his.eastmoney.com/api/qt/stock/kline/get'

# Period mapping: our API -> EastMoney klt parameter
_KLINE_PERIOD_MAP = {
    'daily': 101,
    'weekly': 102,
    'monthly': 103,
    '5min': 5,
    '15min': 15,
    '30min': 30,
    '60min': 60,
}

# Human-readable label for time display
_TIME_LABELS: dict[str, str] = {
    'daily': '%Y-%m-%d',
    'weekly': '%Y-%m-%d',
    'monthly': '%Y-%m-%d',
    '5min': '%Y-%m-%d %H:%M',
    '15min': '%Y-%m-%d %H:%M',
    '30min': '%Y-%m-%d %H:%M',
    '60min': '%Y-%m-%d %H:%M',
}


# ─── StockAPI class ────────────────────────────────────────────

class StockAPI:
    """Unified stock data API service.

    Usage:
        api = StockAPI()
        quote = api.getRealtimeQuote('600519')
        kline = api.getKlineData('600519', 'daily', 30)
        results = api.searchStock('茅台')
    """

    def __init__(self):
        self._market = MarketDataService()

    # ── Realtime quote ──────────────────────────────────────

    def getRealtimeQuote(self, code: str) -> dict:
        """Get single stock real-time quote.

        Auto-detects SH/SZ prefix from 6-digit codes.

        Returns:
            {
                'code': 'SH600519',
                'name': '贵州茅台',
                'price': 1688.00,
                'change_pct': +1.23,
                'change_amt': +20.50,
                'open': 1670.00,
                'high': 1695.00,
                'low': 1665.00,
                'volume': '5.62万手',
                'turnover': '94.68亿',
                'turnover_rate': 0.38,
                'source': 'sina',
                'trading': True,      # True = 交易中, False = 已收盘
                'update_time': '2025-06-11 14:30:00',
            }
            On failure after all providers:
            {
                'error': '数据加载失败，请重试',
                'code': 'SH600519',
            }
        """
        t0 = time.time()
        normalised = _normalise_code(code)
        trading = is_trading_time()

        logger.info('[stockapi] getRealtimeQuote code=%s normalised=%s trading=%s',
                     code, normalised, trading)

        try:
            quote: MarketQuote = self._market.fetch(normalised)
        except Exception:
            logger.exception('[stockapi] MarketDataService raised for %s', normalised)
            return {
                'error': '数据加载失败，请重试',
                'code': normalised,
                'trading': trading,
            }

        elapsed_ms = round((time.time() - t0) * 1000)

        if not quote.available:
            logger.warning('[stockapi] All providers unavailable for %s (%dms)', normalised, elapsed_ms)
            return {
                'error': '数据加载失败，请重试',
                'code': normalised,
                'trading': trading,
            }

        logger.info('[stockapi] OK code=%s source=%s price=%.2f elapsed=%dms',
                     normalised, quote.source, quote.current_price or 0, elapsed_ms)

        return {
            'code': quote.stock_code or normalised,
            'name': quote.stock_name,
            'price': quote.current_price,
            'change_pct': quote.change_percent,
            'change_amt': quote.change_amount,
            'open': quote.open,
            'high': quote.high,
            'low': quote.low,
            'prev_close': quote.prev_close,
            'volume': quote.volume,
            'turnover': quote.turnover,
            'turnover_rate': quote.turnover_rate,
            'pe': quote.pe,
            'pb': quote.pb,
            'amplitude': quote.amplitude,
            'total_market_cap': quote.total_market_cap,
            'circulating_market_cap': quote.circulating_market_cap,
            'source': quote.source,
            'trading': trading,
            'update_time': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        }

    # ── K-line data ─────────────────────────────────────────

    def getKlineData(self, code: str, period: str = 'daily', count: int = 30) -> dict:
        """Get K-line (candlestick) data for a stock.

        Args:
            code: Stock code (e.g. '600519', 'SH600519')
            period: 'daily' | 'weekly' | 'monthly' | '5min' | '15min' | '30min' | '60min'
            count: Number of bars (max ~200)

        Returns:
            {'code': 'SH600519', 'period': 'daily', 'bars': [
                {'time': '2025-06-11', 'open': 1670, 'close': 1688, 'high': 1695,
                 'low': 1665, 'volume': 56200, 'turnover': 94680000},
                ...
            ]}
            On failure:
            {'error': '数据加载失败，请重试', 'code': 'SH600519'}
        """
        t0 = time.time()
        normalised = _normalise_code(code)
        klt = _KLINE_PERIOD_MAP.get(period, 101)
        time_fmt = _TIME_LABELS.get(period, '%Y-%m-%d')

        logger.info('[stockapi] getKlineData code=%s period=%s klt=%d count=%d',
                     normalised, period, klt, count)

        try:
            market, raw_code = normalised[:2], normalised[2:]
        except IndexError:
            return {'error': '无效的股票代码', 'code': code}

        secid_prefix = '1' if market.upper() == 'SH' else '0'
        secid = f'{secid_prefix}.{raw_code}'

        url = (
            f'{_EASTMONEY_KLINE_URL}'
            f'?secid={secid}'
            f'&ut=fa5fd1943c7b386f172d6893dbfdc77c'
            f'&fields1=f1,f2,f3,f4,f5,f6'
            f'&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61'
            f'&klt={klt}'
            f'&fqt=1'
            f'&end=20500101'
            f'&lmt={min(count, 200)}'
        )

        try:
            req = Request(url, headers={
                'User-Agent': 'Mozilla/5.0 (compatible; SnapVision/1.0)',
                'Accept': 'application/json',
                'Referer': 'https://quote.eastmoney.com',
            })
            start = time.time()
            with urlopen(req, timeout=5.0) as resp:
                body = resp.read().decode('utf-8', errors='replace')
            elapsed = (time.time() - start) * 1000
            logger.info('[stockapi] K-line response in %dms for %s', round(elapsed), normalised)
        except HTTPError as e:
            logger.warning('[stockapi] K-line HTTP %d for %s', e.code, normalised)
            return {'error': '数据加载失败，请重试', 'code': normalised}
        except URLError as e:
            logger.warning('[stockapi] K-line network error for %s: %s', normalised, e.reason)
            return {'error': '数据加载失败，请重试', 'code': normalised}
        except Exception:
            logger.exception('[stockapi] K-line error for %s', normalised)
            return {'error': '数据加载失败，请重试', 'code': normalised}

        # Parse K-line response
        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            return {'error': '数据解析失败', 'code': normalised}

        klines = (data.get('data') or {}).get('klines') or []
        bars: list[dict] = []
        for line in klines:
            # Format: "date,open,close,high,low,volume,turnover,..."
            # EastMoney fields: f51=date,f52=open,f53=close,f54=high,f55=low,f56=volume,f57=turnover
            parts = line.split(',')
            if len(parts) < 7:
                continue
            try:
                raw_time = parts[0].strip()
                if not raw_time:
                    continue

                bar = {
                    'time': raw_time,
                    'open': round(float(parts[1]), 2),
                    'close': round(float(parts[2]), 2),
                    'high': round(float(parts[3]), 2),
                    'low': round(float(parts[4]), 2),
                    'volume': int(float(parts[5])),
                    'turnover': round(float(parts[6]), 2),
                }
                bars.append(bar)
            except (ValueError, IndexError):
                continue

        total_ms = round((time.time() - t0) * 1000)
        logger.info('[stockapi] K-line OK code=%s bars=%d elapsed=%dms',
                     normalised, len(bars), total_ms)

        return {
            'code': normalised,
            'period': period,
            'count': len(bars),
            'bars': bars,
        }

    # ── Stock search ────────────────────────────────────────

    def searchStock(self, keyword: str) -> dict:
        """Search stocks by name or code (fuzzy).

        Args:
            keyword: Search term, e.g. '茅台', '600519', '平安'

        Returns:
            {
                'keyword': '茅台',
                'results': [
                    {'code': 'SH600519', 'name': '贵州茅台', 'market': 'SH'},
                    ...
                ]
            }
        """
        t0 = time.time()
        keyword = keyword.strip()
        if not keyword:
            return {'keyword': keyword, 'results': []}

        logger.info('[stockapi] searchStock keyword=%s', keyword)

        # Use Tencent smartbox search API (more reliable than EastMoney search)
        url = (
            f'https://smartbox.gtimg.cn/s3/'
            f'?q={quote(keyword)}'
            f'&t=all&c=1'
        )

        try:
            req = Request(url, headers={
                'User-Agent': 'Mozilla/5.0 (compatible; SnapVision/1.0)',
            })
            with urlopen(req, timeout=5.0) as resp:
                body = resp.read().decode('gbk', errors='replace')
        except Exception:
            logger.exception('[stockapi] Search error for "%s"', keyword)
            return {'error': '搜索失败，请重试', 'keyword': keyword, 'results': []}

        # Parse Tencent response: v_hint="sh~600519~\u8d35\u5dde\u8305\u53f0~...";
        # Format: market~code~name~pinyin~type
        results: list[dict] = []
        for match in re.finditer(r'v_hint="([^"]*)"', body):
            # Split by ~ to get individual suggestions
            # Each suggestion group: market~code~name~pinyin~type
            parts = match.group(1).split(';')
            for part in parts:
                part = part.strip()
                if not part:
                    continue
                fields = part.split('~')
                if len(fields) >= 3:
                    market_raw = fields[0].upper()
                    code_raw = fields[1]
                    name = fields[2].encode().decode('unicode_escape') if '\\u' in fields[2] else fields[2]
                    # Build prefixed code
                    if market_raw in ('SH', 'SZ', 'BJ', 'HK'):
                        code = f'{market_raw}{code_raw}'
                    else:
                        code = _normalise_code(code_raw)
                    results.append({
                        'code': code,
                        'name': name,
                        'market': market_raw,
                    })

        elapsed_ms = round((time.time() - t0) * 1000)
        logger.info('[stockapi] Search OK keyword=%s results=%d elapsed=%dms',
                     keyword, len(results), elapsed_ms)

        return {
            'keyword': keyword,
            'results': results,
        }


# ─── Singleton ─────────────────────────────────────────────────

_stock_api: Optional[StockAPI] = None


def get_stock_api() -> StockAPI:
    global _stock_api
    if _stock_api is None:
        _stock_api = StockAPI()
    return _stock_api
