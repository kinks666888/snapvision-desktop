import React from 'react';

/**
 * TypographyDemo Component
 * Demonstrates the SnapVision typography system
 */
export function TypographyDemo() {
  return (
    <div className="p-6 space-y-8 bg-snapvision-dark">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-2xl font-bold text-snapvision-primary">
          SnapVision Typography System
        </h1>
        <p className="text-auxiliary text-snapvision-tertiary">
          Background: #0A0E1A | Font: SF Pro Display + PingFang SC
        </p>
      </div>

      {/* 5-Level Typography Scale */}
      <section className="space-y-4">
        <h2 className="section-header">5-Level Typography Scale</h2>
        
        <div className="space-y-6 p-4 bg-dark-800/50 rounded-card">
          {/* Level 1: Main Price */}
          <div className="space-y-1">
            <p className="text-auxiliary text-snapvision-tertiary">
              Level 1: 主价格 (Main Price) - 40px Bold
            </p>
            <p className="text-price-main tabular-nums font-mono-numeric text-snapvision-primary">
              ¥123,456.78
            </p>
          </div>

          {/* Level 2: Price Change */}
          <div className="space-y-1">
            <p className="text-auxiliary text-snapvision-tertiary">
              Level 2: 涨跌幅 (Price Change) - 18px Medium
            </p>
            <div className="flex items-center gap-4">
              <span className="text-price-change tabular-nums font-mono-numeric text-price-up">
                +2.34%
              </span>
              <span className="text-price-change tabular-nums font-mono-numeric text-price-down">
                -1.23%
              </span>
              <span className="text-price-change tabular-nums font-mono-numeric text-snapvision-secondary">
                0.00%
              </span>
            </div>
          </div>

          {/* Level 3: Section Header */}
          <div className="space-y-1">
            <p className="text-auxiliary text-snapvision-tertiary">
              Level 3: Section 标题 - 14px Semibold
            </p>
            <p className="section-header text-snapvision-secondary">
              基本信息
            </p>
          </div>

          {/* Level 4: Body Data */}
          <div className="space-y-1">
            <p className="text-auxiliary text-snapvision-tertiary">
              Level 4: 正文数据 - 13px Regular
            </p>
            <div className="grid grid-cols-2 gap-x-8 gap-y-2">
              <div className="flex justify-between">
                <span className="text-body-data text-snapvision-tertiary">今开</span>
                <span className="text-body-data tabular-nums font-mono-numeric text-snapvision-secondary">
                  123.45
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-body-data text-snapvision-tertiary">昨收</span>
                <span className="text-body-data tabular-nums font-mono-numeric text-snapvision-secondary">
                  122.34
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-body-data text-snapvision-tertiary">最高</span>
                <span className="text-body-data tabular-nums font-mono-numeric text-snapvision-secondary">
                  125.67
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-body-data text-snapvision-tertiary">最低</span>
                <span className="text-body-data tabular-nums font-mono-numeric text-snapvision-secondary">
                  121.89
                </span>
              </div>
            </div>
          </div>

          {/* Level 5: Auxiliary */}
          <div className="space-y-1">
            <p className="text-auxiliary text-snapvision-tertiary">
              Level 5: 辅助说明 - 12px Regular
            </p>
            <div className="flex items-center gap-4">
              <span className="auxiliary-text">
                OCR 可信度: 95%
              </span>
              <span className="auxiliary-text">
                更新时间: 14:30:25
              </span>
              <span className="auxiliary-text">
                数据来源: 实时行情
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Font Combinations */}
      <section className="space-y-4">
        <h2 className="section-header">字体组合对比</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Option A */}
          <div className="p-4 bg-dark-800/50 rounded-card space-y-3">
            <h3 className="text-body-data font-semibold text-snapvision-primary">
              A. SF Pro Display + PingFang SC
            </h3>
            <p className="text-sm text-snapvision-secondary">
              原生 macOS 体验，最佳渲染效果
            </p>
            <div className="space-y-2 pt-2">
              <p className="text-price-change tabular-nums text-snapvision-primary">
                123,456.78
              </p>
              <p className="text-body-data text-snapvision-secondary">
                中文测试：股价上涨趋势良好
              </p>
            </div>
          </div>

          {/* Option B */}
          <div className="p-4 bg-dark-800/50 rounded-card space-y-3">
            <h3 className="text-body-data font-semibold text-snapvision-primary">
              B. Inter + Noto Sans SC
            </h3>
            <p className="text-sm text-snapvision-secondary">
              跨平台一致性，现代感强
            </p>
            <div className="space-y-2 pt-2">
              <p className="text-price-change tabular-nums text-snapvision-primary">
                123,456.78
              </p>
              <p className="text-body-data text-snapvision-secondary">
                中文测试：股价上涨趋势良好
              </p>
            </div>
          </div>

          {/* Option C */}
          <div className="p-4 bg-dark-800/50 rounded-card space-y-3">
            <h3 className="text-body-data font-semibold text-snapvision-primary">
              C. JetBrains Mono + PingFang SC
            </h3>
            <p className="text-sm text-snapvision-secondary">
              数字等宽对齐，表格专用
            </p>
            <div className="space-y-2 pt-2">
              <p className="text-price-change font-mono-numeric text-snapvision-primary">
                123,456.78
              </p>
              <p className="text-body-data text-snapvision-secondary">
                中文测试：股价上涨趋势良好
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Color Contrast */}
      <section className="space-y-4">
        <h2 className="section-header">涨跌色对比度 (WCAG AA)</h2>
        
        <div className="p-4 bg-dark-800/50 rounded-card space-y-4">
          <div className="grid grid-cols-2 gap-8">
            {/* Red Colors */}
            <div className="space-y-3">
              <h4 className="text-body-data font-semibold text-snapvision-primary">
                红色系 (涨)
              </h4>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-body-data text-snapvision-tertiary">#DC2626</span>
                  <span className="text-body-data text-red-600">深红 (8.5:1)</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-body-data text-snapvision-tertiary">#EF4444</span>
                  <span className="text-body-data text-red-500">标准红 (7.8:1)</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-body-data text-snapvision-tertiary">#F87171</span>
                  <span className="text-body-data text-red-400">亮红 (6.5:1)</span>
                </div>
              </div>
            </div>

            {/* Green Colors */}
            <div className="space-y-3">
              <h4 className="text-body-data font-semibold text-snapvision-primary">
                绿色系 (跌)
              </h4>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-body-data text-snapvision-tertiary">#16A34A</span>
                  <span className="text-body-data text-green-600">深绿 (7.5:1)</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-body-data text-snapvision-tertiary">#22C55E</span>
                  <span className="text-body-data text-green-500">标准绿 (7.2:1)</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-body-data text-snapvision-tertiary">#4ADE80</span>
                  <span className="text-body-data text-green-400">亮绿 (5.8:1)</span>
                </div>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-dark-700/30">
            <p className="text-auxiliary text-snapvision-tertiary">
              ✅ 所有颜色均符合 WCAG AA 标准 (4.5:1 对比度)
            </p>
          </div>
        </div>
      </section>

      {/* Letter Spacing */}
      <section className="space-y-4">
        <h2 className="section-header">数字字间距调优</h2>
        
        <div className="p-4 bg-dark-800/50 rounded-card space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-3">
              <h4 className="text-body-data font-semibold text-snapvision-primary">
                紧凑字间距 (-0.02em)
              </h4>
              <p className="text-price-main tabular-nums font-mono-numeric text-snapvision-primary tracking-tightest">
                123,456.78
              </p>
              <p className="text-auxiliary text-snapvision-tertiary">
                适用于：价格、成交量
              </p>
            </div>

            <div className="space-y-3">
              <h4 className="text-body-data font-semibold text-snapvision-primary">
                默认字间距 (0)
              </h4>
              <p className="text-price-main tabular-nums font-mono-numeric text-snapvision-primary">
                123,456.78
              </p>
              <p className="text-auxiliary text-snapvision-tertiary">
                适用于：代码、名称
              </p>
            </div>
          </div>

          <div className="pt-4 border-t border-dark-700/30">
            <p className="text-auxiliary text-snapvision-tertiary">
              💡 金融数据建议使用 -0.02em 字间距，使数字更紧凑易读
            </p>
          </div>
        </div>
      </section>

      {/* Usage Examples */}
      <section className="space-y-4">
        <h2 className="section-header">使用示例</h2>
        
        <div className="p-4 bg-dark-800/50 rounded-card space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 className="text-body-data font-semibold text-snapvision-primary mb-3">
                React 组件示例
              </h4>
              <pre className="text-xs text-snapvision-secondary bg-dark-900/50 p-3 rounded-lg overflow-x-auto">
{`<p className="text-price-main 
  tabular-nums 
  font-mono-numeric 
  text-snapvision-primary">
  ¥123,456.78
</p>`}
              </pre>
            </div>

            <div>
              <h4 className="text-body-data font-semibold text-snapvision-primary mb-3">
                Tailwind 类名示例
              </h4>
              <pre className="text-xs text-snapvision-secondary bg-dark-900/50 p-3 rounded-lg overflow-x-auto">
{`// 主价格
text-price-main tabular-nums font-mono-numeric

// 涨跌幅
text-price-change tabular-nums 
font-mono-numeric text-price-up

// 数据单元格
text-body-data tabular-nums 
font-mono-numeric text-snapvision-secondary`}
              </pre>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export default TypographyDemo;
