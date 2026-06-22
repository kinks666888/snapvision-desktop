import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { Server } from 'node:http';

// getBaseUrl() 在每次调用时读 process.env，beforeAll 中设置 port 即可
import {
  checkHealth,
  isServiceRunning,
  recognizeImage,
  waitForModel,
} from './ocr-client';

describe('ocr-client', () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    // Start a mock OCR server on a dynamic port
    server = http.createServer((req, res) => {
      if (req.url === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', model: 'loaded' }));
      } else if (req.url === '/ocr' && req.method === 'POST') {
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (data.image_path === 'NOT_FOUND') {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: '图片文件不存在' }));
            } else {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                success: true,
                text: '测试文字\n第二行',
                texts: ['测试文字', '第二行'],
                confidence: 0.95,
                elapsed_ms: 42,
              }));
            }
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'invalid request' }));
          }
        });
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
      }
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        port = (server.address() as import('net').AddressInfo).port;
        resolve();
      });
    });

    // Point the client at our mock server
    process.env.OCR_PORT = String(port);
  });

  afterAll(() => {
    server?.close();
    delete process.env.OCR_PORT;
  });

  // ─── Tests ─────────────────────────────────────────────────

  it('should export the expected API', () => {
    expect(checkHealth).toBeInstanceOf(Function);
    expect(isServiceRunning).toBeInstanceOf(Function);
    expect(recognizeImage).toBeInstanceOf(Function);
    expect(waitForModel).toBeInstanceOf(Function);
  });

  it('should check health and return status', async () => {
    const status = await checkHealth();
    expect(status).toEqual({
      status: 'ok',
      model: 'loaded',
    });
  });

  it('should detect running service', async () => {
    const running = await isServiceRunning();
    expect(running).toBe(true);
  });

  it('should detect stopped service when no server', async () => {
    const prevPort = process.env.OCR_PORT;
    process.env.OCR_PORT = '18765';
    const running = await isServiceRunning();
    expect(running).toBe(false);
    process.env.OCR_PORT = prevPort;
  });

  it('should recognize a valid image', async () => {
    const result = await recognizeImage('test-screenshot.png');
    expect(result.success).toBe(true);
    expect(result.text).toBe('测试文字\n第二行');
    expect(result.texts).toEqual(['测试文字', '第二行']);
    expect(result.confidence).toBe(0.95);
    expect(result.elapsed_ms).toBe(42);
  });

  it('should throw when recognition fails', async () => {
    await expect(recognizeImage('NOT_FOUND')).rejects.toThrow('图片文件不存在');
  });

  it('should resolve waitForModel when model is loaded', async () => {
    // With 5 attempts and 50ms interval, should resolve quickly
    await expect(waitForModel(5, 50)).resolves.toBeUndefined();
  });

  it('should reject waitForModel when service unreachable', async () => {
    const prevPort = process.env.OCR_PORT;
    process.env.OCR_PORT = '18766';
    await expect(waitForModel(3, 50)).rejects.toThrow('OCR service unreachable');
    process.env.OCR_PORT = prevPort;
  });
});
