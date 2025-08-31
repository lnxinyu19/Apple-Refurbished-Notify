const NotificationProvider = require('./NotificationProvider');
const nodemailer = require('nodemailer');

class EmailNotificationProvider extends NotificationProvider {
  constructor() {
    super('email');
    this.transporter = null;
  }

  async initialize(config) {
    try {
      const validation = await this.validateConfig(config);
      if (!validation.isValid) {
        throw new Error(`Email配置無效: ${validation.errors.join(', ')}`);
      }

      this.transporter = nodemailer.createTransporter({
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.secure || false,
        auth: config.auth
      });

      // 測試連接
      await this.transporter.verify();

      this.enabled = true;
      this.fromEmail = config.auth.user;
      console.log('✅ Email 通知提供者已初始化');
      return true;
    } catch (error) {
      console.error('❌ Email 通知提供者初始化失敗:', error.message);
      this.enabled = false;
      return false;
    }
  }

  async validateConfig(config) {
    const errors = [];
    
    if (!config.smtp?.host) errors.push('缺少 SMTP host');
    if (!config.smtp?.port) errors.push('缺少 SMTP port');
    if (!config.auth?.user) errors.push('缺少 email 用戶名');
    if (!config.auth?.pass) errors.push('缺少 email 密碼');

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  async sendNotification(userEmail, message, metadata = {}) {
    if (!this.enabled || !this.transporter) {
      throw new Error('Email 通知提供者未初始化');
    }

    try {
      const subject = metadata.subject || '🍎 Apple 翻新機通知';
      
      const mailOptions = {
        from: this.fromEmail,
        to: userEmail,
        subject,
        text: message,
        html: this.formatHtmlMessage(message, metadata)
      };

      const result = await this.transporter.sendMail(mailOptions);

      console.log(`✅ Email 通知已發送給 ${userEmail}`);
      return {
        success: true,
        provider: 'email',
        userId: userEmail,
        messageId: result.messageId,
        sentAt: new Date().toISOString()
      };
    } catch (error) {
      console.error(`❌ Email 通知發送失敗 (${userEmail}):`, error.message);
      return {
        success: false,
        provider: 'email',
        userId: userEmail,
        error: error.message,
        sentAt: new Date().toISOString()
      };
    }
  }

  formatHtmlMessage(message, metadata) {
    const htmlMessage = message.replace(/\n/g, '<br>');
    
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #007AFF;">🍎 Apple 翻新機通知</h2>
        <div style="background: #f5f5f5; padding: 15px; border-radius: 8px;">
          ${htmlMessage}
        </div>
        <p style="color: #666; font-size: 12px; margin-top: 20px;">
          此通知由 Apple 翻新機追蹤系統自動發送
        </p>
      </div>
    `;
  }
}

module.exports = EmailNotificationProvider;