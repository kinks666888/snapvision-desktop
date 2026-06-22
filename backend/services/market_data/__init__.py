"""
SnapVision Market Data Module

Provides real-time stock market data from multiple providers.

Exports:
    MarketDataService  — caching orchestrator with fallback
    MarketDataProvider — abstract base for new data sources
    EastMoneyProvider  — EastMoney (东方财富) public quote API
    MarketQuote        — unified data model
"""

from .market_service import MarketDataService
from .base_provider import MarketDataProvider, MarketQuote
from .eastmoney_provider import EastMoneyProvider
from .sina_provider import SinaProvider
from .tencent_provider import TencentProvider

__all__ = [
    'MarketDataService',
    'MarketDataProvider',
    'EastMoneyProvider',
    'SinaProvider',
    'TencentProvider',
    'MarketQuote',
]
