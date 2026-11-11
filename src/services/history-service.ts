/**
 * History Service — 渲染进程侧历史记录 API 封装
 *
 * 通过 IPC 调用主进程的 history:* handler。
 * 纯转发层，无业务逻辑。
 */

import type {
  HistoryRecord,
  HistoryListParams,
  HistoryListResult,
  HistorySaveParams,
  HistorySaveResult,
} from '../types/electron';

export async function fetchHistoryList(params: HistoryListParams): Promise<HistoryListResult> {
  return window.electronAPI.historyList(params);
}

export async function fetchHistoryDetail(id: number): Promise<HistoryRecord> {
  const result = await window.electronAPI.historyDetail(id);
  if (!result.success) throw new Error('获取记录失败');
  return result.record;
}

export async function removeHistory(id: number): Promise<void> {
  await window.electronAPI.historyDelete(id);
}

export async function removeAllHistory(): Promise<number> {
  const result = await window.electronAPI.historyClear();
  return result.deleted;
}

export async function exportHistory(
  id: number,
  format: 'md' | 'json' | 'txt' = 'md'
): Promise<{ ok: boolean; path?: string; cancelled?: boolean }> {
  return window.electronAPI.historyExport(id, format);
}

export async function saveHistory(params: HistorySaveParams): Promise<HistorySaveResult> {
  console.log('[History] Saving...', { code: params.stock_code, name: params.stock_name });
  try {
    const result = await window.electronAPI.historySave(params);
    console.log(`[History] Save success: ${params.stock_code} ${params.stock_name}`);
    console.log('[History] Database updated');
    return result;
  } catch (err) {
    console.error('[History] Save failed:', err);
    throw err;
  }
}
