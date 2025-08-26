function formatProducts(products) {
  return products.map((product, idx) => {
    const s = product.specs || {};
    return `${idx + 1}. ${s.productType || ''} ${s.screenSize || ''} ${s.chip || ''} ${s.memory || ''} ${s.storage || ''} ${s.color || ''} - ${product.price}`.trim();
  }).join('\n');
}

function pushMessage(userId, products) {
  const message = formatProducts(products);
  console.log(`推播給 ${userId} 的產品:\n${message}`);
}

module.exports = { pushMessage };
