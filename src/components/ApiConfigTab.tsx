/**
 * ApiConfigTab — API配置标签页组件
 *
 * 允许用户选择内置API提供商或配置自定义API
 */

import React, { useState, useEffect } from 'react';
import type { AppSettings, StockApiConfig, BuiltInProvider, ApiEndpointConfig } from '../types/settings';
import { BUILTIN_API_PROVIDERS, DEFAULT_SETTINGS } from '../types/settings';
import { validateApiConfig, testApiConnection } from '../services/settings-service';

interface ApiConfigTabProps {
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
}

export function ApiConfigTab({ settings, onSettingsChange }: ApiConfigTabProps) {
  const [selectedProvider, setSelectedProvider] = useState<BuiltInProvider | 'custom'>(settings.apiProviderId);
  const [customConfig, setCustomConfig] = useState<StockApiConfig>(
    settings.customApi || BUILTIN_API_PROVIDERS[0].config
  );
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  // 同步设置变化
  useEffect(() => {
    setSelectedProvider(settings.apiProviderId);
    if (settings.customApi) {
      setCustomConfig(settings.customApi);
    }
  }, [settings]);

  // 处理提供商选择变化
  const handleProviderChange = (providerId: BuiltInProvider | 'custom') => {
    setSelectedProvider(providerId);
    const newSettings: AppSettings = {
      ...settings,
      apiProviderId: providerId,
    };
    if (providerId === 'custom') {
      newSettings.customApi = customConfig;
    }
    onSettingsChange(newSettings);
    setErrors([]);
    setTestResult(null);
  };

  // 处理自定义配置变化
  const handleCustomConfigChange = (field: keyof StockApiConfig, value: ApiEndpointConfig) => {
    const newConfig = { ...customConfig, [field]: value };
    setCustomConfig(newConfig);

    if (selectedProvider === 'custom') {
      onSettingsChange({
        ...settings,
        apiProviderId: 'custom',
        customApi: newConfig,
      });
    }
  };

  // 测试连接
  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);

    const config = selectedProvider === 'custom'
      ? customConfig
      : BUILTIN_API_PROVIDERS.find(p => p.id === selectedProvider)?.config || BUILTIN_API_PROVIDERS[0].config;

    const validation = validateApiConfig(config);
    if (!validation.valid) {
      setErrors(validation.errors);
      setTesting(false);
      return;
    }

    const result = await testApiConnection(config);
    setTestResult(result);
    setTesting(false);
  };

  // 获取当前配置
  const currentConfig = selectedProvider === 'custom'
    ? customConfig
    : BUILTIN_API_PROVIDERS.find(p => p.id === selectedProvider)?.config || BUILTIN_API_PROVIDERS[0].config;

  return (
    <div className="space-y-4">
      {/* API提供商选择 */}
      <div>
        <label className="block text-xs text-dark-300 mb-2">选择数据源</label>
        <div className="grid grid-cols-2 gap-2">
          {BUILTIN_API_PROVIDERS.map((provider) => (
            <button
              key={provider.id}
              onClick={() => handleProviderChange(provider.id as BuiltInProvider)}
              className={`p-3 rounded-lg border text-left transition-all ${
                selectedProvider === provider.id
                  ? 'border-blue-500 bg-blue-500/10 text-blue-400'
                  : 'border-dark-700 bg-dark-800/50 text-dark-300 hover:border-dark-600'
              }`}
            >
              <div className="text-sm font-medium">{provider.name}</div>
              <div className="text-xs text-dark-500 mt-1">{provider.description}</div>
            </button>
          ))}
          <button
            onClick={() => handleProviderChange('custom')}
            className={`p-3 rounded-lg border text-left transition-all ${
              selectedProvider === 'custom'
                ? 'border-purple-500 bg-purple-500/10 text-purple-400'
                : 'border-dark-700 bg-dark-800/50 text-dark-300 hover:border-dark-600'
            }`}
          >
            <div className="text-sm font-medium">自定义API</div>
            <div className="text-xs text-dark-500 mt-1">配置您自己的数据源</div>
          </button>
        </div>
      </div>

      {/* 自定义API配置 */}
      {selectedProvider === 'custom' && (
        <div className="space-y-3">
          <div className="text-xs text-dark-400 mb-2">
            配置自定义API端点。URL中可使用以下占位符：
            <span className="text-blue-400">{'{code}'}</span> - 股票代码，
            <span className="text-blue-400">{'{period}'}</span> - K线周期，
            <span className="text-blue-400">{'{count}'}</span> - 数量，
            <span className="text-blue-400">{'{keyword}'}</span> - 搜索关键词
          </div>

          {/* 实时行情API */}
          <ApiEndpointEditor
            label="实时行情API"
            config={customConfig.realtimeQuote}
            onChange={(config) => handleCustomConfigChange('realtimeQuote', config)}
            placeholderCode="600519"
          />

          {/* K线数据API */}
          <ApiEndpointEditor
            label="K线数据API"
            config={customConfig.klineData}
            onChange={(config) => handleCustomConfigChange('klineData', config)}
            placeholderCode="600519"
            placeholderPeriod="daily"
            placeholderCount="30"
          />

          {/* 股票搜索API */}
          <ApiEndpointEditor
            label="股票搜索API"
            config={customConfig.stockSearch}
            onChange={(config) => handleCustomConfigChange('stockSearch', config)}
            placeholderKeyword="茅台"
          />
        </div>
      )}

      {/* 错误提示 */}
      {errors.length > 0 && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
          {errors.map((error, i) => (
            <div key={i} className="text-xs text-red-400">{error}</div>
          ))}
        </div>
      )}

      {/* 测试结果 */}
      {testResult && (
        <div className={`p-3 rounded-lg border ${
          testResult.success
            ? 'bg-green-500/10 border-green-500/20'
            : 'bg-red-500/10 border-red-500/20'
        }`}>
          <div className={`text-xs ${testResult.success ? 'text-green-400' : 'text-red-400'}`}>
            {testResult.message}
          </div>
        </div>
      )}

      {/* 测试连接按钮 */}
      <button
        onClick={handleTestConnection}
        disabled={testing}
        className="w-full py-2 px-4 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed text-white text-sm transition-colors"
      >
        {testing ? '测试中...' : '测试连接'}
      </button>

      {/* 当前配置预览 */}
      <div className="p-3 rounded-lg bg-dark-800/30 border border-dark-700">
        <div className="text-xs text-dark-400 mb-2">当前配置预览</div>
        <div className="space-y-1">
          <div className="text-xs text-dark-300">
            <span className="text-dark-500">实时行情:</span>{' '}
            <span className="font-mono text-blue-400">{currentConfig.realtimeQuote.url}</span>
          </div>
          <div className="text-xs text-dark-300">
            <span className="text-dark-500">K线数据:</span>{' '}
            <span className="font-mono text-blue-400">{currentConfig.klineData.url}</span>
          </div>
          <div className="text-xs text-dark-300">
            <span className="text-dark-500">股票搜索:</span>{' '}
            <span className="font-mono text-blue-400">{currentConfig.stockSearch.url}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** API端点编辑器子组件 */
interface ApiEndpointEditorProps {
  label: string;
  config: ApiEndpointConfig;
  onChange: (config: ApiEndpointConfig) => void;
  placeholderCode?: string;
  placeholderPeriod?: string;
  placeholderCount?: string;
  placeholderKeyword?: string;
}

function ApiEndpointEditor({
  label,
  config,
  onChange,
  placeholderCode,
  placeholderPeriod,
  placeholderCount,
  placeholderKeyword,
}: ApiEndpointEditorProps) {
  const handleChange = (field: keyof ApiEndpointConfig, value: string) => {
    onChange({ ...config, [field]: value });
  };

  return (
    <div className="p-3 rounded-lg bg-dark-800/50 border border-dark-700">
      <div className="text-xs font-medium text-dark-300 mb-2">{label}</div>
      <div className="space-y-2">
        <input
          type="text"
          value={config.url}
          onChange={(e) => handleChange('url', e.target.value)}
          placeholder={`URL模板，如 https://api.example.com/quote?code={placeholderCode || '{code}'}`}
          className="w-full px-3 py-2 rounded-lg bg-dark-900 border border-dark-700 text-white text-xs font-mono focus:outline-none focus:border-blue-500"
        />
        <div className="flex gap-2">
          <select
            value={config.method}
            onChange={(e) => handleChange('method', e.target.value)}
            className="px-2 py-1.5 rounded-lg bg-dark-900 border border-dark-700 text-white text-xs focus:outline-none focus:border-blue-500"
          >
            <option value="GET">GET</option>
            <option value="POST">POST</option>
          </select>
          <select
            value={config.responseFormat}
            onChange={(e) => handleChange('responseFormat', e.target.value)}
            className="px-2 py-1.5 rounded-lg bg-dark-900 border border-dark-700 text-white text-xs focus:outline-none focus:border-blue-500"
          >
            <option value="json">JSON</option>
            <option value="text">Text</option>
          </select>
          <select
            value={config.parserType}
            onChange={(e) => handleChange('parserType', e.target.value)}
            className="flex-1 px-2 py-1.5 rounded-lg bg-dark-900 border border-dark-700 text-white text-xs focus:outline-none focus:border-blue-500"
          >
            <option value="tencent">腾讯格式</option>
            <option value="sina">新浪格式</option>
            <option value="eastmoney">东方财富格式</option>
            <option value="custom">自定义</option>
          </select>
        </div>
      </div>
    </div>
  );
}
