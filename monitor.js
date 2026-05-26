const puppeteer = require('puppeteer');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const { execSync } = require('child_process');
const nodemailer = require('nodemailer');

// --- 配置 --- 
const STATE_FILE = 'server_status.json';
const CHECK_INTERVAL = 60 * 1000; // 严格的 1 分钟周期
const MAX_RUNTIME = 4.95 * 60 * 60 * 1000;
const START_TIME = Date.now();
const CONFIRMATION_THRESHOLD = 2; // 连续 2 次检测到相同的新状态才判定为生效
const BROWSER_CONCURRENCY = 4; // 并发限制

let pendingChanges = {}; // 内存队列

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

// 并发控制器
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
    const req = https.get(url, { rejectUnauthorized: false, timeout: 15000 }, (res) => {
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
            catch (e) { mainJsLink = match[1]; }
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

    try { await page.waitForNetworkIdle({ timeout: 5000 }); } catch (e) { }

    try {
      await new Promise(r => setTimeout(r, 2000));
      await page.bringToFront(); 
      await page.mouse.click(400, 300); 
      await page.keyboard.press('Space');
      await page.keyboard.press('Enter');
      await new Promise(r => setTimeout(r, 3000)); 
    } catch (e) { }

    let isAppLoaded = false;
    for (let poll = 0; poll < 15; poll++) {
      const frames = page.frames();
      for (const frame of frames) {
        try {
          isAppLoaded = await frame.evaluate(() => {
            const inputs = Array.from(document.querySelectorAll('input'));
            const visibleInput = inputs.find(i => i.offsetWidth > 0 && i.offsetHeight > 0);
            return !!visibleInput;
          });
          if (isAppLoaded) break;
        } catch (err) { }
      }
      if (isAppLoaded) break;
      await new Promise(r => setTimeout(r, 1500));
    }

    refreshCount = 0;
    await new Promise(r => setTimeout(r, 3000));

    if (refreshCount > 1) {
      return { status: 'Error', error: 'Page auto-refreshes repeatedly' };
    }

    let hasInvitation = false;
    const keywordRegex = /invitation|invite|activation|邀请|инвайт|приглаш|активац|maintenance|closed server|доступ закры特/i;

    const frames = page.frames();
    for (const frame of frames) {
      try {
        const frameCheck = await frame.evaluate((regexStr) => {
          const regex = new RegExp(regexStr, 'i');
          const inputs = Array.from(document.querySelectorAll('input'));
          const hasInviteInput = inputs.some(input => {
            const id = input.id || '';
            const placeholder = input.placeholder || '';
            const name = input.name || '';
            const className = input.className || '';
            return /invite|code|инвайт|активац|邀请|码/i.test(id + ' ' + placeholder + ' ' + name + ' ' + className);
          });

          if (hasInviteInput) {
            return { matched: true, text: '' };
          }

          const bodyText = document.body ? document.body.innerText : '';
          return { matched: regex.test(bodyText), text: bodyText };
        }, keywordRegex.source).catch(() => null);

        if (frameCheck && frameCheck.matched) {
          hasInvitation = true;
          break;
        }
      } catch (err) { }
    }

    return { status: hasInvitation ? 'Closed' : 'Open', httpStatus: response.status() };

  } catch (e) {
    const msg = e.message ? e.message.toLowerCase() : "";
    if (msg.includes('navigating') || msg.includes('execution context') ||
      msg.includes('destroyed') || msg.includes('timeout') ||
      msg.includes('redirect')) {
      console.log(`[${getTime()}] 捕获不稳定状态(Error) - ${targetUrl}: ${e.message}`);
      return { status: 'Error', error: e.message };
    }
    console.log(`[${getTime()}] 判定为 Offline - ${targetUrl}: ${e.message}`);
    return { status: 'Offline', error: e.message };
  } finally {
    if (page) await page.close().catch(() => { });
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

    execSync('git commit -m "chore: 测试服务器状态更新"');
    console.log(`[${getTime()}] 正在同步远程仓库...`);
    execSync('git pull --rebase origin main', { stdio: 'pipe' });
    execSync('git push origin main');
    console.log(`[${getTime()}] Git 状态已更新并推送成功。`);
    return true;

  } catch (e) {
    console.error(`[${getTime()}] Git 操作失败:`, e.message);
    try { execSync('git rebase --abort'); } catch (abortErr) { }
    return false;
  }
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

// === UI 渲染助手函数 ===

function getStatusDisplay(status) {
  if (status === 'Open') return '开放';
  if (status === 'Closed') return '封闭';
  if (status === 'Error') return '错误';
  if (status === 'Offline') return '下线';
  if (status === 'Mixed') return '一开一关';
  return status;
}

function getPriority(status) {
  if (status === 'Open') return 4;
  if (status === 'Closed') return 3;
  if (status === 'Error') return 2;
  if (status === 'Offline') return 1;
  return 0;
}

function getStatusStyles(status) {
  let bg = "rgba(191, 213, 255, 0.15)";
  let color = "#BFD5FF";
  if (status === 'Open') { bg = "rgba(118, 255, 51, 0.15)"; color = "#76FF33"; }
  else if (status === 'Error') { bg = "rgba(255, 102, 102, 0.15)"; color = "#FF6666"; }
  return `background-color: ${bg}; color: ${color}; display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 12px; font-weight: bold; vertical-align: middle;`;
}

// 修改点 1：控制 generateMessage 返回的 jsLink 仅在网页代码真正更新时非空
function generateMessage(oldStatus, finalStatus, oldHash, hash, mainJsLink, isSubServer = false) {
  let text = "";
  const displayStatusBold = `<span style="${getStatusStyles(finalStatus)}">${getStatusDisplay(finalStatus)}</span>`;
  const oldDisplay = `<span style="${getStatusStyles(oldStatus)}">${getStatusDisplay(oldStatus)}</span>`;
  let entity = isSubServer ? "子服务器" : "服务器";

  // 判定是否属于“网页代码真正更新”
  const isCodeUpdated = (oldHash && hash && hash !== oldHash);

  if (!oldStatus && finalStatus !== "Offline") {
    text = `首次发现${entity}（当前状态：${displayStatusBold}）`;
  } else if (oldStatus && finalStatus !== oldStatus) {
    if (oldStatus === "Mixed") {
      let hashMsg = isCodeUpdated ? "，且检测到代码更新" : "，且代码无更新";
      if (finalStatus === "Offline") text = `${entity}已下线（原状态：${oldDisplay}）`;
      else if (finalStatus === "Error") text = `${entity}出现错误` + hashMsg;
      else if (finalStatus === "Open") text = `${entity}已统一开放` + hashMsg;
      else if (finalStatus === "Closed") text = `${entity}已统一转为封闭状态` + hashMsg;
    } else if (oldStatus === "Offline") {
      let hashMsg = isCodeUpdated ? "，且检测到代码更新" : "，且代码无更新";
      if (finalStatus === "Error") text = `${entity}已上线并出现错误${hashMsg}`;
      else text = (finalStatus === "Open" ? `${entity}已上线并开放` : `${entity}已上线，当前为封闭状态`) + hashMsg;
    } else if (finalStatus === "Offline") {
      text = `${entity}已下线（原状态：${oldDisplay}）`;
    } else {
      let msg = `${entity}状态已从 ${oldDisplay} 变为 ${displayStatusBold}`;
      if (isCodeUpdated) msg += `，且代码已更新`;
      text = msg;
    }
  } else if (oldStatus !== "Offline" && oldStatus !== "Mixed" && finalStatus !== "Offline" && oldHash && hash !== oldHash) {
    text = `网页代码已更新（当前状态：${displayStatusBold}）`;
  }

  // 只有在代码更新(isCodeUpdated为true)且存在JS链接时，才对外提供jsLink
  return { text, jsLink: isCodeUpdated ? mainJsLink : "" };
}

function createCard(url, text, jsLink) {
  let jsHtml = jsLink ? `<div style="font-size: 12px; margin-top: 10px; background: rgba(0,0,0,0.2); padding: 8px; border-radius: 6px; word-break: break-all; color: #BFD5FF;">▶ <b>提取JS：</b> <a href="${jsLink}" style="color: #76FF33; text-decoration: none;">${jsLink}</a></div>` : "";
  return `
  <div style="background-color: #0c2634; border-radius: 12px; padding: 15px; margin-bottom: 12px; border: 1px solid #1a3b4c;">
      <div style="font-size: 14px; margin-bottom: 8px; word-break: break-all;">
          <a href="${url}" style="color: #76FF33; text-decoration: none; font-weight: 500;">${url}</a>
      </div>
      <div style="font-size: 14px; line-height: 1.5; color: #BFD5FF;">${text}</div>
      ${jsHtml}
  </div>`;
}

// 修改点 2：外层嵌套 <a>，让整个服务器卡片行支持点击跳转，而不仅仅是左边的文字
function createServerButton(url, status) {
  const svgs = {
      error: `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" style="display: block; width: 24px; height: 24px;"><circle opacity="0.4" cx="16" cy="16" r="16" fill="#FF6666"/><circle cx="16" cy="16" r="12" fill="#FF6666"/><path fill-rule="evenodd" clip-rule="evenodd" d="M14 22V20H18V22H14ZM14 10L14 18H15.3333C16.8061 18 18 15.3333V10H14Z" fill="#001926"/></svg>`,
      open: `<svg viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg" style="display: block; width: 24px; height: 24px;"><circle cx="15" cy="15" r="8" fill="#76FF33"/><circle cx="15" cy="15" r="11.5" stroke="#76FF33" stroke-opacity="0.25" stroke-width="7"/></svg>`,
      closed: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" style="display: block; width: 24px; height: 24px;"><path fill-rule="evenodd" clip-rule="evenodd" d="M32 20H35.4477C35.8013 20 36.1405 20.1405 36.3905 20.3905L37.6095 21.6095C37.8595 21.8595 38 22.1987 38 22.5523V37.4477C38 37.8013 37.8595 38.1405 37.6095 38.3905L36.3905 39.6095C36.1405 39.8595 35.8013 40 35.4477 40H12.5523C12.1987 40 11.8595 39.8595 11.6095 39.6095L10.3905 38.3905C10.1405 38.1405 10 37.8013 10 37.4477V22.5523C10 22.1987 10.1405 21.8595 10.3905 21.6095L11.6095 20.3905C11.8595 20.1405 12.1987 20 12.5523 20H16V16C16 11.5817 19.5817 8 24 8C28.4183 8 32 11.5817 32 16V20ZM29 20V16C29 13.2386 26.7614 11 24 11C21.2386 11 19 13.2386 19 16V20H29ZM20 30L24 26L28 30L24 34L20 30Z" fill="#BFD5FF"/></svg>`
  };
  
  let icon = svgs.closed;
  let color = "#BFD5FF";
  if (status === 'Open') { icon = svgs.open; color = "#76FF33"; }
  else if (status === 'Error') { icon = svgs.error; color = "#FF6666"; }

  let name = url;
  if (url.includes('public-deploy')) {
      let match = url.match(/deploy(\d+)/);
      if (match) name = `Deploy ${match[1]}`;
      if (url.includes('c1.')) name += ' (c1)';
      if (url.includes('c2.')) name += ' (c2)';
      if (url.includes('deploy-classic')) name = 'Classic';
  } else if (url.includes('test.ru.tankionline')) {
      name = 'Test RU';
  } else if (url.includes('tankiclassic')) {
      name = 'Tanki Classic';
  } else {
      try { name = new URL(url).hostname; } catch(e){}
  }

  return `
  <a href="${url}" target="_blank" style="text-decoration: none; display: block; margin-bottom: 8px;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #0c2634; border-radius: 12px; border: 1px solid #1a3b4c; table-layout: fixed;">
          <tr>
              <td style="padding: 16px 20px; font-size: 16px; font-weight: 500; color: ${color}; word-break: break-all;">
                  ${name}
              </td>
              <td align="right" style="padding: 16px 20px; width: 130px; white-space: nowrap;">
                  <span style="${getStatusStyles(status)} margin-right: 8px; vertical-align: middle;">${getStatusDisplay(status)}</span>
                  <span style="display: inline-block; width: 24px; height: 24px; vertical-align: middle;">${icon}</span>
              </td>
          </tr>
      </table>
  </a>`;
}

// =======================

async function sendEmail(bodyHtml) {
  try {
    await transporter.sendMail({
      from: `"3D坦克测试服监测器" <${process.env.MAIL_USERNAME}>`,
      to: process.env.MAIL_TO,
      subject: "3D坦克测试服务器状态更新",
      html: bodyHtml
    });
    console.log(`[${getTime()}] 邮件已发送。`);
  } catch (error) {
    console.error(`[${getTime()}] 邮件发送失败:`, error);
  }
}

async function main() {
  console.log(`\n[${getTime()}] ========== 监测循环开始 ==========`);

  try { execSync('git pull --rebase --autostash origin main', { stdio: 'ignore' }); }
  catch (e) {
    try { execSync('git rebase --abort', { stdio: 'ignore' }); }
    catch (err) { }
  }

  const baseUrls = [];
  for (let i = 1; i <= 10; i++) {
    baseUrls.push({
      url: `https://public-deploy${i}.test-eu.tankionline.com/browser-public/index.html`,
      type: 'deploy'
    });
  }
  baseUrls.push(
    { url: "https://test.ru.tankionline.com/play/?config-template=https://c{server}.ru.tankionline.com/config.xml&balancer=https://balancer.ru.tankionline.com/balancer&resources=https://s.ru.tankionline.com", type: 'other' },
    { url: "https://public-deploy-classic.test-eu.tankionline.com/browser-public/index.html?config-template=https://c{server}.public-deploy-classic.test-eu.tankionline.com/config.xml&resources=../resources&balancer=https://balancer.public-deploy-classic.test-eu.tankionline.com/balancer", type: 'other' },
    { url: "https://tankiclassic.com/play/", type: 'other' }
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

  let notifications = []; let availableServers = []; let browser = null; let currentResults = {};

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
        console.log(`[${getTime()}] Curl 存活: ${baseUrl} (${curlRes.statusCode})`);
      } else {
        const oldEntry = committedStatusJson[baseUrl] || {};
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
      console.log(`[${getTime()}] Phase 2: 浏览器并发检测 ${browserTasks.length} 个子任务 (最大并发数: ${BROWSER_CONCURRENCY})...`);
      browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--incognito',
          '--disable-web-security',
          '--disable-features=IsolateOrigins,site-per-process'
        ]
      });

      const browserResults = await runWithLimit(browserTasks, BROWSER_CONCURRENCY);

      for (const res of browserResults) {
        let finalStatus = res.status;
        if (finalStatus === 'Offline' && !res.error) finalStatus = 'Closed';

        const currentEntry = currentResults[res.baseUrl];
        if (res.c && currentEntry.configs) {
          currentEntry.configs[res.c] = finalStatus;
          console.log(`[${getTime()}] 浏览器结果: ${res.baseUrl} (c${res.c}) -> ${finalStatus}`);
        } else {
          currentEntry.status = finalStatus;
          console.log(`[${getTime()}] 浏览器结果: ${res.baseUrl} -> ${finalStatus}`);
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

    // Phase 3: 多次确认判定逻辑
    let newlyConfirmed = [];
    let finalStatusJson = { ...committedStatusJson };

    for (const item of baseUrls) {
      const baseUrl = item.url;
      const currentEntry = currentResults[baseUrl];
      const committedEntry = committedStatusJson[baseUrl] || {};

      if (isStateEqual(currentEntry, committedEntry)) {
        if (pendingChanges[baseUrl]) delete pendingChanges[baseUrl];
        finalStatusJson[baseUrl] = committedEntry;
        continue;
      }

      if (!pendingChanges[baseUrl]) {
        console.log(`[${getTime()}] 发现状态异动，等待下一次确认: ${baseUrl}`);
        pendingChanges[baseUrl] = { entry: currentEntry, count: 1, timestamp: Date.now() };
        finalStatusJson[baseUrl] = committedEntry;
      } else {
        if (isStateEqual(pendingChanges[baseUrl].entry, currentEntry)) {
          pendingChanges[baseUrl].count++;
          if (pendingChanges[baseUrl].count >= CONFIRMATION_THRESHOLD) {
            console.log(`[${getTime()}] 状态变化已连续确认 ${CONFIRMATION_THRESHOLD} 次生效: ${baseUrl}`);
            finalStatusJson[baseUrl] = currentEntry;
            newlyConfirmed.push(baseUrl);
            delete pendingChanges[baseUrl];
          } else {
            console.log(`[${getTime()}] 状态确认中 (${pendingChanges[baseUrl].count}/${CONFIRMATION_THRESHOLD}): ${baseUrl}`);
            finalStatusJson[baseUrl] = committedEntry;
          }
        } else {
          console.log(`[${getTime()}] 状态在确认期间再次改变，重置计数器: ${baseUrl}`);
          pendingChanges[baseUrl] = { entry: currentEntry, count: 1, timestamp: Date.now() };
          finalStatusJson[baseUrl] = committedEntry;
        }
      }
    }

    // Phase 4: 产生提示信息与过滤播报
    for (const baseUrl of newlyConfirmed) {
      const currentEntry = finalStatusJson[baseUrl];
      const committedEntry = committedStatusJson[baseUrl] || {};
      const oldHash = committedEntry.hash || null;
      const hash = currentEntry.hash;
      const mainJsLink = currentEntry.mainJsLink;

      if (currentEntry.type === 'deploy') {
        const c1New = currentEntry.configs ? currentEntry.configs['1'] : (currentEntry.status || 'Offline');
        const c2New = currentEntry.configs ? currentEntry.configs['2'] : (currentEntry.status || 'Offline');
        const c1Old = committedEntry.configs ? committedEntry.configs['1'] : (committedEntry.status || null);
        const c2Old = committedEntry.configs ? committedEntry.configs['2'] : (committedEntry.status || null);

        if (c1New === c2New) {
          const statusNew = c1New;
          const statusOld = (c1Old && c1Old === c2Old) ? c1Old : (c1Old ? 'Mixed' : null);
          const msgObj = generateMessage(statusOld, statusNew, oldHash, hash, mainJsLink, false);
          if (msgObj.text) notifications.push(createCard(baseUrl, msgObj.text, msgObj.jsLink));
        } else {
          const serverNum = baseUrl.match(/deploy(\d+)/)[1];

          for (const c of ['1', '2']) {
            const stNew = c === '1' ? c1New : c2New;
            const stOld = c === '1' ? c1Old : c2Old;
            const targetUrl = `${baseUrl}?config-template=https://c${c}.public-deploy${serverNum}.test-eu.tankionline.com/config.xml`;
            const msgObj = generateMessage(stOld, stNew, oldHash, hash, mainJsLink, true);
            if (msgObj.text) notifications.push(createCard(targetUrl, msgObj.text, msgObj.jsLink));
          }
        }
      } else {
        const statusNew = currentEntry.status;
        const statusOld = committedEntry.status || null;
        const msgObj = generateMessage(statusOld, statusNew, oldHash, hash, mainJsLink, false);
        if (msgObj.text) notifications.push(createCard(baseUrl, msgObj.text, msgObj.jsLink));
      }
    }

    const availableSet = [];
    const addedUrls = new Set();
    function addAvailable(url, status) {
        if (!addedUrls.has(url)) {
            availableSet.push({ url, status });
            addedUrls.add(url);
        }
    }

    for (const item of baseUrls) {
      const baseUrl = item.url;
      const entry = finalStatusJson[baseUrl];
      if (!entry) continue;

      if (item.type === 'deploy') {
        const c1 = entry.configs ? entry.configs['1'] : (entry.status || 'Offline');
        const c2 = entry.configs ? entry.configs['2'] : (entry.status || 'Offline');
        if (c1 === 'Offline' && c2 === 'Offline') continue;

        if (c1 === c2) {
          addAvailable(baseUrl, c1);
        } else {
          const serverNum = baseUrl.match(/deploy(\d+)/)[1];
          const p1 = getPriority(c1);
          const p2 = getPriority(c2);

          if (c1 !== 'Offline' && p1 >= p2) {
            const t1 = `${baseUrl}?config-template=https://c1.public-deploy${serverNum}.test-eu.tankionline.com/config.xml`;
            addAvailable(t1, c1);
          }
          if (c2 !== 'Offline' && p2 >= p1) {
            const t2 = `${baseUrl}?config-template=https://c2.public-deploy${serverNum}.test-eu.tankionline.com/config.xml`;
            addAvailable(t2, c2);
          }
        }
      } else {
        if (entry.status && entry.status !== 'Offline') {
          addAvailable(baseUrl, entry.status);
        }
      }
    }
    availableServers = availableSet;

    if (notifications.length > 0) {
      fs.writeFileSync(STATE_FILE, JSON.stringify(finalStatusJson, null, 2));
      const pushed = commitAndPush();

      if (pushed) {
        // --- 组装带全新 UI 与边距优化的 Email ---
        const changeDetails = notifications.join('');
        const availableListHeader = `<div style="font-size: 16px; color: #76FF33; margin-top: 30px; margin-bottom: 15px; border-bottom: 1px dashed rgba(118, 255, 51, 0.3); padding-bottom: 5px;">当前已上线的服务器列表（${availableServers.length}个）</div>`;
        const availableListBody = availableServers.length > 0 
            ? availableServers.map(s => createServerButton(s.url, s.status)).join('') 
            : `<div style="text-align: center; opacity: 0.6; margin-top: 20px; color: #BFD5FF;">当前暂无服务器</div>`;
        
        // 修改点 3：通过嵌套外层 Table 增加 16px 左右侧边距，避免移动设备上两侧无间隙
        const fullBody = `
        <!DOCTYPE html>
        <html lang="zh">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: 'Rubik', 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #001926; color: #BFD5FF; margin: 0; padding: 0; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%;">
            <table width="100%" border="0" cellpadding="0" cellspacing="0" style="background-color: #001926;">
                <tr>
                    <td align="center" style="padding: 24px 16px;">
                        <table width="100%" border="0" cellpadding="0" cellspacing="0" style="max-width: 600px; text-align: left;">
                            <tr>
                                <td>
                                    <div style="text-align: center; padding-bottom: 20px; border-bottom: 1px solid rgba(191, 213, 255, 0.1); margin-bottom: 20px;">
                                        <h1 style="margin: 0; font-size: 24px; color: #fff; font-weight: 500;">3D坦克测试服务器</h1>
                                        <span style="display: inline-block; font-size: 12px; color: #76FF33; background-color: rgba(118, 255, 51, 0.1); padding: 4px 10px; border-radius: 12px; border: 1px solid rgba(118, 255, 51, 0.3); margin-top: 8px;">状态更新通知</span>
                                    </div>
                                    
                                    <div style="font-size: 16px; color: #76FF33; margin-top: 10px; margin-bottom: 15px; border-bottom: 1px dashed rgba(118, 255, 51, 0.3); padding-bottom: 5px;">检测到状态变化</div>
                                    ${changeDetails}
                                    
                                    ${availableListHeader}
                                    ${availableListBody}

                                    <div style="text-align: center; font-size: 12px; color: rgba(191, 213, 255, 0.4); margin-top: 40px; border-top: 1px solid rgba(191, 213, 255, 0.1); padding-top: 20px; line-height: 1.8;">
                                        此邮件由 GitHub Actions 自动监测发送。<br>
                                        生成时间: ${getTime()}
                                    </div>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
            </table>
        </body>
        </html>`;

        await sendEmail(fullBody);
      }
    } else {
      if (newlyConfirmed.length > 0) {
        fs.writeFileSync(STATE_FILE, JSON.stringify(finalStatusJson, null, 2));
        console.log(`[${getTime()}] 有新的内部静默状态更新，已写入本地，已跳过 Git 提交。`);
      } else {
        console.log(`[${getTime()}] 无已确认的状态变化。`);
      }

      const now = Date.now();
      for (const [url, data] of Object.entries(pendingChanges)) {
        if (data.timestamp && (now - data.timestamp > 10 * 60 * 1000)) {
          delete pendingChanges[url];
        } else if (!data.timestamp) {
          pendingChanges[url].timestamp = now;
        }
      }
    }

  } catch (err) {
    console.error(`[${getTime()}] 主循环错误:`, err);
  } finally {
    if (browser) await browser.close().catch(() => { });
  }
}

(async () => {
  console.log(`[${getTime()}] 监测器启动...`);
  while (Date.now() - START_TIME <= MAX_RUNTIME) {
    const loopStartTime = Date.now();
    await main();
    
    const elapsed = Date.now() - loopStartTime;
    const sleepTime = Math.max(0, CHECK_INTERVAL - elapsed);
    
    if (Date.now() - START_TIME + sleepTime > MAX_RUNTIME) {
      break;
    }
    
    await new Promise(resolve => setTimeout(resolve, sleepTime));
  }
  process.exit(0);
})();
