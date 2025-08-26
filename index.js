const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const lineMessaging = require('./lineMessaging');

class AppleRefurbishedScraper {
  constructor() {
    this.baseUrl = 'https://www.apple.com/tw/shop/refurbished';
    this.browser = null;
  }

  parseProductSpecs(name, description) {
    // 修正字符編碼問題：替換不間斷空格為普通空格
    const normalizedName = name.replace(/\u00A0/g, ' ');
    const normalizedDescription = description.replace(/\u00A0/g, ' ');
    
    const specs = {
      screenSize: null,
      chip: null,
      memory: null,
      storage: null,
      color: null,
      productType: null
    };


    // 提取螢幕尺寸
    const sizeMatch = normalizedName.match(/(\d+)\s*吋/);
    if (sizeMatch) {
      specs.screenSize = sizeMatch[1] + '吋';
    }

    // 提取產品類型
    if (normalizedName.includes('MacBook Air')) {
      specs.productType = 'MacBook Air';
    } else if (normalizedName.includes('MacBook Pro')) {
      specs.productType = 'MacBook Pro';
    } else if (normalizedName.includes('Mac Studio')) {
      specs.productType = 'Mac Studio';
    } else if (normalizedName.includes('Mac mini')) {
      specs.productType = 'Mac mini';
    } else if (normalizedName.includes('iMac')) {
      specs.productType = 'iMac';
    }

    // 提取晶片類型
    const chipPatterns = [
      /Apple (M\d+(?:\s+(?:Pro|Max|Ultra))?)/,
      /(M\d+(?:\s+(?:Pro|Max|Ultra))?)\s*晶片/
    ];
    
    for (const pattern of chipPatterns) {
      const chipMatch = normalizedName.match(pattern);
      if (chipMatch) {
        specs.chip = chipMatch[1].replace('Apple ', '');
        break;
      }
    }

    // 提取記憶體 (從描述中)
    const memoryMatch = normalizedDescription.match(/(\d+)GB\s*統一記憶體/);
    if (memoryMatch) {
      specs.memory = memoryMatch[1] + 'GB';
    }

    // 提取儲存空間 (從描述中)
    const storageMatch = normalizedDescription.match(/(\d+(?:\.\d+)?)TB|(\d+)GB.*SSD/);
    if (storageMatch) {
      if (storageMatch[1]) {
        specs.storage = storageMatch[1] + 'TB';
      } else if (storageMatch[2]) {
        specs.storage = storageMatch[2] + 'GB';
      }
    }

    // 提取顏色
    const colorPatterns = [
      '銀色', '太空灰色', '太空黑色', '星光色', '午夜色', '天藍色'
    ];
    
    for (const color of colorPatterns) {
      if (normalizedName.includes(color)) {
        specs.color = color;
        break;
      }
    }

    return specs;
  }

  filterProducts(products, filters = {}) {
    return products.filter(product => {
      const specs = product.specs;
      
      // 篩選產品類型
      if (filters.productType && specs.productType !== filters.productType) {
        return false;
      }
      
      // 篩選晶片
      if (filters.chip && specs.chip !== filters.chip) {
        return false;
      }
      
      // 篩選記憶體 (支援最小值)
      if (filters.minMemory) {
        const productMemory = parseInt(specs.memory);
        const minMemory = parseInt(filters.minMemory);
        if (isNaN(productMemory) || productMemory < minMemory) {
          return false;
        }
      }
      
      // 篩選儲存空間 (支援最小值)
      if (filters.minStorage) {
        const productStorage = this.parseStorageSize(specs.storage);
        const minStorage = this.parseStorageSize(filters.minStorage);
        if (productStorage < minStorage) {
          return false;
        }
      }
      
      // 篩選顏色
      if (filters.color && specs.color !== filters.color) {
        return false;
      }
      
      // 篩選價格範圍
      if (filters.maxPrice) {
        const price = parseInt(product.price.replace(/[^\d]/g, ''));
        if (isNaN(price) || price > filters.maxPrice) {
          return false;
        }
      }
      
      return true;
    });
  }

  parseStorageSize(storage) {
    if (!storage) return 0;
    
    const match = storage.match(/(\d+(?:\.\d+)?)(GB|TB)/);
    if (!match) return 0;
    
    const size = parseFloat(match[1]);
    const unit = match[2];
    
    return unit === 'TB' ? size * 1000 : size;
  }

  async init() {
    this.browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  async scrapeRefurbishedProducts(category = '') {
    const page = await this.browser.newPage();
    
    try {
      const url = category ? `${this.baseUrl}/${category}` : this.baseUrl;
      console.log(`正在爬取: ${url}`);
      
      await page.goto(url, { waitUntil: 'networkidle2' });
      
      // 等待頁面載入完成
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // 提取產品資料
      const products = await page.evaluate(() => {
        const productData = [];
        
        // 方法1: 嘗試從JSON-LD提取
        const scripts = document.querySelectorAll('script[type="application/ld+json"]');
        const jsonLdProducts = [];
        
        scripts.forEach(script => {
          try {
            const data = JSON.parse(script.textContent);
            if (data && data.name) {
              
              jsonLdProducts.push({
                name: data.name,
                price: data.offers?.price || null,
                currency: data.offers?.priceCurrency || 'TWD',
                image: data.image,
                description: data.description || '',
                sku: data.sku || '',
                brand: data.brand?.name || 'Apple'
              });
            }
          } catch (e) {
            // 忽略解析錯誤
          }
        });
        
        // 方法2: 從HTML元素提取價格
        const priceElements = document.querySelectorAll('[data-autom="price"], .price, [class*="price"]');
        const prices = Array.from(priceElements).map(el => {
          const text = el.textContent.trim();
          const match = text.match(/NT\$[\d,]+/);
          return match ? match[0] : null;
        }).filter(p => p);
        
        // 方法3: 嘗試從頁面資料物件獲取
        let pageData = {};
        try {
          if (window.pageLevelData) {
            pageData = window.pageLevelData;
          }
        } catch (e) {
          // 忽略
        }
        
        // 合併資料並嘗試匹配價格
        jsonLdProducts.forEach((product, index) => {
          // 如果JSON-LD沒有價格，嘗試使用HTML中找到的價格
          if (!product.price && prices[index]) {
            product.price = prices[index];
          }
          productData.push(product);
        });
        
        return productData;
      });
      
      // 解析產品規格（將this綁定正確）
      const self = this;
      const productsWithSpecs = products.map(product => {
        const specs = self.parseProductSpecs(product.name, product.description);
        return {
          ...product,
          specs: specs
        };
      });

      console.log(`找到 ${productsWithSpecs.length} 個產品`);
      return productsWithSpecs;
      
    } catch (error) {
      console.error('爬取過程中發生錯誤:', error);
      return [];
    } finally {
      await page.close();
    }
  }

  async saveToFile(data, filename = 'products.json') {
    try {
      await fs.writeFile(filename, JSON.stringify(data, null, 2), 'utf8');
      console.log(`資料已儲存至 ${filename}`);
    } catch (error) {
      console.error('儲存檔案時發生錯誤:', error);
    }
  }
}

async function main() {
  const scraper = new AppleRefurbishedScraper();
  
  try {
    await scraper.init();
    
    // 爬取Mac產品
    console.log('開始爬取Apple整修機資料...');
    const macProducts = await scraper.scrapeRefurbishedProducts('mac');
    
    if (macProducts.length > 0) {
      await scraper.saveToFile(macProducts, 'mac-products.json');

      // 依使用者設定過濾並推播結果
      try {
        const settingsData = await fs.readFile('user-settings.json', 'utf8');
        const users = JSON.parse(settingsData);
        for (const user of users) {
          const { userId, ...filters } = user;
          const matched = scraper.filterProducts(macProducts, filters);
          if (matched.length > 0) {
            lineMessaging.pushMessage(userId, matched);
          }
        }
      } catch (err) {
        console.error('讀取使用者設定失敗:', err);
      }

      console.log('Mac產品資料（前10項）：');
      macProducts.slice(0, 10).forEach((product, index) => {
        const specs = product.specs;
        console.log(`${index + 1}. ${specs.productType || '未知'} ${specs.screenSize || ''} ${specs.chip || ''} ${specs.memory || ''} ${specs.storage || ''} ${specs.color || ''} - ${product.price} ${product.currency}`);
      });
      
      console.log(`\n共找到 ${macProducts.length} 個產品，資料已儲存至 mac-products.json`);
      
      // 統計資料
      const stats = {
        總數量: macProducts.length,
        產品類型: {},
        晶片類型: {},
        記憶體規格: {},
        儲存規格: {}
      };
      
      macProducts.forEach(product => {
        const specs = product.specs;
        if (specs.productType) stats.產品類型[specs.productType] = (stats.產品類型[specs.productType] || 0) + 1;
        if (specs.chip) stats.晶片類型[specs.chip] = (stats.晶片類型[specs.chip] || 0) + 1;
        if (specs.memory) stats.記憶體規格[specs.memory] = (stats.記憶體規格[specs.memory] || 0) + 1;
        if (specs.storage) stats.儲存規格[specs.storage] = (stats.儲存規格[specs.storage] || 0) + 1;
      });
      
      console.log('\n統計資料：');
      console.log(JSON.stringify(stats, null, 2));
    } else {
      console.log('未找到Mac產品資料');
    }
    
  } catch (error) {
    console.error('程式執行錯誤:', error);
  } finally {
    await scraper.close();
  }
}

if (require.main === module) {
  main();
}

module.exports = AppleRefurbishedScraper;