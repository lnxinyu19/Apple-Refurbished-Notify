const admin = require('firebase-admin');

class FirebaseService {
  constructor() {
    this.db = null;
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return true;

    try {
      let serviceAccount;
      
      // 優先使用環境變數
      if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      } else if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
        serviceAccount = {
          type: "service_account",
          project_id: process.env.FIREBASE_PROJECT_ID,
          private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
          client_email: process.env.FIREBASE_CLIENT_EMAIL
        };
      } else {
        // 回退到本地文件
        serviceAccount = require('../firebase-service-account.json');
      }
      
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id
      });

      this.db = admin.firestore();
      
      // 測試連接
      await this.db.collection('_test').doc('connection').set({ 
        timestamp: admin.firestore.FieldValue.serverTimestamp() 
      });
      await this.db.collection('_test').doc('connection').delete();
      
      this.initialized = true;
      console.log('✅ Firebase 已初始化並測試連接成功');
      return true;
    } catch (error) {
      console.error('❌ Firebase 初始化失敗:', error.message);
      console.error('⚠️  系統將以離線模式運行');
      this.initialized = false;
      return false;
    }
  }

  // 用戶管理
  async getUser(lineUserId) {
    const userRef = this.db.collection('users').doc(lineUserId);
    const doc = await userRef.get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
  }

  async createUser(lineUserId) {
    const userData = {
      lineUserId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      isActive: true,
      settings: {
        notifications: {
          line: true,
          email: false
        }
      }
    };

    await this.db.collection('users').doc(lineUserId).set(userData);
    return userData;
  }

  async getOrCreateUser(lineUserId) {
    let user = await this.getUser(lineUserId);
    if (!user) {
      user = await this.createUser(lineUserId);
    }
    return user;
  }

  async updateUserNotificationSettings(lineUserId, notificationSettings) {
    const userRef = this.db.collection('users').doc(lineUserId);
    await userRef.update({
      'settings.notifications': notificationSettings,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }

  async updateUserEmail(lineUserId, email) {
    const userRef = this.db.collection('users').doc(lineUserId);
    await userRef.update({
      email,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }

  // 追蹤規則管理
  async getUserTrackingRules(lineUserId) {
    const rulesRef = this.db.collection('users').doc(lineUserId).collection('trackingRules');
    const snapshot = await rulesRef.where('enabled', '==', true).get();
    
    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
  }

  async addTrackingRule(lineUserId, rule) {
    const ruleData = {
      ...rule,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    const docRef = await this.db.collection('users').doc(lineUserId).collection('trackingRules').add(ruleData);
    return docRef.id;
  }

  async updateTrackingRule(lineUserId, ruleId, updates) {
    const updateData = {
      ...updates,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await this.db.collection('users').doc(lineUserId).collection('trackingRules').doc(ruleId).update(updateData);
  }

  async deleteTrackingRule(lineUserId, ruleId) {
    await this.db.collection('users').doc(lineUserId).collection('trackingRules').doc(ruleId).delete();
  }

  // 產品歷史管理
  async getProductHistory() {
    const snapshot = await this.db.collection('products').get();
    const products = new Map();
    
    snapshot.docs.forEach(doc => {
      const data = doc.data();
      // 使用產品基礎 URL 作為 key
      const productKey = this.getProductKey(data.url);
      products.set(productKey, data);
    });
    
    return products;
  }

  async saveProductHistory(products) {
    const batch = this.db.batch();
    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    
    products.forEach(product => {
      // 使用產品基礎 URL 作為文檔 ID
      const productKey = this.getProductKey(product.url);
      const productRef = this.db.collection('products').doc(this.getProductId(productKey));
      batch.set(productRef, {
        ...product,
        productKey: productKey, // 額外儲存產品基礎 URL
        lastSeen: timestamp,
        updatedAt: timestamp
      }, { merge: true });
    });
    
    await batch.commit();
  }

  // 獲取產品的唯一標識符（移除 URL 中的動態參數）
  getProductKey(url) {
    return url.split('?')[0]; // 移除查詢參數，只保留基礎 URL
  }

  getProductId(url) {
    return url.split('/').pop().replace(/[^a-zA-Z0-9]/g, '_');
  }

  // 通知歷史
  async saveNotification(lineUserId, message, productIds = []) {
    const notificationData = {
      userId: lineUserId,
      message,
      productIds,
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      status: 'sent'
    };

    const docRef = await this.db.collection('notifications').add(notificationData);
    return docRef.id;
  }

  // 獲取所有活躍用戶
  async getActiveUsers() {
    const snapshot = await this.db.collection('users').where('isActive', '==', true).get();
    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
  }

  // 統計資料
  async getSystemStats() {
    try {
      const usersSnapshot = await this.db.collection('users').get();
      
      // 簡化規則查詢 - 避免collectionGroup
      let totalActiveRules = 0;
      for (const userDoc of usersSnapshot.docs) {
        try {
          const rulesSnapshot = await userDoc.ref.collection('trackingRules').where('enabled', '==', true).get();
          totalActiveRules += rulesSnapshot.size;
        } catch (error) {
          // 靜默跳過錯誤
        }
      }
      
      // 簡化通知查詢
      let notificationsCount = 0;
      try {
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const notificationsSnapshot = await this.db.collection('notifications')
          .where('sentAt', '>=', admin.firestore.Timestamp.fromDate(yesterday))
          .get();
        notificationsCount = notificationsSnapshot.size;
      } catch (error) {
        // 靜默跳過錯誤
      }

      return {
        totalUsers: usersSnapshot.size,
        activeRules: totalActiveRules,
        notificationsLast24h: notificationsCount
      };
    } catch (error) {
      console.error('取得統計資料錯誤:', error.message);
      return {
        totalUsers: 0,
        activeRules: 0,
        notificationsLast24h: 0
      };
    }
  }
}

module.exports = FirebaseService;