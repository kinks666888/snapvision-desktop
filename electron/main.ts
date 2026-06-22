/**
 * Electron Main Process — SnapVision Desktop
 *
 * 职责：
 *   1. 创建应用窗口
 *   2. 管理 OCR 服务 (ocr_server.py) 生命周期
 *   3. 注册 IPC handlers — 桥接渲染进程 ↔ OCR 服务
 */

import { app, BrowserWindow, ipcMain, dialog, net } from 'electron';
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  checkHealth,
  recognizeImage,
  extractStock,
  extractStockBase64,
  fetchMarketData,
  fetchRealtimeQuote,
  fetchKlineData,
  searchStock,
  fetchAiAnalysis,
  type OcrResult,
  type StockParseResult,
  type MarketDataResult,
  type RealtimeQuote,
  type KlineBar,
  type KlineResult,
  type SearchResult,
  type AiAnalysisRequest,
  type AiAnalysisResult,
  getHistoryList,
  getHistoryDetail,
  deleteHistory,
  clearHistory,
  exportHistory,
  saveHistory,
  type HistoryListParams,
  type HistorySaveParams,
  type HistorySaveResult,
} from './ocr-client.js';
import type { IncomingMessage, ClientRequest } from 'node:http';
import http from 'node:http';

// ─── ESM-compatible globals ────────────────────────────────────

/** `__dirname` polyfill for ESM (vite-plugin-electron outputs ESM) */
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Constants ────────────────────────────────────────────────

const isDev = process.env.NODE_ENV !== 'production' && !app.isPackaged;

// OCR server port is hardcoded in ocr_server.py (5002), OCR client uses it too
const OCR_PORT = 5002;

// ─── Data directory ─────────────────────────────────────────

let userData = ''; // resolved in app.whenReady()

function ensureDataDir(): string {
  if (!userData) {
    userData = app.getPath('userData');
  }
  return userData;
}

// ─── Path Security Validation ──────────────────────────────────

/**
 * Validate file path to prevent path traversal attacks.
 * Allows paths from: user data dir, temp dir, desktop, documents, downloads.
 */
function isValidImagePath(filePath: string): boolean {
  if (!filePath || typeof filePath !== 'string') return false;
  
  // Must be absolute path
  if (!path.isAbsolute(filePath)) return false;
  
  // Reject paths with traversal sequences
  const normalized = path.normalize(filePath);
  if (normalized.includes('..')) return false;
  
  // Check if file exists
  if (!fs.existsSync(normalized)) return false;
  
  // Check if it's a file (not directory)
  try {
    const stat = fs.statSync(normalized);
    if (!stat.isFile()) return false;
  } catch {
    return false;
  }
  
  // Allow paths from common user directories
  const allowedDirs = [
    app.getPath('userData'),
    app.getPath('temp'),
    app.getPath('desktop'),
    app.getPath('documents'),
    app.getPath('downloads'),
    app.getPath('pictures'),
  ];
  
  // Also allow paths from the app directory (for development)
  const appDir = path.resolve(__dirname, '..', '..');
  allowedDirs.push(appDir);
  
  return allowedDirs.some(dir => normalized.startsWith(dir));
}

// ─── Logging ────────────────────────────────────────────────

function log(level: 'INFO' | 'WARN' | 'ERROR', message: string): void {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level}] ${message}`;
  console.log(`[Main] ${line}`);

  // Also write to file
  try {
    const dir = ensureDataDir();
    if (dir) {
      const logDir = path.join(dir, 'logs');
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
        // Set directory permissions to 700 (owner only)
        try { fs.chmodSync(logDir, 0o700); } catch { /* ignore */ }
      }
      const logFile = path.join(logDir, 'snapvision.log');
      fs.appendFileSync(logFile, line + '\n');
      // Set file permissions to 600 (owner read/write only) on first write
      if (fs.existsSync(logFile)) {
        try { fs.chmodSync(logFile, 0o600); } catch { /* ignore */ }
      }
    }
  } catch {
    // Log file write failure is non-fatal
  }
}

// ─── .env loader ─────────────────────────────────────────────

/** Load environment variables from `.env` file */
function loadEnvFile(): void {
  const envPath = path.resolve(__dirname, '..', '..', '.env');
  try {
    if (!fs.existsSync(envPath)) {
      log('INFO', 'No .env file found — using existing environment variables');
      return;
    }
    const content = fs.readFileSync(envPath, 'utf-8');
    let loaded = 0;
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const eqIndex = trimmed.indexOf('=');
      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();
      // Strip surrounding quotes
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      // Don't override already-set env vars (e.g. from shell)
      if (!process.env[key] && key) {
        process.env[key] = value;
        loaded++;
      }
    }
    log('INFO', `Loaded ${loaded} variables from .env`);
  } catch (err) {
    log('WARN', `Could not load .env file: ${(err as Error).message}`);
  }
}

// ─── Startup progress ────────────────────────────────────────

function startupStep(step: number, total: number, message: string): void {
  console.log('');
  console.log(`  ${'='.repeat(46)}`);
  console.log(`   [${step}/${total}] ${message}`);
  console.log(`  ${'='.repeat(46)}`);
}

// ─── State ────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;
let ocrProcess: ChildProcess | null = null;

// ─── Path resolution ──────────────────────────────────────────

/** Resolve ocr_server.py path relative to the project */
function getOcrServerPath(): string {
  // In development: <project>/backend/ocr_server.py
  // In production: bundled alongside the app
  if (isDev) {
    return path.resolve(__dirname, '..', '..', 'backend', 'ocr_server.py');
  }
  return path.join(process.resourcesPath, 'backend', 'ocr_server.py');
}

// ─── Python discovery ────────────────────────────────────────

/** Cached Python binary after successful discovery */
let _pythonBin: string | null = null;

/**
 * Common macOS Python installation paths.
 *
 * IMPORTANT: Order = priority.
 *   - Python.org (3.12/3.11/3.10) is preferred — these bundles target Python 3.10+
 *     and packages (e.g. click ≥ 8.1) use `match` syntax not available in 3.9.
 *   - macOS system `/usr/bin/python3` is 3.9 — last resort only.
 */
const PYTHON_CANDIDATES = [
  // Python.org installer (preferred — versioned paths guarantee ≥ 3.10)
  '/Library/Frameworks/Python.framework/Versions/3.12/bin/python3',
  '/Library/Frameworks/Python.framework/Versions/3.11/bin/python3',
  '/Library/Frameworks/Python.framework/Versions/3.10/bin/python3',
  // Homebrew (Apple Silicon / Intel)
  '/opt/homebrew/bin/python3',
  '/usr/local/bin/python3',
  // From PATH — may be macOS system Python 3.9 (last resort)
  'python3',
];

/**
 * Find a working Python 3 binary.
 * Checks PYTHON_BIN env var, then PATH, then common macOS locations.
 * Throws if none is found.
 */
async function findPythonBin(): Promise<string> {
  if (_pythonBin) return _pythonBin;

  // 1. Environment variable override
  if (process.env.PYTHON_BIN) {
    const candidate = process.env.PYTHON_BIN;
    if (candidate === 'python3' || (fs.existsSync(candidate) && fs.statSync(candidate).isFile())) {
      log('INFO', `Using PYTHON_BIN: ${candidate}`);
      _pythonBin = candidate;
      return _pythonBin;
    }
    log('WARN', `PYTHON_BIN="${candidate}" is not a valid path, falling back to auto-detect`);
  }

  // 2. Project venv (backend/venv/bin/python)
  const venvPython = path.resolve(
    __dirname, '..', '..', 'backend', 'venv',
    process.platform === 'win32' ? 'Scripts' : 'bin',
    process.platform === 'win32' ? 'python.exe' : 'python'
  );
  if (fs.existsSync(venvPython)) {
    try {
      const version = execSync(`"${venvPython}" --version 2>&1`, { timeout: 3000, encoding: 'utf-8' }).trim();
      if (version && version.toLowerCase().includes('python 3')) {
        log('INFO', `Found Python (venv): ${venvPython} → ${version}`);
        _pythonBin = venvPython;
        return _pythonBin;
      }
    } catch {
      log('WARN', 'Venv Python exists but version check failed — fallback to system paths');
    }
  }

  // 3. Try system candidates (prefer Python ≥ 3.10 for `match` syntax support)
  for (const candidate of PYTHON_CANDIDATES) {
    try {
      const version = execSync(`"${candidate}" --version 2>&1`, { timeout: 3000, encoding: 'utf-8' }).trim();
      if (version && version.toLowerCase().includes('python 3')) {
        // Parse "Python 3.10.10" → 3.10
        const match = version.match(/^Python\s+(\d+)\.(\d+)/);
        if (match) {
          const major = parseInt(match[1], 10);
          const minor = parseInt(match[2], 10);
          const verNum = major + minor / 100;
          if (verNum < 3.1) {
            log('WARN', `Found Python ${major}.${minor} at ${candidate} — need ≥ 3.10, skipping`);
            continue;
          }
        }
        log('INFO', `Found Python: ${candidate} → ${version}`);
        _pythonBin = candidate;
        return _pythonBin;
      }
    } catch {
      // Candidate not viable — try next
    }
  }

  throw new Error(
    '未找到 Python 3.10+ 运行环境。\n\n' +
    '请安装 Python 3.10 或更高版本：\n' +
    '  brew install python@3.12\n\n' +
    '或从 https://www.python.org/downloads/ 下载。\n\n' +
    '提示：如果已创建 virtualenv，请确保 backend/venv/bin/python 存在\n' +
    '或设置 PYTHON_BIN 环境变量指定路径。'
  );
}

// (verifyPythonDeps removed — only flask needed, checked inline in startOcrServer)

// ─── OCR Service Lifecycle ────────────────────────────────────

function sendOcrStatus(status: 'ok' | 'loading' | 'error' | 'stopped', message: string) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('ocr:status-change', {
      status,
      ready: status === 'ok',
      message,
    });
  }
}

async function killStaleProcess(): Promise<void> {
  const portStr = process.env.OCR_PORT || String(OCR_PORT);
  // Validate port is a valid number to prevent command injection
  const port = parseInt(portStr, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    log('WARN', `Invalid OCR port: ${portStr}, skipping stale process kill`);
    return;
  }
  try {
    if (process.platform === 'darwin') {
      execSync(`lsof -ti :${port} | xargs kill -9 2>/dev/null`, { timeout: 3000 });
    } else if (process.platform === 'linux') {
      execSync(`fuser -k ${port}/tcp 2>/dev/null`, { timeout: 3000 });
    }
    // Windows: skip — PaddleOCR not supported
  } catch {
    // No stale process — that's fine
  }
  // Brief wait for port release
  await new Promise((r) => setTimeout(r, 500));
}

async function startOcrServer(): Promise<void> {
  // Check if already running
  try {
    const health = await checkHealth();
    if (health.ready) {
      log('INFO', 'AI Vision server already running — reusing');
      sendOcrStatus('ok', '服务已就绪');
      return;
    }
  } catch {
    // Not running, will start below
  }

  // Kill stale process that might hold the port
  await killStaleProcess();

  // Find Python binary
  let pythonBin: string;
  try {
    pythonBin = await findPythonBin();
  } catch (err) {
    const msg = (err as Error).message;
    log('ERROR', msg);
    sendOcrStatus('error', msg);
    return;
  }

  // ── Check for bundled Python packages (production) ──
  const ocrScript = getOcrServerPath();
  const bundleDir = !isDev
    ? path.join(process.resourcesPath, 'backend', 'bundle')
    : path.resolve(path.dirname(ocrScript), 'bundle');

  const usingBundle = fs.existsSync(bundleDir) && fs.statSync(bundleDir).isDirectory();

  if (usingBundle) {
    log('INFO', `Found bundled Python packages: ${bundleDir}`);

    // Verify bundle Python version matches runtime Python
    const versionFile = path.join(bundleDir, '.python-version');
    if (fs.existsSync(versionFile)) {
      const expectedVersion = fs.readFileSync(versionFile, 'utf-8').trim();
      const runtimeVersion = execSync(`"${pythonBin}" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>&1`, { timeout: 3000, encoding: 'utf-8' }).trim();
      if (expectedVersion !== runtimeVersion) {
        const msg = `Python 版本不匹配: bundle 构建于 ${expectedVersion}，但运行时为 ${runtimeVersion}。\n请使用 Python ${expectedVersion} 或重新打包。`;
        log('ERROR', msg);
        sendOcrStatus('error', msg);
        return;
      }
      log('INFO', `Python version match: ${runtimeVersion} (bundle built with ${expectedVersion})`);
    }

    // Quick sanity check — bundle should contain flask
    if (!fs.existsSync(path.join(bundleDir, 'flask'))) {
      const msg = 'bundle 目录缺少 flask，请重新打包 (npm run build:mac)';
      log('ERROR', msg);
      sendOcrStatus('error', msg);
      return;
    }
    log('INFO', 'Bundled dependencies verified (installed at build time)');
  } else {
    // Dev mode: verify Flask is available in the system Python
    try {
      execSync(
        `"${pythonBin}" -c "import flask" 2>&1`, { timeout: 5000, encoding: 'utf-8' },
      );
      log('INFO', 'Python dependencies verified: flask');
    } catch {
      const msg = '缺少依赖: flask。请运行 pip3 install flask';
      log('ERROR', msg);
      sendOcrStatus('error', msg);
      return;
    }
  }

  if (!fs.existsSync(ocrScript)) {
    const msg = `服务脚本未找到: ${ocrScript}`;
    log('ERROR', msg);
    sendOcrStatus('error', msg);
    return;
  }

  const OCR_HOST = process.env.OCR_HOST || '127.0.0.1';
  const port = process.env.OCR_PORT || String(OCR_PORT);

  log('INFO', `Starting AI Vision server: ${pythonBin} "${ocrScript}"`);
  sendOcrStatus('loading', '服务启动中…');

  const backendDir = path.dirname(ocrScript);
  const pathSep = process.platform === 'win32' ? ';' : ':';

  ocrProcess = spawn(pythonBin, [ocrScript], {
    cwd: backendDir,
    env: {
      ...process.env,
      OCR_PORT: port,
      DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY || '',
      PYTHONPATH: (usingBundle ? bundleDir + pathSep : '') + backendDir + pathSep + (process.env.PYTHONPATH || ''),
      PYTHONUNBUFFERED: '1',
      SNAPVISION_DATA_DIR: ensureDataDir(),
      SNAPVISION_VERSION: app.getVersion(),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderrBuf = '';
  const STDERR_MAX = 10240;
  ocrProcess.stderr?.on('data', (data: Buffer) => {
    const msg = data.toString();
    stderrBuf += msg;
    if (stderrBuf.length > STDERR_MAX) {
      stderrBuf = stderrBuf.slice(-STDERR_MAX);
    }
    const line = msg.trim();
    if (line) {
      if (line.includes('Error') || line.includes('Traceback') || line.includes('error') || line.includes('Exception')) {
        log('ERROR', `[OCR stderr] ${line}`);
      } else {
        log('INFO', `[OCR stderr] ${line}`);
      }
    }
  });

  ocrProcess.stdout?.on('data', (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) log('INFO', `[OCR stdout] ${msg}`);
  });

  ocrProcess.on('error', (err) => {
    log('ERROR', `OCR process error: ${err.message}`);
    sendOcrStatus('error', `服务进程启动失败: ${err.message}`);
  });

  // ── Crash / exit monitoring ──
  ocrProcess.on('exit', (code, signal) => {
    if (ocrProcess === null) return; // Already cleaned up
    if (code !== null && code !== 0) {
      const reason = signal ? `signal ${signal}` : `exit code ${code}`;
      const stderrTail = stderrBuf.split('\n').slice(-5).join('\n').trim();
      log('ERROR', `OCR Server exited unexpectedly (${reason})`);
      if (stderrTail) {
        log('ERROR', `Last stderr output:\n${stderrTail}`);
      }
      sendOcrStatus('error', `OCR 服务意外退出 (${reason})。${stderrTail ? `最后输出: ${stderrTail.slice(0, 200)}` : ''}`);
    } else if (code === 0) {
      log('INFO', 'OCR Server exited normally');
      sendOcrStatus('stopped', '服务已关闭');
    }
    ocrProcess = null;
  });

  // Wait for health check (max 30s)
  try {
    await waitForService(30, 500);
    sendOcrStatus('ok', '服务已就绪');
    log('INFO', 'AI Vision server started successfully');
    startupStep(4, 5, `OCR 服务就绪 (${OCR_HOST}:${port})`);
  } catch (err) {
    const msg = (err as Error).message;
    log('ERROR', `OCR 服务启动超时: ${msg}`);
    sendOcrStatus('error', 'OCR 服务启动失败，请查看日志。\n' + msg);
    if (ocrProcess) {
      ocrProcess.kill('SIGTERM');
      ocrProcess = null;
    }
  }
}

async function waitForService(maxAttempts = 30, intervalMs = 500): Promise<void> {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const poll = () => {
      attempts++;
      checkHealth()
        .then((status) => {
          if (status.ready) resolve();
          else if (attempts < maxAttempts) setTimeout(poll, intervalMs);
          else reject(new Error(`服务未能就绪（${maxAttempts * intervalMs / 1000}s）`));
        })
        .catch(() => {
          if (attempts < maxAttempts) setTimeout(poll, intervalMs);
          else reject(new Error(`服务无法访问（${maxAttempts * intervalMs / 1000}s）`));
        });
    };
    poll();
  });
}

async function stopOcrServer(): Promise<void> {
  if (!ocrProcess) return;

  log('INFO', 'Stopping AI Vision server…');
  sendOcrStatus('stopped', '服务正在关闭…');

  return new Promise((resolve) => {
    const forceTimer = setTimeout(() => {
      if (ocrProcess) {
        log('WARN', 'Force-killing server process');
        ocrProcess.kill('SIGKILL');
      }
    }, 5000);

    ocrProcess!.once('exit', () => {
      clearTimeout(forceTimer);
      ocrProcess = null;
      resolve();
    });

    ocrProcess!.kill('SIGTERM');
  });
}

// ─── IPC Handlers ─────────────────────────────────────────────

function registerIpcHandlers(): void {
  // OCR: recognize image (kept for backward compatibility)
  ipcMain.handle('ocr:recognize', async (_event, imagePath: string): Promise<OcrResult> => {
    const t0 = Date.now();
    log('INFO', `IPC → ocr:recognize | path=${imagePath}`);

    if (!isValidImagePath(imagePath)) {
      const err = new Error(`无效的图片路径: ${imagePath}`);
      log('ERROR', `IPC ← ocr:recognize 拒绝: ${err.message}`);
      throw err;
    }

    try {
      const result = await recognizeImage(imagePath);
      const elapsed = Date.now() - t0;
      log('INFO', `IPC ← ocr:recognize | elapsed=${elapsed}ms success=${result.success}`);
      return result;
    } catch (err) {
      log('ERROR', `IPC ← ocr:recognize 失败: ${(err as Error).message}`);
      throw err;
    }
  });

  // Stock: extract stock info from image (DeepSeek Vision + API validation)
  ipcMain.handle('stock:extract', async (_event, imagePath: string): Promise<StockParseResult> => {
    const t0 = Date.now();
    log('INFO', `IPC → stock:extract | path=${imagePath}`);

    if (!isValidImagePath(imagePath)) {
      const err = new Error(`无效的图片路径: ${imagePath}`);
      log('ERROR', `IPC ← stock:extract 拒绝: ${err.message}`);
      throw err;
    }

    try {
      const result = await extractStock(imagePath);
      const elapsed = Date.now() - t0;
      log('INFO', `IPC ← stock:extract | name=${result.stock_name} code=${result.stock_code} price=${result.current_price} elapsed=${elapsed}ms`);
      return result;
    } catch (err) {
      log('ERROR', `IPC ← stock:extract 失败: ${(err as Error).message}`);
      throw err;
    }
  });

  // Stock: extract from compressed base64 image data
  ipcMain.handle('stock:extract-base64', async (_event, base64: string): Promise<StockParseResult> => {
    const t0 = Date.now();
    log('INFO', `IPC → stock:extract-base64 | data=<base64 length=${base64?.length ?? 0}>`);

    // Validate base64 string
    if (!base64 || typeof base64 !== 'string') {
      const err = new Error('无效的图片数据: 非字符串类型');
      log('ERROR', `IPC ← stock:extract-base64 拒绝: ${err.message}`);
      throw err;
    }
    
    // Check minimum length (100 chars is too small for a real image)
    if (base64.length < 100) {
      const err = new Error('无效的图片数据: 数据过短');
      log('ERROR', `IPC ← stock:extract-base64 拒绝: ${err.message}`);
      throw err;
    }
    
    // Check maximum size (10MB base64 ≈ 13.3MB raw)
    const MAX_BASE64_SIZE = 14 * 1024 * 1024; // 14MB
    if (base64.length > MAX_BASE64_SIZE) {
      const err = new Error('无效的图片数据: 数据过大');
      log('ERROR', `IPC ← stock:extract-base64 拒绝: ${err.message}`);
      throw err;
    }
    
    // Validate base64 format (only alphanumeric, +, /, =)
    const base64Regex = /^[A-Za-z0-9+/=]+$/;
    if (!base64Regex.test(base64)) {
      const err = new Error('无效的图片数据: 包含非法字符');
      log('ERROR', `IPC ← stock:extract-base64 拒绝: ${err.message}`);
      throw err;
    }

    try {
      const result = await extractStockBase64(base64);
      const elapsed = Date.now() - t0;
      log('INFO', `IPC ← stock:extract-base64 | name=${result.stock_name} code=${result.stock_code} price=${result.current_price} elapsed=${elapsed}ms`);
      return result;
    } catch (err) {
      log('ERROR', `IPC ← stock:extract-base64 失败: ${(err as Error).message}`);
      throw err;
    }
  });

  // Service health check
  ipcMain.handle('ocr:health', async () => {
    try {
      const health = await checkHealth();
      return {
        status: health.ready ? 'ok' : 'loading',
        ready: health.ready,
        message: health.ready ? '服务已就绪' : '服务加载中…',
      };
    } catch (err) {
      log('ERROR', `health check failed: ${(err as Error).message}`);
      return { status: 'stopped', ready: false, message: '服务未启动' };
    }
  });

  // Market Data: real-time quote
  ipcMain.handle('market:fetch', async (_event, stockCode: string): Promise<MarketDataResult> => {
    const t0 = Date.now();
    if (!stockCode || typeof stockCode !== 'string') {
      throw new Error('stock_code is required');
    }
    try {
      const result = await fetchMarketData(stockCode);
      log('INFO', `IPC ← market:fetch | source=${result.source} available=${result.available} elapsed=${Date.now() - t0}ms`);
      return result;
    } catch (err) {
      log('ERROR', `IPC ← market:fetch 失败: ${(err as Error).message}`);
      throw err;
    }
  });

  // StockAPI: realtime quote
  ipcMain.handle('stockapi:realtime', async (_event, code: string): Promise<RealtimeQuote> => {
    if (!code || typeof code !== 'string') throw new Error('code is required');
    try {
      const result = await fetchRealtimeQuote(code);
      return result;
    } catch (err) {
      log('ERROR', `IPC ← stockapi:realtime 失败: ${(err as Error).message}`);
      throw err;
    }
  });

  // Fetch realtime quote via Tencent API (bypass CORS & Forbidden issues with Sina)
  ipcMain.handle('fetch-quote', async (_event, code: string): Promise<RealtimeQuote> => {
    if (!code || typeof code !== 'string') throw new Error('code is required');
    try {
      // Normalise stock code prefix
      let rawCode = code;
      let prefix: string;
      const upper = code.toUpperCase();
      if (upper.startsWith('SZ') || upper.startsWith('SH')) {
        prefix = upper.startsWith('SZ') ? 'sz' : 'sh';
        rawCode = code.substring(2);
      } else {
        prefix = rawCode.startsWith('6') ? 'sh' : 'sz';
      }

      const url = `http://qt.gtimg.cn/q=${prefix}${rawCode}`;
      log('INFO', `IPC → fetch-quote | ${url}`);

      // ⚠️ Tencent API (qt.gtimg.cn) 返回 GBK 编码，不能使用默认的 UTF-8 解码
      const raw = await new Promise<string>((resolve, reject) => {
        const request = net.request(url);
        const chunks: Buffer[] = [];
        request.on('response', (response) => {
          response.on('data', (chunk: Buffer) => { chunks.push(chunk); });
          response.on('end', () => {
            const decoder = new TextDecoder('gbk');
            resolve(decoder.decode(Buffer.concat(chunks)));
          });
        });
        request.on('error', (err) => reject(err));
        request.end();
      });

      // Parse Tencent response: v_sz000001="...data...";
      const match = raw.match(/"([^"]+)"/);
      if (!match) {
        return {
          success: false, error: '解析腾讯行情响应失败', code,
          name: null, price: null, change_pct: null, change_amt: null,
          open: null, high: null, low: null, prev_close: null,
          volume: null, turnover: null, turnover_rate: null,
          pe: null, pb: null, amplitude: null,
          total_market_cap: null, circulating_market_cap: null,
          source: 'tencent', trading: false, update_time: '',
        };
      }

      const f = match[1].split('~');

      // Tencent field mapping (0-indexed):
      //   1 = name, 2 = code, 3 = price, 4 = prev_close, 5 = open
      //   6 = volume (shares, 手), 31 = high, 32 = low
      //   37 = amount (成交额, 元), 38 = turnover_rate (%), 39 = PE
      //   43 = PB
      const price = f[3] ? parseFloat(f[3]) : NaN;
      const prevClose = f[4] ? parseFloat(f[4]) : NaN;
      const changeAmt = !isNaN(price) && !isNaN(prevClose) ? price - prevClose : null;
      const changePct = changeAmt != null && !isNaN(prevClose) && prevClose !== 0
        ? (changeAmt / prevClose) * 100
        : null;

      const parseNum = (val: string | undefined): number | null => {
        if (val == null || val === '') return null;
        const n = parseFloat(val);
        return isNaN(n) ? null : n;
      };

      return {
        success: true,
        code,
        name: f[1]?.trim() || null,
        price: !isNaN(price) ? price : null,
        change_pct: changePct != null ? Math.round(changePct * 100) / 100 : null,
        change_amt: changeAmt != null ? Math.round(changeAmt * 100) / 100 : null,
        open: parseNum(f[5]),
        high: parseNum(f[31]),
        low: parseNum(f[32]),
        prev_close: !isNaN(prevClose) ? prevClose : null,
        volume: f[6] ? String(parseInt(f[6], 10)) : null,   // 手
        turnover: parseNum(f[37]) != null ? String(parseNum(f[37])!) : null,  // 元
        turnover_rate: parseNum(f[38]),
        pe: parseNum(f[39]),
        pb: parseNum(f[43]),
        amplitude: null,  // Tencent doesn't provide amplitude in standard fields
        total_market_cap: null,
        circulating_market_cap: null,
        source: 'tencent',
        trading: true,
        update_time: '',
      };
    } catch (err) {
      log('ERROR', `IPC ← fetch-quote 失败: ${(err as Error).message}`);
      return {
        success: false, error: (err as Error).message, code,
        name: null, price: null, change_pct: null, change_amt: null,
        open: null, high: null, low: null, prev_close: null,
        volume: null, turnover: null, turnover_rate: null,
        pe: null, pb: null, amplitude: null,
        total_market_cap: null, circulating_market_cap: null,
        source: 'tencent', trading: false, update_time: '',
      };
    }
  });

  // StockAPI: K-line data
  ipcMain.handle('stockapi:kline', async (_event, code: string, period: string, count: number): Promise<KlineResult> => {
    if (!code || typeof code !== 'string') throw new Error('code is required');
    try {
      return await fetchKlineData(code, period || 'daily', count || 30);
    } catch (err) {
      log('ERROR', `IPC ← stockapi:kline 失败: ${(err as Error).message}`);
      throw err;
    }
  });

  // Fetch K-line via Sina API (bypass CORS through main process)
  ipcMain.handle('fetch-kline', async (_event, code: string, period: string, count: number): Promise<KlineResult> => {
    if (!code || typeof code !== 'string') throw new Error('code is required');
    try {
      // Normalise stock code prefix
      let rawCode = code;
      let prefix: string;
      const upper = code.toUpperCase();
      if (upper.startsWith('SZ') || upper.startsWith('SH')) {
        prefix = upper.startsWith('SZ') ? 'sz' : 'sh';
        rawCode = code.substring(2);
      } else {
        prefix = rawCode.startsWith('6') ? 'sh' : 'sz';
      }

      // Map period → Sina scale (supports both string names and klt numeric codes)
      const scaleMap: Record<string, number> = {
        daily: 240, weekly: 1680, monthly: 7200,
        '5min': 5, '15min': 15, '30min': 30, '60min': 60,
        '101': 240, '102': 1680, '103': 7200,
      };
      const scale = scaleMap[period] ?? 240;

      const url = `http://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${prefix}${rawCode}&scale=${scale}&datalen=${count}&ma=no`;

      log('INFO', `IPC → fetch-kline | ${url}`);

      const raw = await new Promise<string>((resolve, reject) => {
        const request = net.request(url);
        let buf = '';
        request.on('response', (response) => {
          response.on('data', (chunk: Buffer) => { buf += chunk.toString(); });
          response.on('end', () => resolve(buf));
        });
        request.on('error', (err) => reject(err));
        request.end();
      });

      type SinaBar = { day: string; open: string; high: string; low: string; close: string; volume: string };
      const parsed: SinaBar[] = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error('无效的 K 线数据格式');

      const bars: KlineBar[] = parsed
        .map((item) => ({
          time: item.day,
          open: parseFloat(item.open),
          high: parseFloat(item.high),
          low: parseFloat(item.low),
          close: parseFloat(item.close),
          volume: parseInt(item.volume, 10) || 0,
          turnover: 0,
        }));

      // Validate OHLC fields
      const validBars = bars.filter((b) => {
        if (!b.time || isNaN(b.open) || isNaN(b.high) || isNaN(b.low) || isNaN(b.close)) {
          log('WARN', `IPC fetch-kline: skipping invalid bar: ${JSON.stringify(b)}`);
          return false;
        }
        return true;
      });

      if (validBars.length === 0 && bars.length > 0) {
        log('ERROR', `IPC fetch-kline: ALL ${bars.length} bars have invalid OHLC data`);
      }

      log('INFO', `IPC ← fetch-kline | bars=${validBars.length} (filtered from ${bars.length})`);
      if (validBars.length > 0) {
        log('INFO', `IPC ← fetch-kline sample: ${JSON.stringify(validBars[0])}`);
      }
      return { success: true, code: prefix + rawCode, period, count: validBars.length, bars: validBars };
    } catch (err) {
      log('ERROR', `IPC ← fetch-kline 失败: ${(err as Error).message}`);
      return { success: false, error: (err as Error).message, code, period, count, bars: [] };
    }
  });

  // StockAPI: stock search
  ipcMain.handle('stockapi:search', async (_event, keyword: string): Promise<SearchResult> => {
    if (!keyword || typeof keyword !== 'string') throw new Error('keyword is required');
    try {
      return await searchStock(keyword);
    } catch (err) {
      log('ERROR', `IPC ← stockapi:search 失败: ${(err as Error).message}`);
      throw err;
    }
  });

  // StockAPI: AI analysis
  ipcMain.handle('stockapi:ai-analysis', async (_event, params: AiAnalysisRequest): Promise<AiAnalysisResult> => {
    const t0 = Date.now();
    log('INFO', `IPC → stockapi:ai-analysis | code=${params.stock_code}`);

    if (!params || !params.stock_code) throw new Error('stock_code is required');

    try {
      const result = await fetchAiAnalysis(params);
      const elapsed = Date.now() - t0;
      log('INFO', `IPC ← stockapi:ai-analysis | elapsed=${elapsed}ms`);
      return result;
    } catch (err) {
      log('ERROR', `IPC ← stockapi:ai-analysis 失败: ${(err as Error).message}`);
      throw err;
    }
  });

  // StockAPI: Limit Analysis
  ipcMain.handle('stock:limit-analysis', async (_event, stockCode: string): Promise<Record<string, unknown>> => {
    const t0 = Date.now();
    log('INFO', `IPC → stock:limit-analysis | code=${stockCode}`);

    if (!stockCode || typeof stockCode !== 'string') throw new Error('stock_code is required');

    return new Promise((resolve, reject) => {
      const body = JSON.stringify({ stock_code: stockCode });
      const url = `http://127.0.0.1:${process.env.OCR_PORT || '5002'}/stock-analysis`;

      const req = http.request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(Buffer.byteLength(body)),
        },
        timeout: 10000,
      }, (res: IncomingMessage) => {
        let respBody = '';
        res.on('data', (chunk: Buffer) => { respBody += chunk.toString(); });
        res.on('end', () => {
          try {
            const result = JSON.parse(respBody);
            const elapsed = Date.now() - t0;
            log('INFO', `IPC ← stock:limit-analysis | elapsed=${elapsed}ms`);
            resolve(result);
          } catch {
            reject(new Error('Invalid response from limit analysis'));
          }
        });
      });

      req.on('error', (err: Error) => {
        log('ERROR', `IPC ← stock:limit-analysis 失败: ${err.message}`);
        reject(err);
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Limit analysis timeout'));
      });

      req.write(body);
      req.end();
    });
  });

  // Retry service start
  ipcMain.handle('ocr:retry', async () => {
    log('INFO', 'IPC → ocr:retry');
    if (ocrProcess) {
      ocrProcess.kill('SIGTERM');
      ocrProcess = null;
    }
    _pythonBin = null;
    try {
      await startOcrServer();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  // Dialog: select image file
  ipcMain.handle('dialog:select-image', async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择图片',
      filters: [
        { name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'] },
        { name: '所有文件', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // App: get OCR server path (for user reference)
  ipcMain.handle('app:ocr-server-path', () => getOcrServerPath());

  // App: export analysis report to Markdown file
  ipcMain.handle('app:export-report', async (_event, params: {
    stock_code: string;
    stock_name: string;
    content: string;
  }): Promise<{ ok: boolean; path?: string; error?: string }> => {
    const t0 = Date.now();
    const { stock_code, stock_name, content } = params;
    log('INFO', `IPC → app:export-report | code=${stock_code} name=${stock_name}`);

    try {
      // Resolve export directory: {project_root}/local/exports/
      const projectRoot = path.resolve(__dirname, '..', '..');
      const exportDir = path.join(projectRoot, 'local', 'exports');

      // Ensure directories exist
      if (!fs.existsSync(exportDir)) {
        fs.mkdirSync(exportDir, { recursive: true });
        log('INFO', `Created export directory: ${exportDir}`);
      }

      // Generate filename: 股票代码_股票名称_YYYY-MM-DD_HH-mm-ss.md
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      const timeStr = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
      const safeCode = (stock_code || 'unknown').replace(/[\/\\:]/g, '_');
      const safeName = (stock_name || 'unknown').replace(/[\/\\:\s]/g, '_');
      const filename = `${safeCode}_${safeName}_${dateStr}_${timeStr}.md`;
      const filePath = path.join(exportDir, filename);

      // Write file
      fs.writeFileSync(filePath, content, 'utf-8');

      const elapsed = Date.now() - t0;
      log('INFO', `IPC ← app:export-report | path=${filePath} elapsed=${elapsed}ms`);
      return { ok: true, path: filePath };
    } catch (err) {
      const msg = (err as Error).message;
      log('ERROR', `IPC ← app:export-report 失败: ${msg}`);
      return { ok: false, error: msg };
    }
  });

  // App: read image file as base64 data URL (for renderer <img> display)
  ipcMain.handle('app:read-image', async (_event, imagePath: string) => {
    if (!isValidImagePath(imagePath)) {
      throw new Error(`无效的图片路径: ${imagePath}`);
    }
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(imagePath);
    } catch {
      throw new Error(`图片文件不存在: ${imagePath}`);
    }
    if (!stat.isFile()) {
      throw new Error(`路径不是文件: ${imagePath}`);
    }
    const ext = path.extname(imagePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.bmp': 'image/bmp',
      '.webp': 'image/webp',
    };
    const mime = mimeTypes[ext] || 'image/png';
    const data = await readFile(imagePath);
    return `data:${mime};base64,${data.toString('base64')}`;
  });

  // ── History: CRUD + Export ──────────────────────────────

  ipcMain.handle('history:list', async (_event, params: HistoryListParams) => {
    return getHistoryList(params);
  });

  ipcMain.handle('history:detail', async (_event, id: number) => {
    return getHistoryDetail(id);
  });

  ipcMain.handle('history:delete', async (_event, id: number) => {
    await deleteHistory(id);
    return { ok: true };
  });

  ipcMain.handle('history:save', async (_event, params: HistorySaveParams): Promise<HistorySaveResult> => {
    const t0 = Date.now();
    log('INFO', `IPC → history:save | code=${params.stock_code} name=${params.stock_name}`);
    try {
      const result = await saveHistory(params);
      const elapsed = Date.now() - t0;
      log('INFO', `IPC ← history:save | id=${result.id} is_new=${result.is_new} elapsed=${elapsed}ms`);
      return result;
    } catch (err) {
      log('ERROR', `IPC ← history:save 失败: ${(err as Error).message}`);
      throw err;
    }
  });

  ipcMain.handle('history:clear', async () => {
    const count = await clearHistory();
    return { ok: true, deleted: count };
  });

  ipcMain.handle('history:export', async (_event, id: number, format: string) => {
    const content = await exportHistory(id, format as 'md' | 'json' | 'txt');

    // Show save dialog
    if (mainWindow) {
      const extMap: Record<string, string> = { md: '.md', json: '.json', txt: '.txt' };
      const filterMap: Record<string, { name: string; extensions: string[] }> = {
        md: { name: 'Markdown', extensions: ['md'] },
        json: { name: 'JSON', extensions: ['json'] },
        txt: { name: '纯文本', extensions: ['txt'] },
      };
      const ext = extMap[format] || '.md';
      const filter = filterMap[format] || filterMap.md;

      const saveResult = await dialog.showSaveDialog(mainWindow, {
        title: '导出历史记录',
        defaultPath: `snapvision-report-${id}${ext}`,
        filters: [filter, { name: '所有文件', extensions: ['*'] }],
      });

      if (!saveResult.canceled && saveResult.filePath) {
        fs.writeFileSync(saveResult.filePath, content, 'utf-8');
        return { ok: true, path: saveResult.filePath };
      }
      return { ok: false, cancelled: true };
    }
    return { ok: false, error: 'No window' };
  });
}

// ─── Window ───────────────────────────────────────────────────

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 640,
    minHeight: 480,
    title: 'SnapVision',
    titleBarStyle: 'hiddenInset', // macOS native look
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    backgroundColor: '#020617', // dark-950
    show: false,
  });

  // Show when ready (avoid white flash)
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    startupStep(5, 5, 'SnapVision 就绪');
    console.log('');
    console.log('  欢迎使用 SnapVision！');
    console.log('');
  });

  // Load content
  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── App Lifecycle ────────────────────────────────────────────

app.whenReady().then(async () => {
  log('INFO', '═══════════════════════════════════════');
  log('INFO', `SnapVision v${app.getVersion()} starting`);
  log('INFO', `Platform: ${process.platform} ${process.arch}`);
  log('INFO', `Electron: ${process.versions.electron}`);
  log('INFO', `User data: ${ensureDataDir()}`);
  log('INFO', `Dev mode: ${isDev}`);
  log('INFO', '═══════════════════════════════════════');

  // ── Step 1: Load .env ──
  startupStep(1, 5, '加载环境变量');
  if (isDev) {
    loadEnvFile();
  }

  // Check for missing optional config
  if (!process.env.DEEPSEEK_API_KEY) {
    log('WARN', 'DEEPSEEK_API_KEY 未设置 — AI 增强分析不可用（仅本地 PaddleOCR 识别）');
    console.log('  💡 提示: 创建 .env 文件并设置 DEEPSEEK_API_KEY=your_key 可启用 AI 分析');
  }
  if (!process.env.OCR_PORT) {
    log('INFO', 'OCR_PORT 未设置，使用默认端口 5002');
  }

  registerIpcHandlers();
  createWindow();

  // ── Step 2: Detect Python ──
  startupStep(2, 5, '检测 Python 环境');
  try {
    await findPythonBin();
  } catch (err) {
    log('ERROR', `Python 环境检测失败: ${(err as Error).message}`);
    sendOcrStatus('error', (err as Error).message);
    return;
  }

  // ── Step 3: Start OCR server ──
  startupStep(3, 5, '启动 OCR 服务...');
  startOcrServer().catch((err) => {
    log('ERROR', `OCR 启动失败: ${(err as Error).message}`);
    sendOcrStatus('error', `OCR 启动失败: ${(err as Error).message}`);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

let isQuitting = false;

function gracefulQuit(): void {
  if (isQuitting) return;
  isQuitting = true;

  if (ocrProcess) {
    log('INFO', 'Quitting — killing OCR server process');
    try { ocrProcess.kill('SIGTERM'); } catch { /* already dead */ }
    const killTimer = setTimeout(() => {
      if (ocrProcess) {
        try { ocrProcess.kill('SIGKILL'); } catch { /* already dead */ }
      }
    }, 3000);
    killTimer.unref();
  }
}

app.on('window-all-closed', () => {
  gracefulQuit();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (event) => {
  if (ocrProcess && !isQuitting) {
    event.preventDefault();
    gracefulQuit();
    setTimeout(() => app.quit(), 4000);
  }
});
