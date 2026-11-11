"""
Tencent Provider — 腾讯财经实时行情 API

Data source: http://qt.gtimg.cn/q=sh600519
No API key required. Returns similar comma-separated format as Sina.
Used as fallback when Sina is unavailable.
"""

from __future__ import annotations
import logging
import time
from typing import Optional
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

from .base_provider import MarketDataProvider, MarketQuote

logger = logging.getLogger(__name__)

TENCENT_QUOTE_URL = 'http://qt.gtimg.cn/q='
REQUEST_TIMEOUT_SEC = 3.0


def _get_tencent_prefix(market: str) -> str:
    """Convert market code to Tencent prefix (sh/sz)."""
    if market in ('SH', 'SZ', 'BJ'):
        return market.lower()
    return 'sz'


def _fmt_volume(hands: Optional[float]) -> Optional[str]:
    if hands is None:
        return None
    if hands >= 1_0000_0000:
        return f'{hands / 1_0000_0000:.2f}亿手'
    if hands >= 1_0000:
        return f'{hands / 1_0000:.2f}万手'
    return f'{hands:.0f}手'


def _fmt_turnover(wan: Optional[float]) -> Optional[str]:
    if wan is None:
        return None
    yuan = wan * 10000.0
    if yuan >= 1_0000_0000:
        return f'{yuan / 1_0000_0000:.2f}亿'
    if yuan >= 1_0000:
        return f'{yuan / 1_0000:.2f}万'
    return f'{yuan:.2f}'


class TencentProvider(MarketDataProvider):
    """Market data from Tencent Finance (腾讯财经) public API."""

    @property
    def name(self) -> str:
        return 'tencent'

    def is_available(self) -> bool:
        return True

    def _build_tencent_code(self, stock_code: str) -> Optional[str]:
        market, raw_code = self.parse_code(stock_code)
        if not raw_code:
            return None
        prefix = _get_tencent_prefix(market)
        return f'{prefix}{raw_code}'

    def fetch(self, stock_code: str) -> MarketQuote:
        tencent_code = self._build_tencent_code(stock_code)
        if not tencent_code:
            return MarketQuote(stock_code=stock_code, source=self.name, available=False)

        url = f'{TENCENT_QUOTE_URL}{tencent_code}'
        logger.info('[tencent] Requesting %s → %s', stock_code, url)

        try:
            req = Request(url, headers={
                'User-Agent': 'Mozilla/5.0 (compatible; SnapVision/1.0)',
                'Referer': 'https://gu.qq.com',
            })
            start = time.time()
            with urlopen(req, timeout=REQUEST_TIMEOUT_SEC) as resp:
                body = resp.read().decode('gbk', errors='replace')
            elapsed = (time.time() - start) * 1000
            logger.info('[tencent] Response in %dms for %s', round(elapsed), stock_code)
        except HTTPError as e:
            logger.warning('[tencent] HTTP %d for %s: %s', e.code, stock_code, e.reason)
            return MarketQuote(stock_code=stock_code, source=self.name, available=False)
        except URLError as e:
            logger.warning('[tencent] Network error for %s: %s', stock_code, e.reason)
            return MarketQuote(stock_code=stock_code, source=self.name, available=False)
        except Exception:
            logger.exception('[tencent] Unexpected error for %s', stock_code)
            return MarketQuote(stock_code=stock_code, source=self.name, available=False)

        return self._parse_response(stock_code, body)

    def _parse_response(self, stock_code: str, body: str) -> MarketQuote:
        """Parse Tencent's v_sh600519="..."; format.

        Fields (A-share, 0-based):
          1: name, 3: current_price, 4: prev_close, 5: open,
          31: change_percent, 32: change_amount, 33: high, 34: low,
          6: volume(hands), 37: turnover(万元), 38: turnover_rate,
          39: PE, 43: amplitude, 44: total_market_cap(亿),
          45: circulating_market_cap(亿), 46: PB,
          30: time (YYYYMMDDHHMMSS)
        """
        # Extract quoted content
        import re
        m = re.search(r'"([^"]*)"', body)
        if not m:
            m = re.search(r'="([^"]*)"', body)
        if not m:
            logger.warning('[tencent] No quoted data in response for %s', stock_code)
            return MarketQuote(stock_code=stock_code, source=self.name, available=False)

        parts = m.group(1).split('~')
        if len(parts) < 45:
            logger.warning('[tencent] Insufficient fields (%d) for %s', len(parts), stock_code)
            return MarketQuote(stock_code=stock_code, source=self.name, available=False)

        def _f(idx: int) -> Optional[float]:
            try:
                val = parts[idx].strip()
                if not val or val == '':
                    return None
                return float(val)
            except (ValueError, IndexError):
                return None

        name = parts[1].strip() or None
        current = _f(3)
        if current is None or current <= 0:
            logger.warning('[tencent] No valid price for %s', stock_code)
            return MarketQuote(stock_code=stock_code, source=self.name, available=False)

        prev_close = _f(4)
        open_price = _f(5)
        high = _f(33)
        low = _f(34)
        change_percent = _f(31)
        change_amount = _f(32)
        raw_volume = _f(6)           # hands
        raw_turnover_wan = _f(37)     # 万元
        turnover_rate = _f(38)        # percent
        pe = _f(39)                   # 市盈率
        pb = _f(46)                   # 市净率
        amplitude = _f(43)            # 振幅%
        raw_time = parts[30].strip() if len(parts) > 30 else ''

        # Format market cap: 总市值(亿) / 流通市值(亿)
        total_mcap_raw = _f(44)
        circ_mcap_raw = _f(45)
        total_mcap_str = None
        circ_mcap_str = None
        if total_mcap_raw is not None:
            total_mcap_str = f'{total_mcap_raw:.2f}亿'
        if circ_mcap_raw is not None:
            circ_mcap_str = f'{circ_mcap_raw:.2f}亿'

        # Format time: YYYYMMDDHHMMSS -> YYYY-MM-DD HH:mm:ss
        quote_time = None
        if raw_time and len(raw_time) >= 14:
            quote_time = (
                f'{raw_time[0:4]}-{raw_time[4:6]}-{raw_time[6:8]} '
                f'{raw_time[8:10]}:{raw_time[10:12]}:{raw_time[12:14]}'
            )

        # Calculate change if not provided
        if change_amount is None and prev_close is not None:
            change_amount = round(current - prev_close, 2)
        if change_percent is None and prev_close is not None and prev_close > 0:
            change_percent = round((current - prev_close) / prev_close * 100, 2)

        return MarketQuote(
            stock_name=name,
            stock_code=stock_code,
            current_price=round(current, 2),
            change_percent=round(change_percent, 2) if change_percent is not None else None,
            change_amount=round(change_amount, 2) if change_amount is not None else None,
            open=round(open_price, 2) if open_price is not None else None,
            high=round(high, 2) if high is not None else None,
            low=round(low, 2) if low is not None else None,
            prev_close=round(prev_close, 2) if prev_close is not None else None,
            volume=_fmt_volume(raw_volume),
            turnover=_fmt_turnover(raw_turnover_wan),
            turnover_rate=round(turnover_rate, 2) if turnover_rate is not None else None,
            pe=round(pe, 2) if pe is not None else None,
            pb=round(pb, 4) if pb is not None else None,
            amplitude=round(amplitude, 2) if amplitude is not None else None,
            total_market_cap=total_mcap_str,
            circulating_market_cap=circ_mcap_str,
            source=self.name,
            available=True,
            _raw_volume=raw_volume,
            _raw_turnover=raw_turnover_wan * 10000.0 if raw_turnover_wan is not None else None,
        )
