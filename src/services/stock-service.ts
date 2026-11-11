/**
 * Stock Service — 渲染进程侧股票提取 API 封装
 *
 * 通过 IPC 调用主进程的 stock:extract handler。
 * 纯转发层，无提取逻辑。
 */

import type { StockParseResult } from '../types/electron';

/**
 * 调用股票信息提取（OCR + 结构化解析）
 * @param imagePath 图片文件绝对路径
 * @returns 平铺的结构化股票数据
 */
export async function extractStockInfo(imagePath: string): Promise<StockParseResult> {
  return window.electronAPI.stockExtract(imagePath);
}

/**
 * 传入压缩后的 base64 图片数据进行股票提取
 * @param base64 压缩后的 JPEG base64 字符串（不含 data: URL 前缀）
 */
export async function extractStockInfoBase64(base64: string): Promise<StockParseResult> {
  return window.electronAPI.stockExtractBase64(base64);
}
