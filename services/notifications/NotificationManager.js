const LineNotificationProvider = require('./LineNotificationProvider');
const EmailNotificationProvider = require('./EmailNotificationProvider');

class NotificationManager {
  constructor() {
    this.providers = new Map();
    this.activeProviders = [];
  }

  async initialize(config) {
    // 註冊所有可用的通知提供者
    this.registerProvider('line', new LineNotificationProvider());
    this.registerProvider('email', new EmailNotificationProvider());

    // 初始化已啟用的提供者
    this.activeProviders = [];
    
    for (const [name, provider] of this.providers) {
      const providerConfig = config[name];
      if (providerConfig && providerConfig.enabled !== false) {
        try {
          const success = await provider.initialize(providerConfig);
          if (success) {
            this.activeProviders.push(provider);
          }
        } catch (error) {
          console.error(`❌ ${name} 通知提供者初始化失敗:`, error.message);
        }
      }
    }
  }

  registerProvider(name, provider) {
    this.providers.set(name, provider);
  }

  getProvider(name) {
    return this.providers.get(name);
  }

  async sendNotification(user, message, metadata = {}) {
    const results = [];
    
    // 根據用戶偏好發送通知
    const userPreferences = user.settings?.notifications || { line: true };
    
    for (const provider of this.activeProviders) {
      const providerName = provider.getName();
      
      // 檢查用戶是否啟用此通知方式
      if (userPreferences[providerName] === false) {
        continue;
      }

      try {
        let userId;
        
        // 根據不同提供者取得對應的用戶ID
        switch (providerName) {
          case 'line':
            userId = user.lineUserId;
            break;
          case 'email':
            userId = user.email;
            break;
          default:
            console.warn(`未知的通知提供者: ${providerName}`);
            continue;
        }

        if (!userId) {
          console.warn(`用戶 ${user.lineUserId} 沒有 ${providerName} 聯絡資訊`);
          continue;
        }

        const result = await provider.sendNotification(userId, message, metadata);
        results.push(result);
        
      } catch (error) {
        console.error(`${providerName} 通知發送錯誤:`, error.message);
        results.push({
          success: false,
          provider: providerName,
          userId: user.lineUserId,
          error: error.message,
          sentAt: new Date().toISOString()
        });
      }
    }

    return results;
  }

  async sendNotificationToAll(users, message, metadata = {}) {
    const allResults = [];
    
    for (const user of users) {
      try {
        const results = await this.sendNotification(user, message, metadata);
        allResults.push(...results);
      } catch (error) {
        // 靜默跳過錯誤
      }
    }

    // 統計結果
    const successCount = allResults.filter(r => r.success).length;
    const failCount = allResults.filter(r => !r.success).length;
    
    return {
      total: allResults.length,
      success: successCount,
      failed: failCount,
      results: allResults
    };
  }

  // 獲取所有啟用的提供者名稱
  getActiveProviderNames() {
    return this.activeProviders.map(p => p.getName());
  }

  // 檢查特定提供者是否啟用
  isProviderActive(name) {
    return this.activeProviders.some(p => p.getName() === name);
  }
}

module.exports = NotificationManager;