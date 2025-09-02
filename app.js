require('dotenv').config();
const express = require('express');
const puppeteer = require('puppeteer');
const path = require('path');
const { exec } = require('child_process');
const line = require('@line/bot-sdk');
const FirebaseService = require('./services/firebase');
const NotificationManager = require('./services/notifications/NotificationManager');

class AppleTracker {
  constructor() {
    this.app = express();
    this.port = process.env.PORT || 3000;
    this.browser = null;
    this.config = { lineConfig: {} };
    this.isTracking = false;
    this.trackingInterval = null;
    this.firebaseService = new FirebaseService();
    this.notificationManager = new NotificationManager();
    
    this.setupServer();
  }

  setupServer() {
    this.app.use(express.static('public'));
    this.app.use(express.json());

    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });


    // LIFF 設定端點
    this.app.get('/api/liff-config', (req, res) => {
      res.json({ 
        liffId: process.env.LINE_LIFF_ID || null 
      });
    });

    // LINE Login 設定端點
    this.app.get('/api/line-login-config', (req, res) => {
      res.json({ 
        channelId: process.env.LINE_LOGIN_CHANNEL_ID || null,
        redirectUri: process.env.LINE_LOGIN_REDIRECT_URI || null
      });
    });

    // LINE Login 授權端點
    this.app.get('/auth/line', (req, res) => {
      const channelId = process.env.LINE_LOGIN_CHANNEL_ID;
      const redirectUri = encodeURIComponent(process.env.LINE_LOGIN_REDIRECT_URI);
      const state = Math.random().toString(36).substring(2, 15);
      
      // 將 state 存在 session 中 (簡單實作，生產環境建議使用 Redis)
      req.session = { ...req.session, lineLoginState: state };
      
      const authUrl = `https://access.line.me/oauth2/v2.1/authorize?response_type=code&client_id=${channelId}&redirect_uri=${redirectUri}&state=${state}&scope=profile%20openid`;
      
      res.redirect(authUrl);
    });

    // LINE Login 回調端點
    this.app.get('/auth/line/callback', async (req, res) => {
      try {
        const { code, state } = req.query;
        
        if (!code) {
          return res.redirect('/?error=no_code');
        }

        // 獲取 access token
        const tokenResponse = await fetch('https://api.line.me/oauth2/v2.1/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: process.env.LINE_LOGIN_REDIRECT_URI,
            client_id: process.env.LINE_LOGIN_CHANNEL_ID,
            client_secret: process.env.LINE_CHANNEL_SECRET,
          }),
        });

        const tokenData = await tokenResponse.json();
        
        if (tokenData.error) {
          return res.redirect(`/?error=${tokenData.error}`);
        }

        // 獲取用戶資訊
        const profileResponse = await fetch('https://api.line.me/v2/profile', {
          headers: {
            Authorization: `Bearer ${tokenData.access_token}`,
          },
        });

        const profile = await profileResponse.json();
        
        if (profile.error) {
          return res.redirect(`/?error=profile_error`);
        }

        // 確保用戶在 Firebase 中存在
        if (this.firebaseService.initialized) {
          await this.firebaseService.getOrCreateUser(profile.userId);
        }

        // 重定向到前端，帶上用戶資訊
        const userInfo = encodeURIComponent(JSON.stringify({
          userId: profile.userId,
          displayName: profile.displayName,
          pictureUrl: profile.pictureUrl,
          loginMethod: 'line-login'
        }));
        
        res.redirect(`/?user=${userInfo}`);
        
      } catch (error) {
        console.error('LINE Login 回調錯誤:', error);
        res.redirect('/?error=callback_error');
      }
    });

    // 用戶專屬配置 API
    this.app.get('/api/users/:userId/config', async (req, res) => {
      try {
        const userId = req.params.userId;
        if (!this.firebaseService.initialized) {
          return res.json({ trackingRules: [] });
        }

        const rules = await this.firebaseService.getUserTrackingRules(userId);
        res.json({ trackingRules: rules });
      } catch (error) {
        console.error('取得用戶配置錯誤:', error);
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/api/users/:userId/config', async (req, res) => {
      try {
        const userId = req.params.userId;
        const { trackingRules } = req.body;

        if (!this.firebaseService.initialized) {
          return res.status(503).json({ error: 'Firebase 未連接' });
        }

        // 確保用戶存在
        await this.firebaseService.getOrCreateUser(userId);

        // 清除現有規則並重新建立
        const existingRules = await this.firebaseService.getUserTrackingRules(userId);
        for (const rule of existingRules) {
          await this.firebaseService.deleteTrackingRule(userId, rule.id);
        }

        // 新增新規則
        for (const rule of trackingRules) {
          await this.firebaseService.addTrackingRule(userId, rule);
        }

        res.json({ success: true, message: '配置已儲存' });
      } catch (error) {
        console.error('儲存用戶配置錯誤:', error);
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/api/track/start', async (req, res) => {
      try {
        if (this.isTracking) {
          return res.json({ error: '已在追蹤中' });
        }
        
        await this.startTracking();
        res.json({ success: true, message: '開始追蹤' });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/api/track/stop', (req, res) => {
      this.stopTracking();
      res.json({ success: true, message: '停止追蹤' });
    });

    this.app.get('/api/track/status', async (req, res) => {
      const stats = await this.firebaseService.getSystemStats();
      res.json({ 
        isTracking: this.isTracking,
        rulesCount: stats.activeRules,
        usersCount: stats.totalUsers
      });
    });

    this.app.get('/api/products/test', async (req, res) => {
      try {
        const allProducts = await this.scrapeProducts();
        
        res.json({
          message: `找到 ${allProducts.length} 個產品`,
          total: allProducts.length,
          products: allProducts
        });
        
      } catch (error) {
        console.error('測試產品爬取錯誤:', error);
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/webhook/line', express.json(), async (req, res) => {
      try {
        
        if (!req.body.events || req.body.events.length === 0) {
          return res.status(200).json([]);
        }
        
        const results = await Promise.all(req.body.events.map(this.handleLineEvent.bind(this)));
        res.status(200).json(results);
        
      } catch (error) {
        console.error('❌ LINE webhook錯誤:', error.message);
        res.status(200).json([]);
      }
    });

  }

  async init() {
    await this.loadConfig();
    
    const firebaseReady = await this.firebaseService.initialize();
    
    await this.notificationManager.initialize({
      line: this.config.lineConfig,
      email: this.config.emailConfig || { enabled: false }
    });
    
    this.browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });


    console.log('🚀 Apple 整修機追蹤器已初始化');
    if (!firebaseReady) {
      console.log('⚠️  注意：Firebase未連接，部分功能可能無法使用');
    }
  }


  async loadConfig() {
    this.config = {
      lineConfig: {
        channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
        channelSecret: process.env.LINE_CHANNEL_SECRET || ''
      }
    };
  }



  async detectNewProducts(currentProducts) {
    try {
      if (!this.firebaseService.initialized) {
        return [];
      }

      const previousProducts = await this.firebaseService.getProductHistory();
      const newProducts = [];
      
      for (const product of currentProducts) {
        // 使用產品基礎 URL（移除 fnode 參數）來比較
        const productKey = this.getProductKey(product.url);
        if (!previousProducts.has(productKey)) {
          newProducts.push(product);
        }
      }
      
      return newProducts;
      
    } catch (error) {
      console.error('❌ 新產品檢測失敗:', error.message);
      return [];
    }
  }

  // 獲取產品的唯一標識符（移除 URL 中的動態參數）
  getProductKey(url) {
    return url.split('?')[0]; // 移除查詢參數，只保留基礎 URL
  }

  async notifyAllUsers(message, productIds = []) {
    const activeUsers = await this.firebaseService.getActiveUsers();
    
    const results = await this.notificationManager.sendNotificationToAll(
      activeUsers, 
      message, 
      { productIds }
    );

    for (const result of results.results) {
      if (result.success) {
        await this.firebaseService.saveNotification(
          result.userId, 
          message, 
          productIds
        );
      }
    }

    return results;
  }

  async formatNewProductMessage(newProducts) {
    if (newProducts.length === 0) return null;
    
    return await this.createBatchMessages(newProducts);
  }

  async createBatchMessages(newProducts) {
    const messages = [];
    const productsPerMessage = 10;
    
    for (let i = 0; i < newProducts.length; i += productsPerMessage) {
      const batch = newProducts.slice(i, i + productsPerMessage);
      const batchNumber = Math.floor(i / productsPerMessage) + 1;
      const totalBatches = Math.ceil(newProducts.length / productsPerMessage);
      
      let message;
      if (i === 0) {
        message = `🆕 發現 ${newProducts.length} 個新翻新產品！\n`;
        if (totalBatches > 1) {
          message += `📄 第 ${batchNumber}/${totalBatches} 批\n\n`;
        } else {
          message += '\n';
        }
      } else {
        message = `📄 第 ${batchNumber}/${totalBatches} 批產品：\n\n`;
      }
      
      for (let j = 0; j < batch.length; j++) {
        const product = batch[j];
        const globalIndex = i + j + 1;
        
        const shortName = product.name
          .replace(/整修品.*$/, '')
          .replace(/Apple\s*/gi, '')
          .trim();
        
        message += `${globalIndex}. ${shortName}\n`;
        message += `💰 ${product.price}\n`;
        
        if (product.url) {
          const shortUrl = await this.shortenUrl(product.url);
          message += `🔗 ${shortUrl}\n`;
        }
        message += '\n';
      }
      
      messages.push(message.trim());
    }
    
    return messages;
  }

  async shortenUrl(url) {
    try {
      const response = await fetch(`https://is.gd/create.php?format=simple&url=${encodeURIComponent(url)}`);
      const shortUrl = await response.text();
      
      if (shortUrl.startsWith('https://is.gd/') && !shortUrl.includes('Error')) {
        return shortUrl;
      }
      
      return url;
    } catch (error) {
      console.error('URL縮短失敗:', error);
      return url;
    }
  }


  async handleLineEvent(event) {
    if (event.type === 'follow') {
      const userId = event.source.userId;
      await this.registerUser(userId);
      return null;
    }

    if (event.type !== 'message' || event.message.type !== 'text') {
      return null;
    }

    const userId = event.source.userId;
    const messageText = event.message.text.trim();
    
    
    await this.registerUser(userId);
    
    let replyMessage = '';
    
    try {
      switch (messageText.toLowerCase()) {
        case '/start':
        case 'start':
        case '/begin':
        case '/track':
          if (this.isTracking) {
            replyMessage = '⚠️ System is already tracking';
          } else {
            await this.startTracking();
            replyMessage = '✅ Started tracking Apple refurbished products\n📱 You will be notified when new items are available';
          }
          break;
          
        case '/stop':
        case 'stop':
        case '/pause':
        case '/halt':
          if (!this.isTracking) {
            replyMessage = '⚠️ System is not currently tracking';
          } else {
            this.stopTracking();
            replyMessage = '⏹️ Tracking stopped';
          }
          break;
          
        case '/status':
        case 'status':
        case '/info':
        case '/state':
          replyMessage = await this.getStatusMessage();
          break;
          
        case '/help':
        case 'help':
        case '/commands':
        case '/menu':
          replyMessage = this.getHelpMessage();
          break;
          
        case '/test':
        case 'test':
        case '/ping':
          replyMessage = '🧪 Test notification\n✅ System is working properly!';
          break;

        case '/rules':
        case 'rules':
        case '/list':
          replyMessage = await this.getUserRulesMessage(userId);
          break;

        case '/add':
        case '/setup':
        case '/configure':
        case 'add rule':
        case 'setup':
          const liffId = process.env.LINE_LIFF_ID;
          if (liffId) {
            replyMessage = `📝 Please use the LINE web interface to set up your personal tracking rules:\nhttps://liff.line.me/${liffId}\n\n✨ Auto-detects your identity, no additional setup required`;
          } else {
            const webUrl = process.env.WEB_URL || 'http://localhost:3000';
            replyMessage = `📝 Please use the web interface to add tracking rules:\n${webUrl}\n\n⚠️ Note: Please configure LIFF ID to enable identity recognition`;
          }
          break;
          
        default:
          replyMessage = '❓ Unknown command\nType "/help" to see available commands';
      }
      
      if (replyMessage) {
        const lineProvider = this.notificationManager.getProvider('line');
        if (lineProvider) {
          await lineProvider.replyMessage(event.replyToken, replyMessage);
        }
      }
      
    } catch (error) {
      console.error('LINE event processing error:', error);
      const lineProvider = this.notificationManager.getProvider('line');
      if (lineProvider) {
        await lineProvider.replyMessage(event.replyToken, '❌ System error occurred, please try again later');
      }
    }
    
    return null;
  }

  async registerUser(userId) {
    if (!this.firebaseService.initialized) {
      return;
    }
    await this.firebaseService.getOrCreateUser(userId);
  }

  async getStatusMessage() {
    if (!this.firebaseService.initialized) {
      return `📊 System Status\n\n🎯 Tracking Status: ${this.isTracking ? 'Running' : 'Stopped'}\n⚠️  Firebase not connected`;
    }
    
    const stats = await this.firebaseService.getSystemStats();
    
    let message = `📊 System Status\n\n`;
    message += `🎯 Tracking Status: ${this.isTracking ? 'Running' : 'Stopped'}\n`;
    message += `📋 Active Rules: ${stats.activeRules}\n`;
    message += `👥 Registered Users: ${stats.totalUsers}\n`;
    message += `📤 24h Notifications: ${stats.notificationsLast24h}`;
    
    return message;
  }

  async getUserRulesMessage(userId) {
    if (!this.firebaseService.initialized) {
      const liffId = process.env.LINE_LIFF_ID;
      if (liffId) {
        return `📋 Your Tracking Rules\n\n⚠️  Firebase not connected, unable to show personal rules\n\n📝 Please use LINE web interface to set up personal rules:\nhttps://liff.line.me/${liffId}`;
      } else {
        const webUrl = process.env.WEB_URL || 'http://localhost:3000';
        return `📋 Your Tracking Rules\n\n⚠️  Firebase not connected\n📝 Please use web interface:\n${webUrl}`;
      }
    }
    
    try {
      const rules = await this.firebaseService.getUserTrackingRules(userId);
      
      if (rules.length === 0) {
        const liffId = process.env.LINE_LIFF_ID;
        if (liffId) {
          return `📋 You have no tracking rules set up yet\n\n📝 Please use LINE web interface to set up personal rules:\nhttps://liff.line.me/${liffId}\n\n✨ Click the link to automatically identify your account`;
        } else {
          const webUrl = process.env.WEB_URL || 'http://localhost:3000';
          return `📋 You have no tracking rules set up yet\n\n📝 Please use web interface to add rules:\n${webUrl}\n\n⚠️ Recommend setting up LIFF to enable personal rules feature`;
        }
      }
      
      let message = `📋 Your Tracking Rules (${rules.length}):\n\n`;
      
      rules.forEach((rule, index) => {
        message += `${index + 1}. ${rule.name}\n`;
        if (rule.filters.productType) message += `   📱 Product: ${rule.filters.productType}\n`;
        if (rule.filters.chip) message += `   🔧 Chip: ${rule.filters.chip}\n`;
        if (rule.filters.minMemory) message += `   💾 Memory: ≥${rule.filters.minMemory}GB\n`;
        if (rule.filters.maxPrice) message += `   💰 Price: ≤NT$${rule.filters.maxPrice.toLocaleString()}\n`;
        message += '\n';
      });
      
      return message;
    } catch (error) {
      console.error('Get user rules error:', error);
      return '❌ Unable to retrieve rules list';
    }
  }


  getHelpMessage() {
    const activeProviders = this.notificationManager.getActiveProviderNames();
    const liffId = process.env.LINE_LIFF_ID;
    
    return `🤖 Apple Refurbished Tracker Bot\n\n` +
           `📱 Available Commands:\n` +
           `• /start - Begin monitoring new products\n` +
           `• /stop - Stop monitoring\n` +
           `• /status - Check system status\n` +
           `• /rules - View your tracking rules\n` +
           `• /add - Configure your tracking rules\n` +
           `• /test - Test bot connection\n` +
           `• /help - Show this message\n\n` +
           `📤 Active notification methods: ${activeProviders.join(', ')}\n\n` +
           (liffId ? 
             `📱 Personal rules setup: https://liff.line.me/${liffId}` :
             `⚠️ Please configure LIFF ID to enable personal rules feature`);
  }

  async scrapeProducts() {
    const page = await this.browser.newPage();
    
    try {
      const urls = [
        'https://www.apple.com/tw/shop/refurbished/mac',
        'https://www.apple.com/tw/shop/refurbished/ipad',
        'https://www.apple.com/tw/shop/refurbished/appletv'
      ];
      
      let allProducts = [];
      
      for (const url of urls) {
        try {
          await page.goto(url, { waitUntil: 'networkidle2' });
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          const products = await page.evaluate((currentUrl) => {
            const productData = [];
            
            const links = document.querySelectorAll('a[href*="/shop/product/"]');
            
            const refurbishedLinks = Array.from(links).filter(a => {
              const href = a.href.toLowerCase();
              const text = a.textContent.toLowerCase();
              
              const isRefurbished = href.includes('refurbished') || text.includes('整修品') || text.includes('整修');
              
              if (isRefurbished && text.trim().length > 0) {
                return true;
              }
              return false;
            });
            
            refurbishedLinks.forEach((link, index) => {
              try {
                const name = link.textContent.trim();
                
                let price = '';
                let currentElement = link.parentElement;
                let searchDepth = 0;
                
                while (currentElement && searchDepth < 6) {
                  const containerText = currentElement.textContent || '';
                  const priceMatch = containerText.match(/NT\$[\d,]+/);
                  if (priceMatch) {
                    price = priceMatch[0];
                    break;
                  }
                  currentElement = currentElement.parentElement;
                  searchDepth++;
                }
                
                let image = '';
                const parentContainer = link.closest('div');
                if (parentContainer) {
                  const imgElement = parentContainer.querySelector('img');
                  if (imgElement) {
                    image = imgElement.src || imgElement.getAttribute('data-src') || '';
                  }
                }
                
                if (name.length > 0) {
                  productData.push({
                    name: name,
                    price: price || '價格未找到',
                    image: image || '',
                    description: name,
                    url: link.href,
                    category: currentUrl.includes('/mac') ? 'Mac' :
                             currentUrl.includes('/ipad') ? 'iPad' :
                             currentUrl.includes('/appletv') ? 'Apple TV' : 'Other'
                  });
                }
                
              } catch (e) {
              }
            });
            
            return productData;
          }, url);
          
          allProducts = allProducts.concat(products);
          
        } catch (error) {
          console.error(`爬取 ${url} 失敗:`, error.message);
        }
      }

      const productsWithSpecs = allProducts.map(product => ({
        ...product,
        specs: this.parseSpecs(product.name, product.description, product.category)
      }));

      return productsWithSpecs;
      
    } catch (error) {
      console.error('爬取錯誤:', error);
      return [];
    } finally {
      await page.close();
    }
  }

  parseSpecs(name, description, category) {
    const normalizedName = name ? name.replace(/\u00A0/g, ' ') : '';
    const normalizedDescription = description ? description.replace(/\u00A0/g, ' ') : '';
    
    const specs = {
      screenSize: null,
      chip: null,
      memory: null,
      storage: null,
      color: null,
      productType: null,
      category: category || 'Other'
    };

    if (normalizedName.includes('MacBook Air')) specs.productType = 'MacBook Air';
    else if (normalizedName.includes('MacBook Pro')) specs.productType = 'MacBook Pro';
    else if (normalizedName.includes('Mac Studio')) specs.productType = 'Mac Studio';
    else if (normalizedName.includes('Mac mini')) specs.productType = 'Mac mini';
    else if (normalizedName.includes('iMac')) specs.productType = 'iMac';
    else if (normalizedName.includes('iPad Pro')) specs.productType = 'iPad Pro';
    else if (normalizedName.includes('iPad Air')) specs.productType = 'iPad Air';
    else if (normalizedName.includes('iPad mini')) specs.productType = 'iPad mini';
    else if (normalizedName.includes('iPad')) specs.productType = 'iPad';
    else if (normalizedName.includes('Apple TV')) specs.productType = 'Apple TV';

    const sizeMatch = normalizedName.match(/(\d+)\s*吋/);
    if (sizeMatch) specs.screenSize = sizeMatch[1] + '吋';

    const chipPatterns = [
      /Apple (M\d+(?:\s+(?:Pro|Max|Ultra))?)/,
      /(M\d+(?:\s+(?:Pro|Max|Ultra))?)\s*晶片/,
      /(M\d+(?:\s+(?:Pro|Max|Ultra))?)/
    ];
    
    for (const pattern of chipPatterns) {
      const chipMatch = normalizedName.match(pattern) || normalizedDescription.match(pattern);
      if (chipMatch) {
        specs.chip = chipMatch[1].replace('Apple ', '').replace('晶片', '').trim();
        break;
      }
    }

    const memoryPatterns = [
      /(\d+)GB\s*統一記憶體/,
      /(\d+)GB\s*記憶體/,
      /(\d+)\s*GB/
    ];
    
    for (const pattern of memoryPatterns) {
      const memoryMatch = normalizedDescription.match(pattern) || normalizedName.match(pattern);
      if (memoryMatch) {
        specs.memory = memoryMatch[1] + 'GB';
        break;
      }
    }

    const storagePatterns = [
      /(\d+(?:\.\d+)?)TB/,
      /(\d+)GB.*SSD/,
      /(\d+)GB\s*儲存/
    ];
    
    for (const pattern of storagePatterns) {
      const storageMatch = normalizedDescription.match(pattern) || normalizedName.match(pattern);
      if (storageMatch) {
        if (pattern.toString().includes('TB')) {
          specs.storage = storageMatch[1] + 'TB';
        } else {
          specs.storage = storageMatch[1] + 'GB';
        }
        break;
      }
    }

    const colors = ['銀色', '太空灰色', '太空黑色', '星光色', '午夜色', '天藍色'];
    for (const color of colors) {
      if (normalizedName.includes(color)) {
        specs.color = color;
        break;
      }
    }

    return specs;
  }

  filterProducts(products, filters) {
    return products.filter(product => {
      const specs = product.specs;
      
      if (filters.productType && specs.productType !== filters.productType) return false;
      if (filters.chip && specs.chip !== filters.chip) return false;
      if (filters.color && specs.color !== filters.color) return false;
      
      if (filters.minMemory) {
        const productMemory = parseInt(specs.memory);
        if (isNaN(productMemory) || productMemory < filters.minMemory) return false;
      }
      
      if (filters.maxPrice) {
        const price = parseInt(product.price?.replace(/[^\d]/g, '') || '0');
        if (price > filters.maxPrice) return false;
      }
      
      return true;
    });
  }

  async startTracking() {
    this.isTracking = true;
    console.log('🎯 開始追蹤產品...');
    
    await this.trackProducts();
    
    this.trackingInterval = setInterval(async () => {
      await this.trackProducts();
    }, 60 * 60 * 1000);
  }

  stopTracking() {
    this.isTracking = false;
    if (this.trackingInterval) {
      clearInterval(this.trackingInterval);
      this.trackingInterval = null;
    }
    console.log('⏹️ 停止追蹤');
  }

  async trackProducts() {
    try {
      const startTime = Date.now();
      
      const allProducts = await this.scrapeProducts();
      
      const newProducts = await this.detectNewProducts(allProducts);
      
      if (newProducts.length === 0) {
        if (this.firebaseService.initialized) {
          await this.firebaseService.saveProductHistory(allProducts);
        }
        return {
          totalProducts: allProducts.length,
          newProducts: 0,
          totalNewMatches: 0,
          notifiedUsers: 0
        };
      }
      
      const activeUsers = await this.firebaseService.getActiveUsers();
      
      const allNewMatches = [];
      let notifiedUsersCount = 0;
      
      for (const user of activeUsers) {
        const userRules = await this.firebaseService.getUserTrackingRules(user.lineUserId);
        
        let userNewMatches = [];
        
        for (const rule of userRules) {
          const newMatches = this.filterProducts(newProducts, rule.filters);
          
          if (newMatches.length > 0) {
            userNewMatches = userNewMatches.concat(newMatches);
          }
        }
        
        userNewMatches = userNewMatches.filter((product, index, self) => 
          index === self.findIndex(p => p.url === product.url)
        );
        
        if (userNewMatches.length > 0) {
          const messages = await this.formatNewProductMessage(userNewMatches);
          if (messages && messages.length > 0) {
            const productIds = userNewMatches.map(p => this.firebaseService.getProductId(p.url));
            
            for (let i = 0; i < messages.length; i++) {
              const message = messages[i];
              try {
                const results = await this.notificationManager.sendNotification(
                  user, 
                  message, 
                  { productIds, batchInfo: { current: i + 1, total: messages.length } }
                );
                
                for (const result of results) {
                  if (result.success) {
                    await this.firebaseService.saveNotification(user.lineUserId, message, productIds);
                    if (i === 0) notifiedUsersCount++;
                  }
                }
                
                if (i < messages.length - 1) {
                  await new Promise(resolve => setTimeout(resolve, 1000));
                }
              } catch (error) {
                console.error(`❌ 發送第${i+1}批訊息失敗:`, error.message);
              }
            }
          }
        }
        
        allNewMatches.push(...userNewMatches);
      }
      
      if (this.firebaseService.initialized) {
        await this.firebaseService.saveProductHistory(allProducts);
      }
      
      
      return {
        totalProducts: allProducts.length,
        newProducts: newProducts.length,
        totalNewMatches: allNewMatches.length,
        notifiedUsers: notifiedUsersCount
      };
    } catch (error) {
      console.error('❌ 追蹤錯誤:', error);
      return {
        totalProducts: 0,
        newProducts: 0,
        totalNewMatches: 0,
        notifiedUsers: 0
      };
    }
  }

  async start() {
    await this.init();
    
    this.app.listen(this.port, () => {
      console.log(`🌐 伺服器啟動於 http://localhost:${this.port}`);
      
      const platform = process.platform;
      const command = platform === 'darwin' ? 'open' : 
                     platform === 'win32' ? 'start' : 'xdg-open';
      
      exec(`${command} http://localhost:${this.port}`, (error) => {
        if (error) {
        }
      });
    });
  }

  async cleanup() {
    this.stopTracking();
    if (this.browser) {
      await this.browser.close();
    }
  }
}

const tracker = new AppleTracker();
tracker.start();

process.on('SIGINT', async () => {
  console.log('\n正在關閉...');
  await tracker.cleanup();
  process.exit(0);
});

module.exports = AppleTracker;