"""
Base Provider — Abstract interface for market data sources.

To add a new data source:
    1. Subclass MarketDataProvider
    2. Implement fetch(stock_code) → MarketQuote
    3. Register in MarketDataService.__init__
"""

from __future__ import annotations
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class MarketQuote:
    """Unified market data model — provider-agnostic."""

    stock_name: Optional[str] = None
    stock_code: Optional[str] = None
    current_price: Optional[float] = None
    change_percent: Optional[float] = None
    change_amount: Optional[float] = None
    open: Optional[float] = None
    high: Optional[float] = None
    low: Optional[float] = None
    prev_close: Optional[float] = None
    volume: Optional[str] = None       # formatted string (手/万手/亿手)
    turnover: Optional[str] = None      # formatted string (元/万元/亿元)
    turnover_rate: Optional[float] = None
    pe: Optional[float] = None          # 市盈率
    pb: Optional[float] = None          # 市净率
    amplitude: Optional[float] = None   # 振幅 %
    total_market_cap: Optional[str] = None  # 总市值 (格式化)
    circulating_market_cap: Optional[str] = None  # 流通市值 (格式化)
    source: str = ''
    available: bool = True

    # Raw fields for internal use
    _raw_volume: Optional[float] = field(default=None, repr=False)
    _raw_turnover: Optional[float] = field(default=None, repr=False)


class MarketDataProvider(ABC):
    """Abstract base for market data providers.

    Each provider encapsulates one data source (EastMoney, AKShare, Tushare, etc.).
    """

    @property
    @abstractmethod
    def name(self) -> str:
        """Human-readable provider name, e.g. 'eastmoney'."""
        ...

    @abstractmethod
    def is_available(self) -> bool:
        """Check whether this provider is currently usable.

        Returns False if dependencies are missing or network is unreachable
        (best-effort check — does not guarantee fetch() will succeed).
        """
        ...

    @abstractmethod
    def fetch(self, stock_code: str) -> MarketQuote:
        """
        Fetch real-time market data for a stock.

        Args:
            stock_code: Stock code WITH market prefix, e.g. 'SZ002851', 'SH600036'.

        Returns:
            MarketQuote with available fields populated.
            On failure, returns MarketQuote(available=False, source=self.name).

        Raises:
            Should NOT raise — all errors must be caught and returned as
            MarketQuote(available=False).
        """
        ...

    def parse_code(self, stock_code: str) -> tuple[str, str]:
        """
        Parse a prefixed stock code into (market, raw_code).

        Examples:
            'SZ002851' → ('SZ', '002851')
            'SH600036' → ('SH', '600036')
            'BJ830799' → ('BJ', '830799')
            'HK00700'  → ('HK', '00700')
            '002851'   → ('', '002851')   # no prefix

        Args:
            stock_code: Stock code, optionally with market prefix.

        Returns:
            (market, raw_code) tuple. Market is uppercase 2-char prefix or ''.
        """
        code = stock_code.strip().upper()
        if len(code) >= 3 and code[:2] in ('SH', 'SZ', 'BJ', 'HK'):
            return code[:2], code[2:]
        return '', code
