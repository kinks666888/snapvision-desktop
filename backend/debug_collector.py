"""
Debug Collector — 调试信息收集器（阶段四）

在提取流水线中收集调试信息，包括：
  - 原始 OCR 文本
  - 截图分类结果
  - 过滤后文本 + 被过滤的内容及原因
  - 每字段的提取决策（方法、源行、中间值）
  - 最终结构化 JSON

用法:
    collector = DebugCollector()
    collector.record_raw_ocr(texts)
    collector.record_classification(result)
    collector.record_filter(kept, removed)
    collector.record_extraction(field, value, method, source_line)
    collector.record_final_json(output)
    debug_info = collector.to_dict()
"""

from __future__ import annotations
from typing import Optional, Any
import time


class DebugCollector:
    """贯穿提取流水线的调试信息收集器"""

    def __init__(self) -> None:
        self._start_time = time.time()

        # 原始数据
        self.raw_ocr_texts: list[str] = []
        self.ocr_confidence: Optional[float] = None
        self.ocr_line_confidences: list[float] = []

        # 分类
        self.screenshot_type: dict = {}

        # 过滤
        self.filtered_texts: list[str] = []
        self.filtered_out: list[dict] = []  # [{text, reason, category}]

        # 提取决策
        self.field_extractions: list[dict] = []  # [{field, value, confidence, method, source_line_index, source_line_text}]

        # 最终输出
        self.final_json: dict = {}

    # ── 记录方法 ───────────────────────────────────────────────

    def record_raw_ocr(
        self,
        texts: list[str],
        ocr_confidence: Optional[float] = None,
        line_confidences: Optional[list[float]] = None,
    ) -> None:
        """记录原始 OCR 输出"""
        self.raw_ocr_texts = list(texts)
        self.ocr_confidence = ocr_confidence
        if line_confidences:
            self.ocr_line_confidences = list(line_confidences)

    def record_classification(self, result: dict) -> None:
        """记录截图分类结果"""
        self.screenshot_type = dict(result)

    def record_filter(
        self,
        kept: list[str],
        removed: list[dict],
    ) -> None:
        """
        记录过滤结果。

        kept: 保留的文本列表
        removed: 被过滤的 [{text, reason, category}]
        """
        self.filtered_texts = list(kept)
        self.filtered_out = list(removed)

    def record_extraction(
        self,
        field: str,
        value: Optional[Any],
        method: str,
        source_line_index: Optional[int] = None,
        source_line_text: Optional[str] = None,
        intermediate: Optional[dict] = None,
    ) -> None:
        """
        记录单字段提取决策。

        field: 字段名
        value: 提取到的值
        method: 提取方法
        source_line_index: 来源行索引（在 filter_texts 后列表中的位置）
        source_line_text: 来源行原文
        intermediate: 中间计算结果（可选）
        """
        self.field_extractions.append({
            'field': field,
            'value': value,
            'method': method,
            'source_line_index': source_line_index,
            'source_line_text': source_line_text,
            'intermediate': intermediate,
        })

    def record_final_json(self, output: dict) -> None:
        """记录最终输出"""
        self.final_json = dict(output)

    # ── 输出 ───────────────────────────────────────────────────

    def to_dict(self) -> dict:
        """导出完整调试信息"""
        elapsed = round((time.time() - self._start_time) * 1000)
        return {
            'pipeline_version': '1.0',
            'total_elapsed_ms': elapsed,

            # 原始 OCR
            'raw_ocr': {
                'texts': self.raw_ocr_texts,
                'line_count': len(self.raw_ocr_texts),
                'confidence': self.ocr_confidence,
                'line_confidences': self.ocr_line_confidences,
            },

            # 截图分类
            'screenshot_type': self.screenshot_type,

            # 过滤结果
            'filter': {
                'kept_texts': self.filtered_texts,
                'kept_count': len(self.filtered_texts),
                'removed_count': len(self.filtered_out),
                'removed_items': self.filtered_out,
                'compression_ratio': (
                    round(len(self.filtered_texts) / max(len(self.raw_ocr_texts), 1), 3)
                    if self.raw_ocr_texts else 0
                ),
            },

            # 字段提取决策
            'field_extractions': self.field_extractions,

            # 最终 JSON
            'final_json': self.final_json,
        }
