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
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 },
    locale: 'en-US'
  });
  
  try {
    const targetUrl = url.includes('?') 
      ? url + '&skipEntranceAnyKey&locale=en' 
      : url + '?skipEntranceAnyKey&locale=en';
    
    page = await context.newPage();

    let refreshCount = 0;
    const navListener = (frame) => {
      if (frame === page.mainFrame() && frame.url() !== 'about:blank') {
        refreshCount++;
      }
    };
    page.on('framenavigated', navListener);

    const response = await page.goto(targetUrl, { 
      waitUntil: 'commit', // 提前进入页面
      timeout: 45000 
    });
    
    if (!response || response.status() >= 400) {
      return { url, status: 'Offline', httpStatus: response?.status() || 0 };
    }

    // 针对 deploy3 等可能存在的延迟加载：
    // 等待 1.页面主要容器加载 2.网络相对空闲
    try {
      await Promise.race([
        page.waitForSelector('input#invite, .EntranceComponentStyle-title', { state: 'attached', timeout: 10000 }),
        page.waitForLoadState('networkidle', { timeout: 10000 })
      ]);
    } catch (e) {}
    
    await page.waitForTimeout(3000); 
    
    if (refreshCount > 5) {
       return { url, status: 'Error', error: 'Page auto-refreshes repeatedly' };
    }
    
    let hasInvitation = false;

    // 优先检测具体 DOM 元素
    const inviteInput = page.locator('input#invite');
    const inviteTitle = page.locator('.EntranceComponentStyle-title', { hasText: /INVITATION/i });
    
    if ((await inviteInput.count() > 0) || (await inviteTitle.count() > 0)) {
        hasInvitation = true;
    }

    // 兜底检测：如果元素没抓到，全文检索
    if (!hasInvitation) {
        const bodyText = await page.innerText('body').catch(() => '');
        const keywordRegex = /INVITATION|ENTER CODE|邀请码|激活码/i;
        if (keywordRegex.test(bodyText)) {
            hasInvitation = true;
        }
    }
    
    return { 
      url, 
      status: hasInvitation ? 'Closed' : 'Open',
      httpStatus: response.status()
    };
    
  } catch (e) {
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
  if (fs.existsSync(STATE_FILE)) {
    try {
      committedStatusJson = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    } catch (e) {
      console.error("读取状态文件 JSON 失败");
    }
  }

  let finalStatusJson = { ...committedStatusJson };
  let notifications = [];
  let availableServers = [];
  let browser = null;
  let currentResults = {};

  try {
    const curlResults = await Promise.all(urls.map(url => checkCurl(url)));
    const candidatesForBrowser = [];

    for (const res of curlResults) {
      if (res.isAlive) {
        candidatesForBrowser.push({ url: res.url, hash: res.hash });
      } else {
        const oldEntry = committedStatusJson[res.url] || {};
        currentResults[res.url] = { status: "Offline", hash: oldEntry.hash || res.hash };
      }
    }

    if (candidatesForBrowser.length > 0) {
      browser = await chromium.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      
      const { default: pLimit } = await import('p-limit');
      const limit = pLimit(BROWSER_CONCURRENCY);
      
      const browserResults = await Promise.all(candidatesForBrowser.map(c => 
        limit(() => checkBrowserPage(browser, c.url).then(r => ({ ...r, hash: c.hash })))
      ));
      
      for (const res of browserResults) {
        const oldEntry = committedStatusJson[res.url] || {};
        let finalStatus = res.status;
        if (res.status === 'Offline' && !res.error) finalStatus = 'Closed'; 
        
        const hashToSave = (finalStatus === 'Offline' && oldEntry.hash) ? oldEntry.hash : res.hash;
        currentResults[res.url] = { status: finalStatus, hash: hashToSave };
      }
    }

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
          
          let displayStatusBold = "";
          if (currentEntry.status === "Open") displayStatusBold = "<b>开放</b>";
          else if (currentEntry.status === "Closed") displayStatusBold = "<b>封闭</b>";
          else if (currentEntry.status === "Error") displayStatusBold = "<b>错误</b>";

          let message = "";
          const oldStatus = committedEntry.status;
          if (!oldStatus && currentEntry.status !== "Offline") {
            message = `首次发现服务器 (状态: ${displayStatusBold})`;
          } else if (oldStatus && currentEntry.status !== oldStatus) {
            if (oldStatus === "Offline") {
              message = `服务器已上线，当前为 ${displayStatusBold}${currentEntry.hash !== committedEntry.hash ? "，且检测到<b>更新</b>" : ""}`;
            } else if (currentEntry.status === "Offline") {
              message = `服务器已下线 (原状态: ${oldStatus})`;
            } else {
              message = `服务器状态已从 ${oldStatus} 变为 ${displayStatusBold}`;
            }
          } else if (currentEntry.hash !== committedEntry.hash) {
            message = `网页代码已更新（状态: ${displayStatusBold}）`;
          }
          
          if (message) notifications.push(`- <a href="${url}">${url}</a>: ${message}`);
        }
      } else {
        pendingChanges[url] = { entry: currentEntry, count: 1, timestamp: Date.now() };
        finalStatusJson[url] = committedEntry;
      }
    }

    // 汇总上线列表
    for (const [u, entry] of Object.entries(finalStatusJson)) {
      if (entry.status && entry.status !== "Offline") {
        availableServers.push(`<a href="${u}">${u}</a> (状态: ${entry.status})`);
      }
    }

    if (notifications.length > 0) {
      fs.writeFileSync(STATE_FILE, JSON.stringify(finalStatusJson, null, 2));
      if (commitAndPush()) {
        const body = `检测到状态变化：<br>${notifications.join('<br>')}<br><hr><b>当前已上线列表:</b><br>${availableServers.join('<br>')}`;
        await sendEmail(body);
      }
    }

  } catch (err) {
    console.error("主循环异常:", err);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

(async () => {
  console.log(`[${getTime()}] 监测器启动...`);
  await main();
  setInterval(async () => {
    if (Date.now() - START_TIME > MAX_RUNTIME) process.exit(0);
    await main();
  }, CHECK_INTERVAL);
})();
