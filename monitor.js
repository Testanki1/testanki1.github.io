const { chromium } = require('playwright');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const { execSync } = require('child_process');
const nodemailer = require('nodemailer');
const pLimit = require('p-limit');

// --- 基础配置 ---
const STATE_FILE = 'server_status.json';
const CHECK_INTERVAL = 60 * 1000; // 1分钟轮询一次
const MAX_RUNTIME = 4.8 * 60 * 60 * 1000; // 运行4.8小时后自动退出，给下一次Action留出缓存时间
const START_TIME = Date.now();
const BROWSER_CONCURRENCY = 3; // 浏览器并发数
const CONFIRMATION_THRESHOLD = 2; // 状态需连续两次一致才确认为变更

// 暂存未确认的状态变化
let pendingChanges = {};

// 邮件发送配置
const transporter = nodemailer.createTransport({
  host: "smtp.qq.com",
  port: 465,
  secure: true,
  // 核心修复：强制使用 IPv4，防止 GitHub Actions 环境下出现 connect ENETUNREACH IPv6 错误
  family: 4, 
  auth: {
    user: process.env.MAIL_USERNAME,
    pass: process.env.MAIL_PASSWORD
  }
});

/**
 * 获取当前上海时间字符串
 */
function getTime() {
  return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

/**
 * Phase 1: 使用 Curl (https.get) 进行初步扫描
 * 目的：获取页面 Hash 并根据状态码排除明显离线的服务器
 */
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
        // 核心修复：只有状态码在 200-299 之间且内容不为空才视为可能存活
        // 避免将 404, 502 等报错页面误判为 Open
        const isAlive = statusCode >= 200 && statusCode < 300 && data.length > 100;
        const hash = isAlive ? crypto.createHash('sha256').update(data).digest('hex') : '';
        resolve({ url, statusCode, hash, isAlive });
      });
    });
    
    req.on('error', () => resolve({ url, statusCode: 0, hash: '', isAlive: false }));
  });
}

/**
 * Phase 2: 使用 Playwright 模拟浏览器访问
 * 目的：检测页面是否存在邀请码限制或死循环刷新
 */
async function checkBrowserPage(browser, url) {
  let page = null;
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    viewport: { width: 1280, height: 720 }
  });
  
  try {
    // 注入特殊参数尝试跳过可能的欢迎弹窗
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
    
    // 再次确认 HTTP 状态码，如果浏览器访问返回非 2xx，则判定为离线
    if (!response || response.status() < 200 || response.status() >= 300) {
      return { url, status: 'Offline', httpStatus: response?.status() || 0 };
    }

    // 等待页面脚本执行
    await page.waitForTimeout(2000);
    refreshCount = 0; 
    await page.waitForTimeout(5000);

    // 如果 5 秒内页面多次跳转，判定为维护模式或错误
    if (refreshCount > 0) {
      return { url, status: 'Error', error: `Detected ${refreshCount} refreshes` };
    }

    // 搜索邀请码关键字
    const content = await page.content();
    const hasInvitation = /invitation|邀请码|invite/i.test(content);
    
    // 增加正向校验：如果没有邀请码，但也完全没加载出游戏画布，可能也是异常页面
    const hasCanvas = content.includes('<canvas');
    let finalStatus = 'Closed';
    if (!hasInvitation && hasCanvas) {
      finalStatus = 'Open';
    } else if (hasInvitation) {
      finalStatus = 'Closed';
    } else {
      // 既没有邀请码也没加载出画布，可能是空白维护页
      finalStatus = 'Closed';
    }

    return { url, status: finalStatus, httpStatus: response.status() };
    
  } catch (e) {
    return { url, status: 'Error', error: e.message };
  } finally {
    if (context) await context.close().catch(() => {});
  }
}

/**
 * 将变更推送到 GitHub 仓库
 */
function commitAndPush() {
  try {
    execSync('git config --global user.name "github-actions[bot]"');
    execSync('git config --global user.email "github-actions[bot]@users.noreply.github.com"');
    execSync(`git add ${STATE_FILE}`);
    
    const status = execSync('git status --porcelain').toString();
    if (status) {
      execSync('git commit -m "chore: 自动更新服务器状态 [skip ci]"');
      execSync('git push');
      console.log(`[${getTime()}] 成功推送状态变更至仓库`);
      return true;
    }
    return false;
  } catch (e) {
    console.error(`[${getTime()}] Git 推送失败: ${e.message}`);
    return false;
  }
}

/**
 * 发送邮件通知
 */
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

/**
 * 比较两个状态对象是否一致
 */
function isStateEqual(a, b) {
  if (!a || !b) return false;
  return a.status === b.status && a.hash === b.hash;
}

/**
 * 主执行函数
 */
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
  // 先填入离线状态
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
    const previous = oldStatus[url] || { status: 'Unknown', hash: '' };

    if (isStateEqual(current, previous)) {
      delete pendingChanges[url];
      continue;
    }

    // 确认机制：防止网络波动导致误报
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
    if (commitAndPush()) {
      await sendEmail(notifications.join('<br>'));
    }
  }
}

// 启动持续监测
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
