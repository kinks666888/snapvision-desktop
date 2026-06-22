/**
 * OCR Service — 渲染进程侧 OCR API 封装
 *
 * 通过 IPC 调用主进程的 OCR 客户端。
 * 不做任何 OCR 逻辑，纯转发层。
 */

import type { OcrResult, OcrStatus } from '../types/electron';

/**
 * 调用 OCR 识别图片
 */
export async function recognizeImage(imagePath: string): Promise<OcrResult> {
  return window.electronAPI.ocrRecognize(imagePath);
}

/**
 * 获取 OCR 服务状态
 */
export async function getOcrHealth(): Promise<OcrStatus> {
  return window.electronAPI.ocrHealth();
}

/**
 * 监听 OCR 状态变化
 * @returns 取消监听的函数
 */
export function onOcrStatusChange(
  callback: (status: OcrStatus) => void
): () => void {
  return window.electronAPI.onOcrStatusChange(callback);
}

/**
 * 打开系统文件选择器，返回选中的图片路径
 */
export async function selectImageFile(): Promise<string | null> {
  return window.electronAPI.selectImageFile();
}

/**
 * 通过 IPC 读取本地图片文件，返回 base64 data URL
 */
export async function readImageFile(imagePath: string): Promise<string> {
  return window.electronAPI.readImageFile(imagePath);
}

/**
 * 获取 OCR 服务脚本路径 (供 UI 展示提示用)
 */
export async function getOcrServerPath(): Promise<string> {
  return window.electronAPI.getOcrServerPath();
}

/**
 * 重试启动 OCR 服务（用于启动失败后的手动恢复）
 */
export async function retryOcr(): Promise<{ ok: boolean; error?: string }> {
  return window.electronAPI.retryOcr();
}
