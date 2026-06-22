"""
test_stock_parser.py — Stock Parser 测试套件

测试场景:
  1. 雪球截图 — 完整股票信息提取
  2. 东方财富截图 — 含技术指标（新解析器只输出基本字段）
  3. 纯噪声截图 — 全部字段为 null
  4. 边界情况 — 缺失字段
"""

import sys
import json
import unittest

sys.path.insert(0, '.')
from stock_parser import parse_stock_info, filter_texts, _is_noise


# ═══════════════════════════════════════════════════════════════
# 模拟数据
# ═══════════════════════════════════════════════════════════════

XUEQIU_SAMPLE = [
    'chatgpt.com',                    # 浏览器标签
    '下载App',                         # App 推广
    '首页', 'AI', '搜索', '登录',      # 导航UI
    '用户昵称: 投资达人小王',           # 用户信息
    '广告: 开户送 Level-2',            # 广告
    '麦格米特',                        # ← 股票名称
    'SZ002851',                        # ← 股票代码
    '161.79',                          # ← 当前价格
    '+12.79',                          # ← 涨跌额
    '+8.58%',                          # ← 涨跌幅
    '今开 159.00',
    '昨收 149.00',
    '最高 163.63',
    '最低 149.13',
    '成交量 15.6万手',
    '成交额 2.5亿',
    '换手率 5.23%',
    '市盈率 35.2',
    '市净率 4.8',
    '帖子: 这只票今天好强',            # 社交内容
    '回复 15',                         # 互动
    '评论: 明天还能追吗？',            # 评论
]

EASTMONEY_SAMPLE = [
    '东方财富',
    '行情', '自选', '交易', '资讯', '我的',
    'Level-2', 'VIP',
    '贵州茅台',
    'SH600519',
    '1680.50',
    '-15.30',
    '-0.90%',
    '今开 1698.00',
    '最高 1702.00',
    '最低 1678.50',
    '昨收 1695.80',
    '成交量 3.2万手',
    '成交额 53.6亿',
    '换手率 0.26%',
    '市盈率 28.5',
    '市净率 8.3',
    '登录/注册',
    '模拟交易',
]

NOISE_ONLY_SAMPLE = [
    'chatgpt.com',
    'https://www.example.com/page',
    '下载App',
    'AI',
    '搜索',
    '首页',
    '© 2025 All Rights Reserved',
    '隐私政策',
    '服务条款',
    'ICP备12345678号',
    '评论: 这个功能很好用',
    '点赞 42',
    '回复 7',
    '扫码下载',
    '微信客服',
]

MINIMAL_SAMPLE = [
    '宁德时代',
    '300750',
    '205.30',
    '+3.25%',
]


# ═══════════════════════════════════════════════════════════════
# 测试
# ═══════════════════════════════════════════════════════════════

class TestNoiseFiltering(unittest.TestCase):
    """噪声过滤测试"""

    def test_filters_browser_noise(self):
        self.assertTrue(_is_noise('chatgpt.com'))
        self.assertTrue(_is_noise('https://example.com/page'))

    def test_filters_app_ui(self):
        self.assertTrue(_is_noise('下载App'))
        self.assertTrue(_is_noise('首页'))
        self.assertTrue(_is_noise('AI'))
        self.assertTrue(_is_noise('登录'))

    def test_filters_social_content(self):
        self.assertTrue(_is_noise('帖子: 这只票今天好强'))
        self.assertTrue(_is_noise('回复 15'))
        self.assertTrue(_is_noise('评论: 明天还能追吗？'))

    def test_filters_ads(self):
        self.assertTrue(_is_noise('广告: 开户送 Level-2'))

    def test_preserves_stock_data(self):
        self.assertFalse(_is_noise('麦格米特'))
        self.assertFalse(_is_noise('SZ002851'))
        self.assertFalse(_is_noise('161.79'))
        self.assertFalse(_is_noise('+8.58%'))

    def test_filter_texts_removes_noise(self):
        clean = filter_texts(XUEQIU_SAMPLE)
        self.assertLess(len(clean), len(XUEQIU_SAMPLE))
        self.assertIn('麦格米特', clean)
        self.assertIn('SZ002851', clean)
        self.assertNotIn('chatgpt.com', clean)
        self.assertNotIn('下载App', clean)


class TestXueqiuExtraction(unittest.TestCase):
    """雪球截图 — 完整提取测试"""

    @classmethod
    def setUpClass(cls):
        cls.result = parse_stock_info(XUEQIU_SAMPLE)

    def test_stock_name(self):
        self.assertEqual(self.result['stock_name'], '麦格米特')

    def test_stock_code(self):
        self.assertEqual(self.result['stock_code'], 'SZ002851')

    def test_current_price(self):
        self.assertEqual(self.result['current_price'], '161.79')

    def test_change_amount(self):
        self.assertEqual(self.result['change_amount'], '+12.79')

    def test_change_percent(self):
        self.assertEqual(self.result['change_percent'], '+8.58%')

    def test_high(self):
        self.assertEqual(self.result['high'], '163.63')

    def test_low(self):
        self.assertEqual(self.result['low'], '149.13')

    def test_open(self):
        self.assertEqual(self.result['open'], '159.00')

    def test_volume(self):
        self.assertEqual(self.result['volume'], '15.60万手')

    def test_turnover(self):
        self.assertEqual(self.result['turnover'], '2.50亿')

    def test_turnover_rate(self):
        self.assertEqual(self.result['turnover_rate'], '+5.23%')

    def test_pe(self):
        self.assertEqual(self.result['pe'], '35.20')

    def test_pb(self):
        self.assertEqual(self.result['pb'], '4.80')

    def test_output_has_all_keys(self):
        expected_keys = {
            'stock_name', 'stock_code', 'current_price',
            'change_percent', 'change_amount',
            'open', 'high', 'low',
            'volume', 'turnover', 'turnover_rate',
            'pe', 'pb',
        }
        self.assertEqual(set(self.result.keys()), expected_keys)

    def test_no_noise_in_output(self):
        """确保噪声文本未出现在输出中"""
        output_json = json.dumps(self.result, ensure_ascii=False)
        self.assertNotIn('chatgpt.com', output_json)
        self.assertNotIn('下载App', output_json)


class TestEastmoneyExtraction(unittest.TestCase):
    """东方财富截图 — 基本字段测试"""

    @classmethod
    def setUpClass(cls):
        cls.result = parse_stock_info(EASTMONEY_SAMPLE)

    def test_has_stock_data(self):
        self.assertIsNotNone(self.result['stock_name'])
        self.assertIsNotNone(self.result['stock_code'])

    def test_stock_name(self):
        self.assertEqual(self.result['stock_name'], '贵州茅台')

    def test_stock_code(self):
        self.assertEqual(self.result['stock_code'], 'SH600519')

    def test_price(self):
        self.assertEqual(self.result['current_price'], '1680.50')

    def test_change_amount(self):
        self.assertEqual(self.result['change_amount'], '-15.30')

    def test_change_percent(self):
        self.assertEqual(self.result['change_percent'], '-0.90%')

    def test_high(self):
        self.assertEqual(self.result['high'], '1702.00')

    def test_low(self):
        self.assertEqual(self.result['low'], '1678.50')

    def test_open(self):
        self.assertEqual(self.result['open'], '1698.00')

    def test_volume(self):
        self.assertEqual(self.result['volume'], '3.20万手')

    def test_turnover(self):
        self.assertEqual(self.result['turnover'], '53.60亿')

    def test_turnover_rate(self):
        self.assertEqual(self.result['turnover_rate'], '+0.26%')

    def test_pe(self):
        self.assertEqual(self.result['pe'], '28.50')

    def test_pb(self):
        self.assertEqual(self.result['pb'], '8.30')


class TestNoiseOnly(unittest.TestCase):
    """纯噪声截图 — 全部字段为 null"""

    @classmethod
    def setUpClass(cls):
        cls.result = parse_stock_info(NOISE_ONLY_SAMPLE)

    def test_all_fields_null(self):
        for key, value in self.result.items():
            self.assertIsNone(value, f'{key} should be None, got {value}')

    def test_output_keys(self):
        expected_keys = {
            'stock_name', 'stock_code', 'current_price',
            'change_percent', 'change_amount',
            'open', 'high', 'low',
            'volume', 'turnover', 'turnover_rate',
            'pe', 'pb',
        }
        self.assertEqual(set(self.result.keys()), expected_keys)


class TestMinimalExtraction(unittest.TestCase):
    """最简股票信息 — 边界情况"""

    @classmethod
    def setUpClass(cls):
        cls.result = parse_stock_info(MINIMAL_SAMPLE)

    def test_name(self):
        self.assertEqual(self.result['stock_name'], '宁德时代')

    def test_code(self):
        self.assertEqual(self.result['stock_code'], 'SZ300750')

    def test_price(self):
        self.assertEqual(self.result['current_price'], '205.30')

    def test_change_percent(self):
        self.assertEqual(self.result['change_percent'], '+3.25%')

    def test_missing_fields_are_null(self):
        self.assertIsNone(self.result['high'])
        self.assertIsNone(self.result['low'])
        self.assertIsNone(self.result['volume'])
        self.assertIsNone(self.result['pe'])
        self.assertIsNone(self.result['pb'])


class TestRawOcrDebug(unittest.TestCase):
    """原始 OCR 保留测试"""

    def test_keep_raw_ocr(self):
        result = parse_stock_info(MINIMAL_SAMPLE, keep_raw_ocr=True)
        self.assertIn('_raw_ocr_texts', result)
        self.assertEqual(result['_raw_ocr_texts'], MINIMAL_SAMPLE)

    def test_no_raw_ocr_by_default(self):
        result = parse_stock_info(MINIMAL_SAMPLE)
        self.assertNotIn('_raw_ocr_texts', result)


# ═══════════════════════════════════════════════════════════════
# 运行
# ═══════════════════════════════════════════════════════════════

if __name__ == '__main__':
    unittest.main(verbosity=2)
