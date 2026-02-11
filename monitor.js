const { chromium } = require('playwright');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const { execSync } = require('child_process');
const nodemailer = require('nodemailer');
const pLimit = require('p-limit').default || require('p-limit');

// --- 配置 ---
const STATE_FILE = 'server_status.json';
const CHECK_INTERVAL = 60 * 1000;
const MAX_RUNTIME = 5.8 * 60 * 60 * 1000; 
const START_TIME = Date.now();
const BROWSER_CONCURRENCY = 3; 
const CONFIRMATION_THRESHOLD = 2; 

let pendingChanges = {};

// 邮件发送器配置
const transporter = nodemailer.createTransport({
  host: "smtp.qq.com",
  port: 465,
  secure: true,
  family: 4, // 强制 IPv4
  auth: {
    user: process.env.MAIL_USERNAME,
    pass: process.env.MAIL_PASSWORD
  }
});

function getTime() {
  return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

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
        resolve({ url, statusCode, hash, isAlive });
      });
    });
    
    req.on('error', (err) => {
      // 恢复详细日志
      console.log(`[${getTime()}] Curl 错误 ${url}: ${err.message}`);
      resolve({ url, statusCode: 0, hash: '', isAlive: false });
    });
    req.on('timeout', () => { 
      req.destroy(); 
      resolve({ url, statusCode: 0, hash: '', isAlive: false }); 
    });
  });
}

async function checkBrowserPage(browser, url) {
  let page = null;
  // 恢复：更具体的 UserAgent
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 }
  });
  
  try {
    const targetUrl = url.includes('?') ? url + '&skipEntranceAnyKey' : url + '?skipEntranceAnyKey';
    page = await context.newPage();
    
    let refreshCount = 0;
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame() && frame.url() !== 'about:blank') refreshCount++;
    });

    const response = await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    
    // 基础 HTTP 状态检查
    if (!response || response.status() >= 400) {
      return { url, status: 'Offline', httpStatus: response?.status() || 0 };
    }

    await page.waitForTimeout(2000);
    refreshCount = 0; 
    await page.waitForTimeout(5000);

    if (refreshCount > 0) {
      console.log(`[${getTime()}] 检测到自动刷新循环 - ${url}`);
      return { url, status: 'Error', error: 'Auto-refreshes' };
    }
    
    // 恢复：多重检测机制 (Robust DOM Detection)
    // 不仅仅依赖 page.content()，还检查特定的选择器
    const checks = await Promise.all([
      page.locator('text=/invitation/i').count().catch(() => 0),
      page.locator('text=/邀请/i').count().catch(() => 0),
      page.locator('[class*="invitation"]').count().catch(() => 0),
      page.content().then(html => /invitation|邀请码|invite/i.test(html))
    ]);

    const hasInvitation = checks.some(c => c > 0 || c === true);
    return { url, status: hasInvitation ? 'Closed' : 'Open', httpStatus: response.status() };

  } catch (e) {
    // 恢复：特定的错误分类处理
    const msg = e.message ? e.message.toLowerCase() : "";
    if (
      msg.includes('navigating') || 
      msg.includes('retrieve content') || 
      msg.includes('execution context') || 
      msg.includes('destroyed') ||
      msg.includes('timeout')
    ) {
       console.log(`[${getTime()}] 捕获不稳定状态(Error) - ${url}: ${e.message}`);
       return { url, status: 'Error', error: e.message };
    }
    
    return { url, status: 'Offline', error: e.message };
  } finally {
    await context.close().catch(() => {});
  }
}

function commitAndPush() {
  try {
    execSync('git config --global user.name "github-actions[bot]"');
    execSync('git config --global user.email "github-actions[bot]@users.noreply.github.com"');
    
    execSync(`git add ${STATE_FILE}`);
    
    const status = execSync('git status --porcelain').toString();
    if (!status) return false;

    execSync('git commit -m "chore: 更新服务器状态文件 [skip ci]"');
    
    // 恢复：更安全的同步机制 (Pull --rebase after commit)
    console.log(`[${getTime()}] 正在同步远程仓库...`);
    execSync('git pull --rebase origin main', { stdio: 'pipe' });
    execSync('git push origin main');
    
    console.log(`[${getTime()}] Git 推送成功。`);
    return true;
  } catch (e) {
    console.error(`[${getTime()}] Git 操作失败:`, e.message);
    // 恢复：错误恢复机制
    try { execSync('git rebase --abort'); } catch (err) {}
    return false;
  }
}

async function sendEmail(body) {
  try {
    await transporter.sendMail({
      from: `"3D坦克监测器" <${process.env.MAIL_USERNAME}>`,
      to: process.env.MAIL_TO,
      subject: "3D坦克测试服务器状态更新",
      html: `你好，<br><br>${body}<br><br><small style="color:#666">此邮件由 GitHub Actions 自动监测发送。</small>`
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
  console.log(`\n[${getTime()}] ========== 监测循环开始 ==========`);
  const urls = [];
  for (let i = 1; i <= 10; i++) urls.push(`https://public-deploy${i}.test-eu.tankionline.com/browser-public/index.html`);
  urls.push("https://test.ru.tankionline.com/play/", "https://tankiclassic.com/play/");

  let committedStatusJson = {};
  
  // 恢复：文件读取重试机制
  let retries = 3;
  while (retries > 0) {
    try {
      if (fs.existsSync(STATE_FILE)) {
        committedStatusJson = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      }
      break;
    } catch (e) {
      retries--;
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  let finalStatusJson = { ...committedStatusJson };
  let notifications = [];
  let currentResults = {};

  // Phase 1: Curl
  const curlResults = await Promise.all(urls.map(url => checkCurl(url)));
  const candidatesForBrowser = curlResults.filter(res => res.isAlive);
  
  curlResults.filter(res => !res.isAlive).forEach(res => {
    // 保持旧 hash 以避免误报更新
    currentResults[res.url] = { status: "Offline", hash: (committedStatusJson[res.url] || {}).hash || res.hash };
  });

  // Phase 2: Browser
  if (candidatesForBrowser.length > 0) {
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const limit = pLimit(BROWSER_CONCURRENCY);
    const browserPromises = candidatesForBrowser.map(c => 
      limit(() => checkBrowserPage(browser, c.url).then(res => ({ ...res, hash: c.hash })))
    );
    const browserResults = await Promise.all(browserPromises);
    
    browserResults.forEach(res => { 
        // 如果浏览器判断离线但没有具体错误，且之前有hash，则保留hash
        let finalStatus = res.status;
        if (res.status === 'Offline' && !res.error) finalStatus = 'Closed'; // 兜底
        currentResults[res.url] = { status: finalStatus, hash: res.hash }; 
    });
    await browser.close();
  }

  // Phase 3: 比较与生成消息
  for (const url of urls) {
    const currentEntry = currentResults[url] || { status: 'Offline', hash: '' };
    const committedEntry = committedStatusJson[url] || {};
    
    if (isStateEqual(currentEntry, committedEntry)) {
      delete pendingChanges[url];
      finalStatusJson[url] = committedEntry;
      continue;
    }

    const pending = pendingChanges[url];
    if (pending && isStateEqual(pending.entry, currentEntry)) {
      pending.count++;
      if (pending.count >= CONFIRMATION_THRESHOLD) {
        // 恢复：详细的 Notification 生成逻辑
        const oldStatus = committedEntry.status || null;
        const oldHash = committedEntry.hash || null;
        const finalStatus = currentEntry.status;
        const hash = currentEntry.hash;

        let message = "";
        let displayStatusBold = `<b>${finalStatus === 'Open' ? '开放' : finalStatus === 'Closed' ? '封闭' : finalStatus}</b>`;

        if (!oldStatus && finalStatus !== "Offline") {
            message = `首次发现服务器 (状态: ${displayStatusBold})`;
        } else if (oldStatus && finalStatus !== oldStatus) {
            if (oldStatus === "Offline") {
                 let hashMsg = (hash !== oldHash) ? "，且检测到<b>更新</b>" : "";
                 message = `服务器已上线 (状态: ${displayStatusBold})${hashMsg}`;
            } else if (finalStatus === "Offline") {
                 message = `服务器已下线`;
            } else {
                 message = `服务器状态变更: ${oldStatus} -> ${displayStatusBold}`;
            }
        } else if (oldStatus !== "Offline" && finalStatus !== "Offline" && oldHash && hash !== oldHash) {
            message = `网页代码已更新 (状态: ${displayStatusBold})`;
        }

        if (message) {
            notifications.push(`- <a href="${url}">${url}</a>: ${message}`);
        }
        
        finalStatusJson[url] = currentEntry;
        delete pendingChanges[url];
      }
    } else {
      pendingChanges[url] = { entry: currentEntry, count: 1 };
      finalStatusJson[url] = committedEntry;
    }
  }

  // 恢复：清理过期的 pendingChanges
  const now = Date.now();
  for (const [url, data] of Object.entries(pendingChanges)) {
    if (data.timestamp && (now - data.timestamp > 10 * 60 * 1000)) delete pendingChanges[url];
    else if (!data.timestamp) pendingChanges[url].timestamp = now;
  }

  // 整理在线列表
  let onlineList = [];
  for (const [url, data] of Object.entries(finalStatusJson)) {
    if (data.status && data.status !== 'Offline') {
      let statusText = data.status === 'Open' ? '<b style="color:green">开放</b>' : `<b>${data.status}</b>`;
      onlineList.push(`- <a href="${url}">${url}</a> (${statusText})`);
    }
  }

  if (notifications.length > 0) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(finalStatusJson, null, 2));
    if (commitAndPush()) {
      const emailBody = `
        <h3>检测到状态变化：</h3>
        ${notifications.join('<br>')}
        <br><hr>
        <h4>当前在线服务器列表 (${onlineList.length} 个)：</h4>
        ${onlineList.length > 0 ? onlineList.join('<br>') : '暂无在线服务器'}
      `;
      await sendEmail(emailBody);
    }
  } else {
    console.log(`[${getTime()}] 无已确认的状态变化。`);
  }
}

(async () => {
  console.log(`[${getTime()}] 监测器启动 (Standalone Mode)...`);
  await main();
  const timer = setInterval(async () => {
    if (Date.now() - START_TIME > MAX_RUNTIME) {
      clearInterval(timer);
      console.log("达到最大运行时间，正常退出。");
      process.exit(0);
    }
    await main();
  }, CHECK_INTERVAL);
})();
