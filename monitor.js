const { chromium } = require('playwright');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const { execSync } = require('child_process');
const nodemailer = require('nodemailer');

// --- 配置 ---
const STATE_FILE = 'server_status.json';
const CHECK_INTERVAL = 60 * 1000; // 1分钟检测一次
const MAX_RUNTIME = 4.95 * 60 * 60 * 1000; // GitHub Actions 限制运行时间
const START_TIME = Date.now();
const BROWSER_CONCURRENCY = 3; 
const CONFIRMATION_THRESHOLD = 2; // 需要连续 2 次确认状态改变

let pendingChanges = {};

// 邮件发送器配置
const transporter = nodemailer.createTransport({
  host: "smtp.qq.com",
  port: 465,
  secure: true,
  family: 4, 
  auth: {
    user: process.env.MAIL_USERNAME,
    pass: process.env.MAIL_PASSWORD
  }
});

function getTime() {
  return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

// 简单的 Curl 检测，用于快速过滤挂掉的服务器
function checkCurl(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { 
      rejectUnauthorized: false, 
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    }, (res) => {
      const { statusCode } = res;
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        const isAlive = statusCode >= 200 && statusCode < 300 && data.length > 100;
        const hash = isAlive ? crypto.createHash('sha256').update(data).digest('hex') : '';
        resolve({ 
          url, 
          statusCode, 
          hash, 
          isAlive,
          dataLength: data.length 
        });
      });
    });
    
    req.on('error', (err) => {
      // console.log(`[${getTime()}] Curl 错误 ${url}: ${err.message}`);
      resolve({ url, statusCode: 0, hash: '', isAlive: false, dataLength: 0 });
    });
    
    req.on('timeout', () => {
      req.destroy();
      resolve({ url, statusCode: 0, hash: '', isAlive: false, dataLength: 0 });
    });
  });
}

// === 核心检测逻辑 (已增强) ===
async function checkBrowserPage(browser, url) {
  let page = null;
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 },
    locale: 'en-US' // 强制英文，便于关键词匹配
  });
  
  try {
    // 添加参数跳过部分前置动画，并强制英文
    const targetUrl = url.includes('?') 
      ? url + '&skipEntranceAnyKey&locale=en' 
      : url + '?skipEntranceAnyKey&locale=en';
    
    page = await context.newPage();

    // === 检测自动刷新 (死循环检测) ===
    let refreshCount = 0;
    const navListener = (frame) => {
      if (frame === page.mainFrame() && frame.url() !== 'about:blank') {
        refreshCount++;
      }
    };
    page.on('framenavigated', navListener);

    const response = await page.goto(targetUrl, { 
      waitUntil: 'domcontentloaded', 
      timeout: 60000 // 游戏加载很慢，给 60s
    });
    
    if (!response || response.status() >= 400) {
      return { url, status: 'Offline', httpStatus: response?.status() || 0 };
    }

    // === 关键等待策略 ===
    // 1. 等待网络请求变少 (资源加载完成)
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    
    // 2. 强制等待游戏引擎解压和渲染 UI (这是检测失败的主要原因，必须等久一点)
    await page.waitForTimeout(8000); 

    if (refreshCount > 5) { // 阈值设宽一点
       console.log(`[${getTime()}] 检测到自动刷新循环 - ${url}`);
       return { url, status: 'Error', error: 'Page auto-refreshes repeatedly' };
    }
    
    // === 深度内容扫描 ===
    const frames = page.frames();
    let hasInvitation = false;
    
    // 关键词：邀请码、激活码、促销码、输入代码
    const keywordRegex = /invitation|invite code|activation|promo code|enter code|邀请码|激活码/i;

    for (const frame of frames) {
        try {
            // 1. 获取可见文本
            const visibleText = await frame.locator('body').innerText().catch(() => '');
            
            // 2. 获取 HTML 源码
            const content = await frame.content().catch(() => '');

            // 3. 【修复核心】获取所有输入框的属性 (placeholder/value/aria-label)
            // 很多游戏把 "Invitation Code" 放在 input 的 placeholder 里，innerText 抓不到
            let inputAttributes = '';
            const inputs = await frame.locator('input, textarea').all();
            for (const input of inputs) {
                const ph = await input.getAttribute('placeholder').catch(() => '') || '';
                const aria = await input.getAttribute('aria-label').catch(() => '') || '';
                const val = await input.getAttribute('value').catch(() => '') || '';
                inputAttributes += `${ph} ${aria} ${val} `;
            }

            // 综合判断
            if (
                keywordRegex.test(visibleText) || 
                keywordRegex.test(content) || 
                keywordRegex.test(inputAttributes)
            ) {
                hasInvitation = true;
                // console.log(`[${getTime()}] Debug: Found closed keyword in ${url}`);
                break; // 只要在一个 frame 找到就算
            }
        } catch (err) {
            // 忽略 frame 访问受限错误
        }
    }
    
    // 如果找到了邀请码关键字 -> Closed
    // 如果没找到，且页面加载正常 -> Open
    return { 
      url, 
      status: hasInvitation ? 'Closed' : 'Open',
      httpStatus: response.status()
    };
    
  } catch (e) {
    const msg = e.message ? e.message.toLowerCase() : "";
    
    // 区分是网络错误还是页面崩溃错误
    if (
      msg.includes('navigating') || 
      msg.includes('retrieve content') || 
      msg.includes('execution context') || 
      msg.includes('destroyed') ||
      msg.includes('timeout') ||
      msg.includes('redirect') 
    ) {
       // console.log(`[${getTime()}] 捕获不稳定状态 - ${url}: ${e.message}`);
       return { url, status: 'Error', error: e.message };
    }

    return { url, status: 'Offline', error: e.message };
  } finally {
    if (context) await context.close().catch(() => {});
  }
}

function commitAndPush() {
  try {
    execSync('git config --global user.name "github-actions[bot]"');
    execSync('git config --global user.email "github-actions[bot]@users.noreply.github.com"');
    execSync(`git add ${STATE_FILE}`);
    
    const status = execSync('git status --porcelain').toString();
    if (!status) {
      console.log(`[${getTime()}] 没有检测到状态文件变更，跳过推送。`);
      return false;
    }

    execSync('git commit -m "chore: 自动更新服务器状态 [skip ci]"');
    console.log(`[${getTime()}] 正在同步远程仓库...`);
    execSync('git pull --rebase origin main', { stdio: 'pipe' });
    execSync('git push origin main');
    console.log(`[${getTime()}] Git 状态已更新并推送成功。`);
    return true;
  } catch (e) {
    console.error(`[${getTime()}] Git 操作失败:`, e.message);
    try { execSync('git rebase --abort'); } catch (abortErr) {}
    return false;
  }
}

async function sendEmail(body) {
  if (!process.env.MAIL_USERNAME || !process.env.MAIL_PASSWORD) {
    console.log(`[${getTime()}] 未配置邮件环境变量，跳过发送。`);
    return;
  }
  try {
    await transporter.sendMail({
      from: `"3D坦克测试服监测器" <${process.env.MAIL_USERNAME}>`,
      to: process.env.MAIL_TO,
      subject: "3D坦克测试服务器状态更新",
      html: `你好，<br><br>${body}<br><br>此邮件由 GitHub Actions 自动监测发送。`
    });
    console.log(`[${getTime()}] 邮件已发送。`);
  } catch (error) {
    console.error(`[${getTime()}] 邮件发送失败:`, error);
  }
}

function isStateEqual(a, b) {
  if (!a || !b) return false;
  return a.status === b.status && a.hash === b.hash;
}

async function main() {
  const loopStart = Date.now();
  console.log(`\n[${getTime()}] ========== 监测循环开始 ==========`);

  // 定义要检测的 URL 列表
  const urls = [];
  for (let i = 1; i <= 50; i++) { // 假设检测前 50 个 deploy (根据实际情况调整)
    urls.push(`https://public-deploy${i}.test-eu.tankionline.com/browser-public/index.html`);
  }
  // 添加额外的 URL
  urls.push(
    "https://test.ru.tankionline.com/play/?config-template=https://c{server}.ru.tankionline.com/config.xml&balancer=https://balancer.ru.tankionline.com/balancer&resources=https://s.ru.tankionline.com",
    "https://tankiclassic.com/play/"
  );

  // 读取上次的状态
  let committedStatusJson = {};
  let retries = 3;
  while (retries > 0) {
    try {
      if (fs.existsSync(STATE_FILE)) {
        const content = fs.readFileSync(STATE_FILE, 'utf8');
        committedStatusJson = JSON.parse(content);
      }
      break;
    } catch (e) {
      console.error(`[${getTime()}] 读取状态文件失败，重试...`);
      retries--;
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  let finalStatusJson = { ...committedStatusJson };
  let notifications = [];
  let availableServers = [];
  let browser = null;
  let currentResults = {};

  try {
    // --- Phase 1: Curl 快速筛选 ---
    console.log(`[${getTime()}] Phase 1: Curl 检测 ${urls.length} 个 URL...`);
    // 限制 Curl 并发，虽然 https.get 很快，但太多容易被防火墙ban
    const curlResults = await Promise.all(urls.map(url => checkCurl(url)));
    const candidatesForBrowser = [];

    for (const res of curlResults) {
      const { url, isAlive, hash, statusCode } = res;
      if (isAlive) {
        candidatesForBrowser.push({ url, hash });
        // console.log(`[${getTime()}] Curl 存活: ${url} (${statusCode})`);
      } else {
        // 如果 Curl 都不通，直接标记 Offline
        const oldEntry = committedStatusJson[url] || {};
        currentResults[url] = { status: "Offline", hash: oldEntry.hash || hash };
      }
    }

    // --- Phase 2: Browser 深度检测 ---
    if (candidatesForBrowser.length > 0) {
      console.log(`[${getTime()}] Phase 2: 浏览器检测 ${candidatesForBrowser.length} 个候选...`);
      
      browser = await chromium.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
      });
      
      // 动态导入 p-limit 用于限制浏览器并发数
      const { default: pLimit } = await import('p-limit');
      const limit = pLimit(BROWSER_CONCURRENCY);
      
      const browserPromises = candidatesForBrowser.map(candidate => 
        limit(() => checkBrowserPage(browser, candidate.url).then(res => ({
          ...res,
          hash: candidate.hash // 传递 Curl 获取的 hash
        })))
      );
      
      const browserResults = await Promise.all(browserPromises);
      
      for (const res of browserResults) {
        const { url, status, hash, error } = res;
        const oldEntry = committedStatusJson[url] || {};
        
        let finalStatus = status;
        
        // 如果浏览器层判定为 Offline (例如加载超时)，但没有严重错误，
        // 且之前是 Closed/Open，我们可能希望保留之前的 Hash
        const hashToSave = (finalStatus === 'Offline') && oldEntry.hash 
          ? oldEntry.hash 
          : hash;
        
        currentResults[url] = { status: finalStatus, hash: hashToSave };
        console.log(`[${getTime()}] 结果: ${url} -> [${finalStatus}]`);
      }
    }

    // --- Phase 3: 状态比对与防抖动 ---
    for (const url of urls) {
      const currentEntry = currentResults[url] || { status: 'Offline', hash: '' };
      const committedEntry = committedStatusJson[url] || {};
      
      // 状态未变
      if (isStateEqual(currentEntry, committedEntry)) {
        if (pendingChanges[url]) delete pendingChanges[url];
        finalStatusJson[url] = committedEntry; // 保持原样
        continue;
      }

      // 状态发生变化，检查是否在 pending 列表中
      const pending = pendingChanges[url];
      if (pending && isStateEqual(pending.entry, currentEntry)) {
        pending.count++;
        // 达到确认阈值，正式采纳变化
        if (pending.count >= CONFIRMATION_THRESHOLD) {
          finalStatusJson[url] = currentEntry;
          delete pendingChanges[url];
          
          const oldStatus = committedEntry.status || null;
          const finalStatus = currentEntry.status;

          // 生成通知消息
          let message = "";
          let displayStatusBold = `<b>${finalStatus}</b>`;
          if (finalStatus === 'Open') displayStatusBold = `<b style="color:green">开放</b>`;
          if (finalStatus === 'Closed') displayStatusBold = `<b style="color:orange">封闭</b>`;
          if (finalStatus === 'Offline') displayStatusBold = `<b style="color:gray">下线</b>`;

          if (!oldStatus && finalStatus !== "Offline") {
            message = `首次发现服务器 (状态: ${displayStatusBold})`;
          }
          else if (oldStatus && finalStatus !== oldStatus) {
            if (oldStatus === "Offline") {
              message = `服务器已上线 -> ${displayStatusBold}`;
            } else if (finalStatus === "Offline") {
              message = `服务器已下线 (原状态: ${oldStatus})`;
            } else {
              message = `服务器状态变更: ${oldStatus} -> ${displayStatusBold}`;
            }
          }
          
          if (message) {
            notifications.push(`- <a href="${url}">${url}</a>: ${message}`);
          }
        } else {
          // 还在确认中，暂时保持旧状态
          // console.log(`[${getTime()}] 待确认变化 ${pending.count}/${CONFIRMATION_THRESHOLD}: ${url}`);
          finalStatusJson[url] = committedEntry;
        }
      } else {
        // 首次发现变化，加入 pending
        console.log(`[${getTime()}] 发现潜在变化: ${url} (${committedEntry.status || 'None'} -> ${currentEntry.status})`);
        pendingChanges[url] = { entry: currentEntry, count: 1, timestamp: Date.now() };
        finalStatusJson[url] = committedEntry;
      }
    }

    // --- Phase 4: 生成报告 ---
    // 收集所有在线服务器 (Open 或 Closed 都可以算在线，看你需求，这里只列出非 Offline)
    for (const url of urls) {
      const statusEntry = finalStatusJson[url];
      if (statusEntry && statusEntry.status && statusEntry.status !== "Offline") {
        let disp = statusEntry.status;
        if (disp === 'Open') disp = '<span style="color:green">开放</span>';
        if (disp === 'Closed') disp = '<span style="color:orange">需要邀请码</span>';
        
        availableServers.push(`<a href="${url}">${url}</a> [${disp}]`);
      }
    }

    // 如果有通知，执行写入和推送
    if (notifications.length > 0) {
      const success = fs.writeFileSync(STATE_FILE, JSON.stringify(finalStatusJson, null, 2));
      const pushed = commitAndPush();
      
      if (pushed) {
        const changeDetails = notifications.join('<br>');
        const availableListHeader = `<br><hr><b>当前在线服务器列表（${availableServers.length} 个）:</b><br>`;
        const availableListBody = availableServers.length > 0 ? availableServers.join('<br>') : "目前没有在线服务器。";
        const fullBody = `检测到状态变化：<br>${changeDetails}${availableListHeader}${availableListBody}`;
        await sendEmail(fullBody);
      }
    } else {
      // 清理超时的 pending 状态 (超过10分钟未确认)
      const now = Date.now();
      for (const [url, data] of Object.entries(pendingChanges)) {
        if (now - data.timestamp > 10 * 60 * 1000) {
          delete pendingChanges[url];
        }
      }
      console.log(`[${getTime()}] 无已确认的状态变化。`);
    }

  } catch (err) {
    console.error(`[${getTime()}] 主循环错误:`, err);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// --- 启动逻辑 ---
(async () => {
  console.log(`[${getTime()}] 监测器启动 (Standalone Mode)...`);
  
  // 立即执行一次
  await main();

  // 定时执行
  const intervalId = setInterval(async () => {
    // 检查是否超过最大运行时间 (针对 GitHub Actions)
    if (Date.now() - START_TIME > MAX_RUNTIME) {
      console.log(`[${getTime()}] 达到最大运行时间，退出程序。`);
      clearInterval(intervalId);
      process.exit(0);
    }
    await main();
  }, CHECK_INTERVAL);
})();
