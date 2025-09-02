# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an Apple refurbished products tracker and notification system that scrapes Apple Taiwan's refurbished products page and sends notifications via LINE Bot, email, or webhooks when products matching specific criteria become available.

## Key Commands

```bash
# Start the application
npm start
npm run dev

# Development
npm run test  # Currently returns error - no tests configured
```

## Architecture

### Core Components

- **app.js** - Main Express server with web API and LINE Bot webhook handling
- **services/firebase.js** - Firebase Firestore integration for user data and tracking rules
- **services/notifications/** - Notification system with pluggable providers:
  - NotificationManager.js - Central notification orchestrator
  - LineNotificationProvider.js - LINE Messaging API integration
  - EmailNotificationProvider.js - SMTP email notifications
  - NotificationProvider.js - Base provider interface

### Configuration System

- **config.json** - User configuration (not in repo, created from config.example.json)
- **config.example.json** - Template showing structure for LINE/email config and tracking rules
- Firebase service account key in firebase-service-account.json (not in repo)

### Web Scraping

Uses Puppeteer to scrape Apple Taiwan refurbished products page, parsing JSON-LD structured data for accurate product information including:
- Product types (MacBook Air, MacBook Pro, Mac Studio, Mac mini)
- Chip types (M2, M3, M4, M4 Pro, M4 Max, M4 Ultra)
- Memory, storage, color, price specifications

### Notification Flow

1. Products scraped from Apple website
2. Matched against user tracking rules stored in Firebase
3. New matches trigger notifications via configured providers
4. Results stored in Firebase with timestamps

## External Integrations

### LINE Bot Setup
Requires channelAccessToken and channelSecret in config.json. Users interact via commands:
- "開始追蹤" - Start tracking
- "停止追蹤" - Stop tracking  
- "狀態" - System status
- "測試" - Test connection
- "幫助" - Help

### Firebase Setup
- Firestore for user data, tracking rules, products, notifications
- Service account authentication via firebase-service-account.json
- Collections: users/{userId}/trackingRules, products, notifications

### Email Notifications
SMTP configuration in config.json with Gmail example setup.

## Development Notes

- Express server runs on PORT env var or 3000
- Static files served from public/ directory
- No linting or testing scripts currently configured
- Uses traditional require() syntax, not ES6 imports
- Chinese language interface and documentation