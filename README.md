# Apple 整修機產品爬蟲

這是一個用來爬取 Apple 台灣官網整修機產品資訊的程式，支援產品篩選功能。

## 安裝依賴

```bash
npm install
```

## 使用方式

### 基本爬取
```bash
npm start
```

### 篩選功能示例
```bash
node filter-example.js
```

## 功能

- **產品爬取**: 爬取 Apple 台灣整修機 Mac 產品資訊
- **規格解析**: 自動解析產品名稱、價格、晶片、記憶體、儲存、顏色等規格
- **產品篩選**: 支援多條件篩選產品
  - 產品類型 (MacBook Air, MacBook Pro, Mac Studio, Mac mini)
  - 晶片類型 (M2, M3, M4, M4 Pro, M4 Max, M4 Ultra)
  - 最小記憶體容量
  - 最小儲存容量
  - 顏色 (銀色, 太空灰色, 太空黑色, 星光色, 午夜色, 天藍色)
  - 最高價格限制
- **資料儲存**: 將資料儲存為結構化的 JSON 檔案

## 篩選功能範例

```javascript
const scraper = new AppleRefurbishedScraper();

// 篩選 MacBook Air M4 晶片
const filter1 = {
  productType: 'MacBook Air',
  chip: 'M4'
};
const results = scraper.filterProducts(products, filter1);

// 篩選記憶體至少16GB的MacBook Pro
const filter2 = {
  productType: 'MacBook Pro',
  minMemory: 16
};

// 篩選儲存至少1TB、價格50,000以下
const filter3 = {
  minStorage: '1TB',
  maxPrice: 50000
};
```

## 產出檔案

- `mac-products.json` - Mac 產品資料，包含完整的規格解析

## 支援的產品規格

- 產品類型: MacBook Air, MacBook Pro, Mac Studio, Mac mini
- 晶片: M2, M3, M4 系列 (包含 Pro, Max, Ultra 版本)
- 記憶體: 8GB - 128GB
- 儲存: 256GB - 數TB
- 顏色: 多種 Apple 官方顏色

## 技術特點

- 使用 Puppeteer 處理動態 JavaScript 載入的內容
- 解析 JSON-LD 結構化資料
- 自動處理網頁中的特殊字符編碼問題
- 支援靈活的產品篩選條件組合

## 注意事項

第一次執行時，Puppeteer 會下載 Chrome 瀏覽器，請耐心等待。# Apple-Refurbished-Notify
