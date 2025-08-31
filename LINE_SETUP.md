# LINE Messaging API 設定指南

## 1. 建立 LINE Bot

1. 前往 [LINE Developers Console](https://developers.line.biz/console/)
2. 登入你的LINE帳號
3. 建立一個新的Provider（如果還沒有的話）
4. 建立新的Channel，選擇 "Messaging API"
5. 填寫必要資訊（Channel name, description等）

## 2. 取得必要的Token和ID

### Channel Access Token
1. 在你的Channel設定頁面
2. 點選 "Messaging API" tab
3. 在 "Channel access token" 區域點選 "Issue"
4. 複製產生的token

### Channel Secret
1. 在Channel設定頁面的 "Basic settings" tab
2. 找到 "Channel secret" 區域
3. 複製Channel secret

### 設定Webhook URL
1. 在 "Messaging API" tab找到 "Webhook settings"
2. 設定Webhook URL: `https://你的網域/webhook/line`
3. 如果是本地測試，可以使用ngrok等工具建立tunnel
4. 啟用 "Use webhook"

### 自動取得User ID
現在不需要手動取得User ID了！當使用者：
1. 加LINE Bot為好友
2. 傳送任何訊息給Bot
3. 系統會自動註冊該使用者並記錄User ID

## 3. 設定你的config.json

```json
{
  "trackingRules": [...],
  "lineConfig": {
    "channelAccessToken": "你的_CHANNEL_ACCESS_TOKEN",
    "channelSecret": "你的_CHANNEL_SECRET"
  },
  "users": []
}
```

## 4. 使用LINE Bot指令

加Bot為好友後，可使用以下指令：

- **開始追蹤** - 開始監控新品
- **停止追蹤** - 停止監控  
- **狀態** - 查看系統狀態
- **測試** - 測試連接
- **幫助** - 查看指令列表

## 5. 測試設定

1. 啟動應用：`npm start`
2. 設定ngrok tunnel（如果本地測試）
3. 在LINE Developers設定webhook URL
4. 加Bot好友並傳送「測試」

## 注意事項

- 需要公開URL才能接收webhook
- 本地開發建議使用ngrok
- 免費帳號每月500則訊息額度
- 所有加Bot好友的用戶都會自動註冊