const { chromium } = require('playwright');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const { execSync } = require('child_process');
const nodemailer = require('nodemailer');

// --- 配置 ---
const STATE_FILE = 'server_status.json';
const CHECK_INTERVAL = 60 * 1000; // 1分钟检测一次
const MAX_RUNTIME = 4.95 * 60 * 60 * 1000; // GitHub Actions 限制
const START_TIME = Date.now();
const BROWSER_CONCURRENCY = 3; 
const CONFIRMATION_THRESHOLD = 2; // 连续确认次数

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

// 基础 CURL 检测 (用于快速过滤死链接)
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

// === 核心逻辑：增强版浏览器检测 ===
async function checkBrowserPage(browser, url) {
  let page = null;
  // 强制英文环境，确保 "Invitation" 关键词匹配
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

    // 监听自动刷新
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

    // 等待网络空闲，确保动态内容加载
    try {
        await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    } catch (e) {}

    // 额外强制等待，确保 JS 渲染完输入框
    await page.waitForTimeout(3000); 

    if (refreshCount > 1) { // 允许一次跳转
       console.log(`[${getTime()}] 检测到自动刷新循环 - ${url}`);
       return { url, status: 'Error', error: 'Page auto-refreshes repeatedly' };
    }
    
    // === 深度内容检测 ===
    let hasInvitation = false;
    const frames = page.frames();

    // 关键词列表 (全小写)
    // 涵盖：invitation code, invite, activation key, voucher, 邀请
    const keywords = ['invitation', 'invite', 'activation', 'voucher', 'code', '邀请码', '邀请'];

    for (const frame of frames) {
        try {
            // 1. 检查 Input/Textarea 属性 (最关键的修复)
            // 很多游戏的邀请码是在 input placeholder 里，innerText 抓不到
            const foundInInput = await frame.evaluate((kws) => {
                const inputs = document.querySelectorAll('input, textarea');
                for (const el of inputs) {
                    // 拼接所有可能包含信息的属性
                    const text = (
                        (el.getAttribute('placeholder') || '') + ' ' + 
                        (el.value || '') + ' ' + 
                        (el.name || '')
                    ).toLowerCase();
                    
                    // 只要包含 'invitation' 或 'invite' 这种强特征词
                    if (text.includes('invitation') || text.includes('invite') || text.includes('邀请')) {
                        return true;
                    }
                    // 或者是 'activation' + 'code' 组合
                    if (text.includes('activation') && text.includes('code')) {
                        return true;
                    }
                }
                return false;
            }, keywords);

            if (foundInInput) {
                console.log(`[${getTime()}] 侦测到 Input 属性包含邀请关键词: ${frame.url()}`);
                hasInvitation = true;
                break;
            }

            // 2. 检查可见文本 (innerText)
            const visibleText = (await frame.innerText('body').catch(() => '')).toLowerCase();
            // 使用正则匹配更准确
            if (/invitation|invite code|activation code|enter code|邀请码/.test(visibleText)) {
                console.log(`[${getTime()}] 侦测到页面文本包含邀请关键词: ${frame.url()}`);
                hasInvitation = true;
                break;
            }

            // 3. 检查 HTML 源码 (保底)
            if (!hasInvitation) {
                const content = await frame.content();
                if (/invitation|invite code|activation code/i.test(content)) {
                    console.log(`[${getTime()}] 侦测到源码包含邀请关键词: ${frame.url()}`);
                    hasInvitation = true;
                    break;
                }
            }
        } catch (err) {
            // 忽略跨域 frame 报错
        }
    }
    
    return { 
      url, 
      status: hasInvitation ? 'Closed' : 'Open',
      httpStatus: response.status()
    };
    
  } catch (e) {
    const msg = e.message ? e.message.toLowerCase() : "";
    // 过滤掉一些非致命的浏览器错误
    if (msg.includes('navigating') || msg.includes('destroyed') || msg.includes('timeout')) {
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
  if (!process.env.MAIL_USERNAME || !process.env.MAIL_TO) {
      console.log(`[${getTime()}] 未配置邮件环境，跳过发送。`);
      return;
  }
  try {
    await transporter.sendMail({
      from: `"Tanki Monitor" <${process.env.MAIL_USERNAME}>`,
      to: process.env.MAIL_TO,
      subject: "3D坦克测试服务器状态变更",
      html: `你好，<br><br>${body}<br><br>此邮件由 GitHub Actions 自动监测发送。`
    });
    console.log(`[${getTime()}] 邮件已发送。`);
  } catch (error) {
    console.error(`[${getTime()}] 邮件发送失败:`, error);
  }
}

function isStateEqual(a, b) {
  if (!a || !b) return false;
  // 如果状态是 Error，我们不希望频繁报错，除非 hash 变了
  return a.status === b.status && a.hash === b.hash;
}

async function main() {
  const loopStart = Date.now();
  console.log(`\n[${getTime()}] ========== 监测循环开始 ==========`);

  const urls = [];
  // 生成 Tanki Online 测试服链接
  for (let i = 1; i <= 10; i++) {
    urls.push(`https://public-deploy${i}.test-eu.tankionline.com/browser-public/index.html`);
  }
  urls.push(
    "https://test.ru.tankionline.com/play/?config-template=https://c{server}.ru.tankionline.com/config.xml&balancer=https://balancer.ru.tankionline.com/balancer&resources=https://s.ru.tankionline.com",
    "https://tankiclassic.com/play/"
  );

  let committedStatusJson = {};
  
  // 读取上次状态
  if (fs.existsSync(STATE_FILE)) {
    try {
      committedStatusJson = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    } catch (e) {
      console.error(`[${getTime()}] 读取状态文件失败，将重置。`);
    }
  }

  let finalStatusJson = { ...committedStatusJson };
  let notifications = [];
  let availableServers = [];
  let browser = null;
  let currentResults = {};

  try {
    // Phase 1: Curl 快速筛选
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

    // Phase 2: Playwright 浏览器精准检测
    if (candidatesForBrowser.length > 0) {
      console.log(`[${getTime()}] Phase 2: 浏览器检测 ${candidatesForBrowser.length} 个候选...`);
      browser = await chromium.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
      });
      
      // 动态导入 p-limit 用于并发控制
      const { default: pLimit } = await import('p-limit');
      const limit = pLimit(BROWSER_CONCURRENCY);
      
      const browserPromises = candidatesForBrowser.map(candidate => 
        limit(() => checkBrowserPage(browser, candidate.url).then(res => ({
          ...res,
          hash: candidate.hash // 继承 Curl 的 hash 用于判断文件变更
        })))
      );
      
      const browserResults = await Promise.all(browserPromises);
      
      for (const res of browserResults) {
        const { url, status, hash, error } = res;
        const oldEntry = committedStatusJson[url] || {};
        
        let finalStatus = status;
        
        // 智能哈希保留：如果现在离线，但之前有哈希，保留旧哈希以免丢失“上次已知状态”
        const hashToSave = (finalStatus === 'Offline' || finalStatus === 'Error') && oldEntry.hash 
          ? oldEntry.hash 
          : hash;
        
        currentResults[url] = { status: finalStatus, hash: hashToSave };
        console.log(`[${getTime()}] 浏览器结果: ${url} -> ${finalStatus}`);
      }
    }

    // Phase 3: 状态比对与消抖
    for (const url of urls) {
      const currentEntry = currentResults[url] || { status: 'Offline', hash: '' };
      const committedEntry = committedStatusJson[url] || {};
      
      // 如果状态完全一致，跳过
      if (isStateEqual(currentEntry, committedEntry)) {
        if (pendingChanges[url]) delete pendingChanges[url];
        finalStatusJson[url] = committedEntry;
        continue;
      }

      // 如果状态不一致，进入消抖逻辑
      const pending = pendingChanges[url];
      if (pending && isStateEqual(pending.entry, currentEntry)) {
        pending.count++;
        // 达到阈值，确认变更
        if (pending.count >= CONFIRMATION_THRESHOLD) {
          finalStatusJson[url] = currentEntry;
          delete pendingChanges[url];
          
          const oldStatus = committedEntry.status || "Unknown";
          const finalStatus = currentEntry.status;
          
          let displayStatus = "";
          let displayStatusBold = "";
          if (finalStatus === "Open") { displayStatus = "开放"; displayStatusBold = "<b style='color:green'>开放</b>"; }
          else if (finalStatus === "Closed") { displayStatus = "封闭"; displayStatusBold = "<b style='color:orange'>封闭</b>"; }
          else if (finalStatus === "Error") { displayStatus = "错误"; displayStatusBold = "<b style='color:red'>错误</b>"; }
          else { displayStatus = "离线"; displayStatusBold = "<b style='color:gray'>离线</b>"; }

          let message = "";
          
          if (oldStatus !== finalStatus) {
             message = `状态变更: ${oldStatus} -> ${displayStatusBold}`;
             // 如果是从离线变上线，或者从封闭变开放，强调一下
             if (finalStatus === 'Open') message = `🚀 服务器已上线并${displayStatusBold}`;
             if (finalStatus === 'Closed') message = `🔒 服务器上线但处于${displayStatusBold}状态 (需要邀请码)`;
          } else if (currentEntry.hash !== committedEntry.hash && finalStatus !== 'Offline') {
             message = `网页代码更新 (状态保持: ${displayStatusBold})`;
          }
          
          if (message) {
            notifications.push(`- <a href="${url}">${url}</a>: ${message}`);
          }
        } else {
          console.log(`[${getTime()}] 待确认变更 ${pending.count}/${CONFIRMATION_THRESHOLD}: ${url} -> ${currentEntry.status}`);
          finalStatusJson[url] = committedEntry; // 保持旧状态直到确认
        }
      } else {
        // 第一次发现变更，加入 pending
        console.log(`[${getTime()}] 发现潜在变化: ${url} (${committedEntry.status || 'New'} -> ${currentEntry.status})`);
        pendingChanges[url] = { entry: currentEntry, count: 1, timestamp: Date.now() };
        finalStatusJson[url] = committedEntry;
      }
    }

    // 生成可用服务器列表 (用于邮件底部)
    for (const url of urls) {
      const statusEntry = finalStatusJson[url];
      if (statusEntry && (statusEntry.status === 'Open' || statusEntry.status === 'Closed')) {
        let color = statusEntry.status === 'Open' ? 'green' : 'orange';
        let txt = statusEntry.status === 'Open' ? '开放' : '封闭';
        availableServers.push(`<a href="${url}">${url}</a> <span style="color:${color}">[${txt}]</span>`);
      }
    }

    // 处理通知与保存
    if (notifications.length > 0) {
      fs.writeFileSync(STATE_FILE, JSON.stringify(finalStatusJson, null, 2));
      const pushed = commitAndPush();
      
      if (pushed) {
        const changeDetails = notifications.join('<br>');
        const availableListHeader = `<br><hr><b>当前在线服务器列表:</b><br>`;
        const availableListBody = availableServers.length > 0 ? availableServers.join('<br>') : "无在线服务器";
        const fullBody = `<h3>检测到状态变化：</h3>${changeDetails}${availableListHeader}${availableListBody}`;
        await sendEmail(fullBody);
      }
    } else {
      // 清理超时的 pending
      const now = Date.now();
      for (const [url, data] of Object.entries(pendingChanges)) {
        if (now - data.timestamp > 15 * 60 * 1000) {
          delete pendingChanges[url];
        }
      }
      console.log(`[${getTime()}] 无已确认的状态变化。`);
    }

  } catch (err) {
    console.error(`[${getTime()}] 主循环严重错误:`, err);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// 启动逻辑
(async () => {
  console.log(`[${getTime()}] 监测器启动...`);
  await main();
  
  const intervalId = setInterval(async () => {
    if (Date.now() - START_TIME > MAX_RUNTIME) {
      clearInterval(intervalId);
      console.log(`[${getTime()}] 达到最大运行时间，退出。`);
      process.exit(0);
    }
    await main();
  }, CHECK_INTERVAL);
})();
