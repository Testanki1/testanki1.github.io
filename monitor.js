const puppeteer = require('puppeteer'); // 换用 Google 官方的无头浏览器库
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

// 提取并判断是否为 deploy 测试服带参数的链接，辅助后续结果合并
function getBaseUrlAndC(url) {
  const match = url.match(/^(https:\/\/public-deploy\d+\.test-eu\.tankionline\.com\/browser-public\/index\.html)\?config-template=https:\/\/c([12])\.public-deploy\d+\.test-eu\.tankionline\.com\/config\.xml$/);
  if (match) {
    return { base: match[1], c: match[2] };
  }
  return null;
}

// 原生 JS 实现的并发控制器（替代第三方的 p-limit）
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

async function checkBrowserPage(browser, url) {
  let page = null;
  
  try {
    page = await browser.newPage();
    // 移除硬编码的带版本号的 User-Agent，允许引擎自动采用匹配当前内核的最新 UA
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
    
    // Puppeteer 最新版废弃了 waitForTimeout，使用原生 Promise 延迟
    await new Promise(r => setTimeout(r, 3000)); 
    refreshCount = 0; 
    await new Promise(r => setTimeout(r, 2000));

    if (refreshCount > 0) {
       console.log(`[${getTime()}] 检测到自动刷新循环 - ${url}`);
       return { url, status: 'Error', error: 'Page auto-refreshes repeatedly' };
    }
    
    // Google Puppeteer 页面 DOM 检测（原 Playwright 写法的转化）
    let hasInvitation = await page.evaluate(() => {
      const inviteInput = document.querySelector('input#invite');
      const inputVisible = inviteInput && inviteInput.getBoundingClientRect().width > 0;
      if (inputVisible) return true;
      
      const titles = Array.from(document.querySelectorAll('.EntranceComponentStyle-title'));
      const titleVisible = titles.some(t => /INVITATION/i.test(t.innerText));
      if (titleVisible) return true;

      const keywordRegex = /invitation|invite code|activation code|邀请码|邀请/i;
      const frames = Array.from(window.frames);
      for (let i = 0; i < frames.length; i++) {
        try {
          if (keywordRegex.test(frames[i].document.body.innerText)) {
            return true;
          }
        } catch(e) {} // 忽略跨域等报错
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
  console.log(`\n[${getTime()}] ========== 监测循环开始 ==========`);

  const urls = [];
  // 按照需求，将同一个节点的 c1 和 c2 都放入任务列表
  for (let i = 1; i <= 10; i++) {
    const base = `https://public-deploy${i}.test-eu.tankionline.com/browser-public/index.html`;
    urls.push(`${base}?config-template=https://c1.public-deploy${i}.test-eu.tankionline.com/config.xml`);
    urls.push(`${base}?config-template=https://c2.public-deploy${i}.test-eu.tankionline.com/config.xml`);
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

    // Phase 3: 状态比对（此处仅做状态记录确认，分离提醒逻辑）
    let newlyConfirmed = [];
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
          newlyConfirmed.push(url);
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

    // Phase 4: 生成独立或合并的提示信息
    for (const url of newlyConfirmed) {
      const currentEntry = finalStatusJson[url];
      const committedEntry = committedStatusJson[url] || {};
      
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
      else if (finalStatus === "Offline") { displayStatus = "下线"; displayStatusBold = "<b>下线</b>"; }

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
        let displayUrl = url;
        const deployMatch = getBaseUrlAndC(url);

        // 检测判断并动态合并
        if (deployMatch) {
          const counterpartUrl = deployMatch.c === '1' 
            ? url.replace('c1.public-deploy', 'c2.public-deploy')
            : url.replace('c2.public-deploy', 'c1.public-deploy');
          
          const counterpartStatus = finalStatusJson[counterpartUrl] ? finalStatusJson[counterpartUrl].status : 'Offline';
          
          // 若同一节点的 c1 和 c2 最终状态一致，则抹除参数只显示主域；否则保留独立带参数链接
          if (finalStatus === counterpartStatus) {
            displayUrl = deployMatch.base;
          }
        }

        const notifStr = `- <a href="${displayUrl}">${displayUrl}</a>: ${message}`;
        if (!notifications.includes(notifStr)) {
          notifications.push(notifStr);
        }
      }
    }

    // 生成可用服务器列表，应用同样的合并判定策略
    const availableSet = new Set();
    for (const url of urls) {
      const statusEntry = finalStatusJson[url];
      if (statusEntry && statusEntry.status && statusEntry.status !== "Offline") {
        let displayUrl = url;
        let disp = '<b>未知</b>';
        if (statusEntry.status === 'Open') disp = '<b>开放</b>';
        else if (statusEntry.status === 'Closed') disp = '<b>封闭</b>';
        else if (statusEntry.status === 'Error') disp = '<b>错误</b>';

        const deployMatch = getBaseUrlAndC(url);
        if (deployMatch) {
          const counterpartUrl = deployMatch.c === '1' 
            ? url.replace('c1.public-deploy', 'c2.public-deploy')
            : url.replace('c2.public-deploy', 'c1.public-deploy');
          
          const counterpartStatus = finalStatusJson[counterpartUrl] ? finalStatusJson[counterpartUrl].status : 'Offline';
          
          if (statusEntry.status === counterpartStatus) {
            displayUrl = deployMatch.base;
          }
        }
        
        // 使用 Set 去重，避免当状态一致时列表里渲染两条纯基础链接的情况
        availableSet.add(`<a href="${displayUrl}">${displayUrl}</a> (状态: ${disp})`);
      }
    }
    availableServers = Array.from(availableSet);

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

// 启动逻辑（解决以前使用 setInterval 无视单次流程长短所带来的排队重叠灾难性隐患）
(async () => {
  console.log(`[${getTime()}] 监测器启动 (Standalone Mode)...`);
  
  const runLoop = async () => {
    if (Date.now() - START_TIME > MAX_RUNTIME) {
      process.exit(0);
    }
    const loopStart = Date.now();
    await main();
    const elapsed = Date.now() - loopStart;
    const delay = Math.max(0, CHECK_INTERVAL - elapsed);
    setTimeout(runLoop, delay);
  };

  runLoop();
})();
