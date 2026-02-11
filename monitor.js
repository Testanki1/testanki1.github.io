const { chromium } = require('playwright');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const { execSync } = require('child_process');
const nodemailer = require('nodemailer');
const pLimit = require('p-limit');

// --- 配置 ---
const STATE_FILE = 'server_status.json';
const CHECK_INTERVAL = 60 * 1000;
const MAX_RUNTIME = 5.8 * 60 * 60 * 1000; // GitHub Actions 限制运行 6 小时，预留缓冲
const START_TIME = Date.now();
const BROWSER_CONCURRENCY = 3; 
const CONFIRMATION_THRESHOLD = 2; 

let pendingChanges = {};

// 邮件发送器配置
const transporter = nodemailer.createTransport({
  host: "smtp.qq.com",
  port: 465,
  secure: true,
  // 强制使用 IPv4 家族，解决 GitHub Actions 环境下 IPv6 路由不可达导致的 ENETUNREACH 报错
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
      console.log(`[${getTime()}] Curl 错误 ${url}: ${err.message}`);
      resolve({ url, statusCode: 0, hash: '', isAlive: false, dataLength: 0 });
    });
    
    req.on('timeout', () => {
      req.destroy();
      console.log(`[${getTime()}] Curl 超时 ${url}`);
      resolve({ url, statusCode: 0, hash: '', isAlive: false, dataLength: 0 });
    });
  });
}

async function checkBrowserPage(browser, url) {
  let page = null;
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.0.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.0',
    viewport: { width: 1280, height: 720 }
  });
  
  try {
    const targetUrl = url.includes('?') 
      ? url + '&skipEntranceAnyKey' 
      : url + '?skipEntranceAnyKey';
    
    page = await context.newPage();

    // === 检测自动刷新 ===
    let refreshCount = 0;
    const navListener = (frame) => {
      if (frame === page.mainFrame() && frame.url() !== 'about:blank') {
        refreshCount++;
      }
    };
    page.on('framenavigated', navListener);

    const response = await page.goto(targetUrl, { 
      waitUntil: 'domcontentloaded', 
      timeout: 45000 
    });
    
    if (!response || response.status() >= 400) {
      return { url, status: 'Offline', httpStatus: response?.status() || 0 };
    }

    await page.waitForTimeout(2000);
    refreshCount = 0; 
    await page.waitForTimeout(5000);

    if (refreshCount > 0) {
       console.log(`[${getTime()}] 检测到自动刷新循环 - ${url} (5秒内刷新了 ${refreshCount} 次)`);
       return { url, status: 'Error', error: 'Page auto-refreshes repeatedly' };
    }
    
    // === 常规内容检测 ===
    const checks = await Promise.all([
      page.locator('text=/invitation/i').count().catch(() => 0),
      page.locator('text=/邀请/i').count().catch(() => 0),
      page.locator('[class*="invitation"]').count().catch(() => 0),
      page.content().then(html => /invitation|邀请码|invite/i.test(html))
    ]);
    
    const hasInvitation = checks.some(c => c > 0 || c === true);
    
    return { 
      url, 
      status: hasInvitation ? 'Closed' : 'Open',
      httpStatus: response.status()
    };
    
  } catch (e) {
    const msg = e.message ? e.message.toLowerCase() : "";
    
    if (
      msg.includes('navigating') || 
      msg.includes('retrieve content') || 

      msg.includes('execution context') || 
      msg.includes('destroyed') ||
      msg.includes('timeout') ||
      msg.includes('redirect') 
    ) {
       console.log(`[${getTime()}] 捕获不稳定状态(Error) - ${url}: ${e.message}`);
       return { url, status: 'Error', error: e.message };
    }

    console.log(`[${getTime()}] 判定为 Offline - ${url}: ${e.message}`);
    return { url, status: 'Offline', error: e.message };
  } finally {
    await context.close().catch(() => {});
  }
}

function commitAndPush() {
  try {
    // 1. 配置用户信息
    execSync('git config --global user.name "github-actions[bot]"');
    execSync('git config --global user.email "github-actions[bot]@users.noreply.github.com"');
    
    // 2. 暂存状态文件
    execSync(`git add ${STATE_FILE}`);
    
    // 3. 检查是否有实际内容变更
    const status = execSync('git status --porcelain').toString();
    if (!status) {
      console.log(`[${getTime()}] 没有检测到状态文件变更，跳过推送。`);
      return false;
    }

    // 4. 提交变更
    execSync('git commit -m "chore: 自动更新服务器状态 [skip ci]"');

    // 5. 核心修复：推送前先拉取远程更新并变基，解决 [rejected] 冲突
    // --rebase 可以保持提交记录呈线性，避免产生无意义的 Merge branch 记录
    console.log(`[${getTime()}] 正在同步远程仓库...`);
    execSync('git pull --rebase origin main', { stdio: 'pipe' });
    
    // 6. 推送
    execSync('git push origin main');
    console.log(`[${getTime()}] Git 状态已更新并推送成功。`);
    return true;
  } catch (e) {
    console.error(`[${getTime()}] Git 操作失败:`, e.message);
    
    // 如果 rebase 过程中出现冲突，清理现场防止阻塞后续循环
    try {
      execSync('git rebase --abort');
    } catch (abortErr) {
      // 忽略中止失败的情况
    }
    return false;
  }
}
async function sendEmail(body) {
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

  const urls = [];
  for (let i = 1; i <= 10; i++) {
    urls.push(`https://public-deploy${i}.test-eu.tankionline.com/browser-public/index.html`);
  }
  urls.push(
    "https://test.ru.tankionline.com/play/?config-template=https://c{server}.ru.tankionline.com/config.xml&balancer=https://balancer.ru.tankionline.com/balancer&resources=https://s.ru.tankionline.com",
    "https://tankiclassic.com/play/"
  );

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
    // Phase 1: Curl
    console.log(`[${getTime()}] Phase 1: Curl 检测 ${urls.length} 个 URL...`);
    const curlResults = await Promise.all(urls.map(url => checkCurl(url)));
    const candidatesForBrowser = [];

    for (const res of curlResults) {
      const { url, isAlive, hash, statusCode } = res;
      if (isAlive) {
        candidatesForBrowser.push({ url, hash });
        console.log(`[${getTime()}] Curl 存活: ${url} (${statusCode})`);
      } else {
        const oldEntry = committedStatusJson[url] || {};
        currentResults[url] = { status: "Offline", hash: oldEntry.hash || hash };
      }
    }

    // Phase 2: Browser
    if (candidatesForBrowser.length > 0) {
      console.log(`[${getTime()}] Phase 2: 浏览器检测 ${candidatesForBrowser.length} 个候选...`);
      browser = await chromium.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
      });
      
      const limit = pLimit(BROWSER_CONCURRENCY);
      const browserPromises = candidatesForBrowser.map(candidate => 
        limit(() => checkBrowserPage(browser, candidate.url).then(res => ({
          ...res,
          hash: candidate.hash
        })))
      );
      
      const browserResults = await Promise.all(browserPromises);
      
      for (const res of browserResults) {
        const { url, status, hash, error } = res;
        const oldEntry = committedStatusJson[url] || {};
        
        let finalStatus = status;
        if (status === 'Offline' && !error) {
          finalStatus = 'Closed'; 
        }
        
        const hashToSave = (finalStatus === 'Offline') && oldEntry.hash 
          ? oldEntry.hash 
          : hash;
        
        currentResults[url] = { status: finalStatus, hash: hashToSave };
        console.log(`[${getTime()}] 浏览器结果: ${url} -> ${finalStatus}`);
      }
    }

    // Phase 3: 状态比对
    for (const url of urls) {
      const currentEntry = currentResults[url] || { status: 'Offline', hash: '' };
      const committedEntry = committedStatusJson[url] || {};
      
      if (isStateEqual(currentEntry, committedEntry)) {
        if (pendingChanges[url]) delete pendingChanges[url];
        finalStatusJson[url] = committedEntry;
        continue;
      }

      const pending = pendingChanges[url];
      if (pending && isStateEqual(pending.entry, currentEntry)) {
        pending.count++;
        if (pending.count >= CONFIRMATION_THRESHOLD) {
          finalStatusJson[url] = currentEntry;
          delete pendingChanges[url];
          
          const oldStatus = committedEntry.status || null;
          const oldHash = committedEntry.hash || null;
          const finalStatus = currentEntry.status;
          const hash = currentEntry.hash;

          let displayStatus = "";
          let displayStatusBold = "";
          if (finalStatus === "Open") { displayStatus = "开放"; displayStatusBold = "<b>开放</b>"; }
          else if (finalStatus === "Closed") { displayStatus = "封闭"; displayStatusBold = "<b>封闭</b>"; }
          else if (finalStatus === "Error") { displayStatus = "错误"; displayStatusBold = "<b>错误</b>"; }

          let message = "";
          
          if (!oldStatus && finalStatus !== "Offline") {
            message = `首次发现服务器 (状态: ${displayStatusBold})`;
          }
          else if (oldStatus && finalStatus !== oldStatus) {
            if (oldStatus === "Offline") {
              if (finalStatus === "Error") {
                   let hashMsg = (hash !== oldHash) ? "，且检测到<b>更新</b>" : "，且<b>无更新</b>";
                   message = `服务器已上线但出现<b>错误</b>${hashMsg}`;
              } else {
                   let baseMsg = finalStatus === "Open" ? "服务器已上线并<b>开放</b>" : "服务器已上线，当前为<b>封闭</b>状态";
                   let hashMsg = (hash !== oldHash) ? "，且检测到<b>更新</b>" : "，且<b>无更新</b>";
                   message = baseMsg + hashMsg;
              }
            } 
            else if (finalStatus === "Offline") {
              let oldDisplay = oldStatus; 
              if (oldStatus === 'Open') oldDisplay = '<b>开放</b>';
              if (oldStatus === 'Closed') oldDisplay = '<b>封闭</b>';
              if (oldStatus === 'Error') oldDisplay = '<b>错误</b>';
              message = `服务器已下线 (原状态: ${oldDisplay})`;
            }
            else {
               let oldDisplay = oldStatus;
               if (oldStatus === 'Open') oldDisplay = '<b>开放</b>';
               if (oldStatus === 'Closed') oldDisplay = '<b>封闭</b>';
               if (oldStatus === 'Error') oldDisplay = '<b>错误</b>';
               message = `服务器状态已从${oldDisplay}变为${displayStatusBold}`;
            }
          }
          else if (oldStatus !== "Offline" && finalStatus !== "Offline" && oldHash && hash !== oldHash) {
            message = `网页代码已更新（状态: ${displayStatusBold}）`;
          }
          
          if (message) {
            notifications.push(`- <a href="${url}">${url}</a>: ${message}`);
          }
        } else {
          console.log(`[${getTime()}] 待确认 ${pending.count}/${CONFIRMATION_THRESHOLD}: ${url} -> ${currentEntry.status}`);
          finalStatusJson[url] = committedEntry;
        }
      } else {
        console.log(`[${getTime()}] 发现潜在变化: ${url} (原: ${committedEntry.status} -> 新: ${currentEntry.status})`);
        pendingChanges[url] = { entry: currentEntry, count: 1 };
        finalStatusJson[url] = committedEntry;
      }
    }

    for (const url of urls) {
      const statusEntry = finalStatusJson[url];
      if (statusEntry && statusEntry.status && statusEntry.status !== "Offline") {
        let disp = '<b>未知</b>';
        if (statusEntry.status === 'Open') disp = '<b>开放</b>';
        else if (statusEntry.status === 'Closed') disp = '<b>封闭</b>';
        else if (statusEntry.status === 'Error') disp = '<b>错误</b>';
        
        availableServers.push(`<a href="${url}">${url}</a> (状态: ${disp})`);
      }
    }

    if (notifications.length > 0) {
      fs.writeFileSync(STATE_FILE, JSON.stringify(finalStatusJson, null, 2));
      if (commitAndPush()) {
        const changeDetails = notifications.join('<br>');
        const availableListHeader = `<br><hr><b>当前已上线的服务器列表（${availableServers.length} 个）:</b><br>`;
        const availableListBody = availableServers.length > 0 ? availableServers.join('<br>') : "目前没有已上线的服务器。";
        const fullBody = `检测到状态变化：<br>${changeDetails}${availableListHeader}${availableListBody}`;
        await sendEmail(fullBody);
      }
    } else {
      const now = Date.now();
      for (const [url, data] of Object.entries(pendingChanges)) {
        if (data.timestamp && (now - data.timestamp > 10 * 60 * 1000)) {
          delete pendingChanges[url];
        } else if (!data.timestamp) {
          pendingChanges[url].timestamp = now;
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

// 启动逻辑
(async () => {
  console.log(`[${getTime()}] 监测器启动 (Standalone Mode)...`);
  await main();
  const intervalId = setInterval(async () => {
    if (Date.now() - START_TIME > MAX_RUNTIME) {
      clearInterval(intervalId);
      process.exit(0);
    }
    await main();
  }, CHECK_INTERVAL);
})();
