#!/bin/bash
# =============================================================================
# bundle-python.sh — SnapVision Desktop  Python 依赖打包脚本
#
# 作用：将 backend/ 所需的 Python 依赖安装到 backend/bundle/ 目录，
#       随后 electron-builder 会将其一同打包进 .app/Contents/Resources/backend/
#
# 原理：使用 pip install --target 将所有依赖扁平安装到 bundle 目录。
#       打包后，主进程通过 PYTHONPATH 指向这个目录，使得系统 Python
#       也能找到 Flask / PaddleOCR 等依赖。
#
# 用法：在 npm run build:mac 中自动执行
# =============================================================================

set -euo pipefail

cd "$(dirname "$0")/../backend"

echo ""
echo "  ==============================================="
echo "   [bundle-python] 开始打包 Python 依赖..."
echo "  ==============================================="
echo ""

# 1. 清理旧的 bundle 目录（避免残留旧版本）
if [ -d "bundle" ]; then
  echo "  [bundle-python] 清理旧的 bundle 目录..."
  rm -rf bundle
fi

# 2. 确定 Python 3 路径（优先 python.org 3.12/3.11/3.10，跳过 < 3.10）
PYTHON_BIN=""
for candidate in "${PYTHON_BIN_PATH:-}" \
                 "/Library/Frameworks/Python.framework/Versions/3.12/bin/python3" \
                 "/Library/Frameworks/Python.framework/Versions/3.11/bin/python3" \
                 "/Library/Frameworks/Python.framework/Versions/3.10/bin/python3" \
                 "/opt/homebrew/bin/python3" \
                 "/usr/local/bin/python3" \
                 "python3"; do
  # Skip empty candidates (PYTHON_BIN_PATH may be unset)
  [ -z "$candidate" ] && continue

  if command -v "$candidate" &>/dev/null || [ -x "$candidate" ]; then
    # Check version >= 3.10 (for match syntax support in modern packages)
    ver=$("$candidate" --version 2>&1)
    if echo "$ver" | grep -qE '^Python\s+3\.([0-9]+)'; then
      minor=$(echo "$ver" | sed -E 's/^Python 3\.([0-9]+).*/\1/')
      if [ "$minor" -lt 10 ]; then
        echo "  [bundle-python] ⚠️  $candidate → $ver (低于 3.10，跳过)"
        continue
      fi
    fi
    PYTHON_BIN="$candidate"
    break
  fi
done

if [ -z "$PYTHON_BIN" ]; then
  echo "  [bundle-python] ❌ 未找到 Python 3.10+，请先安装 Python 3.10 或更高版本"
  exit 1
fi

PYTHON_VERSION=$("$PYTHON_BIN" --version 2>&1)
echo "  [bundle-python] 使用 Python: $PYTHON_BIN → $PYTHON_VERSION"

# 3. 检查 pip
if ! "$PYTHON_BIN" -m pip --version &>/dev/null; then
  echo "  [bundle-python] ❌ pip 不可用，请先安装 pip"
  exit 1
fi

# 4. pip install --target 到 bundle 目录
echo "  [bundle-python] 安装依赖到 backend/bundle/ ..."
echo ""

"$PYTHON_BIN" -m pip install \
  --target bundle \
  --upgrade \
  --no-user \
  -r requirements.txt

echo ""
echo "  [bundle-python] ✅ 依赖安装完成"

# 5. 记录 Python 版本元数据（运行时用）
"$PYTHON_BIN" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" > bundle/.python-version
echo "  [bundle-python]    记录 Python 版本: $(cat bundle/.python-version)"

# 6. 输出统计
PACKAGE_COUNT=$(find bundle -name "*.dist-info" -type d 2>/dev/null | wc -l | tr -d ' ')
echo "  [bundle-python]    共 $PACKAGE_COUNT 个包"
BUNDLE_SIZE=$(du -sh bundle 2>/dev/null | cut -f1)
echo "  [bundle-python]    目录大小: $BUNDLE_SIZE"
echo ""
echo "  ==============================================="
echo "   [bundle-python] Python 依赖打包完成"
echo "  ==============================================="
echo ""
