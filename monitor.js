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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
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
    locale: 'en-US',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  
  try {
    const targetUrl = url.includes('?') ? `${url}&locale=en` : `${url}?locale=en`;
    page = await context.newPage();
    
    let refreshCount = 0;
    page.on('framenavigated', frame => {
      if (frame === page.mainFrame() && frame.url() !== 'about:blank') refreshCount++;
    });

    const response = await page.goto(targetUrl, { waitUntil: 'commit', timeout: 45000 });
    if (!response || response.status() >= 400) return { url, status: 'Offline' };

    // 针对 deploy3 等站点的深度等待
    try {
      await Promise.race([
        // 监控特定的邀请码输入框 ID
        page.waitForSelector('input#invite', { state: 'attached', timeout: 15000 }),
        // 监控通用的渲染完成标志（app 根节点被注入内容）
        page.waitForFunction(() => {
          const bodyText = document.body.innerText;
          return bodyText.length > 200 || /INVITATION|ENTER CODE|邀请码/i.test(bodyText);
        }, { timeout: 15000 })
      ]);
    } catch (e) {}

    // 给异步加载留出最后的渲染缓冲
    await page.waitForTimeout(5000); 

    if (refreshCount > 5) return { url, status: 'Error', error: '自动刷新循环' };

    // 递归检查所有 Frames（包括嵌入的 Iframe）
    let hasInvitation = false;
    const allFrames = page.frames();
    
    for (const frame of allFrames) {
      try {
        const detection = await frame.evaluate(() => {
          const checkText = (txt) => /INVITATION|ENTER CODE|邀请码|激活码/i.test(txt || '');
          // 检查所有输入框
          const inputs = Array.from(document.querySelectorAll('input'));
          const hasInviteInput = inputs.some(i => i.id?.includes('invite') || i.placeholder?.includes('code'));
          // 检查所有按钮和标题
          const bodyText = document.body.innerText;
          return hasInviteInput || checkText(bodyText);
        });
        if (detection) {
          hasInvitation = true;
          break;
        }
      } catch (e) {
        // 忽略跨域 frame 访问限制产生的错误
      }
    }

    return { 
      url, 
      status: hasInvitation ? 'Closed' : 'Open',
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
    execSync('git commit -m "chore: 自动更新服务器状态 [skip ci]"');
    execSync('git pull --rebase origin main');
    execSync('git push origin main');
    return true;
  } catch (e) {
    console.error(`[${getTime()}] Git 推送失败: ${e.message}`);
    return false;
  }
}

async function sendEmail(body) {
  try {
    await transporter.sendMail({
      from: `"3D坦克监测" <${process.env.MAIL_USERNAME}>`,
      to: process.env.MAIL_TO,
      subject: "3D坦克测试服状态更新",
      html: `你好，<br><br>${body}<br><br>此邮件由脚本自动发送。`
    });
    console.log(`[${getTime()}] 邮件已发送。`);
  } catch (e) {
    console.error(`[${getTime()}] 邮件发送失败:`, e.message);
  }
}

async function main() {
  console.log(`[${getTime()}] ========== 监测循环开始 ==========`);
  const urls = Array.from({ length: 10 }, (_, i) => `https://public-deploy${i + 1}.test-eu.tankionline.com/browser-public/index.html`);
  urls.push(
    "https://test.ru.tankionline.com/play/?config-template=https://c{server}.ru.tankionline.com/config.xml&balancer=https://balancer.ru.tankionline.com/balancer&resources=https://s.ru.tankionline.com",
    "https://tankiclassic.com/play/"
  );

  let committedStatus = {};
  if (fs.existsSync(STATE_FILE)) {
    try { 
      committedStatus = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); 
    } catch (e) {
      console.error(`[${getTime()}] 解析状态文件失败`);
    }
  }

  const currentResults = {};

  try {
    console.log(`[${getTime()}] 执行 Phase 1 (Curl)...`);
    const curlResults = await Promise.all(urls.map(u => checkCurl(u)));
    const aliveOnes = [];

    curlResults.forEach(r => {
      if (r.isAlive) {
        aliveOnes.push(r);
      } else {
        currentResults[r.url] = { status: 'Offline', hash: committedStatus[r.url]?.hash || '' };
      }
    });

    if (aliveOnes.length > 0) {
      console.log(`[${getTime()}] 执行 Phase 2 (Browser)...`);
      const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
      
      const tasks = aliveOnes.map(c => async () => {
        const res = await checkBrowserPage(browser, c.url);
        currentResults[c.url] = { ...res, hash: c.hash };
        console.log(`[${getTime()}] - ${c.url} 判定结果: ${res.status}`);
      });

      await runPool(tasks, BROWSER_CONCURRENCY);
      await browser.close();
    }

    let notifications = [];
    let availableServers = [];

    for (const url of urls) {
      const cur = currentResults[url] || { status: 'Offline', hash: '' };
      const old = committedStatus[url] || {};
      
      if (cur.status === old.status && cur.hash === old.hash) {
        delete pendingChanges[url];
      } else {
        if (!old.status && cur.status === 'Offline') {
            committedStatus[url] = cur;
            continue;
        }

        if (pendingChanges[url]?.status === cur.status) {
          pendingChanges[url].count++;
          if (pendingChanges[url].count >= CONFIRMATION_THRESHOLD) {
            let changeMsg = `- <a href="${url}">${url}</a>: 从 ${old.status || '未知'} 变为 <b>${cur.status}</b>`;
            if (cur.hash !== old.hash && old.hash) changeMsg += " (检测到代码更新)";
            notifications.push(changeMsg);
            committedStatus[url] = cur;
            delete pendingChanges[url];
          }
        } else {
          pendingChanges[url] = { status: cur.status, count: 1 };
        }
      }

      if (committedStatus[url]?.status && committedStatus[url].status !== 'Offline') {
        availableServers.push(`${url} (状态: ${committedStatus[url].status})`);
      }
    }

    if (notifications.length > 0) {
      fs.writeFileSync(STATE_FILE, JSON.stringify(committedStatus, null, 2));
      if (commitAndPush()) {
        const body = `状态变更详情：<br>${notifications.join('<br>')}<br><br>当前在线列表：<br>${availableServers.join('<br>')}`;
        await sendEmail(body);
      }
    } else {
      console.log(`[${getTime()}] 本轮无确认的状态变更。`);
      fs.writeFileSync(STATE_FILE, JSON.stringify(committedStatus, null, 2));
    }

  } catch (err) {
    console.error(`[${getTime()}] 主逻辑异常:`, err);
  }
  console.log(`[${getTime()}] ========== 监测循环结束 ==========`);
}

(async () => {
  console.log(`[${getTime()}] 监测服务已启动...`);
  await main();
  setInterval(async () => {
    if (Date.now() - START_TIME > MAX_RUNTIME) process.exit(0);
    await main();
  }, CHECK_INTERVAL);
})();
