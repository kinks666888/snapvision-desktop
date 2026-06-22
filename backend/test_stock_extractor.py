"""
test_stock_extractor.py — Stock Extractor 测试套件

测试场景:
  1. 雪球截图 — 完整股票信息提取
  2. 东方财富截图 — 含技术指标
  3. 纯噪声截图 — has_stock_data=false
  4. 边界情况 — 缺失字段、异常格式

运行方式:
    cd backend && python3 -m pytest test_stock_extractor.py -v
    # 或直接运行:
    python3 test_stock_extractor.py
"""

import sys
import json
import unittest

sys.path.insert(0, '.')
from stock_extractor import extract_stock_info, filter_texts, _is_noise


# ═══════════════════════════════════════════════════════════════
# 模拟数据
# ═══════════════════════════════════════════════════════════════

# 场景 1: 雪球 App 截图 OCR 输出
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
    '总市值 320亿',
    '流通市值 280亿',
    '量比 1.23',
    '振幅 3.45%',
    'MA5 158.32', 'MA10 156.89', 'MA20 153.21', 'MA60 145.67',
    'MACD DIF 1.23 DEA 0.89 MACD 0.34',
    'KDJ K 65.2 D 58.1 J 79.4',
    'RSI6 62.3 RSI14 55.1',
    'BOLL UP 165.2 MID 158.3 DN 151.4',
    '帖子: 这只票今天好强',            # 社交内容
    '回复 15',                         # 互动
    '评论: 明天还能追吗？',            # 评论
]

# 场景 2: 东方财富 App 截图 OCR 输出 (侧重技术指标)
EASTMONEY_SAMPLE = [
    '东方财富',
    '行情', '自选', '交易', '资讯', '我的',
    'Level-2', 'VIP',                 # 软件UI
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
    '总市值 2.11万亿',
    '流通市值 2.11万亿',
    '振幅 1.39%',
    '量比 0.85',
    'MA5 1692.30', 'MA10 1705.60', 'MA20 1688.40', 'MA60 1720.10',
    'DIF -8.52 DEA -5.31 MACD -3.21',
    'K 32.5 D 38.2 J 21.1',
    'RSI6 42.1 RSI14 45.8 RSI24 48.3',
    'BOLL 上 1735.2 中 1698.4 下 1661.6',
    '登录/注册',
    '模拟交易',
]

# 场景 3: 纯噪声 — 非股票截图
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

# 场景 4: 边界情况 — 最简股票信息
MINIMAL_SAMPLE = [
    '宁德时代',
    '300750',
    '205.30',
    '+3.25%',
]


# ═══════════════════════════════════════════════════════════════
# 测试类
# ═══════════════════════════════════════════════════════════════

class TestNoiseFiltering(unittest.TestCase):
    """噪声过滤测试"""

    def test_filters_browser_noise(self):
        self.assertTrue(_is_noise('chatgpt.com')[0])
        self.assertTrue(_is_noise('chrome')[0])
        self.assertTrue(_is_noise('https://example.com/page')[0])

    def test_filters_app_ui(self):
        self.assertTrue(_is_noise('下载App')[0])
        self.assertTrue(_is_noise('首页')[0])
        self.assertTrue(_is_noise('AI')[0])
        self.assertTrue(_is_noise('登录')[0])
        self.assertTrue(_is_noise('搜索')[0])

    def test_filters_social_content(self):
        self.assertTrue(_is_noise('帖子: 这只票今天好强')[0])
        self.assertTrue(_is_noise('回复 15')[0])
        self.assertTrue(_is_noise('评论: 明天还能追吗？')[0])

    def test_filters_ads_and_promotions(self):
        self.assertTrue(_is_noise('广告: 开户送 Level-2')[0])
        self.assertTrue(_is_noise('推广')[0])

    def test_preserves_stock_data(self):
        self.assertFalse(_is_noise('麦格米特')[0])
        self.assertFalse(_is_noise('SZ002851')[0])
        self.assertFalse(_is_noise('161.79')[0])
        self.assertFalse(_is_noise('+8.58%')[0])
        self.assertFalse(_is_noise('MA5 158.32')[0])
        self.assertFalse(_is_noise('成交量 15.6万手')[0])

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
        cls.result = extract_stock_info(XUEQIU_SAMPLE)

    def test_has_stock_data(self):
        self.assertTrue(self.result['has_stock_data'])

    def test_source_is_ocr(self):
        self.assertEqual(self.result['source'], 'ocr')

    def test_stock_section_exists(self):
        self.assertIsNotNone(self.result.get('stock'))

    def test_stock_name(self):
        self.assertEqual(self.result['stock']['name']['value'], '麦格米特')
        self.assertGreater(self.result['stock']['name']['confidence'], 0.5)

    def test_stock_code(self):
        self.assertEqual(self.result['stock']['code']['value'], 'SZ002851')
        self.assertGreater(self.result['stock']['code']['confidence'], 0.5)

    def test_current_price(self):
        self.assertEqual(self.result['stock']['current_price']['value'], '161.79')
        self.assertGreater(self.result['stock']['current_price']['confidence'], 0.5)

    def test_change_amount(self):
        self.assertEqual(self.result['stock']['change_amount']['value'], '+12.79')

    def test_change_percent(self):
        self.assertEqual(self.result['stock']['change_percent']['value'], '+8.58%')

    def test_basic_indicators(self):
        s = self.result['stock']
        self.assertEqual(s['high']['value'], '163.63')
        self.assertEqual(s['low']['value'], '149.13')
        self.assertEqual(s['open']['value'], '159.00')
        self.assertEqual(s['prev_close']['value'], '149.00')

    def test_volume(self):
        self.assertEqual(self.result['stock']['volume']['value'], '15.60万手')

    def test_turnover(self):
        self.assertEqual(self.result['stock']['turnover']['value'], '2.50亿')

    def test_turnover_rate(self):
        self.assertEqual(self.result['stock']['turnover_rate']['value'], '+5.23%')

    def test_valuation_metrics(self):
        s = self.result['stock']
        self.assertEqual(s['pe']['value'], '35.20')
        self.assertEqual(s['pb']['value'], '4.80')
        self.assertEqual(s['total_market_cap']['value'], '320.00亿')
        self.assertEqual(s['circulating_market_cap']['value'], '280.00亿')

    def test_volume_ratio(self):
        self.assertEqual(self.result['stock']['volume_ratio']['value'], '1.23')

    def test_amplitude(self):
        self.assertEqual(self.result['stock']['amplitude']['value'], '+3.45%')

    def test_technical_section_exists(self):
        self.assertIsNotNone(self.result.get('technical'))

    def test_ma_indicators(self):
        t = self.result['technical']
        self.assertEqual(t['ma5']['value'], '158.32')
        self.assertEqual(t['ma10']['value'], '156.89')
        self.assertEqual(t['ma20']['value'], '153.21')
        self.assertEqual(t['ma60']['value'], '145.67')

    def test_macd_indicators(self):
        t = self.result['technical']
        self.assertEqual(t['macd_dif']['value'], '1.23')
        self.assertEqual(t['macd_dea']['value'], '0.89')
        self.assertEqual(t['macd_bar']['value'], '0.34')

    def test_kdj_indicators(self):
        t = self.result['technical']
        self.assertEqual(t['kdj_k']['value'], '65.20')
        self.assertEqual(t['kdj_d']['value'], '58.10')
        self.assertEqual(t['kdj_j']['value'], '79.40')

    def test_rsi_indicators(self):
        t = self.result['technical']
        self.assertEqual(t['rsi6']['value'], '62.30')
        self.assertEqual(t['rsi14']['value'], '55.10')

    def test_boll_indicators(self):
        t = self.result['technical']
        self.assertEqual(t['boll_upper']['value'], '165.20')
        self.assertEqual(t['boll_mid']['value'], '158.30')
        self.assertEqual(t['boll_lower']['value'], '151.40')

    def test_analysis_exists(self):
        self.assertIsNotNone(self.result.get('analysis'))
        self.assertIsInstance(self.result['analysis']['summary'], str)
        self.assertGreater(len(self.result['analysis']['summary']), 0)

    def test_analysis_mentions_trend(self):
        summary = self.result['analysis']['summary']
        # 涨跌幅 +8.58%, 应该提到上涨
        self.assertTrue('上涨' in summary or '涨' in summary)

    def test_analysis_has_bullish_signals(self):
        self.assertIsInstance(self.result['analysis']['bullish_signals'], list)
        self.assertGreater(len(self.result['analysis']['bullish_signals']), 0)

    def test_analysis_has_bearish_signals(self):
        self.assertIsInstance(self.result['analysis']['bearish_signals'], list)

    def test_analysis_has_risk_warning(self):
        self.assertIsInstance(self.result['analysis']['risk_warning'], str)
        self.assertGreater(len(self.result['analysis']['risk_warning']), 0)

    def test_analysis_has_confidence(self):
        self.assertIsInstance(self.result['analysis']['confidence'], (int, float))
        self.assertGreater(self.result['analysis']['confidence'], 0)
        self.assertLessEqual(self.result['analysis']['confidence'], 1.0)

    def test_analysis_has_disclaimer(self):
        self.assertIsInstance(self.result['analysis']['disclaimer'], str)
        self.assertIn('投资建议', self.result['analysis']['disclaimer'])

    def test_signals_tagged(self):
        """所有信号应有 [截图识别] 或 [AI推断] 标签"""
        for s in self.result['analysis']['bullish_signals']:
            self.assertTrue('[截图识别]' in s or '[AI推断]' in s,
                            f'Signal missing tag: {s}')
        for s in self.result['analysis']['bearish_signals']:
            self.assertTrue('[截图识别]' in s or '[AI推断]' in s,
                            f'Signal missing tag: {s}')

    def test_no_noise_in_output(self):
        """确保噪声文本未出现在任何输出字段中"""
        output_json = json.dumps(self.result, ensure_ascii=False)
        self.assertNotIn('chatgpt.com', output_json)
        self.assertNotIn('下载App', output_json)
        self.assertNotIn('广告', output_json)
        self.assertNotIn('评论', output_json)

    def test_output_json_stable(self):
        """输出结构稳定"""
        required_keys = {'source', 'stock', 'technical', 'analysis', 'has_stock_data', 'low_confidence_warning', 'confidence_warnings'}
        for key in required_keys:
            self.assertIn(key, self.result, f'Missing key: {key}')


class TestEastmoneyExtraction(unittest.TestCase):
    """东方财富截图 — 技术指标侧重测试"""

    @classmethod
    def setUpClass(cls):
        cls.result = extract_stock_info(EASTMONEY_SAMPLE)

    def test_has_stock_data(self):
        self.assertTrue(self.result['has_stock_data'])

    def test_stock_name_code(self):
        self.assertEqual(self.result['stock']['name']['value'], '贵州茅台')
        self.assertEqual(self.result['stock']['code']['value'], 'SH600519')

    def test_price_negative_change(self):
        """负涨跌幅应正确显示"""
        self.assertEqual(self.result['stock']['change_amount']['value'], '-15.30')
        self.assertEqual(self.result['stock']['change_percent']['value'], '-0.90%')

    def test_large_market_cap(self):
        """万亿市值格式化"""
        self.assertIn('万亿', self.result['stock']['total_market_cap']['value'])

    def test_macd_negative(self):
        """MACD 负值"""
        t = self.result['technical']
        self.assertEqual(t['macd_dif']['value'], '-8.52')

    def test_kdj_values(self):
        t = self.result['technical']
        self.assertEqual(t['kdj_k']['value'], '32.50')
        self.assertEqual(t['kdj_j']['value'], '21.10')

    def test_rsi_values(self):
        t = self.result['technical']
        self.assertEqual(t['rsi6']['value'], '42.10')
        self.assertEqual(t['rsi14']['value'], '45.80')
        self.assertEqual(t['rsi24']['value'], '48.30')

    def test_analysis_mentions_decline(self):
        summary = self.result['analysis']['summary']
        # 跌幅 -0.90%
        self.assertTrue('下跌' in summary or '跌' in summary)


class TestNoiseOnly(unittest.TestCase):
    """纯噪声截图 — 无股票数据"""

    @classmethod
    def setUpClass(cls):
        cls.result = extract_stock_info(NOISE_ONLY_SAMPLE)

    def test_has_stock_data_false(self):
        self.assertFalse(self.result['has_stock_data'])

    def test_stock_fields_null(self):
        s = self.result['stock']
        self.assertIsNone(s['name']['value'])
        self.assertIsNone(s['code']['value'])
        self.assertIsNone(s['current_price']['value'])

    def test_technical_empty(self):
        t = self.result['technical']
        for key, val in t.items():
            self.assertIsNone(val['value'], f'technical.{key}.value should be None, got {val["value"]}')

    def test_analysis_fallback(self):
        # 纯噪声样本全部被过滤 → 提示无有效文本 或 信息不足
        summary = self.result['analysis']['summary']
        self.assertTrue('信息不足' in summary or '无有效文本' in summary or '过滤' in summary)


class TestMinimalExtraction(unittest.TestCase):
    """最简股票信息 — 边界情况"""

    @classmethod
    def setUpClass(cls):
        cls.result = extract_stock_info(MINIMAL_SAMPLE)

    def test_has_stock_data(self):
        self.assertTrue(self.result['has_stock_data'])

    def test_name_code(self):
        self.assertEqual(self.result['stock']['name']['value'], '宁德时代')
        self.assertEqual(self.result['stock']['code']['value'], 'SZ300750')

    def test_price(self):
        self.assertEqual(self.result['stock']['current_price']['value'], '205.30')

    def test_change_percent(self):
        self.assertEqual(self.result['stock']['change_percent']['value'], '+3.25%')

    def test_missing_fields_are_null(self):
        s = self.result['stock']
        self.assertIsNone(s['high']['value'])
        self.assertIsNone(s['low']['value'])
        self.assertIsNone(s['volume']['value'])

    def test_technical_all_null(self):
        t = self.result['technical']
        for key, val in t.items():
            self.assertIsNone(val['value'], f'technical.{key}.value should be None')

    def test_analysis_still_generated(self):
        """即使数据不完整也应生成分析"""
        self.assertIsInstance(self.result['analysis']['summary'], str)
        self.assertGreater(len(self.result['analysis']['summary']), 0)


# ═══════════════════════════════════════════════════════════════
# v2.0 新增测试
# ═══════════════════════════════════════════════════════════════

class TestConfidenceOutput(unittest.TestCase):
    """置信度输出格式验证"""

    @classmethod
    def setUpClass(cls):
        cls.result = extract_stock_info(MINIMAL_SAMPLE)

    def test_stock_fields_have_value_and_confidence(self):
        s = self.result['stock']
        for key in s:
            entry = s[key]
            self.assertIsInstance(entry, dict, f'{key} should be dict')
            self.assertIn('value', entry, f'{key} missing "value"')
            self.assertIn('confidence', entry, f'{key} missing "confidence"')
            self.assertIsInstance(entry['confidence'], (int, float))

    def test_confidence_in_range(self):
        for section in [self.result['stock'], self.result['technical']]:
            for key, entry in section.items():
                c = entry['confidence']
                self.assertTrue(0.0 <= c <= 1.0, f'{key} confidence {c} out of range')

    def test_name_confidence_high(self):
        """名称提取自信度应 ≥ 0.70"""
        self.assertGreaterEqual(self.result['stock']['name']['confidence'], 0.70)

    def test_missing_field_confidence_zero(self):
        """缺失字段置信度为 0"""
        self.assertEqual(self.result['stock']['high']['confidence'], 0.0)
        self.assertIsNone(self.result['stock']['high']['value'])


class TestConfidenceWarning(unittest.TestCase):
    """低置信度警告测试"""

    def test_warning_on_minimal_data(self):
        """只有名称+代码+价格 → 应该有警告"""
        result = extract_stock_info(['宁德时代', '300750', '205.30'])
        self.assertTrue(result['low_confidence_warning'])
        self.assertGreater(len(result['confidence_warnings']), 0)

    def test_no_warning_on_full_data(self):
        """完整股票数据 → 不应该有严重警告"""
        result = extract_stock_info(XUEQIU_SAMPLE)
        # 雪球样本有完整数据，关键字段不应有严重警告
        # （如果有警告，应该只是关于非关键字段）
        critical_warnings = [w for w in result['confidence_warnings']
                             if '关键字段' in w]
        self.assertEqual(len(critical_warnings), 0,
                         f'Unexpected critical warnings: {critical_warnings}')


class TestDeduplication(unittest.TestCase):
    """去重逻辑验证"""

    def test_exact_duplicates_removed(self):
        from stock_extractor import _deduplicate_texts
        texts = ['苹果', '苹果', '香蕉', '苹果']
        result = _deduplicate_texts(texts)
        self.assertEqual(result, ['苹果', '香蕉'])

    def test_similar_stock_lines_preserved(self):
        """MA5, MA10, MA20 等相似行应全部保留"""
        from stock_extractor import _deduplicate_texts
        texts = ['MA5 158.32', 'MA10 156.89', 'MA20 153.21', 'MA60 145.67']
        result = _deduplicate_texts(texts)
        self.assertEqual(result, texts)  # 全部保留

    def test_empty_list(self):
        from stock_extractor import _deduplicate_texts
        self.assertEqual(_deduplicate_texts([]), [])


class TestScreenshotClassifier(unittest.TestCase):
    """截图分类器测试"""

    def test_stock_screenshot_detected(self):
        from screenshot_classifier import classify_screenshot
        result = classify_screenshot(XUEQIU_SAMPLE)
        self.assertEqual(result['type'], 'stock')
        self.assertGreater(result['confidence'], 0.7)

    def test_noise_screenshot_is_non_stock(self):
        from screenshot_classifier import classify_screenshot
        result = classify_screenshot(NOISE_ONLY_SAMPLE)
        self.assertNotEqual(result['type'], 'stock',
                            'Noise-only sample should not be classified as stock')
        self.assertIn(result['type'], ['web', 'chat', 'other'])

    def test_empty_texts(self):
        from screenshot_classifier import classify_screenshot
        result = classify_screenshot([])
        self.assertEqual(result['type'], 'other')

    def test_classifier_returns_indicators(self):
        from screenshot_classifier import classify_screenshot
        result = classify_screenshot(XUEQIU_SAMPLE)
        self.assertIn('indicators', result)
        self.assertIn('stock', result['indicators'])
        self.assertIn('reason', result)


class TestDebugMode(unittest.TestCase):
    """调试模式输出完整性"""

    def test_debug_mode_returns_debug_info(self):
        result = extract_stock_info(MINIMAL_SAMPLE, debug=True)
        self.assertIn('debug_info', result)
        d = result['debug_info']
        self.assertIn('raw_ocr', d)
        self.assertIn('filter', d)
        self.assertIn('field_extractions', d)
        self.assertIn('final_json', d)

    def test_debug_mode_false_no_debug_info(self):
        result = extract_stock_info(MINIMAL_SAMPLE, debug=False)
        self.assertNotIn('debug_info', result)

    def test_debug_raw_ocr_contains_input(self):
        result = extract_stock_info(MINIMAL_SAMPLE, debug=True)
        d = result['debug_info']
        self.assertEqual(d['raw_ocr']['texts'], MINIMAL_SAMPLE)

    def test_debug_filter_tracks_removed(self):
        result = extract_stock_info(XUEQIU_SAMPLE, debug=True)
        d = result['debug_info']
        # 雪球样本中应有被过滤的项目
        removed_count = d['filter']['removed_count']
        self.assertGreater(removed_count, 0,
                           'Xueqiu sample should have noise items removed')
        # 检查所有被过滤项都有原因
        for item in d['filter']['removed_items']:
            self.assertIn('text', item)
            self.assertIn('reason', item)
            self.assertIn('category', item)

    def test_debug_field_extractions_exist(self):
        result = extract_stock_info(MINIMAL_SAMPLE, debug=True)
        fe = result['debug_info']['field_extractions']
        # 至少应记录名称和代码的提取
        fields = [e['field'] for e in fe]
        self.assertIn('name', fields)
        self.assertIn('code', fields)


# ═══════════════════════════════════════════════════════════════
# 运行
# ═══════════════════════════════════════════════════════════════

if __name__ == '__main__':
    unittest.main(verbosity=2)
