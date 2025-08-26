const AppleRefurbishedScraper = require('./index.js');
const fs = require('fs').promises;

async function demonstrateFiltering() {
  try {
    // 讀取已儲存的產品資料
    const data = await fs.readFile('mac-products.json', 'utf8');
    const products = JSON.parse(data);
    
    const scraper = new AppleRefurbishedScraper();
    
    console.log(`總共找到 ${products.length} 個產品\n`);
    
    // 示例1: 尋找 MacBook Air M4 晶片
    console.log('=== 示例1: MacBook Air M4 晶片 ===');
    const filter1 = {
      productType: 'MacBook Air',
      chip: 'M4'
    };
    const result1 = scraper.filterProducts(products, filter1);
    console.log(`找到 ${result1.length} 個符合條件的產品:`);
    result1.forEach((product, index) => {
      const specs = product.specs;
      console.log(`${index + 1}. ${specs.productType} ${specs.screenSize} ${specs.chip} ${specs.memory} ${specs.storage} ${specs.color} - ${product.price}`);
    });
    
    // 示例2: 尋找記憶體至少16GB的MacBook Pro
    console.log('\n=== 示例2: MacBook Pro 記憶體至少16GB ===');
    const filter2 = {
      productType: 'MacBook Pro',
      minMemory: 16
    };
    const result2 = scraper.filterProducts(products, filter2);
    console.log(`找到 ${result2.length} 個符合條件的產品:`);
    result2.slice(0, 5).forEach((product, index) => {
      const specs = product.specs;
      console.log(`${index + 1}. ${specs.productType} ${specs.screenSize} ${specs.chip} ${specs.memory} ${specs.storage} ${specs.color} - ${product.price}`);
    });
    
    // 示例3: 尋找儲存空間至少1TB、價格在50,000以下的產品
    console.log('\n=== 示例3: 儲存至少1TB、價格50,000以下 ===');
    const filter3 = {
      minStorage: '1TB',
      maxPrice: 50000
    };
    const result3 = scraper.filterProducts(products, filter3);
    console.log(`找到 ${result3.length} 個符合條件的產品:`);
    result3.slice(0, 5).forEach((product, index) => {
      const specs = product.specs;
      console.log(`${index + 1}. ${specs.productType} ${specs.screenSize} ${specs.chip} ${specs.memory} ${specs.storage} ${specs.color} - ${product.price}`);
    });
    
    // 示例4: 尋找特定顏色的產品
    console.log('\n=== 示例4: 太空黑色的產品 ===');
    const filter4 = {
      color: '太空黑色'
    };
    const result4 = scraper.filterProducts(products, filter4);
    console.log(`找到 ${result4.length} 個符合條件的產品:`);
    result4.slice(0, 3).forEach((product, index) => {
      const specs = product.specs;
      console.log(`${index + 1}. ${specs.productType} ${specs.screenSize} ${specs.chip} ${specs.memory} ${specs.storage} ${specs.color} - ${product.price}`);
    });
    
  } catch (error) {
    console.error('執行錯誤:', error);
  }
}

demonstrateFiltering();