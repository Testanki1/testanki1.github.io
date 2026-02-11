const { chromium } = require('playwright');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const { execSync } = require('child_process');
const nodemailer = require('nodemailer');
const pLimit = require('p-limit').default || require('p-limit');

// --- 基础配置 ---
const STATE_FILE = 'server_status.json';
const CHECK_INTERVAL = 60 * 1000; 
const MAX_RUNTIME = 4.8 * 60 * 60 * 1000; 
const START_TIME = Date.now();
const BROWSER_CONCURRENCY = 3; 
const CONFIRMATION_THRESHOLD = 2; 

let pendingChanges = {};

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
    
    req.on('error', () => resolve({ url, statusCode: 0, hash: '', isAlive: false }));
  });
}

async function checkBrowserPage(browser, url) {
  let page = null;
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    viewport: { width: 1280, height: 720 }
  });
  
  try {
    const targetUrl = url.includes('?') ? url + '&skipEntranceAnyKey' : url + '?skipEntranceAnyKey';
    page = await context.newPage();

    let refreshCount = 0;
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame() && frame.url() !== 'about:blank') {
        refreshCount++;
      }
    });

    const response = await page.goto(targetUrl, { 
      waitUntil: 'domcontentloaded', 
      timeout: 45000 
    });
    
    if (!response || response.status() < 200 || response.status() >= 300) {
      return { url, status: 'Offline', httpStatus: response?.status() || 0 };
    }

    await page.waitForTimeout(2000);
    refreshCount = 0; 
    await page.waitForTimeout(5000);

    if (refreshCount > 0) {
      return { url, status: 'Error', error: `监测到页面自动刷新 ${refreshCount} 次` };
    }

    const content = await page.content();
    const hasInvitation = /invitation|邀请码|invite/i.test(content);
    const hasCanvas = content.includes('<canvas');
    
    let finalStatus = 'Closed';
    if (!hasInvitation && hasCanvas) {
      finalStatus = 'Open';
    } else if (hasInvitation) {
      finalStatus = 'Closed';
    } else {
      finalStatus = 'Closed';
    }

    return { url, status: finalStatus, httpStatus: response.status() };
    
  } catch (e) {
    return { url, status: 'Error', error: e.message };
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
    if (status) {
      execSync('git commit -m "chore: 自动更新服务器状态 [skip ci]"');
      execSync('git push');
      console.log(`[${getTime()}] 成功推送状态至仓库`);
      return true;
    }
    return false;
  } catch (e) {
    console.error(`[${getTime()}] Git 推送失败: ${e.message}`);
    return false;
  }
}

async function sendEmail(body) {
  try {
    await transporter.sendMail({
      from: `"3D坦克监测" <${process.env.MAIL_USERNAME}>`,
      to: process.env.MAIL_TO,
      subject: "【状态变更】3D坦克测试服监测报告",
      html: `<div style="font-family: sans-serif;">
              <h3>检测到服务器状态变动：</h3>
              <p>${body}</p>
              <hr />
              <p style="font-size: 12px; color: #666;">监测时间：${getTime()}</p>
            </div>`
    });
    console.log(`[${getTime()}] 通知邮件已发送`);
  } catch (error) {
    console.error(`[${getTime()}] 邮件发送失败:`, error.message);
  }
}

function isStateEqual(a, b) {
  if (!a || !b) return false;
  // 核心逻辑：只有状态（Open/Closed/Offline）发生改变才算变更，忽略 Hash 差异
  return a.status === b.status;
}

async function main() {
  console.log(`[${getTime()}] 开始监测循环...`);
  
  const urls = [];
  for (let i = 1; i <= 10; i++) {
    urls.push(`https://public-deploy${i}.test-eu.tankionline.com/browser-public/index.html`);
  }
  urls.push(
    "https://test.ru.tankionline.com/play/?config-template=https://c{server}.ru.tankionline.com/config.xml&balancer=https://balancer.ru.tankionline.com/balancer&resources=https://s.ru.tankionline.com",
    "https://tankiclassic.com/play/"
  );

  let oldStatus = {};
  if (fs.existsSync(STATE_FILE)) {
    try {
      oldStatus = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    } catch (e) { oldStatus = {}; }
  }

  const curlResults = await Promise.all(urls.map(url => checkCurl(url)));
  const browserCandidates = curlResults.filter(r => r.isAlive);
  
  const currentResults = {};
  curlResults.filter(r => !r.isAlive).forEach(r => {
    currentResults[r.url] = { status: 'Offline', hash: r.hash };
  });

  if (browserCandidates.length > 0) {
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const limit = pLimit(BROWSER_CONCURRENCY);
    
    const browserResults = await Promise.all(browserCandidates.map(c => 
      limit(() => checkBrowserPage(browser, c.url).then(res => ({ ...res, hash: c.hash })))
    ));

    browserResults.forEach(r => {
      currentResults[r.url] = { status: r.status, hash: r.hash };
    });
    await browser.close();
  }

  let notifications = [];
  let hasUpdate = false;

  for (const url of urls) {
    const current = currentResults[url];
    const previous = oldStatus[url] || { status: 'Offline', hash: '' };

    // 1. 如果新旧状态完全一致，清空该 URL 的待定状态
    if (isStateEqual(current, previous)) {
      delete pendingChanges[url];
      continue;
    }

    // 2. 只有当涉及到 Open 状态的变入或变出时，才进行下一步确认
    // 逻辑：如果之前不是 Open，现在也不是 Open（比如从 Offline 变到 Closed），则跳过提示
    if (previous.status !== 'Open' && current.status !== 'Open') {
      oldStatus[url] = current; // 更新记录但不开通知
      hasUpdate = true;
      continue;
    }

    // 3. 状态确认机制
    if (!pendingChanges[url] || !isStateEqual(pendingChanges[url].entry, current)) {
      pendingChanges[url] = { entry: current, count: 1 };
    } else {
      pendingChanges[url].count++;
      if (pendingChanges[url].count >= CONFIRMATION_THRESHOLD) {
        notifications.push(`<b>${url}</b>: ${previous.status} -> <span style="color:red">${current.status}</span>`);
        oldStatus[url] = current;
        hasUpdate = true;
        delete pendingChanges[url];
      }
    }
  }

  if (hasUpdate) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(oldStatus, null, 2));
    // 只有当存在需要通知的变更（涉及 Open 状态）时才发邮件
    if (notifications.length > 0) {
      if (commitAndPush()) {
        await sendEmail(notifications.join('<br>'));
      }
    } else {
      // 仅仅是静默更新仓库中的状态文件（比如 Offline 变 Closed）
      commitAndPush();
    }
  }
}

(async () => {
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
