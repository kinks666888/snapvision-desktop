"""
Sina Provider — 新浪财经实时行情 API

Data source: http://hq.sinajs.cn/list=sh600519
No API key required. Returns comma-separated ASCII text.
"""

from __future__ import annotations
import logging
import re
import time
from typing import Optional
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

from .base_provider import MarketDataProvider, MarketQuote

logger = logging.getLogger(__name__)

SINA_QUOTE_URL = 'http://hq.sinajs.cn/list='
REQUEST_TIMEOUT_SEC = 3.0


def _get_sina_prefix(market: str) -> str:
    """Convert market code to Sina prefix (sh/sz)."""
    if market in ('SH', 'SZ', 'BJ'):
        return market.lower()
    return 'sz'


def _fmt_volume(shares: Optional[float]) -> Optional[str]:
    if shares is None:
        return None
    hands = shares / 100.0
    if hands >= 1_0000_0000:
        return f'{hands / 1_0000_0000:.2f}亿手'
    if hands >= 1_0000:
        return f'{hands / 1_0000:.2f}万手'
    return f'{hands:.0f}手'


def _fmt_turnover(yuan: Optional[float]) -> Optional[str]:
    if yuan is None:
        return None
    if yuan >= 1_0000_0000:
        return f'{yuan / 1_0000_0000:.2f}亿'
    if yuan >= 1_0000:
        return f'{yuan / 1_0000:.2f}万'
    return f'{yuan:.2f}'


class SinaProvider(MarketDataProvider):
    """Market data from Sina Finance (新浪财经) public API."""

    @property
    def name(self) -> str:
        return 'sina'

    def is_available(self) -> bool:
        return True

    def _build_sina_code(self, stock_code: str) -> Optional[str]:
        """Build Sina symbol like 'sh600519'."""
        market, raw_code = self.parse_code(stock_code)
        if not raw_code:
            return None
        prefix = _get_sina_prefix(market)
        return f'{prefix}{raw_code}'

    def fetch(self, stock_code: str) -> MarketQuote:
        sina_code = self._build_sina_code(stock_code)
        if not sina_code:
            return MarketQuote(stock_code=stock_code, source=self.name, available=False)

        url = f'{SINA_QUOTE_URL}{sina_code}'
        logger.info('[sina] Requesting %s → %s', stock_code, url)

        try:
            req = Request(url, headers={
                'User-Agent': 'Mozilla/5.0 (compatible; SnapVision/1.0)',
                'Referer': 'https://finance.sina.com.cn',
            })
            start = time.time()
            with urlopen(req, timeout=REQUEST_TIMEOUT_SEC) as resp:
                body = resp.read().decode('gb2312', errors='replace')
            elapsed = (time.time() - start) * 1000
            logger.info('[sina] Response in %dms for %s', round(elapsed), stock_code)
        except HTTPError as e:
            logger.warning('[sina] HTTP %d for %s: %s', e.code, stock_code, e.reason)
            return MarketQuote(stock_code=stock_code, source=self.name, available=False)
        except URLError as e:
            logger.warning('[sina] Network error for %s: %s', stock_code, e.reason)
            return MarketQuote(stock_code=stock_code, source=self.name, available=False)
        except Exception:
            logger.exception('[sina] Unexpected error for %s', stock_code)
            return MarketQuote(stock_code=stock_code, source=self.name, available=False)

        return self._parse_response(stock_code, body)

    def _parse_response(self, stock_code: str, body: str) -> MarketQuote:
        """Parse Sina's var hq_str_...="..." format.

        Fields (A-share, 0-based):
          0: name, 1: open, 2: prev_close, 3: current_price,
          4: high, 5: low, 8: volume(shares), 9: turnover(yuan),
          30: date, 31: time, 32: unknown,
          38: turnover_rate (%)
        """
        m = re.search(r'"([^"]*)"', body)
        if not m:
            logger.warning('[sina] No quoted data in response for %s', stock_code)
            return MarketQuote(stock_code=stock_code, source=self.name, available=False)

        parts = m.group(1).split(',')
        if len(parts) < 10:
            logger.warning('[sina] Insufficient fields (%d) for %s', len(parts), stock_code)
            return MarketQuote(stock_code=stock_code, source=self.name, available=False)

        def _f(idx: int) -> Optional[float]:
            try:
                val = parts[idx].strip()
                if not val or val == '':
                    return None
                return float(val)
            except (ValueError, IndexError):
                return None

        name = parts[0].strip() or None
        current = _f(3)
        if current is None or current <= 0:
            logger.warning('[sina] No valid price for %s', stock_code)
            return MarketQuote(stock_code=stock_code, source=self.name, available=False)

        open_price = _f(1)
        prev_close = _f(2)
        high = _f(4)
        low = _f(5)
        raw_volume = _f(8)   # shares
        raw_turnover = _f(9) # yuan
        trade_date = parts[30].strip() if len(parts) > 30 else ''
        trade_time = parts[31].strip() if len(parts) > 31 else ''

        # 换手率 — field 38 in Sina extended response (may not be present)
        turnover_rate = _f(38)

        # Calculate change
        change_amount = round(current - prev_close, 2) if prev_close is not None else None
        change_percent = (
            round((current - prev_close) / prev_close * 100, 2)
            if prev_close is not None and prev_close > 0
            else None
        )

        # Build formatted time
        quote_time = None
        if trade_date and trade_time:
            quote_time = f'{trade_date} {trade_time}'

        return MarketQuote(
            stock_name=name,
            stock_code=stock_code,
            current_price=round(current, 2),
            change_percent=change_percent,
            change_amount=change_amount,
            open=round(open_price, 2) if open_price is not None else None,
            prev_close=round(prev_close, 2) if prev_close is not None else None,
            high=round(high, 2) if high is not None else None,
            low=round(low, 2) if low is not None else None,
            volume=_fmt_volume(raw_volume),
            turnover=_fmt_turnover(raw_turnover),
            turnover_rate=round(turnover_rate, 2) if turnover_rate is not None else None,
            source=self.name,
            available=True,
            _raw_volume=raw_volume / 100.0 if raw_volume is not None else None,
            _raw_turnover=raw_turnover,
        )
