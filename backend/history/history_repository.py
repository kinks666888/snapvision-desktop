"""
History Repository — SQLite 底层 CRUD 操作

纯数据访问层，不包含业务逻辑。
所有方法线程安全（每个调用创建独立连接）。
"""

from __future__ import annotations
import sqlite3
import logging
from typing import Optional, Any

from . import DB_PATH, SCHEMA, APP_VERSION, _set_secure_permissions

logger = logging.getLogger(__name__)


class HistoryRepository:
    """SQLite 数据访问对象 — 负责 analysis_history 表的所有 CRUD"""

    def __init__(self, db_path: str = DB_PATH):
        self._db_path = db_path
        self._ensure_schema()
        # Set secure permissions on database file
        _set_secure_permissions(self._db_path)

    # ── 连接管理 ───────────────────────────────────────────

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        return conn

    def _ensure_schema(self) -> None:
        try:
            conn = self._connect()
            conn.executescript(SCHEMA)
            conn.commit()
        except Exception:
            logger.exception("Failed to initialize history database schema")
            raise
        finally:
            conn.close()

    # ── 字典转换 ───────────────────────────────────────────

    @staticmethod
    def _row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
        return dict(row)

    # ── Create / Upsert ─────────────────────────────────────

    def insert(self, record: dict[str, Any]) -> int:
        """插入新记录，返回 id"""
        sql = """
            INSERT INTO analysis_history
                (image_path, image_hash, analysis_type,
                 stock_name, stock_code, structured_json,
                 ai_summary, raw_ocr_text, app_version)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """
        try:
            conn = self._connect()
            cur = conn.execute(sql, (
                record.get('image_path', ''),
                record.get('image_hash', ''),
                record.get('analysis_type', 'stock'),
                record.get('stock_name'),
                record.get('stock_code'),
                record.get('structured_json', '{}'),
                record.get('ai_summary'),
                record.get('raw_ocr_text'),
                record.get('app_version', APP_VERSION),
            ))
            conn.commit()
            row_id = cur.lastrowid
            return row_id
        except Exception:
            logger.exception("Failed to insert history record")
            raise
        finally:
            conn.close()

    def upsert_by_hash(self, record: dict[str, Any]) -> tuple[int, bool]:
        """
        按 image_hash 去重：存在则更新，不存在则插入。
        返回 (id, is_new) — is_new=True 表示新插入。
        """
        image_hash = record.get('image_hash', '')
        existing = self.get_by_hash(image_hash)

        if existing:
            self.update(existing['id'], record)
            return (existing['id'], False)
        else:
            new_id = self.insert(record)
            return (new_id, True)

    # ── Read ────────────────────────────────────────────────

    def get_by_id(self, record_id: int) -> Optional[dict[str, Any]]:
        try:
            conn = self._connect()
            row = conn.execute(
                "SELECT * FROM analysis_history WHERE id = ?", (record_id,)
            ).fetchone()
            return self._row_to_dict(row) if row else None
        except Exception:
            logger.exception("Failed to get history record by id")
            raise
        finally:
            conn.close()

    def get_by_hash(self, image_hash: str) -> Optional[dict[str, Any]]:
        try:
            conn = self._connect()
            row = conn.execute(
                "SELECT * FROM analysis_history WHERE image_hash = ?",
                (image_hash,)
            ).fetchone()
            return self._row_to_dict(row) if row else None
        except Exception:
            logger.exception("Failed to get history record by hash")
            raise
        finally:
            conn.close()

    def list_records(
        self,
        search: Optional[str] = None,
        sort: str = 'created_at_desc',
        page: int = 1,
        page_size: int = 20,
    ) -> dict[str, Any]:
        """
        分页列表查询。
        search: 模糊匹配 stock_code 或 stock_name
        sort: 'created_at_desc' | 'created_at_asc'
        返回: {items: [...], total: int, page: int, page_size: int}
        """
        where = "WHERE 1=1"
        params: list[Any] = []

        if search and search.strip():
            q = f"%{search.strip()}%"
            where += " AND (stock_code LIKE ? OR stock_name LIKE ?)"
            params.extend([q, q])

        order = "ORDER BY created_at DESC" if sort == 'created_at_desc' else "ORDER BY created_at ASC"

        offset = max(0, (page - 1) * page_size)

        try:
            conn = self._connect()

            # Count
            count_row = conn.execute(
                f"SELECT COUNT(*) as cnt FROM analysis_history {where}", params
            ).fetchone()
            total = count_row['cnt'] if count_row else 0

            # Fetch page
            rows = conn.execute(
                f"SELECT * FROM analysis_history {where} {order} LIMIT ? OFFSET ?",
                params + [page_size, offset]
            ).fetchall()

            items = [self._row_to_dict(r) for r in rows]

            return {
                'items': items,
                'total': total,
                'page': page,
                'page_size': page_size,
                'total_pages': max(1, (total + page_size - 1) // page_size),
            }
        except Exception:
            logger.exception("Failed to list history records")
            raise
        finally:
            conn.close()

    # ── Update ──────────────────────────────────────────────

    def update(self, record_id: int, record: dict[str, Any]) -> bool:
        sql = """
            UPDATE analysis_history SET
                updated_at = datetime('now', 'localtime'),
                image_path = ?,
                image_hash = ?,
                analysis_type = ?,
                stock_name = ?,
                stock_code = ?,
                structured_json = ?,
                ai_summary = ?,
                raw_ocr_text = ?,
                app_version = ?
            WHERE id = ?
        """
        try:
            conn = self._connect()
            cur = conn.execute(sql, (
                record.get('image_path', ''),
                record.get('image_hash', ''),
                record.get('analysis_type', 'stock'),
                record.get('stock_name'),
                record.get('stock_code'),
                record.get('structured_json', '{}'),
                record.get('ai_summary'),
                record.get('raw_ocr_text'),
                record.get('app_version', APP_VERSION),
                record_id,
            ))
            conn.commit()
            return cur.rowcount > 0
        except Exception:
            logger.exception("Failed to update history record")
            raise
        finally:
            conn.close()

    # ── Delete ──────────────────────────────────────────────

    def delete(self, record_id: int) -> bool:
        try:
            conn = self._connect()
            cur = conn.execute(
                "DELETE FROM analysis_history WHERE id = ?", (record_id,)
            )
            conn.commit()
            return cur.rowcount > 0
        except Exception:
            logger.exception("Failed to delete history record")
            raise
        finally:
            conn.close()

    def clear_all(self) -> int:
        try:
            conn = self._connect()
            cur = conn.execute("DELETE FROM analysis_history")
            conn.commit()
            deleted = cur.rowcount
            logger.info("Cleared %d history records", deleted)
            return deleted
        except Exception:
            logger.exception("Failed to clear history")
            raise
        finally:
            conn.close()
