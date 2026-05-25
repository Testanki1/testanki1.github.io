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
            try { mainJsLink = new URL(match[1], url).href; } 
            catch(e) { mainJsLink = match[1]; }
          }
        }
        resolve({ url, statusCode, hash, isAlive, dataLength: data.length, mainJsLink });
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

async function checkBrowserPage(browser, targetUrl) {
  let page = null;
  try {
    page = await browser.newPage();
    await page.setCacheEnabled(false); 
    await page.setViewport({ width: 1280, height: 720 });
    
    const finalUrl = targetUrl.includes('?') 
      ? targetUrl + '&skipEntranceAnyKey&locale=en' 
      : targetUrl + '?skipEntranceAnyKey&locale=en';
    
    let refreshCount = 0;
    const navListener = (frame) => {
      if (frame === page.mainFrame() && frame.url() !== 'about:blank') refreshCount++;
    };
    page.on('framenavigated', navListener);

    const response = await page.goto(finalUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    if (!response || !response.ok()) {
      return { status: 'Offline', httpStatus: response?.status() || 0 };
    }

    try { await page.waitForNetworkIdle({ timeout: 8000 }); } catch (e) {}
    await new Promise(r => setTimeout(r, 3000)); 
    refreshCount = 0; 
    await new Promise(r => setTimeout(r, 2000));

    if (refreshCount > 0) {
       console.log(`[${getTime()}] 检测到自动刷新循环 - ${targetUrl}`);
       return { status: 'Error', error: 'Page auto-refreshes repeatedly' };
    }
    
    let hasInvitation = await page.evaluate(() => {
      const inviteInput = document.querySelector('input#invite');
      if (inviteInput && inviteInput.getBoundingClientRect().width > 0) return true;
      const titles = Array.from(document.querySelectorAll('.EntranceComponentStyle-title'));
      if (titles.some(t => /INVITATION/i.test(t.innerText))) return true;
      const keywordRegex = /invitation|invite code|activation code|邀请码|邀请/i;
      const frames = Array.from(window.frames);
      for (let i = 0; i < frames.length; i++) {
        try { if (keywordRegex.test(frames[i].document.body.innerText)) return true; } catch(e) {} 
      }
      return false;
    });

    return { status: hasInvitation ? 'Closed' : 'Open', httpStatus: response.status() };
    
  } catch (e) {
    const msg = e.message ? e.message.toLowerCase() : "";
    if (msg.includes('navigating') || msg.includes('execution context') || msg.includes('destroyed') || msg.includes('timeout') || msg.includes('redirect')) {
       console.log(`[${getTime()}] 捕获不稳定状态(Error) - ${targetUrl}: ${e.message}`);
       return { status: 'Error', error: e.message };
    }
    console.log(`[${getTime()}] 判定为 Offline - ${targetUrl}: ${e.message}`);
    return { status: 'Offline', error: e.message };
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

// ================== 重写的 Git 提交模块，抗并发、带重试与回滚 ==================
async function commitAndPush(retries = 3) {
  try {
    execSync('git config --global user.name "github-actions[bot]"');
    execSync('git config --global user.email "github-actions[bot]@users.noreply.github.com"');
    execSync(`git add ${STATE_FILE}`);
    
    const status = execSync('git status --porcelain').toString();
    if (!status) return false;

    execSync('git commit -m "chore: 自动更新服务器状态 [skip ci]"', { stdio: 'pipe' });
  } catch (e) {
    console.error(`[${getTime()}] Git commit 失败或无更改`);
    return false;
  }

  for (let i = 0; i < retries; i++) {
    try {
      execSync('git pull --rebase origin main', { stdio: 'pipe' });
      execSync('git push origin main', { stdio: 'pipe' });
      console.log(`[${getTime()}] Git 状态已更新并推送成功。`);
      return true;
    } catch (e) {
      const errorMsg = (e.stderr || e.message).toString().split('\n')[0];
      console.error(`[${getTime()}] Git push 失败 (尝试 ${i + 1}/${retries}):`, errorMsg);
      // 中断可能残留的错乱 rebase 状态
      try { execSync('git rebase --abort', { stdio: 'ignore' }); } catch (err) {}
      
      if (i < retries - 1) {
        // 随机延迟 2 到 5 秒避让其他正在推送的进程
        const delay = 2000 + Math.random() * 3000;
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  console.error(`[${getTime()}] Git 推送彻底失败，正在撤销本地提交以保证下一次环境干净...`);
  try {
    // 强制丢弃刚刚生成但没推上去的 commit，避免下个循环卡死
    execSync('git reset --hard HEAD~1', { stdio: 'ignore' }); 
  } catch (e) {}
  
  return false;
}

function isStateEqual(a, b) {
  if (!a || !b) return false;
  if (a.hash !== b.hash) return false;
  if (a.type !== b.type) return false;
  if (a.type === 'deploy') {
    const a1 = a.configs ? a.configs['1'] : (a.status || 'Offline');
    const a2 = a.configs ? a.configs['2'] : (a.status || 'Offline');
    const b1 = b.configs ? b.configs['1'] : (b.status || 'Offline');
    const b2 = b.configs ? b.configs['2'] : (b.status || 'Offline');
    return a1 === b1 && a2 === b2;
  }
  return a.status === b.status;
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

function getStatusDisplay(status) {
  if (status === 'Open') return '<b>开放</b>';
  if (status === 'Closed') return '<b>封闭</b>';
  if (status === 'Error') return '<b>错误</b>';
  if (status === 'Offline') return '<b>下线</b>';
  if (status === 'Mixed') return '<b>一开一关</b>';
  return `<b>${status}</b>`; 
}

function getPriority(status) {
  if (status === 'Open') return 4;
  if (status === 'Closed') return 3;
  if (status === 'Error') return 2;
  if (status === 'Offline') return 1;
  return 0;
}

function generateMessage(oldStatus, finalStatus, oldHash, hash, mainJsLink, isSubServer = false) {
  const jsLinkText = mainJsLink ? `<br>▶ <b>提取JS:</b> <a href="${mainJsLink}">${mainJsLink}</a>` : "";
  const displayStatusBold = getStatusDisplay(finalStatus);
  const oldDisplay = getStatusDisplay(oldStatus);
  let entity = isSubServer ? "子服务器" : "服务器";

  if (!oldStatus && finalStatus !== "Offline") {
    return `首次发现${entity} (状态: ${displayStatusBold})` + jsLinkText;
  }
  
  if (oldStatus && finalStatus !== oldStatus) {
    if (oldStatus === "Mixed") {
      let hashMsg = (hash !== oldHash) ? "，且检测到<b>更新</b>" + jsLinkText : "，且<b>无更新</b>";
      
      if (finalStatus === "Offline") return `${entity}已下线 (原状态: ${oldDisplay})`;
      
      if (finalStatus === "Error") return `${entity}出现<b>错误</b>${hashMsg}`;
      if (finalStatus === "Open") return `${entity}已统一<b>开放</b>${hashMsg}`;
      if (finalStatus === "Closed") return `${entity}已统一转为<b>封闭</b>状态${hashMsg}`;
    }

    if (oldStatus === "Offline") {
      let hashMsg = (hash !== oldHash) ? "，且检测到<b>更新</b>" + jsLinkText : "，且<b>无更新</b>";
      if (finalStatus === "Error") return `${entity}已上线但出现<b>错误</b>${hashMsg}`;
      let baseMsg = finalStatus === "Open" ? `${entity}已上线并<b>开放</b>` : `${entity}已上线，当前为<b>封闭</b>状态`;
      return baseMsg + hashMsg;
    } 
    else if (finalStatus === "Offline") {
      return `${entity}已下线 (原状态: ${oldDisplay})`;
    } else {
       let msg = `${entity}状态已从 ${oldDisplay} 变为 ${displayStatusBold}`;
       if (hash !== oldHash) msg += `，且代码已<b>更新</b>` + jsLinkText;
       return msg;
    }
  }
  else if (oldStatus !== "Offline" && oldStatus !== "Mixed" && finalStatus !== "Offline" && oldHash && hash !== oldHash) {
    return `网页代码已更新（状态: ${displayStatusBold}）` + jsLinkText;
  }
  return "";
}

async function main() {
  console.log(`\n[${getTime()}] ========== 监测循环开始 ==========`);

  // 前置清理保护：防范上一次如果发生异常冲突导致的遗留 rebase 问题
  try {
    execSync('git pull --rebase origin main', { stdio: 'pipe' });
  } catch (e) {
    try { execSync('git rebase --abort', { stdio: 'ignore' }); } catch (err) {}
  }

  const baseUrls = [];
  for (let i = 1; i <= 10; i++) {
    baseUrls.push({ url: `https://public-deploy${i}.test-eu.tankionline.com/browser-public/index.html`, type: 'deploy' });
  }
  baseUrls.push(
    { url: "https://test.ru.tankionline.com/play/?config-template=https://c{server}.ru.tankionline.com/config.xml&balancer=https://balancer.ru.tankionline.com/balancer&resources=https://s.ru.tankionline.com", type: 'other' },
    { url: "https://public-deploy-classic.test-eu.tankionline.com/browser-public/index.html?config-template=https://c{server}.public-deploy-classic.test-eu.tankionline.com/config.xml&resources=../resources&balancer=https://balancer.public-deploy-classic.test-eu.tankionline.com/balancer", type: 'other' },
    { url: "https://tankiclassic.com/play/", type: 'other' }
  );

  let diskStatusJson = {};
  if (fs.existsSync(STATE_FILE)) {
    try {
      diskStatusJson = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    } catch (e) {
      console.error(`[${getTime()}] 读取 ${STATE_FILE} 失败，将视为新状态`);
    }
  }

  let notifications = [];
  let availableServers = [];
  let browser = null;
  let currentResults = {};

  try {
    console.log(`[${getTime()}] Phase 1: Curl 检测 ${baseUrls.length} 个基础 URL...`);
    const curlPromises = baseUrls.map(item => checkCurl(item.url));
    const curlResultsArray = await Promise.all(curlPromises);
    const curlResults = {};
    for (const res of curlResultsArray) curlResults[res.url] = res;

    for (const item of baseUrls) {
      const baseUrl = item.url;
      const curlRes = curlResults[baseUrl];
      
      let entry = { type: item.type, hash: '', mainJsLink: '' };
      
      if (curlRes && curlRes.isAlive) {
         entry.hash = curlRes.hash;
         entry.mainJsLink = curlRes.mainJsLink;
         if (item.type === 'deploy') entry.configs = { '1': 'Offline', '2': 'Offline' };
         else entry.status = 'Offline';
      } else {
         const oldEntry = diskStatusJson[baseUrl] || {};
         entry.hash = oldEntry.hash || curlRes?.hash || '';
         entry.mainJsLink = oldEntry.mainJsLink || curlRes?.mainJsLink || '';
         entry.status = 'Offline';
      }
      currentResults[baseUrl] = entry;
    }

    const browserTasks = [];
    for (const item of baseUrls) {
      if (!curlResults[item.url] || !curlResults[item.url].isAlive) continue;
      
      if (item.type === 'deploy') {
        const serverNum = item.url.match(/deploy(\d+)/)[1];
        for (const c of ['1', '2']) {
          const target = `${item.url}?config-template=https://c${c}.public-deploy${serverNum}.test-eu.tankionline.com/config.xml`;
          browserTasks.push(async () => {
            const res = await checkBrowserPage(browser, target);
            return { baseUrl: item.url, c, status: res.status, error: res.error };
          });
        }
      } else {
        browserTasks.push(async () => {
          const res = await checkBrowserPage(browser, item.url);
          return { baseUrl: item.url, status: res.status, error: res.error };
        });
      }
    }

    if (browserTasks.length > 0) {
      console.log(`[${getTime()}] Phase 2: 浏览器检测 ${browserTasks.length} 个子任务...`);
      browser = await puppeteer.launch({ 
        headless: true, 
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--incognito']
      });
      
      const browserResults = await runWithLimit(browserTasks, BROWSER_CONCURRENCY);
      
      for (const res of browserResults) {
        let finalStatus = res.status;
        if (finalStatus === 'Offline' && !res.error) finalStatus = 'Closed'; 
        
        const currentEntry = currentResults[res.baseUrl];
        if (res.c && currentEntry.configs) {
          currentEntry.configs[res.c] = finalStatus;
        } else {
          currentEntry.status = finalStatus;
        }
      }
    }

    for (const item of baseUrls) {
      const currentEntry = currentResults[item.url];
      if (item.type === 'deploy' && currentEntry.configs) {
        if (currentEntry.configs['1'] === 'Offline' && currentEntry.configs['2'] === 'Offline') {
          currentEntry.status = 'Offline';
          delete currentEntry.configs;
        }
      }
    }

    let newlyConfirmed = [];
    let finalStatusJson = { ...diskStatusJson };

    for (const item of baseUrls) {
      const baseUrl = item.url;
      const currentEntry = currentResults[baseUrl];
      const diskEntry = diskStatusJson[baseUrl] || {};
      
      if (!isStateEqual(currentEntry, diskEntry)) {
        console.log(`[${getTime()}] 检测到最新状态与文件不一致: ${baseUrl}`);
        finalStatusJson[baseUrl] = currentEntry;
        newlyConfirmed.push(baseUrl);
      }
    }

    for (const baseUrl of newlyConfirmed) {
      const currentEntry = finalStatusJson[baseUrl];
      const diskEntry = diskStatusJson[baseUrl] || {}; 
      const oldHash = diskEntry.hash || null;
      const hash = currentEntry.hash;
      const mainJsLink = currentEntry.mainJsLink;

      if (currentEntry.type === 'deploy') {
         const c1New = currentEntry.configs ? currentEntry.configs['1'] : (currentEntry.status || 'Offline');
         const c2New = currentEntry.configs ? currentEntry.configs['2'] : (currentEntry.status || 'Offline');
         const c1Old = diskEntry.configs ? diskEntry.configs['1'] : (diskEntry.status || null);
         const c2Old = diskEntry.configs ? diskEntry.configs['2'] : (diskEntry.status || null);

         if (c1New === c2New) {
            const statusNew = c1New;
            const statusOld = (c1Old && c1Old === c2Old) ? c1Old : (c1Old ? 'Mixed' : null);
            const msg = generateMessage(statusOld, statusNew, oldHash, hash, mainJsLink, false);
            if (msg) notifications.push(`- <a href="${baseUrl}">${baseUrl}</a>: ${msg}`);
         } else {
            const serverNum = baseUrl.match(/deploy(\d+)/)[1];
            const p1 = getPriority(c1New);
            const p2 = getPriority(c2New);

            for (const c of ['1', '2']) {
               if (c === '1' && p1 < p2) continue;
               if (c === '2' && p2 < p1) continue;

               const stNew = c === '1' ? c1New : c2New;
               const stOld = c === '1' ? c1Old : c2Old;
               const targetUrl = `${baseUrl}?config-template=https://c${c}.public-deploy${serverNum}.test-eu.tankionline.com/config.xml`;
               const msg = generateMessage(stOld, stNew, oldHash, hash, mainJsLink, true);
               if (msg) notifications.push(`- <a href="${targetUrl}">${targetUrl}</a>: ${msg}`);
            }
         }
      } else {
         const statusNew = currentEntry.status;
         const statusOld = diskEntry.status || null;
         const msg = generateMessage(statusOld, statusNew, oldHash, hash, mainJsLink, false);
         if (msg) notifications.push(`- <a href="${baseUrl}">${baseUrl}</a>: ${msg}`);
      }
    }

    const availableSet = new Set();
    for (const item of baseUrls) {
      const baseUrl = item.url;
      const entry = finalStatusJson[baseUrl];
      if (!entry) continue;

      if (item.type === 'deploy') {
         const c1 = entry.configs ? entry.configs['1'] : (entry.status || 'Offline');
         const c2 = entry.configs ? entry.configs['2'] : (entry.status || 'Offline');
         if (c1 === 'Offline' && c2 === 'Offline') continue;
         
         if (c1 === c2) {
            availableSet.add(`<a href="${baseUrl}">${baseUrl}</a> (状态: ${getStatusDisplay(c1)})`);
         } else {
            const serverNum = baseUrl.match(/deploy(\d+)/)[1];
            const p1 = getPriority(c1);
            const p2 = getPriority(c2);

            if (c1 !== 'Offline' && p1 >= p2) {
               const t1 = `${baseUrl}?config-template=https://c1.public-deploy${serverNum}.test-eu.tankionline.com/config.xml`;
               availableSet.add(`<a href="${t1}">${t1}</a> (状态: ${getStatusDisplay(c1)})`);
            }
            if (c2 !== 'Offline' && p2 >= p1) {
               const t2 = `${baseUrl}?config-template=https://c2.public-deploy${serverNum}.test-eu.tankionline.com/config.xml`;
               availableSet.add(`<a href="${t2}">${t2}</a> (状态: ${getStatusDisplay(c2)})`);
            }
         }
      } else {
         if (entry.status && entry.status !== 'Offline') {
            availableSet.add(`<a href="${baseUrl}">${baseUrl}</a> (状态: ${getStatusDisplay(entry.status)})`);
         }
      }
    }
    availableServers = Array.from(availableSet);

    // ==============================================
    // 关键修改区：保证 Git 推送和发邮件是 1 对 1 绑定
    // ==============================================
    if (notifications.length > 0) {
      // 只有在存在需要通告的变化时，才写入文件并向 Github 推送
      fs.writeFileSync(STATE_FILE, JSON.stringify(finalStatusJson, null, 2));
      const pushed = await commitAndPush();
      
      // 推送成功后发送邮件
      if (pushed) {
        const changeDetails = notifications.join('<br><br>'); 
        const availableListHeader = `<br><hr><b>当前已上线的服务器列表（${availableServers.length} 个）:</b><br>`;
        const availableListBody = availableServers.length > 0 ? availableServers.join('<br>') : "目前没有已上线的服务器。";
        const fullBody = `检测到状态变化：<br>${changeDetails}${availableListHeader}${availableListBody}`;
        await sendEmail(fullBody);
      }
    } else {
      if (newlyConfirmed.length > 0) {
        // 发现变化但这些变化被逻辑判定为“不值得发邮件提醒”
        // 仅在本地缓存更新以便下一次循环对比，但绝不会进行 commitAndPush
        fs.writeFileSync(STATE_FILE, JSON.stringify(finalStatusJson, null, 2));
        console.log(`[${getTime()}] 无需通知的新状态变化，仅更新本地状态，已跳过 Git 推送。`);
      } else {
        console.log(`[${getTime()}] 无状态变化。`);
      }
    }

  } catch (err) {
    console.error(`[${getTime()}] 主循环错误:`, err);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// 启动定时递归器
(async () => {
  console.log(`[${getTime()}] 监测器启动 (Standalone Mode)...`);
  const runLoop = async () => {
    if (Date.now() - START_TIME > MAX_RUNTIME) process.exit(0);
    const loopStart = Date.now();
    await main();
    const elapsed = Date.now() - loopStart;
    setTimeout(runLoop, Math.max(0, CHECK_INTERVAL - elapsed));
  };
  runLoop();
})();
