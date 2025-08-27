# Apple 整修機產品追蹤器

這是一個用來追蹤 Apple 台灣官網整修機產品的程式，支援自訂追蹤條件和通知功能。

## 安裝依賴

```bash
npm install
```

## 快速開始

### 方法一：互動式設定 (推薦)
```bash
npm run setup
```
跟隨互動式介面逐步設定您的追蹤條件

### 方法二：手動設定
1. 複製配置範例：`cp config.example.json config.json`
2. 編輯 `config.json` 設定追蹤條件
3. 驗證配置：`npm run config:validate`

### 開始追蹤
```bash
npm run track
```

## 使用方式

### 主要功能
```bash
npm run setup           # 🎯 互動式設定追蹤條件 (推薦)
npm run track           # 🔍 執行產品追蹤
```

### 配置管理
```bash
npm run config:validate  # ✅ 驗證配置檔案
npm run config:status    # 📊 查看配置狀態  
npm run config:list      # 📋 列出所有追蹤規則
```

### 其他功能
```bash
npm start               # 基本爬取（不使用配置）
npm run filter          # 篩選功能示例
```

## 功能

- **🎯 智慧追蹤**: 根據自訂條件追蹤特定產品
- **⚙️ 靈活配置**: 支援多個追蹤規則，每個規則可獨立啟用/停用
- **🔍 精準篩選**: 支援多條件篩選產品
  - 產品類型 (MacBook Air, MacBook Pro, Mac Studio, Mac mini)
  - 晶片類型 (M2, M3, M4, M4 Pro, M4 Max, M4 Ultra)
  - 最小記憶體容量
  - 最小儲存容量
  - 顏色 (銀色, 太空灰色, 太空黑色, 星光色, 午夜色, 天藍色)
  - 最高價格限制
- **📱 通知系統**: 發現新產品時自動通知 (支援控制台、Email、Webhook)
- **📊 結果記錄**: 自動儲存追蹤結果和歷史記錄
- **🛠️ 配置管理**: 完整的配置檔案管理工具

## 配置檔案說明

配置檔案 `config.json` 採用 JSON 格式，包含追蹤規則和通知設定。

### 追蹤規則範例

```json
{
  "trackingRules": [
    {
      "name": "我想要的MacBook Pro",
      "description": "M4 Pro晶片，至少16GB記憶體，太空黑色",
      "enabled": true,
      "filters": {
        "productType": "MacBook Pro",
        "chip": "M4 Pro",
        "minMemory": 16,
        "color": "太空黑色",
        "maxPrice": 80000
      }
    },
    {
      "name": "便宜的MacBook Air",
      "description": "任何顏色的MacBook Air M4，價格在50,000以下",
      "enabled": true,
      "filters": {
        "productType": "MacBook Air",
        "chip": "M4",
        "maxPrice": 50000
      }
    }
  ]
}
```

### 篩選條件說明

| 欄位 | 說明 | 範例值 |
|------|------|---------|
| `productType` | 產品類型 | `"MacBook Air"`, `"MacBook Pro"`, `"Mac Studio"`, `"Mac mini"` |
| `chip` | 晶片類型 | `"M2"`, `"M3"`, `"M4"`, `"M4 Pro"`, `"M4 Max"`, `"M4 Ultra"` |
| `minMemory` | 最小記憶體 (GB) | `8`, `16`, `32`, `64`, `128` |
| `minStorage` | 最小儲存空間 | `"256GB"`, `"512GB"`, `"1TB"`, `"2TB"` |
| `color` | 顏色 | `"銀色"`, `"太空灰色"`, `"太空黑色"`, `"星光色"`, `"午夜色"`, `"天藍色"` |
| `maxPrice` | 最高價格 (TWD) | `50000`, `80000`, `150000` |

## 產出檔案

- `config.json` - 使用者配置檔案 (追蹤規則、通知設定)
- `config.example.json` - 配置範例檔案
- `mac-products.json` - 完整的產品資料 (基本爬取模式)
- `tracking-results-YYYY-MM-DD-*.json` - 追蹤結果記錄

## 檔案結構

```
apple-refurbished-notify/
├── config.example.json    # 配置範例檔案
├── config.json           # 使用者配置檔案 (需自行建立)
├── index.js              # 基本爬蟲程式
├── track.js              # 產品追蹤主程式
├── product-tracker.js    # 追蹤器核心
├── config-manager.js     # 配置管理器
├── config-tool.js        # 配置管理工具
├── filter-example.js     # 篩選功能示例
└── README.md
```

## 技術特點

- **智慧解析**: 使用 Puppeteer 處理動態 JavaScript 載入的內容
- **結構化資料**: 解析 JSON-LD 結構化資料獲取準確資訊
- **編碼處理**: 自動處理網頁中的特殊字符編碼問題
- **靈活篩選**: 支援多條件組合的產品篩選
- **配置驗證**: 完整的配置檔案驗證和錯誤處理
- **結果追蹤**: 智慧比對新舊結果，只通知新發現的產品

## 使用場景

1. **特定需求追蹤**: 設定理想的產品配置條件，等待符合的整修機上架
2. **價格監控**: 監控特定產品的價格變化
3. **庫存提醒**: 及時發現稀有配置的整修機
4. **多條件比較**: 同時追蹤多種不同的產品組合

## 注意事項

- **首次執行**: Puppeteer 會下載 Chrome 瀏覽器，請耐心等待
- **配置檔案**: 請勿將 `config.json` 提交到版本控制，以保護個人追蹤偏好
- **執行頻率**: 建議不要過於頻繁執行爬蟲，以免對 Apple 服務器造成負擔
- **資料準確性**: 所有資料來自 Apple 官網，但請以官網實際資訊為準
