const express = require('express');
const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');

class AppleTracker {
  constructor() {
    this.app = express();
    this.port = 3000;
    this.browser = null;
    this.config = { trackingRules: [] };
    this.isTracking = false;
    this.trackingInterval = null;
    
    this.setupServer();
  }

  setupServer() {
    // 設定靜態檔案
    this.app.use(express.static('public'));
    this.app.use(express.json());

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

    this.app.get('/api/track/status', (req, res) => {
      res.json({ 
        isTracking: this.isTracking,
        rulesCount: this.config.trackingRules.length 
      });
    });

    this.app.get('/api/products/test', async (req, res) => {
      try {
        const allProducts = await this.scrapeProducts();
        console.log(`爬取到 ${allProducts.length} 個產品`);
        
        // 如果沒有規則，回傳所有產品
        if (this.config.trackingRules.length === 0) {
          return res.json({
            message: `找到 ${allProducts.length} 個產品 (未設定篩選規則)`,
            total: allProducts.length,
            filtered: 0,
            products: allProducts
          });
        }
        
        // 應用所有啟用的規則
        const enabledRules = this.config.trackingRules.filter(rule => rule.enabled);
        let allFilteredProducts = [];
        let ruleResults = [];
        
        for (const rule of enabledRules) {
          const filteredProducts = this.filterProducts(allProducts, rule.filters);
          console.log(`規則 "${rule.name}" 匹配 ${filteredProducts.length} 個產品`);
          
          ruleResults.push({
            ruleName: rule.name,
            matchCount: filteredProducts.length,
            products: filteredProducts // 顯示所有匹配的產品
          });
          
          // 合併所有匹配的產品 (去重)
          filteredProducts.forEach(product => {
            if (!allFilteredProducts.find(p => p.name === product.name)) {
              allFilteredProducts.push(product);
            }
          });
        }
        
        res.json({
          message: `共 ${allProducts.length} 個產品，${enabledRules.length} 個規則匹配 ${allFilteredProducts.length} 個產品`,
          total: allProducts.length,
          filtered: allFilteredProducts.length,
          ruleResults: ruleResults,
          summary: allFilteredProducts // 顯示所有匹配的產品
        });
        
      } catch (error) {
        console.error('測試產品爬取錯誤:', error);
        res.status(500).json({ error: error.message });
      }
    });
  }

  async init() {
    // 載入配置
    await this.loadConfig();
    
    // 初始化瀏覽器
    this.browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    console.log('🚀 Apple 整修機追蹤器已初始化');
  }

  async loadConfig() {
    try {
      const configData = await fs.readFile('config.json', 'utf8');
      this.config = JSON.parse(configData);
    } catch (error) {
      // 如果檔案不存在，使用預設配置
      this.config = { trackingRules: [] };
    }
  }

  async saveConfig() {
    await fs.writeFile('config.json', JSON.stringify(this.config, null, 2));
  }

  async scrapeProducts() {
    const page = await this.browser.newPage();
    
    try {
      const url = 'https://www.apple.com/tw/shop/refurbished/mac';
      console.log(`正在爬取: ${url}`);
      
      await page.goto(url, { waitUntil: 'networkidle2' });
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const products = await page.evaluate(() => {
        const productData = [];
        
        console.log('開始解析頁面...');
        
        // 直接尋找所有整修機產品連結
        const links = document.querySelectorAll('a[href*="/shop/product/"]');
        console.log(`找到 ${links.length} 個產品連結`);
        
        // 過濾出整修機產品連結
        const refurbishedLinks = Array.from(links).filter(a => {
          const href = a.href.toLowerCase();
          const text = a.textContent.toLowerCase();
          
          // 必須是整修機產品
          const isRefurbished = href.includes('refurbished') || text.includes('整修品') || text.includes('整修');
          
          // 必須是Mac產品
          const isMac = text.includes('mac') || text.includes('imac');
          
          if (isRefurbished && isMac) {
            console.log('找到整修Mac產品:', a.textContent.trim().substring(0, 60));
            return true;
          }
          return false;
        });
        
        console.log(`過濾後找到 ${refurbishedLinks.length} 個整修Mac產品`);
        
        // 從每個產品連結提取資訊
        refurbishedLinks.forEach((link, index) => {
          try {
            const name = link.textContent.trim();
            
            // 尋找價格 - 在父元素中搜尋
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
                description: name, // 使用名稱作為描述
                url: link.href // 添加產品頁面連結
              });
            }
            
          } catch (e) {
            console.log(`解析產品 ${index} 時出錯:`, e.message);
          }
        });
        
        console.log(`總共找到 ${productData.length} 個產品`);
        return productData;
      });

      // 解析產品規格
      const productsWithSpecs = products.map(product => ({
        ...product,
        specs: this.parseSpecs(product.name, product.description)
      }));

      return productsWithSpecs;
      
    } catch (error) {
      console.error('爬取錯誤:', error);
      return [];
    } finally {
      await page.close();
    }
  }

  parseSpecs(name, description) {
    const normalizedName = name ? name.replace(/\u00A0/g, ' ') : '';
    const normalizedDescription = description ? description.replace(/\u00A0/g, ' ') : '';
    
    const specs = {
      screenSize: null,
      chip: null,
      memory: null,
      storage: null,
      color: null,
      productType: null
    };

    // 產品類型
    if (normalizedName.includes('MacBook Air')) specs.productType = 'MacBook Air';
    else if (normalizedName.includes('MacBook Pro')) specs.productType = 'MacBook Pro';
    else if (normalizedName.includes('Mac Studio')) specs.productType = 'Mac Studio';
    else if (normalizedName.includes('Mac mini')) specs.productType = 'Mac mini';
    else if (normalizedName.includes('iMac')) specs.productType = 'iMac';

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
      console.log(`找到 ${allProducts.length} 個產品`);
      
      const results = [];
      
      for (const rule of this.config.trackingRules) {
        if (!rule.enabled) continue;
        
        const matches = this.filterProducts(allProducts, rule.filters);
        
        if (matches.length > 0) {
          console.log(`✅ 規則 "${rule.name}" 找到 ${matches.length} 個產品`);
          results.push({
            rule: rule.name,
            matches: matches.length,
            products: matches
          });
        }
      }
      
      // 儲存結果
      if (results.length > 0) {
        const timestamp = new Date().toISOString();
        const filename = `tracking-results-${timestamp.replace(/[:.]/g, '-')}.json`;
        await fs.writeFile(filename, JSON.stringify({
          timestamp,
          results
        }, null, 2));
      }
      
      return results;
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