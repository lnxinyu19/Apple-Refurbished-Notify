class NotificationProvider {
  constructor(name) {
    this.name = name;
    this.enabled = false;
  }

  async initialize(config) {
    throw new Error('initialize() must be implemented by subclass');
  }

  async sendNotification(userId, message, metadata = {}) {
    throw new Error('sendNotification() must be implemented by subclass');
  }

  async validateConfig(config) {
    throw new Error('validateConfig() must be implemented by subclass');
  }

  isEnabled() {
    return this.enabled;
  }

  getName() {
    return this.name;
  }
}

module.exports = NotificationProvider;