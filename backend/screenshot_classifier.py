"""
Screenshot Classifier — 截图类型检测（阶段一）

在 OCR 完成后、股票提取前，先判断截图类型。
根据 OCR 文本中的关键词/模式打分，识别六种类型：
  - stock:     股票行情页（东方财富、雪球、同花顺、TradingView 等）
  - web:       普通网页（含浏览器 UI）
  - chat:      聊天记录（微信、QQ、钉钉等）
  - pdf:       PDF 文档
  - document:  文档/表格（Word、Excel、记事本等）
  - other:     其他图片

返回类型 + 置信度 + 判断依据，供后续流程分支使用。
"""

from __future__ import annotations
import re
from typing import Optional


# ═══════════════════════════════════════════════════════════════
# 截图类型
# ═══════════════════════════════════════════════════════════════

ScreenshotType = str  # 'stock' | 'web' | 'chat' | 'pdf' | 'document' | 'other'


# ═══════════════════════════════════════════════════════════════
# 股票行情页特征
# ═══════════════════════════════════════════════════════════════

# 强特征：出现任意一个即强烈指向股票截图
STOCK_STRONG_KEYWORDS: list[str] = [
    # 行情基本字段
    '今开', '昨收', '开盘价', '收盘价',
    '最高价', '最低价', '日内最高', '日内最低',
    '成交量', '成交额', '成交金额',
    '换手率', '换手',
    '市盈率', '市净率', '市盈', '市净',
    '总市值', '流通市值',
    '量比', '振幅', '委比',

    # 技术指标
    'MA5', 'MA10', 'MA20', 'MA60', 'MA120', 'MA250',
    'MACD', 'DIF', 'DEA',
    'KDJ', 'RSI', 'BOLL',
    '布林上轨', '布林中轨', '布林下轨',
    '威廉', '乖离',

    # 股票特有UI
    '涨停', '跌停',
    '分时', '五日', '日K', '周K', '月K',
    '融资融券', '两融',
    '龙虎榜',
]

# 弱特征：出现较多时指向股票截图
STOCK_WEAK_KEYWORDS: list[str] = [
    '涨跌幅', '涨跌额',
    '最高', '最低',
    '总手', '现手',
    '内盘', '外盘',
    '委差', '委比',
    '流通', '总股本',
    '板块', '行业', '概念',
    '上证', '深证', '创业板', '科创板', '北证',
    '沪深', '港股', '美股',
]

# 股票代码模式
STOCK_CODE_PATTERN = re.compile(
    r'(SZ|SH|BJ|HK|sh|sz|bj|hk)\s*\d{5,8}|'
    r'\b(600|601|603|605|688|000|001|002|003|300|301)\d{3}\b|'
    r'\b(400|430|830|831|832|833|834|835|836|837|838|839|870|871|872|873|874|875|876|877|878|879|920|921|922|923|924|925|926|927|928|929)\d{3}\b|'
    r'\b\d{5}\b.*[HK港股]'
)

# 股票行情平台品牌词
STOCK_PLATFORM_KEYWORDS: list[str] = [
    '东方财富', '东方', '天天基金',
    '雪球', 'xueqiu',
    '同花顺', 'THS',
    'TradingView', 'tradingview',
    '富途', 'futu', 'moomoo',
    '老虎', 'tiger',
    '新浪财经', '腾讯自选股',
    '通达信', '大智慧',
    '涨乐', '华泰', '中信',
    '自选股',
]

# 股票特色 UI 元素
STOCK_UI_PATTERNS: list[str] = [
    r'[买买卖][1-5]\s',
    r'卖[1-5]\s',
    r'买[1-5]\s',
    r'涨停价',
    r'跌停价',
    r'委[买卖]\s',
    r'盘口',
]


def _count_keyword_hits(texts: list[str], keywords: list[str]) -> int:
    """统计关键词在 texts 中的命中次数（每行最多计一次）"""
    count = 0
    for text in texts:
        for kw in keywords:
            if kw in text:
                count += 1
                break  # 每行只计一次
    return count


def _count_pattern_hits(texts: list[str], patterns: list[str]) -> int:
    """统计正则模式在 texts 中的命中次数"""
    count = 0
    compiled = [re.compile(p) for p in patterns]
    for text in texts:
        for pat in compiled:
            if pat.search(text):
                count += 1
                break
    return count


def _has_stock_code(texts: list[str]) -> bool:
    """检测是否存在股票代码"""
    for text in texts:
        if STOCK_CODE_PATTERN.search(text):
            return True
    return False


# ═══════════════════════════════════════════════════════════════
# 网页特征
# ═══════════════════════════════════════════════════════════════

WEB_STRONG_KEYWORDS: list[str] = [
    'https://', 'http://', 'www.',
    '.com', '.cn', '.net', '.org', '.io',
    'chrome', 'safari', 'firefox', 'edge',
    '标签页', '浏览器',
    '地址栏', '搜索栏', '书签',
    'Cookie', 'cookies',
    '无障碍', 'Accessibility',
]

WEB_WEAK_KEYWORDS: list[str] = [
    '首页', '关于我们', '联系我们',
    '登录', '注册', '退出登录',
    '导航', '菜单', '面包屑',
    '版权', 'ICP', '备案',
    '隐私政策', '服务条款', '用户协议',
    'All Rights Reserved', '©',
]

# ═══════════════════════════════════════════════════════════════
# 聊天记录特征
# ═══════════════════════════════════════════════════════════════

CHAT_STRONG_KEYWORDS: list[str] = [
    '微信', 'WeChat',
    'QQ', '钉钉',
    '飞书', 'Lark',
    'Telegram', 'WhatsApp',
    '聊天记录', '群聊',
    '对方正在输入', '正在输入',
    '语音通话', '视频通话',
    '消息免打扰', '置顶聊天',
]

CHAT_WEAK_KEYWORDS: list[str] = [
    '撤回', '已读', '未读',
    '转发', '分享',
    '表情', '贴图',
    '文件传输', '图片',
    '@', '群公告',
    '群成员', '解散',
    '添加好友', '通过验证',
]

# 聊天时间戳模式
CHAT_TIME_PATTERNS: list[str] = [
    r'\d{1,2}:\d{2}\s*(AM|PM|上午|下午)?',
    r'(今天|昨天|前天|星期[一二三四五六日])\s+\d{1,2}:\d{2}',
    r'\d{4}年\d{1,2}月\d{1,2}日\s+\d{1,2}:\d{2}',
]

# 聊天消息气泡特征（行首有昵称+冒号）
CHAT_MSG_PATTERN = re.compile(
    r'^.{1,12}[：:].{1,}'  # 昵称:消息内容
)

# 聊天特有的数字模式（消息计数）
CHAT_COUNT_PATTERNS: list[str] = [
    r'\d+\s*条未读',
    r'\d+\s*条消息',
    r'\(\d+\)\s*$',  # 未读角标
]


# ═══════════════════════════════════════════════════════════════
# PDF 特征
# ═══════════════════════════════════════════════════════════════

PDF_KEYWORDS: list[str] = [
    'PDF', '.pdf',
    'Adobe', 'Acrobat',
    r'第\s*\d+\s*页', r'共\s*\d+\s*页',
    '目录', 'Table of Contents',
    '第[一二三四五六七八九十百千]章',
    '参考文献', 'References',
    '附录', 'Appendix',
    '摘要', 'Abstract',
    '关键词', 'Keywords',
]

PDF_PATTERNS: list[str] = [
    r'^\d+\s*/\s*\d+\s*$',   # 页码 1/10
    r'^-\s*\d+\s*-$',         # 页码 - 5 -
    r'第[一二三四五六七八九十百千]+[章节]',
]


# ═══════════════════════════════════════════════════════════════
# 文档/表格特征
# ═══════════════════════════════════════════════════════════════

DOCUMENT_KEYWORDS: list[str] = [
    'Word', 'Excel', 'WPS',
    '文档', '表格', '演示文稿',
    '工作表', 'Sheet',
    '单元格', '公式',
    '合并单元格', '筛选',
    '数据透视表',
    '批注', '修订',
    '页眉', '页脚', '页码',
]

DOCUMENT_PATTERNS: list[str] = [
    r'Sheet\d+',
    r'[A-Z]+\d+',  # 单元格坐标 A1, B2
]


# ═══════════════════════════════════════════════════════════════
# 分类器核心
# ═══════════════════════════════════════════════════════════════

def classify_screenshot(
    texts: list[str],
    ocr_confidence: Optional[float] = None,
) -> dict:
    """
    根据 OCR 文本判断截图类型。

    参数:
        texts: OCR 原始文本列表（未过滤）
        ocr_confidence: OCR 整体置信度（可选，作为辅助参考）

    返回:
        {
            "type": "stock" | "web" | "chat" | "pdf" | "document" | "other",
            "confidence": 0.0–1.0,
            "indicators": {
                "stock": {"strong_hits": N, "weak_hits": N, "has_code": bool, ...},
                "web": {"strong_hits": N, "weak_hits": N, ...},
                ...
            },
            "reason": "简短说明",
        }
    """
    if not texts:
        return {
            'type': 'other',
            'confidence': 0.5,
            'indicators': {},
            'reason': 'OCR 无输出文本',
        }

    # ── 收集各类型指标 ──────────────────────────────────────────

    # Stock
    stock_strong = _count_keyword_hits(texts, STOCK_STRONG_KEYWORDS)
    stock_weak = _count_keyword_hits(texts, STOCK_WEAK_KEYWORDS)
    stock_code = _has_stock_code(texts)
    stock_platform = _count_keyword_hits(texts, STOCK_PLATFORM_KEYWORDS)
    stock_ui = _count_pattern_hits(texts, STOCK_UI_PATTERNS)

    # Web
    web_strong = _count_keyword_hits(texts, WEB_STRONG_KEYWORDS)
    web_weak = _count_keyword_hits(texts, WEB_WEAK_KEYWORDS)

    # Chat
    chat_strong = _count_keyword_hits(texts, CHAT_STRONG_KEYWORDS)
    chat_weak = _count_keyword_hits(texts, CHAT_WEAK_KEYWORDS)
    chat_time = _count_pattern_hits(texts, CHAT_TIME_PATTERNS)
    chat_msg = sum(1 for t in texts if CHAT_MSG_PATTERN.match(t))
    chat_count = _count_pattern_hits(texts, CHAT_COUNT_PATTERNS)

    # PDF
    pdf_kw = _count_keyword_hits(texts, PDF_KEYWORDS)
    pdf_pat = _count_pattern_hits(texts, PDF_PATTERNS)

    # Document
    doc_kw = _count_keyword_hits(texts, DOCUMENT_KEYWORDS)
    doc_pat = _count_pattern_hits(texts, DOCUMENT_PATTERNS)

    # ── 计算各类型得分 ──────────────────────────────────────────

    total_lines = max(len(texts), 1)

    # Stock 得分: 强特征权重最高
    stock_score = (
        (stock_strong * 15.0) +
        (stock_weak * 3.0) +
        (stock_code * 20.0) +
        (stock_platform * 10.0) +
        (stock_ui * 8.0)
    ) / max(total_lines, 1)

    # Web 得分
    web_score = (
        (web_strong * 12.0) +
        (web_weak * 2.0)
    ) / max(total_lines, 1)

    # Chat 得分
    chat_score = (
        (chat_strong * 15.0) +
        (chat_weak * 3.0) +
        (chat_time * 4.0) +
        (chat_msg * 5.0) +
        (chat_count * 3.0)
    ) / max(total_lines, 1)

    # PDF 得分
    pdf_score = (
        (pdf_kw * 10.0) +
        (pdf_pat * 5.0)
    ) / max(total_lines, 1)

    # Document 得分
    doc_score = (
        (doc_kw * 10.0) +
        (doc_pat * 5.0)
    ) / max(total_lines, 1)

    # ── 决策 ────────────────────────────────────────────────────

    indicators = {
        'stock': {
            'strong_hits': stock_strong,
            'weak_hits': stock_weak,
            'has_code': stock_code,
            'platform_hits': stock_platform,
            'ui_hits': stock_ui,
            'score': round(stock_score, 2),
        },
        'web': {
            'strong_hits': web_strong,
            'weak_hits': web_weak,
            'score': round(web_score, 2),
        },
        'chat': {
            'strong_hits': chat_strong,
            'weak_hits': chat_weak,
            'time_hits': chat_time,
            'msg_hits': chat_msg,
            'score': round(chat_score, 2),
        },
        'pdf': {
            'kw_hits': pdf_kw,
            'pat_hits': pdf_pat,
            'score': round(pdf_score, 2),
        },
        'document': {
            'kw_hits': doc_kw,
            'pat_hits': doc_pat,
            'score': round(doc_score, 2),
        },
    }

    # 阈值决策
    # 股票特征最明确 → 优先判断
    if stock_code and stock_strong >= 2:
        conf = min(0.95, 0.6 + stock_score * 0.15)
        return {
            'type': 'stock',
            'confidence': round(conf, 2),
            'indicators': indicators,
            'reason': f'检测到股票代码 + {stock_strong} 个行情指标',
        }
    elif stock_strong >= 3 or (stock_code and stock_strong >= 1):
        conf = min(0.90, 0.5 + stock_score * 0.15)
        return {
            'type': 'stock',
            'confidence': round(conf, 2),
            'indicators': indicators,
            'reason': f'检测到 {stock_strong} 个行情指标{"+股票代码" if stock_code else ""}',
        }
    elif stock_strong >= 1 and stock_platform >= 1:
        conf = 0.75
        return {
            'type': 'stock',
            'confidence': conf,
            'indicators': indicators,
            'reason': '检测到股票平台 + 行情指标',
        }

    # Chat
    if chat_strong >= 1 or (chat_msg >= 3 and chat_time >= 1):
        conf = min(0.90, 0.5 + chat_score * 0.2)
        return {
            'type': 'chat',
            'confidence': round(conf, 2),
            'indicators': indicators,
            'reason': f'检测到聊天特征（{chat_msg}条消息模式）',
        }

    # PDF
    if pdf_kw >= 2 or pdf_pat >= 3:
        conf = min(0.90, 0.6 + pdf_score * 0.3)
        return {
            'type': 'pdf',
            'confidence': round(conf, 2),
            'indicators': indicators,
            'reason': f'检测到 {pdf_kw} 个 PDF 关键词',
        }

    # Document
    if doc_kw >= 2:
        conf = min(0.85, 0.5 + doc_score * 0.3)
        return {
            'type': 'document',
            'confidence': round(conf, 2),
            'indicators': indicators,
            'reason': f'检测到 {doc_kw} 个文档关键词',
        }

    # Web (最常见的非股票截图)
    if web_strong >= 1 or web_weak >= 3:
        conf = min(0.80, 0.4 + web_score * 0.2)
        return {
            'type': 'web',
            'confidence': round(conf, 2),
            'indicators': indicators,
            'reason': f'检测到 {web_strong + web_weak} 个网页特征',
        }

    # Default: other
    return {
        'type': 'other',
        'confidence': 0.5,
        'indicators': indicators,
        'reason': '未匹配到明确特征，归类为其他',
    }
