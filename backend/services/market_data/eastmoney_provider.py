"""
EastMoney Provider — 东方财富公开行情 API

Data source: https://push2.eastmoney.com/api/qt/stock/get

No API key required. Rate-limited server-side (~200 req/min).
All HTTP errors and parse failures return MarketQuote(available=False).
"""

from __future__ import annotations
import json
import logging
import time
from typing import Optional
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

from .base_provider import MarketDataProvider, MarketQuote

logger = logging.getLogger(__name__)

# ─── Constants ──────────────────────────────────────────────────

EASTMONEY_QUOTE_URL = 'https://push2.eastmoney.com/api/qt/stock/get'

# Fields we request (comma-separated EastMoney field IDs):
# f43=最新价  f44=最高  f45=最低  f46=今开  f47=成交量(手)
# f48=成交额  f57=代码   f58=名称  f60=涨跌额  f169=涨跌幅  f170=换手率
EASTMONEY_FIELDS = 'f43,f44,f45,f46,f47,f48,f57,f58,f60,f169,f170,f162,f167'

REQUEST_TIMEOUT_SEC = 5.0


def _fmt_volume(volume_hands: Optional[float]) -> Optional[str]:
    """Format raw volume (hands) to human-readable string."""
    if volume_hands is None:
        return None
    if volume_hands >= 1_0000_0000:    # >= 1 亿手
        return f'{volume_hands / 1_0000_0000:.2f}亿手'
    if volume_hands >= 1_0000:          # >= 1 万手
        return f'{volume_hands / 1_0000:.2f}万手'
    return f'{volume_hands:.0f}手'


def _fmt_turnover(turnover_yuan: Optional[float]) -> Optional[str]:
    """Format raw turnover (yuan) to human-readable string."""
    if turnover_yuan is None:
        return None
    if turnover_yuan >= 1_0000_0000:    # >= 1 亿
        return f'{turnover_yuan / 1_0000_0000:.2f}亿'
    if turnover_yuan >= 1_0000:          # >= 1 万
        return f'{turnover_yuan / 1_0000:.2f}万'
    return f'{turnover_yuan:.2f}'


class EastMoneyProvider(MarketDataProvider):
    """Market data from EastMoney (东方财富) public quote API."""

    @property
    def name(self) -> str:
        return 'eastmoney'

    def is_available(self) -> bool:
        return True  # Public API, always available (network permitting)

    # ── secid mapping ────────────────────────────────────────

    @staticmethod
    def _market_to_secid_prefix(market: str) -> str:
        """Convert SZ/SH/BJ/HK to EastMoney secid market prefix."""
        if market == 'SH':
            return '1'
        if market in ('SZ', 'BJ'):
            return '0'
        if market == 'HK':
            return '116'
        # Unknown — try 0 (SZ) as fallback
        return '0'

    def _build_secid(self, stock_code: str) -> Optional[str]:
        """Build EastMoney secid from prefixed stock code.

        Returns None if the code format is unrecognizable.
        """
        market, raw_code = self.parse_code(stock_code)
        if not market or not raw_code:
            return None
        prefix = self._market_to_secid_prefix(market)
        return f'{prefix}.{raw_code}'

    # ── fetch ────────────────────────────────────────────────

    def fetch(self, stock_code: str) -> MarketQuote:
        """Fetch real-time quote from EastMoney.

        Never raises — always returns MarketQuote (available=False on failure).
        """
        secid = self._build_secid(stock_code)
        if not secid:
            logger.warning(
                '[eastmoney] Cannot build secid from stock_code=%s', stock_code,
            )
            return MarketQuote(
                stock_code=stock_code, source=self.name, available=False,
            )

        url = (
            f'{EASTMONEY_QUOTE_URL}'
            f'?secid={secid}'
            f'&fields={EASTMONEY_FIELDS}'
            f'&invt=2&fltt=2'
        )

        logger.info('[eastmoney] Requesting %s → secid=%s', stock_code, secid)

        try:
            req = Request(url, headers={
                'User-Agent': 'Mozilla/5.0 (compatible; SnapVision/1.0)',
                'Accept': 'application/json',
            })
            start = time.time()
            with urlopen(req, timeout=REQUEST_TIMEOUT_SEC) as resp:
                raw = resp.read()
            elapsed = (time.time() - start) * 1000
            logger.info('[eastmoney] Response in %dms for %s', round(elapsed), stock_code)
        except HTTPError as e:
            logger.warning(
                '[eastmoney] HTTP %d for %s: %s', e.code, stock_code, e.reason,
            )
            return MarketQuote(
                stock_code=stock_code, source=self.name, available=False,
            )
        except URLError as e:
            logger.warning('[eastmoney] Network error for %s: %s', stock_code, e.reason)
            return MarketQuote(
                stock_code=stock_code, source=self.name, available=False,
            )
        except Exception:
            logger.exception('[eastmoney] Unexpected error for %s', stock_code)
            return MarketQuote(
                stock_code=stock_code, source=self.name, available=False,
            )

        return self._parse_response(stock_code, raw.decode('utf-8', errors='replace'))

    # ── response parsing ─────────────────────────────────────

    def _parse_response(self, stock_code: str, raw_text: str) -> MarketQuote:
        """Parse EastMoney JSON response into MarketQuote."""
        try:
            data = json.loads(raw_text)
        except json.JSONDecodeError:
            logger.warning('[eastmoney] Invalid JSON for %s', stock_code)
            return MarketQuote(
                stock_code=stock_code, source=self.name, available=False,
            )

        quote_raw = data.get('data')
        if not quote_raw:
            logger.warning('[eastmoney] Empty data for %s', stock_code)
            return MarketQuote(
                stock_code=stock_code, source=self.name, available=False,
            )

        # EastMoney returns all values as raw integers; prices need /100
        # f43=最新价, f44=最高, f45=最低, f46=今开, f47=成交量, f48=成交额
        # f57=代码, f58=名称, f60=涨跌额, f169=涨跌幅, f170=换手率

        def _f(key: str, div: float = 1.0) -> Optional[float]:
            val = quote_raw.get(key)
            if val is None or val == '-':
                return None
            try:
                return float(val) / div
            except (ValueError, TypeError):
                return None

        name = quote_raw.get('f58')
        code_from_api = quote_raw.get('f57')

        current = _f('f43', 100.0)
        high = _f('f44', 100.0)
        low = _f('f45', 100.0)
        open_price = _f('f46', 100.0)
        change_amount = _f('f60', 100.0)
        change_percent = _f('f169', 100.0)
        turnover_rate = _f('f170', 100.0)
        pe = _f('f162', 100.0)
        pb = _f('f167', 100.0)

        raw_volume = _f('f47')       # hands (手)
        raw_turnover = _f('f48')     # yuan (元)

        # Validate: if current_price is missing, data is likely invalid
        if current is None:
            logger.warning(
                '[eastmoney] No price data for %s (code=%s name=%s)',
                stock_code, code_from_api, name,
            )
            return MarketQuote(
                stock_code=stock_code, source=self.name, available=False,
            )

        return MarketQuote(
            stock_name=str(name) if name else None,
            stock_code=f'{self.parse_code(stock_code)[0]}{code_from_api}' if code_from_api and self.parse_code(stock_code)[0] else stock_code,
            current_price=round(current, 2),
            change_percent=round(change_percent, 2) if change_percent is not None else None,
            change_amount=round(change_amount, 2) if change_amount is not None else None,
            open=round(open_price, 2) if open_price is not None else None,
            high=round(high, 2) if high is not None else None,
            low=round(low, 2) if low is not None else None,
            volume=_fmt_volume(raw_volume),
            turnover=_fmt_turnover(raw_turnover),
            turnover_rate=round(turnover_rate, 2) if turnover_rate is not None else None,
            pe=round(pe, 2) if pe is not None else None,
            pb=round(pb, 4) if pb is not None else None,
            source=self.name,
            available=True,
            _raw_volume=raw_volume,
            _raw_turnover=raw_turnover,
        )
