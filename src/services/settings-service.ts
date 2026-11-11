/**
 * Settings Service — 设置管理服务
 *
 * 负责设置的读取、保存和验证
 */

import type { AppSettings, StockApiConfig, BuiltInProvider } from '../types/settings';
import { DEFAULT_SETTINGS, BUILTIN_API_PROVIDERS } from '../types/settings';

const STORAGE_KEY = 'snapvision-settings';

/**
 * 获取当前设置
 */
export function getSettings(): AppSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as AppSettings;
      // 合并默认值，确保所有字段存在
      return { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch (error) {
    console.error('[Settings] Failed to load settings:', error);
  }
  return { ...DEFAULT_SETTINGS };
}

/**
 * 保存设置
 */
export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    console.log('[Settings] Settings saved successfully');
  } catch (error) {
    console.error('[Settings] Failed to save settings:', error);
    throw new Error('设置保存失败');
  }
}

/**
 * 获取当前API提供商配置
 */
export function getCurrentApiConfig(): StockApiConfig {
  const settings = getSettings();

  if (settings.apiProviderId === 'custom' && settings.customApi) {
    return settings.customApi;
  }

  const provider = BUILTIN_API_PROVIDERS.find(p => p.id === settings.apiProviderId);
  return provider?.config || BUILTIN_API_PROVIDERS[0].config;
}

/**
 * 验证API配置
 */
export function validateApiConfig(config: StockApiConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // 验证URL格式
  const urlFields: Array<{ field: string; value: { url: string } }> = [
    { field: '实时行情API', value: config.realtimeQuote },
    { field: 'K线数据API', value: config.klineData },
    { field: '股票搜索API', value: config.stockSearch },
  ];

  for (const { field, value } of urlFields) {
    if (!value.url) {
      errors.push(`${field}的URL不能为空`);
      continue;
    }

    try {
      new URL(value.url.replace(/\{[^}]+\}/g, 'test'));
    } catch {
      errors.push(`${field}的URL格式无效`);
    }

    // 检查协议安全性
    if (value.url.startsWith('http://')) {
      console.warn(`[Settings] ${field}使用HTTP协议，建议使用HTTPS`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * 测试API连接
 */
export async function testApiConnection(config: StockApiConfig): Promise<{ success: boolean; message: string }> {
  try {
    // 使用测试股票代码
    const testCode = '600519';
    const url = config.realtimeQuote.url.replace('{code}', testCode);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, {
      method: config.realtimeQuote.method,
      headers: config.realtimeQuote.headers,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      return { success: true, message: '连接成功' };
    } else {
      return { success: false, message: `HTTP ${response.status}: ${response.statusText}` };
    }
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        return { success: false, message: '连接超时' };
      }
      return { success: false, message: `连接失败: ${error.message}` };
    }
    return { success: false, message: '未知错误' };
  }
}

/**
 * 重置为默认设置
 */
export function resetToDefault(): AppSettings {
  const defaultSettings = { ...DEFAULT_SETTINGS };
  saveSettings(defaultSettings);
  return defaultSettings;
}
