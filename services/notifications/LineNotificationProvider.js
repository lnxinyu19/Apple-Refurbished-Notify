const NotificationProvider = require('./NotificationProvider');
const line = require('@line/bot-sdk');

class LineNotificationProvider extends NotificationProvider {
  constructor() {
    super('line');
    this.client = null;
  }

  async initialize(config) {
    try {
      const validation = await this.validateConfig(config);
      if (!validation.isValid) {
        throw new Error(`LINE配置無效: ${validation.errors.join(', ')}`);
      }

      this.client = new line.messagingApi.MessagingApiClient({
        channelAccessToken: config.channelAccessToken
      });

      this.enabled = true;
      console.log('✅ LINE 通知提供者已初始化');
      return true;
    } catch (error) {
      console.error('❌ LINE 通知提供者初始化失敗:', error.message);
      this.enabled = false;
      return false;
    }
  }

  async validateConfig(config) {
    const errors = [];
    
    if (!config.channelAccessToken) {
      errors.push('缺少 channelAccessToken');
    }
    
    if (!config.channelSecret) {
      errors.push('缺少 channelSecret');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  async sendNotification(userId, message, metadata = {}) {
    if (!this.enabled || !this.client) {
      throw new Error('LINE 通知提供者未初始化');
    }

    try {
      await this.client.pushMessage({
        to: userId,
        messages: [{
          type: 'text',
          text: message
        }]
      });

      console.log(`✅ LINE 通知已發送給 ${userId}`);
      return {
        success: true,
        provider: 'line',
        userId,
        sentAt: new Date().toISOString()
      };
    } catch (error) {
      console.error(`❌ LINE 通知發送失敗 (${userId}):`, error.message);
      return {
        success: false,
        provider: 'line',
        userId,
        error: error.message,
        sentAt: new Date().toISOString()
      };
    }
  }

  // 專門用於回覆LINE訊息的方法
  async replyMessage(replyToken, message) {
    if (!this.enabled || !this.client) {
      throw new Error('LINE 通知提供者未初始化');
    }

    try {
      await this.client.replyMessage({
        replyToken,
        messages: [{
          type: 'text',
          text: message
        }]
      });

      console.log('✅ LINE 回覆訊息已發送');
      return true;
    } catch (error) {
      console.error('❌ LINE 回覆訊息失敗:', error.message);
      throw error;
    }
  }

  // 取得webhook middleware
  getWebhookMiddleware(channelSecret) {
    return line.middleware({ channelSecret });
  }
}

module.exports = LineNotificationProvider;