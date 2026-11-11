"""
Market Data Service — Orchestration layer.

Responsibilities:
    - TTL-based in-memory cache (configurable via MARKET_CACHE_TTL_SEC env var)
    - Multi-provider fallback (primary → secondary → …)
    - Structured logging for every request
    - Graceful degradation — never raises, always returns a result
"""

from __future__ import annotations
import logging
import os
import time
from typing import Optional

from .base_provider import MarketDataProvider, MarketQuote
from .eastmoney_provider import EastMoneyProvider
from .sina_provider import SinaProvider
from .tencent_provider import TencentProvider

logger = logging.getLogger(__name__)

# ─── Cache TTL ──────────────────────────────────────────────────

DEFAULT_CACHE_TTL_SEC = 30


def _cache_ttl() -> int:
    """Read cache TTL from env, default 30 seconds."""
    try:
        return int(os.environ.get('MARKET_CACHE_TTL_SEC', str(DEFAULT_CACHE_TTL_SEC)))
    except (ValueError, TypeError):
        return DEFAULT_CACHE_TTL_SEC


# ─── Cache entry ────────────────────────────────────────────────

class _CacheEntry:
    __slots__ = ('quote', 'ts')

    def __init__(self, quote: MarketQuote):
        self.quote = quote
        self.ts = time.time()

    @property
    def age_sec(self) -> float:
        return time.time() - self.ts

    def is_expired(self, ttl_sec: int) -> bool:
        return self.age_sec > ttl_sec


# ─── Service ────────────────────────────────────────────────────

class MarketDataService:
    """
    Central market data service.

    Usage:
        svc = MarketDataService()
        quote = svc.fetch('SZ002851')
        if quote.available:
            print(quote.current_price)

    Features:
        - In-memory cache with configurable TTL
        - Tries providers in registration order
        - Logs every request: stock_code, provider, elapsed_ms, cache_hit, degraded
        - Never raises — unavailable data returns MarketQuote(available=False)
    """

    def __init__(
        self,
        providers: Optional[list[MarketDataProvider]] = None,
        cache_ttl_sec: Optional[int] = None,
    ):
        """
        Args:
            providers: Ordered list of providers to try.
                       Defaults to [EastMoneyProvider()].
            cache_ttl_sec: Cache TTL in seconds. 0 disables caching.
                           Defaults to MARKET_CACHE_TTL_SEC env var or 30.
        """
        self._providers: list[MarketDataProvider] = providers or [
            SinaProvider(),
            TencentProvider(),
            EastMoneyProvider(),
        ]
        self._ttl: int = (
            cache_ttl_sec if cache_ttl_sec is not None else _cache_ttl()
        )
        self._cache: dict[str, _CacheEntry] = {}

    # ── Public API ───────────────────────────────────────────

    def fetch(self, stock_code: str) -> MarketQuote:
        """
        Fetch market data for a stock, with caching and fallback.

        Args:
            stock_code: Stock code with market prefix, e.g. 'SZ002851'.

        Returns:
            MarketQuote — check .available to determine whether data was obtained.
            Always succeeds (never raises).
        """
        if not stock_code or not stock_code.strip():
            logger.warning('[market] Empty stock_code, returning unavailable')
            return MarketQuote(available=False, source='none')

        code = stock_code.strip().upper()

        # ── Cache lookup ──
        if self._ttl > 0:
            cached = self._cache.get(code)
            if cached and not cached.is_expired(self._ttl):
                logger.info(
                    '[market] CACHE HIT | code=%s age=%.1fs ttl=%ds',
                    code, cached.age_sec, self._ttl,
                )
                return cached.quote

        # ── Try providers ──
        start = time.time()
        for provider in self._providers:
            try:
                quote = provider.fetch(code)
            except Exception:
                logger.exception(
                    '[market] Provider %s raised for %s — skipping',
                    provider.name, code,
                )
                continue

            elapsed = round((time.time() - start) * 1000)

            if quote.available:
                # Try to enrich with missing fields from other providers
                quote = self._enrich(quote, code, provider)
                # Cache the successful result
                if self._ttl > 0:
                    self._cache[code] = _CacheEntry(quote)
                logger.info(
                    '[market] OK | code=%s provider=%s elapsed=%dms cache_hit=false',
                    code, quote.source, elapsed,
                )
                return quote
            else:
                logger.warning(
                    '[market] Provider %s returned unavailable for %s elapsed=%dms',
                    provider.name, code, elapsed,
                )
                # Try next provider
                continue

        # ── All providers failed ──
        elapsed = round((time.time() - start) * 1000)
        logger.warning(
            '[market] DEGRADED | code=%s elapsed=%dms — all providers unavailable',
            code, elapsed,
        )
        return MarketQuote(
            stock_code=code,
            source='fallback',
            available=False,
        )


    # --- Enrichment ---

    _ENRICHABLE_FIELDS = ('turnover_rate', 'pe', 'pb')

    def _enrich(self, quote, code, primary_provider):
        """If primary result is missing turnover_rate/pe/pb, try other providers to fill in."""
        missing = [f for f in self._ENRICHABLE_FIELDS if getattr(quote, f, None) is None]
        if not missing:
            return quote

        for provider in self._providers:
            if provider is primary_provider:
                continue
            try:
                supplement = provider.fetch(code)
            except Exception:
                continue
            if not supplement.available:
                continue

            for field in missing:
                val = getattr(supplement, field, None)
                if val is not None:
                    setattr(quote, field, val)
                    logger.info('[market] Enriched %s.%s from %s', code, field, provider.name)

            missing = [f for f in self._ENRICHABLE_FIELDS if getattr(quote, f, None) is None]
            if not missing:
                break

        return quote

    # ── Cache management ─────────────────────────────────────

    def cache_stats(self) -> dict:
        """Return cache statistics for monitoring."""
        now = time.time()
        total = len(self._cache)
        expired = sum(1 for e in self._cache.values() if e.is_expired(self._ttl))
        return {
            'total_entries': total,
            'expired_entries': expired,
            'active_entries': total - expired,
            'ttl_sec': self._ttl,
        }

    def clear_cache(self) -> int:
        """Clear all cached entries. Returns number of entries removed."""
        count = len(self._cache)
        self._cache.clear()
        logger.info('[market] Cache cleared (%d entries)', count)
        return count

    def add_provider(self, provider: MarketDataProvider) -> None:
        """
        Register an additional provider.

        Providers are tried in registration order.
        Use this to add AKShare, Tushare, or other sources later.
        """
        self._providers.append(provider)
        logger.info(
            '[market] Provider registered: %s (total providers: %d)',
            provider.name, len(self._providers),
        )
