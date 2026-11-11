"""
Stock Extractor — 从 OCR 文本中提取结构化股票信息（阶段二+三增强版）

纯函数模块，不依赖任何外部 API，不联网。

输入：OCR 原始文本列表 list[str]
输出：结构化股票数据（含每字段置信度）+ 可选的调试信息

变更 (v2.0):
  - 噪声过滤器按类别分组，带 reason 标签
  - 新增 FilterDecision 数据类追踪过滤决策
  - 新增去重逻辑
  - 每字段输出 {value, confidence} 格式（集成 field_confidence 引擎）
  - 关键字段低置信度时设置 low_confidence_warning
  - 支持 debug 模式（通过 DebugCollector 记录全流程）
"""

from __future__ import annotations
import re
import logging
from typing import Optional, Any
from dataclasses import dataclass, field

from field_confidence import (
    score_all_fields,
    check_confidence_warning,
    get_method_confidence,
)
from debug_collector import DebugCollector

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════
# 噪声过滤器（阶段二增强 — 按类别分组 + reason 标签）
# ═══════════════════════════════════════════════════════════════

@dataclass
class FilterDecision:
    """单条文本的过滤决策"""
    text: str
    kept: bool
    reason: str = ''
    category: str = ''


# ── 分类噪声模式 ──────────────────────────────────────────────
# 每条规则格式: (正则, 类别, 原因描述)

NOISE_RULES: list[tuple[str, str, str]] = [
    # ═══ URL / 域名 ═══
    (r'https?://', 'url', 'URL链接'),
    (r'\.com\b', 'url', '域名 (.com)'),
    (r'\.cn\b', 'url', '域名 (.cn)'),
    (r'\.net\b', 'url', '域名 (.net)'),
    (r'\.org\b', 'url', '域名 (.org)'),
    (r'\.io\b', 'url', '域名 (.io)'),
    (r'www\.', 'url', '网址前缀'),

    # ═══ 浏览器 UI ═══
    (r'chrome', 'browser', '浏览器名称'),
    (r'safari', 'browser', '浏览器名称'),
    (r'firefox', 'browser', '浏览器名称'),
    (r'edge', 'browser', '浏览器名称'),
    (r'brave', 'browser', '浏览器名称'),
    (r'标签页', 'browser', '浏览器标签页'),
    (r'新标签', 'browser', '浏览器标签'),
    (r'无痕', 'browser', '浏览器模式'),
    (r'书签', 'browser', '浏览器书签'),
    (r'历史记录', 'browser', '浏览器历史'),
    (r'地址栏', 'browser', '浏览器地址栏'),
    (r'搜索栏', 'browser', '浏览器搜索栏'),
    (r'最小化', 'browser', '浏览器窗口按钮'),
    (r'最大化', 'browser', '浏览器窗口按钮'),
    (r'扩展程序', 'browser', '浏览器扩展'),
    (r'插件', 'browser', '浏览器插件'),

    # ═══ App 通用 UI ═══
    (r'^下载\s*App$', 'app_ui', 'App下载推广'),
    (r'^下载\s*APP$', 'app_ui', 'App下载推广'),
    (r'下载App', 'app_ui', 'App下载推广'),
    (r'下载APP', 'app_ui', 'App下载推广'),
    (r'下载应用', 'app_ui', 'App下载推广'),
    (r'^首页$', 'app_ui', '导航-首页'),
    (r'^主页$', 'app_ui', '导航-主页'),
    (r'^AI$', 'app_ui', 'AI按钮'),
    (r'^AI问答$', 'app_ui', 'AI问答按钮'),
    (r'人工智能', 'app_ui', 'AI标签'),
    (r'^搜索$', 'app_ui', '搜索按钮'),
    (r'搜一搜', 'app_ui', '搜索按钮'),
    (r'搜索股票', 'app_ui', '搜索股票输入框'),
    (r'搜索代码', 'app_ui', '搜索代码输入框'),
    (r'^登录$', 'app_ui', '登录按钮'),
    (r'^注册$', 'app_ui', '注册按钮'),
    (r'^退出$', 'app_ui', '退出按钮'),
    (r'登录/注册', 'app_ui', '登录注册入口'),
    (r'立即登录', 'app_ui', '登录引导'),
    (r'^设置$', 'app_ui', '设置按钮'),
    (r'系统设置', 'app_ui', '系统设置'),
    (r'偏好设置', 'app_ui', '偏好设置'),
    (r'^帮助$', 'app_ui', '帮助按钮'),
    (r'^反馈$', 'app_ui', '反馈按钮'),
    (r'客服', 'app_ui', '客服入口'),
    (r'在线客服', 'app_ui', '在线客服'),
    (r'^分享$', 'app_ui', '分享按钮'),
    (r'^收藏$', 'app_ui', '收藏按钮'),
    (r'^点赞$', 'app_ui', '点赞按钮'),
    (r'^关注$', 'app_ui', '关注按钮'),
    (r'^已关注$', 'app_ui', '已关注按钮'),
    (r'^加关注$', 'app_ui', '加关注按钮'),
    (r'取消关注', 'app_ui', '取消关注'),
    (r'^转发$', 'app_ui', '转发按钮'),
    (r'^引用$', 'app_ui', '引用按钮'),

    # ═══ 导航 / 菜单 ═══
    (r'^自选$', 'nav_menu', '底部导航-自选'),
    (r'^行情$', 'nav_menu', '底部导航-行情'),
    (r'^交易$', 'nav_menu', '底部导航-交易'),
    (r'^资讯$', 'nav_menu', '底部导航-资讯'),
    (r'^我的$', 'nav_menu', '底部导航-我的'),
    (r'^发现$', 'nav_menu', '底部导航-发现'),
    (r'^理财$', 'nav_menu', '底部导航-理财'),
    (r'^基金$', 'nav_menu', '底部导航-基金'),
    (r'^社区$', 'nav_menu', '底部导航-社区'),
    (r'^学院$', 'nav_menu', '底部导航-学院'),
    (r'^导航$', 'nav_menu', '导航菜单'),
    (r'^菜单$', 'nav_menu', '菜单按钮'),
    (r'^市场$', 'nav_menu', '市场标签'),
    (r'^板块$', 'nav_menu', '板块标签'),
    (r'^概念$', 'nav_menu', '概念标签'),
    (r'^行业$', 'nav_menu', '行业标签'),
    (r'^沪深$', 'nav_menu', '沪深标签'),
    (r'^港股$', 'nav_menu', '港股标签'),
    (r'^美股$', 'nav_menu', '美股标签'),
    (r'^全球$', 'nav_menu', '全球标签'),

    # ═══ 行情软件自身 UI ═══
    (r'^模拟交易$', 'trading_ui', '模拟交易入口'),
    (r'^模拟炒股$', 'trading_ui', '模拟炒股入口'),
    (r'^条件单$', 'trading_ui', '条件单功能'),
    (r'^智能条件单$', 'trading_ui', '智能条件单功能'),
    (r'^Level\s*2$', 'trading_ui', 'Level-2行情入口'),
    (r'^Level-2$', 'trading_ui', 'Level-2行情入口'),
    (r'^L2$', 'trading_ui', 'L2行情入口'),
    (r'^VIP$', 'trading_ui', 'VIP入口'),
    (r'^会员$', 'trading_ui', '会员入口'),
    (r'^充值$', 'trading_ui', '充值入口'),
    (r'^续费$', 'trading_ui', '续费入口'),
    (r'^开户$', 'trading_ui', '开户入口'),
    (r'^入金$', 'trading_ui', '入金入口'),
    (r'^出金$', 'trading_ui', '出金入口'),
    (r'^转户$', 'trading_ui', '转户入口'),
    (r'^新股申购$', 'trading_ui', '新股申购入口'),
    (r'^打新$', 'trading_ui', '打新入口'),
    (r'^中签$', 'trading_ui', '中签查询'),
    (r'^龙虎榜$', 'trading_ui', '龙虎榜入口'),
    (r'^大宗交易$', 'trading_ui', '大宗交易入口'),
    (r'^融资融券$', 'trading_ui', '融资融券入口'),
    (r'^两融$', 'trading_ui', '两融入口'),
    (r'^研报$', 'trading_ui', '研报入口'),
    (r'^公告$', 'trading_ui', '公告入口'),
    (r'^财报$', 'trading_ui', '财报入口'),
    (r'^提醒$', 'trading_ui', '提醒功能'),
    (r'^预警$', 'trading_ui', '预警功能'),
    (r'^通知$', 'trading_ui', '通知'),

    # ═══ 用户 / 广告 ═══
    (r'用户.*昵称', 'user_ad', '用户昵称'),
    (r'昵称', 'user_ad', '用户昵称'),
    (r'用户名', 'user_ad', '用户名'),
    (r'修改昵称', 'user_ad', '修改昵称'),
    (r'广告', 'user_ad', '广告内容'),
    (r'推广', 'user_ad', '推广内容'),
    (r'^热门$', 'user_ad', '热门推荐'),
    (r'^精选$', 'user_ad', '精选推荐'),
    (r'赞助', 'user_ad', '赞助信息'),
    (r'合作', 'user_ad', '合作信息'),
    (r'商务', 'user_ad', '商务信息'),
    (r'扫码', 'user_ad', '扫码引导'),
    (r'二维码', 'user_ad', '二维码'),
    (r'加微信', 'user_ad', '加微信引导'),
    (r'加群', 'user_ad', '加群引导'),

    # ═══ 社交 / 帖子 ═══
    (r'帖子', 'social', '帖子内容'),
    (r'发帖', 'social', '发帖按钮'),
    (r'动态', 'social', '动态内容'),
    (r'话题', 'social', '话题内容'),
    (r'阅读\s*\d+', 'social', '阅读计数'),
    (r'回复\s*\d+', 'social', '回复计数'),
    (r'点赞\s*\d+', 'social', '点赞计数'),
    (r'楼主', 'social', '楼主标识'),
    (r'层主', 'social', '层主标识'),
    (r'吧友', 'social', '吧友昵称'),
    (r'评论', 'social', '评论区内容'),

    # ═══ 法律 / 隐私 ═══
    (r'隐私', 'legal', '隐私政策'),
    (r'条款', 'legal', '服务条款'),
    (r'政策', 'legal', '政策文本'),
    (r'协议', 'legal', '协议文本'),
    (r'©', 'legal', '版权符号'),
    (r'版权所有', 'legal', '版权声明'),
    (r'All Rights Reserved', 'legal', '版权声明'),
    (r'ICP', 'legal', 'ICP备案'),
    (r'备案', 'legal', '备案信息'),
    (r'风险提示', 'legal', '风险提示（通用文案）'),
    (r'免责声明', 'legal', '免责声明'),

    # ═══ 孤立时间日期 ═══
    (r'^\d{1,2}:\d{2}(:\d{2})?\s*(AM|PM|上午|下午)?$', 'time', '孤立时间戳'),
    (r'^\d{4}[-/]\d{1,2}[-/]\d{1,2}$', 'time', '孤立日期'),
    (r'^\d{1,2}[-/]\d{1,2}$', 'time', '孤立日期(短)'),

    # ═══ 纯 UI 元素 ═══
    (r'^刷新$', 'ui_element', '刷新按钮'),
    (r'^返回$', 'ui_element', '返回按钮'),
    (r'^关闭$', 'ui_element', '关闭按钮'),
    (r'^更多$', 'ui_element', '更多按钮'),
    (r'^编辑$', 'ui_element', '编辑按钮'),
    (r'^删除$', 'ui_element', '删除按钮'),
    (r'^确认$', 'ui_element', '确认按钮'),
    (r'^取消$', 'ui_element', '取消按钮'),
    (r'^确定$', 'ui_element', '确定按钮'),
    (r'^知道了$', 'ui_element', '知道了按钮'),
    (r'^不再提示$', 'ui_element', '不再提示'),
    (r'^我知道了$', 'ui_element', '我知道了按钮'),
    (r'^展开$', 'ui_element', '展开按钮'),
    (r'^收起$', 'ui_element', '收起按钮'),
    (r'^详情$', 'ui_element', '详情按钮'),
    (r'^简介$', 'ui_element', '简介按钮'),

    # ═══ 极短 / 纯符号噪声 ═══
    (r'^[_\-\—\.\+★☆◆◇▲▼●○◎]+$', 'symbols', '纯符号行'),
    (r'^[|｜/\\]+$', 'symbols', '纯分隔符行'),
]

# 编译正则
_noise_rules_compiled: list[tuple[re.Pattern, str, str]] = [
    (re.compile(p, re.IGNORECASE), cat, reason)
    for p, cat, reason in NOISE_RULES
]


def _is_noise(text: str) -> tuple[bool, str, str]:
    """
    判断单行文本是否为噪声。

    返回: (is_noise, category, reason)
    """
    stripped = text.strip()

    # 空或单字符
    if not stripped or len(stripped) <= 1:
        return True, 'too_short', '空行或单字符'

    # 超长文本（如帖子正文）
    if len(stripped) >= 50:
        return True, 'too_long', f'文本过长 ({len(stripped)}字符)'

    # 纯数字
    if re.match(r'^\d+$', stripped) and len(stripped) <= 3:
        return True, 'too_short', '纯数字且过短 (<4位)'

    # 规则匹配
    for pat, category, reason in _noise_rules_compiled:
        if pat.search(stripped):
            return True, category, reason

    return False, '', ''


def _deduplicate_texts(texts: list[str]) -> list[str]:
    """
    去除 OCR 重复行。

    OCR 常对同一区域产生几乎相同的重复行。
    使用模糊匹配：如果两行编辑距离较小，保留第一个。
    """
    if len(texts) <= 1:
        return texts

    result: list[str] = []
    for text in texts:
        stripped = text.strip()
        # 检查是否与已有结果高度相似
        is_dup = False
        for existing in result:
            if _is_similar(stripped, existing):
                is_dup = True
                break
        if not is_dup:
            result.append(stripped)
    return result


def _is_similar(a: str, b: str) -> bool:
    """快速相似度检查：完全相同 或 字符级高度重合。

    比 v1 更保守 — 增加最小长度阈值，降低字符重合度要求，
    并跳过包含数字的行（数字行差异常在小部分字符上）。
    """
    if a == b:
        return True
    if len(a) < 6 or len(b) < 6:
        return False
    # 包含数字的行几乎不会是真重复（MA5 vs MA10 vs MA20 等）
    if re.search(r'\d', a) and re.search(r'\d', b):
        # 数字行只判断完全相同，不做模糊匹配
        return False
    # 长度差距 > 20% → 不相似
    len_ratio = min(len(a), len(b)) / max(len(a), len(b))
    if len_ratio < 0.8:
        return False
    # 共享字符比例 — 阈值提高到 0.92
    common = sum(1 for c in set(a) if c in b)
    total = max(len(set(a)), 1)
    return common / total >= 0.92


def filter_texts(texts: list[str], debug: bool = False) -> list[str]:
    """
    过滤 OCR 文本：去重 → 去噪。

    参数:
        texts: OCR 原始文本列表
        debug: 是否返回详细过滤信息（为兼容旧接口，默认只返回 kept）

    返回:
        list[str] — 过滤后的文本列表
        （debug=True 时可通过全局 collector 获取 removed 信息）
    """
    # 去重
    deduped = _deduplicate_texts(texts)

    # 过滤
    kept: list[str] = []
    for text in deduped:
        is_noise, _cat, _reason = _is_noise(text)
        if not is_noise:
            kept.append(text)

    return kept


def filter_texts_detailed(texts: list[str]) -> tuple[list[str], list[FilterDecision]]:
    """
    带详细决策的过滤（供 debug 模式使用）。

    返回: (kept_texts, removed_decisions)
    """
    deduped = _deduplicate_texts(texts)
    kept: list[str] = []
    removed: list[FilterDecision] = []

    for text in deduped:
        is_noise, category, reason = _is_noise(text)
        if is_noise:
            removed.append(FilterDecision(
                text=text.strip(),
                kept=False,
                reason=reason,
                category=category,
            ))
        else:
            kept.append(text.strip())

    return kept, removed


# ═══════════════════════════════════════════════════════════════
# 股票关键词相关性打分（阶段二：权重排序）
# ═══════════════════════════════════════════════════════════════

# 加权关键词：(关键词, 权重)。权重越高越可能是股票相关行。
STOCK_WEIGHT_KEYWORDS: list[tuple[str, float]] = [
    # ── 强股票指标（权重 8-10） ──
    ('股票代码', 10.0),
    ('股票名称', 9.0),
    ('最新价', 9.0),
    ('当前价', 9.0),
    ('现价', 9.0),
    ('涨跌幅', 9.0),
    ('涨跌额', 8.0),
    ('今开', 8.0),
    ('昨收', 8.0),
    ('开盘', 8.0),
    ('收盘', 8.0),
    ('最高价', 8.0),
    ('最低价', 8.0),
    ('成交量', 8.0),
    ('成交额', 8.0),
    ('成交金额', 8.0),
    ('换手率', 8.0),
    ('市盈率', 8.0),
    ('市净率', 8.0),
    ('总市值', 8.0),
    ('流通市值', 8.0),
    ('量比', 7.0),
    ('振幅', 7.0),
    ('委比', 7.0),

    # ── 技术指标（权重 7-8） ──
    ('MACD', 8.0),
    ('DIF', 7.0),
    ('DEA', 7.0),
    ('KDJ', 8.0),
    ('RSI', 8.0),
    ('EMA', 7.0),
    ('BOLL', 7.0),
    ('布林', 7.0),
    ('MA5', 7.0),
    ('MA10', 7.0),
    ('MA20', 7.0),
    ('MA60', 7.0),
    ('MA120', 7.0),
    ('MA250', 7.0),
    ('威廉', 7.0),
    ('乖离', 7.0),

    # ── 中等股票特征（权重 4-6） ──
    ('涨停', 6.0),
    ('跌停', 6.0),
    ('分时', 5.0),
    ('日K', 5.0),
    ('周K', 5.0),
    ('月K', 5.0),
    ('内盘', 5.0),
    ('外盘', 5.0),
    ('委差', 5.0),
    ('总手', 5.0),
    ('现手', 5.0),
    ('流通', 4.0),
    ('总股本', 5.0),
    ('融资融券', 5.0),
    ('龙虎榜', 5.0),
    ('大宗交易', 5.0),

    # ── 弱股票特征（权重 2-3，累积有效） ──
    ('上证', 3.0),
    ('深证', 3.0),
    ('创业板', 3.0),
    ('科创板', 3.0),
    ('北证', 3.0),
    ('沪深', 3.0),
    ('港股', 3.0),
    ('美股', 3.0),
    ('板块', 2.0),
    ('行业', 2.0),
    ('概念', 2.0),
    ('自选', 2.0),
    ('行情', 2.0),
]


def _score_stock_relevance(text: str) -> float:
    """
    为单行 OCR 文本计算股票相关性分数（0.0–1.0+）。

    得分来自三个维度：
      1. 关键词命中（STOCK_WEIGHT_KEYWORDS）
      2. 股票代码模式（6位纯数字 / SZ/SH/BJ 前缀）
      3. 价格/百分比模式

    返回分数越高，该行越可能包含股票数据。
    """
    stripped = text.strip()
    if not stripped:
        return 0.0

    score = 0.0

    # ── 维度1: 关键词加权命中 ──
    for keyword, weight in STOCK_WEIGHT_KEYWORDS:
        if keyword in stripped:
            score += weight
            break  # 每行只取最匹配的一个关键词

    # ── 维度2: 股票代码模式 ──
    # SZ/SH/BJ + 数字
    if re.search(r'(SZ|SH|BJ|sz|sh|bj)\s*\d{5,8}', stripped):
        score += 12.0
    # 6位纯数字（可能股票代码）
    elif re.search(r'\b\d{6}\b', stripped):
        score += 8.0
    # 5位数字（港股代码）
    elif re.search(r'\b\d{5}\b', stripped):
        score += 4.0

    # ── 维度3: 价格/百分比模式 ──
    # 带%的涨跌幅
    if re.search(r'[+-]?\d+\.?\d*\s*%', stripped):
        score += 7.0
    # 合法价格数字（两位小数）
    elif re.search(r'\b\d{1,6}\.\d{2}\b', stripped):
        score += 6.0
    # 带 ¥/$ 符号
    elif re.search(r'[¥$]\s*\d+', stripped):
        score += 5.0

    # ── 维度4: 中文股票名称模式（2-4个中文字符） ──
    # 纯中文2-4字，可能是股票简称
    if re.match(r'^[\u4e00-\u9fff]{2,4}$', stripped):
        score += 3.0

    return score


def _rank_by_relevance(texts: list[str]) -> list[str]:
    """
    按股票相关性对过滤后的文本重新排序。

    高分（股票相关）排前，低分排后。
    保持原始顺序作为次级排序（稳定排序）。
    """
    if len(texts) <= 1:
        return list(texts)

    # 为每行计算分数，附加原始索引
    scored = [(i, text, _score_stock_relevance(text)) for i, text in enumerate(texts)]

    # 按分数降序，分数相同按原始索引升序（稳定）
    scored.sort(key=lambda x: (-x[2], x[0]))

    return [text for _i, text, _score in scored]


# ═══════════════════════════════════════════════════════════════
# 股票代码识别
# ═══════════════════════════════════════════════════════════════

_CODE_WITH_PREFIX_RE = re.compile(r'(SZ|SH|BJ|HK|sh|sz|bj|hk)\s*(\d{5,8})')
_PURE_CODE_RE = re.compile(r'\b(\d{6})\b')
_HK_CODE_RE = re.compile(r'\b(\d{5})\b')


def _classify_code(code: str) -> Optional[str]:
    if not code.isdigit():
        return None
    n = int(code)
    if (600000 <= n <= 609999 or 601000 <= n <= 603999 or
            605000 <= n <= 605999 or 688000 <= n <= 689999):
        return 'SH'
    if (1 <= n <= 4999 or 2000 <= n <= 2999 or 3000 <= n <= 3999):
        return 'SZ'
    if 300000 <= n <= 301999 or 200000 <= n <= 200999:
        return 'SZ'
    if (400000 <= n <= 439999 or 830000 <= n <= 839999 or
            870000 <= n <= 879999 or 920000 <= n <= 929999):
        return 'BJ'
    return None


def _is_likely_cn_name(text: str) -> bool:
    stripped = text.strip()
    if not stripped or len(stripped) < 2 or len(stripped) > 8:
        return False
    chinese_chars = sum(1 for c in stripped if '\u4e00' <= c <= '\u9fff')
    if chinese_chars < 2:
        return False
    non_chinese = ''.join(c for c in stripped if not ('\u4e00' <= c <= '\u9fff'))
    if non_chinese and not re.match(r'^[A-Za-z0-9·]+$', non_chinese):
        return False
    return True


def _find_stock_name(texts: list[str], code_idx: int, code_text: str) -> Optional[str]:
    start = max(0, code_idx - 3)
    end = min(len(texts), code_idx + 4)
    candidates: list[tuple[str, int]] = []
    for i in range(start, end):
        if i == code_idx:
            prefix = texts[i].split(code_text)[0].strip()
            if _is_likely_cn_name(prefix):
                candidates.append((prefix, 0))
            continue
        text = texts[i].strip()
        if _is_likely_cn_name(text):
            candidates.append((text, abs(i - code_idx)))
    if candidates:
        candidates.sort(key=lambda x: x[1])
        return candidates[0][0]
    return None


def _extract_code_info(
    texts: list[str],
    methods: dict[str, str],
    collector: Optional[DebugCollector] = None,
) -> dict:
    result: dict = {'code': None, 'market': None, 'name': None}
    for idx, text in enumerate(texts):
        stripped = text.strip()
        m = _CODE_WITH_PREFIX_RE.search(stripped)
        if m:
            result['market'] = m.group(1).upper()
            result['code'] = m.group(2)
            methods['code'] = 'code_prefix_match'
            name = _find_stock_name(texts, idx, m.group(0))
            if name:
                result['name'] = name
                methods['name'] = 'name_proximity'
            if collector:
                collector.record_extraction(
                    field='code', value=result['code'],
                    method='code_prefix_match',
                    source_line_index=idx, source_line_text=stripped,
                )
                if name:
                    collector.record_extraction(
                        field='name', value=name,
                        method='name_proximity',
                        source_line_index=idx, source_line_text=stripped,
                    )
            return result

        m = _PURE_CODE_RE.search(stripped)
        if m:
            code = m.group(1)
            market = _classify_code(code)
            if market:
                result['code'] = code
                result['market'] = market
                methods['code'] = 'code_pure_match'
                name = _find_stock_name(texts, idx, code)
                if name:
                    result['name'] = name
                    methods['name'] = 'name_proximity'
                if collector:
                    collector.record_extraction(
                        field='code', value=code,
                        method='code_pure_match',
                        source_line_index=idx, source_line_text=stripped,
                    )
                    if name:
                        collector.record_extraction(
                            field='name', value=name,
                            method='name_proximity',
                            source_line_index=idx, source_line_text=stripped,
                        )
                return result
    return result


# ═══════════════════════════════════════════════════════════════
# 数值提取工具
# ═══════════════════════════════════════════════════════════════

_NUMBER_RE = re.compile(r'(?<![a-zA-Z0-9])([+-]?\d+(?:,\d{3})*(?:\.\d{1,4})?)(?![a-zA-Z0-9])')
_PCT_RE = re.compile(r'(?<![a-zA-Z0-9])([+-]?\d+\.?\d{0,2})\s*%')

_UNIT_MULTIPLIER: list[tuple[str, float]] = [
    ('万亿', 1_000_000_000_000),
    ('亿', 100_000_000),
    ('万', 10_000),
    ('千', 1_000),
]


def _parse_raw_number(text: str) -> Optional[float]:
    stripped = text.strip()
    m = _PCT_RE.search(stripped)
    if m:
        return float(m.group(1))
    m = _NUMBER_RE.search(stripped)
    if not m:
        return None
    num_str = m.group(1).replace(',', '')
    try:
        val = float(num_str)
        for unit, mult in _UNIT_MULTIPLIER:
            if unit in stripped:
                val *= mult
                break
        return val
    except ValueError:
        return None


# ═══════════════════════════════════════════════════════════════
# 格式化输出
# ═══════════════════════════════════════════════════════════════

def _fmt_price(val: Optional[float]) -> Optional[str]:
    if val is None: return None
    return f'{val:.2f}'

def _fmt_signed(val: Optional[float]) -> Optional[str]:
    if val is None: return None
    sign = '+' if val >= 0 else ''
    return f'{sign}{val:.2f}'

def _fmt_percent(val: Optional[float]) -> Optional[str]:
    if val is None: return None
    sign = '+' if val >= 0 else ''
    return f'{sign}{val:.2f}%'

def _fmt_volume(val: Optional[float]) -> Optional[str]:
    if val is None: return None
    if abs(val) >= 1_0000_0000_0000: return f'{val / 1_0000_0000_0000:.2f}万亿手'
    if abs(val) >= 100_000_000: return f'{val / 100_000_000:.2f}亿手'
    if abs(val) >= 10_000: return f'{val / 10_000:.2f}万手'
    return f'{val:.0f}手'

def _fmt_large_amount(val: Optional[float]) -> Optional[str]:
    if val is None: return None
    if abs(val) >= 1_0000_0000_0000: return f'{val / 1_0000_0000_0000:.2f}万亿'
    if abs(val) >= 100_000_000: return f'{val / 100_000_000:.2f}亿'
    if abs(val) >= 10_000: return f'{val / 10_000:.2f}万'
    return f'{val:.2f}'

def _fmt_decimal(val: Optional[float]) -> Optional[str]:
    if val is None: return None
    return f'{val:.2f}'

def _fmt_tech_val(val: Optional[float]) -> Optional[str]:
    if val is None: return None
    return f'{val:.2f}'


# ═══════════════════════════════════════════════════════════════
# 股票基本信息指标提取
# ═══════════════════════════════════════════════════════════════

_STOCK_INDICATOR_MAP: list[tuple[list[str], str]] = [
    (['今开', '开盘'], 'open'),
    (['昨收', '前收', '昨日收盘', '昨收盘'], 'prev_close'),
    (['最高价', '日内最高', '最高'], 'high'),
    (['最低价', '日内最低', '最低'], 'low'),
    (['成交量\\(手\\)', '成交总量', '成交量'], 'volume'),
    (['成交金额', '成交总额', '成交额'], 'turnover'),
    (['换手率', '换手'], 'turnover_rate'),
    (['市盈率\\(动\\)', '市盈\\(动\\)', '市盈率TTM', r'\bPE\b', '市盈率'], 'pe'),
    (['市净率', r'\bPB\b', '市净'], 'pb'),
    (['总市值', '市值'], 'total_market_cap'),
    (['流通市值\\(元\\)', '流通市值', '流通'], 'circulating_market_cap'),
    (['量比'], 'volume_ratio'),
    (['振幅'], 'amplitude'),
    (['委比'], 'committee_ratio'),
]


def _extract_stock_indicators(
    texts: list[str],
    methods: dict[str, str],
    collector: Optional[DebugCollector] = None,
    extra_aliases: Optional[dict[str, list[str]]] = None,
) -> dict:
    """
    提取基本股票指标。

    extra_aliases: 平台特有的字段别名映射 {field: [aliases]}
                   例如 {'current_price': ['最新', '最新价']}
    """
    # 合并标准映射 + 平台别名
    merged_map: list[tuple[list[str], str]] = list(_STOCK_INDICATOR_MAP)
    if extra_aliases:
        for field, aliases in extra_aliases.items():
            # 找到对应字段并追加别名
            found = False
            for keywords, existing_field in merged_map:
                if existing_field == field:
                    for alias in aliases:
                        if alias not in keywords:
                            keywords.append(alias)
                    found = True
                    break
            if not found:
                # 新字段：直接用别名创建
                merged_map.append((aliases, field))

    result: dict = {}
    for idx, text in enumerate(texts):
        stripped = text.strip()
        for keywords, field in merged_map:
            if field in result:
                continue
            matched_kw = None
            for kw in keywords:
                if re.search(kw, stripped):
                    matched_kw = kw
                    break
            if not matched_kw:
                continue

            # 尝试从当前行提取
            val = _parse_raw_number(stripped)
            if val is not None:
                result[field] = val
                methods[field] = 'direct_keyword_sameline'
                if collector:
                    collector.record_extraction(
                        field=field, value=val,
                        method='direct_keyword_sameline',
                        source_line_index=idx, source_line_text=stripped,
                    )
                continue

            # 下一行兜底
            if idx + 1 < len(texts):
                val = _parse_raw_number(texts[idx + 1])
                if val is not None:
                    result[field] = val
                    methods[field] = 'direct_keyword_nextline'
                    if collector:
                        collector.record_extraction(
                            field=field, value=val,
                            method='direct_keyword_nextline',
                            source_line_index=idx + 1, source_line_text=texts[idx + 1],
                        )
                    continue

            # 上一行兜底
            if idx > 0:
                val = _parse_raw_number(texts[idx - 1])
                if val is not None:
                    result[field] = val
                    methods[field] = 'direct_keyword_prevline'
                    if collector:
                        collector.record_extraction(
                            field=field, value=val,
                            method='direct_keyword_prevline',
                            source_line_index=idx - 1, source_line_text=texts[idx - 1],
                        )
                    continue
    return result


# ═══════════════════════════════════════════════════════════════
# 技术指标提取
# ═══════════════════════════════════════════════════════════════

_TECH_INDICATOR_MAP: list[tuple[list[str], str]] = [
    (['MA5', 'MA\\(5\\)', 'MA 5', '五日均线'], 'ma5'),
    (['MA10', 'MA\\(10\\)', 'MA 10', '十日均线'], 'ma10'),
    (['MA20', 'MA\\(20\\)', 'MA 20', '廿日均线'], 'ma20'),
    (['MA60', 'MA\\(60\\)', 'MA 60', '六十日均线'], 'ma60'),
    (['MA120', 'MA\\(120\\)', 'MA 120'], 'ma120'),
    (['MA250', 'MA\\(250\\)', 'MA 250', '年线'], 'ma250'),
    (['DIF', 'DIFF'], 'macd_dif'),
    (['DEA'], 'macd_dea'),
    (['MACD'], 'macd_bar'),
    (['KDJ.*K', r'\bK\b.*KDJ', r'\bK\s'], 'kdj_k'),
    (['KDJ.*D', r'\bD\b.*KDJ', r'\bD\s'], 'kdj_d'),
    (['KDJ.*J', r'\bJ\b.*KDJ', r'\bJ\s'], 'kdj_j'),
    (['K值'], 'kdj_k'),
    (['D值'], 'kdj_d'),
    (['J值'], 'kdj_j'),
    (['RSI6', 'RSI\\(6\\)'], 'rsi6'),
    (['RSI14', 'RSI\\(14\\)'], 'rsi14'),
    (['RSI24', 'RSI\\(24\\)'], 'rsi24'),
    (['BOLL.*UP', 'UP.*BOLL', '布林上轨', r'BOLL.*上', r'上轨'], 'boll_upper'),
    (['BOLL.*MID', 'MID.*BOLL', '布林中轨', r'BOLL.*中', r'中轨'], 'boll_mid'),
    (['BOLL.*DN', 'DN.*BOLL', 'BOLL.*LOW', '布林下轨', r'BOLL.*下', r'下轨'], 'boll_lower'),
    (['WR\\(?10', 'W%R', '威廉'], 'wr10'),
    (['BIAS6', 'BIAS\\(6\\)', '乖离6'], 'bias6'),
    (['BIAS12', 'BIAS\\(12\\)', '乖离12'], 'bias12'),
]


def _extract_technical_indicators(
    texts: list[str],
    methods: dict[str, str],
    collector: Optional[DebugCollector] = None,
) -> dict:
    result: dict = {}
    for idx, text in enumerate(texts):
        stripped = text.strip()
        for keywords, field in _TECH_INDICATOR_MAP:
            if field in result:
                continue
            matched_kw = None
            for kw in keywords:
                if not re.search(kw, stripped):
                    continue
                matched_kw = kw
                # 尝试从关键词后面提取紧跟的数字
                m = re.search(kw + r'[：:=\s]*([+-]?\d+\.?\d{0,4})', stripped)
                if m:
                    try:
                        result[field] = float(m.group(1))
                        methods[field] = 'direct_keyword_sameline'
                        if collector:
                            collector.record_extraction(
                                field=field, value=float(m.group(1)),
                                method='direct_keyword_sameline',
                                source_line_index=idx, source_line_text=stripped,
                            )
                    except ValueError:
                        pass
                    break

                # 当前行任意数字
                val = _parse_raw_number(stripped)
                if val is not None:
                    result[field] = val
                    methods[field] = 'direct_keyword_sameline'
                    if collector:
                        collector.record_extraction(
                            field=field, value=val,
                            method='direct_keyword_sameline',
                            source_line_index=idx, source_line_text=stripped,
                        )
                    break

                # 下一行兜底
                if idx + 1 < len(texts):
                    val = _parse_raw_number(texts[idx + 1])
                    if val is not None:
                        result[field] = val
                        methods[field] = 'direct_keyword_nextline'
                        if collector:
                            collector.record_extraction(
                                field=field, value=val,
                                method='direct_keyword_nextline',
                                source_line_index=idx + 1, source_line_text=texts[idx + 1],
                            )
                        break
                break
    return result


# ═══════════════════════════════════════════════════════════════
# 价格 / 涨跌提取
# ═══════════════════════════════════════════════════════════════

def _extract_price_change(
    texts: list[str],
    code_idx: Optional[int],
    methods: dict[str, str],
    collector: Optional[DebugCollector] = None,
) -> dict:
    result: dict = {'price': None, 'change_amount': None, 'change_percent': None}
    numeric_items: list[tuple[int, str, float, bool]] = []

    for idx, text in enumerate(texts):
        stripped = text.strip()
        if code_idx is not None and idx == code_idx:
            continue
        pct_m = _PCT_RE.search(stripped)
        if pct_m:
            numeric_items.append((idx, stripped, float(pct_m.group(1)), True))
            continue
        num_m = re.match(r'^[¥$]?\s*([+-]?\d+\.?\d{0,4})\s*$', stripped)
        if num_m:
            numeric_items.append((idx, stripped, float(num_m.group(1)), False))

    if not numeric_items:
        return result

    # 涨跌幅
    pct_items = [(i, t, v) for i, t, v, p in numeric_items if p]
    if pct_items:
        signed = [(i, t, v) for i, t, v in pct_items if t.startswith('+') or t.startswith('-')]
        best = signed[0] if signed else pct_items[0]
        result['change_percent'] = best[2]
        methods['change_percent'] = 'change_pattern'
        if collector:
            collector.record_extraction(
                field='change_percent', value=best[2],
                method='change_pattern',
                source_line_index=best[0], source_line_text=best[1],
            )

    # 价格 & 涨跌额
    num_items = [(i, t, v) for i, t, v, p in numeric_items if not p]
    price_candidates = [(i, t, v) for i, t, v in num_items
                        if not t.startswith('+') and not t.startswith('-')]
    change_candidates = [(i, t, v) for i, t, v in num_items
                         if t.startswith('+') or t.startswith('-')]

    if price_candidates:
        price_candidates.sort(key=lambda x: abs(x[2]), reverse=True)
        for idx, raw, val in price_candidates:
            if 0.01 <= abs(val) <= 999999:
                result['price'] = val
                methods['current_price'] = 'price_pattern'
                if collector:
                    collector.record_extraction(
                        field='price', value=val,
                        method='price_pattern',
                        source_line_index=idx, source_line_text=raw,
                    )
                break

    if change_candidates:
        change_candidates.sort(key=lambda x: abs(x[2]))
        for idx, raw, val in change_candidates:
            if result['price'] and abs(val) < result['price'] * 0.5:
                result['change_amount'] = val
                methods['change_amount'] = 'change_pattern'
                if collector:
                    collector.record_extraction(
                        field='change_amount', value=val,
                        method='change_pattern',
                        source_line_index=idx, source_line_text=raw,
                    )
                break
            elif not result['price']:
                result['change_amount'] = val
                methods['change_amount'] = 'change_pattern'
                if collector:
                    collector.record_extraction(
                        field='change_amount', value=val,
                        method='change_pattern',
                        source_line_index=idx, source_line_text=raw,
                    )
                break

    return result


# ═══════════════════════════════════════════════════════════════
# 分析摘要生成
# ═══════════════════════════════════════════════════════════════

def _generate_analysis(stock: dict, technical: dict, ocr_confidence: Optional[float] = None) -> dict:
    """与 v1.0 兼容的分析生成（从 conf-wrapped dict 中提取裸值）"""
    def _unwrap(d: dict, key: str):
        entry = d.get(key)
        if isinstance(entry, dict):
            return entry.get('value')
        return entry

    cp_str = _unwrap(stock, 'current_price') or _unwrap(stock, 'price')
    cp = float(cp_str) if cp_str else None
    chg_str = _unwrap(stock, 'change_percent')
    chg = float(chg_str.replace('%', '').replace('+', '')) if chg_str else None
    high_str = _unwrap(stock, 'high')
    high = float(high_str) if high_str else None
    low_str = _unwrap(stock, 'low')
    low = float(low_str) if low_str else None
    open_str = _unwrap(stock, 'open')
    open_val = float(open_str) if open_str else None
    prev_str = _unwrap(stock, 'prev_close')
    prev = float(prev_str) if prev_str else None
    name = _unwrap(stock, 'name') or '该股票'
    code = _unwrap(stock, 'code') or ''

    has_critical = bool(name != '该股票' and code and cp is not None)
    if not has_critical:
        return {
            'summary': '信息不足（缺少名称/代码/价格），无法生成可靠分析。请确认截图包含完整的股票详情页。',
            'bullish_signals': [],
            'bearish_signals': [],
            'risk_warning': '当前截图未提供足够的股票数据，请使用包含股票名称、代码和价格的截图重试。',
            'confidence': 0.0,
            'disclaimer': '本分析仅基于截图 OCR 识别结果生成，不构成投资建议。数据来源为离线 OCR 识别，可能存在误差。',
        }

    summary_parts: list[str] = []
    bullish_signals: list[str] = []
    bearish_signals: list[str] = []

    summary_parts.append(f'[截图识别] {name}（{code}）当前价格 {cp_str} 元')

    if chg is not None:
        direction = '上涨' if chg > 0 else ('下跌' if chg < 0 else '平盘')
        summary_parts.append(f'涨跌幅 {chg_str}，{direction}')
        bullish_signals.append(f'[截图识别] 涨跌幅：{chg_str}')

    if open_val is not None and prev is not None:
        gap = open_val - prev
        if gap > 0:
            bullish_signals.append(f'[截图识别] 高开 {_fmt_signed(gap)}，开盘价 {open_str}')
        elif gap < 0:
            bearish_signals.append(f'[截图识别] 低开 {_fmt_signed(gap)}，开盘价 {open_str}')

    if high is not None and low is not None:
        summary_parts.append(f'今日最高 {_unwrap(stock, "high")}，最低 {_unwrap(stock, "low")}')
        amplitude = _unwrap(stock, 'amplitude')
        if amplitude:
            summary_parts.append(f'振幅 {amplitude}')

    vol = _unwrap(stock, 'volume')
    turnover = _unwrap(stock, 'turnover')
    turnover_rate = _unwrap(stock, 'turnover_rate')
    if vol:
        summary_parts.append(f'成交量 {vol}')
    if turnover:
        summary_parts.append(f'成交额 {turnover}')
    if turnover_rate:
        summary_parts.append(f'换手率 {turnover_rate}')

    if chg is not None:
        if chg > 5:
            summary_parts.append('[AI推断] 今日强势上涨，多头占据明显优势')
            bullish_signals.append('[AI推断] 涨幅超5%，属于强势上涨，短期动能较强')
        elif chg > 2:
            summary_parts.append('[AI推断] 今日明显上涨，走势偏强')
            bullish_signals.append('[AI推断] 涨幅超2%，多方力量占优')
        elif chg > 0:
            summary_parts.append('[AI推断] 今日小幅上涨，走势温和')
        elif chg == 0:
            summary_parts.append('[AI推断] 今日平盘，多空力量均衡')
        elif chg > -2:
            summary_parts.append('[AI推断] 今日小幅下跌，走势偏弱')
        elif chg > -5:
            summary_parts.append('[AI推断] 今日明显下跌，空方占优')
            bearish_signals.append('[AI推断] 跌幅超2%，空方力量占优')
        else:
            summary_parts.append('[AI推断] 今日大幅下跌，空头力量显著')
            bearish_signals.append('[AI推断] 跌幅超5%，短期风险较高')

    if cp is not None and high is not None and low is not None and high != low:
        pos = (cp - low) / (high - low)
        if pos > 0.8:
            summary_parts.append('[AI推断] 价格接近当日高点，日内走势强劲')
            bullish_signals.append('[AI推断] 收盘价接近日内高点，买盘积极')
            if pos > 0.95:
                bearish_signals.append('[AI推断] 价格几乎在最高位，短期存在回调压力')
        elif pos < 0.2:
            summary_parts.append('[AI推断] 价格接近当日低点，日内走势偏弱')
            bearish_signals.append('[AI推断] 收盘价接近日内低点，卖压较大')
            if pos < 0.05:
                bullish_signals.append('[AI推断] 价格几乎在最低位，短期存在超跌反弹可能')

    if turnover_rate:
        try:
            tr_val = float(str(turnover_rate).replace('%', '').replace('+', '').replace('-', ''))
            if tr_val > 10:
                summary_parts.append('[AI推断] 换手率较高，市场交投活跃，关注资金动向')
                if chg is not None and chg > 0:
                    bullish_signals.append(f'[AI推断] 高换手率（{turnover_rate}）配合上涨，资金积极介入')
                elif chg is not None and chg < 0:
                    bearish_signals.append(f'[AI推断] 高换手率（{turnover_rate}）配合下跌，资金出逃迹象')
            elif tr_val < 1:
                summary_parts.append('[AI推断] 换手率偏低，市场关注度有限')
        except ValueError:
            pass

    tech_count = 0
    ma5 = _unwrap(technical, 'ma5')
    if ma5 is not None and cp is not None:
        try:
            ma5v = float(ma5)
            tech_count += 1
            if cp > ma5v:
                bullish_signals.append(f'[AI推断] 价格站上 MA5({ma5})，短线趋势偏多')
            else:
                bearish_signals.append(f'[AI推断] 价格跌破 MA5({ma5})，短线趋势偏弱')
        except ValueError:
            pass

    ma20 = _unwrap(technical, 'ma20')
    if ma20 is not None and cp is not None:
        try:
            ma20v = float(ma20)
            tech_count += 1
            if cp > ma20v:
                bullish_signals.append(f'[AI推断] 价格站上 MA20({ma20})，中期趋势偏多')
            else:
                bearish_signals.append(f'[AI推断] 价格跌破 MA20({ma20})，中期趋势偏弱')
        except ValueError:
            pass

    dif = _unwrap(technical, 'macd_dif')
    dea = _unwrap(technical, 'macd_dea')
    if dif is not None and dea is not None:
        try:
            difv = float(dif)
            deav = float(dea)
            tech_count += 1
            if difv > deav:
                bullish_signals.append(f'[AI推断] MACD DIF({dif})上穿 DEA({dea})，金叉信号')
            elif difv < deav:
                bearish_signals.append(f'[AI推断] MACD DIF({dif})下穿 DEA({dea})，死叉信号')
        except ValueError:
            pass

    if tech_count > 0:
        summary_parts.append(f'[AI推断] 综合 {tech_count} 项技术指标分析')

    # Risk
    risk_parts: list[str] = []
    if chg is not None and abs(chg) > 5:
        risk_parts.append('日内波动较大')
    if high is not None and low is not None and high != 0:
        amp = (high - low) / high * 100
        if amp > 10:
            risk_parts.append('日内振幅超10%')
    if not risk_parts:
        risk_parts.append('当前未发现显著风险信号')

    risk_warning = '；'.join(risk_parts) + '。股市有风险，投资需谨慎。本分析仅供参考，不构成投资建议。'

    # Confidence
    data_fields = sum(1 for k in ['name', 'code', 'price', 'high', 'low', 'volume']
                      if _unwrap(stock, k) is not None)
    data_completeness = min(1.0, data_fields / 6.0)
    ocr_factor = ocr_confidence if ocr_confidence else 0.85
    confidence = round(data_completeness * 0.4 + ocr_factor * 0.3 + min(1.0, tech_count / 5.0) * 0.3, 2)

    return {
        'summary': '；'.join(summary_parts) + '。',
        'bullish_signals': bullish_signals,
        'bearish_signals': bearish_signals,
        'risk_warning': risk_warning,
        'confidence': confidence,
        'disclaimer': '本分析仅基于截图 OCR 识别结果生成，不构成投资建议。数据来源为离线 OCR 识别，可能存在误差。',
    }


# ═══════════════════════════════════════════════════════════════
# App 专项优化规则（阶段六）
# ═══════════════════════════════════════════════════════════════

# 各平台特征关键词（用于检测 + 优化提取）
APP_RULES: dict[str, dict] = {
    '东方财富': {
        'detect_keywords': ['东方财富', '东方', '天天基金', 'EastMoney'],
        'field_aliases': {
            'current_price': ['最新', '最新价', '现价'],
            'change_percent': ['涨跌幅', '涨幅'],
            'volume': ['成交量', '总量'],
            'turnover': ['成交额', '成交金额'],
        },
        'extra_noise': ['财富号', '股吧', '问董秘', '自选股', 'Lv2', 'Level2'],
        'nav_keywords': ['首页', '行情', '自选', '交易', '资讯', '我的'],
        'layout_hint': 'grid',  # 东方财富使用网格布局展示指标
    },
    '同花顺': {
        'detect_keywords': ['同花顺', 'THS', '10jqka', '核新软件'],
        'field_aliases': {
            'current_price': ['现价', '最新价', '当前价'],
            'change_percent': ['涨幅', '涨跌', '涨跌幅'],
            'volume': ['总手', '成交量'],
            'turnover': ['金额', '成交额'],
        },
        'extra_noise': ['模拟', '论股堂', 'i问财', '问财', '诊股'],
        'nav_keywords': ['自选', '行情', '交易', '资讯', '我的', '发现'],
        'layout_hint': 'table',  # 同花顺使用表格布局
    },
    '雪球': {
        'detect_keywords': ['雪球', 'xueqiu', 'Snowball'],
        'field_aliases': {
            'current_price': ['现价', '当前'],
            'change_percent': ['涨幅', '涨跌'],
            'volume': ['成交量', '成交'],
            'turnover': ['成交额'],
            'pe': ['市盈率', 'PE'],
            'pb': ['市净率', 'PB'],
        },
        'extra_noise': ['关注', '粉丝', '专栏', '访谈', '悬赏', '话题'],
        'nav_keywords': ['首页', '自选', '行情', '交易', '牛牛'],
        'layout_hint': 'card',  # 雪球使用卡片布局
    },
    '腾讯自选股': {
        'detect_keywords': ['腾讯自选股', '自选股', '腾讯微证券', '微信股票'],
        'field_aliases': {
            'current_price': ['最新价', '现价', '当前'],
            'change_percent': ['涨跌幅', '涨跌'],
            'volume': ['成交量'],
            'turnover': ['成交额'],
        },
        'extra_noise': ['微信', '扫一扫', '小程序', '看一看', '搜一搜'],
        'nav_keywords': ['自选', '行情', '交易', '发现', '我的'],
        'layout_hint': 'simple',  # 腾讯自选股使用简洁布局
    },
}

# 平台品牌关键词 → 平台名（扁平映射用于快速匹配）
_PLATFORM_BRAND_MAP: dict[str, str] = {}
for _platform, _rules in APP_RULES.items():
    for _kw in _rules['detect_keywords']:
        _PLATFORM_BRAND_MAP[_kw] = _platform


def _detect_platform(texts: list[str]) -> Optional[str]:
    """
    从 OCR 文本中检测截图来自哪个股票 App。

    返回平台名 ('东方财富'|'同花顺'|'雪球'|'腾讯自选股') 或 None。
    """
    scores: dict[str, int] = {}
    for text in texts:
        for kw, platform in _PLATFORM_BRAND_MAP.items():
            if kw in text:
                scores[platform] = scores.get(platform, 0) + 1

    if not scores:
        return None

    # 返回命中次数最多的平台
    best = max(scores, key=scores.get)
    logger.debug('检测到平台: %s (命中 %d 次)', best, scores[best])
    return best


def _apply_platform_rules(
    platform: Optional[str],
    texts: list[str],
) -> tuple[list[str], dict[str, list[str]]]:
    """
    根据检测到的平台应用专项优化规则。

    返回:
        (cleaned_texts, field_aliases)
        cleaned_texts: 移除平台特有噪声后的文本
        field_aliases: 平台特有的字段别名映射 {field: [aliases]}
    """
    if not platform or platform not in APP_RULES:
        return texts, {}

    rules = APP_RULES[platform]
    extra_noise = rules.get('extra_noise', [])
    field_aliases = rules.get('field_aliases', {})

    # 追加平台特有噪声过滤
    cleaned: list[str] = []
    for text in texts:
        is_platform_noise = False
        for noise_kw in extra_noise:
            if noise_kw in text:
                is_platform_noise = True
                logger.debug('[%s] 过滤平台噪声: "%s" → "%s"', platform, noise_kw, text)
                break
        if not is_platform_noise:
            cleaned.append(text)

    logger.info(
        '[%s] 平台规则: 移除 %d 条特有噪声, 保留 %d 条, 布局=%s',
        platform,
        len(texts) - len(cleaned),
        len(cleaned),
        rules.get('layout_hint', 'unknown'),
    )

    return cleaned, field_aliases


# ═══════════════════════════════════════════════════════════════
# filterStockInfo — OCR 后处理过滤（v3.0）
# ═══════════════════════════════════════════════════════════════

# 广告/营销关键词（完整列表，用于 final-pass 过滤）
_AD_FINAL_KEYWORDS: list[str] = [
    '扫码下载', '扫码关注', '扫一扫', '下载APP', '下载App', '下载应用',
    '立即下载', '免费下载', '点击下载', '安装', '领取', '红包', '优惠',
    '限时', '秒杀', '抢购', '特价', '打折', '满减', '免费', '试用',
    '关注公众号', '关注微信', '加微信', '加群', '微信群', 'QQ群',
    '课程', '培训', '导师', '带单', '跟单', '喊单', '荐股', '推票',
    '收益翻倍', '稳赚', '暴富', '涨停板', '内幕', '独家', '秘诀',
    '副业', '兼职', '赚钱', '理财课', '小白', '入门',
    '合作', '商务', '赞助', '推广', '广告',
]

# 非股票数字噪声模式（带数字但非价格/指标）
_NON_STOCK_NUMBER_PATTERNS: list[re.Pattern] = [
    re.compile(r'^\d{1,2}:\d{2}'),           # 时间戳 HH:MM
    re.compile(r'^\d{4}-\d{2}-\d{2}'),        # 日期 YYYY-MM-DD
    re.compile(r'^\d+楼$'),                    # 楼层
    re.compile(r'^\d+分钟前$'),                # 相对时间
    re.compile(r'^\d+小时前$'),
    re.compile(r'^\d+天前$'),
    re.compile(r'^阅读\s*\d+'),                # 阅读计数
    re.compile(r'^回复\s*\d+'),                # 回复计数
    re.compile(r'^点赞\s*\d+'),                # 点赞计数
    re.compile(r'^转发\s*\d+'),                # 转发计数
    re.compile(r'^粉丝\s*\d+'),                # 粉丝计数
    re.compile(r'^人气\s*\d+'),                # 人气值
    re.compile(r'^第\d+'),                     # 排序序号
    re.compile(r'^\d+\s*人'),                  # 人数统计
    re.compile(r'^\d+\s*条'),                  # 条数统计
    re.compile(r'^\d{11,}$'),                  # 手机号/长数字ID
    re.compile(r'^\d{7,8}$'),                  # 电话号码
]


def filterStockInfo(
    ocr_texts: list[str],
    ocr_confidences: list[float],
    image_path: str = '',
) -> dict:
    """
    OCR 后处理过滤函数 — 从原始 OCR 结果中自动过滤非股票信息，
    只保留股票相关数据并输出结构化 JSON。

    过滤逻辑：
      1. 按 OCR 置信度过滤（丢弃 < 0.75 的低质量识别结果）
      2. 过滤广告、导航、时间戳、URL 等非股票噪声
      3. 过滤带数字但非股票指标的行（阅读数、粉丝数等）
      4. 提取股票代码、名称、价格、涨跌幅、成交量、PE/PB 等
      5. 如果无任何有效股票信息，返回错误对象

    参数:
        ocr_texts: OCR 原始文本列表
        ocr_confidences: 每条文本的 PaddleOCR 置信度 (0.0–1.0)
        image_path: 图片路径（用于日志）

    返回:
        成功: {'code': '600519', 'name': '贵州茅台', 'price': 1688.00, ...}
        失败: {'error': '未识别到股票信息'}
    """
    if not ocr_texts or len(ocr_texts) == 0:
        return {'error': '未识别到股票信息'}

    # ── Step 1: 置信度过滤（丢弃 < 0.75） ──
    MIN_CONFIDENCE = 0.75
    high_conf_texts: list[str] = []
    low_conf_count = 0
    for i, text in enumerate(ocr_texts):
        conf = ocr_confidences[i] if i < len(ocr_confidences) else 0.0
        if conf >= MIN_CONFIDENCE:
            high_conf_texts.append(text)
        else:
            low_conf_count += 1

    logger.info(
        '[filterStockInfo] 置信度过滤: %d 行保留 (≥%.0f%%), %d 行丢弃',
        len(high_conf_texts), MIN_CONFIDENCE * 100, low_conf_count,
    )

    if not high_conf_texts:
        return {'error': '未识别到股票信息'}

    # ── Step 2: 噪声过滤（复用现有 filter_texts） ──
    filtered_texts = filter_texts(high_conf_texts)

    if not filtered_texts:
        return {'error': '未识别到股票信息'}

    # ── Step 3: Final-pass 广告/非股票数字过滤 ──
    final_texts: list[str] = []
    for text in filtered_texts:
        stripped = text.strip()

        # 检查广告关键词
        is_ad = False
        for kw in _AD_FINAL_KEYWORDS:
            if kw in stripped:
                is_ad = True
                break
        if is_ad:
            logger.debug('[filterStockInfo] 广告过滤: "%s"', stripped)
            continue

        # 检查非股票数字噪声模式
        is_noise_number = False
        for pat in _NON_STOCK_NUMBER_PATTERNS:
            if pat.match(stripped):
                is_noise_number = True
                break
        if is_noise_number:
            logger.debug('[filterStockInfo] 噪声数字过滤: "%s"', stripped)
            continue

        # 纯数字行且 <= 3位（不可能是价格/指标）
        if re.match(r'^\d{1,3}$', stripped):
            logger.debug('[filterStockInfo] 短数字过滤: "%s"', stripped)
            continue

        final_texts.append(stripped)

    if not final_texts:
        return {'error': '未识别到股票信息'}

    # ── Step 4: 股票代码 + 名称提取（必须在排序前，否则名称可能远离代码行） ──
    extraction_methods: dict[str, str] = {}

    # 平台检测 + 平台专项规则
    platform = _detect_platform(final_texts)
    platform_texts = list(final_texts)
    platform_field_aliases: dict[str, list[str]] = {}
    if platform:
        platform_texts, platform_field_aliases = _apply_platform_rules(platform, platform_texts)
        if not platform_texts:
            platform_texts = list(final_texts)

    # 股票代码 + 名称（在排序前提取，确保名称邻近匹配生效）
    code_info = _extract_code_info(platform_texts, extraction_methods)

    # ── Step 5: 股票相关度排序 ──
    platform_texts = _rank_by_relevance(platform_texts)

    # ── Step 6: 价格涨跌提取 ──
    code_idx: Optional[int] = None
    code_text = code_info.get('code')
    if code_text:
        for i, t in enumerate(platform_texts):
            if code_text in t:
                code_idx = i
                break
    price_change = _extract_price_change(platform_texts, code_idx, extraction_methods)

    # ── Step 7: 基本指标 ──
    indicators = _extract_stock_indicators(
        platform_texts, extraction_methods,
        extra_aliases=platform_field_aliases if platform_field_aliases else None,
    )

    # ── Step 8: 判断是否有效 ──
    stock_name = code_info.get('name')
    stock_code_raw = code_info.get('code')
    market = code_info.get('market')
    stock_code = f"{market}{stock_code_raw}" if market and stock_code_raw else stock_code_raw
    current_price = price_change.get('price')

    # 必须至少有 股票代码/名称 + 价格 才认为有效
    has_stock = bool(
        (stock_code_raw and stock_name) or
        (stock_code_raw and current_price is not None) or
        (stock_name and current_price is not None)
    )

    if not has_stock:
        logger.warning(
            '[filterStockInfo] 未识别到有效股票信息 (name=%s code=%s price=%s)',
            stock_name, stock_code_raw, current_price,
        )
        return {'error': '未识别到股票信息'}

    # ── Step 7: 构建结构化输出 ──
    result: dict = {
        'code': stock_code_raw,          # 纯6位数字
        'market': market,                 # SH/SZ/BJ
        'name': stock_name,
    }

    # 价格
    if current_price is not None:
        result['price'] = round(current_price, 2)

    # 涨跌幅
    change_pct = price_change.get('change_percent')
    if change_pct is not None:
        sign = '+' if change_pct >= 0 else ''
        result['change_pct'] = f'{sign}{change_pct:.2f}%'

    # 涨跌额
    change_amt = price_change.get('change_amount')
    if change_amt is not None:
        sign = '+' if change_amt >= 0 else ''
        result['change_amt'] = f'{sign}{change_amt:.2f}'

    # 今开
    if indicators.get('open') is not None:
        result['open'] = round(indicators['open'], 2)

    # 昨收
    if indicators.get('prev_close') is not None:
        result['prev_close'] = round(indicators['prev_close'], 2)

    # 最高
    if indicators.get('high') is not None:
        result['high'] = round(indicators['high'], 2)

    # 最低
    if indicators.get('low') is not None:
        result['low'] = round(indicators['low'], 2)

    # 成交量（保持原始数值）
    if indicators.get('volume') is not None:
        result['volume'] = indicators['volume']

    # 成交额（保持原始数值）
    if indicators.get('turnover') is not None:
        result['turnover'] = indicators['turnover']

    # 换手率
    if indicators.get('turnover_rate') is not None:
        result['turnover_rate'] = _fmt_percent(indicators['turnover_rate'])

    # 市盈率 PE
    if indicators.get('pe') is not None:
        result['pe'] = round(indicators['pe'], 2)

    # 市净率 PB
    if indicators.get('pb') is not None:
        result['pb'] = round(indicators['pb'], 2)

    # 振幅
    if indicators.get('amplitude') is not None:
        result['amplitude'] = _fmt_percent(indicators['amplitude'])

    # 量比
    if indicators.get('volume_ratio') is not None:
        result['volume_ratio'] = round(indicators['volume_ratio'], 2)

    # 总市值
    if indicators.get('total_market_cap') is not None:
        result['total_market_cap'] = indicators['total_market_cap']

    # 流通市值
    if indicators.get('circulating_market_cap') is not None:
        result['circulating_market_cap'] = indicators['circulating_market_cap']

    logger.info(
        '[filterStockInfo] 提取成功: code=%s name=%s price=%s fields=%d',
        stock_code_raw, stock_name, current_price,
        len(result) - 3,  # 减去 code/market/name
    )

    return result


# ═══════════════════════════════════════════════════════════════
# 主入口
# ═══════════════════════════════════════════════════════════════

def extract_stock_info(
    texts: list[str],
    ocr_confidence: Optional[float] = None,
    debug: bool = False,
) -> dict:
    """
    从 OCR 文本提取结构化股票信息（v2.0 增强版）。

    参数:
        texts: OCR 原始文本列表（未过滤）
        ocr_confidence: OCR 整体置信度
        debug: 是否启用调试模式（返回 debug_info）

    返回:
        {
            'source': 'ocr',
            'stock': {field: {value, confidence}, ...},
            'technical': {field: {value, confidence}, ...},
            'analysis': {...},
            'has_stock_data': bool,
            'low_confidence_warning': bool,
            'confidence_warnings': [...],
            'debug_info': {...}  # 仅 debug=True
        }
    """
    # 初始化调试收集器
    collector = DebugCollector() if debug else None

    if collector:
        collector.record_raw_ocr(texts, ocr_confidence)

    # ── Step 1: 过滤 ──
    if debug and collector:
        kept, removed = filter_texts_detailed(texts)
        collector.record_filter(kept, [
            {'text': d.text, 'reason': d.reason, 'category': d.category}
            for d in removed
        ])
    else:
        kept = filter_texts(texts)

    if not kept:
        empty_result = {
            'source': 'ocr',
            'stock': {
                'name': {'value': None, 'confidence': 0.0},
                'code': {'value': None, 'confidence': 0.0},
                'current_price': {'value': None, 'confidence': 0.0},
                'change_amount': {'value': None, 'confidence': 0.0},
                'change_percent': {'value': None, 'confidence': 0.0},
                'high': {'value': None, 'confidence': 0.0},
                'low': {'value': None, 'confidence': 0.0},
                'open': {'value': None, 'confidence': 0.0},
                'prev_close': {'value': None, 'confidence': 0.0},
                'volume': {'value': None, 'confidence': 0.0},
                'turnover': {'value': None, 'confidence': 0.0},
                'turnover_rate': {'value': None, 'confidence': 0.0},
                'pe': {'value': None, 'confidence': 0.0},
                'pb': {'value': None, 'confidence': 0.0},
                'total_market_cap': {'value': None, 'confidence': 0.0},
                'circulating_market_cap': {'value': None, 'confidence': 0.0},
                'volume_ratio': {'value': None, 'confidence': 0.0},
                'amplitude': {'value': None, 'confidence': 0.0},
                'committee_ratio': {'value': None, 'confidence': 0.0},
            },
            'technical': {
                'ma5': {'value': None, 'confidence': 0.0},
                'ma10': {'value': None, 'confidence': 0.0},
                'ma20': {'value': None, 'confidence': 0.0},
                'ma60': {'value': None, 'confidence': 0.0},
                'ma120': {'value': None, 'confidence': 0.0},
                'ma250': {'value': None, 'confidence': 0.0},
                'macd_dif': {'value': None, 'confidence': 0.0},
                'macd_dea': {'value': None, 'confidence': 0.0},
                'macd_bar': {'value': None, 'confidence': 0.0},
                'kdj_k': {'value': None, 'confidence': 0.0},
                'kdj_d': {'value': None, 'confidence': 0.0},
                'kdj_j': {'value': None, 'confidence': 0.0},
                'rsi6': {'value': None, 'confidence': 0.0},
                'rsi14': {'value': None, 'confidence': 0.0},
                'rsi24': {'value': None, 'confidence': 0.0},
                'boll_upper': {'value': None, 'confidence': 0.0},
                'boll_mid': {'value': None, 'confidence': 0.0},
                'boll_lower': {'value': None, 'confidence': 0.0},
                'wr10': {'value': None, 'confidence': 0.0},
                'bias6': {'value': None, 'confidence': 0.0},
                'bias12': {'value': None, 'confidence': 0.0},
            },
            'analysis': {
                'summary': '过滤后无有效文本',
                'bullish_signals': [],
                'bearish_signals': [],
                'risk_warning': 'OCR 文本全部被过滤，请确认截图质量。',
                'confidence': 0.0,
                'disclaimer': '本分析仅基于截图 OCR 识别结果生成，不构成投资建议。',
            },
            'has_stock_data': False,
            'low_confidence_warning': False,
            'confidence_warnings': ['过滤后无有效文本'],
        }
        if collector:
            collector.record_final_json(empty_result)
            empty_result['debug_info'] = collector.to_dict()
        return empty_result

    # ── Step 1c: 平台检测 + 平台专项规则 ──
    platform = _detect_platform(kept)
    platform_field_aliases: dict[str, list[str]] = {}
    if platform:
        kept, platform_field_aliases = _apply_platform_rules(platform, kept)
        if collector:
            collector.record_classification({
                'detected_platform': platform,
                'field_aliases': platform_field_aliases,
            })
        # 如果平台规则过滤后文本为空，回退到原始 kept
        if not kept:
            logger.warning('平台规则过滤后无文本，回退到原始过滤结果')
            # 重新过滤但跳过平台特有噪声
            kept = filter_texts(texts)
            kept = _rank_by_relevance(kept)

    # ── Step 2: 股票代码 + 名称提取 ──
    extraction_methods: dict[str, str] = {}
    # 注入平台别名（如果检测到平台）
    _platform_aliases = platform_field_aliases if platform else {}
    code_info = _extract_code_info(kept, extraction_methods, collector)

    # ── Step 2b: 股票相关性排序（高分在前） ──
    # 代码/名称提取后，对剩余文本按股票相关性重排，
    # 使指标提取阶段更快命中关键字段
    kept = _rank_by_relevance(kept)

    # ── Step 3: 价格涨跌提取 ──
    code_idx: Optional[int] = None
    code_text = code_info.get('code')
    if code_text:
        for i, t in enumerate(kept):
            if code_text in t:
                code_idx = i
                break
    price_change = _extract_price_change(kept, code_idx, extraction_methods, collector)

    # ── Step 4: 基本指标 ──
    indicators = _extract_stock_indicators(
        kept, extraction_methods, collector,
        extra_aliases=_platform_aliases if _platform_aliases else None,
    )

    # ── Step 5: 技术指标 ──
    tech_indicators = _extract_technical_indicators(kept, extraction_methods, collector)

    # ── 合并原始值 ──
    raw_stock: dict[str, Optional[Any]] = {
        'name': code_info.get('name'),
        'code': (f"{code_info.get('market', '')}{code_info.get('code', '')}"
                  if code_info.get('market') and code_info.get('code')
                  else code_info.get('code')),
        'current_price': price_change.get('price'),
        'change_amount': price_change.get('change_amount'),
        'change_percent': price_change.get('change_percent'),
        'high': indicators.get('high'),
        'low': indicators.get('low'),
        'open': indicators.get('open'),
        'prev_close': indicators.get('prev_close'),
        'volume': indicators.get('volume'),
        'turnover': indicators.get('turnover'),
        'turnover_rate': indicators.get('turnover_rate'),
        'pe': indicators.get('pe'),
        'pb': indicators.get('pb'),
        'total_market_cap': indicators.get('total_market_cap'),
        'circulating_market_cap': indicators.get('circulating_market_cap'),
        'volume_ratio': indicators.get('volume_ratio'),
        'amplitude': indicators.get('amplitude'),
        'committee_ratio': indicators.get('committee_ratio'),
    }

    raw_technical: dict[str, Optional[Any]] = {
        'ma5': tech_indicators.get('ma5'),
        'ma10': tech_indicators.get('ma10'),
        'ma20': tech_indicators.get('ma20'),
        'ma60': tech_indicators.get('ma60'),
        'ma120': tech_indicators.get('ma120'),
        'ma250': tech_indicators.get('ma250'),
        'macd_dif': tech_indicators.get('macd_dif'),
        'macd_dea': tech_indicators.get('macd_dea'),
        'macd_bar': tech_indicators.get('macd_bar'),
        'kdj_k': tech_indicators.get('kdj_k'),
        'kdj_d': tech_indicators.get('kdj_d'),
        'kdj_j': tech_indicators.get('kdj_j'),
        'rsi6': tech_indicators.get('rsi6'),
        'rsi14': tech_indicators.get('rsi14'),
        'rsi24': tech_indicators.get('rsi24'),
        'boll_upper': tech_indicators.get('boll_upper'),
        'boll_mid': tech_indicators.get('boll_mid'),
        'boll_lower': tech_indicators.get('boll_lower'),
        'wr10': tech_indicators.get('wr10'),
        'bias6': tech_indicators.get('bias6'),
        'bias12': tech_indicators.get('bias12'),
    }

    # ── Step 6: 可信度评分 ──
    stock_with_conf, tech_with_conf, _cross_bonuses = score_all_fields(
        raw_stock, raw_technical, extraction_methods, ocr_confidence
    )

    # ── Step 7: 格式化输出（使用原始值格式化，保留 conf 包装） ──
    stock_section: dict[str, dict] = {}
    for field, raw_val in raw_stock.items():
        conf = stock_with_conf[field]['confidence']

        # 格式化
        if field in ('change_amount',):
            formatted = _fmt_signed(raw_val)
        elif field in ('change_percent', 'turnover_rate', 'amplitude', 'committee_ratio'):
            formatted = _fmt_percent(raw_val)
        elif field == 'volume':
            formatted = _fmt_volume(raw_val)
        elif field in ('turnover', 'total_market_cap', 'circulating_market_cap'):
            formatted = _fmt_large_amount(raw_val)
        elif field in ('pe', 'pb', 'volume_ratio'):
            formatted = _fmt_decimal(raw_val)
        elif field in ('price', 'current_price', 'open', 'high', 'low', 'prev_close'):
            formatted = _fmt_price(raw_val)
        else:
            formatted = str(raw_val) if raw_val is not None else None

        stock_section[field] = {
            'value': formatted,
            'confidence': conf,
        }

    technical_section: dict[str, dict] = {}
    for field, raw_val in raw_technical.items():
        conf = tech_with_conf[field]['confidence']
        formatted = _fmt_tech_val(raw_val)
        technical_section[field] = {
            'value': formatted,
            'confidence': conf,
        }

    # ── Step 8: 可信度警告 ──
    low_conf, conf_warnings = check_confidence_warning(stock_section)

    # ── Step 9: 分析生成 ──
    analysis_section = _generate_analysis(stock_section, technical_section, ocr_confidence)

    # ── has_stock_data 判断 ──
    has_data = bool(
        stock_section['name']['value'] and
        (stock_section['code']['value'] or stock_section['current_price']['value'])
    )

    # ── 组装输出 ──
    output: dict = {
        'source': 'ocr',
        'stock': stock_section,
        'technical': technical_section,
        'analysis': analysis_section,
        'has_stock_data': has_data,
        'low_confidence_warning': low_conf,
        'confidence_warnings': conf_warnings,
    }

    if collector:
        collector.record_final_json(output)
        output['debug_info'] = collector.to_dict()

    logger.info(
        'StockExtractor: 输出完成 has_stock_data=%s stock_fields=%d tech_fields=%d low_conf=%s',
        has_data,
        sum(1 for v in stock_section.values() if v['value'] is not None),
        sum(1 for v in technical_section.values() if v['value'] is not None),
        low_conf,
    )

    return output
