"""
US Stock Extractor 单元测试
运行: cd backend && .venv/bin/python -m unittest test_us_stock -v
"""

import unittest

from us_stock_extractor import (
    extract_us_stock_info, detect_us_ticker, detect_us_exchange,
    detect_us_platform, US_TICKERS,
)
from services.market_data.us_stock_api import (
    normalise_us_symbol, is_us_market_open, map_period, YAHOO_INTERVALS,
)


class TestUsTickerDetection(unittest.TestCase):
    def test_dollar_prefix(self):
        texts = ['雪球', '$AAPL 苹果', '189.50 +1.23%']
        r = detect_us_ticker(texts)
        self.assertEqual(r['symbol'], 'AAPL')

    def test_dictionary_word_boundary(self):
        """词典代码必须词边界匹配, 不得被 OPEN/子串误触。"""
        texts = ['TSLA 特斯拉 245.67', 'OPEN 233.11 CLOSE 245.67']
        r = detect_us_ticker(texts)
        self.assertEqual(r['symbol'], 'TSLA')

    def test_cn_name(self):
        texts = ['微软 MSFT', '392.10 +0.85%']
        r = detect_us_ticker(texts)
        self.assertEqual(r['symbol'], 'MSFT')

    def test_spatial_anchor_beats_sidebar(self):
        """回归: 主图 NVDA 大字现价旁, 侧栏 TSLA/AAPL 列表不得抢占。"""
        texts = [
            'nvda 英伟达',
            '189.52',
            '+3.12 (+1.67%)',
            '52周最高 212.30',
            '52周最低 86.62',
            'TSLA 245.67 +0.90%',
            'AAPL 348.51 -0.33%',
        ]
        # 模拟 bbox: 主图文本在左上(x~100), 侧栏在右侧(x~700)
        boxes = [
            [80, 60, 220, 100],     # nvda 英伟达
            [80, 120, 220, 170],    # 189.52 大字
            [80, 190, 220, 220],    # +3.12
            [80, 250, 220, 275],    # 52周最高
            [80, 290, 220, 315],    # 52周最低
            [650, 60, 830, 90],     # TSLA 侧栏
            [650, 110, 830, 140],   # AAPL 侧栏
        ]
        r = detect_us_ticker(texts, boxes)
        self.assertEqual(r['symbol'], 'NVDA', '侧栏不得抢占主图标的')

    def test_blocklist(self):
        texts = ['USD/JPY 汇率', 'CEO 发言', '1.2345']
        r = detect_us_ticker(texts)
        self.assertIsNone(r['symbol'])


class TestUsExtract(unittest.TestCase):
    def test_snowball_screenshot(self):
        texts = [
            '雪球 xueqiu.com',
            '$AAPL 苹果',
            '348.51 +1.25%',
            '今开 346.20 最高 350.10 最低 345.80',
            '成交量 2,971万 成交额 103.2亿',
            '总市值 3.25万亿美元 市盈率TTM 28.6',
            '52周最高 352.10 52周最低 169.21',
            '每股收益 12.15 股息率 0.44%',
        ]
        r = extract_us_stock_info(texts)
        self.assertTrue(r['is_us_stock'])
        self.assertEqual(r['market_type'], 'us_stock')
        self.assertEqual(r['symbol'], 'AAPL')
        self.assertEqual(r['current_price'], '348.51')
        self.assertEqual(r['change_percent'], '+1.25%')
        self.assertEqual(r['high_52w'], '352.1')   # _fmt_price 去尾零
        self.assertEqual(r['low_52w'], '169.21')
        self.assertTrue(r['confidence'] > 0.7)

    def test_futu_screenshot_with_exchange(self):
        texts = [
            '富途牛牛 moomoo',
            'NVDA 英伟达 NASDAQ',
            '189.52 +1.67%',
            '52周最高 212.30',
            '市盈率TTM 45.2',
        ]
        r = extract_us_stock_info(texts)
        self.assertTrue(r['is_us_stock'])
        self.assertEqual(r['symbol'], 'NVDA')
        self.assertEqual(r['exchange'], 'NASDAQ')
        self.assertEqual(r['platform'], '富途')

    def test_crypto_not_misdetected(self):
        """加密截图不得被识别为美股。"""
        texts = [
            'ETHUSDT 永续', '2,056.55', '+34.12 (+1.69%)',
            '资金费率 0.00131% 多空比 1.23', '币安 Binance',
            '爆仓 1.2亿 USDT',
        ]
        r = extract_us_stock_info(texts)
        self.assertFalse(r['is_us_stock'])

    def test_ashare_not_misdetected(self):
        """A股截图不得被识别为美股。"""
        texts = [
            '贵州茅台 600519', '今开 1670.00 昨收 1668.50',
            '成交量 5.62万手 成交额 94.68亿', '换手率 0.38%',
            '市盈率 25.3 市净率 8.1', '涨停 1835.35 跌停 1501.75',
        ]
        r = extract_us_stock_info(texts)
        self.assertFalse(r['is_us_stock'])

    def test_garbled_not_us(self):
        r = extract_us_stock_info(['hello world', 'random noise 12345'])
        self.assertFalse(r['is_us_stock'])

    def test_empty(self):
        r = extract_us_stock_info([])
        self.assertFalse(r['success'])

    def test_xueqiu_sndk_real(self):
        """实测回归: 雪球闪迪截图 (2026-11-11 用户实测踩坑) —
        交易所标签识别 SNDK、$ 大字现价、涨跌额+涨跌幅连排。"""
        texts = [
            '闪迪(NASDAQ:SNDK)',
            '可融资', '可卖空', '加自选',
            '$859.99',
            '12.54万球友关注',
            '-26.52-2.99%',
            '盘前交易11-1016:00:00美东时间',
            '932.78 +72.79+8.46%',
            '最高：914.82', '今开：861.97', '成交量：1379.64万股',
            '52周最高：2354.39', '52周最低：183.00',
            '市盈率(TTM)：6.30', '每股收益：136.50',
            '总市值：1223.67亿',
            '均价:859.45 最新：859.99-26.52-2.99%',
            '946.35', '6.75%',
        ]
        r = extract_us_stock_info(texts)
        self.assertTrue(r['is_us_stock'])
        self.assertEqual(r['symbol'], 'SNDK')          # 不是 None
        self.assertEqual(r['name'], '闪迪')
        self.assertEqual(r['exchange'], 'NASDAQ')
        self.assertEqual(r['current_price'], '859.99')  # 不是 859.7
        self.assertEqual(r['change_percent'], '-2.99%') # 不是 -6.75%
        self.assertEqual(r['high_52w'], '2,354.39')     # 千分位格式
        self.assertEqual(r['low_52w'], '183')


class TestUsExchangePlatform(unittest.TestCase):
    def test_exchange_nasdaq(self):
        self.assertEqual(detect_us_exchange(['NASDAQ 纳斯达克']), 'NASDAQ')

    def test_exchange_nyse(self):
        self.assertEqual(detect_us_exchange(['NYSE 纽交所']), 'NYSE')

    def test_platform(self):
        self.assertIsNotNone(detect_us_platform(['雪球 xueqiu']))

    def test_no_exchange(self):
        self.assertIsNone(detect_us_exchange(['随机文本']))


class TestSymbolNormalise(unittest.TestCase):
    def test_plain(self):
        self.assertEqual(normalise_us_symbol('AAPL'), 'AAPL')

    def test_dollar(self):
        self.assertEqual(normalise_us_symbol('$aapl'), 'AAPL')

    def test_class_share(self):
        self.assertEqual(normalise_us_symbol('BRK.A'), 'BRK-A')
        self.assertEqual(normalise_us_symbol('BRK.B'), 'BRK-B')

    def test_injection_blocked(self):
        """URL 参数注入必须被清洗。"""
        self.assertEqual(normalise_us_symbol('AAPL&foo=1'), 'AAPL')
        self.assertRegex(normalise_us_symbol('TSLA?x=2'), r'^[A-Z.-]+$')

    def test_invalid_fallback(self):
        self.assertEqual(normalise_us_symbol(''), 'AAPL')
        self.assertEqual(normalise_us_symbol('123456'), 'AAPL')


class TestMarketState(unittest.TestCase):
    def test_period_map_covers_chart(self):
        for p in ('daily', 'weekly', 'monthly', '60min', '30min', '15min', '5min'):
            self.assertIn(p, YAHOO_INTERVALS, f'周期 {p} 缺失')

    def test_map_period(self):
        self.assertEqual(map_period('daily'), ('1d', '60d'))
        self.assertEqual(map_period('5min'), ('5m', '5d'))
        self.assertEqual(map_period('unknown'), ('1d', '60d'))

    def test_market_open_state(self):
        """返回值应为四态之一且带中文标签。"""
        state = is_us_market_open()
        self.assertIn(state['state'], ('pre', 'regular', 'post', 'closed'))
        self.assertIn(state['label'], ('盘前交易', '盘中', '盘后交易', '休市'))
        self.assertTrue(state.get('et_time'))


if __name__ == '__main__':
    unittest.main()
