# Firebase 設定指南

## 1. 建立 Firebase 專案

1. 前往 [Firebase Console](https://console.firebase.google.com/)
2. 點選「建立專案」
3. 輸入專案名稱（例如：apple-refurbished-tracker）
4. 選擇是否啟用 Google Analytics
5. 建立專案

## 2. 設定 Firestore Database

1. 在 Firebase Console 中選擇你的專案
2. 點選左側選單的「Firestore Database」
3. 點選「建立資料庫」
4. 選擇「以測試模式啟動」（之後可以調整安全規則）
5. 選擇資料庫位置（建議選擇 asia-east1）

## 3. 建立服務帳戶

1. 前往「專案設定」（齒輪圖示）
2. 點選「服務帳戶」tab
3. 點選「產生新的私密金鑰」
4. 下載 JSON 檔案並重新命名為 `firebase-service-account.json`
5. 將檔案放在專案根目錄
6. 在 `.gitignore` 中加入此檔案避免上傳

## 4. 設定環境變數

創建 `.env` 檔案：
```
FIREBASE_SERVICE_ACCOUNT_KEY=./firebase-service-account.json
LINE_CHANNEL_ACCESS_TOKEN=你的LINE_token
LINE_CHANNEL_SECRET=你的LINE_secret
```

## 5. Firestore 資料結構

```
users/
  {lineUserId}/
    - lineUserId: string
    - createdAt: timestamp
    - isActive: boolean
    - settings: object
    
    trackingRules/
      {ruleId}/
        - name: string
        - filters: object
        - enabled: boolean
        - createdAt: timestamp

products/
  {productId}/
    - name: string
    - price: string
    - url: string
    - specs: object
    - lastSeen: timestamp

notifications/
  {notificationId}/
    - userId: string
    - message: string
    - productIds: array
    - sentAt: timestamp
```

## 6. 安全規則建議

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // 用戶只能讀寫自己的資料
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
      
      match /trackingRules/{ruleId} {
        allow read, write: if request.auth != null && request.auth.uid == userId;
      }
    }
    
    // 產品資料所有人都可讀，只有伺服器可寫
    match /products/{productId} {
      allow read: if true;
      allow write: if false; // 只允許伺服器寫入
    }
    
    // 通知記錄只有擁有者可讀
    match /notifications/{notificationId} {
      allow read: if request.auth != null && request.auth.uid == resource.data.userId;
      allow write: if false; // 只允許伺服器寫入
    }
  }
}
```

## 7. 測試連接

啟動應用後，系統會自動連接Firebase。查看控制台是否出現：
```
✅ Firebase 已初始化
```