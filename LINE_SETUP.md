# LINE Messaging API 與 LIFF 設定指南

## 1. 建立 LINE Bot

1. 前往 [LINE Developers Console](https://developers.line.biz/console/)
2. 登入你的LINE帳號
3. 建立一個新的Provider（如果還沒有的話）
4. 建立新的Channel，選擇 "Messaging API"
5. 填寫必要資訊（Channel name, description等）

## 2. 建立 LINE Login Channel（用於網頁登入）

1. 在同一個Provider下，建立新的Channel，選擇 "LINE Login"
2. 填寫必要資訊（Channel name, description等）
3. 在 "LINE Login" tab 設定：
   - App types: Web app
   - Callback URL: `http://localhost:3000/auth/line/callback` (本地開發)
   - 生產環境: `https://你的網域/auth/line/callback`
   - Scopes: profile, openid

## 3. 建立 LIFF 應用（用於 LINE 應用內使用）

1. 在 LINE Login Channel 中，點選 "LIFF" tab
2. 點選 "Add" 建立新的LIFF app
3. 設定：
   - LIFF app name: Apple 整修機設定
   - Size: Full
   - Endpoint URL: https://你的網域/ （你的網頁位址）
   - Scope: profile
   - Bot link feature: On（連結到你的Messaging API bot）

## 4. 取得必要的Token和ID

### Channel Access Token
1. 在你的Messaging API Channel設定頁面
2. 點選 "Messaging API" tab
3. 在 "Channel access token" 區域點選 "Issue"
4. 複製產生的token

### Channel Secret
1. 在Messaging API Channel設定頁面的 "Basic settings" tab
2. 找到 "Channel secret" 區域
3. 複製Channel secret

### LINE Login Channel ID
1. 在你的 LINE Login Channel 設定頁面
2. 點選 "Basic settings" tab  
3. 複製 "Channel ID"

### LIFF ID
1. 在 LINE Login Channel 的 "LIFF" tab中
2. 複製你建立的LIFF app的 "LIFF ID"
3. 格式類似：1234567890-AbCdEfGh

### 設定Webhook URL
1. 在 "Messaging API" tab找到 "Webhook settings"
2. 設定Webhook URL: `https://你的網域/webhook/line`
3. 如果是本地測試，可以使用ngrok等工具建立tunnel
4. 啟用 "Use webhook"

## 5. 設定環境變數

建立 `.env` 檔案或設定以下環境變數：

```env
# LINE Bot 設定 (Messaging API Channel)
LINE_CHANNEL_ACCESS_TOKEN=你的_CHANNEL_ACCESS_TOKEN
LINE_CHANNEL_SECRET=你的_CHANNEL_SECRET

# LINE Login 設定（用於網頁登入）
LINE_LOGIN_CHANNEL_ID=你的_LINE_LOGIN_CHANNEL_ID
LINE_LOGIN_REDIRECT_URI=http://localhost:3000/auth/line/callback

# LIFF 設定（用於 LINE 應用內使用）
LINE_LIFF_ID=1234567890-AbCdEfGh

# 其他設定
WEB_URL=https://你的網域
```

### 自動取得User ID
現在不需要手動取得User ID了！當使用者：
1. 加LINE Bot為好友
2. 傳送任何訊息給Bot
3. 系統會自動註冊該使用者並記錄User ID

## 6. 使用LINE Bot指令

加Bot為好友後，可使用以下指令：

- **開始追蹤** - 開始監控新品
- **停止追蹤** - 停止監控  
- **狀態** - 查看系統狀態
- **我的規則** - 查看個人追蹤規則
- **新增規則** - 開啟LIFF網頁設定個人規則
- **測試** - 測試連接
- **幫助** - 查看指令列表

## 7. 網頁登入功能

現在支援兩種登入方式：

### 電腦瀏覽器 - LINE Login API
1. 開啟網頁 http://localhost:3000
2. 點擊「透過 LINE 登入」按鈕
3. 跳轉到 LINE 官方登入頁面
4. 登入成功後自動回到網站
5. 可以設定個人追蹤規則

### 手機 LINE 應用內 - LIFF

設定好LIFF後，使用者可以：
1. 在LINE中輸入「新增規則」
2. Bot會提供LIFF網頁連結
3. 點選連結開啟網頁，自動識別身份
4. 設定個人化的追蹤規則（產品類型、晶片、記憶體等）
5. 規則會自動儲存到該使用者帳號

## 8. 測試設定

1. 啟動應用：`npm start`
2. 設定ngrok tunnel（如果本地測試）
3. 在LINE Developers設定webhook URL和LIFF URL
4. 加Bot好友並傳送「測試」
5. 測試LIFF：傳送「新增規則」並點選連結

## 注意事項

- 需要公開URL才能接收webhook和LIFF
- 本地開發建議使用ngrok
- 免費帳號每月500則訊息額度
- 所有加Bot好友的用戶都會自動註冊
- LIFF需要HTTPS連線才能正常運作