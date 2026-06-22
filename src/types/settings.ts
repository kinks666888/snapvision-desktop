/**
 * Settings Types — 自定义API配置类型定义
 */

/** 单个API端点配置 */
export interface ApiEndpointConfig {
  /** API名称 */
  name: string;
  /** API URL模板，支持 {code}, {period}, {count}, {keyword} 占位符 */
  url: string;
  /** HTTP方法 */
  method: 'GET' | 'POST';
  /** 自定义请求头 */
  headers?: Record<string, string>;
  /** 响应格式 */
  responseFormat: 'json' | 'text';
  /** 响应解析器类型 */
  parserType: 'tencent' | 'sina' | 'eastmoney' | 'custom';
}

/** 股票数据API配置 */
export interface StockApiConfig {
  /** 实时行情API */
  realtimeQuote: ApiEndpointConfig;
  /** K线数据API */
  klineData: ApiEndpointConfig;
  /** 股票搜索API */
  stockSearch: ApiEndpointConfig;
}

/** 内置API提供商 */
export type BuiltInProvider = 'tencent' | 'sina' | 'eastmoney';

/** API提供商配置 */
export interface ApiProvider {
  id: BuiltInProvider | 'custom';
  name: string;
  description: string;
  config: StockApiConfig;
}

/** 应用设置 */
export interface AppSettings {
  /** 当前选择的API提供商ID */
  apiProviderId: BuiltInProvider | 'custom';
  /** 自定义API配置 */
  customApi?: StockApiConfig;
  /** AI处理是否启用 */
  aiEnabled: boolean;
  /** 自动保存历史 */
  autoSaveHistory: boolean;
  /** 历史记录保留天数 (0 = 永久) */
  historyRetentionDays: number;
}

/** 默认内置API配置 */
export const BUILTIN_API_PROVIDERS: ApiProvider[] = [
  {
    id: 'tencent',
    name: '腾讯财经',
    description: '腾讯行情数据，稳定可靠',
    config: {
      realtimeQuote: {
        name: '腾讯实时行情',
        url: 'http://qt.gtimg.cn/q={code}',
        method: 'GET',
        responseFormat: 'text',
        parserType: 'tencent',
      },
      klineData: {
        name: '新浪K线数据',
        url: 'http://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol={code}&scale={scale}&datalen={count}&ma=no',
        method: 'GET',
        responseFormat: 'json',
        parserType: 'sina',
      },
      stockSearch: {
        name: '东方财富搜索',
        url: 'https://searchapi.eastmoney.com/api/suggest/get?input={keyword}&type=14&token=D43BF722C8E33BDC906FB84D85E326E8&count=10',
        method: 'GET',
        responseFormat: 'json',
        parserType: 'eastmoney',
      },
    },
  },
  {
    id: 'sina',
    name: '新浪财经',
    description: '新浪行情数据，经典数据源',
    config: {
      realtimeQuote: {
        name: '新浪实时行情',
        url: 'http://hq.sinajs.cn/list={code}',
        method: 'GET',
        headers: {
          'Referer': 'https://finance.sina.com.cn',
        },
        responseFormat: 'text',
        parserType: 'sina',
      },
      klineData: {
        name: '新浪K线数据',
        url: 'http://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol={code}&scale={scale}&datalen={count}&ma=no',
        method: 'GET',
        responseFormat: 'json',
        parserType: 'sina',
      },
      stockSearch: {
        name: '东方财富搜索',
        url: 'https://searchapi.eastmoney.com/api/suggest/get?input={keyword}&type=14&token=D43BF722C8E33BDC906FB84D85E326E8&count=10',
        method: 'GET',
        responseFormat: 'json',
        parserType: 'eastmoney',
      },
    },
  },
  {
    id: 'eastmoney',
    name: '东方财富',
    description: '东方财富数据，全面丰富',
    config: {
      realtimeQuote: {
        name: '东方财富实时行情',
        url: 'https://push2.eastmoney.com/api/qt/stock/get?secid={secid}&fields=f43,f44,f45,f46,f47,f48,f50,f51,f52,f55,f57,f58,f60,f116,f117,f162,f167,f168,f169,f170',
        method: 'GET',
        responseFormat: 'json',
        parserType: 'eastmoney',
      },
      klineData: {
        name: '东方财富K线',
        url: 'https://push2his.eastmoney.com/api/qt/stock/kline/get?secid={secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt={klt}&fqt=1&end=20500101&lmt={count}',
        method: 'GET',
        responseFormat: 'json',
        parserType: 'eastmoney',
      },
      stockSearch: {
        name: '东方财富搜索',
        url: 'https://searchapi.eastmoney.com/api/suggest/get?input={keyword}&type=14&token=D43BF722C8E33BDC906FB84D85E326E8&count=10',
        method: 'GET',
        responseFormat: 'json',
        parserType: 'eastmoney',
      },
    },
  },
];

/** 默认设置 */
export const DEFAULT_SETTINGS: AppSettings = {
  apiProviderId: 'tencent',
  aiEnabled: true,
  autoSaveHistory: true,
  historyRetentionDays: 0,
};
