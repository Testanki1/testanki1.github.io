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

// === 修改后的核心检测逻辑 ===
async function checkBrowserPage(browser, url) {
  let page = null;
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 },
    locale: 'en-US'
  });
  
  try {
    const targetUrl = url.includes('?') 
      ? url + '&skipEntranceAnyKey&locale=en' 
      : url + '?skipEntranceAnyKey&locale=en';
    
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

    // ====== 关键修改1: 大幅增加等待时间，确保 SPA 完成渲染 ======
    
    // 1) 等待网络空闲（JS/CSS 等资源加载完），超时从 5s → 15s
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {
      console.log(`[${getTime()}] networkidle 等待超时 - ${url}`);
    });
    
    // 2) 等待 React 应用渲染（#app-root 有实际子内容）
    await page.waitForFunction(() => {
      const root = document.getElementById('app-root');
      return root && root.children.length > 0 && root.innerHTML.length > 200;
    }, { timeout: 15000 }).catch(() => {
      console.log(`[${getTime()}] #app-root 渲染等待超时 - ${url}`);
    });
    
    // 3) 等待关键 UI 元素出现（invitation 表单、登录输入框、或标题文字等）
    //    用单个 CSS 选择器等多个目标，任一出现即可
    await page.waitForSelector(
      '#invite, input[type="text"], input[type="password"], .EntranceComponentStyle-title, [class*="Invite"], [class*="Registration"], [class*="Login"]', 
      { timeout: 20000 }
    ).catch(() => {
      console.log(`[${getTime()}] 等待表单/标题元素超时 - ${url}`);
    });
    
    // 4) 渲染稳定后再额外等一下
    await page.waitForTimeout(2000);
    
    // === 检测自动刷新 ===
    refreshCount = 0; 
    await page.waitForTimeout(3000);

    if (refreshCount > 0) {
       console.log(`[${getTime()}] 检测到自动刷新循环 - ${url}`);
       return { url, status: 'Error', error: 'Page auto-refreshes repeatedly' };
    }
    
    // ====== 关键修改2: 使用 page.evaluate() 在浏览器上下文中直接检测，最可靠 ======
    let hasInvitation = false;
    let detectionMethod = 'none';
    
    // --- 方法1: page.evaluate() 直接在浏览器上下文中检查 DOM ---
    try {
      const evalResult = await page.evaluate(() => {
        const result = { found: false, method: '', debug: {} };
        
        // 1a: 检查 #invite 输入框（最直接的标志）
        if (document.getElementById('invite')) {
          result.found = true;
          result.method = '#invite input found';
          return result;
        }
        
        // 1b: 检查 class 名中包含 "Invite" 或 "invite" 的元素
        const inviteClassEls = document.querySelectorAll(
          '[class*="Invite"], [class*="invite"], [class*="INVITE"]'
        );
        if (inviteClassEls.length > 0) {
          result.found = true;
          result.method = 'class contains Invite (' + inviteClassEls.length + ' elements)';
          return result;
        }
        
        // 1c: 用 TreeWalker 遍历所有文本节点，查找 "invitation"
        const walker = document.createTreeWalker(
          document.body || document.documentElement,
          NodeFilter.SHOW_TEXT,
          null,
          false
        );
        let textNode;
        while (textNode = walker.nextNode()) {
          if (/invitation/i.test(textNode.textContent)) {
            result.found = true;
            result.method = 'TreeWalker text node: "' + textNode.textContent.trim().substring(0, 50) + '"';
            return result;
          }
        }
        
        // 1d: 检查 body.innerText（可见文本）
        const bodyText = document.body?.innerText || '';
        if (/invitation/i.test(bodyText)) {
          result.found = true;
          result.method = 'body.innerText';
          return result;
        }
        
        // 1e: 检查完整 HTML 源码（兜底）
        const html = document.documentElement?.outerHTML || '';
        if (/invitation/i.test(html)) {
          result.found = true;
          result.method = 'outerHTML';
          return result;
        }
        
        // 如果都没找到，收集调试信息
        const appRoot = document.getElementById('app-root');
        result.debug.bodyTextLength = bodyText.length;
        result.debug.bodyTextSnippet = bodyText.substring(0, 500);
        result.debug.htmlLength = html.length;
        result.debug.appRootExists = !!appRoot;
        result.debug.appRootChildren = appRoot ? appRoot.children.length : 0;
        result.debug.appRootText = appRoot ? (appRoot.innerText || '').substring(0, 300) : 'NO_APP_ROOT';
        
        const inputs = document.querySelectorAll('input');
        result.debug.inputCount = inputs.length;
        result.debug.inputDetails = Array.from(inputs).map(i => 
          `id=${i.id||'?'} name=${i.name||'?'} type=${i.type||'?'}`
        ).join('; ');
        
        return result;
      });
      
      if (evalResult.found) {
        hasInvitation = true;
        detectionMethod = `evaluate: ${evalResult.method}`;
      } else {
        // 打印调试信息帮助排查
        console.log(`[${getTime()}] evaluate 未检测到 invitation - ${url}`);
        console.log(`  bodyTextLength=${evalResult.debug.bodyTextLength}, htmlLength=${evalResult.debug.htmlLength}`);
        console.log(`  appRoot: exists=${evalResult.debug.appRootExists}, children=${evalResult.debug.appRootChildren}`);
        console.log(`  inputs: count=${evalResult.debug.inputCount}, details=[${evalResult.debug.inputDetails}]`);
        console.log(`  appRootText: "${evalResult.debug.appRootText}"`);
        console.log(`  bodySnippet: "${evalResult.debug.bodyTextSnippet}"`);
      }
    } catch (e) {
      console.log(`[${getTime()}] page.evaluate 异常 - ${url}: ${e.message}`);
    }
    
    // --- 方法2: 遍历子 frames（处理 iframe 嵌套的情况） ---
    if (!hasInvitation) {
      const frames = page.frames();
      const keywordRegex = /invitation|invite[\s_-]*code|activation[\s_-]*code|邀请码|邀请/i;
      
      for (const frame of frames) {
        if (frame === page.mainFrame()) continue; // 主 frame 已通过 evaluate 检查
        try {
          const frameHtml = await frame.content();
          if (keywordRegex.test(frameHtml)) {
            hasInvitation = true;
            detectionMethod = `子frame content (${frame.url()})`;
            break;
          }
        } catch (err) {
          // 跨域 frame 无法访问，忽略
        }
        try {
          const frameText = await frame.evaluate(() => document.body?.innerText || '');
          if (keywordRegex.test(frameText)) {
            hasInvitation = true;
            detectionMethod = `子frame innerText (${frame.url()})`;
            break;
          }
        } catch (err) {}
      }
    }
    
    // --- 方法3: Playwright 文本定位器（第三重保险） ---
    if (!hasInvitation) {
      try {
        const count = await page.getByText(/invitation/i).count();
        if (count > 0) {
          hasInvitation = true;
          detectionMethod = 'getByText(/invitation/i)';
        }
      } catch (e) {}
    }
    
    const finalStatus = hasInvitation ? 'Closed' : 'Open';
    console.log(`[${getTime()}] 最终结果: ${url} -> ${finalStatus} (方法: ${detectionMethod})`);
    
    return { 
      url, 
      status: finalStatus,
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

    // Phase 2: Browser（关键修改：添加 WebGL 支持参数）
    if (candidatesForBrowser.length > 0) {
      console.log(`[${getTime()}] Phase 2: 浏览器检测 ${candidatesForBrowser.length} 个候选...`);
      browser = await chromium.launch({ 
        headless: true,
        args: [
          '--no-sandbox', 
          '--disable-setuid-sandbox', 
          '--disable-dev-shm-usage',
          '--use-gl=swiftshader',
          '--enable-webgl',
          '--disable-gpu-sandbox'
        ]
      });
      
      const { default: pLimit } = await import('p-limit');
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
