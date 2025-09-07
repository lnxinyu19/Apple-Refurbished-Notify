require("dotenv").config();
const express = require("express");
const puppeteer = require("puppeteer");
const path = require("path");
const { exec } = require("child_process");
const line = require("@line/bot-sdk");
const FirebaseService = require("./services/firebase");
const NotificationManager = require("./services/notifications/NotificationManager");

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
    this.app.use(express.static("public"));
    this.app.use(express.json());

    this.app.get("/health", (req, res) => {
      res.json({ status: "ok", timestamp: new Date().toISOString() });
    });

    this.app.get("/api/version", (req, res) => {
      const pkg = require("./package.json");
      res.json({
        version: pkg.version,
        name: pkg.name,
      });
    });

    // LIFF 設定端點
    this.app.get("/api/liff-config", (req, res) => {
      res.json({
        liffId: process.env.LINE_LIFF_ID || null,
      });
    });

    // LINE Login 設定端點
    this.app.get("/api/line-login-config", (req, res) => {
      res.json({
        channelId: process.env.LINE_LOGIN_CHANNEL_ID || null,
        redirectUri: process.env.LINE_LOGIN_REDIRECT_URI || null,
      });
    });

    // 開發環境設定端點
    this.app.get("/api/dev-config", (req, res) => {
      res.json({
        showTestFeatures: process.env.NODE_ENV !== "production" || process.env.SHOW_TEST_FEATURES === "true",
        environment: process.env.NODE_ENV || "development"
      });
    });

    // LINE Login 授權端點
    this.app.get("/auth/line", (req, res) => {
      const channelId = process.env.LINE_LOGIN_CHANNEL_ID;
      const redirectUri = encodeURIComponent(
        process.env.LINE_LOGIN_REDIRECT_URI
      );
      const state = Math.random().toString(36).substring(2, 15);

      req.session = { ...req.session, lineLoginState: state };

      const authUrl = `https://access.line.me/oauth2/v2.1/authorize?response_type=code&client_id=${channelId}&redirect_uri=${redirectUri}&state=${state}&scope=profile%20openid`;

      res.redirect(authUrl);
    });

    // LINE Login 回調端點
    this.app.get("/auth/line/callback", async (req, res) => {
      try {
        const { code, state } = req.query;

        if (!code) {
          return res.redirect("/?error=no_code");
        }

        // 獲取 access token
        const tokenResponse = await fetch(
          "https://api.line.me/oauth2/v2.1/token",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              grant_type: "authorization_code",
              code: code,
              redirect_uri: process.env.LINE_LOGIN_REDIRECT_URI,
              client_id: process.env.LINE_LOGIN_CHANNEL_ID,
              client_secret:
                process.env.LINE_LOGIN_CHANNEL_SECRET ||
                process.env.LINE_CHANNEL_SECRET,
            }),
          }
        );

        const tokenData = await tokenResponse.json();

        if (tokenData.error) {
          return res.redirect(`/?error=${tokenData.error}`);
        }

        // 獲取用戶資訊
        const profileResponse = await fetch("https://api.line.me/v2/profile", {
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
        const userInfo = encodeURIComponent(
          JSON.stringify({
            userId: profile.userId,
            displayName: profile.displayName,
            pictureUrl: profile.pictureUrl,
            loginMethod: "line-login",
          })
        );

        res.redirect(`/?user=${userInfo}`);
      } catch (error) {
        console.error("LINE Login 回調錯誤:", error);
        res.redirect("/?error=callback_error");
      }
    });

    // 用戶專屬配置 API
    this.app.get("/api/users/:userId/config", async (req, res) => {
      try {
        const userId = req.params.userId;

        if (!this.firebaseService.initialized) {
          return res.json({ trackingRules: [], summarySettings: {} });
        }

        const [rules, user] = await Promise.all([
          this.firebaseService.getUserTrackingRules(userId),
          this.firebaseService.getOrCreateUser(userId)
        ]);
        
        res.json({ 
          trackingRules: rules,
          summarySettings: user.summarySettings || {}
        });
      } catch (error) {
        console.error("取得用戶配置錯誤:", error);
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post("/api/users/:userId/config", async (req, res) => {
      try {
        const userId = req.params.userId;
        const { trackingRules, summarySettings } = req.body;

        if (!this.firebaseService.initialized) {
          return res.status(503).json({ error: "Firebase 未連接" });
        }

        await this.firebaseService.getOrCreateUser(userId);

        // 儲存摘要設定
        if (summarySettings !== undefined) {
          await this.firebaseService.updateUserSummarySettings(userId, summarySettings);
        }

        // 處理追蹤規則
        if (trackingRules && Array.isArray(trackingRules)) {
          const existingRules = await this.firebaseService.getUserTrackingRules(
            userId
          );
          const existingRuleIds = new Set(existingRules.map((r) => r.id));
          const newRuleIds = new Set(trackingRules.map((r) => r.id));

          for (const rule of existingRules) {
            if (!newRuleIds.has(rule.id)) {
              await this.firebaseService.deleteTrackingRule(userId, rule.id);
            }
          }

          // 新增或更新規則
          for (const rule of trackingRules) {
            if (existingRuleIds.has(rule.id)) {
              await this.firebaseService.updateTrackingRule(
                userId,
                rule.id,
                rule
              );
            } else {
              const createdId = await this.firebaseService.addTrackingRule(
                userId,
                rule
              );
            }
          }
        }

        res.json({ success: true, message: "配置已儲存" });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // 刪除單一追蹤規則
    this.app.delete("/api/users/:userId/rules/:ruleId", async (req, res) => {
      try {
        const { userId, ruleId } = req.params;

        if (!this.firebaseService.initialized) {
          return res.status(503).json({ error: "Firebase 未連接" });
        }

        await this.firebaseService.deleteTrackingRule(userId, ruleId);
        res.json({ success: true, message: "規則已刪除" });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post("/api/users/:userId/test-summary", async (req, res) => {
      try {
        const { userId } = req.params;

        if (!this.firebaseService.initialized) {
          return res.status(503).json({ error: "Firebase 未連接" });
        }

        // 調用現有的測試摘要方法
        const summaryMessage = await this.testDailySummary(userId);
        
        // 解析摘要內容，提供更結構化的回應
        const lines = summaryMessage.split('\n');
        let summary = null;
        let products = [];
        
        // 尋找摘要內容
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line.includes('測試摘要內容:')) {
            // 從分隔線後開始抓取摘要
            const dashLineIndex = lines.findIndex((l, idx) => idx > i && l.includes('─'));
            if (dashLineIndex !== -1) {
              summary = lines.slice(dashLineIndex + 1).join('\n').trim();
            }
            break;
          }
        }

        // 嘗試獲取昨天的產品數據來提供更好的展示
        try {
          const yesterday = new Date();
          yesterday.setDate(yesterday.getDate() - 1);
          const recentProducts = await this.firebaseService.getProductsFromDate(yesterday);
          products = recentProducts.slice(0, 5); // 限制顯示前5個產品
        } catch (error) {
          console.log('無法獲取產品數據:', error);
        }

        res.json({ 
          success: true,
          message: "測試摘要已生成",
          summary: summary || summaryMessage,
          products: products
        });
      } catch (error) {
        console.error('測試摘要API失敗:', error);
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post("/api/track/start", async (req, res) => {
      try {
        if (this.isTracking) {
          return res.json({ error: "已在追蹤中" });
        }

        await this.startTracking();
        res.json({ success: true, message: "開始追蹤" });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post("/api/track/stop", async (req, res) => {
      await this.stopTracking();
      res.json({ success: true, message: "停止追蹤" });
    });

    this.app.get("/api/track/status", async (req, res) => {
      const stats = await this.firebaseService.getSystemStats();
      const systemState = this.firebaseService.initialized
        ? await this.firebaseService.getSystemState()
        : { isTracking: false };

      res.json({
        isTracking: this.isTracking,
        rulesCount: stats.activeRules,
        usersCount: stats.totalUsers,
        autoRestarted: systemState.isTracking && this.isTracking,
      });
    });

    this.app.get("/api/products/test", async (req, res) => {
      try {
        const allProducts = await this.scrapeProducts();

        res.json({
          message: `找到 ${allProducts.length} 個產品`,
          total: allProducts.length,
          products: allProducts,
        });
      } catch (error) {
        console.error("測試產品爬取錯誤:", error);
        res.status(500).json({ error: error.message });
      }
    });


    this.app.post("/webhook/line", express.json(), async (req, res) => {
      try {
        if (!req.body.events || req.body.events.length === 0) {
          return res.status(200).json([]);
        }

        const results = await Promise.all(
          req.body.events.map(this.handleLineEvent.bind(this))
        );
        res.status(200).json(results);
      } catch (error) {
        console.error("❌ LINE webhook錯誤:", error.message);
        res.status(200).json([]);
      }
    });
  }

  async init() {
    await this.loadConfig();

    const firebaseReady = await this.firebaseService.initialize();

    await this.notificationManager.initialize({
      line: this.config.lineConfig,
      email: this.config.emailConfig || { enabled: false },
    });

    this.browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    // 檢查並自動重啟追蹤
    if (firebaseReady) {
      const systemState = await this.firebaseService.getSystemState();
      console.log("系統狀態檢查:", { 
        savedState: systemState.isTracking, 
        currentState: this.isTracking 
      });
      
      if (systemState.isTracking && !this.isTracking) {
        console.log("🔄 服務重啟，自動重新啟動追蹤");
        await this.startTracking();
      } else if (systemState.isTracking && this.isTracking) {
        console.log("✅ 追蹤狀態已同步");
      } else {
        console.log("ℹ️ 系統未設定為追蹤模式");
      }
    }

    console.log("服務已初始化");
    if (!firebaseReady) {
      console.log("Firebase未連接，部分功能可能無法使用");
    }
    
    if (firebaseReady) {
      this.startSummaryScheduler();
    }
  }

  async loadConfig() {
    this.config = {
      lineConfig: {
        channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || "",
        channelSecret: process.env.LINE_CHANNEL_SECRET || "",
      },
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
      console.error("新產品檢測失敗:", error.message);
      return [];
    }
  }

  // 獲取產品的唯一標識符（移除 URL 中的動態參數）
  getProductKey(url) {
    return url.split("?")[0]; // 移除查詢參數，只保留基礎 URL
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
        message = `🆕 發現 ${newProducts.length} 個新整修產品！\n`;
        if (totalBatches > 1) {
          message += `📄 第 ${batchNumber}/${totalBatches} 批\n\n`;
        } else {
          message += "\n";
        }
      } else {
        message = `📄 第 ${batchNumber}/${totalBatches} 批產品：\n\n`;
      }

      for (let j = 0; j < batch.length; j++) {
        const product = batch[j];
        const globalIndex = i + j + 1;

        const shortName = product.name
          .replace(/整修品.*$/, "")
          .replace(/Apple\s*/gi, "")
          .trim();

        message += `${globalIndex}. ${shortName}\n`;
        message += `💰 ${product.price}\n`;
        
        // 顯示匹配的規則
        if (product.matchingRules && product.matchingRules.length > 0) {
          if (product.matchingRules.length === 1) {
            message += `📋 符合規則: ${product.matchingRules[0]}\n`;
          } else {
            message += `📋 符合規則: ${product.matchingRules.join(', ')}\n`;
          }
        }

        if (product.url) {
          const shortUrl = await this.shortenUrl(product.url);
          message += `🔗 ${shortUrl}\n`;
        }
        message += "\n";
      }

      messages.push(message.trim());
    }

    return messages;
  }

  async shortenUrl(url) {
    try {
      const response = await fetch(
        `https://is.gd/create.php?format=simple&url=${encodeURIComponent(url)}`
      );
      const shortUrl = await response.text();

      if (
        shortUrl.startsWith("https://is.gd/") &&
        !shortUrl.includes("Error")
      ) {
        return shortUrl;
      }

      return url;
    } catch (error) {
      console.error("URL縮短失敗:", error);
      return url;
    }
  }

  async handleLineEvent(event) {
    if (event.type === "follow") {
      const userId = event.source.userId;
      await this.registerUser(userId);
      return null;
    }

    if (event.type !== "message" || event.message.type !== "text") {
      return null;
    }

    const userId = event.source.userId;
    const messageText = event.message.text.trim();

    await this.registerUser(userId);

    let replyMessage = "";

    try {
      switch (messageText.toLowerCase()) {
        case "/start":
          if (this.isTracking) {
            replyMessage = "⚠️ 系統已在追蹤中";
          } else {
            await this.startTracking();
            replyMessage =
              "✅ 開始追蹤 Apple 整修產品\n📱 有新品時會立即通知您";
          }
          break;

        case "/stop":
          if (!this.isTracking) {
            replyMessage = "⚠️ 系統目前未在追蹤";
          } else {
            await this.stopTracking();
            replyMessage = "⏹️ 已停止追蹤";
          }
          break;

        case "/status":
          replyMessage = await this.getStatusMessage();
          break;

        case "/help":
          replyMessage = this.getHelpMessage();
          break;

        case "/test":
          replyMessage = "🧪 測試通知\n✅ 系統運作正常！";
          break;
          
        case "/test-summary":
          replyMessage = await this.testDailySummary(userId);
          break;
          
        case "/force-summary":
          replyMessage = await this.forceSendSummary(userId);
          break;

        case "/rules":
          replyMessage = await this.getUserRulesMessage(userId);
          break;

        case "/add":
          const liffId = process.env.LINE_LIFF_ID;
          if (liffId) {
            replyMessage = `📝 請使用 LINE 網頁介面設定個人追蹤規則:\nhttps://liff.line.me/${liffId}\n\n✨ 自動識別身份，無需額外設定`;
          } else {
            const webUrl = process.env.WEB_URL || "http://localhost:3000";
            replyMessage = `📝 請使用網頁介面新增追蹤規則:\n${webUrl}\n\n⚠️ 提醒：請先設定 LIFF ID 以便識別身份`;
          }
          break;

        case "/delete":
          replyMessage = await this.getDeleteRulesMessage(userId);
          break;

        default:
          // 檢查是否是刪除規則指令格式: /delete 1 或 delete 1
          const deleteMatch = messageText.match(
            /^(?:\/delete|\/remove|\/del|delete\s+rule|remove\s+rule)\s+(\d+)$/i
          );
          if (deleteMatch) {
            const ruleNumber = parseInt(deleteMatch[1]);
            replyMessage = await this.deleteRuleByNumber(userId, ruleNumber);
          } else {
            replyMessage = "❓ 不認識的指令\n請輸入「/help」查看可用指令";
          }
      }

      if (replyMessage) {
        const lineProvider = this.notificationManager.getProvider("line");
        if (lineProvider) {
          await lineProvider.replyMessage(event.replyToken, replyMessage);
        }
      }
    } catch (error) {
      console.error("處理LINE事件錯誤:", error);
      const lineProvider = this.notificationManager.getProvider("line");
      if (lineProvider) {
        await lineProvider.replyMessage(
          event.replyToken,
          "❌ 系統發生錯誤，請稍後再試"
        );
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
      return `📊 系統狀態\n\n🎯 追蹤狀態: ${
        this.isTracking ? "運行中" : "已停止"
      }\n⚠️  Firebase未連接`;
    }

    const stats = await this.firebaseService.getSystemStats();

    let message = `📊 系統狀態\n\n`;
    message += `🎯 追蹤狀態: ${this.isTracking ? "運行中" : "已停止"}\n`;
    message += `📋 啟用規則: ${stats.activeRules} 個\n`;
    message += `👥 註冊使用者: ${stats.totalUsers} 人\n`;
    message += `📤 24小時通知: ${stats.notificationsLast24h} 則`;

    return message;
  }

  async getUserRulesMessage(userId) {
    if (!this.firebaseService.initialized) {
      const liffId = process.env.LINE_LIFF_ID;
      if (liffId) {
        return `📋 您的追蹤規則\n\n⚠️  Firebase未連接，無法顯示個人規則\n\n📝 請透過 LINE 網頁設定個人規則:\nhttps://liff.line.me/${liffId}`;
      } else {
        const webUrl = process.env.WEB_URL || "http://localhost:3000";
        return `📋 您的追蹤規則\n\n⚠️  Firebase未連接\n📝 請使用網頁介面:\n${webUrl}`;
      }
    }

    try {
      const rules = await this.firebaseService.getUserTrackingRules(userId);

      if (rules.length === 0) {
        const liffId = process.env.LINE_LIFF_ID;
        if (liffId) {
          return `📋 您目前沒有設定追蹤規則\n\n📝 請透過 LINE 網頁設定個人規則:\nhttps://liff.line.me/${liffId}\n\n✨ 點選連結會自動識別身份`;
        } else {
          const webUrl = process.env.WEB_URL || "http://localhost:3000";
          return `📋 您目前沒有設定追蹤規則\n\n📝 請使用網頁介面新增規則:\n${webUrl}\n\n⚠️ 建議設定 LIFF 以啟用個人規則功能`;
        }
      }

      let message = `📋 您的追蹤規則 (${rules.length} 個):\n\n`;

      rules.forEach((rule, index) => {
        message += `${index + 1}. ${rule.name}\n`;
        if (rule.filters.productType)
          message += `   📱 產品: ${rule.filters.productType}\n`;
        if (rule.filters.chip) message += `   🔧 晶片: ${rule.filters.chip}\n`;
        if (rule.filters.minMemory)
          message += `   💾 記憶體: ≥${rule.filters.minMemory}GB\n`;
        if (rule.filters.maxPrice)
          message += `   💰 價格: ≤NT$${rule.filters.maxPrice.toLocaleString()}\n`;
        message += "\n";
      });

      return message;
    } catch (error) {
      console.error("取得用戶規則錯誤:", error);
      return "❌ 無法取得規則列表";
    }
  }

  async getDeleteRulesMessage(userId) {
    if (!this.firebaseService.initialized) {
      return "❌ Firebase未連接，無法刪除規則";
    }

    try {
      const rules = await this.firebaseService.getUserTrackingRules(userId);

      if (rules.length === 0) {
        return "📋 您目前沒有任何追蹤規則可以刪除";
      }

      let message = `🗑️ 選擇要刪除的規則 (${rules.length} 個):\n\n`;

      rules.forEach((rule, index) => {
        message += `${index + 1}. ${rule.name}\n`;
        if (rule.filters.productType)
          message += `   📱 ${rule.filters.productType}`;
        if (rule.filters.chip) message += ` ${rule.filters.chip}`;
        if (rule.filters.minMemory) message += ` ≥${rule.filters.minMemory}GB`;
        message += "\n\n";
      });

      message += "💬 使用方式:\n";
      message += '• 輸入 "/delete 1" 刪除第1個規則\n';
      message += '• 輸入 "/delete 2" 刪除第2個規則\n';
      message += "• 以此類推...";

      return message;
    } catch (error) {
      console.error("取得刪除規則列表錯誤:", error);
      return "❌ 無法取得規則列表";
    }
  }

  async deleteRuleByNumber(userId, ruleNumber) {
    if (!this.firebaseService.initialized) {
      return "❌ Firebase未連接，無法刪除規則";
    }

    try {
      const rules = await this.firebaseService.getUserTrackingRules(userId);

      if (rules.length === 0) {
        return "📋 您目前沒有任何追蹤規則";
      }

      if (ruleNumber < 1 || ruleNumber > rules.length) {
        return `❌ 無效的規則編號。請輸入 1 到 ${rules.length} 之間的數字`;
      }

      const ruleToDelete = rules[ruleNumber - 1];
      await this.firebaseService.deleteTrackingRule(userId, ruleToDelete.id);

      return `✅ 已成功刪除規則：${ruleToDelete.name}`;
    } catch (error) {
      console.error("刪除規則錯誤:", error);
      return "❌ 刪除規則失敗，請稍後再試";
    }
  }

  getHelpMessage() {
    const activeProviders = this.notificationManager.getActiveProviderNames();
    const liffId = process.env.LINE_LIFF_ID;

    return (
      `🤖 Apple 整修機追蹤 Bot\n\n` +
      `📱 可用指令:\n` +
      `• /start - 開始監控新品\n` +
      `• /stop - 停止監控\n` +
      `• /status - 查看系統狀態\n` +
      `• /rules - 查看個人追蹤規則\n` +
      `• /add - 設定個人追蹤規則\n` +
      `• /delete - 刪除追蹤規則\n` +
      `• /delete 1 - 刪除第1個規則\n` +
      `• /test - 測試Bot連接\n` +
      `• /test-summary - 測試每日摘要功能\n` +
      `• /help - 顯示此訊息\n\n` +
      `📤 啟用通知方式: ${activeProviders.join(", ")}\n\n` +
      (liffId
        ? `📱 個人規則設定: https://liff.line.me/${liffId}`
        : `⚠️ 請設定 LIFF ID 以啟用個人規則功能`)
    );
  }

  async scrapeProducts() {
    const page = await this.browser.newPage();

    try {
      const urls = [
        "https://www.apple.com/tw/shop/refurbished/mac",
        "https://www.apple.com/tw/shop/refurbished/ipad",
        "https://www.apple.com/tw/shop/refurbished/appletv",
      ];

      let allProducts = [];

      for (const url of urls) {
        try {
          await page.goto(url, { waitUntil: "networkidle2" });
          await new Promise((resolve) => setTimeout(resolve, 2000));

          const products = await page.evaluate((currentUrl) => {
            const productData = [];

            const links = document.querySelectorAll(
              'a[href*="/shop/product/"]'
            );

            const refurbishedLinks = Array.from(links).filter((a) => {
              const href = a.href.toLowerCase();
              const text = a.textContent.toLowerCase();

              const isRefurbished =
                href.includes("refurbished") ||
                text.includes("整修品") ||
                text.includes("整修");

              if (isRefurbished && text.trim().length > 0) {
                return true;
              }
              return false;
            });

            refurbishedLinks.forEach((link, index) => {
              try {
                const name = link.textContent.trim();

                let price = "";
                let currentElement = link.parentElement;
                let searchDepth = 0;

                while (currentElement && searchDepth < 6) {
                  const containerText = currentElement.textContent || "";
                  const priceMatch = containerText.match(/NT\$[\d,]+/);
                  if (priceMatch) {
                    price = priceMatch[0];
                    break;
                  }
                  currentElement = currentElement.parentElement;
                  searchDepth++;
                }

                let image = "";
                const parentContainer = link.closest("div");
                if (parentContainer) {
                  const imgElement = parentContainer.querySelector("img");
                  if (imgElement) {
                    image =
                      imgElement.src ||
                      imgElement.getAttribute("data-src") ||
                      "";
                  }
                }

                if (name.length > 0) {
                  productData.push({
                    name: name,
                    price: price || "價格未找到",
                    image: image || "",
                    description: name,
                    url: link.href,
                    category: currentUrl.includes("/mac")
                      ? "Mac"
                      : currentUrl.includes("/ipad")
                      ? "iPad"
                      : currentUrl.includes("/appletv")
                      ? "Apple TV"
                      : "Other",
                  });
                }
              } catch (e) {}
            });

            return productData;
          }, url);

          allProducts = allProducts.concat(products);
        } catch (error) {
          console.error(`爬取 ${url} 失敗:`, error.message);
        }
      }

      const productsWithSpecs = allProducts.map((product) => ({
        ...product,
        specs: this.parseSpecs(
          product.name,
          product.description,
          product.category
        ),
      }));

      return productsWithSpecs;
    } catch (error) {
      console.error("爬取錯誤:", error);
      return [];
    } finally {
      await page.close();
    }
  }

  parseSpecs(name, description, category) {
    const normalizedName = name ? name.replace(/\u00A0/g, " ") : "";
    const normalizedDescription = description
      ? description.replace(/\u00A0/g, " ")
      : "";

    const specs = {
      screenSize: null,
      chip: null,
      memory: null,
      storage: null,
      color: null,
      productType: null,
      category: category || "Other",
    };

    if (normalizedName.includes("MacBook Air"))
      specs.productType = "MacBook Air";
    else if (normalizedName.includes("MacBook Pro"))
      specs.productType = "MacBook Pro";
    else if (normalizedName.includes("Mac Studio"))
      specs.productType = "Mac Studio";
    else if (normalizedName.includes("Mac mini"))
      specs.productType = "Mac mini";
    else if (normalizedName.includes("iMac")) specs.productType = "iMac";
    else if (normalizedName.includes("iPad Pro"))
      specs.productType = "iPad Pro";
    else if (normalizedName.includes("iPad Air"))
      specs.productType = "iPad Air";
    else if (normalizedName.includes("iPad mini"))
      specs.productType = "iPad mini";
    else if (normalizedName.includes("iPad")) specs.productType = "iPad";
    else if (normalizedName.includes("Apple TV"))
      specs.productType = "Apple TV";

    const sizeMatch = normalizedName.match(/(\d+)\s*吋/);
    if (sizeMatch) specs.screenSize = sizeMatch[1] + "吋";

    const chipPatterns = [
      /Apple (M\d+(?:\s+(?:Pro|Max|Ultra))?)/,
      /(M\d+(?:\s+(?:Pro|Max|Ultra))?)\s*晶片/,
      /(M\d+(?:\s+(?:Pro|Max|Ultra))?)/,
    ];

    for (const pattern of chipPatterns) {
      const chipMatch =
        normalizedName.match(pattern) || normalizedDescription.match(pattern);
      if (chipMatch) {
        specs.chip = chipMatch[1]
          .replace("Apple ", "")
          .replace("晶片", "")
          .trim();
        break;
      }
    }

    const memoryPatterns = [
      /(\d+)GB\s*統一記憶體/,
      /(\d+)GB\s*記憶體/,
      /(\d+)\s*GB/,
    ];

    for (const pattern of memoryPatterns) {
      const memoryMatch =
        normalizedDescription.match(pattern) || normalizedName.match(pattern);
      if (memoryMatch) {
        specs.memory = memoryMatch[1] + "GB";
        break;
      }
    }

    const storagePatterns = [
      /(\d+(?:\.\d+)?)TB/,
      /(\d+)GB.*SSD/,
      /(\d+)GB\s*儲存/,
    ];

    for (const pattern of storagePatterns) {
      const storageMatch =
        normalizedDescription.match(pattern) || normalizedName.match(pattern);
      if (storageMatch) {
        if (pattern.toString().includes("TB")) {
          specs.storage = storageMatch[1] + "TB";
        } else {
          specs.storage = storageMatch[1] + "GB";
        }
        break;
      }
    }

    const colors = [
      "銀色",
      "太空灰色",
      "太空黑色",
      "星光色",
      "午夜色",
      "天藍色",
    ];
    for (const color of colors) {
      if (normalizedName.includes(color)) {
        specs.color = color;
        break;
      }
    }

    return specs;
  }

  filterProducts(products, filters) {
    return products.filter((product) => {
      const specs = product.specs;

      if (filters.productType && specs.productType !== filters.productType)
        return false;
      if (filters.chip && specs.chip !== filters.chip) return false;
      if (filters.color && specs.color !== filters.color) return false;

      if (filters.minMemory) {
        const productMemory = parseInt(specs.memory);
        if (isNaN(productMemory) || productMemory < filters.minMemory)
          return false;
      }

      if (filters.maxPrice) {
        const price = parseInt(product.price?.replace(/[^\d]/g, "") || "0");
        if (price > filters.maxPrice) return false;
      }

      return true;
    });
  }

  async startTracking() {
    this.isTracking = true;
    console.log("🎯 開始追蹤產品...");

    if (this.firebaseService.initialized) {
      console.log("💾 保存追蹤狀態到 Firebase...");
      await this.firebaseService.saveSystemState(true);
      console.log("✅ 追蹤狀態已保存");
    } else {
      console.log("⚠️ Firebase 未初始化，無法保存追蹤狀態");
    }

    await this.trackProducts();

    this.trackingInterval = setInterval(async () => {
      await this.trackProducts();
    }, 60 * 60 * 1000);
    
    console.log("⏱️ 追蹤定時器已啟動（每小時檢查一次）");
  }

  async stopTracking() {
    this.isTracking = false;
    console.log("⏹️ 停止追蹤產品...");
    
    if (this.trackingInterval) {
      clearInterval(this.trackingInterval);
      this.trackingInterval = null;
      console.log("⏱️ 追蹤定時器已停止");
    }

    if (this.firebaseService.initialized) {
      console.log("💾 保存停止狀態到 Firebase...");
      await this.firebaseService.saveSystemState(false);
      console.log("✅ 停止狀態已保存");
    } else {
      console.log("⚠️ Firebase 未初始化，無法保存停止狀態");
    }
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
          notifiedUsers: 0,
        };
      }

      const activeUsers = await this.firebaseService.getActiveUsers();
      console.log(`📋 找到 ${activeUsers.length} 位活躍用戶`);

      const allNewMatches = [];
      let notifiedUsersCount = 0;

      for (const user of activeUsers) {
        const userRules = await this.firebaseService.getUserTrackingRules(
          user.lineUserId
        );
        console.log(`👤 用戶 ${user.lineUserId} 有 ${userRules.length} 個追蹤規則`);

        const productRuleMap = new Map(); // 記錄每個產品匹配到的規則

        for (const rule of userRules) {
          const newMatches = this.filterProducts(newProducts, rule.filters);

          for (const product of newMatches) {
            if (!productRuleMap.has(product.url)) {
              productRuleMap.set(product.url, {
                product: product,
                matchingRules: []
              });
            }
            productRuleMap.get(product.url).matchingRules.push(rule.name);
          }
        }

        // 將產品和對應的規則資訊轉換為陣列
        const userNewMatches = Array.from(productRuleMap.values()).map(item => ({
          ...item.product,
          matchingRules: item.matchingRules
        }));

        if (userNewMatches.length > 0) {
          const messages = await this.formatNewProductMessage(userNewMatches);
          if (messages && messages.length > 0) {
            const productIds = userNewMatches.map((p) =>
              this.firebaseService.getProductId(p.url)
            );

            for (let i = 0; i < messages.length; i++) {
              const message = messages[i];
              try {
                const results = await this.notificationManager.sendNotification(
                  user,
                  message,
                  {
                    productIds,
                    batchInfo: { current: i + 1, total: messages.length },
                  }
                );

                for (const result of results) {
                  if (result.success) {
                    await this.firebaseService.saveNotification(
                      user.lineUserId,
                      message,
                      productIds
                    );
                    if (i === 0) notifiedUsersCount++;
                  }
                }

                if (i < messages.length - 1) {
                  await new Promise((resolve) => setTimeout(resolve, 1000));
                }
              } catch (error) {
                console.error(`❌ 發送第${i + 1}批訊息失敗:`, error.message);
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
        notifiedUsers: notifiedUsersCount,
      };
    } catch (error) {
      console.error("❌ 追蹤錯誤:", error);
      return {
        totalProducts: 0,
        newProducts: 0,
        totalNewMatches: 0,
        notifiedUsers: 0,
      };
    }
  }

  async start() {
    await this.init();

    this.app.listen(this.port, () => {
      console.log(`🌐 伺服器啟動於 http://localhost:${this.port}`);

      const platform = process.platform;
      const command =
        platform === "darwin"
          ? "open"
          : platform === "win32"
          ? "start"
          : "xdg-open";

      exec(`${command} http://localhost:${this.port}`, (error) => {
        if (error) {
        }
      });
    });
  }

  // 摘要通知排程
  startSummaryScheduler() {
    // 每10分鐘檢查一次是否需要發送摘要
    this.summaryInterval = setInterval(async () => {
      try {
        await this.sendDailySummary();
      } catch (error) {
        console.error('摘要通知檢查失敗:', error);
      }
    }, 10 * 60 * 1000);
    
    // 立即檢查一次
    setTimeout(async () => {
      try {
        await this.sendDailySummary();
      } catch (error) {
        console.error('初始摘要通知檢查失敗:', error);
      }
    }, 5000);
  }

  // 摘要通知功能
  async sendDailySummary() {
    try {
      const activeUsers = await this.firebaseService.getActiveUsers();
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const today = new Date().toISOString().split('T')[0];
      
      for (const user of activeUsers) {
        const summarySettings = user.summarySettings?.dailySummary;
        if (!summarySettings?.enabled) continue;
        
        // 檢查是否今天已經發送過摘要
        const lastSentDate = user.lastSummaryDate;
        if (lastSentDate === today) continue;
        
        // 檢查時間是否匹配
        const now = new Date();
        const [hour, minute] = summarySettings.time.split(':');
        const scheduledHour = parseInt(hour);
        const scheduledMinute = parseInt(minute);
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();
        
        // 計算當前時間的總分鐘數和預定時間的總分鐘數
        const currentTotalMinutes = currentHour * 60 + currentMinute;
        const scheduledTotalMinutes = scheduledHour * 60 + scheduledMinute;
        
        // 檢查是否已經過了預定時間（允許10分鐘的誤差範圍）
        const timeMatched = currentTotalMinutes >= scheduledTotalMinutes && 
                           currentTotalMinutes <= scheduledTotalMinutes + 10;
        
        if (!timeMatched) continue;
        
        const summary = await this.generateDailySummary(yesterday);
        if (summary) {
          await this.notificationManager.sendNotification(user, summary);
          await this.firebaseService.updateUserLastSummaryDate(user.lineUserId, today);
        }
      }
    } catch (error) {
      console.error('發送每日摘要失敗:', error);
    }
  }

  async generateDailySummary(date) {
    try {
      const newProducts = await this.firebaseService.getProductsFromDate(date);
      let totalProducts = await this.firebaseService.getAllProducts();
      
      // 如果 Firebase 中沒有產品資料，直接爬取當前產品數量
      if (totalProducts.length === 0) {
        const currentProducts = await this.scrapeProducts();
        totalProducts = currentProducts;
      }
      
      if (newProducts.length === 0) {
        return `📊 每日摘要 (${date.toLocaleDateString('zh-TW')})\n\n昨日沒有新的整修產品上架。\n📱 目前總數: ${totalProducts.length} 個`;
      }
      
      const categories = this.categorizeProducts(newProducts);
      
      let message = `📊 每日摘要 (${date.toLocaleDateString('zh-TW')})\n\n`;
      message += `🆕 昨日新品: ${newProducts.length} 個\n`;
      message += `📱 目前總數: ${totalProducts.length} 個\n\n`;
      
      message += `📱 昨日新品分類:\n`;
      Object.entries(categories).forEach(([category, count]) => {
        message += `• ${category}: ${count} 個\n`;
      });
      
      // 顯示熱門產品（前3個）
      if (newProducts.length > 0) {
        message += `\n🔥 熱門新品:\n`;
        newProducts.slice(0, 3).forEach((product, index) => {
          const shortName = product.name
            .replace(/整修品.*$/, "")
            .replace(/Apple\s*/gi, "")
            .trim();
          message += `${index + 1}. ${shortName}\n   💰 ${product.price}\n`;
        });
      }
      
      return message;
    } catch (error) {
      console.error('生成每日摘要失敗:', error);
      return null;
    }
  }

  // 測試摘要功能
  async testDailySummary(userId) {
    try {
      console.log(`開始測試用戶 ${userId} 的摘要功能`);
      
      // 獲取用戶資料
      const user = await this.firebaseService.getUser(userId);
      if (!user) {
        return "❌ 找不到用戶資料";
      }
      
      console.log('用戶資料:', user);
      
      // 檢查摘要設定
      const summarySettings = user.summarySettings?.dailySummary;
      if (!summarySettings?.enabled) {
        return "❌ 每日摘要功能未啟用\n請先到網頁設定中啟用摘要功能";
      }
      
      // 顯示設定資訊
      let testMessage = "🧪 摘要功能測試\n\n";
      testMessage += `✅ 摘要功能已啟用\n`;
      testMessage += `⏰ 設定時間: ${summarySettings.time}\n`;
      testMessage += `📅 上次發送: ${user.lastSummaryDate || '從未發送'}\n\n`;
      
      // 生成測試摘要
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      
      console.log('開始生成測試摘要...');
      const summary = await this.generateDailySummary(yesterday);
      
      if (summary) {
        testMessage += "📊 測試摘要內容:\n";
        testMessage += "─".repeat(20) + "\n";
        testMessage += summary;
      } else {
        testMessage += "❌ 無法生成摘要內容";
      }
      
      return testMessage;
    } catch (error) {
      console.error('測試摘要功能失敗:', error);
      return "❌ 測試摘要功能時發生錯誤: " + error.message;
    }
  }

  // 強制發送摘要功能（忽略時間檢查）
  async forceSendSummary(userId) {
    try {
      console.log(`強制發送摘要給用戶 ${userId}`);
      
      // 獲取用戶資料
      const user = await this.firebaseService.getUser(userId);
      if (!user) {
        return "❌ 找不到用戶資料";
      }
      
      // 檢查摘要設定
      const summarySettings = user.summarySettings?.dailySummary;
      if (!summarySettings?.enabled) {
        return "❌ 每日摘要功能未啟用\n請先到網頁設定中啟用摘要功能";
      }
      
      // 生成摘要
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      
      const summary = await this.generateDailySummary(yesterday);
      if (!summary) {
        return "❌ 無法生成摘要內容";
      }
      
      // 直接發送摘要
      await this.notificationManager.sendNotification(user, summary);
      
      // 更新最後發送日期
      const today = new Date().toISOString().split('T')[0];
      await this.firebaseService.updateUserLastSummaryDate(user.lineUserId, today);
      
      return "✅ 摘要已強制發送！\n請檢查你的通知";
    } catch (error) {
      console.error('強制發送摘要失敗:', error);
      return "❌ 強制發送摘要時發生錯誤: " + error.message;
    }
  }

  // 產品分類方法
  categorizeProducts(products) {
    const categories = {
      'MacBook': 0,
      'iPad': 0,
      'AirPods': 0,
      'HomePod': 0,
      '其他': 0
    };

    products.forEach(product => {
      const name = product.name?.toLowerCase() || '';
      const productType = product.specs?.productType?.toLowerCase() || '';
      
      if (name.includes('macbook') || productType.includes('macbook')) {
        categories['MacBook']++;
      } else if (name.includes('ipad') || productType.includes('ipad')) {
        categories['iPad']++;
      } else if (name.includes('airpods') || productType.includes('airpods')) {
        categories['AirPods']++;
      } else if (name.includes('homepod') || productType.includes('homepod')) {
        categories['HomePod']++;
      } else {
        categories['其他']++;
      }
    });

    // 只返回有產品的分類
    return Object.fromEntries(
      Object.entries(categories).filter(([, count]) => count > 0)
    );
  }

  async cleanup() {
    await this.stopTracking();
    
    if (this.summaryInterval) {
      clearInterval(this.summaryInterval);
      this.summaryInterval = null;
    }
    
    if (this.browser) {
      await this.browser.close();
    }
  }
}

const tracker = new AppleTracker();
tracker.start();

process.on("SIGINT", async () => {
  console.log("\n正在關閉...");
  await tracker.cleanup();
  process.exit(0);
});

module.exports = AppleTracker;
