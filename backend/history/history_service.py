"""
History Service — 业务逻辑层

职责:
- 自动保存（hash 去重：存在则更新，不存在则插入）
- 前端触发保存（hash + 同股票代码 10 分钟内去重）
- 查询 / 搜索 / 分页
- 导出（Markdown / JSON / TXT）
- 删除 / 清空

不直接操作 SQLite — 通过 HistoryRepository 访问数据。
"""

from __future__ import annotations
import json
import hashlib
import logging
import time
from typing import Optional, Any

from .history_repository import HistoryRepository

logger = logging.getLogger(__name__)

# 同股票代码去重窗口（秒）
DEDUP_CODE_WINDOW_SEC = 600  # 10 分钟


class HistoryService:
    """历史记录业务服务"""

    def __init__(self, repository: Optional[HistoryRepository] = None):
        self._repo = repository or HistoryRepository()

    # ── 前端触发保存 ───────────────────────────────────────

    def save_from_frontend(self, data: dict[str, Any]) -> dict[str, Any]:
        """
        前端识别完成后主动保存。

        去重策略（按优先级）:
          1. 同一图片 hash（文件存在时） → 更新
          2. 同一股票代码且距上次记录 < 10 分钟 → 更新
          3. 否则 → 新增

        请求体字段: image_path, stock_code, stock_name,
                    current_price, change_percent, change_amount,
                    open, high, low, volume, turnover,
                    ai_score, risk_level, analysis_summary,
                    raw_ocr_text, source
        """
        image_path = data.get('image_path') or ''
        stock_code = data.get('stock_code') or ''
        stock_name = data.get('stock_name') or ''

        # 1. 构建 structured_json（包含前端传入的额外字段）
        extra = {
            'ai_score': data.get('ai_score'),
            'risk_level': data.get('risk_level'),
            'analysis_summary': data.get('analysis_summary'),
            'source': data.get('source', 'ocr'),
        }
        stock_data = {
            'stock_name': stock_name,
            'stock_code': stock_code,
            'current_price': data.get('current_price'),
            'change_percent': data.get('change_percent'),
            'change_amount': data.get('change_amount'),
            'open': data.get('open'),
            'high': data.get('high'),
            'low': data.get('low'),
            'volume': data.get('volume'),
            'turnover': data.get('turnover'),
        }
        stock_data.update(extra)
        structured_json = json.dumps(stock_data, ensure_ascii=False, default=str)

        # 2. 计算图片 hash（文件可能已被清理）
        image_hash = self._compute_file_hash(image_path) if image_path else ''

        # 3. 去重检查
        existing_id = None

        # 3a. 按 hash 去重
        if image_hash and not image_hash.startswith('missing:') and not image_hash.startswith('error:'):
            dup = self._repo.get_by_hash(image_hash)
            if dup:
                existing_id = dup['id']
                logger.info('[History] 命中 hash 去重: id=%d hash=%s', existing_id, image_hash[:12])

        # 3b. 按股票代码 + 时间窗口去重
        if existing_id is None and stock_code:
            dup = self._find_recent_by_code(stock_code)
            if dup:
                existing_id = dup['id']
                logger.info('[History] 命中股票代码去重: id=%d code=%s', existing_id, stock_code)

        # 4. 构建记录
        raw_ocr = data.get('raw_ocr_text') or ''
        ai_summary = data.get('analysis_summary') or ''
        risk_level = data.get('risk_level') or ''
        analysis_type = 'stock' if stock_code else 'ocr'

        record = {
            'image_path': image_path,
            'image_hash': image_hash,
            'analysis_type': analysis_type,
            'stock_name': stock_name,
            'stock_code': stock_code,
            'structured_json': structured_json,
            'ai_summary': ai_summary,
            'raw_ocr_text': raw_ocr,
        }

        if existing_id:
            self._repo.update(existing_id, record)
            record_id = existing_id
            is_new = False
            logger.info('[History] 更新记录: id=%d name=%s code=%s', record_id, stock_name, stock_code)
        else:
            record_id = self._repo.insert(record)
            is_new = True
            logger.info('[History] 新增记录: id=%d name=%s code=%s', record_id, stock_name, stock_code)

        return {'id': record_id, 'is_new': is_new}

    def _find_recent_by_code(self, stock_code: str) -> Optional[dict[str, Any]]:
        """
        查询同一股票代码最近一条记录，若在 10 分钟内则返回。
        """
        try:
            result = self._repo.list_records(
                search=stock_code,
                sort='created_at_desc',
                page=1,
                page_size=1,
            )
            items = result.get('items', [])
            if not items:
                return None

            latest = items[0]
            created_at = latest.get('created_at', '')
            if not created_at:
                return None

            # 解析时间
            try:
                from datetime import datetime
                record_time = datetime.strptime(created_at, '%Y-%m-%d %H:%M:%S')
                now = datetime.now()
                diff_sec = (now - record_time).total_seconds()
                if diff_sec < DEDUP_CODE_WINDOW_SEC:
                    return latest
            except (ValueError, TypeError):
                return None

            return None
        except Exception:
            logger.exception('[History] 查询最近记录异常')
            return None

    # ── 自动保存（后端备用，当前不再使用）─────────────────

    def save_analysis(
        self,
        image_path: str,
        stock_result: dict[str, Any],
        raw_ocr_texts: Optional[list[str]] = None,
        ai_summary: Optional[str] = None,
    ) -> dict[str, Any]:
        """
        自动保存分析结果。同一张图片（SHA256 hash 相同）默认更新而非重复插入。

        参数:
            image_path: 原始图片路径
            stock_result: stock_parser.parse_stock_info() 的完整返回
            raw_ocr_texts: OCR 原始文本行列表
            ai_summary: AI 分析摘要（可选，当前占位）

        返回:
            {id, is_new, ...} — 含记录 id 和是否新插入标记
        """
        # 计算图片哈希
        image_hash = self._compute_file_hash(image_path)

        # 拼接 OCR 原始文本
        raw_ocr = '\n'.join(raw_ocr_texts) if raw_ocr_texts else ''

        # 构建记录
        record = {
            'image_path': image_path,
            'image_hash': image_hash,
            'analysis_type': 'stock' if stock_result.get('stock_code') else 'ocr',
            'stock_name': stock_result.get('stock_name'),
            'stock_code': stock_result.get('stock_code'),
            'structured_json': json.dumps(stock_result, ensure_ascii=False, default=str),
            'ai_summary': ai_summary,
            'raw_ocr_text': raw_ocr,
        }

        record_id, is_new = self._repo.upsert_by_hash(record)

        verb = "新建" if is_new else "更新"
        logger.info(
            "历史记录 %s: id=%d name=%s code=%s",
            verb, record_id,
            record.get('stock_name'), record.get('stock_code'),
        )

        return {
            'id': record_id,
            'is_new': is_new,
            'image_hash': image_hash,
        }

    # ── 查询 ────────────────────────────────────────────────

    def get_record(self, record_id: int) -> Optional[dict[str, Any]]:
        record = self._repo.get_by_id(record_id)
        if record and record.get('structured_json'):
            try:
                record['_parsed'] = json.loads(record['structured_json'])
            except json.JSONDecodeError:
                record['_parsed'] = {}
        return record

    def list_records(
        self,
        search: Optional[str] = None,
        sort: str = 'created_at_desc',
        page: int = 1,
        page_size: int = 20,
    ) -> dict[str, Any]:
        """
        分页查询历史记录。

        返回:
            {items: [...], total: int, page: int, page_size: int, total_pages: int}
        每个 item 额外包含 thumbnail_text（摘要前 2 行）
        """
        result = self._repo.list_records(
            search=search, sort=sort, page=page, page_size=page_size
        )

        # 为每个 item 添加摘要文本
        for item in result['items']:
            item['summary_preview'] = self._make_summary_preview(item)

        return result

    # ── 删除 ────────────────────────────────────────────────

    def delete_record(self, record_id: int) -> bool:
        return self._repo.delete(record_id)

    def clear_all(self) -> int:
        return self._repo.clear_all()

    # ── 导出 ────────────────────────────────────────────────

    def export(self, record_id: int, fmt: str = 'md') -> Optional[str]:
        """
        导出单条记录。

        参数:
            record_id: 记录 ID
            fmt: 'md' | 'json' | 'txt'

        返回:
            格式化后的字符串内容
        """
        record = self.get_record(record_id)
        if not record:
            return None

        if fmt == 'json':
            return self._export_json(record)
        elif fmt == 'txt':
            return self._export_txt(record)
        else:
            return self._export_markdown(record)

    def _export_markdown(self, record: dict[str, Any]) -> str:
        parsed = record.get('_parsed', {})
        stock_name = record.get('stock_name') or '未知'
        stock_code = record.get('stock_code') or '--'
        created_at = record.get('created_at', '')

        lines = [
            f"# SnapVision 分析报告",
            "",
            f"**股票名称:** {stock_name}",
            f"**股票代码:** {stock_code}",
            f"**识别时间:** {created_at}",
            "",
            "---",
            "",
            "## 股票数据",
            "",
        ]

        # 结构化字段
        fields = [
            ('当前价格', 'current_price'),
            ('涨跌额', 'change_amount'),
            ('涨跌幅', 'change_percent'),
            ('今开', 'open'),
            ('最高', 'high'),
            ('最低', 'low'),
            ('成交量', 'volume'),
            ('成交额', 'turnover'),
            ('换手率', 'turnover_rate'),
            ('市盈率', 'pe'),
            ('市净率', 'pb'),
        ]
        for label, key in fields:
            val = parsed.get(key) if parsed else None
            if val:
                lines.append(f"| {label} | {val} |")

        lines.append("")

        # AI 分析
        ai_summary = record.get('ai_summary')
        if ai_summary:
            lines.append("## AI 分析")
            lines.append("")
            lines.append(ai_summary)
            lines.append("")

        # OCR 原文
        raw_ocr = record.get('raw_ocr_text')
        if raw_ocr:
            lines.append("## OCR 原始文本")
            lines.append("")
            lines.append("```")
            lines.append(raw_ocr)
            lines.append("```")
            lines.append("")

        lines.append("---")
        lines.append(f"*由 SnapVision 生成 · {created_at}*")

        return '\n'.join(lines)

    def _export_json(self, record: dict[str, Any]) -> str:
        parsed = record.get('_parsed', {})
        export_obj = {
            'id': record.get('id'),
            'created_at': record.get('created_at'),
            'stock_name': record.get('stock_name'),
            'stock_code': record.get('stock_code'),
            'analysis_type': record.get('analysis_type'),
            'data': parsed,
            'ai_summary': record.get('ai_summary'),
            'raw_ocr_text': record.get('raw_ocr_text'),
        }
        return json.dumps(export_obj, ensure_ascii=False, indent=2, default=str)

    def _export_txt(self, record: dict[str, Any]) -> str:
        parsed = record.get('_parsed', {})
        stock_name = record.get('stock_name') or '未知'
        stock_code = record.get('stock_code') or '--'

        lines = [
            f"SnapVision 分析报告",
            f"====================",
            f"",
            f"股票名称: {stock_name}",
            f"股票代码: {stock_code}",
            f"识别时间: {record.get('created_at', '')}",
            f"",
        ]

        fields = [
            ('当前价格', 'current_price'),
            ('涨跌额', 'change_amount'),
            ('涨跌幅', 'change_percent'),
            ('今开', 'open'),
            ('最高', 'high'),
            ('最低', 'low'),
            ('成交量', 'volume'),
            ('成交额', 'turnover'),
            ('换手率', 'turnover_rate'),
            ('市盈率', 'pe'),
            ('市净率', 'pb'),
        ]
        for label, key in fields:
            val = parsed.get(key) if parsed else None
            if val:
                lines.append(f"{label}: {val}")

        lines.append("")

        ai_summary = record.get('ai_summary')
        if ai_summary:
            lines.append(f"--- AI 分析 ---")
            lines.append(ai_summary)
            lines.append("")

        raw_ocr = record.get('raw_ocr_text')
        if raw_ocr:
            lines.append(f"--- OCR 原文 ---")
            lines.append(raw_ocr)
            lines.append("")

        return '\n'.join(lines)

    # ── 辅助 ────────────────────────────────────────────────

    @staticmethod
    def _compute_file_hash(filepath: str) -> str:
        """计算文件 SHA256"""
        sha = hashlib.sha256()
        try:
            with open(filepath, 'rb') as f:
                for chunk in iter(lambda: f.read(8192), b''):
                    sha.update(chunk)
        except FileNotFoundError:
            logger.warning("File not found for hash: %s", filepath)
            return f"missing:{filepath}"
        except Exception:
            logger.exception("Failed to hash file: %s", filepath)
            return f"error:{filepath}"
        return sha.hexdigest()

    @staticmethod
    def _make_summary_preview(record: dict[str, Any]) -> str:
        """生成列表摘要（前 1-2 行）"""
        ai_summary = record.get('ai_summary')
        if ai_summary:
            lines = ai_summary.strip().split('\n')
            return '\n'.join(lines[:2])

        # 回退：基于结构化数据生成简单摘要
        stock_name = record.get('stock_name') or ''
        stock_code = record.get('stock_code') or ''

        try:
            parsed = json.loads(record.get('structured_json', '{}'))
        except (json.JSONDecodeError, TypeError):
            parsed = {}

        price = parsed.get('current_price', '')
        change = parsed.get('change_percent', '')

        parts = []
        if stock_name:
            parts.append(stock_name)
        if stock_code:
            parts.append(f"({stock_code})")
        if price:
            parts.append(f"¥{price}")
        if change:
            parts.append(change)

        return ' '.join(parts) if parts else '(无摘要)'
