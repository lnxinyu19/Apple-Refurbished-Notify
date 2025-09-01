const express = require('express');
const puppeteer = require('puppeteer');
const fs = require('fs').promises;
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
    this.config = { lineConfig: {} }; // 只保留LINE配置
    this.isTracking = false;
    this.trackingInterval = null;
    this.firebaseService = new FirebaseService(); // Firebase服務
    this.notificationManager = new NotificationManager(); // 通知管理器
    
    this.setupServer();
  }

  setupServer() {
    // 設定靜態檔案
    this.app.use(express.static('public'));
    this.app.use(express.json());

    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // API 路由
    this.app.get('/api/config', (req, res) => {
      res.json(this.config);
    });

    this.app.post('/api/config', async (req, res) => {
      try {
        this.config = req.body;
        await this.saveConfig();
        res.json({ success: true });
      } catch (error) {
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

    // 測試產品爬取端點（前端需要）
    this.app.get('/api/products/test', async (req, res) => {
      try {
        const allProducts = await this.scrapeProducts();
        
        res.json({
          message: `找到 ${allProducts.length} 個產品`,
          total: allProducts.length,
          products: allProducts.slice(0, 10)
        });
        
      } catch (error) {
        console.error('測試產品爬取錯誤:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // 正式LINE webhook端點
    this.app.post('/webhook/line', express.json(), async (req, res) => {
      try {
        console.log('📨 處理LINE事件:', req.body.events?.length || 0, '個事件');
        
        if (!req.body.events || req.body.events.length === 0) {
          return res.status(200).json([]);
        }
        
        const results = await Promise.all(req.body.events.map(this.handleLineEvent.bind(this)));
        console.log('✅ LINE事件處理完成');
        res.status(200).json(results);
        
      } catch (error) {
        console.error('❌ LINE webhook錯誤:', error.message);
        res.status(200).json([]);
      }
    });

  }

  async init() {
    // 載入配置
    await this.loadConfig();
    
    // 初始化Firebase（允許失敗）
    const firebaseReady = await this.firebaseService.initialize();
    
    // 初始化通知管理器
    await this.notificationManager.initialize({
      line: this.config.lineConfig,
      email: this.config.emailConfig || { enabled: false }
    });
    
    // 初始化瀏覽器
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
    try {
      // 優先使用環境變數
      if (process.env.LINE_CHANNEL_ACCESS_TOKEN && process.env.LINE_CHANNEL_SECRET) {
        this.config = {
          lineConfig: {
            channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
            channelSecret: process.env.LINE_CHANNEL_SECRET
          }
        };
      } else {
        // 回退到本地配置文件
        const configData = await fs.readFile('config.json', 'utf8');
        this.config = JSON.parse(configData);
      }
    } catch (error) {
      // 如果檔案不存在，使用預設配置
      this.config = { lineConfig: {} };
    }
  }

  async saveConfig() {
    await fs.writeFile('config.json', JSON.stringify(this.config, null, 2));
  }


  async detectNewProducts(currentProducts) {
    const previousProducts = await this.firebaseService.getProductHistory();
    const newProducts = [];
    
    for (const product of currentProducts) {
      if (!previousProducts.has(product.url)) {
        newProducts.push(product);
      }
    }
    
    return newProducts;
  }

  async notifyAllUsers(message, productIds = []) {
    const activeUsers = await this.firebaseService.getActiveUsers();
    
    const results = await this.notificationManager.sendNotificationToAll(
      activeUsers, 
      message, 
      { productIds }
    );

    // 記錄通知歷史到Firebase
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
    
    // LINE訊息限制，顯示更多產品
    const maxProducts = Math.min(newProducts.length, 10);
    const displayProducts = newProducts.slice(0, maxProducts);
    
    let message = `🆕 發現 ${newProducts.length} 個新翻新產品！\n\n`;
    
    for (let i = 0; i < displayProducts.length; i++) {
      const product = displayProducts[i];
      // 簡化產品名稱（移除冗餘描述）
      const shortName = product.name.replace(/整修品.*$/, '').trim();
      const shortUrl = await this.shortenUrl(product.url);
      
      message += `${i + 1}. ${shortName}\n`;
      message += `💰 ${product.price}\n`;
      message += `🔗 ${shortUrl}\n\n`;
    }
    
    if (newProducts.length > maxProducts) {
      message += `📱 還有 ${newProducts.length - maxProducts} 個產品`;
    }
    
    return message;
  }

  async shortenUrl(url) {
    try {
      // 使用 TinyURL API
      const response = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`);
      const shortUrl = await response.text();
      
      // 檢查是否成功縮短
      if (shortUrl.startsWith('https://tinyurl.com/')) {
        return shortUrl;
      }
      
      return url; // 失敗時返回原網址
    } catch (error) {
      console.error('URL縮短失敗:', error);
      return url; // 失敗時返回原網址
    }
  }


  async handleLineEvent(event) {
    // 處理加入好友事件
    if (event.type === 'follow') {
      const userId = event.source.userId;
      await this.registerUser(userId);
      
      const welcomeMessage = this.getWelcomeMessage();
      const lineProvider = this.notificationManager.getProvider('line');
      if (lineProvider) {
        await lineProvider.replyMessage(event.replyToken, welcomeMessage);
      }
      return null;
    }

    if (event.type !== 'message' || event.message.type !== 'text') {
      return null;
    }

    const userId = event.source.userId;
    const messageText = event.message.text.trim();
    
    
    // 註冊使用者
    await this.registerUser(userId);
    
    let replyMessage = '';
    
    try {
      switch (messageText.toLowerCase()) {
        case '開始追蹤':
        case 'start':
        case '開始':
          if (this.isTracking) {
            replyMessage = '⚠️ 系統已在追蹤中';
          } else {
            await this.startTracking();
            replyMessage = '✅ 開始追蹤 Apple 翻新產品\n📱 有新品時會立即通知您';
          }
          break;
          
        case '停止追蹤':
        case 'stop':
        case '停止':
          if (!this.isTracking) {
            replyMessage = '⚠️ 系統目前未在追蹤';
          } else {
            this.stopTracking();
            replyMessage = '⏹️ 已停止追蹤';
          }
          break;
          
        case '狀態':
        case 'status':
        case '追蹤狀態':
          replyMessage = await this.getStatusMessage();
          break;
          
        case '幫助':
        case 'help':
        case '指令':
          replyMessage = this.getHelpMessage();
          break;
          
        case '測試':
        case 'test':
          replyMessage = '🧪 測試通知\n✅ 系統運作正常！';
          break;

        case '我的規則':
        case '規則列表':
          replyMessage = await this.getUserRulesMessage(userId);
          break;

        case '新增規則':
          const webUrl = process.env.WEB_URL || 'http://localhost:3000';
          replyMessage = `📝 請使用網頁介面新增追蹤規則:\n${webUrl}\n\n個人規則功能開發中...`;
          break;
          
        default:
          replyMessage = '❓ 不認識的指令\n請輸入「幫助」查看可用指令';
      }
      
      // 回覆訊息
      if (replyMessage) {
        const lineProvider = this.notificationManager.getProvider('line');
        if (lineProvider) {
          await lineProvider.replyMessage(event.replyToken, replyMessage);
        }
      }
      
    } catch (error) {
      console.error('處理LINE事件錯誤:', error);
      // 發送錯誤訊息給使用者
      const lineProvider = this.notificationManager.getProvider('line');
      if (lineProvider) {
        await lineProvider.replyMessage(event.replyToken, '❌ 系統發生錯誤，請稍後再試');
      }
    }
    
    return null;
  }

  async registerUser(userId) {
    if (!this.firebaseService.initialized) {
      console.log('⚠️  Firebase未連接，無法註冊用戶');
      return;
    }
    await this.firebaseService.getOrCreateUser(userId);
  }

  async getStatusMessage() {
    if (!this.firebaseService.initialized) {
      return `📊 系統狀態\n\n🎯 追蹤狀態: ${this.isTracking ? '運行中' : '已停止'}\n⚠️  Firebase未連接`;
    }
    
    const stats = await this.firebaseService.getSystemStats();
    
    let message = `📊 系統狀態\n\n`;
    message += `🎯 追蹤狀態: ${this.isTracking ? '運行中' : '已停止'}\n`;
    message += `📋 啟用規則: ${stats.activeRules} 個\n`;
    message += `👥 註冊使用者: ${stats.totalUsers} 人\n`;
    message += `📤 24小時通知: ${stats.notificationsLast24h} 則`;
    
    return message;
  }

  async getUserRulesMessage(userId) {
    if (!this.firebaseService.initialized) {
      const webUrl = process.env.WEB_URL || 'http://localhost:3000';
      return `📋 您的追蹤規則\n\n⚠️  Firebase未連接，無法顯示規則\n📝 請使用網頁介面:\n${webUrl}`;
    }
    
    try {
      const rules = await this.firebaseService.getUserTrackingRules(userId);
      
      if (rules.length === 0) {
        const webUrl = process.env.WEB_URL || 'http://localhost:3000';
        return `📋 您目前沒有設定追蹤規則\n\n📝 請使用網頁介面新增規則:\n${webUrl}`;
      }
      
      let message = `📋 您的追蹤規則 (${rules.length} 個):\n\n`;
      
      rules.forEach((rule, index) => {
        message += `${index + 1}. ${rule.name}\n`;
        if (rule.filters.productType) message += `   📱 產品: ${rule.filters.productType}\n`;
        if (rule.filters.chip) message += `   🔧 晶片: ${rule.filters.chip}\n`;
        if (rule.filters.minMemory) message += `   💾 記憶體: ≥${rule.filters.minMemory}GB\n`;
        if (rule.filters.maxPrice) message += `   💰 價格: ≤NT$${rule.filters.maxPrice.toLocaleString()}\n`;
        message += '\n';
      });
      
      return message;
    } catch (error) {
      console.error('取得用戶規則錯誤:', error);
      return '❌ 無法取得規則列表';
    }
  }

  getWelcomeMessage() {
    const webUrl = process.env.WEB_URL || 'http://localhost:3000';
    
    return `🍎 您好！歡迎使用 Apple 翻新機追蹤 Bot！\n\n` +
           `✨ 我會幫您監控 Apple 翻新機新品上架\n` +
           `當有符合您條件的產品時會立即通知您！\n\n` +
           `📱 快速開始：\n` +
           `• 輸入「開始追蹤」立即開始監控\n` +
           `• 輸入「幫助」查看所有指令\n\n` +
           `🔧 進階設定請訪問：\n${webUrl}\n\n` +
           `🎯 祝您搶到心儀的 Mac！`;
  }

  getHelpMessage() {
    const activeProviders = this.notificationManager.getActiveProviderNames();
    const webUrl = process.env.WEB_URL || 'http://localhost:3000';
    
    return `🤖 Apple 翻新機追蹤 Bot\n\n` +
           `📱 可用指令:\n` +
           `• 開始追蹤 - 開始監控新品\n` +
           `• 停止追蹤 - 停止監控\n` +
           `• 狀態 - 查看系統狀態\n` +
           `• 我的規則 - 查看個人追蹤規則\n` +
           `• 新增規則 - 新增追蹤規則\n` +
           `• 測試 - 測試Bot連接\n` +
           `• 幫助 - 顯示此訊息\n\n` +
           `📤 啟用通知方式: ${activeProviders.join(', ')}\n\n` +
           `🔧 詳細規則管理請使用網頁:\n` +
           `${webUrl}`;
  }

  async scrapeProducts() {
    const page = await this.browser.newPage();
    
    try {
      // 爬取台灣可用的 Apple 翻新產品類別
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
            
            // 直接尋找所有整修機產品連結
            const links = document.querySelectorAll('a[href*="/shop/product/"]');
            
            // 過濾出整修機產品連結
            const refurbishedLinks = Array.from(links).filter(a => {
              const href = a.href.toLowerCase();
              const text = a.textContent.toLowerCase();
              
              // 必須是整修機產品
              const isRefurbished = href.includes('refurbished') || text.includes('整修品') || text.includes('整修');
              
              if (isRefurbished && text.trim().length > 0) {
                return true;
              }
              return false;
            });
            
            // 從每個產品連結提取資訊
            refurbishedLinks.forEach((link, index) => {
              try {
                const name = link.textContent.trim();
                
                // 尋找價格
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
                
                // 尋找圖片
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
                // 靜默跳過錯誤
              }
            });
            
            return productData;
          }, url);
          
          allProducts = allProducts.concat(products);
          
        } catch (error) {
          console.error(`爬取 ${url} 失敗:`, error.message);
        }
      }

      // 解析產品規格
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

    // 產品類型 - 支援所有 Apple 產品
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

    // 螢幕尺寸
    const sizeMatch = normalizedName.match(/(\d+)\s*吋/);
    if (sizeMatch) specs.screenSize = sizeMatch[1] + '吋';

    // 晶片 - 改進匹配邏輯
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

    // 記憶體
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

    // 儲存
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

    // 顏色
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
    
    // 立即執行一次
    await this.trackProducts();
    
    // 每30分鐘執行一次
    this.trackingInterval = setInterval(async () => {
      await this.trackProducts();
    }, 30 * 60 * 1000);
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
      const allProducts = await this.scrapeProducts();
      
      // 檢測新產品
      const newProducts = await this.detectNewProducts(allProducts);
      
      // 獲取所有用戶及其追蹤規則
      const activeUsers = await this.firebaseService.getActiveUsers();
      const allNewMatches = [];
      
      for (const user of activeUsers) {
        const userRules = await this.firebaseService.getUserTrackingRules(user.lineUserId);
        
        let userNewMatches = [];
        
        for (const rule of userRules) {
          const newMatches = this.filterProducts(newProducts, rule.filters);
          
          if (newMatches.length > 0) {
            userNewMatches = userNewMatches.concat(newMatches);
          }
        }
        
        // 去重該用戶的新匹配產品
        userNewMatches = userNewMatches.filter((product, index, self) => 
          index === self.findIndex(p => p.url === product.url)
        );
        
        // 發送個人通知
        if (userNewMatches.length > 0) {
          const message = await this.formatNewProductMessage(userNewMatches);
          if (message) {
            const productIds = userNewMatches.map(p => this.firebaseService.getProductId(p.url));
            const results = await this.notificationManager.sendNotification(
              user, 
              message, 
              { productIds }
            );
            
            // 記錄成功的通知
            for (const result of results) {
              if (result.success) {
                await this.firebaseService.saveNotification(user.lineUserId, message, productIds);
              }
            }
          }
        }
        
        allNewMatches.push(...userNewMatches);
      }
      
      // 更新產品歷史記錄到Firebase
      await this.firebaseService.saveProductHistory(allProducts);
      
      return {
        totalProducts: allProducts.length,
        newProducts: newProducts.length,
        totalNewMatches: allNewMatches.length,
        notifiedUsers: activeUsers.length
      };
    } catch (error) {
      console.error('追蹤錯誤:', error);
      return [];
    }
  }

  async start() {
    await this.init();
    
    this.app.listen(this.port, () => {
      console.log(`🌐 伺服器啟動於 http://localhost:${this.port}`);
      
      // 自動開啟瀏覽器
      const platform = process.platform;
      const command = platform === 'darwin' ? 'open' : 
                     platform === 'win32' ? 'start' : 'xdg-open';
      
      exec(`${command} http://localhost:${this.port}`, (error) => {
        if (error) {
          console.log('請手動開啟瀏覽器到 http://localhost:3000');
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

// 啟動應用
const tracker = new AppleTracker();
tracker.start();

// 處理程序終止
process.on('SIGINT', async () => {
  console.log('\n正在關閉...');
  await tracker.cleanup();
  process.exit(0);
});

module.exports = AppleTracker;