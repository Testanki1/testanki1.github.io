const { chromium } = require('playwright');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const { execSync } = require('child_process');
const nodemailer = require('nodemailer');
// 兼容新版 p-limit 的 CommonJS 引入方式
const pLimit = require('p-limit').default || require('p-limit');

// --- 配置 ---
const STATE_FILE = 'server_status.json';
const CHECK_INTERVAL = 60 * 1000;
const MAX_RUNTIME = 5.8 * 60 * 60 * 1000;
const START_TIME = Date.now();
const BROWSER_CONCURRENCY = 3; 
const CONFIRMATION_THRESHOLD = 2; 

let pendingChanges = {};

const transporter = nodemailer.createTransport({
  host: "smtp.qq.com",
  port: 465,
  secure: true,
  family: 4, // 修复 ENETUNREACH 报错
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
        resolve({ url, statusCode, hash, isAlive, dataLength: data.length });
      });
    });
    
    req.on('error', () => resolve({ url, statusCode: 0, hash: '', isAlive: false, dataLength: 0 }));
    req.on('timeout', () => { req.destroy(); resolve({ url, statusCode: 0, hash: '', isAlive: false, dataLength: 0 }); });
  });
}

async function checkBrowserPage(browser, url) {
  let page = null;
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.0.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.0',
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
    if (!response || response.status() >= 400) return { url, status: 'Offline', httpStatus: response?.status() || 0 };

    await page.waitForTimeout(2000);
    refreshCount = 0; 
    await page.waitForTimeout(5000);

    if (refreshCount > 0) return { url, status: 'Error', error: 'Auto-refreshes' };
    
    const content = await page.content();
    const hasInvitation = /invitation|邀请码|invite/i.test(content);
    return { url, status: hasInvitation ? 'Closed' : 'Open', httpStatus: response.status() };
  } catch (e) {
    return { url, status: 'Error', error: e.message };
  } finally {
    await context.close().catch(() => {});
  }
}

function commitAndPush() {
  try {
    execSync('git config --global user.name "github-actions[bot]"');
    execSync('git config --global user.email "github-actions[bot]@users.noreply.github.com"');
    
    // 强制同步远程仓库，避免 [rejected] 错误
    // 即使本地没有变更，先 pull 也是安全的
    execSync('git pull --rebase origin main || true', { stdio: 'pipe' });
    
    execSync(`git add ${STATE_FILE}`);
    const status = execSync('git status --porcelain').toString();
    if (status) {
      execSync('git commit -m "chore: 更新服务器状态文件 [skip ci]"');
      execSync('git push origin main');
      console.log(`[${getTime()}] Git 推送成功。`);
      return true;
    }
    return false;
  } catch (e) {
    console.error(`[${getTime()}] Git 操作失败:`, e.message);
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
  console.log(`\n[${getTime()}] ========== 监测循环开始 ==========`);
  const urls = [];
  for (let i = 1; i <= 10; i++) urls.push(`https://public-deploy${i}.test-eu.tankionline.com/browser-public/index.html`);
  urls.push("https://test.ru.tankionline.com/play/", "https://tankiclassic.com/play/");

  let committedStatusJson = {};
  if (fs.existsSync(STATE_FILE)) {
    try { committedStatusJson = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (e) { committedStatusJson = {}; }
  }

  let finalStatusJson = { ...committedStatusJson };
  let notifications = [];
  let currentResults = {};

  const curlResults = await Promise.all(urls.map(url => checkCurl(url)));
  const candidatesForBrowser = curlResults.filter(res => res.isAlive);
  
  curlResults.filter(res => !res.isAlive).forEach(res => {
    currentResults[res.url] = { status: "Offline", hash: (committedStatusJson[res.url] || {}).hash || res.hash };
  });

  if (candidatesForBrowser.length > 0) {
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const limit = pLimit(BROWSER_CONCURRENCY);
    const browserResults = await Promise.all(candidatesForBrowser.map(c => 
      limit(() => checkBrowserPage(browser, c.url).then(res => ({ ...res, hash: c.hash })))
    ));
    browserResults.forEach(res => { currentResults[res.url] = { status: res.status, hash: res.hash }; });
    await browser.close();
  }

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
        finalStatusJson[url] = currentEntry;
        delete pendingChanges[url];
        notifications.push(`- ${url} 状态变为 <b>${currentEntry.status}</b>`);
      }
    } else {
      pendingChanges[url] = { entry: currentEntry, count: 1 };
      finalStatusJson[url] = committedEntry;
    }
  }

  if (notifications.length > 0) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(finalStatusJson, null, 2));
    if (commitAndPush()) await sendEmail(notifications.join('<br>'));
  } else {
    console.log(`[${getTime()}] 无已确认的状态变化。`);
  }
}

// 使用递归函数代替 setInterval，确保前一个 main 跑完才开始下一个计时
async function runRecursive() {
  if (Date.now() - START_TIME > MAX_RUNTIME) {
    console.log("达到最大运行时间，正常退出。");
    process.exit(0);
  }
  
  await main();
  
  // 确保在上一次 main 完成后，才等待 CHECK_INTERVAL 毫秒
  setTimeout(runRecursive, CHECK_INTERVAL);
}

(async () => {
  console.log(`[${getTime()}] 监测器启动 (Sequential Mode)...`);
  await runRecursive();
})();
