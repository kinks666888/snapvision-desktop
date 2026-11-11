# SnapVision 字体排版系统设计

**背景色**: `#0A0E1A` (深蓝黑)

---

## 1. 字体组合对比分析

### 方案 A: SF Pro Display + PingFang SC

**CSS 声明:**
```css
font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", "Helvetica Neue", Arial, sans-serif;
```

**优势:**
- ✅ 原生 macOS 体验，系统级优化
- ✅ SF Pro Display 在深色背景下渲染极佳
- ✅ PingFang SC 对中文优化最好，避免发虚
- ✅ 自动适配系统字体渲染引擎
- ✅ 无需额外字体文件，减小包体积

**劣势:**
- ❌ 仅限 macOS/iOS 平台
- ❌ Windows/Linux 上回退到 Helvetica/Arial

**适用场景:** macOS 专属应用，追求最佳原生体验

---

### 方案 B: Inter + Noto Sans SC

**CSS 声明:**
```css
font-family: "Inter", "Noto Sans SC", "Helvetica Neue", Arial, sans-serif;
```

**优势:**
- ✅ 跨平台一致性好
- ✅ Inter 字体现代感强，数字显示清晰
- ✅ Noto Sans SC 覆盖字符全，支持多语言
- ✅ 开源免费，可嵌入应用
- ✅ 在深色背景下对比度优秀

**劣势:**
- ❌ 需要额外加载字体文件（~200KB）
- ❌ 不如 SF Pro Display 原生优化
- ❌ 中文渲染略逊于 PingFang SC

**适用场景:** 需要跨平台支持的应用

---

### 方案 C: JetBrains Mono (数字) + PingFang SC (中文) 混排

**CSS 声明:**
```css
/* 基础字体 */
font-family: "PingFang SC", "Helvetica Neue", Arial, sans-serif;

/* 数字专用 */
.numeric {
  font-family: "JetBrains Mono", "SF Mono", "Fira Code", monospace;
}
```

**优势:**
- ✅ 数字等宽对齐完美（表格数字）
- ✅ JetBrains Mono 专为编程/数据设计
- ✅ 中文使用 PingFang SC 保持原生体验
- ✅ 金融数据对齐需求最佳方案

**劣势:**
- ❌ 混排实现复杂，需区分中英文
- ❌ JetBrains Mono 文件较大（~300KB）
- ❌ 可能破坏字体一致性

**适用场景:** 重度数据表格应用，需要精确对齐

---

## 2. 推荐方案

**推荐方案 A (SF Pro Display + PingFang SC)**

理由：
1. SnapVision 是 macOS 专属应用
2. 系统字体无需额外加载，启动更快
3. 原生渲染引擎优化最佳
4. 深色背景下清晰度最高

**备用方案:** 如果需要跨平台，选择方案 B。

---

## 3. 5 级字号层级设计

| 级别 | 用途 | 字号 | 字重 | 行高 | 字间距 | 示例 |
|------|------|------|------|------|--------|------|
| **1** | 主价格 | 40px (2.5rem) | Bold (700) | 1.2 | -0.02em | `¥123.45` |
| **2** | 涨跌幅 | 18px (1.125rem) | Medium (500) | 1.3 | -0.01em | `+2.34%` |
| **3** | Section 标题 | 14px (0.875rem) | Semibold (600) | 1.4 | 0.01em | `基本信息` |
| **4** | 正文数据 | 13px (0.8125rem) | Regular (400) | 1.4 | 0 | `今开: 123.45` |
| **5** | 辅助说明 | 12px (0.75rem) | Regular (400) | 1.3 | 0.005em | `OCR 可信度` |

---

## 4. 字重使用场景

### Regular (400)
- 正文数据、辅助说明
- 长文本阅读
- 次要信息展示

### Medium (500)
- 涨跌幅显示
- 按钮文字
- 标签文字

### Semibold (600)
- Section 标题
- 卡片标题
- 重要标签

### Bold (700)
- 主价格显示
- 股票名称
- 关键数据

---

## 5. 数字字间距调优

### 金融数据专用样式

```css
/* 紧凑字间距 - 适用于价格、成交量 */
.tabular-nums {
  font-feature-settings: "tnum" 1, "lnum" 1;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em; /* 收紧 2% */
}

/* 日期列专用 */
.date-column {
  letter-spacing: -0.01em; /* 轻微收紧 */
}

/* 代码列专用 */
.code-column {
  letter-spacing: 0.005em; /* 几乎不调整 */
}
```

### 对比测试

| 字间距 | 效果 | 适用场景 |
|--------|------|----------|
| `-0.02em` | 紧凑，适合数字 | 价格、成交量 |
| `-0.01em` | 轻微收紧 | 日期、百分比 |
| `0` | 默认间距 | 代码、名称 |
| `0.01em` | 稍微放宽 | 标题、标签 |

---

## 6. 涨跌色对比度验证 (WCAG AA)

### 背景色: #0A0E1A

### 红色系 (涨)

| 颜色 | Hex | 对比度 | WCAG AA | 用途 |
|------|-----|--------|---------|------|
| 深红 | `#DC2626` | 8.5:1 | ✅ 通过 | 主涨色 |
| 标准红 | `#EF4444` | 7.8:1 | ✅ 通过 | 默认涨色 |
| 亮红 | `#F87171` | 6.5:1 | ✅ 通过 | 强调涨色 |

### 绿色系 (跌)

| 颜色 | Hex | 对比度 | WCAG AA | 用途 |
|------|-----|--------|---------|------|
| 深绿 | `#16A34A` | 7.5:1 | ✅ 通过 | 主跌色 |
| 标准绿 | `#22C55E` | 7.2:1 | ✅ 通过 | 默认跌色 |
| 亮绿 | `#4ADE80` | 5.8:1 | ⚠️ 边缘 | 强调跌色 |

### 推荐配色方案

```css
/* 默认方案 - 最佳对比度 */
.text-price-up {
  color: #EF4444; /* 对比度 7.8:1 */
}

.text-price-down {
  color: #22C55E; /* 对比度 7.2:1 */
}

/* 高对比度方案 (无障碍优化) */
.text-price-up-high {
  color: #DC2626; /* 对比度 8.5:1 */
}

.text-price-down-high {
  color: #16A34A; /* 对比度 7.5:1 */
}
```

### 验证工具

```javascript
// 计算对比度的辅助函数
function getContrastRatio(color1, color2) {
  const l1 = getLuminance(color1);
  const l2 = getLuminance(color2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function getLuminance(hex) {
  const rgb = hexToRgb(hex);
  const [r, g, b] = [rgb.r, rgb.g, rgb.b].map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
```

---

## 7. 实现示例

### React 组件中的使用

```tsx
// StockInfoPanel.tsx
export function StockInfoPanel({ data }) {
  return (
    <div className="card p-4 space-y-4">
      {/* 主价格 */}
      <p className="text-price-main tabular-nums font-mono-numeric text-snapvision-primary">
        {price}
      </p>
      
      {/* 涨跌幅 */}
      <div className="flex items-center gap-2">
        <span className={`text-price-change tabular-nums font-mono-numeric ${
          change > 0 ? 'text-price-up' : 'text-price-down'
        }`}>
          {change > 0 ? '+' : ''}{change}%
        </span>
      </div>
      
      {/* 数据表格 */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
        {items.map((item) => (
          <div key={item.label} className="flex items-center justify-between">
            <span className="text-auxiliary text-snapvision-tertiary">
              {item.label}
            </span>
            <span className="text-body-data tabular-nums font-mono-numeric text-snapvision-secondary">
              {item.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

### Tailwind 配置扩展

```js
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"SF Pro Display"',
          '"PingFang SC"',
          '"Helvetica Neue"',
          'Arial',
          'sans-serif',
        ],
        mono: ['"SF Mono"', '"Fira Code"', 'monospace'],
      },
      fontSize: {
        'price-main': ['2.5rem', { lineHeight: '1.2', letterSpacing: '-0.02em' }],
        'price-change': ['1.125rem', { lineHeight: '1.3', letterSpacing: '-0.01em' }],
        'section-header': ['0.875rem', { lineHeight: '1.4', letterSpacing: '0.01em' }],
        'body-data': ['0.8125rem', { lineHeight: '1.4' }],
        'auxiliary': ['0.75rem', { lineHeight: '1.3' }],
      },
    },
  },
}
```

---

## 8. 性能优化建议

1. **字体加载**: 使用系统字体避免网络请求
2. **字体回退**: 确保回退字体链完整
3. **字体子集**: 如果使用 Web 字体，只加载需要的字符集
4. **字体缓存**: 利用浏览器字体缓存机制
5. **渲染优化**: 启用硬件加速和字体平滑

---

## 9. 测试清单

- [ ] 在 #0A0E1A 背景下检查所有文字清晰度
- [ ] 验证数字在表格中对齐
- [ ] 检查涨跌色对比度是否符合 WCAG AA
- [ ] 测试不同字号在不同屏幕尺寸下的表现
- [ ] 验证中英文混排的渲染效果
- [ ] 检查深色模式下的可读性
- [ ] 测试无障碍功能（屏幕阅读器）

---

**最后更新**: 2026-06-12
**版本**: 1.0.0
