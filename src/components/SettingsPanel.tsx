/**
 * SettingsPanel — 设置面板组件
 *
 * 包含API配置、隐私设置等标签页
 */

import React, { useState, useEffect } from 'react';
import type { AppSettings } from '../types/settings';
import { DEFAULT_SETTINGS } from '../types/settings';
import { getSettings, saveSettings, resetToDefault } from '../services/settings-service';
import { ApiConfigTab } from './ApiConfigTab';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

type TabType = 'api' | 'privacy' | 'about';

export function SettingsPanel({ isOpen, onClose }: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<TabType>('api');
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // 加载设置
  useEffect(() => {
    if (isOpen) {
      setSettings(getSettings());
      setSaveStatus('idle');
    }
  }, [isOpen]);

  // 处理设置变化
  const handleSettingsChange = (newSettings: AppSettings) => {
    setSettings(newSettings);
    setSaveStatus('idle');
  };

  // 保存设置
  const handleSave = async () => {
    setSaveStatus('saving');
    try {
      saveSettings(settings);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (error) {
      setSaveStatus('error');
    }
  };

  // 重置为默认设置
  const handleReset = () => {
    if (confirm('确定要重置所有设置吗？')) {
      const defaultSettings = resetToDefault();
      setSettings(defaultSettings);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-lg mx-4 rounded-xl bg-dark-900 border border-dark-700 shadow-2xl overflow-hidden">
        {/* 头部 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-dark-700">
          <h2 className="text-sm font-medium text-white">设置</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-dark-400 hover:text-white hover:bg-dark-800 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 标签页导航 */}
        <div className="flex border-b border-dark-700">
          <button
            onClick={() => setActiveTab('api')}
            className={`flex-1 px-4 py-2.5 text-xs font-medium transition-colors ${
              activeTab === 'api'
                ? 'text-blue-400 border-b-2 border-blue-400'
                : 'text-dark-400 hover:text-white'
            }`}
          >
            API配置
          </button>
          <button
            onClick={() => setActiveTab('privacy')}
            className={`flex-1 px-4 py-2.5 text-xs font-medium transition-colors ${
              activeTab === 'privacy'
                ? 'text-blue-400 border-b-2 border-blue-400'
                : 'text-dark-400 hover:text-white'
            }`}
          >
            隐私设置
          </button>
          <button
            onClick={() => setActiveTab('about')}
            className={`flex-1 px-4 py-2.5 text-xs font-medium transition-colors ${
              activeTab === 'about'
                ? 'text-blue-400 border-b-2 border-blue-400'
                : 'text-dark-400 hover:text-white'
            }`}
          >
            关于
          </button>
        </div>

        {/* 内容区域 */}
        <div className="p-4 max-h-[60vh] overflow-y-auto">
          {activeTab === 'api' && (
            <ApiConfigTab settings={settings} onSettingsChange={handleSettingsChange} />
          )}

          {activeTab === 'privacy' && (
            <PrivacyTab settings={settings} onSettingsChange={handleSettingsChange} />
          )}

          {activeTab === 'about' && <AboutTab />}
        </div>

        {/* 底部按钮 */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-dark-700">
          <button
            onClick={handleReset}
            className="px-3 py-1.5 rounded-lg text-xs text-dark-400 hover:text-white hover:bg-dark-800 transition-colors"
          >
            重置默认
          </button>
          <div className="flex items-center gap-2">
            {saveStatus === 'saved' && (
              <span className="text-xs text-green-400">已保存</span>
            )}
            {saveStatus === 'error' && (
              <span className="text-xs text-red-400">保存失败</span>
            )}
            <button
              onClick={handleSave}
              disabled={saveStatus === 'saving'}
              className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed text-white text-xs transition-colors"
            >
              {saveStatus === 'saving' ? '保存中...' : '保存设置'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 隐私设置标签页 */
function PrivacyTab({
  settings,
  onSettingsChange,
}: {
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
}) {
  return (
    <div className="space-y-4">
      {/* AI处理 */}
      <div className="flex items-center justify-between p-3 rounded-lg bg-dark-800/50 border border-dark-700">
        <div>
          <div className="text-sm text-white">AI增强分析</div>
          <div className="text-xs text-dark-400 mt-1">
            启用DeepSeek AI视觉模型进行更精确的股票识别
          </div>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={settings.aiEnabled}
            onChange={(e) => onSettingsChange({ ...settings, aiEnabled: e.target.checked })}
            className="sr-only peer"
          />
          <div className="w-9 h-5 bg-dark-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
        </label>
      </div>

      {/* 自动保存历史 */}
      <div className="flex items-center justify-between p-3 rounded-lg bg-dark-800/50 border border-dark-700">
        <div>
          <div className="text-sm text-white">自动保存历史</div>
          <div className="text-xs text-dark-400 mt-1">
            识别完成后自动保存到历史记录
          </div>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={settings.autoSaveHistory}
            onChange={(e) => onSettingsChange({ ...settings, autoSaveHistory: e.target.checked })}
            className="sr-only peer"
          />
          <div className="w-9 h-5 bg-dark-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
        </label>
      </div>

      {/* 历史记录保留天数 */}
      <div className="p-3 rounded-lg bg-dark-800/50 border border-dark-700">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm text-white">历史记录保留</div>
          <span className="text-xs text-blue-400">
            {settings.historyRetentionDays === 0 ? '永久保留' : `${settings.historyRetentionDays} 天`}
          </span>
        </div>
        <input
          type="range"
          min="0"
          max="365"
          step="30"
          value={settings.historyRetentionDays}
          onChange={(e) => onSettingsChange({ ...settings, historyRetentionDays: parseInt(e.target.value) })}
          className="w-full h-1 bg-dark-700 rounded-lg appearance-none cursor-pointer"
        />
        <div className="flex justify-between mt-1">
          <span className="text-xs text-dark-500">永久</span>
          <span className="text-xs text-dark-500">1年</span>
        </div>
      </div>

      {/* 数据说明 */}
      <div className="p-3 rounded-lg bg-dark-800/30 border border-dark-700">
        <div className="text-xs text-dark-400">
          <div className="font-medium text-dark-300 mb-2">数据存储说明</div>
          <ul className="space-y-1.5">
            <li className="flex items-start gap-2">
              <span className="text-blue-400 mt-0.5">•</span>
              <span>所有数据存储在本地，不会上传到云端</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-blue-400 mt-0.5">•</span>
              <span>AI分析功能会将截图发送到DeepSeek API（如已启用）</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-blue-400 mt-0.5">•</span>
              <span>股票数据来自第三方API（腾讯/新浪/东方财富）</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-blue-400 mt-0.5">•</span>
              <span>数据库文件权限已设置为仅当前用户可访问</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}

/** 关于标签页 */
function AboutTab() {
  return (
    <div className="space-y-4">
      {/* 应用信息 */}
      <div className="text-center py-4">
        <div className="w-16 h-16 mx-auto mb-3 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
          <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-white">SnapVision</h3>
        <p className="text-xs text-dark-400 mt-1">AI股票截图识别分析工具</p>
      </div>

      {/* 版本信息 */}
      <div className="p-3 rounded-lg bg-dark-800/50 border border-dark-700">
        <div className="space-y-2">
          <div className="flex justify-between">
            <span className="text-xs text-dark-400">版本</span>
            <span className="text-xs text-white">1.0.0</span>
          </div>
          <div className="flex justify-between">
            <span className="text-xs text-dark-400">引擎</span>
            <span className="text-xs text-white">PaddleOCR + DeepSeek Vision</span>
          </div>
          <div className="flex justify-between">
            <span className="text-xs text-dark-400">框架</span>
            <span className="text-xs text-white">Electron + React + Vite</span>
          </div>
        </div>
      </div>

      {/* 功能特性 */}
      <div className="p-3 rounded-lg bg-dark-800/30 border border-dark-700">
        <div className="text-xs text-dark-400">
          <div className="font-medium text-dark-300 mb-2">主要功能</div>
          <ul className="space-y-1.5">
            <li className="flex items-start gap-2">
              <span className="text-green-400 mt-0.5">✓</span>
              <span>智能截图识别股票信息</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-400 mt-0.5">✓</span>
              <span>AI增强分析（可选）</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-400 mt-0.5">✓</span>
              <span>实时行情数据</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-400 mt-0.5">✓</span>
              <span>K线图表展示</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-400 mt-0.5">✓</span>
              <span>历史记录管理</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-400 mt-0.5">✓</span>
              <span>涨跌停分析</span>
            </li>
          </ul>
        </div>
      </div>

      {/* 隐私声明 */}
      <div className="p-3 rounded-lg bg-dark-800/30 border border-dark-700">
        <div className="text-xs text-dark-400">
          <div className="font-medium text-dark-300 mb-2">隐私声明</div>
          <p className="leading-relaxed">
            SnapVision 注重用户隐私保护。所有识别数据和历史记录均存储在本地设备上，
            不会上传到任何云端服务器。AI分析功能（如已启用）会将截图发送到
            DeepSeek API进行处理，但不会保存在第三方服务器。
          </p>
        </div>
      </div>
    </div>
  );
}
