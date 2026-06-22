"""
SnapVision History Module — 历史记录持久化

数据库: SQLite (本地文件)
表: analysis_history
"""

import os
import stat

# ─── 数据库路径 ──────────────────────────────────────────────
# 开发环境：默认与 ocr_server.py 同目录（backend/）
# 生产环境：使用 SNAPVISION_DATA_DIR（由 Electron 主进程设置）
_DEFAULT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if os.environ.get('SNAPVISION_DATA_DIR'):
    _data_dir = os.environ['SNAPVISION_DATA_DIR']
    os.makedirs(_data_dir, exist_ok=True)
    # Set directory permissions to 700 (owner only)
    try:
        os.chmod(_data_dir, stat.S_IRWXU)
    except OSError:
        pass  # May fail on some systems
    DB_PATH = os.environ.get('HISTORY_DB_PATH', os.path.join(_data_dir, 'history.db'))
else:
    DB_PATH = os.environ.get('HISTORY_DB_PATH', os.path.join(_DEFAULT_DIR, 'history.db'))

APP_VERSION = os.environ.get('SNAPVISION_VERSION', '1.0.0')

def _set_secure_permissions(file_path: str) -> None:
    """Set file permissions to 600 (owner read/write only) for security."""
    try:
        if os.path.exists(file_path):
            os.chmod(file_path, stat.S_IRUSR | stat.S_IWUSR)
    except OSError:
        pass  # May fail on some systems

# ─── DDL ─────────────────────────────────────────────────────

SCHEMA = """
CREATE TABLE IF NOT EXISTS analysis_history (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    image_path      TEXT NOT NULL,
    image_hash      TEXT NOT NULL,
    analysis_type   TEXT NOT NULL DEFAULT 'stock',
    stock_name      TEXT,
    stock_code      TEXT,
    structured_json TEXT NOT NULL DEFAULT '{}',
    ai_summary      TEXT,
    raw_ocr_text    TEXT,
    app_version     TEXT NOT NULL DEFAULT '1.0.0'
);

CREATE INDEX IF NOT EXISTS idx_history_stock_code
    ON analysis_history(stock_code);

CREATE INDEX IF NOT EXISTS idx_history_stock_name
    ON analysis_history(stock_name);

CREATE INDEX IF NOT EXISTS idx_history_created_at
    ON analysis_history(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_history_image_hash
    ON analysis_history(image_hash);
"""
