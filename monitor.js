const puppeteer = require('puppeteer'); 
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

// 原生 JS 实现的并发控制器
async function runWithLimit(tasks, limit) {
  const results = [];
  const executing = [];
  for (const task of tasks) {
    const p = task();
    results.push(p);
    const e = p.then(() => executing.splice(executing.indexOf(e), 1));
    executing.push(e);
    if (executing.length >= limit) {
      await Promise.race(executing);
    }
  }
  return Promise.all(results);
}

// 阶段 1：Curl 网页探活并提取 JS 链接
function checkCurl(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { 
      rejectUnauthorized: false, 
      timeout: 15000,
      headers: {
        // 伪装成真实浏览器，防止被基础防火墙拦截
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache'
      }
    }, (res) => {
      const { statusCode } = res;
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        const isAlive = statusCode >= 200 && statusCode < 300 && data.length > 100;
        const hash = isAlive ? crypto.createHash('sha256').update(data).digest('hex') : '';
        
        let mainJsLink = '';
        if (isAlive) {
          const match = data.match(/src=["']([^"']*\/?main(?:\.[a-z0-9]+)?\.js)["']/i);
          if (match) {
            try {
              mainJsLink = new URL(match[1], url).href;
            } catch(e) {
              mainJsLink = match[1]; 
            }
          }
        }

        resolve({ 
          url, 
          statusCode, 
          hash, 
          isAlive,
          dataLength: data.length,
          mainJsLink 
        });
      });
    });
    
    req.on('error', (err) => {
      console.log(`[${getTime()}] Curl 错误 ${url}: ${err.message}`);
      resolve({ url, statusCode: 0, hash: '', isAlive: false, dataLength: 0, mainJsLink: '' });
    });
    
    req.on('timeout', () => {
      req.destroy();
      console.log(`[${getTime()}] Curl 超时 ${url}`);
      resolve({ url, statusCode: 0, hash: '', isAlive: false, dataLength: 0, mainJsLink: '' });
    });
  });
}

// 阶段 2：无头浏览器深度检测
async function checkBrowserPage(browser, url) {
  let page = null;
  
  try {
    page = await browser.newPage();
    
    // 【防拦截伪装】去除 Headless 标识，强制关闭 webdriver 属性，绕过 Cloudflare 拦截
    let ua = await browser.userAgent();
    await page.setUserAgent(ua.replace(/HeadlessChrome/g, 'Chrome'));
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    await page.setViewport({ width: 1280, height: 720 });
    
    const targetUrl = url.includes('?') 
      ? url + '&skipEntranceAnyKey&locale=en' 
      : url + '?skipEntranceAnyKey&locale=en';
    
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
    
    if (!response || !response.ok()) {
      return { url, status: 'Offline', httpStatus: response?.status() || 0 };
    }

    try {
      await page.waitForNetworkIdle({ timeout: 8000 });
    } catch (e) {
      // 网络空闲超时不报错
    }
    
    // 给足页面 JS 动态挂载表单的时间
    await new Promise(r => setTimeout(r, 4000)); 
    refreshCount = 0; 
    await new Promise(r => setTimeout(r, 2000));

    if (refreshCount > 0) {
       console.log(`[${getTime()}] 检测到自动刷新循环 - ${url}`);
       return { url, status: 'Error', error: 'Page auto-refreshes repeatedly' };
    }
    
    // 【增强检测逻辑】不再依赖宽高可见性，暴力匹配 DOM 和纯文本
    let hasInvitation = await page.evaluate(() => {
      // 1. 检查是否存在特定的 ID (只要 DOM 中存在 input#invite 就认定)
      if (document.querySelector('input#invite')) return true;
      
      const keywordRegex = /invitation|invite code|activation code|邀请码|邀请/i;
      
      // 2. 检查特定类的元素中是否包含邀请文本 (使用 textContent 替代 innerText)
      const titles = Array.from(document.querySelectorAll('.EntranceComponentStyle-title, [class*="title" i]'));
      if (titles.some(t => keywordRegex.test(t.textContent || ''))) return true;

      // 3. 终极托底：扩大搜索范围，直接在整个页面的纯文本中暴力检索
      const bodyText = document.body.textContent || '';
      if (keywordRegex.test(bodyText)) return true;

      // 4. 防止被嵌套在 iframe 中
      const frames = Array.from(window.frames);
      for (let i = 0; i < frames.length; i++) {
        try {
          if (keywordRegex.test(frames[i].document.body.textContent || '')) {
            return true;
          }
        } catch(e) {} 
      }
      return false;
    });

    return { 
      url, 
      status: hasInvitation ? 'Closed' : 'Open',
      httpStatus: response.status()
    };
    
  } catch (e) {
    const msg = e.message ? e.message.toLowerCase() : "";
    if (
      msg.includes('navigating') || 
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
    if (page) await page.close().catch(() => {});
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
    "https://public-deploy-classic.test-eu.tankionline.com/browser-public/index.html?config-template=https://c{server}.public-deploy-classic.test-eu.tankionline.com/config.xml&resources=../resources&balancer=https://balancer.public-deploy-classic.test-eu.tankionline.com/balancer",
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
    console.log(`[${getTime()}] Phase 1: Curl 检测 ${urls.length} 个 URL...`);
    const curlResults = await Promise.all(urls.map(url => checkCurl(url)));
    const candidatesForBrowser = [];

    for (const res of curlResults) {
      const { url, isAlive, hash, statusCode, mainJsLink } = res;
      if (isAlive) {
        candidatesForBrowser.push({ url, hash, mainJsLink });
        console.log(`[${getTime()}] Curl 存活: ${url} (${statusCode})`);
      } else {
        const oldEntry = committedStatusJson[url] || {};
        currentResults[url] = { status: "Offline", hash: oldEntry.hash || hash, mainJsLink: oldEntry.mainJsLink || "" };
      }
    }

    if (candidatesForBrowser.length > 0) {
      console.log(`[${getTime()}] Phase 2: 浏览器检测 ${candidatesForBrowser.length} 个候选...`);
      
      // 启动 Google 官方 Puppeteer 引擎
      browser = await puppeteer.launch({ 
        headless: true, // Google Puppeteer 最新写法，纯无头模式
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
      });
      
      // 组装要在 Puppeteer 中运行的任务池
      const browserTasks = candidatesForBrowser.map(candidate => async () => {
        const res = await checkBrowserPage(browser, candidate.url);
        return {
          ...res,
          hash: candidate.hash,
          mainJsLink: candidate.mainJsLink
        };
      });
      
      // 调用自己手写的原生并发控制执行任务
      const browserResults = await runWithLimit(browserTasks, BROWSER_CONCURRENCY);
      
      for (const res of browserResults) {
        const { url, status, hash, error, mainJsLink } = res;
        const oldEntry = committedStatusJson[url] || {};
        
        let finalStatus = status;
        if (status === 'Offline' && !error) {
          finalStatus = 'Closed'; 
        }
        
        const hashToSave = (finalStatus === 'Offline') && oldEntry.hash 
          ? oldEntry.hash 
          : hash;
        
        const linkToSave = (finalStatus === 'Offline') && oldEntry.mainJsLink 
          ? oldEntry.mainJsLink 
          : mainJsLink;
        
        currentResults[url] = { status: finalStatus, hash: hashToSave, mainJsLink: linkToSave };
        console.log(`[${getTime()}] 浏览器结果: ${url} -> ${finalStatus}`);
      }
    }

    // Phase 3: 状态比对
    for (const url of urls) {
      const currentEntry = currentResults[url] || { status: 'Offline', hash: '', mainJsLink: '' };
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
          const mainJsLink = currentEntry.mainJsLink; 

          let displayStatus = "";
          let displayStatusBold = "";
          if (finalStatus === "Open") { displayStatus = "开放"; displayStatusBold = "<b>开放</b>"; }
          else if (finalStatus === "Closed") { displayStatus = "封闭"; displayStatusBold = "<b>封闭</b>"; }
          else if (finalStatus === "Error") { displayStatus = "错误"; displayStatusBold = "<b>错误</b>"; }

          let message = "";
          const jsLinkText = mainJsLink ? `<br>▶ <b>提取JS:</b> <a href="${mainJsLink}">${mainJsLink}</a>` : "";
          
          if (!oldStatus && finalStatus !== "Offline") {
            message = `首次发现服务器 (状态: ${displayStatusBold})` + jsLinkText;
          }
          else if (oldStatus && finalStatus !== oldStatus) {
            if (oldStatus === "Offline") {
              if (finalStatus === "Error") {
                   let hashMsg = (hash !== oldHash) ? "，且检测到<b>更新</b>" + jsLinkText : "，且<b>无更新</b>";
                   message = `服务器已上线但出现<b>错误</b>${hashMsg}`;
              } else {
                   let baseMsg = finalStatus === "Open" ? "服务器已上线并<b>开放</b>" : "服务器已上线，当前为<b>封闭</b>状态";
                   let hashMsg = (hash !== oldHash) ? "，且检测到<b>更新</b>" + jsLinkText : "，且<b>无更新</b>";
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
               if (hash !== oldHash) message += `，且代码已<b>更新</b>` + jsLinkText;
            }
          }
          else if (oldStatus !== "Offline" && finalStatus !== "Offline" && oldHash && hash !== oldHash) {
            message = `网页代码已更新（状态: ${displayStatusBold}）` + jsLinkText;
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

    // 生成可用服务器列表
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
      const success = fs.writeFileSync(STATE_FILE, JSON.stringify(finalStatusJson, null, 2));
      const pushed = commitAndPush();
      
      if (pushed) {
        const changeDetails = notifications.join('<br><br>'); 
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
