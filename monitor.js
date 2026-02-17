const { chromium } = require('playwright');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const { execSync } = require('child_process');
const nodemailer = require('nodemailer');

// --- 配置 ---
const STATE_FILE = 'server_status.json';
const CHECK_INTERVAL = 60 * 1000;
const MAX_RUNTIME = 4.95 * 60 * 60 * 1000;
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

// 自研并发池函数
async function runPool(tasks, concurrency) {
  const results = [];
  const executing = new Set();
  for (const task of tasks) {
    const p = Promise.resolve().then(() => task());
    results.push(p);
    executing.add(p);
    const clean = () => executing.delete(p);
    p.then(clean).catch(clean);
    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }
  return Promise.all(results);
}

function checkCurl(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { 
      rejectUnauthorized: false, 
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0 x64) AppleWebKit/537.36'
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        const isAlive = res.statusCode >= 200 && res.statusCode < 300 && data.length > 100;
        const hash = isAlive ? crypto.createHash('sha256').update(data).digest('hex') : '';
        resolve({ url, isAlive, hash, statusCode: res.statusCode });
      });
    });
    req.on('error', () => resolve({ url, isAlive: false, hash: '', statusCode: 0 }));
    req.on('timeout', () => { req.destroy(); resolve({ url, isAlive: false, hash: '', statusCode: 0 }); });
  });
}

async function checkBrowserPage(browser, url) {
  let page = null;
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    locale: 'en-US'
  });
  
  try {
    const targetUrl = url.includes('?') ? `${url}&locale=en` : `${url}?locale=en`;
    page = await context.newPage();
    
    // 监控自动刷新
    let refreshCount = 0;
    page.on('framenavigated', frame => {
      if (frame === page.mainFrame() && frame.url() !== 'about:blank') refreshCount++;
    });

    const response = await page.goto(targetUrl, { waitUntil: 'commit', timeout: 45000 });
    if (!response || response.status() >= 400) return { url, status: 'Offline' };

    // 针对 deploy3 的核心增强：等待关键渲染
    // 即使 networkidle 没到，只要看到邀请框就立刻锁定
    try {
      await Promise.race([
        page.waitForSelector('input#invite', { state: 'attached', timeout: 12000 }),
        page.waitForSelector('.EntranceComponentStyle-title', { state: 'attached', timeout: 12000 }),
        page.waitForLoadState('networkidle', { timeout: 15000 })
      ]);
    } catch (e) {}

    await page.waitForTimeout(2000); 

    if (refreshCount > 5) return { url, status: 'Error', error: 'Auto-refresh loop' };

    // 多重证据提取
    const hasInviteInput = await page.locator('input#invite').count() > 0;
    const content = await page.innerText('body').catch(() => '');
    const hasInviteText = /INVITATION|ENTER CODE|邀请码|激活码/i.test(content);

    return { 
      url, 
      status: (hasInviteInput || hasInviteText) ? 'Closed' : 'Open',
      httpStatus: response.status()
    };
  } catch (e) {
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
    if (!execSync('git status --porcelain').toString()) return false;
    execSync('git commit -m "chore: 自动更新状态 [skip ci]"');
    execSync('git pull --rebase origin main');
    execSync('git push origin main');
    return true;
  } catch (e) {
    return false;
  }
}

async function sendEmail(body) {
  try {
    await transporter.sendMail({
      from: `"3D坦克监测" <${process.env.MAIL_USERNAME}>`,
      to: process.env.MAIL_TO,
      subject: "3D坦克状态更新",
      html: body
    });
  } catch (e) {
    console.error("邮件发送失败", e.message);
  }
}

async function main() {
  console.log(`[${getTime()}] ========== 监测循环开始 ==========`);
  const urls = Array.from({ length: 10 }, (_, i) => `https://public-deploy${i + 1}.test-eu.tankionline.com/browser-public/index.html`);
  urls.push("https://test.ru.tankionline.com/play/", "https://tankiclassic.com/play/");

  let committedStatus = {};
  if (fs.existsSync(STATE_FILE)) {
    try { committedStatus = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (e) {}
  }

  try {
    // Phase 1: Curl
    const curlResults = await Promise.all(urls.map(u => checkCurl(u)));
    const aliveOnes = curlResults.filter(r => r.isAlive);
    const currentResults = {};

    // 预填离线状态
    curlResults.forEach(r => {
      if (!r.isAlive) currentResults[r.url] = { status: 'Offline', hash: committedStatus[r.url]?.hash || '' };
    });

    // Phase 2: Browser
    if (aliveOnes.length > 0) {
      const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
      const tasks = aliveOnes.map(c => () => checkBrowserPage(browser, c.url).then(r => {
        currentResults[c.url] = { ...r, hash: c.hash };
      }));
      await runPool(tasks, BROWSER_CONCURRENCY);
      await browser.close();
    }

    // Phase 3: 状态比对与通知
    let notifications = [];
    for (const url of urls) {
      const cur = currentResults[url] || { status: 'Offline', hash: '' };
      const old = committedStatus[url] || {};
      
      if (cur.status === old.status && cur.hash === old.hash) {
        delete pendingChanges[url];
        continue;
      }

      if (pendingChanges[url]?.status === cur.status) {
        pendingChanges[url].count++;
        if (pendingChanges[url].count >= CONFIRMATION_THRESHOLD) {
          committedStatus[url] = cur;
          notifications.push(`- ${url}: 从 ${old.status || '未知'} 变为 <b>${cur.status}</b>`);
          delete pendingChanges[url];
        }
      } else {
        pendingChanges[url] = { status: cur.status, count: 1 };
      }
    }

    if (notifications.length > 0) {
      fs.writeFileSync(STATE_FILE, JSON.stringify(committedStatus, null, 2));
      if (commitAndPush()) {
        await sendEmail(`检测到状态变化：<br>${notifications.join('<br>')}`);
        console.log(`[${getTime()}] 状态已更新并发送邮件`);
      }
    }
  } catch (err) {
    console.error("循环异常", err);
  }
  console.log(`[${getTime()}] ========== 监测循环结束 ==========`);
}

(async () => {
  await main();
  setInterval(async () => {
    if (Date.now() - START_TIME > MAX_RUNTIME) process.exit(0);
    await main();
  }, CHECK_INTERVAL);
})();
