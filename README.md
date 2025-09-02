# Apple 整修機產品追蹤器

## 什麼是 Apple 整修機？

Apple 整修機是蘋果官方翻新的二手產品，有以下特色：
- 比新品便宜 10-15%
- 提供一年保固
- 品質接近新品
- 但是很難買到，經常缺貨

## 這個工具做什麼？

自動監控 Apple 台灣官網的整修機產品，當有符合你條件的新產品上架時，透過 LINE 通知。

不用再手動刷網頁了

## 快速開始

### 1. 安裝並啟動
```bash
npm install
npm start
```

### 2. 設定追蹤條件
開啟 http://applerefurbishednotify.zeabur.app 網頁設定

### 3. 設定通知
- LINE Bot 通知：參考 `LINE_SETUP.md`
- Email 通知：參考 `FIREBASE_SETUP.md`

## 功能

- 自動監控整修機產品
- 支援多種篩選條件（產品類型、晶片、記憶體、顏色、價格等）
- LINE Bot 和 Email 通知
- 網頁管理界面
- 只通知真正的新產品

## 支援的產品

MacBook Air, MacBook Pro, Mac Studio, Mac mini, iPad

## 支援的篩選條件

- 產品類型
- 晶片類型 (M2, M3, M4, M4 Pro, M4 Max, M4 Ultra)
- 最小記憶體
- 最小儲存空間
- 顏色
- 最高價格

## 注意事項

- 首次執行會下載瀏覽器
- 建議不要太頻繁執行
- 請以 Apple 官網資訊為準