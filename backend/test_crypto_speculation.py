"""
Crypto Speculation Engine 单元测试
运行: cd backend && .venv/bin/python -m unittest test_crypto_speculation -v
"""

import unittest

from crypto_speculation import (
    speculate, sma, ema, rsi, macd, atr,
    trend_factor, momentum_factor, sentiment_factor,
    volume_factor, find_support_resistance,
)
from crypto_extractor import extract_crypto_info, detect_coin
from services.market_data.crypto_api import normalise_symbol, _PERIOD_MAP


# ─── 测试数据工厂 ──────────────────────────────────────────────

def _make_bars(trend: str = 'up', n: int = 60) -> list[dict]:
    """生成测试 K 线: trend = 'up' | 'down' | 'flat'。"""
    bars = []
    price = 100.0
    for i in range(n):
        if trend == 'up':
            price *= 1.012
        elif trend == 'down':
            price *= 0.988
        else:
            price *= 1.0005
        noise = ((i * 7919) % 13 - 6) / 100  # 确定性微噪声
        o = price * (1 + noise * 0.01)
        c = price
        h = max(o, c) * (1.008 + abs(noise) * 0.002)
        l = min(o, c) * (0.992 - abs(noise) * 0.002)
        vol = 1000 + (i % 10) * 50
        if trend == 'up' and i > n - 6:
            vol *= 1.8  # 尾段放量
        bars.append({
            'time': f'2026-01-{(i % 28) + 1:02d}',
            'open': round(o, 2), 'high': round(h, 2),
            'low': round(l, 2), 'close': round(c, 2),
            'volume': vol, 'turnover': vol * c,
        })
    return bars


# ─── 指标测试 ─────────────────────────────────────────────────

class TestIndicators(unittest.TestCase):
    def test_sma(self):
        vals = [1, 2, 3, 4, 5]
        out = sma(vals, 3)
        self.assertIsNone(out[0])
        self.assertEqual(out[2], 2.0)
        self.assertEqual(out[4], 4.0)

    def test_ema(self):
        out = ema([10, 11, 12], 2)
        self.assertEqual(len(out), 3)
        self.assertIsNotNone(out[-1])

    def test_rsi_bullish(self):
        closes = [100 + i for i in range(30)]  # 单边上涨
        r = rsi(closes, 14)
        self.assertIsNotNone(r)
        self.assertGreater(r, 70)

    def test_rsi_bearish(self):
        closes = [130 - i for i in range(30)]
        r = rsi(closes, 14)
        self.assertLess(r, 30)

    def test_macd_keys(self):
        closes = [100 + (i % 5) for i in range(60)]
        m = macd(closes)
        self.assertIn('hist', m)
        self.assertIn('dif', m)

    def test_atr_positive(self):
        bars = _make_bars('flat')
        a = atr(bars, 14)
        self.assertIsNotNone(a)
        self.assertGreater(a, 0)

    def test_support_resistance(self):
        bars = _make_bars('up')
        sr = find_support_resistance(bars)
        self.assertIsNotNone(sr['support'])
        self.assertIsNotNone(sr['resistance'])
        self.assertLess(sr['support'], sr['resistance'])


# ─── 因子测试 ─────────────────────────────────────────────────

class TestFactors(unittest.TestCase):
    def test_trend_up(self):
        score, detail = trend_factor(_make_bars('up'))
        self.assertGreater(score, 30)

    def test_trend_down(self):
        score, _ = trend_factor(_make_bars('down'))
        self.assertLess(score, -30)

    def test_momentum_up(self):
        score, _ = momentum_factor(_make_bars('up'))
        self.assertGreater(score, 0)

    def test_sentiment_greed_contrarian(self):
        """极度贪婪应反向扣分。"""
        quote = {'fear_greed': {'value': 88, 'label': 'Extreme Greed'}}
        score, detail = sentiment_factor(quote)
        self.assertLess(score, 0)
        self.assertIn('贪婪', detail)

    def test_sentiment_fear_contrarian(self):
        quote = {'fear_greed': {'value': 12, 'label': 'Extreme Fear'}}
        score, _ = sentiment_factor(quote)
        self.assertGreater(score, 0)

    def test_sentiment_high_funding(self):
        quote = {'funding_rate': 0.12}
        score, _ = sentiment_factor(quote)
        self.assertLess(score, 0)

    def test_volume_climax(self):
        score, detail = volume_factor(_make_bars('up'))
        self.assertIn('量', detail)


# ─── 推测引擎主入口测试 ────────────────────────────────────────

class TestSpeculate(unittest.TestCase):
    def test_bullish_market(self):
        result = speculate(_make_bars('up'), {})
        self.assertTrue(result['success'])
        self.assertEqual(result['direction'], 'bullish')
        self.assertGreater(result['score'], 50)
        self.assertGreaterEqual(result['probabilities']['up'], result['probabilities']['down'])

    def test_bearish_market(self):
        result = speculate(_make_bars('down'), {})
        self.assertEqual(result['direction'], 'bearish')
        self.assertLess(result['score'], 50)

    def test_insufficient_bars(self):
        result = speculate(_make_bars('up', n=3), {})
        self.assertFalse(result['success'])
        self.assertIn('error', result)

    def test_output_structure(self):
        result = speculate(_make_bars('flat'), {
            'price': 100.5, 'funding_rate': 0.01,
            'fear_greed': {'value': 50, 'label': 'Neutral'},
        })
        for key in ('direction', 'score', 'confidence', 'probabilities',
                    'factors', 'key_levels', 'risk', 'summary', 'disclaimer'):
            self.assertIn(key, result)
        # 因子完整性
        self.assertEqual(len(result['factors']), 5)
        names = {f['name'] for f in result['factors']}
        self.assertEqual(names, {'趋势', '动量', '情绪', '量能', '波动'})
        # 概率和 ≈ 100
        p = result['probabilities']
        self.assertAlmostEqual(p['up'] + p['down'] + p['range'], 100, delta=1.0)

    def test_key_levels_ordering(self):
        result = speculate(_make_bars('up'), {'price': 150.0})
        kl = result['key_levels']
        self.assertLess(kl['support'], kl['resistance'])
        self.assertIn('stop_loss', kl)
        self.assertIn('target1', kl)

    def test_confidence_range(self):
        result = speculate(_make_bars('up'), {'funding_rate': 0.01})
        self.assertTrue(0 <= result['confidence'] <= 100)

    def test_summary_text(self):
        result = speculate(_make_bars('up'), {'price': 123.0})
        self.assertIsInstance(result['summary'], str)
        self.assertGreater(len(result['summary']), 20)
        self.assertIn('支撑', result['summary'])


# ─── 加密截图识别测试 ──────────────────────────────────────────

class TestCryptoExtractor(unittest.TestCase):
    def test_detect_binance_screenshot(self):
        texts = [
            'BTC/USDT 永续', '币安 Binance', '资金费率 0.0125%',
            '多空比 1.23', '24h涨跌 +2.35%', '现价 67,890.5',
            '24h最高 68,500', '24h最低 66,200', '成交量 1.2万',
        ]
        result = extract_crypto_info(texts)
        self.assertTrue(result['is_crypto'])
        self.assertEqual(result['market_type'], 'crypto')
        self.assertEqual(result['coin_symbol'], 'BTC')
        self.assertEqual(result['exchange'], 'Binance')
        self.assertEqual(result['pair'], 'BTC/USDT')
        self.assertTrue(result['contract_features']['is_perpetual'])

    def test_detect_stock_screenshot_not_crypto(self):
        texts = ['贵州茅台 600519', '今开 1670.00', '昨收 1668.50',
                 '成交量 5.62万手', '成交额 94.68亿', '换手率 0.38%',
                 '市盈率 25.3', '市净率 8.1']
        result = extract_crypto_info(texts)
        self.assertFalse(result['is_crypto'])

    def test_detect_eth_alias(self):
        texts = ['以太坊 ETH', '价格 3,450.2', '涨跌 +1.2%', 'OKX 欧易']
        result = extract_crypto_info(texts)
        self.assertTrue(result['is_crypto'])
        self.assertEqual(result['coin_symbol'], 'ETH')

    def test_empty_texts(self):
        result = extract_crypto_info([])
        self.assertFalse(result['success'])

    def test_okx_real_screenshot(self):
        """实测回归: OKX ETHUSDT 永续截图 (2026-11-11) — 侧栏市值不得抢占现价, K线tooltip 0.00% 不得当涨跌幅。"""
        texts = [
            'okx.com', '欧易', '买币 市场 交易 金融', '充币 资产管理',
            'BTCUSDT 永续 73,471.6 +0.40%', 'ETHUSDT 永续',
            'A.. 永续 Pre-IPO 138.41', 'Anthropi:$4,813.41万 +4.83%',
            '2,056.55 ETH USDT 永续合约.', '+34.12 (+1.69%)',
            '指数价格 2,057.55 标记价格 2,056.55 资金费率(8小时)/倒计时 -0.00131%',
            '最新价/涨跌幅', '2026/11/11 12:22 开 2,056.55 高 2,056.55 低 2,056.55 收',
            '2,056.55 涨跌+0.00(+0.00%）振幅0.00%',
            '订单表', '价格(USDT) 数量(USDT) 计价(USDT)',
            '2,056.75 14.87K 381.63K', '2,056.55 253.66K 253.66K',
        ]
        result = extract_crypto_info(texts)
        self.assertTrue(result['is_crypto'])
        self.assertEqual(result['coin_symbol'], 'ETH')
        self.assertEqual(result['exchange'], 'OKX')
        self.assertEqual(result['current_price'], '2,056.55')  # 不是 4,813.41
        self.assertEqual(result['change_percent'], '+1.69%')   # 不是 +0.00%
        self.assertTrue(result['contract_features']['is_perpetual'])

    def test_sidebar_must_not_steal_main_pair(self):
        """回归: 主图 ETH(大标题+价格) 不得被侧栏 SOL/BTC 列表项抢占 (2026-11-11 实测踩坑)。"""
        texts = [
            'okx.com',
            'ETHUSDT 永续',
            '2,200.80',
            '+34.12 (+3.42%)',
            '指数价格 标记价格 资金费率(8小时)/倒计时 -0.00131%',
            '1分 5分 15分 1小时 4小时 1日',
            '最新价/涨跌幅',
            '2,200.80 涨跌+0.00(+0.00%）振幅0.00%',
            '订单表 价格(USDT) 数量(USDT)',
            'BTCUSDT 永续 73,471.6 +0.40%',
            'SOLUSDT 永续 82.76 +0.64%',
        ]
        result = extract_crypto_info(texts)
        self.assertEqual(result['coin_symbol'], 'ETH', '主图 ETHUSDT 不得被侧栏 SOL/BTC 抢占')


class TestSymbolNormalise(unittest.TestCase):
    def test_plain(self):
        self.assertEqual(normalise_symbol('BTC'), ('BTC', 'USDT'))

    def test_pair_formats(self):
        self.assertEqual(normalise_symbol('BTCUSDT'), ('BTC', 'USDT'))
        self.assertEqual(normalise_symbol('btc-usdt'), ('BTC', 'USDT'))
        self.assertEqual(normalise_symbol('ETH/USDT'), ('ETH', 'USDT'))
        self.assertEqual(normalise_symbol('$SOL'), ('SOL', 'USDT'))

    def test_alias(self):
        self.assertEqual(normalise_symbol('XBTUSDT'), ('BTC', 'USDT'))

    def test_injection_blocked(self):
        """URL 参数注入必须被清洗。"""
        base, quote = normalise_symbol('BTCUSDT&limit=1')
        self.assertNotIn('&', base)
        self.assertRegex(base, r'^[A-Z0-9]+$')
        base2, _ = normalise_symbol('ETH?foo=bar')
        self.assertRegex(base2, r'^[A-Z0-9]+$')


class TestCryptoApiSourceDispatch(unittest.TestCase):
    """回归: _pick_source_for 必须透传 period/count 给 kline()。"""

    def test_kline_dispatch_passes_args(self):
        from services.market_data.crypto_api import CryptoAPI

        class FakeSource:
            name = 'fake'
            def __init__(self):
                self.calls = []
            def ticker(self, base, quote):
                return None
            def kline(self, base, quote, period, count):
                self.calls.append((base, quote, period, count))
                return [{'time': '2026-01-01', 'open': 1, 'high': 2,
                         'low': 0.5, 'close': 1.5, 'volume': 10, 'turnover': 15}]

        api = CryptoAPI()
        fake = FakeSource()
        api._sources = [fake]
        result = api.getKlineData('ETH', 'daily', 30)
        self.assertTrue(result['success'])
        self.assertEqual(fake.calls, [('ETH', 'USDT', 'daily', 30)])
        self.assertIn('code', result)  # KlineResult 契约要求 code 字段

    def test_period_map_covers_chart_periods(self):
        """前端 StockChart 的周期必须全部有映射。"""
        for p in ('daily', 'weekly', 'monthly', '60min', '30min', '15min', '5min'):
            self.assertIn(p, _PERIOD_MAP, f'周期 {p} 缺少映射')


if __name__ == '__main__':
    unittest.main()
