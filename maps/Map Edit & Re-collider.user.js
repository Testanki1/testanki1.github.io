// ==UserScript==
// @name         Map Edit & Re-collider
// @namespace    http://tampermonkey.net/
// @version      3.1.1
// @description  Modify map and regenerate collisions to freely customize and explore maps.
// @match        *://*.3dtank.com/play*
// @match        *://*.tankionline.com/play*
// @match        *://*.test-eu.tankionline.com/browser-public/index.html*
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      *
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    const g = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

    // ==========================================
    // Offline Mode (WebSocket hijack core)
    // ==========================================
    g._offlineMode = false;
    g._activeWs = null;
    const OriginalWebSocket = g.WebSocket;
    const listenerMap = new WeakMap();

    g.WebSocket = new Proxy(OriginalWebSocket, {
        construct(target, args) {
            const ws = new target(...args);
            g._activeWs = ws;

            const wsProxy = new Proxy(ws, {
                get(obj, prop) {
                    if (prop === 'readyState') return g._offlineMode ? 1 : obj.readyState;
                    if (prop === 'addEventListener') {
                        return function (type, listener, options) {
                            const wrapped = function (event) {
                                if (g._offlineMode && (type === 'close' || type === 'error')) return;
                                return listener.apply(this, arguments);
                            };
                            listenerMap.set(listener, wrapped);
                            return obj.addEventListener(type, wrapped, options);
                        };
                    }
                    if (prop === 'removeEventListener') {
                        return function (type, listener, options) {
                            const wrapped = listenerMap.get(listener);
                            return obj.removeEventListener(type, wrapped || listener, options);
                        };
                    }
                    if (prop === 'send') {
                        return function (data) {
                            if (g._offlineMode) return;
                            try { return obj.send(data); } catch (e) {}
                        };
                    }
                    if (typeof obj[prop] === 'function') return obj[prop].bind(obj);
                    return obj[prop];
                },
                set(obj, prop, value) {
                    if (prop === 'onclose' || prop === 'onerror') {
                        obj[prop] = function (event) {
                            if (g._offlineMode) return;
                            if (typeof value === 'function') return value.apply(this, arguments);
                        };
                        return true;
                    }
                    obj[prop] = value;
                    return true;
                }
            });

            return wsProxy;
        }
    });

    // ==========================================
    // GM_xmlhttpRequest fetch helper
    // ==========================================
    function gmFetch(url, options = {}) {
        return new Promise((resolve, reject) => {
            const method = (options.method || 'GET').toUpperCase();
            const responseType = options.responseType || 'arraybuffer';
            GM_xmlhttpRequest({
                method,
                url: String(url),
                responseType,
                headers: options.headers || {},
                data: options.body,
                anonymous: !!options.anonymous,
                onload(res) {
                    if (res.status >= 200 && res.status < 300) {
                        resolve({
                            ok: true,
                            status: res.status,
                            statusText: res.statusText || 'OK',
                            url: res.finalUrl || String(url),
                            arrayBuffer: async () => {
                                if (res.response instanceof ArrayBuffer) return res.response;
                                if (res.response && res.response.buffer) {
                                    return res.response.buffer.slice(
                                        res.response.byteOffset,
                                        res.response.byteOffset + res.response.byteLength
                                    );
                                }
                                if (typeof res.responseText === 'string') {
                                    return new TextEncoder().encode(res.responseText).buffer;
                                }
                                return new ArrayBuffer(0);
                            },
                            text: async () => {
                                if (typeof res.responseText === 'string' && res.responseText.length) return res.responseText;
                                if (res.response instanceof ArrayBuffer) {
                                    return new TextDecoder().decode(res.response);
                                }
                                return String(res.response || '');
                            },
                            json: async () => JSON.parse(await (async () => {
                                if (typeof res.responseText === 'string' && res.responseText.length) return res.responseText;
                                if (res.response instanceof ArrayBuffer) return new TextDecoder().decode(res.response);
                                return String(res.response || '');
                            })()),
                            blob: async () => {
                                const buf = res.response instanceof ArrayBuffer
                                    ? res.response
                                    : (typeof res.responseText === 'string'
                                        ? new TextEncoder().encode(res.responseText).buffer
                                        : new ArrayBuffer(0));
                                return new Blob([buf]);
                            }
                        });
                    } else {
                        reject(new Error(`HTTP ${res.status}: ${url}`));
                    }
                },
                onerror() { reject(new Error(`Network error: ${url}`)); },
                ontimeout() { reject(new Error(`Timeout: ${url}`)); }
            });
        });
    }

    // ==========================================
    // Localization (i18n)
    // ==========================================
    const isZh = navigator.language.toLowerCase().startsWith('zh');
    const I18N = {
        toastMobileHint: isZh ? '从右上角向左滑动以配置' : 'Swipe left from the TOP-RIGHT corner to open config',
        toastPcShortcut: isZh ? '请设置快捷键以关闭此面板' : 'Please setup a shortcut to close this panel',
        shortcutDesc: isZh ? '打开/关闭此面板的快捷键：' : 'Shortcut to open/close this panel:',
        setupShortcut: isZh ? '设置快捷键' : 'Setup Shortcut',
        pressKeys: isZh ? '请按键...' : 'Press keys...',
        panelTitle: isZh ? '地图编辑与碰撞' : 'Map Edit & Collision',
        panelSubtitle: isZh ? '在进入地图前设置' : 'Set up before entering',
        btnReset: isZh ? '重置' : 'Reset',
        broadFilterLabel: isZh ? '过滤含有以下关键词的模型碰撞：' : 'Filter model collisions containing these keywords:',
        addKeyword: isZh ? '添加关键词...' : 'Add keyword...',
        exactModelsLabel: isZh ? '设置含碰撞的模型：' : 'Set models with collisions:',
        viewModels: isZh ? '查看模型' : 'View Models',
        editMap: isZh ? '编辑地图' : 'Edit Map',
        loadingModels: isZh
            ? '加载模型中...<br><span style="font-size:10px; opacity:0.7">或者进入地图加载。</span>'
            : 'Loading models...<br><span style="font-size:10px; opacity:0.7">Or join the map to load manually.</span>',
        mapNames: {
            'Highland REMASTER': isZh ? '高原 重制' : 'Highland REMASTER',
            'Cross REMASTER': isZh ? '十字路口 重制' : 'Cross REMASTER',
            'Parma REMASTER': isZh ? '边塞角斗场 重制' : 'Parma REMASTER'
        },
        themeNames: {
            'Summer Day': isZh ? '夏天的白天' : 'Summer Day',
            'Summer Evening': isZh ? '夏天的傍晚' : 'Summer Evening',
            'Autumn': isZh ? '秋天' : 'Autumn',
            'Winter Day': isZh ? '冬天的白天' : 'Winter Day'
        },
        offlineModeTitle: isZh ? '脱机模式' : 'Offline Mode',
        offlineModeDesc: isZh
            ? '切断服务器连接并屏蔽掉线提示，配合碰撞生成以探索地图外区域。'
            : 'Disconnect server and suppress disconnect alerts to explore out-of-bounds.',
        offlineModeBtn: isZh ? '开启脱机' : 'Enable Offline',
        offlineModeActiveBtn: isZh ? '脱机运行中' : 'Offline Active',
        toastOfflineActivated: isZh ? '已脱机！' : 'Offline enabled!',
        toastOfflineAlreadyActive: isZh
            ? '已处于脱机状态。若想恢复请刷新网页。'
            : 'Already offline. Refresh the page to play normally.',
        propEditsLabel: isZh ? '地图编辑' : 'Map Edit',
        propEditsNone: isZh ? '无编辑（使用原版布局）' : 'No edits (original layout)',
        propEditsSummary: isZh
            ? (s) => `删除 ${s.deleted} · 移动/旋转 ${s.moved} · 新增 ${s.added}`
            : (s) => `Del ${s.deleted} · Move/Rot ${s.moved} · Add ${s.added}`,
        clearPropEdits: isZh ? '重置' : 'Reset',
        editorTitle: isZh ? '地图编辑' : 'Map Edit',
        confirmResetTitle: isZh ? '重置地图编辑' : 'Reset Map Edits',
        confirmResetDesc: isZh ? '确定要清除当前主题下的所有地图编辑吗？此操作无法撤销。' : 'Are you sure you want to clear all map edits for this theme? This cannot be undone.',
        btnConfirm: isZh ? '确定重置' : 'Reset',
        btnCancel: isZh ? '取消' : 'Cancel',
        editorLoading: isZh ? '正在加载地图资源…' : 'Loading map resources…',
        editorSaved: isZh ? '物体变更已保存' : 'Object edits saved',
        editorError: isZh ? '编辑器加载失败' : 'Failed to open editor',
        sameMapOnly: isZh ? '同地图限定' : 'Same map only'
    };

    const ICONS = {
        close: `<svg viewBox="0 -960 960 960"><path d="M480-424 284-228q-11 11-28 11t-28-11q-11-11-11-28t11-28l196-196-196-196q-11-11-11-28t11-28q11-11 28-11t28 11l196 196 196-196q11-11 28-11t28 11q11 11 11 28t-11 28L536-480l196 196q11 11 11 28t-11 28q-11 11-28 11t-28-11L480-424Z"/></svg>`,
        travel_explore: `<svg viewBox="0 -960 960 960"><path d="M80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q127 0 226.5 70T851-629q7 17 .5 34T828-572q-16 5-30.5-3T777-599q-24-60-69-106t-108-71v16q0 33-23.5 56.5T520-680h-80v80q0 17-11.5 28.5T400-560h-80v80h40q17 0 28.5 11.5T400-440v80h-40L168-552q-3 18-5.5 36t-2.5 36q0 122 80.5 213T443-162q16 2 26.5 13.5T480-120q0 17-11.5 28.5T441-82Q288-97 184-210T80-480Zm736 352L716-228q-21 12-45 20t-51 8q-75 0-127.5-52.5T440-380q0-75 52.5-127.5T620-560q75 0 127.5 52.5T800-380q0 27-8 51t-20 45l100 100q11 11 11 28t-11 28q-11 11-28 11t-28-11ZM691-309q29-29 29-71t-29-71q-29-29-71-29t-71 29q-29 29-29 71t29 71q29 29 71 29t71-29Z"/></svg>`,
        keyboard: `<svg viewBox="0 -960 960 960"><path d="M160-200q-33 0-56.5-23.5T80-280v-400q0-33 23.5-56.5T160-760h640q33 0 56.5 23.5T880-680v400q0 33-23.5 56.5T800-200H160Zm0-80h640v-400H160v400Zm200-40h240q17 0 28.5-11.5T640-360q0-17-11.5-28.5T600-400H360q-17 0-28.5 11.5T320-360q0 17 11.5 28.5T360-320Zm-200 40v-400 400Zm108.5-291.5Q280-583 280-600t-11.5-28.5Q257-640 240-640t-28.5 11.5Q200-617 200-600t11.5 28.5Q223-560 240-560t28.5-11.5Zm120 0Q400-583 400-600t-11.5-28.5Q377-640 360-640t-28.5 11.5Q320-617 320-600t11.5 28.5Q343-560 360-560t28.5-11.5Zm120 0Q520-583 520-600t-11.5-28.5Q497-640 480-640t-28.5 11.5Q440-617 440-600t11.5 28.5Q463-560 480-560t28.5-11.5Zm120 0Q640-583 640-600t-11.5-28.5Q617-640 600-640t-28.5 11.5Q560-617 560-600t11.5 28.5Q583-560 600-560t28.5-11.5Zm120 0Q760-583 760-600t-11.5-28.5Q737-640 720-640t-28.5 11.5Q680-617 680-600t11.5 28.5Q703-560 720-560t28.5-11.5Zm-480 120Q280-463 280-480t-11.5-28.5Q257-520 240-520t-28.5 11.5Q200-497 200-480t11.5 28.5Q223-440 240-440t28.5-11.5Zm120 0Q400-463 400-480t-11.5-28.5Q377-520 360-520t-28.5 11.5Q320-497 320-480t11.5 28.5Q343-440 360-440t28.5-11.5Zm120 0Q520-463 520-480t-11.5-28.5Q497-520 480-520t-28.5 11.5Q440-497 440-480t11.5 28.5Q463-440 480-440t28.5-11.5Zm120 0Q640-463 640-480t-11.5-28.5Q617-520 600-520t-28.5 11.5Q560-497 560-480t11.5 28.5Q583-440 600-440t28.5-11.5Zm120 0Q760-463 760-480t-11.5-28.5Q737-520 720-520t-28.5 11.5Q680-497 680-480t11.5 28.5Q703-440 720-440t28.5-11.5Z"/></svg>`,
        restart_alt: `<svg viewBox="0 -960 960 960"><path d="M393-132q-103-29-168-113.5T160-440q0-57 19-108.5t54-94.5q11-12 27-12.5t29 12.5q11 11 11.5 27T290-586q-24 31-37 68t-13 78q0 81 47.5 144.5T410-209q13 4 21.5 15t8.5 24q0 20-14 31.5t-33 6.5Zm174 0q-19 5-33-7t-14-32q0-12 8.5-23t21.5-15q75-24 122.5-87T720-440q0-100-70-170t-170-70h-3l16 16q11 11 11 28t-11 28q-11 11-28 11t-28-11l-84-84q-6-6-8.5-13t-2.5-15q0-8 2.5-15t8.5-13l84-84q11-11 28-11t28 11q11 11 11 28t-11 28l-16 16h3q134 0 227 93t93 227q0 109-65 194T567-132Z"/></svg>`,
        visibility: `<svg viewBox="0 -960 960 960"><path d="M607.5-372.5Q660-425 660-500t-52.5-127.5Q555-680 480-680t-127.5 52.5Q300-575 300-500t52.5 127.5Q405-320 480-320t127.5-52.5Zm-204-51Q372-455 372-500t31.5-76.5Q435-608 480-608t76.5 31.5Q588-545 588-500t-31.5 76.5Q525-392 480-392t-76.5-31.5ZM235.5-272Q125-344 61-462q-5-9-7.5-18.5T51-500q0-10 2.5-19.5T61-538q64-118 174.5-190T480-800q134 0 244.5 72T899-538q5 9 7.5 18.5T909-500q0 10-2.5 19.5T899-462q-64 118-174.5 190T480-200q-134 0-244.5-72ZM480-500Zm207.5 160.5Q782-399 832-500q-50-101-144.5-160.5T480-720q-113 0-207.5 59.5T128-500q50 101 144.5 160.5T480-280q113 0 207.5-59.5Z"/></svg>`,
        visibility_off: `<svg viewBox="0 -960 960 960"><path d="M607-627q29 29 42.5 66t9.5 76q0 15-11 25.5T622-449q-15 0-25.5-10.5T586-485q5-26-3-50t-25-41q-17-17-41-26t-51-4q-15 0-25.5-11T430-643q0-15 10.5-25.5T466-679q38-4 75 9.5t66 42.5Zm-127-93q-19 0-37 1.5t-36 5.5q-17 3-30.5-5T358-742q-5-16 3.5-31t24.5-18q23-5 46.5-7t47.5-2q137 0 250.5 72T904-534q4 8 6 16.5t2 17.5q0 9-1.5 17.5T905-466q-18 40-44.5 75T802-327q-12 11-28 9t-26-16q-10-14-8.5-30.5T753-392q24-23 44-50t35-58q-50-101-144.5-160.5T480-720Zm0 520q-134 0-245-72.5T60-463q-5-8-7.5-17.5T50-500q0-10 2-19t7-18q20-40 46.5-76.5T166-680l-83-84q-11-12-10.5-28.5T84-820q11-11 28-11t28 11l680 680q11 11 11.5 27.5T820-84q-11 11-28 11t-28-11L624-222q-35 11-71 16.5t-73 5.5ZM222-624q-29 26-53 57t-41 67q50 101 144.5 160.5T480-280q20 0 39-2.5t39-5.5l-36-38q-11 3-21 4.5t-21 1.5q-75 0-127.5-52.5T300-500q0-11 1.5-21t4.5-21l-84-82Zm319 93Zm-151 75Z"/></svg>`,
        wifi_off: `<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor"><path d="M762-84 414-434q-31 7-59.5 19T301-386q-21 14-46.5 14.5T212-389q-18-18-16.5-43.5T217-473q23-17 48.5-31t52.5-26l-90-90q-26 14-50.5 29.5T130-557q-20 16-45.5 16T42-559q-18-18-17-43t21-41q22-18 45-34.5t49-30.5l-56-56q-11-11-11-28t11-28q11-11 28-11t28 11l679 679q12 12 12 28.5T819-84q-12 11-28.5 11.5T762-84Zm-353-65.5Q380-179 380-220q0-42 29-71t71-29q42 0 71 29t29 71q0 41-29 70.5T480-120q-42 0-71-29.5ZM753-395q-16 16-37.5 15.5T678-396l-10-10-10-10-96-96q-13-13-5-27t28-9q45 11 85.5 31t75.5 47q18 14 20.5 36.5T753-395Zm165-164q-17 18-42 18.5T831-556q-72-59-161.5-91.5T480-680q-21 0-40.5 1.5T400-674q-25 4-45-10.5T331-724q-4-25 11-45t40-24q24-4 48.5-5.5T480-800q125 0 235.5 41.5T914-644q20 17 21 42t-17 43Z"/></svg>`,
        edit: `<svg viewBox="0 -960 960 960"><path d="M200-200h57l391-391-57-57-391 391v57Zm-80 80v-170l528-527q12-11 26.5-17t30.5-6q16 0 31 6t26 18l55 56q12 11 17.5 26t5.5 30q0 16-5.5 30.5T817-647L290-120H120Zm640-584-56-56 56 56Zm-141 85-28-29 57 57-29-28Z"/></svg>`,
        map: `<svg viewBox="0 -960 960 960"><path d="m600-120-240-84-186 72q-20 8-37-4.5T120-170v-560q0-13 7.5-23t20.5-15l212-72 240 84 186-72q20-8 37 4.5t17 33.5v560q0 13-7.5 23T812-192l-212 72Zm-40-98v-468l-160-56v468l160 56Zm80 0 120-40v-474l-120 46v468Zm-440-10 120-46v-468l-120 40v474Zm440-458v468-468Zm-320-56v468-468Z"/></svg>`
    };

    const THEME_ICONS = {
        'Summer Day': 'https://s.eu.tankionline.com/static/images/summer_day.14c71f7e.svg',
        'Summer Evening': 'https://s.eu.tankionline.com/static/images/summer_evening.a77627d2.svg',
        'Autumn': 'https://s.eu.tankionline.com/static/images/autumn_day.ef311d44.svg',
        'Winter Day': 'https://s.eu.tankionline.com/static/images/winter_day.618f73d3.svg'
    };

    function getResourceBase() {
        const search = window.location.search;
        const params = new URLSearchParams(search);
        const resParam = params.get('resources');
        if (resParam) {
            if (resParam.startsWith('http')) return resParam.replace(/\/$/, '');
            if (resParam.startsWith('../')) return window.location.origin + resParam.substring(2).replace(/\/$/, '');
            return window.location.origin + (resParam.startsWith('/') ? '' : '/') + resParam.replace(/\/$/, '');
        }
        const host = window.location.hostname;
        if (host.includes('3dtank.com')) return 'https://res.3dtank.com';
        else if (host.includes('tankionline.com') && !host.includes('test-eu')) return 'https://s.eu.tankionline.com';
        else if (host.includes('test-eu.tankionline.com')) return window.location.origin + '/resources';
        return window.location.origin;
    }

    const MAP_CONFIGS = [
        {
            name: 'Highland REMASTER',
            themes: [
                { name: 'Summer Day', id: 1619091716430, version: 1775742428832 },
                { name: 'Summer Evening', id: 1619091716464, version: 1775742429697 },
                { name: 'Autumn', id: 1619091716433, version: 1775742428825 },
                { name: 'Winter Day', id: 1619091716436, version: 1775742428840 }
            ],
            defaultBlacklist: ['tank', 'birch', 'beech', 'brick_pile', 'bd', 'forest', 'landscape', 'mount', 'chest', 'road', 'conc_pile', 'tree_flat', 'bush_flat', 'plane', 'tetrapod', 'tree', 'grass', 'flower', 'bush', 'river', 'pipe', 'ivy', 'rdecal']
        },
        {
            name: 'Cross REMASTER',
            themes: [
                { name: 'Summer Day', id: 1619091716440, version: 1775742428778 },
                { name: 'Summer Evening', id: 1619091716454, version: 1775742428771 },
                { name: 'Autumn', id: 1619091716443, version: 1775742428768 },
                { name: 'Winter Day', id: 1619091716446, version: 1775742428785 }
            ],
            defaultBlacklist: ['tank', 'crowler', 'beech', 'mount', 'road_', 'soil', 'tree', '_track', 'ivy', 'landscape', 'rdecal', 'bd', 'bush', 'flower', 'grass', 'car1', 'car2', 'car3', 'car4']
        },
        {
            name: 'Parma REMASTER',
            themes: [
                { name: 'Summer Day', id: 1619091716420, version: 1775742428928 },
                { name: 'Autumn', id: 1619091716423, version: 1775742428919 },
                { name: 'Winter Day', id: 1619091716426, version: 1775742428935 }
            ],
            defaultBlacklist: ['mount_', 'landscape', 'flat', 'ivy', 'bd', 'bush', 'flower', 'grass', 'crane', 'grab', 'car', 'track', 'crawler', 'tree', 'moss', 'pipe', 'saw', 'soil', 'garage', 'road', 'block', 'wall_frame', 'claw', 'const', 'chest', 'tetrapod', 'gouge']
        }
    ];

    function generateResourcePath(id, version) {
        if (!id || !version) return null;
        try {
            const highId = Math.floor(id / 4294967296);
            const lowId = id % 4294967296;
            return [
                highId.toString(8),
                ((lowId >>> 16) & 0xFFFF).toString(8),
                ((lowId >>> 8) & 0xFF).toString(8),
                (lowId & 0xFF).toString(8),
                version.toString(8)
            ].join('/');
        } catch (e) {
            console.error('[MapEditor+Recollider] ID/Version parsing error:', e);
            return null;
        }
    }

    MAP_CONFIGS.forEach(map => {
        map.themes.forEach(theme => {
            theme.path = generateResourcePath(theme.id, theme.version);
        });
    });

    const STORAGE_KEY = 'Tanki_MapObject_Recollider_Settings';
    const SUB_SUFFIX_REGEX = /(?:-|_)?sub(?:-|_)?\d+$/i;

    // ==========================================
    // Settings
    // ==========================================
    class SettingsManager {
        constructor() { this.data = this.load(); }
        load() {
            let data = { hintShown: false, shortcut: null, maps: {}, schema: 2 };
            try {
                const stored = localStorage.getItem(STORAGE_KEY);
                if (stored) data = { ...data, ...JSON.parse(stored) };
            } catch (e) {}
            // schema < 2: clear propEdits produced by unsafe rebuilders (3.0–3.1.x)
            if (!data.schema || data.schema < 2) {
                try {
                    if (data.maps) {
                        Object.keys(data.maps).forEach(mn => {
                            Object.keys(data.maps[mn] || {}).forEach(tn => {
                                if (data.maps[mn][tn] && data.maps[mn][tn].propEdits) {
                                    data.maps[mn][tn].propEdits = null;
                                }
                            });
                        });
                    }
                } catch (e) {}
                data.schema = 2;
                try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) {}
                console.log('[MapEditor+Recollider] cleared legacy propEdits (schema migrate)');
            }
            return data;
        }
        save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data)); }
        initThemeIfMissing(mapName, themeName) {
            if (!this.data.maps[mapName]) this.data.maps[mapName] = {};
            if (!this.data.maps[mapName][themeName]) {
                const config = MAP_CONFIGS.find(c => c.name === mapName);
                this.data.maps[mapName][themeName] = {
                    blacklist: config ? [...config.defaultBlacklist] : [],
                    whitelist: [],
                    knownModels: [],
                    // propEdits: null | { props: Prop[] }  — full replacement prop list for same map
                    propEdits: null
                };
            }
            if (!('propEdits' in this.data.maps[mapName][themeName])) {
                this.data.maps[mapName][themeName].propEdits = null;
            }
        }
        getThemeData(mapName, themeName) {
            this.initThemeIfMissing(mapName, themeName);
            return this.data.maps[mapName][themeName];
        }
        setBlacklistWords(mapName, themeName, words) {
            this.initThemeIfMissing(mapName, themeName);
            this.data.maps[mapName][themeName].blacklist = words;
            this.save();
        }
        toggleModelExact(mapName, themeName, modelName, isCurrentlyFiltered) {
            this.initThemeIfMissing(mapName, themeName);
            const theme = this.data.maps[mapName][themeName];
            const baseName = modelName.replace(SUB_SUFFIX_REGEX, '');
            if (isCurrentlyFiltered) {
                theme.blacklist = theme.blacklist.filter(k => k.replace(SUB_SUFFIX_REGEX, '').toLowerCase() !== baseName.toLowerCase());
                if (!theme.whitelist.includes(baseName)) theme.whitelist.push(baseName);
            } else {
                theme.whitelist = theme.whitelist.filter(w => w.replace(SUB_SUFFIX_REGEX, '').toLowerCase() !== baseName.toLowerCase());
                if (!theme.blacklist.includes(baseName)) theme.blacklist.push(baseName);
            }
            this.save();
        }
        addKnownModels(mapName, themeName, modelsSet) {
            this.initThemeIfMissing(mapName, themeName);
            const theme = this.data.maps[mapName][themeName];
            let changed = false;
            const cleanedExisting = new Set();
            theme.knownModels.forEach(m => cleanedExisting.add(m.replace(SUB_SUFFIX_REGEX, '')));
            modelsSet.forEach(m => cleanedExisting.add(m.replace(SUB_SUFFIX_REGEX, '')));
            const newKnownModels = Array.from(cleanedExisting);
            if (newKnownModels.length !== theme.knownModels.length || !newKnownModels.every(m => theme.knownModels.includes(m))) {
                theme.knownModels = newKnownModels;
                changed = true;
            }
            if (changed) this.save();
        }
        resetTheme(mapName, themeName) {
            const config = MAP_CONFIGS.find(c => c.name === mapName);
            if (config) {
                this.initThemeIfMissing(mapName, themeName);
                this.data.maps[mapName][themeName].blacklist = [...config.defaultBlacklist];
                this.data.maps[mapName][themeName].whitelist = [];
                this.save();
            }
        }
        setPropEdits(mapName, themeName, propEdits) {
            this.initThemeIfMissing(mapName, themeName);
            this.data.maps[mapName][themeName].propEdits = propEdits;
            this.save();
            // Invalidate ALL generated map.bin blobs (safest)
            try {
                Object.keys(blobCache).forEach(k => {
                    try { URL.revokeObjectURL(blobCache[k]); } catch (e) {}
                    delete blobCache[k];
                });
            } catch (e) {}
        }
        clearPropEdits(mapName, themeName) {
            this.setPropEdits(mapName, themeName, null);
        }
        togglePropEditsEnabled(mapName, themeName) {
            this.initThemeIfMissing(mapName, themeName);
            const t = this.data.maps[mapName][themeName];
            t.propEditsEnabled = t.propEditsEnabled === false ? true : false;
            this.save();
            try {
                Object.keys(blobCache).forEach(k => {
                    try { URL.revokeObjectURL(blobCache[k]); } catch (e) {}
                    delete blobCache[k];
                });
            } catch (e) {}
        }
        getPropEditsSummary(mapName, themeName) {
            const t = this.getThemeData(mapName, themeName);
            if (!t.propEdits || !t.propEdits.meta) return null;
            return t.propEdits.meta;
        }
        isModelFiltered(mapName, themeName, modelName) {
            const theme = this.getThemeData(mapName, themeName);
            const lowerName = modelName.toLowerCase();
            const baseLowerName = lowerName.replace(SUB_SUFFIX_REGEX, '');
            if (theme.whitelist.some(w => {
                const wBase = w.replace(SUB_SUFFIX_REGEX, '').toLowerCase();
                return wBase === baseLowerName || wBase === lowerName;
            })) return false;
            return theme.blacklist.some(k => {
                const kLower = k.toLowerCase();
                return lowerName.includes(kLower) || baseLowerName.includes(kLower);
            });
        }
    }
    const Settings = new SettingsManager();

    // ==========================================
    // Binary helpers
    // ==========================================
    class BinaryStream {
        constructor(buffer) {
            this.buffer = new Uint8Array(buffer);
            this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
            this.offset = 0;
        }
        readUint8() { const v = this.view.getUint8(this.offset); this.offset += 1; return v; }
        readUint16(le = false) { const v = this.view.getUint16(this.offset, le); this.offset += 2; return v; }
        readUint32(le = false) { const v = this.view.getUint32(this.offset, le); this.offset += 4; return v; }
        readInt32(le = false) { const v = this.view.getInt32(this.offset, le); this.offset += 4; return v; }
        readFloat32(le = false) { const v = this.view.getFloat32(this.offset, le); this.offset += 4; return v; }
        readFloat64(le = false) { const v = this.view.getFloat64(this.offset, le); this.offset += 8; return v; }
        readBytes(len) { const v = this.buffer.subarray(this.offset, this.offset + len); this.offset += len; return v; }
        readStringLength() {
            const flags = this.readUint8();
            if ((flags & 0b10000000) === 0) return flags & 0b01111111;
            if ((flags & 0b01000000) === 0) return ((flags & 0b00111111) << 8) + this.readUint8();
            return ((flags & 0b00111111) << 16) + this.readUint16(false);
        }
        readString() { return new TextDecoder().decode(this.readBytes(this.readStringLength())); }
        readNullTerminatedString() {
            let str = '';
            while (true) {
                const char = this.readUint8();
                if (char === 0) break;
                str += String.fromCharCode(char);
            }
            return str;
        }
        readLengthPrefixedStringA3D() {
            const len = this.readUint32(true);
            const str = new TextDecoder().decode(this.readBytes(len));
            this.offset += (((len + 3) >> 2) << 2) - len;
            return str;
        }
    }

    class BinaryWriter {
        constructor() { this.chunks = []; this.length = 0; }
        writeUint8(v) { this._add(new Uint8Array([v])); }
        writeUint16(v, le = false) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v, le); this._add(b); }
        writeUint32(v, le = false) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, le); this._add(b); }
        writeInt32(v, le = false) { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, v, le); this._add(b); }
        writeFloat32(v, le = false) { const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, v, le); this._add(b); }
        writeFloat64(v, le = false) { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, v, le); this._add(b); }
        writeBytes(b) { this._add(b); }
        writeStringLength(len) {
            if (len <= 0b01111111) { this.writeUint8(len); }
            else if (len <= 0x3FFF) { this.writeUint8(0b10000000 | (len >> 8)); this.writeUint8(len & 0xFF); }
            else { this.writeUint8(0b11000000 | (len >> 16)); this.writeUint16(len & 0xFFFF, false); }
        }
        writeString(str) {
            const bytes = new TextEncoder().encode(str);
            this.writeStringLength(bytes.length);
            this.writeBytes(bytes);
        }
        _add(b) { this.chunks.push(b); this.length += b.length; }
        toUint8Array() {
            const res = new Uint8Array(this.length);
            let offset = 0;
            for (const chunk of this.chunks) { res.set(chunk, offset); offset += chunk.length; }
            return res;
        }
    }

    async function decompressZlib(uint8array) {
        const ds = new DecompressionStream('deflate');
        const writer = ds.writable.getWriter();
        writer.write(uint8array);
        writer.close();
        return new Uint8Array(await new Response(ds.readable).arrayBuffer());
    }

    async function unwrapPacket(stream) {
        const flags = stream.readUint8();
        const compressed = (flags & 0b01000000) > 0;
        let len = 0;
        if ((flags & 0b10000000) === 0) {
            len = stream.readUint8() + ((flags & 0b00111111) << 8);
        } else {
            const b1 = stream.readUint8(), b2 = stream.readUint8(), b3 = stream.readUint8();
            len = (b1 << 16) | (b2 << 8) | b3;
            len += (flags & 0b00111111) * 16777216;
        }
        let data = stream.readBytes(len);
        if (compressed) data = await decompressZlib(data);
        return new BinaryStream(data);
    }

    function packHeader(bits) {
        const extCount = Math.ceil(bits.length / 8) || 1;
        const extBytes = new Uint8Array(extCount);
        extBytes.fill(255);
        for (let i = 0; i < bits.length; i++) {
            if (bits[i]) {
                const byteIdx = Math.floor(i / 8);
                const bitIdx = 7 - (i % 8);
                extBytes[byteIdx] &= ~(1 << bitIdx);
            }
        }
        let flags = 0b10000000;
        let headerPrefix;
        if (extCount <= 63) {
            flags |= extCount;
            headerPrefix = new Uint8Array([flags]);
        } else {
            flags |= 0b01000000;
            flags |= (extCount >> 16) & 0b00111111;
            headerPrefix = new Uint8Array(3);
            headerPrefix[0] = flags;
            new DataView(headerPrefix.buffer).setUint16(1, extCount & 0xFFFF, false);
        }
        return { headerPrefix, extBytes };
    }

    async function wrapPacketUncompressed(payload) {
        const bw = new BinaryWriter();
        const len = payload.length;
        let flags = 0;
        if (len <= 0x3FFF) {
            flags = (len >> 8) & 0b00111111;
            bw.writeUint8(flags);
            bw.writeUint8(len & 0xFF);
        } else {
            flags = 0b10000000 | (Math.floor(len / 16777216) & 0b00111111);
            bw.writeUint8(flags);
            bw.writeUint8((len >> 16) & 0xFF);
            bw.writeUint8((len >> 8) & 0xFF);
            bw.writeUint8(len & 0xFF);
        }
        bw.writeBytes(payload);
        return bw.toUint8Array();
    }

    // ==========================================
    // A3D simple parse (for collision geometry)
    // ==========================================
    function parseA3DSimple(buffer) {
        const stream = new BinaryStream(buffer);
        const sig = new TextDecoder().decode(stream.readBytes(4));
        if (sig !== 'A3D\0') throw new Error('Invalid A3D signature');
        const version = stream.readUint16(true);
        stream.readUint16(true); stream.readUint32(true); stream.readUint32(true);

        const matSig = stream.readUint32(true); const matLen = stream.readUint32(true); const matCount = stream.readUint32(true);
        for (let i = 0; i < matCount; i++) {
            if (version === 3) { stream.readLengthPrefixedStringA3D(); stream.offset += 12; stream.readLengthPrefixedStringA3D(); }
            else { stream.readNullTerminatedString(); stream.offset += 12; stream.readNullTerminatedString(); }
        }
        if (version === 3) stream.offset += (((matLen + 3) >> 2) << 2) - matLen;

        const meshes = [];
        const meshSig = stream.readUint32(true); const meshLen = stream.readUint32(true); const meshCount = stream.readUint32(true);

        for (let i = 0; i < meshCount; i++) {
            let mName = 'Mesh_' + i;
            if (version === 3) { mName = stream.readLengthPrefixedStringA3D(); stream.offset += 28; }
            const vertexCount = stream.readUint32(true);
            const vBufCount = stream.readUint32(true);
            const buffers = {};
            for (let b = 0; b < vBufCount; b++) {
                const bType = stream.readUint32(true);
                const numFloats = { 1: 3, 2: 2, 3: 3, 4: 2, 5: 4, 6: 3 }[bType] || 0;
                const byteLen = vertexCount * numFloats * 4;
                if (bType === 1) {
                    const sliceBuf = stream.buffer.slice(stream.offset, stream.offset + byteLen);
                    buffers.position = new Float32Array(sliceBuf.buffer);
                }
                stream.offset += byteLen;
            }

            const submeshCount = stream.readUint32(true);
            let mainIndices = [];

            for (let s = 0; s < submeshCount; s++) {
                if (version === 2) {
                    const fCount = stream.readUint32(true);
                    const iCount = fCount * 3;
                    const sliceBuf = stream.buffer.slice(stream.offset, stream.offset + iCount * 2);
                    stream.offset += iCount * 2 + fCount * 4; stream.readUint16(true);
                    const indices = new Uint16Array(sliceBuf.buffer, sliceBuf.byteOffset, iCount);
                    for (let k = 0; k < indices.length; k++) mainIndices.push(indices[k]);
                } else {
                    const iCount = stream.readUint32(true);
                    const sliceBuf = stream.buffer.slice(stream.offset, stream.offset + iCount * 2);
                    stream.offset += iCount * 2; stream.offset += (((iCount * 2 + 3) >> 2) << 2) - (iCount * 2);
                    const indices = new Uint16Array(sliceBuf.buffer, sliceBuf.byteOffset, iCount);
                    for (let k = 0; k < indices.length; k++) mainIndices.push(indices[k]);
                }
            }
            meshes.push({ name: mName, position: buffers.position, index: mainIndices });
        }

        const namedMeshes = {};
        if (stream.offset < stream.buffer.byteLength) {
            const transformSig = stream.readUint32(true);
            if (transformSig === 3) {
                const transformLen = stream.readUint32(true); const transformCount = stream.readUint32(true);
                const transforms = [];
                for (let i = 0; i < transformCount; i++) {
                    if (version === 3) stream.readLengthPrefixedStringA3D();
                    const px = stream.readFloat32(true), py = stream.readFloat32(true), pz = stream.readFloat32(true);
                    let rx = stream.readFloat32(true), ry = stream.readFloat32(true), rz = stream.readFloat32(true), rw = stream.readFloat32(true);
                    let sx = stream.readFloat32(true), sy = stream.readFloat32(true), sz = stream.readFloat32(true);
                    if (sx === 0 && sy === 0 && sz === 0) { sx = 1; sy = 1; sz = 1; }
                    if (rx === 0 && ry === 0 && rz === 0 && rw === 0) { rx = 0; ry = 0; rz = 0; rw = 1; }
                    transforms.push({ px, py, pz, rx, ry, rz, rw, sx, sy, sz });
                }
                for (let i = 0; i < transformCount; i++) stream.readInt32(true);
                if (version === 3) stream.offset += (((transformLen + 3) >> 2) << 2) - transformLen;

                const objectSig = stream.readUint32(true);
                if (objectSig === 5) {
                    stream.readUint32(true); const objectCount = stream.readUint32(true);
                    const objects = [];
                    for (let i = 0; i < objectCount; i++) {
                        let name = ''; let mID = 0; let tID = 0;
                        if (version === 2) {
                            name = stream.readNullTerminatedString(); mID = stream.readUint32(true); tID = stream.readUint32(true);
                        } else {
                            name = stream.readLengthPrefixedStringA3D(); mID = stream.readUint32(true); tID = stream.readUint32(true);
                            const mCount = stream.readUint32(true); for (let j = 0; j < mCount; j++) stream.readInt32(true);
                        }
                        objects.push({ name, meshID: mID, transformID: tID });
                    }

                    for (let i = 0; i < objects.length; i++) {
                        const obj = objects[i];
                        if (obj.meshID < meshes.length && obj.transformID < transforms.length) {
                            const tf = transforms[obj.transformID]; const mesh = meshes[obj.meshID];
                            if (!mesh.position) continue;
                            let newPos = new Float32Array(mesh.position.length);
                            for (let v = 0; v < mesh.position.length; v += 3) {
                                let x = mesh.position[v] * tf.sx; let y = mesh.position[v + 1] * tf.sy; let z = mesh.position[v + 2] * tf.sz;
                                let ix = tf.rw * x + tf.ry * z - tf.rz * y; let iy = tf.rw * y + tf.rz * x - tf.rx * z;
                                let iz = tf.rw * z + tf.rx * y - tf.ry * x; let iw = -tf.rx * x - tf.ry * y - tf.rz * z;
                                let dx = ix * tf.rw + iw * -tf.rx + iy * -tf.rz - iz * -tf.ry;
                                let dy = iy * tf.rw + iw * -tf.ry + iz * -tf.rx - ix * -tf.rz;
                                let dz = iz * tf.rw + iw * -tf.rz + ix * -tf.ry - iy * -tf.rx;
                                newPos[v] = dx + tf.px; newPos[v + 1] = dy + tf.py; newPos[v + 2] = dz + tf.pz;
                            }
                            const newMesh = { name: obj.name, position: newPos, index: mesh.index };
                            namedMeshes[obj.name] = newMesh; namedMeshes[`mesh_${i}`] = newMesh;
                            if (i === 0) meshes[0] = newMesh;
                        }
                    }
                }
            }
        }
        return { meshes, namedMeshes };
    }

    // ==========================================
    // map.bin parse (full enough for rewrite)
    // ==========================================
    // =========================================================
    // map.bin parse / rebuild
    // - collision-only: identical to re-collider 2.4.2
    // - move/rotate (same count): in-place float patch
    // - add/delete: rewrite ONLY props body + prop optional bits,
    //   paste RAW materials/atlases/lights bytes (terrain-safe)
    // =========================================================
    async function parseMapBin(buffer) {
        const stream = new BinaryStream(buffer);
        const packet = await unwrapPacket(stream);
        const originalPacketBuffer = new Uint8Array(packet.buffer);

        const fullOriginalBits = [];
        const flags = packet.readUint8();
        if ((flags & 0b10000000) === 0) {
            const intBits = flags << 3;
            for (let i = 7; i >= 3; i--) fullOriginalBits.push((intBits & (1 << i)) === 0);
            const extCount = (flags & 0b01100000) >> 5;
            const extBytes = packet.readBytes(extCount);
            for (let i = 0; i < extBytes.length; i++) for (let b = 7; b >= 0; b--) fullOriginalBits.push((extBytes[i] & (1 << b)) === 0);
        } else {
            let extCount = ((flags & 0b01000000) === 0) ? (flags & 0b00111111) : (((flags & 0b00111111) << 16) + packet.readUint16(false));
            const extBytes = packet.readBytes(extCount);
            for (let i = 0; i < extBytes.length; i++) for (let b = 7; b >= 0; b--) fullOriginalBits.push((extBytes[i] & (1 << b)) === 0);
        }

        // Consumption order == fullOriginalBits order
        // (optMask = reverse(bits); pop end => first bit of fullOriginalBits first)
        const optMask = [...fullOriginalBits].reverse();
        const consumedBits = [];
        const popBit = () => {
            const b = optMask.pop();
            const v = !!b;
            consumedBits.push(v);
            return v;
        };

        const skipObjectArray = (p, cb) => { const len = p.readStringLength(); for (let i = 0; i < len; i++) cb(p); };
        const readV3 = () => [packet.readFloat32(false), packet.readFloat32(false), packet.readFloat32(false)];

        const result = {
            props: [],
            propRecords: [],
            originalPacketBuffer,
            fullOriginalBits,
            consumedBits
        };

        // bit header ends here
        result.bodyStart = packet.offset;
        result.preCollisionStart = packet.offset;

        if (popBit()) {
            const atlasLen = packet.readStringLength();
            for (let i = 0; i < atlasLen; i++) {
                packet.readInt32(false); packet.readString(); packet.readUint32(false);
                const rectLen = packet.readStringLength();
                for (let j = 0; j < rectLen; j++) {
                    packet.readUint32(false); packet.readString(); packet.readString();
                    packet.readUint32(false); packet.readUint32(false); packet.readUint32(false);
                }
                packet.readUint32(false);
            }
        }

        if (popBit()) skipObjectArray(packet, p => { p.readUint32(false); p.readString(); p.offset += 12; p.readString(); });

        result.bitsBeforeCollision = consumedBits.length;
        result.collisionOffsetStart = packet.offset;

        const skipCols = () => {
            let len = packet.readStringLength(); for (let i = 0; i < len; i++) packet.offset += 9 * 4;
            len = packet.readStringLength(); for (let i = 0; i < len; i++) packet.offset += 8 + 6 * 4 + 8;
            len = packet.readStringLength(); for (let i = 0; i < len; i++) packet.offset += 8 + 15 * 4;
        };
        skipCols(); skipCols();
        result.collisionOffsetEnd = packet.offset;

        result.materialSectionStart = packet.offset;
        result.bitsBeforeMaterials = consumedBits.length;
        const matLen = packet.readStringLength();
        for (let i = 0; i < matLen; i++) {
            packet.readUint32(false); packet.readString();
            if (popBit()) skipObjectArray(packet, p => { p.readString(); p.offset += 4; });
            packet.readString();
            const texLen = packet.readStringLength();
            for (let j = 0; j < texLen; j++) {
                if (popBit()) packet.readString();
                packet.readString(); packet.readString();
            }
            if (popBit()) skipObjectArray(packet, p => { p.readString(); p.offset += 8; });
            if (popBit()) skipObjectArray(packet, p => { p.readString(); p.offset += 12; });
            if (popBit()) skipObjectArray(packet, p => { p.readString(); p.offset += 16; });
        }
        result.materialSectionEnd = packet.offset;
        result.bitsAfterMaterials = consumedBits.length;

        result.bitsBeforeLights = consumedBits.length;
        if (popBit()) skipObjectArray(packet, p => { p.offset += 28; });
        result.lightsSectionEnd = packet.offset;
        result.bitsAfterLights = consumedBits.length;

        result.propsOffsetStart = packet.offset;
        result.bitsBeforeProps = consumedBits.length;
        const propLen = packet.readStringLength();
        for (let i = 0; i < propLen; i++) {
            const rec = { index: i };
            let grpName = '';
            if (popBit()) {
                rec.hasGrp = true;
                rec.grpOffset = packet.offset;
                grpName = packet.readString();
            } else rec.hasGrp = false;
            rec.idOffset = packet.offset;
            const id = packet.readUint32(false);
            rec.libOffset = packet.offset;
            const libName = packet.readString();
            rec.matOffset = packet.offset;
            const matID = packet.readUint32(false);
            rec.nameOffset = packet.offset;
            const name = packet.readString();
            rec.posOffset = packet.offset;
            const pos = readV3();
            let rot = [0, 0, 0];
            if (popBit()) {
                rec.hasRot = true;
                rec.rotOffset = packet.offset;
                rot = readV3();
            } else rec.hasRot = false;
            let scale = [1, 1, 1];
            if (popBit()) {
                rec.hasScale = true;
                rec.scaleOffset = packet.offset;
                scale = readV3();
            } else rec.hasScale = false;
            Object.assign(rec, { id, grpName, libName, matID, name, pos, rot, scale });
            result.props.push({ id, grpName, libName, matID, name, pos, rot, scale });
            result.propRecords.push(rec);
        }
        result.propsOffsetEnd = packet.offset;
        result.bitsAfterProps = consumedBits.length;

        // Raw body slices (relative to originalPacketBuffer, after bit header)
        result.rawPreCollision = originalPacketBuffer.slice(result.preCollisionStart, result.collisionOffsetStart);
        result.rawMaterialsAndLights = originalPacketBuffer.slice(result.collisionOffsetEnd, result.propsOffsetStart);
        result.rawMaterials = originalPacketBuffer.slice(result.materialSectionStart, result.materialSectionEnd);
        result.rawLights = originalPacketBuffer.slice(result.materialSectionEnd, result.propsOffsetStart);

        return result;
    }

    function applyPropEdits(originalProps, propEdits) {
        if (!propEdits || !propEdits.props) return originalProps;
        const byKey = new Map();
        const byName = new Map();
        originalProps.forEach(p => {
            byKey.set(`${p.name}||${p.libName || ''}`, p);
            if (!byName.has(p.name)) byName.set(p.name, p);
        });
        const out = [];
        for (const p of propEdits.props) {
            const t = byKey.get(`${p.name}||${p.libName || ''}`) || byName.get(p.name);
            if (!t) {
                console.warn('[MapEditor+Recollider] skip unknown prop', p.name);
                continue;
            }
            out.push({
                id: typeof p.id === 'number' ? p.id : t.id,
                grpName: (p.grpName != null ? p.grpName : (t.grpName || '')),
                libName: t.libName || '',
                matID: typeof p.matID === 'number' ? p.matID : t.matID,
                name: p.name || t.name,
                pos: Array.isArray(p.pos) ? [+p.pos[0], +p.pos[1], +p.pos[2]] : [...t.pos],
                rot: Array.isArray(p.rot) ? [+p.rot[0], +p.rot[1], +p.rot[2]] : [...(t.rot || [0, 0, 0])],
                scale: Array.isArray(p.scale) ? [+p.scale[0], +p.scale[1], +p.scale[2]] : [...(t.scale || [1, 1, 1])]
            });
        }
        return out;
    }

    // Props the editor often fails to re-export, but must stay in map.bin or terrain dies
    function isStructuralProp(p) {
        const n = ((p && p.name) || '').toLowerCase();
        const lib = ((p && p.libName) || '').toLowerCase();
        const s = n + ' ' + lib;
        return /terrain|landscape|mount|bd_in_ring|bd_out_ring|ground|soil|cliff|rock_wall|water|river|lake|beach|sand_plane|plane_/.test(s);
    }

    function propKey(p) {
        return `${p.name}||${p.libName || ''}`;
    }

    /**
     * Merge editor export onto original map props.
     * - Keeps every structural original prop if the editor omitted it (terrain-safe)
     * - Applies move/rotate from matched edits
     * - Deletes only non-structural originals missing from the edit list
     * - Appends unmatched edits as adds (copies of same-map templates)
     */
    function mergeSceneEdits(originalProps, editedProps, options) {
        const opts = options || {};
        // Default SAFE policy:
        // The embedded editor often exports an INCOMPLETE prop list (props without
        // loaded geometry never enter the scene — especially terrain). Treating
        // "missing from export" as "user deleted" wipes terrain and scenery.
        //
        // Therefore we ONLY:
        //   - update transforms for matched originals
        //   - append unmatched edits as adds
        // and we DO NOT delete originals unless explicitly allowed AND the export
        // looks like a complete scene snapshot.
        const edited = editedProps ? editedProps.slice() : [];
        const usedEdit = new Uint8Array(edited.length);
        const nearlyEq = (a, b) => Math.abs(a - b) < 0.05;
        const result = [];
        let matched = 0, keptUnedited = 0, deleted = 0, added = 0, moved = 0;

        const takeEdit = (orig) => {
            let best = -1;
            for (let j = 0; j < edited.length; j++) {
                if (usedEdit[j]) continue;
                const e = edited[j];
                if (e.name !== orig.name || (e.libName || '') !== (orig.libName || '')) continue;
                if (e.matID === orig.matID && nearlyEq(e.pos[0], orig.pos[0]) && nearlyEq(e.pos[1], orig.pos[1]) && nearlyEq(e.pos[2], orig.pos[2])) {
                    best = j; break;
                }
                if (best < 0 && e.matID === orig.matID) best = j;
            }
            if (best < 0) {
                for (let j = 0; j < edited.length; j++) {
                    if (!usedEdit[j] && edited[j].name === orig.name && (edited[j].libName || '') === (orig.libName || '')) {
                        best = j; break;
                    }
                }
            }
            if (best < 0) return null;
            usedEdit[best] = 1;
            return edited[best];
        };

        // Coverage heuristics: does export look complete enough to honor deletes?
        const origStruct = originalProps.filter(isStructuralProp);
        const editStructNames = new Set(edited.filter(isStructuralProp).map(p => p.name));
        const structCoverage = origStruct.length
            ? origStruct.filter(p => editStructNames.has(p.name)).length / origStruct.length
            : 1;
        const countRatio = originalProps.length ? (edited.length / originalProps.length) : 0;
        const hasTerrain = edited.some(p => /terrain/i.test(p.name || ''));
        const origHasTerrain = originalProps.some(p => /terrain/i.test(p.name || ''));
        const exportLooksComplete = true;
        const allowDelete = !!(opts.allowDelete && exportLooksComplete);

        for (const orig of originalProps) {
            const e = takeEdit(orig);
            if (e) {
                matched++;
                const rot = e.rot || orig.rot || [0, 0, 0];
                const scale = e.scale || orig.scale || [1, 1, 1];
                const pos = e.pos || orig.pos;
                const changed = !nearlyEq(pos[0], orig.pos[0]) || !nearlyEq(pos[1], orig.pos[1]) || !nearlyEq(pos[2], orig.pos[2]);
                if (changed) moved++;
                result.push({
                    id: orig.id,
                    grpName: (e.grpName != null && e.grpName !== '') ? e.grpName : (orig.grpName || ''),
                    libName: orig.libName || '',
                    matID: orig.matID,
                    name: orig.name,
                    pos: [pos[0], pos[1], pos[2]],
                    rot: [rot[0], rot[1], rot[2]],
                    scale: [scale[0], scale[1], scale[2]]
                });
            } else if (!allowDelete || isStructuralProp(orig)) {
                // Keep original (incomplete export OR structural OR deletes disabled)
                keptUnedited++;
                result.push({
                    id: orig.id,
                    grpName: orig.grpName || '',
                    libName: orig.libName || '',
                    matID: orig.matID,
                    name: orig.name,
                    pos: [...orig.pos],
                    rot: [...(orig.rot || [0, 0, 0])],
                    scale: [...(orig.scale || [1, 1, 1])]
                });
            } else {
                deleted++;
            }
        }

        let maxId = 0;
        if (originalProps && originalProps.length > 0) {
            for (let i = 0; i < originalProps.length; i++) {
                const pid = originalProps[i].id;
                if (typeof pid === 'number' && !isNaN(pid) && pid > maxId) {
                    maxId = pid;
                }
            }
        }
        let nextId = maxId + 1;
        for (let j = 0; j < edited.length; j++) {
            if (usedEdit[j]) continue;
            const e = edited[j];
            result.push({
                id: nextId++,
                grpName: e.grpName || '',
                libName: e.libName || '',
                matID: e.matID,
                name: e.name,
                pos: [...e.pos],
                rot: [...(e.rot || [0, 0, 0])],
                scale: [...(e.scale || [1, 1, 1])]
            });
            added++;
        }

        const meta = {
            matched, keptUnedited, deleted, added, moved,
            total: result.length,
            original: originalProps.length,
            exportCount: edited.length,
            countRatio: Math.round(countRatio * 1000) / 1000,
            structCoverage: Math.round(structCoverage * 1000) / 1000,
            allowDelete,
            exportLooksComplete
        };
        console.log('[MapEditor+Recollider] mergeSceneEdits', meta);
        return { props: result, meta };
    }

    function writeFloat32BE(u8, offset, value) {
        if (offset < 0 || offset + 4 > u8.byteLength) throw new Error('float write OOB @' + offset);
        new DataView(u8.buffer, u8.byteOffset + offset, 4).setFloat32(0, value, false);
    }
    function readFloat32BE(u8, offset) {
        return new DataView(u8.buffer, u8.byteOffset + offset, 4).getFloat32(0, false);
    }
    function peekStringAt(u8, offset) {
        const stream = new BinaryStream(u8);
        stream.offset = offset;
        const s = stream.readString();
        return { str: s, end: stream.offset };
    }

    function nearly(a, b, eps = 0.05) { return Math.abs(a - b) < eps; }

    function matchEditPermutation(records, edited) {
        if (!records || !edited || records.length !== edited.length) return null;
        const n = records.length;
        const used = new Uint8Array(n);
        const map = new Int32Array(n);
        map.fill(-1);
        for (let i = 0; i < n; i++) {
            const r = records[i];
            for (let j = 0; j < n; j++) {
                if (used[j]) continue;
                const e = edited[j];
                if (e.name !== r.name || (e.libName || '') !== (r.libName || '')) continue;
                if (nearly(e.pos[0], r.pos[0]) && nearly(e.pos[1], r.pos[1]) && nearly(e.pos[2], r.pos[2])) {
                    used[j] = 1; map[i] = j; break;
                }
            }
        }
        for (let i = 0; i < n; i++) {
            if (map[i] >= 0) continue;
            const r = records[i];
            let found = -1;
            for (let j = 0; j < n; j++) {
                if (used[j]) continue;
                const e = edited[j];
                if (e.name === r.name && (e.libName || '') === (r.libName || '')) { found = j; break; }
            }
            if (found < 0) return null;
            used[found] = 1; map[i] = found;
        }
        return map;
    }

    function validatePropRecords(u8, records) {
        for (const rec of records) {
            if (rec.posOffset == null || rec.posOffset + 12 > u8.length) return false;
            try {
                const peeked = peekStringAt(u8, rec.nameOffset);
                if (peeked.str !== rec.name) return false;
                if (peeked.end !== rec.posOffset) return false;
                const px = readFloat32BE(u8, rec.posOffset);
                const py = readFloat32BE(u8, rec.posOffset + 4);
                const pz = readFloat32BE(u8, rec.posOffset + 8);
                if (!nearly(px, rec.pos[0], 0.02) || !nearly(py, rec.pos[1], 0.02) || !nearly(pz, rec.pos[2], 0.02)) return false;
            } catch (e) { return false; }
        }
        return true;
    }

    /**
     * In-place float patch when final props are 1:1 with original records (same order).
     */
    function patchPropsInPlaceOrdered(mapData, orderedProps) {
        const records = mapData.propRecords;
        const u8src = mapData.originalPacketBuffer;
        if (!records || records.length !== orderedProps.length) return null;
        if (!validatePropRecords(u8src, records)) return null;

        const buf = new Uint8Array(u8src);
        for (let i = 0; i < records.length; i++) {
            const rec = records[i];
            const e = orderedProps[i];
            if (e.name !== rec.name || e.matID !== rec.matID) return null;
            writeFloat32BE(buf, rec.posOffset, e.pos[0]);
            writeFloat32BE(buf, rec.posOffset + 4, e.pos[1]);
            writeFloat32BE(buf, rec.posOffset + 8, e.pos[2]);
            if (rec.hasRot && rec.rotOffset != null) {
                const r = e.rot || [0, 0, 0];
                writeFloat32BE(buf, rec.rotOffset, r[0]);
                writeFloat32BE(buf, rec.rotOffset + 4, r[1]);
                writeFloat32BE(buf, rec.rotOffset + 8, r[2]);
            }
            if (rec.hasScale && rec.scaleOffset != null) {
                const s = e.scale || [1, 1, 1];
                writeFloat32BE(buf, rec.scaleOffset, s[0]);
                writeFloat32BE(buf, rec.scaleOffset + 4, s[1]);
                writeFloat32BE(buf, rec.scaleOffset + 8, s[2]);
            }
        }
        return buf;
    }

    function writeCollisionBytes(newShapes3) {
        const bwCol = new BinaryWriter();
        bwCol.writeStringLength(0); bwCol.writeStringLength(0); bwCol.writeStringLength(newShapes3.length);
        for (const d of newShapes3) {
            bwCol.writeFloat64(d.f1, false);
            for (let i = 0; i < 15; i++) bwCol.writeFloat32(d.data[i], false);
        }
        bwCol.writeStringLength(0); bwCol.writeStringLength(0); bwCol.writeStringLength(0);
        return bwCol.toUint8Array();
    }

    function spliceCollisions(packetBuffer, collisionOffsetStart, collisionOffsetEnd, newShapes3) {
        const colBytes = writeCollisionBytes(newShapes3);
        const start = collisionOffsetStart;
        const end = collisionOffsetEnd;
        const finalPayload = new Uint8Array(start + colBytes.length + (packetBuffer.length - end));
        finalPayload.set(packetBuffer.subarray(0, start), 0);
        finalPayload.set(colBytes, start);
        finalPayload.set(packetBuffer.subarray(end), start + colBytes.length);
        return finalPayload;
    }

    /**
     * Write props with optional-bit shapes locked to a template prop when provided.
     * templateByIndex[i] forces grp/rot/scale presence to match original optional layout.
     */
    function writePropsSection(props, templateByIndex) {
        const bits = [];
        const pushBit = (b) => bits.push(!!b);
        const bw = new BinaryWriter();
        bw.writeStringLength(props.length);
        for (let i = 0; i < props.length; i++) {
            const p = props[i];
            const t = templateByIndex && templateByIndex[i] ? templateByIndex[i] : null;

            const wantGrp = t ? !!(t.grpName && t.grpName !== '') : !!(p.grpName && p.grpName !== '');
            if (wantGrp) {
                pushBit(true);
                const g = (p.grpName && p.grpName !== '') ? p.grpName : ((t && t.grpName) || '_');
                bw.writeString(g);
            } else {
                pushBit(false);
            }

            bw.writeUint32(typeof p.id === 'number' ? p.id : i, false);
            bw.writeString(p.libName || '');
            bw.writeUint32(p.matID || 0, false);
            bw.writeString(p.name || '');
            bw.writeFloat32(p.pos[0], false); bw.writeFloat32(p.pos[1], false); bw.writeFloat32(p.pos[2], false);

            const rot = p.rot || [0, 0, 0];
            const tRot = t ? (t.rot || [0, 0, 0]) : null;
            const tHasRot = tRot
                ? (Math.abs(tRot[0]) >= 1e-5 || Math.abs(tRot[1]) >= 1e-5 || Math.abs(tRot[2]) >= 1e-5)
                : null;
            const eHasRot = Math.abs(rot[0]) >= 1e-5 || Math.abs(rot[1]) >= 1e-5 || Math.abs(rot[2]) >= 1e-5;
            const writeRot = (tHasRot === null) ? eHasRot : tHasRot;
            if (writeRot) {
                pushBit(true);
                bw.writeFloat32(rot[0], false); bw.writeFloat32(rot[1], false); bw.writeFloat32(rot[2], false);
            } else pushBit(false);

            const scale = p.scale || [1, 1, 1];
            const tScl = t ? (t.scale || [1, 1, 1]) : null;
            const tHasScl = tScl
                ? (Math.abs(tScl[0] - 1) >= 1e-5 || Math.abs(tScl[1] - 1) >= 1e-5 || Math.abs(tScl[2] - 1) >= 1e-5)
                : null;
            const eHasScl = Math.abs(scale[0] - 1) >= 1e-5 || Math.abs(scale[1] - 1) >= 1e-5 || Math.abs(scale[2] - 1) >= 1e-5;
            const writeScl = (tHasScl === null) ? eHasScl : tHasScl;
            if (writeScl) {
                pushBit(true);
                bw.writeFloat32(scale[0], false); bw.writeFloat32(scale[1], false); bw.writeFloat32(scale[2], false);
            } else pushBit(false);
        }
        return { bytes: bw.toUint8Array(), bits };
    }

    /**
     * Terrain-safe rebuild for count changes:
     * Keep original bit-header PREFIX + RAW bodies for atlas/batch/materials/lights.
     * Only replace collision body + props body + prop optional bits.
     */
    function rebuildPacketPropsAndCollisions(mapData, props, newShapes3, templateByIndex) {
        if (mapData.bitsBeforeProps == null || !mapData.rawPreCollision || !mapData.rawMaterialsAndLights) {
            throw new Error('mapData missing section slices for rebuild');
        }
        const propPart = writePropsSection(props, templateByIndex);
        const colBytes = writeCollisionBytes(newShapes3);

        // First bitsBeforeProps consumed bits are atlas/batch/material/light flags — must stay identical
        const keptFromConsumed = mapData.consumedBits.slice(0, mapData.bitsBeforeProps);
        if (keptFromConsumed.length !== mapData.bitsBeforeProps) {
            throw new Error('kept bit length mismatch');
        }
        const storageBits = keptFromConsumed.concat(propPart.bits);
        // Do NOT invent padding that changes header semantics beyond unused trailing bits;
        // pad only to byte boundary with "absent" (false)
        while (storageBits.length % 8 !== 0) storageBits.push(false);

        const header = packHeader(storageBits);

        const bodyLen = mapData.rawPreCollision.length + colBytes.length + mapData.rawMaterialsAndLights.length + propPart.bytes.length;
        const body = new Uint8Array(bodyLen);
        let o = 0;
        body.set(mapData.rawPreCollision, o); o += mapData.rawPreCollision.length;
        body.set(colBytes, o); o += colBytes.length;
        body.set(mapData.rawMaterialsAndLights, o); o += mapData.rawMaterialsAndLights.length;
        body.set(propPart.bytes, o);

        const packet = new Uint8Array(header.headerPrefix.length + header.extBytes.length + body.length);
        packet.set(header.headerPrefix, 0);
        packet.set(header.extBytes, header.headerPrefix.length);
        packet.set(body, header.headerPrefix.length + header.extBytes.length);

        console.log('[MapEditor+Recollider] FULL props rewrite', {
            keptBits: keptFromConsumed.length,
            propBits: propPart.bits.length,
            props: props.length,
            origProps: mapData.props.length,
            colShapes: newShapes3.length
        });
        return packet;
    }

    function wrapPacketLikeOriginal(finalPayload) {
        const bwFinal = new BinaryWriter();
        const len = finalPayload.length;
        let flags = 0;
        if (len <= 0x3FFF) {
            flags = (len >> 8) & 0b00111111;
            bwFinal.writeUint8(flags);
            bwFinal.writeUint8(len & 0xFF);
        } else {
            flags = 0b10000000 | (Math.floor(len / 16777216) & 0b00111111);
            bwFinal.writeUint8(flags);
            bwFinal.writeUint8((len >> 16) & 0xFF);
            bwFinal.writeUint8((len >> 8) & 0xFF);
            bwFinal.writeUint8(len & 0xFF);
        }
        bwFinal.writeBytes(finalPayload);
        return bwFinal.toUint8Array();
    }

    function pageFetch(url, init) {
        const f = g.originalFetch || g.fetch;
        return f.call(g, url, init);
    }

    async function generateCollisionsForProps(props, mapBaseUrl, mapConfig, themeConfig) {
        let mainA3dData = null;
        try {
            const a3dRes = await pageFetch(`${mapBaseUrl}/models.a3d`);
            if (a3dRes && a3dRes.ok) {
                const a3dBuf = await a3dRes.arrayBuffer();
                mainA3dData = parseA3DSimple(a3dBuf);
            }
        } catch (e) {}

        const extraA3dCache = {};
        const newShapes3 = [];
        const discoveredModels = new Set();

        for (const prop of props) {
            const exactName = prop.name || '';
            if (exactName) discoveredModels.add(exactName);
            if (Settings.isModelFiltered(mapConfig.name, themeConfig.name, exactName)) continue;

            let geometry = null;
            if (mainA3dData) {
                if (mainA3dData.namedMeshes && mainA3dData.namedMeshes[prop.name]) {
                    geometry = mainA3dData.namedMeshes[prop.name];
                } else {
                    const matchedKey = Object.keys(mainA3dData.namedMeshes || {}).find(k => k.toLowerCase() === prop.name.toLowerCase());
                    if (matchedKey) geometry = mainA3dData.namedMeshes[matchedKey];
                }
            }

            if (!geometry && prop.libName) {
                const fileName = prop.name + '.a3d';
                if (!extraA3dCache[fileName]) {
                    try {
                        const res = await pageFetch(`${mapBaseUrl}/${fileName}`);
                        if (res && res.ok) {
                            const buf = await res.arrayBuffer();
                            extraA3dCache[fileName] = parseA3DSimple(buf);
                        } else extraA3dCache[fileName] = 'failed';
                    } catch (e) { extraA3dCache[fileName] = 'failed'; }
                }
                const extraData = extraA3dCache[fileName];
                if (extraData && extraData !== 'failed') {
                    if (extraData.namedMeshes && Object.keys(extraData.namedMeshes).length > 0) {
                        geometry = Object.values(extraData.namedMeshes)[0];
                    } else if (extraData.meshes && extraData.meshes.length > 0) {
                        geometry = extraData.meshes[0];
                    }
                }
            }

            if (!geometry || !geometry.position) continue;

            const px = prop.pos[0], py = prop.pos[1], pz = prop.pos[2];
            const rx = (prop.rot || [0, 0, 0])[0], ry = (prop.rot || [0, 0, 0])[1], rz = (prop.rot || [0, 0, 0])[2];
            const sx = (prop.scale || [1, 1, 1])[0], sy = (prop.scale || [1, 1, 1])[1], sz = (prop.scale || [1, 1, 1])[2];
            const posAttr = geometry.position;
            const index = geometry.index;
            const getVertex = (idx) => [posAttr[idx * 3] * sx, posAttr[idx * 3 + 1] * sy, posAttr[idx * 3 + 2] * sz];

            if (index && index.length > 0) {
                for (let i = 0; i < index.length; i += 3) {
                    const v1 = getVertex(index[i]); const v2 = getVertex(index[i + 1]); const v3 = getVertex(index[i + 2]);
                    newShapes3.push({ f1: 0, data: [px, py, pz, rx, ry, rz, ...v1, ...v2, ...v3] });
                }
            } else {
                for (let i = 0; i < posAttr.length / 3; i += 3) {
                    const v1 = getVertex(i); const v2 = getVertex(i + 1); const v3 = getVertex(i + 2);
                    newShapes3.push({ f1: 0, data: [px, py, pz, rx, ry, rz, ...v1, ...v2, ...v3] });
                }
            }
        }

        Settings.addKnownModels(mapConfig.name, themeConfig.name, discoveredModels);
        if (uiInstance && uiInstance.isOpen) uiInstance.notifyModelsDiscovered(mapConfig.name, themeConfig.name);
        return newShapes3;
    }

    async function integrityCheckWire(wireU8, expectProps) {
        const parsed = await parseMapBin(wireU8);
        if (expectProps && parsed.props.length !== expectProps.length) {
            throw new Error('prop count ' + expectProps.length + ' -> ' + parsed.props.length);
        }
        if (expectProps) {
            for (let i = 0; i < expectProps.length; i++) {
                const a = expectProps[i], b = parsed.props[i];
                if (a.name !== b.name || a.matID !== b.matID || (a.libName || '') !== (b.libName || '')) {
                    throw new Error('prop identity @' + i + ' ' + a.name + '/' + a.matID + ' vs ' + b.name + '/' + b.matID);
                }
            }
        }
        // structural props must survive
        const names = new Set(parsed.props.map(p => p.name));
        for (const p of (expectProps || parsed.props)) {
            if (isStructuralProp(p) && !names.has(p.name)) {
                throw new Error('missing structural prop: ' + p.name);
            }
        }
        return parsed;
    }

    async function generateMapBinLocal(mapUrl, originalBuffer, mapConfig, themeConfig) {
        const mapBaseUrl = mapUrl.substring(0, mapUrl.lastIndexOf('/'));
        const mapData = await parseMapBin(originalBuffer);
        const themeData = Settings.getThemeData(mapConfig.name, themeConfig.name);

        const hasPropEdits = !!(themeData.propEdits && Array.isArray(themeData.propEdits.props) && themeData.propEdits.props.length > 0 && themeData.propEditsEnabled !== false);

        const buildCollisionOnly = async (props, packetBuf) => {
            const newShapes3 = await generateCollisionsForProps(props, mapBaseUrl, mapConfig, themeConfig);
            const finalPayload = spliceCollisions(
                packetBuf,
                mapData.collisionOffsetStart,
                mapData.collisionOffsetEnd,
                newShapes3
            );
            return wrapPacketLikeOriginal(finalPayload);
        };

        // Path A: pure original re-collider
        if (!hasPropEdits) {
            const out = await buildCollisionOnly(mapData.props, mapData.originalPacketBuffer);
            console.log('[MapEditor+Recollider] collision-only (no prop edits)', mapConfig.name, themeConfig.name);
            return out;
        }

        // Normalize editor list onto original templates (same-map only)
        const rawEdited = applyPropEdits(mapData.props, themeData.propEdits);
        if (!rawEdited.length) {
            console.warn('[MapEditor+Recollider] edits empty after filter');
            return await buildCollisionOnly(mapData.props, mapData.originalPacketBuffer);
        }

        // CRITICAL: merge so terrain/landscape omitted by the editor are never dropped
        const allowDelete = !!(themeData.propEdits.meta && themeData.propEdits.meta.allowDelete);
        const { props: finalProps, meta: mergeMeta } = mergeSceneEdits(mapData.props, rawEdited, { allowDelete });

        // Path B: same count + same orderable identity → in-place floats only (best for textures)
        if (finalProps.length === mapData.props.length && mergeMeta.added === 0 && mergeMeta.deleted === 0) {
            try {
                // Align finalProps to original record order
                const perm = matchEditPermutation(mapData.propRecords, finalProps);
                if (!perm) throw new Error('not matchable in original order');
                const ordered = mapData.propRecords.map((rec, i) => {
                    const e = finalProps[perm[i]];
                    return {
                        id: rec.id,
                        grpName: rec.grpName,
                        libName: rec.libName,
                        matID: rec.matID,
                        name: rec.name,
                        pos: e.pos,
                        // preserve optional field presence from original record
                        rot: rec.hasRot ? (e.rot || rec.rot) : rec.rot,
                        scale: rec.hasScale ? (e.scale || rec.scale) : rec.scale
                    };
                });
                const patched = patchPropsInPlaceOrdered(mapData, ordered);
                if (!patched) throw new Error('in-place refused');
                const out = await buildCollisionOnly(ordered, patched);
                await integrityCheckWire(out, ordered);
                console.log('[MapEditor+Recollider] in-place move/rotate OK', mergeMeta);
                return out;
            } catch (e) {
                console.warn('[MapEditor+Recollider] in-place failed, will try props rewrite:', e.message || e);
            }
        }

        // Path C: add/delete (or in-place failed) — rewrite props only, paste RAW materials
        try {
            // Template optional-bits for originals that remain (matched by name+lib greedy)
            const templateByIndex = new Array(finalProps.length).fill(null);
            const usedOrig = new Uint8Array(mapData.props.length);
            for (let i = 0; i < finalProps.length; i++) {
                const p = finalProps[i];
                let best = -1;
                for (let j = 0; j < mapData.props.length; j++) {
                    if (usedOrig[j]) continue;
                    const o = mapData.props[j];
                    if (o.id === p.id && o.name === p.name) {
                        best = j; break;
                    }
                }
                if (best >= 0) {
                    usedOrig[best] = 1;
                    templateByIndex[i] = mapData.props[best];
                }
            }

            const newShapes3 = await generateCollisionsForProps(finalProps, mapBaseUrl, mapConfig, themeConfig);
            const packet = rebuildPacketPropsAndCollisions(mapData, finalProps, newShapes3, templateByIndex);
            const wire = wrapPacketLikeOriginal(packet);

            // Strong integrity: identity + structural props present
            await integrityCheckWire(wire, finalProps);

            // Extra: ensure we still have at least as many structural props as original
            const origStruct = mapData.props.filter(isStructuralProp).length;
            const newStruct = finalProps.filter(isStructuralProp).length;
            if (newStruct < origStruct) {
                throw new Error('structural prop count dropped ' + origStruct + ' -> ' + newStruct);
            }

            console.log('[MapEditor+Recollider] add/delete props rewrite OK', mergeMeta);
            return wire;
        } catch (e) {
            console.error('[MapEditor+Recollider] props rewrite failed, collision-only fallback:', e);
            if (uiInstance) {
                uiInstance.showToast(
                    isZh
                        ? ('物体写入失败，已回退为仅碰撞：' + (e && e.message ? e.message : e))
                        : ('Prop write failed, collision-only: ' + (e && e.message ? e.message : e)),
                    7000
                );
            }
            return await buildCollisionOnly(mapData.props, mapData.originalPacketBuffer);
        }
    }


    // ==========================================
    // Lightmap override (after map edits)
    // Source of truth for file names: each map folder's meta.info
    //   lightmap-0_comp_light.webp
    //   lightmap-0_comp_light-astc.ktx   (KTX1 + ASTC)
    // When propEdits exist, replace both with a solid gray whose
    // level equals the brightest pixel of the original lightmap image.
    // ==========================================
    // Matches:
    //   lightmap-0_comp_light.webp
    //   lightmap-0_comp_light-astc.ktx
    //   lightmap-0_comp_light-dxt.ktx / -bc7.ktx etc. if ever present
    const LIGHTMAP_COMP_LIGHT_RE = /(?:^|\/)(lightmap[-_]?\d*[-_]?comp[-_]?light)(?:-([a-z0-9]+))?(\.webp|\.ktx2?)$/i;
    const whiteLightmapCache = Object.create(null); // key -> { buffer, mime, width, height, gray }

    // ASTC glInternalFormat (KHR) → block WxH
    const ASTC_BLOCK_BY_FMT = {
        0x93B0: [4, 4], 0x93B1: [5, 4], 0x93B2: [5, 5], 0x93B3: [6, 5], 0x93B4: [6, 6],
        0x93B5: [8, 5], 0x93B6: [8, 6], 0x93B7: [8, 8], 0x93B8: [10, 5], 0x93B9: [10, 6],
        0x93BA: [10, 8], 0x93BB: [10, 10], 0x93BC: [12, 10], 0x93BD: [12, 12],
        // sRGB
        0x93D0: [4, 4], 0x93D1: [5, 4], 0x93D2: [5, 5], 0x93D3: [6, 5], 0x93D4: [6, 6],
        0x93D5: [8, 5], 0x93D6: [8, 6], 0x93D7: [8, 8], 0x93D8: [10, 5], 0x93D9: [10, 6],
        0x93DA: [10, 8], 0x93DB: [10, 10], 0x93DC: [12, 10], 0x93DD: [12, 12]
    };

    function findThemeByResourceUrl(url) {
        const u = String(url || '');
        for (const mapConfig of MAP_CONFIGS) {
            for (const themeConfig of mapConfig.themes) {
                if (themeConfig.path && u.includes(themeConfig.path)) {
                    return { mapConfig, themeConfig };
                }
            }
        }
        return null;
    }

    function themeHasMapEdits(mapName, themeName) {
        try {
            const t = Settings.getThemeData(mapName, themeName);
            return !!(t && t.propEdits && Array.isArray(t.propEdits.props) && t.propEdits.props.length > 0 && t.propEditsEnabled !== false);
        } catch (e) {
            return false;
        }
    }

    function parseLightmapCompLightUrl(url) {
        const pure = String(url).split('?')[0].split('#')[0];
        const m = pure.match(LIGHTMAP_COMP_LIGHT_RE);
        if (!m) return null;
        const baseName = m[1];
        const variant = (m[2] || '').toLowerCase();
        const ext = (m[3] || '').toLowerCase();
        const fileName = pure.substring(pure.lastIndexOf('/') + 1);
        const kind = ext === '.webp' ? 'webp' : (variant || 'ktx');
        return { pure, baseName, variant, ext, fileName, kind };
    }

    function pageFetchRaw(url, init) {
        const f = g.originalFetch || g.fetch.bind(g);
        return f(url, init);
    }

    function readWebpDimensions(u8) {
        if (!u8 || u8.length < 30) return null;
        if (u8[0] !== 0x52 || u8[1] !== 0x49 || u8[2] !== 0x46 || u8[3] !== 0x46) return null;
        if (u8[8] !== 0x57 || u8[9] !== 0x45 || u8[10] !== 0x42 || u8[11] !== 0x50) return null;
        let off = 12;
        while (off + 8 <= u8.length) {
            const chunk = String.fromCharCode(u8[off], u8[off + 1], u8[off + 2], u8[off + 3]);
            const size = u8[off + 4] | (u8[off + 5] << 8) | (u8[off + 6] << 16) | (u8[off + 7] << 24);
            const payloadOff = off + 8;
            if (chunk === 'VP8X' && payloadOff + 10 <= u8.length) {
                const w = 1 + (u8[payloadOff + 4] | (u8[payloadOff + 5] << 8) | (u8[payloadOff + 6] << 16));
                const h = 1 + (u8[payloadOff + 7] | (u8[payloadOff + 8] << 8) | (u8[payloadOff + 9] << 16));
                return { width: w, height: h };
            }
            if (chunk === 'VP8 ' && payloadOff + 10 <= u8.length) {
                const w = (u8[payloadOff + 6] | (u8[payloadOff + 7] << 8)) & 0x3fff;
                const h = (u8[payloadOff + 8] | (u8[payloadOff + 9] << 8)) & 0x3fff;
                return { width: w, height: h };
            }
            if (chunk === 'VP8L' && payloadOff + 5 <= u8.length) {
                const b0 = u8[payloadOff + 1], b1 = u8[payloadOff + 2], b2 = u8[payloadOff + 3], b3 = u8[payloadOff + 4];
                const w = 1 + (((b1 & 0x3f) << 8) | b0);
                const h = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
                return { width: w, height: h };
            }
            off = payloadOff + size + (size & 1);
        }
        return null;
    }

    function parseKtx1Header(u8) {
        if (!u8 || u8.length < 64) return null;
        const isKtx1 = (
            u8[0] === 0xAB && u8[1] === 0x4B && u8[2] === 0x54 && u8[3] === 0x58 &&
            u8[4] === 0x20 && u8[5] === 0x31 && u8[6] === 0x31 && u8[7] === 0xBB &&
            u8[8] === 0x0D && u8[9] === 0x0A && u8[10] === 0x1A && u8[11] === 0x0A
        );
        if (!isKtx1) return null;
        const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
        const endian = dv.getUint32(12, true);
        const le = endian === 0x04030201;
        const glType = dv.getUint32(16, le);
        const glTypeSize = dv.getUint32(20, le);
        const glFormat = dv.getUint32(24, le);
        const glInternalFormat = dv.getUint32(28, le);
        const glBaseInternalFormat = dv.getUint32(32, le);
        const pixelWidth = dv.getUint32(36, le);
        const pixelHeight = dv.getUint32(40, le);
        const pixelDepth = dv.getUint32(44, le);
        const numberOfArrayElements = dv.getUint32(48, le);
        const numberOfFaces = dv.getUint32(52, le);
        const numberOfMipmapLevels = dv.getUint32(56, le);
        const bytesOfKeyValueData = dv.getUint32(60, le);
        if (!(pixelWidth > 0 && pixelHeight > 0 && pixelWidth <= 16384 && pixelHeight <= 16384)) return null;
        const headerEnd = 64 + bytesOfKeyValueData;
        if (headerEnd > u8.length) return null;
        const headerAndKv = u8.slice(0, headerEnd);
        return {
            le, glType, glTypeSize, glFormat, glInternalFormat, glBaseInternalFormat,
            pixelWidth, pixelHeight, pixelDepth, numberOfArrayElements, numberOfFaces,
            numberOfMipmapLevels: numberOfMipmapLevels || 1,
            bytesOfKeyValueData, headerAndKv, headerEnd
        };
    }

    function readKtxDimensions(u8) {
        const ktx1 = parseKtx1Header(u8);
        if (ktx1) return { width: ktx1.pixelWidth, height: ktx1.pixelHeight };
        if (u8 && u8.length >= 28 &&
            u8[0] === 0xAB && u8[1] === 0x4B && u8[2] === 0x54 && u8[3] === 0x58 &&
            u8[4] === 0x20 && u8[5] === 0x32 && u8[6] === 0x30 && u8[7] === 0xBB) {
            const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
            const w = dv.getUint32(20, true);
            const h = dv.getUint32(24, true);
            if (w > 0 && h > 0 && w <= 16384 && h <= 16384) return { width: w, height: h };
        }
        return null;
    }

    /**
     * Decode a browser-readable image buffer (webp/png/...) and find the brightest
     * pixel. Fill gray = max(R,G,B) of that brightest pixel (0..255).
     * Returns { gray, width, height }.
     */
    async function sampleBrightestGrayFromImageBuffer(u8, mimeHint) {
        if (!u8 || !u8.length) return null;
        const mime = mimeHint || 'image/webp';
        const blob = new Blob([u8], { type: mime });
        let bitmap = null;
        try {
            if (typeof createImageBitmap === 'function') {
                bitmap = await createImageBitmap(blob);
            }
        } catch (e) {
            bitmap = null;
        }
        // Fallback: HTMLImageElement
        if (!bitmap) {
            const url = URL.createObjectURL(blob);
            try {
                bitmap = await new Promise((resolve, reject) => {
                    const img = new Image();
                    img.onload = () => resolve(img);
                    img.onerror = () => reject(new Error('image decode failed'));
                    img.src = url;
                });
            } finally {
                try { URL.revokeObjectURL(url); } catch (e) {}
            }
        }
        if (!bitmap) return null;

        const width = bitmap.width | 0;
        const height = bitmap.height | 0;
        if (width <= 0 || height <= 0) {
            try { if (bitmap.close) bitmap.close(); } catch (e) {}
            return null;
        }

        let canvas, ctx;
        try {
            if (typeof OffscreenCanvas !== 'undefined') {
                canvas = new OffscreenCanvas(width, height);
                ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: true });
            } else {
                canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: true });
            }
            ctx.drawImage(bitmap, 0, 0);
            const imgData = ctx.getImageData(0, 0, width, height);
            const data = imgData.data;
            let best = 0;
            // max(R,G,B) per pixel; keep global max → that is the "brightest" gray level
            for (let i = 0; i < data.length; i += 4) {
                const r = data[i], gch = data[i + 1], b = data[i + 2];
                const m = r > gch ? (r > b ? r : b) : (gch > b ? gch : b);
                if (m > best) {
                    best = m;
                    if (best >= 255) break;
                }
            }
            return { gray: best & 255, width, height };
        } finally {
            try { if (bitmap.close) bitmap.close(); } catch (e) {}
        }
    }

    /**
     * Prefer sampling from an available webp buffer / sibling webp URL.
     * ASTC is not decoded in-browser; the paired .webp is the same lightmap.
     */
    async function resolveBrightestGray(parsed, originalBuffer) {
        // 1) if request itself is webp and we have bytes
        if (parsed.ext === '.webp' && originalBuffer) {
            const u8 = originalBuffer instanceof Uint8Array ? originalBuffer : new Uint8Array(originalBuffer);
            const s = await sampleBrightestGrayFromImageBuffer(u8, 'image/webp');
            if (s) return s.gray;
        }
        // 2) sibling webp next to ktx / current path
        const webpUrl = parsed.pure
            .replace(/-[a-z0-9]+\.ktx2?$/i, '.webp')
            .replace(/\.ktx2?$/i, '.webp')
            .replace(/\.webp$/i, '.webp');
        try {
            // if we already have webp original from step1 path when ktx: fetch sibling
            if (parsed.ext !== '.webp' || !originalBuffer) {
                const res = await pageFetchRaw(webpUrl);
                if (res && res.ok) {
                    const buf = new Uint8Array(await res.arrayBuffer());
                    const s = await sampleBrightestGrayFromImageBuffer(buf, 'image/webp');
                    if (s) return s.gray;
                }
            }
        } catch (e) {}
        // 3) if original was webp but decode failed earlier, try again
        if (originalBuffer && parsed.ext === '.webp') {
            try {
                const u8 = originalBuffer instanceof Uint8Array ? originalBuffer : new Uint8Array(originalBuffer);
                const s = await sampleBrightestGrayFromImageBuffer(u8, 'image/webp');
                if (s) return s.gray;
            } catch (e) {}
        }
        // fallback: keep previous behavior-ish (pure white)
        return 255;
    }

    /**
     * ASTC LDR void-extent constant-color block (Khronos Data Format Spec).
     * 16 bytes.
     */
    function makeAstcVoidExtentLdrBlock(r, gch, b, a) {
        let bits = 0n;
        const put = (val, start, n) => {
            bits |= (BigInt(val) & ((1n << BigInt(n)) - 1n)) << BigInt(start);
        };
        put(0x1FC, 0, 9);       // void-extent bits 0-8
        put(1, 9, 1);           // LDR
        put(0x3, 10, 2);        // reserved 11
        put(0x1FFF, 12, 13);    // minS
        put(0x1FFF, 25, 13);    // maxS
        put(0x1FFF, 38, 13);    // minT
        put(0x1FFF, 51, 13);    // maxT
        put((r & 255) * 257, 64, 16);
        put((gch & 255) * 257, 80, 16);
        put((b & 255) * 257, 96, 16);
        put((a & 255) * 257, 112, 16);
        const bytes = new Uint8Array(16);
        for (let i = 0; i < 16; i++) {
            bytes[i] = Number((bits >> BigInt(8 * i)) & 0xFFn);
        }
        return bytes;
    }

    function astcLevelImageSize(width, height, blockW, blockH) {
        const bw = Math.max(1, Math.ceil(width / blockW));
        const bh = Math.max(1, Math.ceil(height / blockH));
        return bw * bh * 16;
    }

    function fillAstcSolidImage(byteLength, blockBytes) {
        const out = new Uint8Array(byteLength);
        for (let i = 0; i < byteLength; i += 16) {
            const n = Math.min(16, byteLength - i);
            out.set(blockBytes.subarray(0, n), i);
        }
        return out;
    }

    /**
     * Rebuild a KTX1 ASTC file with identical header/KV/format, solid gray mips.
     */
    function createSolidAstcKtx1FromOriginal(originalU8, gray) {
        const hdr = parseKtx1Header(originalU8);
        if (!hdr) return null;
        const block = ASTC_BLOCK_BY_FMT[hdr.glInternalFormat];
        if (!block) {
            console.warn('[MapEditor+Recollider] unknown ASTC glInternalFormat', '0x' + hdr.glInternalFormat.toString(16));
            return null;
        }
        const [blockW, blockH] = block;
        const levels = Math.max(1, hdr.numberOfMipmapLevels | 0);
        const faces = Math.max(1, hdr.numberOfFaces | 0);
        const g8 = gray & 255;
        const solidBlock = makeAstcVoidExtentLdrBlock(g8, g8, g8, 255);

        const levelSizes = [];
        for (let level = 0; level < levels; level++) {
            const lw = Math.max(1, hdr.pixelWidth >> level);
            const lh = Math.max(1, hdr.pixelHeight >> level);
            levelSizes.push(astcLevelImageSize(lw, lh, blockW, blockH));
        }

        const header = hdr.headerAndKv;
        const parts = [header];
        let offset = header.length;
        for (let level = 0; level < levels; level++) {
            const imgSize = levelSizes[level];
            const sizeBuf = new Uint8Array(4);
            new DataView(sizeBuf.buffer).setUint32(0, imgSize, true);
            parts.push(sizeBuf);
            offset += 4;
            const solidImg = fillAstcSolidImage(imgSize, solidBlock);
            for (let face = 0; face < faces; face++) {
                parts.push(solidImg);
                offset += imgSize;
            }
            const pad = (4 - (offset % 4)) % 4;
            if (pad) {
                parts.push(new Uint8Array(pad));
                offset += pad;
            }
        }
        const out = new Uint8Array(offset);
        let o = 0;
        for (const p of parts) { out.set(p, o); o += p.length; }
        return {
            buffer: out,
            width: hdr.pixelWidth,
            height: hdr.pixelHeight,
            glInternalFormat: hdr.glInternalFormat,
            levels,
            blockW,
            blockH,
            gray: g8
        };
    }

    /** Uncompressed KTX1 RGBA8 solid gray (fallback). */
    function createSolidGrayKtx1Rgba(width, height, levels, gray) {
        const w0 = Math.max(1, width | 0);
        const h0 = Math.max(1, height | 0);
        const mipCount = Math.max(1, levels || 1);
        const g8 = gray & 255;
        let total = 64;
        const sizes = [];
        for (let level = 0; level < mipCount; level++) {
            const w = Math.max(1, w0 >> level);
            const h = Math.max(1, h0 >> level);
            const imgSize = w * h * 4;
            sizes.push(imgSize);
            total += 4 + imgSize;
            total += (4 - (total % 4)) % 4;
        }
        const out = new Uint8Array(total);
        const dv = new DataView(out.buffer);
        out.set([0xAB, 0x4B, 0x54, 0x58, 0x20, 0x31, 0x31, 0xBB, 0x0D, 0x0A, 0x1A, 0x0A], 0);
        dv.setUint32(12, 0x04030201, true);
        dv.setUint32(16, 0x1401, true);
        dv.setUint32(20, 1, true);
        dv.setUint32(24, 0x1908, true);
        dv.setUint32(28, 0x8058, true);
        dv.setUint32(32, 0x1908, true);
        dv.setUint32(36, w0, true);
        dv.setUint32(40, h0, true);
        dv.setUint32(44, 0, true);
        dv.setUint32(48, 0, true);
        dv.setUint32(52, 1, true);
        dv.setUint32(56, mipCount, true);
        dv.setUint32(60, 0, true);
        let off = 64;
        for (let level = 0; level < mipCount; level++) {
            const imgSize = sizes[level];
            dv.setUint32(off, imgSize, true); off += 4;
            // RGBA gray, opaque
            for (let i = 0; i < imgSize; i += 4) {
                out[off + i] = g8;
                out[off + i + 1] = g8;
                out[off + i + 2] = g8;
                out[off + i + 3] = 255;
            }
            off += imgSize;
            const pad = (4 - (off % 4)) % 4;
            off += pad;
        }
        return out;
    }

    async function createSolidGrayWebp(width, height, gray) {
        const w = Math.max(1, width | 0);
        const h = Math.max(1, height | 0);
        const g8 = gray & 255;
        let canvas;
        if (typeof OffscreenCanvas !== 'undefined') {
            canvas = new OffscreenCanvas(w, h);
        } else {
            canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
        }
        const ctx = canvas.getContext('2d', { alpha: false });
        ctx.fillStyle = `rgb(${g8},${g8},${g8})`;
        ctx.fillRect(0, 0, w, h);
        let blob;
        if (canvas.convertToBlob) {
            blob = await canvas.convertToBlob({ type: 'image/webp', quality: 1.0 });
        } else {
            blob = await new Promise((resolve, reject) => {
                canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/webp', 1.0);
            });
        }
        return new Uint8Array(await blob.arrayBuffer());
    }

    async function buildGrayLightmapForRequest(url, parsed, originalBuffer) {
        const u8 = originalBuffer
            ? (originalBuffer instanceof Uint8Array ? originalBuffer : new Uint8Array(originalBuffer))
            : null;

        const gray = await resolveBrightestGray(parsed, u8);

        // --- WEBP path ---
        if (parsed.ext === '.webp') {
            let dims = u8 ? readWebpDimensions(u8) : null;
            if (!dims && u8) {
                // dims may come from decode path
                try {
                    const s = await sampleBrightestGrayFromImageBuffer(u8, 'image/webp');
                    if (s) dims = { width: s.width, height: s.height };
                } catch (e) {}
            }
            if (!dims) {
                try {
                    const ktxUrl = parsed.pure.replace(/\.webp$/i, '-astc.ktx');
                    const res = await pageFetchRaw(ktxUrl);
                    if (res && res.ok) {
                        dims = readKtxDimensions(new Uint8Array(await res.arrayBuffer()));
                    }
                } catch (e) {}
            }
            if (!dims) dims = { width: 1024, height: 1024 };
            const cacheKey = `webp|${dims.width}x${dims.height}|g${gray}`;
            if (whiteLightmapCache[cacheKey]) return whiteLightmapCache[cacheKey];
            const buffer = await createSolidGrayWebp(dims.width, dims.height, gray);
            const entry = { buffer, mime: 'image/webp', width: dims.width, height: dims.height, gray };
            whiteLightmapCache[cacheKey] = entry;
            console.log('[MapEditor+Recollider] gray lightmap webp', dims.width + 'x' + dims.height, 'gray', gray, 'bytes', buffer.length);
            return entry;
        }

        // --- KTX path (typically lightmap-0_comp_light-astc.ktx) ---
        if (u8) {
            const rebuilt = createSolidAstcKtx1FromOriginal(u8, gray);
            if (rebuilt) {
                const cacheKey = `astc|${rebuilt.width}x${rebuilt.height}|0x${rebuilt.glInternalFormat.toString(16)}|L${rebuilt.levels}|g${gray}`;
                if (whiteLightmapCache[cacheKey]) return whiteLightmapCache[cacheKey];
                const entry = {
                    buffer: rebuilt.buffer,
                    mime: 'image/ktx',
                    width: rebuilt.width,
                    height: rebuilt.height,
                    gray
                };
                whiteLightmapCache[cacheKey] = entry;
                console.log('[MapEditor+Recollider] gray lightmap ASTC ktx',
                    rebuilt.width + 'x' + rebuilt.height,
                    'fmt=0x' + rebuilt.glInternalFormat.toString(16),
                    'block', rebuilt.blockW + 'x' + rebuilt.blockH,
                    'mips', rebuilt.levels,
                    'gray', gray,
                    'bytes', rebuilt.buffer.length);
                return entry;
            }
        }

        // Fallback RGBA8 KTX1
        let dims = u8 ? readKtxDimensions(u8) : null;
        if (!dims) {
            try {
                const webpUrl = parsed.pure
                    .replace(/-[a-z0-9]+\.ktx2?$/i, '.webp')
                    .replace(/\.ktx2?$/i, '.webp');
                const res = await pageFetchRaw(webpUrl);
                if (res && res.ok) dims = readWebpDimensions(new Uint8Array(await res.arrayBuffer()));
            } catch (e) {}
        }
        if (!dims) dims = { width: 1024, height: 1024 };
        const cacheKey = `ktx-rgba|${dims.width}x${dims.height}|g${gray}`;
        if (whiteLightmapCache[cacheKey]) return whiteLightmapCache[cacheKey];
        const buffer = createSolidGrayKtx1Rgba(dims.width, dims.height, 1, gray);
        const entry = { buffer, mime: 'image/ktx', width: dims.width, height: dims.height, gray };
        whiteLightmapCache[cacheKey] = entry;
        console.warn('[MapEditor+Recollider] gray lightmap fallback RGBA ktx', dims.width + 'x' + dims.height, 'gray', gray);
        return entry;
    }

    async function maybeReplaceCompLight(url, input, init) {
        const parsed = parseLightmapCompLightUrl(url);
        if (!parsed) return null;
        const themeHit = findThemeByResourceUrl(url);
        if (!themeHit) return null;
        if (!themeHasMapEdits(themeHit.mapConfig.name, themeHit.themeConfig.name)) return null;

        let originalBuffer = null;
        try {
            const res = await pageFetchRaw(input || url, init);
            if (res && res.ok) {
                originalBuffer = new Uint8Array(await res.arrayBuffer());
            }
        } catch (e) {}

        const solid = await buildGrayLightmapForRequest(parsed.pure, parsed, originalBuffer);
        return {
            buffer: solid.buffer,
            mime: solid.mime,
            mapName: themeHit.mapConfig.name,
            themeName: themeHit.themeConfig.name,
            gray: solid.gray
        };
    }

    async function getWhiteLightmapBlobUrl(url) {
        // name kept for XHR path compatibility; content is peak-gray, not pure white
        const parsed = parseLightmapCompLightUrl(url);
        if (!parsed) return null;
        const themeHit = findThemeByResourceUrl(url);
        if (!themeHit || !themeHasMapEdits(themeHit.mapConfig.name, themeHit.themeConfig.name)) return null;

        const cacheKey = 'blob|' + parsed.pure + '|' + themeHit.mapConfig.name + '|' + themeHit.themeConfig.name;
        if (blobCache[cacheKey]) return blobCache[cacheKey];

        let originalBuffer = null;
        try {
            const res = await pageFetchRaw(parsed.pure);
            if (res && res.ok) originalBuffer = new Uint8Array(await res.arrayBuffer());
        } catch (e) {}
        const solid = await buildGrayLightmapForRequest(parsed.pure, parsed, originalBuffer);
        const blob = new Blob([solid.buffer], { type: solid.mime });
        const blobUrl = URL.createObjectURL(blob);
        blobCache[cacheKey] = blobUrl;
        return blobUrl;
    }

    const blobCache = {};
    async function generateMapBinLocalAndGetBlobUrl(url, mapConfig, themeConfig) {
        if (blobCache[url]) return blobCache[url];
        console.log(`[MapEditor+Recollider] Generating map.bin: ${mapConfig.name} - ${themeConfig.name}`);
        try {
            const res = await pageFetch(url);
            const buffer = await res.arrayBuffer();
            const newBuffer = await generateMapBinLocal(url, buffer, mapConfig, themeConfig);
            const blob = new Blob([newBuffer], { type: 'application/octet-stream' });
            const blobUrl = URL.createObjectURL(blob);
            blobCache[url] = blobUrl;
            return blobUrl;
        } catch (e) {
            console.error(`[MapEditor+Recollider] Failed for ${mapConfig.name}`, e);
            return url;
        }
    }

    // ==========================================
    // Map Editor Overlay (same-map only)
    // ==========================================
    // ==========================================
    // Embedded full Map Editor (same UI / camera as editor.html)
    // ==========================================
    const EMBEDDED_EDITOR_HTML = "<!DOCTYPE html>\n<html lang=\"en\">\n   <head>\n      <meta charset=\"UTF-8\" />\n      <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no\" />\n      <title>Tanki Online Map Editor. Remaster (Userscript)</title>\n      <link href=\"https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;700&display=swap\" rel=\"stylesheet\" />\n      <link href=\"https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@24,400,0,0&display=swap\" rel=\"stylesheet\" />\n            <style>\n         :root {\n         --md-sys-color-primary: #76FF33;\n         --md-sys-color-on-primary: rgba(0, 25, 38, 0.9);\n         --md-sys-color-primary-container: rgba(76, 175, 34, 0.8);\n         --md-sys-color-on-primary-container: #FFFFFF;\n         --md-sys-color-secondary-container: rgba(0, 43, 64, 0.6);\n         --md-sys-color-on-secondary-container: #76FF33;\n         --md-sys-color-surface: rgba(0, 25, 38, 0.65);\n         --md-sys-color-on-surface: #E1E8ED;\n         --md-sys-color-surface-variant: rgba(0, 34, 51, 0.65);\n         --md-sys-color-on-surface-variant: #A0C0D0;\n         --md-sys-color-outline: rgba(0, 51, 77, 0.6);\n         --md-sys-color-error: rgba(255, 102, 102, 0.9);\n         --md-sys-color-on-error: #001926;\n         --md-sys-color-tertiary: #BFD5FF;\n         }\n         body, html { \n         margin: 0; \n         padding: 0;\n         width: 100%;\n         height: 100%;\n         position: fixed; \n         top: 0;\n         left: 0;\n         overflow: hidden; \n         font-family: 'Rubik', system-ui, sans-serif; \n         background: #000; \n         color: var(--md-sys-color-on-surface); \n         -webkit-touch-callout: none;\n         -webkit-user-select: none;\n         user-select: none;\n         -webkit-tap-highlight-color: transparent;\n         }\n         button {\n             outline: none;\n         }\n         button:focus, button:focus-visible {\n             outline: none;\n         }\n         #canvas-container { \n         position: absolute;\n         top: 0;\n         left: 0;\n         width: 100%; \n         height: 100%; \n         display: block; \n         touch-action: none;\n         }\n         #menu-toggle {\n         position: fixed;\n         top: 32px;\n         right: 16px;\n         z-index: 200;\n         width: 48px;\n         height: 48px;\n         background: var(--md-sys-color-surface);\n         color: var(--md-sys-color-on-surface);\n         border: 1px solid var(--md-sys-color-outline);\n         border-radius: 50%;\n         cursor: pointer;\n         display: flex; \n         align-items: center;\n         justify-content: center;\n         box-shadow: 0 4px 12px rgba(0,0,0,0.2);\n         transition: all 0.2s;\n         backdrop-filter: blur(10px);\n         -webkit-backdrop-filter: blur(10px);\n         }\n         #menu-toggle:active {\n         background: var(--md-sys-color-primary-container);\n         color: var(--md-sys-color-on-primary-container);\n         transform: scale(0.95);\n         }\n         #ui-container {\n         position: fixed;\n         top: 0;\n         right: 0;\n         width: 280px;\n         max-width: 85%;\n         height: 100%;\n         background: var(--md-sys-color-surface);\n         backdrop-filter: blur(16px);\n         -webkit-backdrop-filter: blur(16px);\n         display: flex;\n         flex-direction: column;\n         border-left: 1px solid var(--md-sys-color-outline);\n         z-index: 100;\n         transition: transform 0.3s cubic-bezier(0.2, 0, 0, 1);\n         transform: translateX(100%);\n         box-shadow: -4px 0 24px rgba(0,0,0,0.4);\n         }\n         .m3-header {\n         padding: 12px 16px;\n         background: transparent;\n         border-bottom: 1px solid var(--md-sys-color-outline);\n         display: flex;\n         flex-direction: column;\n         gap: 8px;\n         }\n         .m3-title {\n         font-size: 18px;\n         font-weight: 500;\n         color: var(--md-sys-color-tertiary);\n         margin: 0;\n         }\n         .m3-subtitle {\n         font-size: 12px;\n         color: var(--md-sys-color-on-surface-variant);\n         line-height: 1.3;\n         display: flex;\n         align-items: center;\n         flex-wrap: wrap;\n         gap: 4px;\n         }\n         .m3-btn {\n         display: flex;\n         align-items: center;\n         justify-content: center;\n         gap: 6px;\n         padding: 12px 0;\n         border: 1px solid transparent;\n         border-radius: 12px;\n         font-weight: 500;\n         font-size: 13px;\n         cursor: pointer;\n         transition: all 0.2s;\n         flex: 1;\n         }\n         .m3-btn span {\n         font-size: 20px;\n         }\n         .m3-btn-primary { background: var(--md-sys-color-primary); color: var(--md-sys-color-on-primary); }\n         .m3-btn-primary:active { opacity: 0.8; transform: scale(0.96); }\n         .m3-btn-secondary { background: var(--md-sys-color-secondary-container); color: var(--md-sys-color-on-secondary-container); border-color: var(--md-sys-color-outline); }\n         .m3-btn-secondary:active { opacity: 0.8; transform: scale(0.96); }\n         .m3-btn-tertiary { background: var(--md-sys-color-surface-variant); color: var(--md-sys-color-on-surface-variant); }\n         .m3-btn-error { background: var(--md-sys-color-error); color: var(--md-sys-color-on-error); }\n         .m3-btn-error:active { opacity: 0.8; transform: scale(0.96); }\n         #lock-height-btn {\n             position: fixed;\n             left: 24px;\n             bottom: 84px;\n             z-index: 150;\n             width: 48px;\n             height: 48px;\n             background: var(--md-sys-color-surface-variant);\n             color: var(--md-sys-color-on-surface);\n             border: 1px solid var(--md-sys-color-outline);\n             border-radius: 50%;\n             cursor: pointer;\n             display: none; /* Hidden by default, shown via JS on desktop */\n             align-items: center;\n             justify-content: center;\n             box-shadow: 0 4px 12px rgba(0,0,0,0.3);\n             transition: all 0.2s;\n             backdrop-filter: blur(10px);\n             -webkit-backdrop-filter: blur(10px);\n         }\n         #lock-height-btn:hover {\n             filter: brightness(1.2);\n         }\n         #lock-height-btn:active {\n             transform: scale(0.95);\n         }\n         #lock-height-btn.active {\n             background: var(--md-sys-color-primary);\n             color: var(--md-sys-color-on-primary);\n             border-color: var(--md-sys-color-primary);\n         }\n         #toggle-collision-btn {\n             position: fixed;\n             left: 24px;\n             bottom: 144px;\n             z-index: 150;\n             width: 48px;\n             height: 48px;\n             background: var(--md-sys-color-surface-variant);\n             color: var(--md-sys-color-on-surface);\n             border: 1px solid var(--md-sys-color-outline);\n             border-radius: 50%;\n             cursor: pointer;\n             display: none;\n             align-items: center;\n             justify-content: center;\n             box-shadow: 0 4px 12px rgba(0,0,0,0.3);\n             transition: all 0.2s;\n             backdrop-filter: blur(10px);\n             -webkit-backdrop-filter: blur(10px);\n         }\n         #toggle-collision-btn:hover {\n             filter: brightness(1.2);\n         }\n         #toggle-collision-btn:active {\n             transform: scale(0.95);\n         }\n         #toggle-collision-btn.active {\n             background: var(--md-sys-color-primary);\n             color: var(--md-sys-color-on-primary);\n             border-color: var(--md-sys-color-primary);\n         }\n         #map-list::-webkit-scrollbar { width: 6px; }\n         #map-list::-webkit-scrollbar-thumb { background: var(--md-sys-color-outline); border-radius: 3px; }\n         .map-item {\n         background: var(--md-sys-color-surface-variant);\n         border: 1px solid var(--md-sys-color-outline);\n         border-radius: 12px;\n         padding: 14px 16px;\n         cursor: pointer;\n         transition: all 0.2s;\n         position: relative;\n         overflow: hidden;\n         display: flex;\n         align-items: center;\n         justify-content: space-between;\n         }\n         .map-item:hover { filter: brightness(1.2); border-color: var(--md-sys-color-tertiary); }\n         .map-item.loading { pointer-events: none; opacity: 0.9; border-color: var(--md-sys-color-primary); background: rgba(0, 43, 64, 0.8); }\n         .map-item-title { font-size: 13px; font-weight: 500; color: var(--md-sys-color-on-surface); word-break: break-all; }\n         .circular-progress {\n         width: 32px;\n         height: 32px;\n         border-radius: 50%;\n         background: conic-gradient(var(--md-sys-color-primary) 0%, transparent 0%);\n         display: flex;\n         align-items: center;\n         justify-content: center;\n         position: relative;\n         box-shadow: 0 0 8px rgba(0,0,0,0.5);\n         }\n         .circular-progress::after {\n         content: '';\n         position: absolute;\n         width: 26px;\n         height: 26px;\n         border-radius: 50%;\n         background: var(--md-sys-color-surface-variant);\n         }\n         .circular-progress-text {\n         position: relative;\n         z-index: 1;\n         font-size: 10px;\n         font-weight: 700;\n         color: var(--md-sys-color-on-surface);\n         }\n         #prefab-list {\n         flex: 1;\n         overflow-y: auto;\n         padding: 12px;\n         padding-bottom: 80px;\n         display: flex;\n         flex-wrap: wrap;\n         gap: 12px;\n         align-content: flex-start;\n         }\n         #prefab-list::-webkit-scrollbar { width: 6px; }\n         #prefab-list::-webkit-scrollbar-thumb { background: var(--md-sys-color-outline); border-radius: 3px; }\n         .prefab-item {\n         width: calc(50% - 6px);\n         aspect-ratio: 1;\n         background: var(--md-sys-color-surface-variant);\n         border-radius: 16px;\n         display: flex;\n         flex-direction: column;\n         align-items: center;\n         justify-content: flex-end;\n         padding-bottom: 12px;\n         cursor: pointer;\n         position: relative;\n         overflow: hidden;\n         border: 1px solid var(--md-sys-color-outline);\n         transition: all 0.2s;\n         box-sizing: border-box;\n         }\n         .prefab-item:hover { filter: brightness(1.2); border-color: var(--md-sys-color-tertiary); }\n         .prefab-item.active {\n         border-color: var(--md-sys-color-primary);\n         background: var(--md-sys-color-primary-container);\n         }\n         .prefab-item span {\n         font-size: 12px;\n         text-align: center;\n         z-index: 1;\n         pointer-events: none;\n         font-weight: 500;\n         color: var(--md-sys-color-on-surface);\n         text-shadow: 0 1px 4px rgba(0,0,0,0.8);\n         width: 90%;\n         white-space: nowrap;\n         overflow: hidden;\n         text-overflow: ellipsis;\n         }\n         #toast-msg {\n         position: fixed;\n         bottom: 24px;\n         left: 50%;\n         transform: translateX(-50%);\n         background: var(--md-sys-color-surface-variant);\n         color: var(--md-sys-color-on-surface);\n         padding: 12px 24px;\n         border-radius: 12px;\n         font-size: 14px;\n         font-weight: 500;\n         pointer-events: none;\n         opacity: 0;\n         transition: opacity 0.3s;\n         z-index: 200;\n         box-shadow: 0 4px 16px rgba(0,0,0,0.3);\n         border: 1px solid var(--md-sys-color-outline);\n         backdrop-filter: blur(10px);\n         -webkit-backdrop-filter: blur(10px);\n         display: flex;\n         align-items: center;\n         gap: 8px;\n         }\n         .grid-floating-panel {\n         position: fixed;\n         left: 24px;\n         bottom: 24px;\n         z-index: 200;\n         background: var(--md-sys-color-surface);\n         padding: 8px 12px;\n         border-radius: 16px;\n         display: none;\n         align-items: center;\n         gap: 12px;\n         box-shadow: 0 8px 24px rgba(0,0,0,0.3);\n         border: 1px solid var(--md-sys-color-outline);\n         backdrop-filter: blur(16px);\n         -webkit-backdrop-filter: blur(16px);\n         }\n         #context-menu {\n         position: fixed;\n         z-index: 1000;\n         background: var(--md-sys-color-surface);\n         border: 1px solid var(--md-sys-color-outline);\n         border-radius: 16px;\n         padding: 8px 0 0 0;\n         box-shadow: 0 12px 32px rgba(0,0,0,0.5);\n         display: none;\n         flex-direction: column;\n         gap: 4px;\n         min-width: 140px;\n         backdrop-filter: blur(16px);\n         -webkit-backdrop-filter: blur(16px);\n         }\n         #context-menu .cm-title {\n         font-size: 13px;\n         font-weight: 700;\n         color: var(--md-sys-color-tertiary);\n         padding: 6px 12px;\n         border-bottom: 1px solid var(--md-sys-color-outline);\n         margin-bottom: 4px;\n         text-align: center;\n         white-space: nowrap;\n         overflow: hidden;\n         text-overflow: ellipsis;\n         }\n         #context-menu button {\n         background: var(--md-sys-color-surface-variant);\n         color: var(--md-sys-color-on-surface);\n         border: 1px solid var(--md-sys-color-outline);\n         padding: 10px;\n         border-radius: 12px;\n         text-align: center;\n         cursor: pointer;\n         font-size: 14px;\n         font-weight: 500;\n         display: flex;\n         align-items: center;\n         justify-content: center;\n         transition: all 0.2s;\n         }\n         #context-menu button:hover {\n         background: var(--md-sys-color-primary-container);\n         color: var(--md-sys-color-on-primary-container);\n         }\n         #context-menu button.cm-danger {\n         color: var(--md-sys-color-error);\n         }\n         #context-menu button.cm-danger:hover {\n         background: var(--md-sys-color-error);\n         color: var(--md-sys-color-on-error);\n         }\n         #m3-dialog-overlay {\n         position: fixed;\n         top: 0;\n         left: 0;\n         width: 100%;\n         height: 100%;\n         background: rgba(0, 0, 0, 0.6);\n         backdrop-filter: blur(8px);\n         -webkit-backdrop-filter: blur(8px);\n         z-index: 2000;\n         display: none;\n         justify-content: center;\n         align-items: center;\n         opacity: 0;\n         transition: opacity 0.3s ease;\n         }\n         #m3-dialog {\n         background: var(--md-sys-color-surface);\n         border: 1px solid var(--md-sys-color-outline);\n         border-radius: 28px;\n         padding: 24px;\n         width: 90%;\n         max-width: 320px;\n         box-shadow: 0 24px 72px rgba(0,0,0,0.6);\n         display: flex;\n         flex-direction: column;\n         gap: 16px;\n         transform: scale(0.9) translateY(20px);\n         transition: transform 0.3s cubic-bezier(0.2, 0, 0, 1);\n         }\n         .m3-dialog-title {\n         font-size: 24px;\n         font-weight: 500;\n         color: var(--md-sys-color-on-surface);\n         margin: 0;\n         display: flex;\n         align-items: center;\n         gap: 12px;\n         }\n         .m3-dialog-text {\n         font-size: 14px;\n         line-height: 1.5;\n         color: var(--md-sys-color-on-surface-variant);\n         }\n         .m3-btn-text {\n         background: transparent;\n         color: var(--md-sys-color-primary);\n         padding: 10px 16px;\n         border-radius: 20px;\n         font-weight: 500;\n         font-size: 14px;\n         cursor: pointer;\n         border: none;\n         transition: all 0.2s;\n         }\n         .m3-btn-text:hover { background: var(--md-sys-color-surface-variant); }\n         .m3-btn-text:active { transform: scale(0.96); }\n         .m3-btn-text.danger { color: var(--md-sys-color-error); }\n         .prefab-item-error {\n         width: 100%;\n         background: rgba(255, 102, 102, 0.1);\n         border: 1px solid var(--md-sys-color-error);\n         border-radius: 12px;\n         padding: 10px 12px;\n         display: flex;\n         align-items: center;\n         gap: 12px;\n         box-sizing: border-box;\n         margin-bottom: 4px;\n         }\n         .prefab-item-error .icon {\n         color: var(--md-sys-color-error);\n         font-size: 24px;\n         }\n         .prefab-item-error .text-container {\n         display: flex;\n         flex-direction: column;\n         overflow: hidden;\n         width: 100%;\n         }\n         .prefab-item-error .err-title {\n         font-size: 13px;\n         font-weight: 700;\n         color: var(--md-sys-color-error);\n         white-space: nowrap;\n         overflow: hidden;\n         text-overflow: ellipsis;\n         }\n         .prefab-item-error .err-desc {\n         font-size: 11px;\n         color: var(--md-sys-color-on-surface-variant);\n         white-space: nowrap;\n         overflow: hidden;\n         text-overflow: ellipsis;\n         margin-top: 2px;\n         }\n      </style>\n      <script type=\"importmap\">\n         {\n             \"imports\": {\n                 \"three\": \"https://cdn.jsdelivr.net/npm/three/build/three.module.js\",\n                 \"three/addons/\": \"https://cdn.jsdelivr.net/npm/three/examples/jsm/\"\n             }\n         }\n      </script>\n   </head>\n   <body>\n      <button id=\"menu-toggle\" title=\"Menu\">\n      <span class=\"material-symbols-rounded\">menu</span>\n      </button>\n      <div id=\"ui-container\">\n         <div class=\"m3-header\" style=\"border-bottom: 1px solid var(--md-sys-color-outline); padding-bottom: 12px;\">\n            <div style=\"display: flex; align-items: center; justify-content: space-between;\">\n               <h2 class=\"m3-title\">Map Libraries</h2>\n               <div class=\"m3-subtitle\" style=\"margin: 0; white-space: nowrap;\">\n                  <span class=\"material-symbols-rounded\" style=\"font-size:14px;vertical-align:middle;\">touch_app</span> Place\n                  <span class=\"material-symbols-rounded\" style=\"font-size:14px;vertical-align:middle;margin-left:4px;\">drag_pan</span> Look\n               </div>\n            </div>\n            <div style=\"display:flex;gap:6px;margin-top:8px; justify-content: flex-start;\">\n               <button id=\"import-btn\" class=\"m3-btn m3-btn-secondary\" title=\"Import map.bin\" style=\"flex: none; width: 48px;\">\n                  <span class=\"material-symbols-rounded\">upload_file</span>\n               </button>\n               <button id=\"export-btn\" class=\"m3-btn m3-btn-secondary\" title=\"Export map.bin\" style=\"flex: none; width: 48px;\">\n                  <span class=\"material-symbols-rounded\">save</span>\n               </button>\n               <button id=\"clear-btn\" class=\"m3-btn m3-btn-error\" title=\"Clear Scene\" style=\"flex: none; width: 48px;\">\n                  <span class=\"material-symbols-rounded\">delete</span>\n               </button>\n            </div>\n            <input type=\"file\" id=\"file-input\" accept=\".bin\" style=\"display: none;\" />\n         </div>\n\n         <!-- MAP LIST VIEW -->\n         <div id=\"view-maps\" style=\"display: flex; flex-direction: column; flex: 1; overflow: hidden;\">\n            <div id=\"map-list\" style=\"flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px;\">\n               <!-- Auto Generated via JS -->\n            </div>\n         </div>\n\n         <!-- PROPS VIEW -->\n         <div id=\"view-props\" style=\"display: none; flex-direction: column; flex: 1; overflow: hidden; position: relative;\">\n            <div id=\"props-header\" class=\"m3-header\" style=\"position: absolute; top: 0; left: 0; width: 100%; box-sizing: border-box; z-index: 10; padding-top: 12px; padding-bottom: 12px; flex-direction: row; justify-content: space-between; align-items: center; transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1); background: var(--md-sys-color-surface); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);\">\n               <div style=\"display: flex; align-items: center; gap: 12px;\">\n                  <button id=\"back-to-maps-btn\" class=\"m3-btn-secondary\" title=\"Back to Map Library\" style=\"width: 36px; height: 36px; padding: 0; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: transparent; border: 1px solid var(--md-sys-color-outline); flex-shrink: 0;\">\n                  <span class=\"material-symbols-rounded\" style=\"font-size: 20px; color: var(--md-sys-color-on-surface);\">arrow_back</span>\n                  </button>\n                  <h2 class=\"m3-title\" style=\"margin: 0;\">Props</h2>\n               </div>\n               <button id=\"load-original-btn\" class=\"m3-btn m3-btn-secondary\" title=\"Load Original Map\" style=\"width: 36px; height: 36px; padding: 0; border-radius: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;\">\n                  <span class=\"material-symbols-rounded\" style=\"font-size: 20px;\">map</span>\n               </button>\n            </div>\n            <div id=\"prefab-list\" style=\"padding-top: 72px;\"></div>\n         </div>\n      </div>\n      <div class=\"grid-floating-panel\">\n         <button id=\"snap-btn\" class=\"m3-btn m3-btn-primary\" style=\"width:40px;padding:8px 0;\" title=\"Toggle Grid Snap\">\n         <span class=\"material-symbols-rounded\" style=\"font-size:20px;\">grid_on</span>\n         </button>\n         <div style=\"width:1px; height:24px; background:var(--md-sys-color-outline); margin: 0 4px;\"></div>\n         <button id=\"rotate-btn\" class=\"m3-btn m3-btn-secondary\" style=\"width:40px;padding:8px 0;\" title=\"Toggle Horizontal Rotate\">\n         <span class=\"material-symbols-rounded\" style=\"font-size:20px;\">rotate_right</span>\n         </button>\n         <button id=\"grid-z-btn\" class=\"m3-btn m3-btn-secondary\" style=\"width:40px;padding:8px 0;\" title=\"Toggle Grid Z Drag\">\n         <span class=\"material-symbols-rounded\" style=\"font-size:20px;\">height</span>\n         <span id=\"grid-height-display\" style=\"display:none;\">0</span>\n         </button>\n         <div style=\"width:1px; height:24px; background:var(--md-sys-color-outline); margin: 0 4px;\"></div>\n         <button id=\"continuous-copy-btn\" class=\"m3-btn m3-btn-secondary\" style=\"width:40px;padding:8px 0;\" title=\"Toggle Continuous Copy\">\n         <span class=\"material-symbols-rounded\" style=\"font-size:20px;\">repeat</span>\n         </button>\n         <button id=\"cancel-ghost-btn\" class=\"m3-btn m3-btn-error\" style=\"width:40px;padding:8px 0;\" title=\"Cancel Placement\">\n         <span class=\"material-symbols-rounded\" style=\"font-size:20px;\">close</span>\n         </button>\n      </div>\n      <button id=\"lock-height-btn\" title=\"Fixed Height\">\n         <span class=\"material-symbols-rounded\" style=\"font-size:24px;\">vertical_align_center</span>\n      </button>\n      <button id=\"toggle-collision-btn\" title=\"Toggle Collisions\">\n         <span class=\"material-symbols-rounded\" style=\"font-size:24px;\">view_in_ar</span>\n      </button>\n      <div id=\"context-menu\">\n         <div class=\"cm-title\" id=\"cm-title\">\n            Model Name\n         </div>\n         <div style=\"display: flex; gap: 16px; padding: 8px 16px 16px; justify-content: center;\">\n            <button id=\"cm-move\" title=\"Move\" style=\"width: 48px; height: 48px; padding: 0;\">\n            <span class=\"material-symbols-rounded\" style=\"font-size: 24px; margin: 0;\">open_with</span>\n            </button>\n            <button id=\"cm-copy\" title=\"Copy\" style=\"width: 48px; height: 48px; padding: 0;\">\n            <span class=\"material-symbols-rounded\" style=\"font-size: 24px; margin: 0;\">content_copy</span>\n            </button>\n            <button id=\"cm-delete\" class=\"cm-danger\" title=\"Delete\" style=\"width: 48px; height: 48px; padding: 0;\">\n            <span class=\"material-symbols-rounded\" style=\"font-size: 24px; margin: 0;\">delete</span>\n            </button>\n         </div>\n      </div>\n      <div id=\"m3-dialog-overlay\">\n         <div id=\"m3-dialog\">\n            <h3 class=\"m3-dialog-title\">\n               <span class=\"material-symbols-rounded\" style=\"color:var(--md-sys-color-error);\">warning</span> \n               <span id=\"dialog-title-text\">Clear Scene</span>\n            </h3>\n            <div class=\"m3-dialog-text\" id=\"dialog-desc-text\">\n               Are you sure you want to delete all objects in the scene? This action cannot be undone.\n            </div>\n            <div style=\"display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px;\">\n               <button id=\"dialog-cancel-btn\" class=\"m3-btn-text\">Cancel</button>\n               <button id=\"dialog-confirm-btn\" class=\"m3-btn-text danger\">Delete</button>\n            </div>\n         </div>\n      </div>\n      <div id=\"toast-msg\"></div>\n      <div id=\"pan-anchor\" style=\"position: fixed; width: 32px; height: 32px; border: 2px solid rgba(255, 255, 255, 0.6); border-radius: 50%; pointer-events: none; z-index: 9999; display: none; transform: translate(-50%, -50%); background: rgba(0, 0, 0, 0.2); backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px);\">\n         <div style=\"position: absolute; top: 50%; left: 50%; width: 6px; height: 6px; background: rgba(255, 255, 255, 0.9); border-radius: 50%; transform: translate(-50%, -50%); box-shadow: 0 0 4px rgba(0,0,0,0.5);\"></div>\n      </div>\n      <div id=\"canvas-container\"></div>\n      <script type=\"module\">\n         import * as THREE from 'three';\n         import { FlyControls } from 'three/addons/controls/FlyControls.js';\n         import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';\n         import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';\n         import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';\n         import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';\n         import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';\n         import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';\n         \nimport { Timer } from 'three/addons/misc/Timer.js';\n\n         // ===== Userscript bootstrap + GM fetch proxy (injected) =====\n         const BOOT = (typeof window !== 'undefined' && window.__MAP_EDITOR_BOOT__) ? window.__MAP_EDITOR_BOOT__ : null;\n         const IS_USERSCRIPT_HOST = !!(BOOT && BOOT.userscriptMode);\n\n         (function setupGmFetchProxy() {\n             if (!IS_USERSCRIPT_HOST || !BOOT.useGmProxy) return;\n             const origFetch = window.fetch.bind(window);\n             let reqId = 0;\n             const pending = new Map();\n             window.addEventListener('message', (e) => {\n                 const d = e.data;\n                 if (!d || d.type !== 'gm-fetch-result') return;\n                 const p = pending.get(d.id);\n                 if (!p) return;\n                 pending.delete(d.id);\n                 if (d.error) {\n                     p.reject(new Error(d.error));\n                     return;\n                 }\n                 const headers = new Headers();\n                 if (d.contentType) headers.set('Content-Type', d.contentType);\n                 if (d.contentLength != null) headers.set('Content-Length', String(d.contentLength));\n                 p.resolve(new Response(d.buffer, { status: 200, statusText: 'OK', headers }));\n             });\n             window.fetch = async function(input, init) {\n                 let url = (input instanceof Request) ? input.url : String(input);\n                 if (url.startsWith('blob:') || url.startsWith('data:') ||\n                     /cdn\\.jsdelivr\\.net|cdnjs\\.cloudflare\\.com|fonts\\.googleapis\\.com|fonts\\.gstatic\\.com|unpkg\\.com/i.test(url)) {\n                     return origFetch(input, init);\n                 }\n                 // Relative URLs resolve against document base; proxy absolute http(s)\n                 try {\n                     const abs = new URL(url, document.baseURI || location.href).href;\n                     if (abs.startsWith('http://') || abs.startsWith('https://')) {\n                         return new Promise((resolve, reject) => {\n                             const id = ++reqId;\n                             pending.set(id, { resolve, reject });\n                             parent.postMessage({ type: 'gm-fetch', id, url: abs }, '*');\n                             setTimeout(() => {\n                                 if (pending.has(id)) {\n                                     pending.delete(id);\n                                     reject(new Error('gm-fetch timeout: ' + abs));\n                                 }\n                             }, 180000);\n                         });\n                     }\n                 } catch (err) {}\n                 return origFetch(input, init);\n             };\n         })();\n\n         \n         const EXTERNAL_MAPS_JSON_URL = \"https://raw.githubusercontent.com/Testanki1/testanki1.github.io/refs/heads/main/maps/maps.json\"; \n         \n         window.currentLibraryUrl = null;\n         window.currentLibraryBaseUrl = null;\n         window.currentMapBaseUrl = null;\n         window.rawFileCache = new Map();\n         \n         const toastEl = document.getElementById('toast-msg');\n         const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;\n         const hostIsZh = navigator.language.toLowerCase().startsWith('zh');\n         const HOST_UI = {\n             uploadMapBin: hostIsZh ? '上传 map.bin' : 'Upload map.bin',\n             exportMapBin: hostIsZh ? '导出 map.bin' : 'Export map.bin',\n             applyEdits: hostIsZh ? '应用编辑' : 'Apply edits',\n             closeEditor: hostIsZh ? '关闭编辑器' : 'Close editor',\n             selectMapBin: hostIsZh ? '请选择 .bin 文件' : 'Please select a .bin file',\n             importingMapBin: hostIsZh ? '正在导入 map.bin...' : 'Importing map.bin...',\n             exportedMapBin: hostIsZh ? '已导出 map.bin' : 'map.bin exported',\n             importedMapBin: hostIsZh ? '已导入 map.bin' : 'map.bin imported',\n             invalidExternalProps: hostIsZh ? '包含原地图之外的物体' : 'Contains props outside the original map',\n             invalidMapBin: hostIsZh ? '无效的 map.bin' : 'Invalid map.bin',\n             exportFailed: hostIsZh ? '导出失败' : 'Export failed',\n             importFailed: hostIsZh ? '导入失败' : 'Import failed'\n         };\n\n         function clonePropRecord(p) {\n             return {\n                 id: typeof p?.id === 'number' ? p.id : 0,\n                 grpName: p?.grpName || '',\n                 libName: p?.libName || '',\n                 matID: p?.matID || 0,\n                 name: p?.name || '',\n                 pos: Array.isArray(p?.pos) ? [...p.pos] : [0, 0, 0],\n                 rot: Array.isArray(p?.rot) ? [...p.rot] : [0, 0, 0],\n                 scale: Array.isArray(p?.scale) ? [...p.scale] : [1, 1, 1]\n             };\n         }\n\n         function clonePropsArray(props) {\n             return Array.isArray(props) ? props.map(clonePropRecord) : [];\n         }\n\n         function getAllowedOriginalPropNames() {\n             const set = new Set();\n             (window.defaultMapProps || []).forEach(p => {\n                 if (p && p.name) set.add(p.name);\n             });\n             return set;\n         }\n\n         function getUniqueBasePropCount(props) {\n             const set = new Set();\n             (props || []).forEach(p => {\n                 const base = getCleanBaseName((p && p.name) || '');\n                 if (base) set.add(base);\n             });\n             return set.size;\n         }\n\n         function ensurePropsCountBadge() {\n             let badge = document.getElementById('props-count-badge');\n             const title = document.querySelector('.m3-header .m3-title');\n             if (!title) return null;\n             if (!badge) {\n                 badge = document.createElement('span');\n                 badge.id = 'props-count-badge';\n                 badge.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;min-width:30px;height:24px;padding:0 10px;margin-left:8px;border-radius:999px;background:rgba(118,255,51,0.14);border:1px solid rgba(118,255,51,0.32);color:var(--md-sys-color-primary);font-size:12px;font-weight:700;vertical-align:middle;';\n                 title.insertAdjacentElement('afterend', badge);\n             }\n             return badge;\n         }\n\n         function updatePropsCountBadge(props) {\n             const badge = ensurePropsCountBadge();\n             if (!badge) return;\n             let count = 0;\n             if (props && props.length === 0) {\n                 count = 0;\n             } else {\n                 const sourceProps = window.originalMapData ? window.originalMapData.props : props;\n                 count = getUniqueBasePropCount(sourceProps);\n             }\n             badge.textContent = String(count);\n             badge.title = hostIsZh\n                 ? \`合并 sub 后共 ${count} 个 props\`\n                 : \`${count} unique props (sub merged)\`;\n         }\n\n\n         function buildSceneObjectDescriptorsFromMapProps(props) {\n             const groups = new Map();\n             for (const prop of (props || [])) {\n                 const baseName = getCleanBaseName((prop && prop.name) || '');\n                 if (!baseName) continue;\n                 let key;\n                 if (prop.grpName && prop.grpName.trim() !== '') {\n                     key = `${baseName}_grp_${prop.grpName}`;\n                 } else {\n                     const px = Math.round((prop.pos?.[0] || 0));\n                     const py = Math.round((prop.pos?.[1] || 0));\n                     const pz = Math.round((prop.pos?.[2] || 0));\n                     key = `${baseName}_${px}_${py}_${pz}`;\n                 }\n                 if (!groups.has(key)) {\n                     groups.set(key, {\n                         key,\n                         baseName,\n                         pos: [prop.pos?.[0] || 0, prop.pos?.[1] || 0, prop.pos?.[2] || 0],\n                         rot: [prop.rot?.[0] || 0, prop.rot?.[1] || 0, prop.rot?.[2] || 0]\n                     });\n                 }\n             }\n             return Array.from(groups.values());\n         }\n\n         function buildSceneObjectDescriptorsFromEditor() {\n             const groups = new Map();\n\n             if (!editorGroup) return [];\n\n             const pushFromChild = (child) => {\n                 if (!child || child === ghost || child.userData?.isCollisionGroup || child.userData?.isOriginalMapGroup) return;\n                 const baseName = child.userData?.baseName || getCleanBaseName(child.userData?.originalProps?.[0]?.name || '');\n                 if (!baseName) return;\n                 \n                 let key;\n                 const grpName = child.userData?.originalProps?.[0]?.grpName;\n                 if (grpName && grpName.trim() !== '') {\n                     key = `${baseName}_grp_${grpName}`;\n                 } else {\n                     const px = Math.round(child.position.x);\n                     const py = Math.round(child.position.y);\n                     const pz = Math.round(child.position.z);\n                     key = `${baseName}_${px}_${py}_${pz}`;\n                 }\n                 \n                 if (!groups.has(key)) {\n                     groups.set(key, {\n                         key,\n                         baseName,\n                         pos: [child.position.x, child.position.y, child.position.z],\n                         rot: [child.rotation.x, child.rotation.y, child.rotation.z]\n                     });\n                 }\n             };\n\n             const originalMapGrp = editorGroup.children.find(c => c.userData?.isOriginalMapGroup);\n             if (originalMapGrp) {\n                 for (const child of originalMapGrp.children) pushFromChild(child);\n             }\n             for (const child of editorGroup.children) pushFromChild(child);\n             return Array.from(groups.values());\n         }\n\n         function computeSceneObjectMeta(originalObjects, currentObjects) {\n             const usedCurrent = new Uint8Array(currentObjects.length);\n             const nearly = (a, b, eps = 1e-2) => Math.abs(a - b) < eps;\n             const sameTransform = (a, b) => (\n                 nearly(a.pos[0], b.pos[0]) && nearly(a.pos[1], b.pos[1]) && nearly(a.pos[2], b.pos[2]) &&\n                 nearly(a.rot[0], b.rot[0]) && nearly(a.rot[1], b.rot[1]) && nearly(a.rot[2], b.rot[2])\n             );\n\n             let matched = 0;\n             let moved = 0;\n             for (const orig of originalObjects) {\n                 let best = -1;\n                 for (let i = 0; i < currentObjects.length; i++) {\n                     if (usedCurrent[i]) continue;\n                     const cur = currentObjects[i];\n                     if (cur.baseName !== orig.baseName) continue;\n                     if (sameTransform(cur, orig)) { best = i; break; }\n                     if (best < 0) best = i;\n                 }\n                 if (best >= 0) {\n                     usedCurrent[best] = 1;\n                     matched++;\n                     if (!sameTransform(currentObjects[best], orig)) moved++;\n                 }\n             }\n\n             let added = 0;\n             for (let i = 0; i < currentObjects.length; i++) {\n                 if (!usedCurrent[i]) added++;\n             }\n\n             return {\n                 deleted: originalObjects.length - matched,\n                 moved,\n                 added,\n                 total: currentObjects.length,\n                 sceneCount: currentObjects.length,\n                 originalCount: originalObjects.length\n             };\n         }\n\n         async function rebuildEditorSceneFromProps(props, successMessage) {\n             const baseMap = window.originalMapData || window.currentMapData;\n             if (!baseMap) throw new Error(hostIsZh ? '原始地图数据不可用' : 'Original map data unavailable');\n\n             window.currentEditorProps = clonePropsArray(props);\n             document.getElementById('prefab-list').innerHTML = '';\n             thumbnailItems.length = 0;\n             prefabs.clear();\n             globalLoadedProps.clear();\n             clearSceneOnly();\n\n             const sceneMapData = { ...baseMap, props: clonePropsArray(window.currentEditorProps) };\n             window.currentMapData = sceneMapData;\n             updateCollisionButtonVisibility();\n\n             await processMap(window.originalMapData, false, null, window.currentLightmapData);\n             await processMap(sceneMapData, true, null, window.currentLightmapData);\n\n             document.getElementById('view-maps').style.display = 'none';\n             document.getElementById('view-props').style.display = 'flex';\n             const pHeader = document.getElementById('props-header');\n             if (pHeader) pHeader.style.transform = 'translateY(0)';\n             updatePropsCountBadge(window.currentEditorProps);\n             if (successMessage) showToast(successMessage, false);\n         }\n\n         async function importMapBinFromFile(file) {\n             if (!file || !/\\.bin$/i.test(file.name)) {\n                 showToast(HOST_UI.selectMapBin, true);\n                 return;\n             }\n             showToast(HOST_UI.importingMapBin, false);\n             const mapBuf = await file.arrayBuffer();\n             const mapData = await parseMapBin(mapBuf);\n             const allowedNames = getAllowedOriginalPropNames();\n             const invalidNames = Array.from(new Set(\n                 mapData.props\n                     .filter(p => !allowedNames.has(p.name))\n                     .map(p => p.name)\n             ));\n             if (invalidNames.length) {\n                 const preview = invalidNames.slice(0, 5).join(', ');\n                 throw new Error(`${HOST_UI.invalidExternalProps}${preview ? `: ${preview}` : ''}`);\n             }\n             await rebuildEditorSceneFromProps(mapData.props, HOST_UI.importedMapBin);\n         }\n\n         async function exportCurrentMapBinFile() {\n             showToast(hostIsZh ? '正在导出 map.bin...' : 'Exporting map.bin...', false);\n             const { binData } = await generateMapBin();\n             const blob = new Blob([binData], { type: 'application/octet-stream' });\n             const url = URL.createObjectURL(blob);\n             const a = document.createElement('a');\n             a.href = url;\n             a.download = 'map.bin';\n             document.body.appendChild(a);\n             a.click();\n             document.body.removeChild(a);\n             setTimeout(() => URL.revokeObjectURL(url), 1000);\n             showToast(HOST_UI.exportedMapBin, false);\n         }\n         \n         let scene, camera, renderer, controls, clock, composer;\nlet cameraTarget;\n         let thumbRenderer, thumbScene, thumbCamera;\n         let hemiLight, dirLight;\n         let editorGroup;\n         const modelCache = new Map();\n         const textureCache = new Map();\n         const prefabs = new Map();\n         const globalLoadedProps = new Set();\n         let thumbnailItems =[];\n         let propDictCache = null;\n         \n         let ghost = null;\n         let currentPrefabGroup = null;\n         let currentMousePos = { x: window.innerWidth / 2, y: window.innerHeight / 2 };\n         let isDragging = false;\n         let pointerDownPos = {x: 0, y: 0};\n         let isUIOpen = window.innerWidth > 768;\n         let isSnapping = true;\n         let currentGridHeight = 0;\n         \n         window.dragMode = 'none'; \n         window.rotateButtonMode = 'horizontal'; \n         window.isEditingDrag = false;\n         window.originalObjectBeingMoved = null;\n         window.originalObjectParent = null;\n         window.isContinuousCopyEnabled = false;\n         let editDragStart = {x: 0, y: 0};\n         let initialGhostRot = new THREE.Euler();\n         let initialGridZ = 0;\n         \n         const raycaster = new THREE.Raycaster();\n         const mouse = new THREE.Vector2();\n         const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);\n         \n         const defaultControl = new THREE.DataTexture(new Uint8Array([255, 0, 0, 0]), 1, 1);\n         defaultControl.needsUpdate = true;\n         const defaultTile = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);\n         defaultTile.colorSpace = THREE.SRGBColorSpace;\n         defaultTile.needsUpdate = true;\n\n         function updateCollisionButtonVisibility() {\n             const mapData = window.currentMapData;\n             const toggleCollisionBtn = document.getElementById('toggle-collision-btn');\n             if (!toggleCollisionBtn || !mapData) return;\n             \n             const hasCol = (mapData.collisionData1 && (mapData.collisionData1.shapesType1.length > 0 || mapData.collisionData1.shapesType2.length > 0 || mapData.collisionData1.shapesType3.length > 0)) ||\n                            (mapData.collisionData2 && (mapData.collisionData2.shapesType1.length > 0 || mapData.collisionData2.shapesType2.length > 0 || mapData.collisionData2.shapesType3.length > 0));\n             \n             if (hasCol) {\n                 toggleCollisionBtn.style.display = 'flex';\n                 const lockBtn = document.getElementById('lock-height-btn');\n                 if (lockBtn && lockBtn.style.display !== 'none') {\n                     toggleCollisionBtn.style.bottom = '144px';\n                 } else {\n                     toggleCollisionBtn.style.bottom = '84px';\n                 }\n             } else {\n                 toggleCollisionBtn.style.display = 'none';\n             }\n         }\n         \n         function getCleanBaseName(rawName) {\n             let cleaned = rawName;\n             if (/[-_]sub[-_]?\\d+$/i.test(cleaned)) {\n                 cleaned = cleaned.replace(/[-_]sub[-_]?\\d+$/i, '');\n             }\n             return cleaned;\n         }\n         \n         function showToast(msg, isError = true) {\n             const icon = isError ? 'error' : 'check_circle';\n             toastEl.innerHTML = `<span class=\"material-symbols-rounded\" style=\"vertical-align:middle;\">${icon}</span> ${msg}`;\n             toastEl.style.background = isError ? 'var(--md-sys-color-error)' : 'rgba(56, 142, 60, 0.9)';\n             toastEl.style.color = isError ? 'var(--md-sys-color-on-error)' : 'white';\n             toastEl.style.opacity = '1';\n             setTimeout(() => { toastEl.style.opacity = '0'; }, 2500);\n         }\n         \n         async function fetchWithProgress(url, onProgress) {\n             const response = await fetch(url);\n             if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);\n             \n             const contentLength = response.headers.get('content-length');\n             const total = contentLength ? parseInt(contentLength, 10) : 0;\n             let loaded = 0;\n         \n             const reader = response.body.getReader();\n             const chunks =[];\n             while (true) {\n                 const { done, value } = await reader.read();\n                 if (done) break;\n                 chunks.push(value);\n                 loaded += value.length;\n                 if (total) {\n                     onProgress(loaded / total);\n                 } else {\n                     onProgress(Math.min(loaded / 2000000, 1)); \n                 }\n             }\n         \n             const allChunks = new Uint8Array(loaded);\n             let position = 0;\n             for (let chunk of chunks) {\n                 allChunks.set(chunk, position);\n                 position += chunk.length;\n             }\n             return allChunks.buffer;\n         }\n         \n         async function fetchFile(url, type = 'arraybuffer') {\n             try {\n                 const res = await fetch(url);\n                 if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);\n                 return type === 'json' ? await res.json() : await res.arrayBuffer();\n             } catch (err) {\n                 throw new Error(`${err.message} (Network Error)`);\n             }\n         }\n         \n         class BinaryStream {\n             constructor(buffer) {\n                 this.buffer = new Uint8Array(buffer);\n                 this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);\n                 this.offset = 0;\n             }\n             readUint8() { const v = this.view.getUint8(this.offset); this.offset += 1; return v; }\n             readUint16(le = false) { const v = this.view.getUint16(this.offset, le); this.offset += 2; return v; }\n             readUint32(le = false) { const v = this.view.getUint32(this.offset, le); this.offset += 4; return v; }\n             readInt32(le = false) { const v = this.view.getInt32(this.offset, le); this.offset += 4; return v; }\n             readFloat32(le = false) { const v = this.view.getFloat32(this.offset, le); this.offset += 4; return v; }\n             readFloat64(le = false) { const v = this.view.getFloat64(this.offset, le); this.offset += 8; return v; }\n             readBytes(len) { const v = this.buffer.subarray(this.offset, this.offset + len); this.offset += len; return v; }\n             readStringLength() {\n                 const flags = this.readUint8();\n                 if ((flags & 0b10000000) === 0) return flags & 0b01111111;\n                 if ((flags & 0b01000000) === 0) return ((flags & 0b00111111) << 8) + this.readUint8();\n                 return ((flags & 0b00111111) << 16) + this.readUint16(false);\n             }\n             readString() { return new TextDecoder().decode(this.readBytes(this.readStringLength())); }\n             readNullTerminatedString() {\n                 let str = \"\";\n                 while(true) {\n                     const char = this.readUint8();\n                     if (char === 0) break;\n                     str += String.fromCharCode(char);\n                 }\n                 return str;\n             }\n             readLengthPrefixedStringA3D() {\n                 const len = this.readUint32(true);\n                 const str = new TextDecoder().decode(this.readBytes(len));\n                 this.offset += (((len + 3) >> 2) << 2) - len; \n                 return str;\n             }\n         }\n         \n         class BinaryWriter {\n             constructor() { this.chunks =[]; this.length = 0; }\n             writeUint8(v) { this._add(new Uint8Array([v])); }\n             writeUint16(v, le = false) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v, le); this._add(b); }\n             writeUint32(v, le = false) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, le); this._add(b); }\n             writeInt32(v, le = false) { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, v, le); this._add(b); }\n             writeFloat32(v, le = false) { const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, v, le); this._add(b); }\n             writeFloat64(v, le = false) { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, v, le); this._add(b); }\n             writeBytes(b) { this._add(b); }\n             writeStringLength(len) {\n                 if (len <= 0b01111111) { this.writeUint8(len); } \n                 else if (len <= 0x3FFF) { this.writeUint8(0b10000000 | (len >> 8)); this.writeUint8(len & 0xFF); } \n                 else { this.writeUint8(0b11000000 | (len >> 16)); this.writeUint16(len & 0xFFFF, false); }\n             }\n             writeString(str) { const bytes = new TextEncoder().encode(str); this.writeStringLength(bytes.length); this.writeBytes(bytes); }\n             writeLengthPrefixedStringA3D(str) {\n                 const bytes = new TextEncoder().encode(str);\n                 this.writeUint32(bytes.length, true);\n                 this.writeBytes(bytes);\n                 const pad = (((bytes.length + 3) >> 2) << 2) - bytes.length;\n                 for(let i=0; i<pad; i++) this.writeUint8(0);\n             }\n             _add(b) { this.chunks.push(b); this.length += b.length; }\n             toUint8Array() {\n                 const res = new Uint8Array(this.length);\n                 let offset = 0;\n                 for(const chunk of this.chunks) { res.set(chunk, offset); offset += chunk.length; }\n                 return res;\n             }\n         }\n         \n         async function decompressZlib(uint8array) {\n             const ds = new DecompressionStream(\"deflate\");\n             const writer = ds.writable.getWriter();\n             writer.write(uint8array);\n             writer.close();\n             return new Uint8Array(await new Response(ds.readable).arrayBuffer());\n         }\n         \n         async function unwrapPacket(stream) {\n             const flags = stream.readUint8();\n             const compressed = (flags & 0b01000000) > 0;\n             let len = 0;\n             if ((flags & 0b10000000) === 0) {\n                 len = stream.readUint8() + ((flags & 0b00111111) << 8);\n             } else {\n                 const b1 = stream.readUint8(), b2 = stream.readUint8(), b3 = stream.readUint8();\n                 len = (b1 << 16) | (b2 << 8) | b3;\n                 len += (flags & 0b00111111) * 16777216;\n             }\n             let data = stream.readBytes(len);\n             if (compressed) data = await decompressZlib(data);\n             return new BinaryStream(data);\n         }\n         \n         function packHeader(bits) {\n             const extCount = Math.ceil(bits.length / 8);\n             const extBytes = new Uint8Array(extCount);\n             extBytes.fill(255);\n             for(let i = 0; i < bits.length; i++) {\n                 if (bits[i]) {\n                     const byteIdx = Math.floor(i / 8);\n                     const bitIdx = 7 - (i % 8);\n                     extBytes[byteIdx] &= ~(1 << bitIdx);\n                 }\n             }\n             let flags = 0b10000000;\n             let headerPrefix;\n             if (extCount <= 63) {\n                 flags |= extCount;\n                 headerPrefix = new Uint8Array([flags]);\n             } else {\n                 flags |= 0b01000000;\n                 flags |= (extCount >> 16) & 0b00111111;\n                 headerPrefix = new Uint8Array(3);\n                 headerPrefix[0] = flags;\n                 new DataView(headerPrefix.buffer).setUint16(1, extCount & 0xFFFF, false);\n             }\n             return { headerPrefix, extBytes };\n         }\n         \n         async function wrapPacketCompressed(payload) {\n             const cs = new CompressionStream(\"deflate\");\n             const writer = cs.writable.getWriter();\n             writer.write(payload);\n             writer.close();\n             const compressed = new Uint8Array(await new Response(cs.readable).arrayBuffer());\n             \n             const bw = new BinaryWriter();\n             const len = compressed.length;\n             const flags = 0b11000000 | ((len >> 24) & 0b00111111);\n             bw.writeUint8(flags);\n             bw.writeUint8((len >> 16) & 0xFF);\n             bw.writeUint8((len >> 8) & 0xFF);\n             bw.writeUint8(len & 0xFF);\n             bw.writeBytes(compressed);\n             return bw.toUint8Array();\n         }\n         \n         const A3D_VERTEXTYPE = { 1:3, 2:2, 3:3, 4:2, 5:4, 6:3 }; \n         \n         function parseA3D(buffer) {\n             const stream = new BinaryStream(buffer);\n             const sig = new TextDecoder().decode(stream.readBytes(4));\n             if (sig !== \"A3D\\0\") throw new Error(\"Invalid A3D signature\");\n             const version = stream.readUint16(true);\n             stream.readUint16(true); \n         \n             stream.readUint32(true);\n             stream.readUint32(true);\n         \n             const data = { meshes:[] };\n         \n             const matSig = stream.readUint32(true);\n             const matLen = stream.readUint32(true); \n             const matCount = stream.readUint32(true);\n             \n             const a3dMaterials =[];\n         \n             for(let i=0; i<matCount; i++) {\n                 let matName = \"\";\n                 let texName = \"\";\n                 if(version===3) { \n                     matName = stream.readLengthPrefixedStringA3D(); \n                     stream.offset+=12; \n                     texName = stream.readLengthPrefixedStringA3D(); \n                 } else { \n                     matName = stream.readNullTerminatedString(); \n                     stream.offset+=12; \n                     texName = stream.readNullTerminatedString(); \n                 }\n                 a3dMaterials.push({ matName, texName });\n             }\n             if(version===3) stream.offset += (((matLen + 3) >> 2) << 2) - matLen; \n             \n             data.a3dMaterials = a3dMaterials;\n         \n             const meshSig = stream.readUint32(true);\n             const meshLen = stream.readUint32(true); \n             const meshCount = stream.readUint32(true);\n             \n             for(let i=0; i<meshCount; i++) {\n                 let mName = \"Mesh_\" + i;\n                 if(version===3) { mName = stream.readLengthPrefixedStringA3D(); stream.offset += 28; }\n                 const vertexCount = stream.readUint32(true);\n                 const vBufCount = stream.readUint32(true);\n                 const buffers =[];\n                 for(let b=0; b<vBufCount; b++) {\n                     const bType = stream.readUint32(true);\n                     const numFloats = A3D_VERTEXTYPE[bType];\n                     const byteLen = vertexCount * numFloats * 4;\n                     const sliceBuf = stream.buffer.slice(stream.offset, stream.offset + byteLen);\n                     buffers.push({ type: bType, data: new Float32Array(sliceBuf.buffer, sliceBuf.byteOffset, vertexCount * numFloats) });\n                     stream.offset += byteLen;\n                 }\n                 \n                 const submeshCount = stream.readUint32(true);\n                 const submeshes =[];\n                 const v2MatIds =[];\n                 \n                 for(let s=0; s<submeshCount; s++) {\n                     if(version===2) {\n                         const fCount = stream.readUint32(true);\n                         const iCount = fCount * 3;\n                         const sliceBuf = stream.buffer.slice(stream.offset, stream.offset + iCount * 2);\n                         stream.offset += iCount * 2 + fCount * 4; \n                         const matId = stream.readUint16(true);\n                         v2MatIds.push(matId);\n                         submeshes.push({ indices: new Uint16Array(sliceBuf.buffer, sliceBuf.byteOffset, iCount), matId: matId });\n                     } else {\n                         const iCount = stream.readUint32(true);\n                         const sliceBuf = stream.buffer.slice(stream.offset, stream.offset + iCount * 2);\n                         stream.offset += iCount * 2;\n                         stream.offset += (((iCount * 2 + 3) >> 2) << 2) - (iCount * 2); \n                         submeshes.push({ indices: new Uint16Array(sliceBuf.buffer, sliceBuf.byteOffset, iCount), matId: 0 });\n                     }\n                 }\n                 \n                 const geo = new THREE.BufferGeometry();\n                 geo.name = mName;\n                 let mainIndices =[];\n                 submeshes.forEach((sm, idx) => {\n                     const start = mainIndices.length;\n                     for (let k = 0; k < sm.indices.length; k++) {\n                         mainIndices.push(sm.indices[k]);\n                     }\n                     geo.addGroup(start, sm.indices.length, idx);\n                 });\n                 geo.setIndex(mainIndices);\n                 geo.userData.v2MatIds = v2MatIds;\n         \n                 buffers.forEach(buf => {\n                     if(buf.type === 1) geo.setAttribute('position', new THREE.BufferAttribute(buf.data, 3));\n                     else if(buf.type === 2) geo.setAttribute('uv', new THREE.BufferAttribute(buf.data, 2));\n                     else if(buf.type === 3) geo.setAttribute('normal', new THREE.BufferAttribute(buf.data, 3));\n                     else if(buf.type === 4) geo.setAttribute('uv2', new THREE.BufferAttribute(buf.data, 2));\n                     else if(buf.type === 6 && !geo.attributes.normal) geo.setAttribute('normal', new THREE.BufferAttribute(buf.data, 3));\n                 });\n                 \n                 if (!geo.attributes.uv && geo.attributes.uv2) geo.setAttribute('uv', geo.attributes.uv2);\n                 if (!geo.attributes.normal) geo.computeVertexNormals();\n                 data.meshes.push(geo);\n             }\n             \n             try {\n                 if (stream.offset < stream.buffer.byteLength) {\n                     const transformSig = stream.readUint32(true);\n                     if (transformSig === 3) { \n                         const transformLen = stream.readUint32(true);\n                         const transformCount = stream.readUint32(true);\n                         const transforms =[];\n                         \n                         for (let i = 0; i < transformCount; i++) {\n                             if (version === 3) stream.readLengthPrefixedStringA3D();\n                             const px = stream.readFloat32(true), py = stream.readFloat32(true), pz = stream.readFloat32(true);\n                             let rx = stream.readFloat32(true), ry = stream.readFloat32(true), rz = stream.readFloat32(true), rw = stream.readFloat32(true);\n                             let sx = stream.readFloat32(true), sy = stream.readFloat32(true), sz = stream.readFloat32(true);\n                   \n                             if (sx === 0 && sy === 0 && sz === 0) { sx = 1; sy = 1; sz = 1; }\n                             if (rx === 0 && ry === 0 && rz === 0 && rw === 0) { rx = 0; ry = 0; rz = 0; rw = 1; }\n         \n                             transforms.push({\n                                 pos: new THREE.Vector3(px, py, pz),\n                                 quat: new THREE.Quaternion(rx, ry, rz, rw),\n                                 scale: new THREE.Vector3(sx, sy, sz)\n                             });\n                         }\n                         \n                         for (let i = 0; i < transformCount; i++) stream.readInt32(true);\n                         if (version === 3) stream.offset += (((transformLen + 3) >> 2) << 2) - transformLen;\n         \n                         const objectSig = stream.readUint32(true);\n                         if (objectSig === 5) { \n                             stream.readUint32(true); \n                             const objectCount = stream.readUint32(true);\n                             const objects =[];\n                             \n                             for (let i = 0; i < objectCount; i++) {\n                                 let name = \"\";\n                                 let mID = 0;\n                                 let tID = 0;\n                                 let matIds =[];\n                                 if (version === 2) {\n                                     name = stream.readNullTerminatedString(); \n                                     mID = stream.readUint32(true);\n                                     tID = stream.readUint32(true);\n                                 } else {\n                                     name = stream.readLengthPrefixedStringA3D();\n                                     mID = stream.readUint32(true);\n                                     tID = stream.readUint32(true);\n                                     const mCount = stream.readUint32(true);\n                                     for (let j = 0; j < mCount; j++) {\n                                         matIds.push(stream.readInt32(true));\n                                     }\n                                 }\n                                 objects.push({ name, meshID: mID, transformID: tID, matIds });\n                             }\n         \n                             data.namedMeshes = {};\n                             const transformedMeshes =[];\n                             for (let i = 0; i < data.meshes.length; i++) {\n                                 transformedMeshes[i] = data.meshes[i].clone();\n                             }\n         \n                             for (let i = 0; i < objects.length; i++) {\n                                 const obj = objects[i];\n                                 if (obj.meshID < transformedMeshes.length && obj.transformID < transforms.length) {\n                                     const tf = transforms[obj.transformID];\n                                     const mat = new THREE.Matrix4().compose(tf.pos, tf.quat, tf.scale);\n                                     const geo = transformedMeshes[obj.meshID].clone();\n                                     geo.applyMatrix4(mat);\n                                     \n                                     geo.userData.matIds = obj.matIds;\n                                     if (version === 2) {\n                                         geo.userData.matIds = geo.userData.v2MatIds ||[];\n                                     }\n                          \n                                     geo.name = obj.name;\n                                     data.namedMeshes[obj.name] = geo;\n                                     data.namedMeshes[`mesh_${i}`] = geo;\n                                     \n                                     if (i === 0) {\n                                         data.meshes[0] = geo;\n                                     }\n                                 }\n                             }\n                         }\n                     }\n                 }\n             } catch (e) {\n                 console.warn(\"Failed to parse A3D local Transform:\", e);\n             }\n             return data;\n         }\n         \n         function exportOptimizedA3D(geometries) {\n             const bw = new BinaryWriter();\n             bw.writeBytes(new TextEncoder().encode(\"A3D\\0\"));\n             bw.writeUint16(3, true); bw.writeUint16(0, true); bw.writeUint32(0, true); bw.writeUint32(0, true);\n             \n             const matBw = new BinaryWriter();\n             for(let i=0; i<geometries.length; i++) {\n                 matBw.writeLengthPrefixedStringA3D(\"mat_\" + i);\n                 matBw.writeFloat32(0,true); matBw.writeFloat32(0,true); matBw.writeFloat32(0,true);\n                 matBw.writeLengthPrefixedStringA3D(\"tex_\" + i);\n             }\n             const matBytes = matBw.toUint8Array();\n             bw.writeUint32(1, true); bw.writeUint32(matBytes.length, true); bw.writeUint32(geometries.length, true); bw.writeBytes(matBytes);\n             let pad = (((matBytes.length + 3) >> 2) << 2) - matBytes.length;\n             for(let i=0; i<pad; i++) bw.writeUint8(0);\n         \n             const meshBw = new BinaryWriter();\n             for(let geo of geometries) {\n                 meshBw.writeLengthPrefixedStringA3D(geo.name || \"UnnamedMesh\");\n                 for(let k=0; k<7; k++) meshBw.writeFloat32(0, true);\n                 \n                 const pos = geo.attributes.position;\n                 const uv = geo.attributes.uv || geo.attributes.uv2;\n                 const normal = geo.attributes.normal;\n                 \n                 meshBw.writeUint32(pos.count, true);\n                 let bufs =[];\n                 bufs.push({type: 1, arr: pos});\n                 if (uv) bufs.push({type: 2, arr: uv});\n                 if (normal) bufs.push({type: 3, arr: normal});\n                 \n                 meshBw.writeUint32(bufs.length, true);\n                 for(let b of bufs) {\n                     meshBw.writeUint32(b.type, true);\n                     for(let i=0; i<b.arr.count * b.arr.itemSize; i++) {\n                         meshBw.writeFloat32(b.arr.array[i], true);\n                     }\n                 }\n                 \n                 let groups = geo.groups;\n                 if(!groups || groups.length === 0) {\n                     let count = geo.index ? geo.index.count : pos.count;\n                     groups =[{start: 0, count: count, materialIndex: 0}];\n                 }\n                 meshBw.writeUint32(groups.length, true);\n                 for(let g of groups) {\n                     meshBw.writeUint32(g.count, true);\n                     let indices = geo.index ? geo.index.array : null;\n                     for(let i=0; i<g.count; i++) {\n                         let idx = indices ? indices[g.start + i] : (g.start + i);\n                         meshBw.writeUint16(idx, true);\n                     }\n                     let padBytes = (((g.count * 2 + 3) >> 2) << 2) - (g.count * 2);\n                     for(let i=0; i<padBytes; i++) meshBw.writeUint8(0);\n                 }\n             }\n             const meshBytes = meshBw.toUint8Array();\n             bw.writeUint32(2, true); bw.writeUint32(meshBytes.length, true); bw.writeUint32(geometries.length, true); bw.writeBytes(meshBytes);\n         \n             const tBw = new BinaryWriter();\n             for(let geo of geometries) {\n                 tBw.writeLengthPrefixedStringA3D(\"tf_\" + (geo.name || \"Unnamed\"));\n                 tBw.writeFloat32(0,true); tBw.writeFloat32(0,true); tBw.writeFloat32(0,true);\n                 tBw.writeFloat32(0,true); tBw.writeFloat32(0,true); tBw.writeFloat32(0,true); tBw.writeFloat32(1,true);\n                 tBw.writeFloat32(1,true); tBw.writeFloat32(1,true); tBw.writeFloat32(1,true);\n             }\n             for(let geo of geometries) tBw.writeInt32(-1, true);\n             const tBytes = tBw.toUint8Array();\n             bw.writeUint32(3, true); bw.writeUint32(tBytes.length, true); bw.writeUint32(geometries.length, true); bw.writeBytes(tBytes);\n             pad = (((tBytes.length + 3) >> 2) << 2) - tBytes.length;\n             for(let i=0; i<pad; i++) bw.writeUint8(0);\n         \n             const objBw = new BinaryWriter();\n             for(let i=0; i<geometries.length; i++) {\n                 const geo = geometries[i];\n                 objBw.writeLengthPrefixedStringA3D(geo.name || \"Unnamed\");\n                 objBw.writeUint32(i, true);\n                 objBw.writeUint32(i, true);\n                 \n                 let groups = geo.groups;\n                 if(!groups || groups.length === 0) groups =[{materialIndex: 0}];\n                 objBw.writeUint32(groups.length, true);\n                 \n                 let matIds = geo.userData.matIds || geo.userData.v2MatIds ||[];\n                 for(let j=0; j<groups.length; j++) {\n                     let mId = j < matIds.length ? matIds[j] : 0;\n                     objBw.writeInt32(mId, true);\n                 }\n             }\n             const objBytes = objBw.toUint8Array();\n             bw.writeUint32(5, true);\n             bw.writeUint32(objBytes.length, true);\n             bw.writeUint32(geometries.length, true);\n             bw.writeBytes(objBytes);\n         \n             return bw.toUint8Array();\n         }\n\n         async function parseMapBin(buffer) {\n             const stream = new BinaryStream(buffer);\n             const packet = await unwrapPacket(stream);\n             \n             const fullOriginalBits =[];\n             const flags = packet.readUint8();\n             if ((flags & 0b10000000) === 0) {\n                 const intBits = flags << 3;\n                 for (let i = 7; i >= 3; i--) fullOriginalBits.push((intBits & (1 << i)) === 0);\n                 const extCount = (flags & 0b01100000) >> 5;\n                 const extBytes = packet.readBytes(extCount);\n                 for (let i = 0; i < extBytes.length; i++) for (let b = 7; b >= 0; b--) fullOriginalBits.push((extBytes[i] & (1 << b)) === 0);\n             } else {\n                 let extCount = ((flags & 0b01000000) === 0) ? (flags & 0b00111111) : (((flags & 0b00111111) << 16) + packet.readUint16(false));\n                 const extBytes = packet.readBytes(extCount);\n                 for (let i = 0; i < extBytes.length; i++) for (let b = 7; b >= 0; b--) fullOriginalBits.push((extBytes[i] & (1 << b)) === 0);\n             }\n\n             const optMask =[...fullOriginalBits].reverse();\n             const popBit = () => optMask.pop();\n\n             const skipObjectArray = (p, cb) => { const len = p.readStringLength(); for(let i=0; i<len; i++) cb(p); };\n             const readV3 = () =>[packet.readFloat32(false), packet.readFloat32(false), packet.readFloat32(false)];\n\n             const result = { props:[], materials: {}, atlases: {} };\n\n             if (popBit()) {\n                 const atlasLen = packet.readStringLength();\n                 for(let i=0; i<atlasLen; i++) {\n                     const aHeight = packet.readInt32(false); \n                     const aName = packet.readString();\n                     const aUnknown = packet.readUint32(false); \n                     const rects = {};\n                     const rectLen = packet.readStringLength();\n                     for(let j=0; j<rectLen; j++) {\n                         const rHeight = packet.readUint32(false); \n                         const rLib = packet.readString();\n                         const rName = packet.readString();\n                         const rWidth = packet.readUint32(false);\n                         const rx = packet.readUint32(false);\n                         const ry = packet.readUint32(false);\n                         rects[`${rLib}_${rName}`] = { x: rx, y: ry, w: rWidth, h: rHeight, originalName: rName, rLib: rLib };\n                     }\n                     const aWidth = packet.readUint32(false);\n                     result.atlases[aName] = { width: aWidth, height: aHeight, aUnknown, rects };\n                 }\n             }\n             window.parsedAtlases = result.atlases;\n         \n             if (popBit()) skipObjectArray(packet, p => { p.readUint32(false); p.readString(); p.offset+=12; p.readString(); });\n         \n             const readCols = () => {\n                 const col = { shapesType1: [], shapesType2: [], shapesType3:[] };\n                 let len = packet.readStringLength(); \n                 for(let i=0; i<len; i++) {\n                     col.shapesType1.push([\n                         packet.readFloat32(false), packet.readFloat32(false), packet.readFloat32(false),\n                         packet.readFloat32(false), packet.readFloat32(false), packet.readFloat32(false),\n                         packet.readFloat32(false), packet.readFloat32(false), packet.readFloat32(false)\n                     ]);\n                 } \n                 len = packet.readStringLength(); \n                 for(let i=0; i<len; i++) { \n                     const f1 = packet.readFloat64(false); \n                     const data =[];\n                     for(let j=0; j<6; j++) data.push(packet.readFloat32(false));\n                     const f2 = packet.readFloat64(false); \n                     col.shapesType2.push({ f1, data, f2 });\n                 } \n                 len = packet.readStringLength(); \n                 for(let i=0; i<len; i++) { \n                     const f1 = packet.readFloat64(false);\n                     const data =[];\n                     for(let j=0; j<15; j++) data.push(packet.readFloat32(false));\n                     col.shapesType3.push({ f1, data });\n                 } \n                 return col;\n             };\n             result.collisionData1 = readCols(); \n             result.collisionData2 = readCols();\n\n             const matLen = packet.readStringLength();\n             for(let i=0; i<matLen; i++) {\n                 const matID = packet.readUint32(false);\n                 const matName = packet.readString();\n                 if (popBit()) skipObjectArray(packet, p => { p.readString(); p.offset+=4; });\n                 const shader = packet.readString();\n\n                 const texParams =[];\n                 const texLen = packet.readStringLength();\n                 for(let j=0; j<texLen; j++) {\n                     let libName = null;\n                     if (popBit()) libName = packet.readString();\n                     const texParamName = packet.readString();\n                     const texName = packet.readString();\n                     texParams.push({ libName, name: texParamName, texName });\n                 }\n\n                 if (popBit()) skipObjectArray(packet, p => { p.readString(); p.offset+=8; });\n                 if (popBit()) skipObjectArray(packet, p => { p.readString(); p.offset+=12; });\n                 if (popBit()) skipObjectArray(packet, p => { p.readString(); p.offset+=16; });\n                 \n                 result.materials[matID] = { name: matName, shader, texParams };\n             }\n\n             if (popBit()) skipObjectArray(packet, p => { p.offset+=28; }); \n\n             let maxPropId = 0;\n             const propLen = packet.readStringLength();\n             for(let i=0; i<propLen; i++) {\n                 let grpName = \"\"; if(popBit()) grpName = packet.readString();\n                 const id = packet.readUint32(false);\n                 if (id > maxPropId) maxPropId = id;\n         \n                 const libName = packet.readString();\n                 const matID = packet.readUint32(false);\n                 const name = packet.readString();\n                 const pos = readV3();\n                 const rot = popBit() ? readV3() : [0,0,0];\n                 const scale = popBit() ? readV3() : [1,1,1];\n                 \n                 result.props.push({ id, grpName, libName, matID, name, pos, rot, scale });\n             }\n         \n             return result;\n         }\n         \n         function decodeIntColorToHex(intColor) {\n             const r = (intColor >> 16) & 255;\n             const g = (intColor >> 8) & 255;\n             const b = intColor & 255;\n             return (r << 16) | (g << 8) | b;\n         }\n         \n         function parseLightmapData(buffer) {\n             const stream = new BinaryStream(buffer);\n             const version = stream.readUint32(true);\n             if (version !== 2) return null;\n         \n             const lightColorInt = stream.readUint32(true);\n             const ambientColorInt = stream.readUint32(true);\n             const lightAngleX = stream.readFloat32(true);\n             const lightAngleZ = stream.readFloat32(true);\n         \n             const lightmapCount = stream.readUint32(true);\n             const lightmaps =[];\n             for (let i = 0; i < lightmapCount; i++) {\n                 lightmaps.push(stream.readString());\n             }\n         \n             return { version, lightColorInt, ambientColorInt, lightAngleX, lightAngleZ, lightmaps };\n         }\n         \n         function applyLightmapData(data) {\n             if (!data) {\n                 if (dirLight) {\n                     dirLight.color.setHex(0xFFFFFF);\n                     dirLight.intensity = 3.5;\n                     dirLight.position.set(-800, 1500, -500); \n                     dirLight.lookAt(0, 0, 0);\n                 }\n                 if (hemiLight) {\n                     hemiLight.color.setHex(0xDDDDDD);\n                     hemiLight.groundColor.setHex(0x888888);\n                     hemiLight.intensity = 1.0;\n                 } \n                 if (scene) {\n                     scene.background = new THREE.Color(0xDDDDDD);\n                 }\n                 return;\n             }\n             \n             const lightColor = decodeIntColorToHex(data.lightColorInt);\n             const ambientColor = decodeIntColorToHex(data.ambientColorInt);\n             \n             if (dirLight) {\n                 dirLight.color.setHex(lightColor);\n                 dirLight.intensity = 4.0;\n                 \n                 const radX = data.lightAngleX;\n                 const radZ = data.lightAngleZ;\n\n                 const dirX = -Math.cos(radX) * Math.sin(radZ);\n                 const dirY = Math.cos(radX) * Math.cos(radZ);\n                 const dirZ = Math.sin(radX);\n\n                 dirLight.position.set(-dirX * 5000, -dirZ * 5000, dirY * 5000);\n                 dirLight.lookAt(0, 0, 0);\n             }\n             if (hemiLight) {\n                 hemiLight.color.setHex(ambientColor);\n                 const groundColor = new THREE.Color(ambientColor).multiplyScalar(0.4);\n                 hemiLight.groundColor.copy(groundColor); \n                 hemiLight.intensity = 0.8;\n             } \n             \n             scene.background = new THREE.Color(ambientColor); \n         }\n         \n         function setupMobileFullscreen() {\n             const lockScreen = async () => {\n                 const isFullscreen = document.fullscreenElement || document.webkitFullscreenElement;\n                 if (!isFullscreen) {\n                     try {\n                         const doc = document.documentElement;\n                         if (doc.requestFullscreen) { await doc.requestFullscreen(); } \n                         else if (doc.webkitRequestFullscreen) { await doc.webkitRequestFullscreen(); }\n                         if (screen.orientation && screen.orientation.lock) { await screen.orientation.lock(\"landscape\"); }\n                     } catch (e) { console.warn(\"Fullscreen error\", e.message); }\n                 }\n             };\n             document.body.addEventListener('click', lockScreen);\n             document.body.addEventListener('touchstart', lockScreen, { passive: true });\n         }\n         \n         function setupMobileControls() {\n             const cameraPointers = {};\n             let previousTwoFingerState = null;\n         \n             function getTwoFingerState(pointers) {\n                 if (pointers.length < 2) return null;\n                 const t0 = pointers[0];\n                 const t1 = pointers[1];\n                 return { \n                     distance: Math.hypot(t1.x - t0.x, t1.y - t0.y), \n                     midpoint: { x: (t0.x + t1.x) / 2, y: (t0.y + t1.y) / 2 } \n                 };\n             }\n         \n             function handleSpectatorPanAndZoom(pointers) {\n                 const currentState = getTwoFingerState(pointers);\n                 if (previousTwoFingerState && currentState) {\n                     const deltaPanX = currentState.midpoint.x - previousTwoFingerState.midpoint.x;\n                     const deltaPanY = currentState.midpoint.y - previousTwoFingerState.midpoint.y;\n                     const deltaPinch = currentState.distance - previousTwoFingerState.distance;\n                     camera.translateX(-deltaPanX);\n            camera.translateY(deltaPanY);\n            camera.translateZ(-deltaPinch);\n            if (typeof cameraTarget !== 'undefined' && cameraTarget) {\n                cameraTarget.position.copy(camera.position);\n            }\n        }\n        previousTwoFingerState = currentState;\n             }\n         \n             const onPointerDown = (e) => {\n                 cameraPointers[e.pointerId] = { x: e.clientX, y: e.clientY };\n                 window.cameraPointersCount = Object.keys(cameraPointers).length;\n                 if (Object.keys(cameraPointers).length >= 2) {\n                     previousTwoFingerState = getTwoFingerState(Object.values(cameraPointers));\n                     window.isEditingDrag = false;\n                     window.wasMultiTouch = true;\n                 }\n             };\n         \n             const onPointerMove = (e) => {\n                 const pointer = cameraPointers[e.pointerId];\n                 if (!pointer) return;\n         \n                 if (Object.keys(cameraPointers).length === 1 && window.dragMode !== 'none' && window.isEditingDrag) {\n                     pointer.x = e.clientX;\n                     pointer.y = e.clientY;\n                     return;\n                 }\n                 const deltaX = e.clientX - pointer.x;\n                 const deltaY = e.clientY - pointer.y;\n         \n                 if (Object.keys(cameraPointers).length === 1) {\n                     camera.rotation.y -= deltaX * 0.004;\n                     camera.rotation.x -= deltaY * 0.004;\n                     camera.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, camera.rotation.x));\n                 } else if (Object.keys(cameraPointers).length === 2) {\n                     pointer.x = e.clientX;\n                     pointer.y = e.clientY;\n                     handleSpectatorPanAndZoom(Object.values(cameraPointers));\n                 }\n                 pointer.x = e.clientX;\n                 pointer.y = e.clientY;\n             };\n         \n             const onPointerUpOrCancel = (e) => {\n                 delete cameraPointers[e.pointerId];\n                 window.cameraPointersCount = Object.keys(cameraPointers).length;\n                 if (Object.keys(cameraPointers).length < 2) {\n                     previousTwoFingerState = null;\n                 }\n                 if (Object.keys(cameraPointers).length === 0) {\n                     setTimeout(() => { window.wasMultiTouch = false; }, 50);\n                 }\n             };\n         \n             const domElement = renderer.domElement;\n             domElement.addEventListener('pointerdown', onPointerDown);\n             domElement.addEventListener('pointermove', onPointerMove);\n             domElement.addEventListener('pointerup', onPointerUpOrCancel);\n             domElement.addEventListener('pointercancel', onPointerUpOrCancel);\n             domElement.addEventListener('pointerleave', onPointerUpOrCancel);\n         }\n         \n         function initThree() {\n             if (renderer) return;\n             scene = new THREE.Scene();\n             scene.background = new THREE.Color(0xDDDDDD); \n             \n             camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 1, 20000);\n    camera.position.set(0, 10, 80);\n    camera.rotation.order = 'YXZ';\n    camera.rotation.set(0.1, 0, 0);\n\n    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: \"high-performance\", logarithmicDepthBuffer: true });\n    renderer.setPixelRatio(window.devicePixelRatio);\n    renderer.setSize(window.innerWidth, window.innerHeight);\n    \n    renderer.toneMapping = THREE.ACESFilmicToneMapping;\n    renderer.toneMappingExposure = 1.6; \n    renderer.shadowMap.enabled = true;\n    renderer.shadowMap.type = THREE.PCFShadowMap;\n    document.getElementById('canvas-container').appendChild(renderer.domElement);\n\n    renderer.domElement.addEventListener('webglcontextlost', (event) => {\n        event.preventDefault();\n    }, false);\n\n    renderer.domElement.addEventListener('webglcontextrestored', () => {\n        scene.environment = null; \n        textureCache.forEach(tex => { if(tex) tex.needsUpdate = true; });\n        defaultControl.needsUpdate = true;\n        defaultTile.needsUpdate = true;\n        scene.traverse((child) => {\n            if (child.isMesh && child.material) child.material.needsUpdate = true;\n        });\n        setTimeout(() => { window.dispatchEvent(new Event('resize')); }, 100);\n    }, false);\n\n    clock = new Timer();\n    \n    if (!isTouchDevice) {\n        cameraTarget = new THREE.Object3D();\n        cameraTarget.position.copy(camera.position);\n\n        controls = new FlyControls(cameraTarget, renderer.domElement);\n        controls.movementSpeed = 100;\n        controls.rollSpeed = 0;\n        controls.autoForward = false;\n        controls.dragToLook = true;\n\n        const originalUpdate = controls.update.bind(controls);\n        controls.update = function(delta) {\n            if (window.isHeightLocked) {\n                const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');\n                cameraTarget.quaternion.setFromEuler(new THREE.Euler(0, euler.y, 0, 'YXZ'));\n            } else {\n                cameraTarget.quaternion.copy(camera.quaternion);\n            }\n            \n            if (window.isMiddlePanMode && window.middlePanOrigin && window.middlePanCurrent) {\n                const dx = window.middlePanCurrent.x - window.middlePanOrigin.x;\n                const dy = window.middlePanCurrent.y - window.middlePanOrigin.y;\n                \n                const dist = Math.sqrt(dx * dx + dy * dy);\n                if (dist > 5) {\n                    const speedMultiplier = (delta * controls.movementSpeed) / 100;\n                    cameraTarget.translateX(dx * speedMultiplier);\n                    cameraTarget.translateZ(dy * speedMultiplier); \n                }\n            }\n            \n            originalUpdate(delta);\n        };\n\n        window.addEventListener('keydown', (e) => {\n            if (e.key === 'Shift') controls.movementSpeed = 400;\n        });\n        window.addEventListener('keyup', (e) => {\n            if (e.key === 'Shift') controls.movementSpeed = 100;\n        });\n\n        setupMobileControls();\n    } else {\n        setupMobileControls();\n        setupMobileFullscreen();\n    }\n    scene.environment = null;\n    scene.environmentIntensity = 1.0; \n\n    hemiLight = new THREE.HemisphereLight(0xffffff, 0x777788, 1.5); \n    hemiLight.position.set(0, 1000, 0);\n    scene.add(hemiLight);\n    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7); \n    scene.add(ambientLight);\n\n    dirLight = new THREE.DirectionalLight(0xFFFAE6, 3.5);\n    dirLight.position.set(-800, 1500, -500);\n    dirLight.castShadow = true;\n    dirLight.shadow.mapSize.width = 4096;\n    dirLight.shadow.mapSize.height = 4096;\n    \n    const d = 800;\n    dirLight.shadow.camera.left = -d;\n    dirLight.shadow.camera.right = d;\n    dirLight.shadow.camera.top = d;\n    dirLight.shadow.camera.bottom = -d;\n    dirLight.shadow.camera.near = 100;\n    dirLight.shadow.camera.far = 10000; \n    \n    dirLight.shadow.bias = -0.00015;\n    dirLight.shadow.normalBias = 0.0;\n    \n    dirLight.shadow.blurSamples = 4;\n    dirLight.shadow.radius = 1;\n    scene.add(dirLight);\n\n    const pixelRatio = window.devicePixelRatio;\n    const renderTarget = new THREE.WebGLRenderTarget(\n        window.innerWidth * pixelRatio, \n        window.innerHeight * pixelRatio, \n        { samples: 8, type: THREE.HalfFloatType }\n    );\n    \n    composer = new EffectComposer(renderer, renderTarget);\n    composer.setPixelRatio(window.devicePixelRatio);\n    \n    const renderPass = new RenderPass(scene, camera);\n    composer.addPass(renderPass);\n    \n    const ssaoPass = new SSAOPass(scene, camera, window.innerWidth, window.innerHeight);\n    ssaoPass.kernelRadius = 16;\n    ssaoPass.minDistance = 0.001;    \n    ssaoPass.maxDistance = 0.1;\n    composer.addPass(ssaoPass);\n\n    const bloomPass = new UnrealBloomPass(\n        new THREE.Vector2(window.innerWidth, window.innerHeight),\n        0.35,\n        0.4,\n        0.85\n    );\n    composer.addPass(bloomPass);\n\n    const outputPass = new OutputPass();\n    composer.addPass(outputPass);\n\n    function onWindowResize() {\n        if(!camera || !renderer || !composer) return;\n        const width = window.innerWidth;\n        const height = window.innerHeight;\n        camera.aspect = width / height;\n        camera.updateProjectionMatrix();\n        renderer.setSize(width, height);\n        composer.setSize(width, height); \n    }\n    window.addEventListener('resize', onWindowResize);\n    onWindowResize();\n    initThumbnails();\n    animate();\n}\n         \n         function initThumbnails() {\n             thumbRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });\n             thumbRenderer.setSize(512, 512);\n             thumbRenderer.toneMapping = THREE.ACESFilmicToneMapping;\n             thumbRenderer.toneMappingExposure = 1.0; \n             thumbScene = new THREE.Scene();\n             thumbCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);\n             thumbCamera.position.set(0, 5, 12);\n             thumbCamera.lookAt(0, 0, 0);\n             function setupThumbEnv() {\n                 const pmremGenerator = new THREE.PMREMGenerator(thumbRenderer);\n                 pmremGenerator.compileEquirectangularShader();\n                 const environment = new RoomEnvironment();\n                 thumbScene.environment = pmremGenerator.fromScene(environment).texture;\n                 environment.dispose();\n             }\n             setupThumbEnv();\n             const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);\n             dirLight.position.set(5, 8, 8); \n             thumbScene.add(dirLight);\n             thumbRenderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); }, false);\n             thumbRenderer.domElement.addEventListener('webglcontextrestored', () => {\n                 thumbRenderer.setSize(512, 512);\n                 setupThumbEnv();\n                 if (defaultControl) defaultControl.needsUpdate = true;\n                 if (defaultTile) defaultTile.needsUpdate = true;\n                 textureCache.forEach(tex => { if(tex) tex.needsUpdate = true; });\n                 for (const item of thumbnailItems) {\n                     item.model.traverse((child) => {\n                         if (child.isMesh) {\n                             if (child.material) child.material.needsUpdate = true;\n                             if (child.geometry) {\n                                 for (const key in child.geometry.attributes) { child.geometry.attributes[key].needsUpdate = true; }\n                                 if (child.geometry.index) child.geometry.index.needsUpdate = true;\n                             }\n                         }\n                     });\n                 }\n             }, false);\n         }\n         \n         function animate() {\n             requestAnimationFrame(animate);\n    if (clock) clock.update();\n    const delta = Math.min(clock.getDelta(), 0.1); \n    \n    if (controls) {\n        controls.update(delta);\n        if (cameraTarget) {\n            camera.position.lerp(cameraTarget.position, 10 * delta);\n        }\n    }\n             \n    const uiContainer = document.getElementById('ui-container');\n             const propsView = document.getElementById('view-props');\n             if (uiContainer.style.transform !== 'translateX(100%)' && propsView.style.display !== 'none') {\n                 const listContainer = document.getElementById('prefab-list');\n                 const listRect = listContainer.getBoundingClientRect();\n                 for (const item of thumbnailItems) {\n                     item.model.rotation.y += delta * 1.5; \n                     const rect = item.element.getBoundingClientRect();\n                     if (rect.bottom > listRect.top && rect.top < listRect.bottom && rect.width > 0) {\n                         thumbScene.add(item.model);\n                         thumbRenderer.render(thumbScene, thumbCamera);\n                         thumbScene.remove(item.model);\n                         item.ctx.clearRect(0, 0, item.canvas.width, item.canvas.height);\n                         item.ctx.drawImage(thumbRenderer.domElement, 0, 0, item.canvas.width, item.canvas.height);\n                     }\n                 }\n             }\n             if (composer && scene && camera) {\n                 composer.render();\n             }\n         }\n         \n         function setupEditorGroup() {\n             if (!editorGroup) {\n                 const mapScale = 0.01; \n                 editorGroup = new THREE.Group();\n                 editorGroup.rotation.x = -Math.PI / 2;\n                 editorGroup.scale.set(mapScale, mapScale, mapScale);\n                 scene.add(editorGroup);\n             }\n         }\n         \n         async function loadTextureDirect(url, silent = false, isLinear = false, isRepeating = false) {\n             try {\n                 const res = await fetch(url);\n                 if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);\n                 const blob = await res.blob();\n                 const buffer = await blob.arrayBuffer();\n                 \n                 const fileName = url.substring(url.lastIndexOf('/') + 1);\n                 if (!window.rawFileCache.has(fileName)) {\n                     window.rawFileCache.set(fileName, buffer);\n                 }\n                 window.rawFileCache.set(url, buffer); \n                 \n                 const objUrl = URL.createObjectURL(blob);\n                 const loader = new THREE.TextureLoader();\n                 \n                 return new Promise((resolve) => {\n                     loader.load(objUrl, (tex) => {\n                         tex.colorSpace = isLinear ? THREE.LinearSRGBColorSpace : THREE.SRGBColorSpace;\n                         tex.flipY = false;\n                         if (isRepeating) {\n                             tex.wrapS = THREE.RepeatWrapping;\n                             tex.wrapT = THREE.RepeatWrapping;\n                         } else {\n                             tex.wrapS = THREE.ClampToEdgeWrapping;\n                             tex.wrapT = THREE.ClampToEdgeWrapping;\n                         }\n                         if (renderer) tex.anisotropy = renderer.capabilities.getMaxAnisotropy();\n                         resolve(tex);\n                     }, undefined, () => { resolve(null); });\n                 });\n             } catch(e) { return null; }\n         }\n         \n         window.loadedLibraries = new Set();\n         \n         async function getPropDict(mapData) {\n             if (!propDictCache) propDictCache = {};\n             if (window.currentLibraryUrl) {\n                 if (!window.loadedLibraries.has(window.currentLibraryUrl)) {\n                     try {\n                         const libJson = await fetchFile(window.currentLibraryUrl, 'json');\n                         for(const grp of libJson.groups) {\n                             for(const p of grp.props) {\n                                 if (p.mesh && p.mesh.file) {\n                                     propDictCache[`${window.currentLibraryUrl}_${grp.name}_${p.name}`] = p;\n                                     propDictCache[`${window.currentLibraryUrl}_${p.name}`] = p; \n                                 }\n                             }\n                         }\n                         window.loadedLibraries.add(window.currentLibraryUrl);\n                     } catch (e) {\n                         console.warn(\"Failed to load official library.json\", e);\n                     }\n                 }\n             }\n             return propDictCache;\n         }\n         \n         function addPrefabToUI(baseName, group) {\n             const item = document.createElement('div');\n             item.className = 'prefab-item';\n             const canvas = document.createElement('canvas');\n             canvas.width = 200;\n             canvas.height = 200;\n             canvas.style.width = '100%';\n             canvas.style.height = '100%';\n             canvas.style.position = 'absolute';\n             canvas.style.top = '0';\n             canvas.style.left = '0';\n             canvas.style.pointerEvents = 'none';\n             const ctx = canvas.getContext('2d', { willReadFrequently: true });\n             const label = document.createElement('span');\n             label.innerText = baseName;\n             label.title = baseName;\n             item.appendChild(canvas);\n             item.appendChild(label);\n             document.getElementById('prefab-list').appendChild(item);\n             \n             const thumbModel = group.clone();\n             thumbModel.updateMatrixWorld(true);\n             const box = new THREE.Box3().setFromObject(thumbModel, true);\n             const size = box.getSize(new THREE.Vector3());\n             const center = box.getCenter(new THREE.Vector3());\n             const maxDim = Math.max(size.x, size.y, size.z);\n             thumbModel.position.sub(center);\n             const rotationGroup = new THREE.Group();\n             rotationGroup.rotation.x = -Math.PI / 2;\n             rotationGroup.add(thumbModel);\n             const container = new THREE.Group();\n             container.add(rotationGroup);\n             const scale = 8 / (maxDim || 0.1);\n             container.scale.set(scale, scale, scale);\n             \n             thumbnailItems.push({ element: item, model: container, ctx, baseName, canvas });\n             \n             item.onclick = () => {\n                 document.querySelectorAll('.prefab-item').forEach(b => b.classList.remove('active'));\n                 item.classList.add('active');\n                 window.isGhostLockedToOriginal = false;\n                 window.selectPrefab(baseName);\n                 if (isTouchDevice) {\n                     isUIOpen = false;\n                     document.getElementById('ui-container').style.transform = 'translateX(100%)';\n                 }\n             };\n         }\n         \n         function addErrorToUI(fileName, errorMsg) {\n             const listContainer = document.getElementById('prefab-list');\n             const item = document.createElement('div');\n             item.className = 'prefab-item-error';\n             item.title = `File: ${fileName}\\nError: ${errorMsg}`; \n             item.innerHTML = `\n                 <span class=\"material-symbols-rounded icon\">broken_image</span>\n                 <div class=\"text-container\">\n                     <span class=\"err-title\">${fileName}</span>\n                     <span class=\"err-desc\" style=\"color: #ffb4a2; font-weight: bold;\">${errorMsg}</span>\n                 </div>\n             `;\n             listContainer.insertBefore(item, listContainer.firstChild);\n         }\n         \n         async function processMap(mapData, buildWorld = false, onProgress = null, lightmapData = null) {\n             const propDict = await getPropDict(mapData); \n             \n             const uniqueModelToLib = new Map(); \n             const uniqueTexToLib = new Map();\n             const repeatingTextures = new Set(); \n             \n             const getBaseUrl = (libName) => {\n                 return (libName && window.currentLibraryBaseUrl) ? window.currentLibraryBaseUrl : window.currentMapBaseUrl;\n             };\n         \n             for (const prop of mapData.props) {\n                 let pInfo = propDict[`${window.currentLibraryUrl}_${prop.grpName}_${prop.name}`] || propDict[`${window.currentLibraryUrl}_${prop.name}`];\n                 if (!pInfo) pInfo = propDict[`${prop.grpName}_${prop.name}`] || propDict[prop.name];\n                 const baseUrl = getBaseUrl(prop.libName);\n                 \n                 if (!prop.libName) {\n                     uniqueModelToLib.set(`${baseUrl}/models.a3d`, { file: 'models.a3d', baseUrl });\n                 } else {\n                     let file = (pInfo && pInfo.mesh && pInfo.mesh.file) ? pInfo.mesh.file : (prop.name + \".a3d\");\n                     uniqueModelToLib.set(`${baseUrl}/${file}`, { file, baseUrl });\n                 }\n                 if (pInfo && pInfo.textures) {\n                     for (let t of pInfo.textures) {\n                         if (t.diffuseMap) uniqueTexToLib.set(`${baseUrl}/${t.diffuseMap}`, { texName: t.diffuseMap, baseUrl });\n                     }\n                 }\n             }\n         \n             for (const mat of Object.values(mapData.materials)) {\n                 for (const param of mat.texParams) {\n                     const baseUrl = getBaseUrl(param.libName);\n                     uniqueTexToLib.set(`${baseUrl}/${param.texName}`, { texName: param.texName, baseUrl });\n                     if (param.name.startsWith('_Splat')) repeatingTextures.add(`${baseUrl}/${param.texName}`);\n                 }\n             }\n             if (mapData.atlases) {\n                 const baseUrl = window.currentMapBaseUrl;\n                 for (const atlasName of Object.keys(mapData.atlases)) {\n                     uniqueTexToLib.set(`${baseUrl}/${atlasName}`, { texName: atlasName, baseUrl });\n                 }\n             }\n             \n             const modelPromises = Array.from(uniqueModelToLib.entries()).map(async ([cacheKey, info]) => {\n                 if (!modelCache.has(cacheKey)) {\n                     try {\n                         if (info.file.toLowerCase().endsWith('.a3d')) {\n                             let a3dBuf;\n                             try { a3dBuf = await fetchFile(`${info.baseUrl}/${info.file}`); } \n                             catch (fetchErr) {\n                                 const lowerFile = info.file.toLowerCase();\n                                 if (info.file !== lowerFile) a3dBuf = await fetchFile(`${info.baseUrl}/${lowerFile}`);\n                                 else throw fetchErr; \n                             }\n                             const a3dData = parseA3D(a3dBuf);\n                             modelCache.set(cacheKey, a3dData); \n                         }\n                     } catch (e) { addErrorToUI(info.file, e.message); }\n                 }\n             });\n         \n             const texPromises = Array.from(uniqueTexToLib.entries()).map(async ([cacheKey, info]) => {\n                 if (!textureCache.has(cacheKey)) {\n                     const isControl = info.texName.includes('-control'); \n                     const isRepeat = repeatingTextures.has(cacheKey);\n                     let tex = await loadTextureDirect(`${info.baseUrl}/${info.texName}.webp`, true, isControl, isRepeat);\n                     if (!tex && info.baseUrl !== window.currentMapBaseUrl && window.currentMapBaseUrl) {\n                         tex = await loadTextureDirect(`${window.currentMapBaseUrl}/${info.texName}.webp`, true, isControl, isRepeat);\n                     }\n                     if (tex) textureCache.set(cacheKey, tex);\n                 }\n             });\n         \n             const lightmapPromises =[];\n             if (lightmapData && lightmapData.lightmaps) {\n                 lightmapData.lightmaps.forEach((lmName) => {\n                     const cacheKey = `${window.currentMapBaseUrl}/${lmName}`;\n                     if (!textureCache.has(cacheKey)) {\n                        const url = `${window.currentMapBaseUrl}/${lmName}.webp`;\n                        const promise = loadTextureDirect(url, true, true, false).then(tex => {\n                            if (tex) { tex.flipY = false; tex.channel = 1; textureCache.set(cacheKey, tex); }\n                        });\n                        lightmapPromises.push(promise);\n                     }\n                 });\n             }\n         \n             const allPromises =[...modelPromises, ...texPromises, ...lightmapPromises];\n             let completed = 0;\n             if (allPromises.length === 0 && onProgress) {\n                 onProgress(1);\n             } else if (allPromises.length > 0) {\n                 const wrappedPromises = allPromises.map(p => p.then(res => {\n                     completed++;\n                     if (onProgress) onProgress(completed / allPromises.length);\n                     return res;\n                 }));\n                 await Promise.all(wrappedPromises);\n             }\n         \n             const getTexFromCache = (texName, baseUrl) => {\n                 if (!texName) return null;\n                 let tex = textureCache.get(`${baseUrl}/${texName}`);\n                 if (!tex) tex = textureCache.get(`${window.currentMapBaseUrl}/${texName}`);\n                 if (!tex) {\n                     for (let[k, v] of textureCache.entries()) {\n                         if (k.endsWith('/' + texName) || k === `null/${texName}`) return v;\n                     }\n                 }\n                 return tex;\n             };\n         \n             if (buildWorld) {\n                 if (ghost) {\n                     editorGroup.remove(ghost);\n                     ghost = null;\n                     currentPrefabGroup = null;\n                     document.querySelector('.grid-floating-panel').style.display = 'none';\n                 }\n                 const toRemove =[];\n                 editorGroup.children.forEach(child => { \n                     if (!child.userData.isCollisionGroup) {\n                         toRemove.push(child); \n                     }\n                 });\n                 toRemove.forEach(c => editorGroup.remove(c));\n             }\n             \n             if (window.collisionGroup) {\n                 editorGroup.remove(window.collisionGroup);\n                 window.collisionGroup = null;\n             }\n             \n             window.collisionGroup = new THREE.Group();\n             window.collisionGroup.userData.isCollisionGroup = true;\n             const toggleBtn = document.getElementById('toggle-collision-btn');\n             window.collisionGroup.visible = toggleBtn && toggleBtn.classList.contains('active');\n             \n             const createCollisions = (colData, colorHex) => {\n                 if (!colData) return;\n                 const mat1 = new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.3, depthWrite: false });\n                 const mat2 = new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.3, depthWrite: false });\n                 const mat3 = new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide });\n\n                 if (colData.shapesType1) {\n                     colData.shapesType1.forEach(d => {\n                         const geo = new THREE.BoxGeometry(d[6], d[7], d[8]);\n                         const mesh = new THREE.Mesh(geo, mat1);\n                         mesh.position.set(d[0], d[1], d[2]);\n                         mesh.rotation.set(d[3], d[4], d[5], 'ZYX');\n                         window.collisionGroup.add(mesh);\n                     });\n                 }\n                 if (colData.shapesType2) {\n                     colData.shapesType2.forEach(d => {\n                         const length = d.f1;\n                         const width = d.f2;\n                         const thickness = 5;\n                         \n                         const geo = new THREE.BoxGeometry(width, length, thickness);\n                         \n                         const mesh = new THREE.Mesh(geo, mat2);\n                         mesh.position.set(d.data[0], d.data[1], d.data[2]);\n                         mesh.rotation.set(d.data[3], d.data[4], d.data[5], 'ZYX');\n                         window.collisionGroup.add(mesh);\n                     });\n                 }\n                 if (colData.shapesType3) {\n                     colData.shapesType3.forEach(d => {\n                         const geo = new THREE.BufferGeometry();\n                         const v = new Float32Array([\n                             d.data[6], d.data[7], d.data[8],\n                             d.data[9], d.data[10], d.data[11],\n                             d.data[12], d.data[13], d.data[14]\n                         ]);\n                         geo.setAttribute('position', new THREE.BufferAttribute(v, 3));\n                         const mesh = new THREE.Mesh(geo, mat3);\n                         mesh.position.set(d.data[0], d.data[1], d.data[2]);\n                         mesh.rotation.set(d.data[3], d.data[4], d.data[5], 'ZYX');\n                         window.collisionGroup.add(mesh);\n                     });\n                 }\n             };\n\n             createCollisions(mapData.collisionData1, 0xFF3333); \n             createCollisions(mapData.collisionData2, 0x33FF33); \n             \n             editorGroup.add(window.collisionGroup);\n             \n             let originalMapGroup = null;\n             let originalInstancesMap = new Map();\n             \n             if (buildWorld) {\n                 originalMapGroup = new THREE.Group();\n                 originalMapGroup.userData.isOriginalMapGroup = true;\n                 editorGroup.add(originalMapGroup);\n             }\n         \n             const materialCache = new Map();\n         \n             for (let i = 0; i < mapData.props.length; i++) {\n                 const prop = mapData.props[i];\n                 let baseName = getCleanBaseName(prop.name);\n                 \n                 let pInfo = propDict[`${window.currentLibraryUrl}_${prop.grpName}_${prop.name}`] || propDict[`${window.currentLibraryUrl}_${prop.name}`];\n                 if (!pInfo) pInfo = propDict[`${prop.grpName}_${prop.name}`] || propDict[prop.name];\n                 \n                 const file = (pInfo && pInfo.mesh && pInfo.mesh.file) ? pInfo.mesh.file : (prop.name + \".a3d\");\n                 const baseUrl = getBaseUrl(prop.libName);\n\n                 prop._pInfo = pInfo;\n                 prop._baseUrl = baseUrl;\n                 prop._file = file;\n                 \n                 let geometry = null;\n                 let a3dData = null;\n             \n                 let modelCacheKey = prop.libName ? `${baseUrl}/${file}` : `${baseUrl}/models.a3d`;\n                 a3dData = modelCache.get(modelCacheKey);\n         \n                 if (!a3dData) {\n                     let fallbackFile = prop.libName ? file : 'models.a3d';\n                     for (let [k, v] of modelCache.entries()) {\n                         if (k.endsWith('/' + fallbackFile) || k === fallbackFile || k === `null/${fallbackFile}`) {\n                             a3dData = v;\n                             break;\n                         }\n                     }\n                 }\n             \n                 if (a3dData) {\n                     if (!prop.libName) {\n                         if (a3dData.namedMeshes) {\n                             geometry = a3dData.namedMeshes[prop.name];\n                             if (!geometry) {\n                                 const matchedKey = Object.keys(a3dData.namedMeshes).find(k => k.toLowerCase() === prop.name.toLowerCase());\n                                 if (matchedKey) geometry = a3dData.namedMeshes[matchedKey];\n                             }\n                         }\n                     } else {\n                         if (a3dData.namedMeshes && Object.keys(a3dData.namedMeshes).length > 0) {\n                             geometry = Object.values(a3dData.namedMeshes)[0];\n                         } else if (a3dData.meshes && a3dData.meshes.length > 0) {\n                             geometry = a3dData.meshes[0];\n                         }\n                     }\n                 }\n             \n                 if (!geometry) continue;\n                 \n                 const matInfo = mapData.materials[prop.matID];\n         \n                 let controlTexName = null;\n                 let baseTexName = null;\n                 let splat0TexName = null, splat1TexName = null, splat2TexName = null, splat3TexName = null;\n                 let matBaseUrl = window.currentMapBaseUrl; \n\n                 if (matInfo && matInfo.texParams) {\n                     const pControl = matInfo.texParams.find(p => p.name === '_Control');\n                     if (pControl) controlTexName = pControl.texName;\n\n                     const pBase = matInfo.texParams.find(p => p.name === '_BaseMap' || p.name === '_MainTex');\n                     if (pBase) {\n                         baseTexName = pBase.texName;\n                         if (pBase.libName && window.currentLibraryBaseUrl) matBaseUrl = window.currentLibraryBaseUrl;\n                     }\n\n                     const pSplat0 = matInfo.texParams.find(p => p.name === '_Splat0');\n                     if (pSplat0) splat0TexName = pSplat0.texName;\n                     const pSplat1 = matInfo.texParams.find(p => p.name === '_Splat1');\n                     if (pSplat1) splat1TexName = pSplat1.texName;\n                     const pSplat2 = matInfo.texParams.find(p => p.name === '_Splat2');\n                     if (pSplat2) splat2TexName = pSplat2.texName;\n                     const pSplat3 = matInfo.texParams.find(p => p.name === '_Splat3');\n                     if (pSplat3) splat3TexName = pSplat3.texName;\n                 }\n         \n                 if (!baseTexName && pInfo && pInfo.textures && pInfo.textures.length > 0) {\n                     const fallbackTex = pInfo.textures.find(t => t.diffuseMap && !t.diffuseMap.includes('-control'));\n                     if (fallbackTex) {\n                         baseTexName = fallbackTex.diffuseMap;\n                         matBaseUrl = baseUrl;\n                     }\n                 }\n                 if (!controlTexName && pInfo && pInfo.textures && pInfo.textures.length > 0) {\n                     const fallbackCtrl = pInfo.textures.find(t => t.diffuseMap && t.diffuseMap.includes('-control'));\n                     if (fallbackCtrl) controlTexName = fallbackCtrl.diffuseMap;\n                 }\n                 \n                 prop._baseTexName = baseTexName;\n                 prop._controlTexName = controlTexName;\n                 prop._splat0TexName = splat0TexName; \n                 prop._splat1TexName = splat1TexName; \n                 prop._splat2TexName = splat2TexName; \n                 prop._splat3TexName = splat3TexName; \n         \n                 const instGeo = geometry.clone();\n                 instGeo.name = geometry.name || prop.name; \n                 \n                 let mat;\n                 const isTerrainMesh = file.toLowerCase().includes('terrain');\n                 const hasControlMap = !!controlTexName;\n         \n                 let targetTexName = baseTexName;\n                 let atlasRect = null;\n                 let atlasInfo = null;\n         \n                 let matName1 = null;\n                 let matName2 = null;\n                 if (a3dData && geometry && geometry.userData) {\n                     let matIds = geometry.userData.matIds;\n                     if (!matIds || matIds.length === 0) matIds = geometry.userData.v2MatIds;\n                     if (matIds && matIds.length > 0) {\n                         const mObj = a3dData.a3dMaterials ? a3dData.a3dMaterials[matIds[0]] : null;\n                         if (mObj) {\n                             matName1 = mObj.matName;\n                             matName2 = mObj.texName;\n                         }\n                     }\n                 }\n         \n                 const cleanStr = (s) => {\n                     if (!s) return null;\n                     let c = s.replace(/\\\\/g, '/').split('/').pop();\n                     if (c.indexOf('.') !== -1) c = c.substring(0, c.lastIndexOf('.'));\n                     return c;\n                 };\n                 matName1 = cleanStr(matName1);\n                 matName2 = cleanStr(matName2);\n         \n                 const exactKeys =[baseTexName, prop.name, baseName].filter(Boolean).map(s => s.toLowerCase());\n                 const fuzzyKeys =[matName1, matName2].filter(Boolean).map(s => s.toLowerCase());\n         \n                 if (mapData.atlases) {\n                     let found = false;\n                     for (const[aName, aInfo] of Object.entries(mapData.atlases)) {\n                         for (const [rectKey, rect] of Object.entries(aInfo.rects)) {\n                             const lowerKey = rect.originalName.toLowerCase();\n                             if (exactKeys.some(pk => lowerKey === pk || lowerKey === `_${pk}` || lowerKey.endsWith(`_${pk}`))) {\n                                 atlasRect = rect;\n                                 atlasInfo = aInfo;\n                                 targetTexName = aName; \n                                 found = true;\n                                 break;\n                             }\n                         }\n                         if (found) break;\n                         for (const[rectKey, rect] of Object.entries(aInfo.rects)) {\n                             const lowerKey = rect.originalName.toLowerCase();\n                             if (fuzzyKeys.some(pk => lowerKey === pk || lowerKey === `_${pk}`)) {\n                                 atlasRect = rect;\n                                 atlasInfo = aInfo;\n                                 targetTexName = aName; \n                                 found = true;\n                                 break;\n                             }\n                         }\n                         if (found) break;\n                     }\n                 }\n                 \n                 if (atlasRect) {\n                     prop._atlasRect = atlasRect;\n                     prop._atlasName = targetTexName;\n                     prop._atlasBaseUrl = window.currentMapBaseUrl;\n                 }\n         \n                 const matCacheKey = `${isTerrainMesh}_${controlTexName}_${targetTexName}_${prop.matID}_${prop.libName}_${prop.name}_${baseUrl}`;\n                 if (materialCache.has(matCacheKey)) {\n                     mat = materialCache.get(matCacheKey);\n                 } else {\n                     if (isTerrainMesh || hasControlMap) {\n                         let texR = null, texG = null, texB = null, texA = null;\n                         if (matInfo && matInfo.texParams) {\n                             const splat0 = matInfo.texParams.find(p => p.name === '_Splat0');\n                             const splat1 = matInfo.texParams.find(p => p.name === '_Splat1');\n                             const splat2 = matInfo.texParams.find(p => p.name === '_Splat2');\n                             const splat3 = matInfo.texParams.find(p => p.name === '_Splat3');\n                             \n                             if (splat0) texR = getTexFromCache(splat0.texName, matBaseUrl);\n                             if (splat1) texG = getTexFromCache(splat1.texName, matBaseUrl);\n                             if (splat2) texB = getTexFromCache(splat2.texName, matBaseUrl);\n                             if (splat3) texA = getTexFromCache(splat3.texName, matBaseUrl);\n                         }\n                         let tControl = getTexFromCache(controlTexName, matBaseUrl);\n                         const maxAniso = renderer.capabilities.getMaxAnisotropy();\n                         if (texR && texR.anisotropy !== maxAniso) texR.anisotropy = maxAniso;\n                         if (texG && texG.anisotropy !== maxAniso) texG.anisotropy = maxAniso;\n                         if (texB && texB.anisotropy !== maxAniso) texB.anisotropy = maxAniso;\n                         if (texA && texA.anisotropy !== maxAniso) texA.anisotropy = maxAniso;\n                                           \n                        const forceRepeat = (tex) => {\n                            if (tex && (tex.wrapS !== THREE.RepeatWrapping || tex.wrapT !== THREE.RepeatWrapping)) {\n                                tex.wrapS = THREE.RepeatWrapping;\n                                tex.wrapT = THREE.RepeatWrapping;\n                                tex.needsUpdate = true;\n                            }\n                        };\n                        forceRepeat(texR);\n                        forceRepeat(texG);\n                        forceRepeat(texB);\n                        forceRepeat(texA);\n                       \n         \n                         mat = new THREE.MeshStandardMaterial({\n                             roughness: 1.0,\n                             metalness: 0.0,\n                             side: THREE.DoubleSide\n                         });\n                         \n                          \n         \n                         let customUniforms = {\n                             tControl: { value: tControl || defaultControl },\n                             tR: { value: texR || defaultTile }, \n                             tG: { value: texG || defaultTile }, \n                             tB: { value: texB || defaultTile },\n                             tA: { value: texA || defaultTile },\n                             uHasSplat3: { value: !!texA }\n                         };\n         \n                         mat.onBeforeCompile = (shader) => {\n                             shader.uniforms.tControl = customUniforms.tControl;\n                             shader.uniforms.tR = customUniforms.tR;\n                             shader.uniforms.tG = customUniforms.tG;\n                             shader.uniforms.tB = customUniforms.tB;\n                             shader.uniforms.tA = customUniforms.tA;\n                             shader.uniforms.uHasSplat3 = customUniforms.uHasSplat3;\n         \n                             shader.vertexShader = `\n                                 varying vec2 vUvControl;\n                                 varying vec3 vLocalPos;\n                                 ${shader.vertexShader}\n                             `.replace(\n                                 `#include <uv_vertex>`,\n                                 `#include <uv_vertex>\n                                  vUvControl = uv;\n                                  vLocalPos = position;\n                                 `\n                             );\n         \n                             shader.fragmentShader = `\n                                 uniform sampler2D tControl;\n                                 uniform sampler2D tR;\n                                 uniform sampler2D tG;\n                                 uniform sampler2D tB;\n                                 uniform sampler2D tA;\n                                 uniform bool uHasSplat3;\n                                 varying vec2 vUvControl;\n                                 varying vec3 vLocalPos;\n                                 ${shader.fragmentShader}\n                             `.replace(\n                                 `#include <map_fragment>`,\n                                 `\n                                 vec4 control = texture2D(tControl, vUvControl);\n                                 float w1 = control.r;\n                                 float w2 = control.g;\n                                 float w3 = control.b;\n                                 float w4 = uHasSplat3 ? control.a : 0.0;\n                                 vec3 dx = dFdx(vLocalPos);\n                                 vec3 dy = dFdy(vLocalPos);\n                                 vec3 geoNormal = normalize(cross(dx, dy));\n                                 vec3 blendWeights = abs(geoNormal);\n                                 blendWeights = pow(blendWeights, vec3(8.0));\n                                 blendWeights /= dot(blendWeights, vec3(1.0));\n                                 float texScale = 1.0 / 500.0;\n                                 vec2 uvX = vec2(vLocalPos.y, vLocalPos.z) * texScale;\n                                 vec2 uvY = vec2(vLocalPos.x, vLocalPos.z) * texScale;\n                                 vec2 uvZ = vec2(vLocalPos.x, vLocalPos.y) * texScale;\n                                 vec4 colR = texture2D(tR, uvX) * blendWeights.x + texture2D(tR, uvY) * blendWeights.y + texture2D(tR, uvZ) * blendWeights.z;\n                                 vec4 colG = texture2D(tG, uvX) * blendWeights.x + texture2D(tG, uvY) * blendWeights.y + texture2D(tG, uvZ) * blendWeights.z;\n                                 vec4 colB = texture2D(tB, uvX) * blendWeights.x + texture2D(tB, uvY) * blendWeights.y + texture2D(tB, uvZ) * blendWeights.z;\n                                 vec4 colA = vec4(0.0);\n                                 if (uHasSplat3) {\n                                     colA = texture2D(tA, uvX) * blendWeights.x + texture2D(tA, uvY) * blendWeights.y + texture2D(tA, uvZ) * blendWeights.z;\n                                 }\n                                 vec4 splatColor = colR * w1 + colG * w2 + colB * w3 + colA * w4;\n                                 float sum = w1 + w2 + w3 + w4;\n                                 if (sum > 0.001) { splatColor = splatColor / sum; } else { discard; }\n                                 diffuseColor = vec4(splatColor.rgb, diffuseColor.a);\n                                 `\n                             );\n                         };\n                         mat.customProgramCacheKey = function() { return \"terrain_\" + matCacheKey; };\n                     } else {\n                         mat = new THREE.MeshStandardMaterial({ \n                             color: 0xffffff, roughness: 1.0, metalness: 0.0,\n                             side: THREE.DoubleSide, transparent: false, alphaTest: 0.5, depthWrite: true\n                         });\n                         \n                         if (targetTexName) {\n                             const diffTex = getTexFromCache(targetTexName, matBaseUrl);\n                             if (diffTex) mat.map = diffTex;\n                             else { mat.color.setHex(0xaaaaaa); mat.map = defaultTile; }\n                         } else {\n                             mat.color.setHex(0xaaaaaa); mat.map = defaultTile;\n                         }\n                     }\n                     materialCache.set(matCacheKey, mat);\n                 }\n         \n                 if (instGeo.attributes.uv && atlasRect && atlasInfo) {\n                     const uv = instGeo.attributes.uv.clone();\n                     let sx = atlasRect.w / atlasInfo.width;\n                     let sy = atlasRect.h / atlasInfo.height;\n                     let ox = atlasRect.x / atlasInfo.width;\n                     let oy = atlasRect.y / atlasInfo.height;\n                     for(let u=0; u<uv.array.length; u+=2) {\n                         uv.array[u] = uv.array[u] * sx + ox;\n                         uv.array[u+1] = uv.array[u+1] * sy + oy;\n                     }\n                     instGeo.setAttribute('uv', uv);\n                 }\n         \n        const nameLower = prop.name.toLowerCase();\n        const fileLower = file ? file.toLowerCase() : \"\";\n        const isMountOrLandscape = nameLower.includes('mount') || fileLower.includes('mount') || \n                                   nameLower.includes('landscape') || fileLower.includes('landscape') || \n                                   nameLower.includes('bd_in_ring') || fileLower.includes('bd_in_ring') || \n                                   nameLower.includes('bd_out_ring') || fileLower.includes('bd_out_ring');\n\n        const prefabMesh = new THREE.Mesh(instGeo, mat);\n      \n        prefabMesh.castShadow = !isMountOrLandscape; \n        prefabMesh.receiveShadow = !isMountOrLandscape; \n        prefabMesh.scale.set(prop.scale[0], prop.scale[1], prop.scale[2]);\n        \n        if (buildWorld && originalMapGroup) {\n           \n            let instanceKey;\n            if (prop.grpName && prop.grpName.trim() !== \"\") {\n                instanceKey = `${baseName}_grp_${prop.grpName}`;\n            } else {\n                let snap = 1;\n                const px = Math.round(prop.pos[0] / snap) * snap;\n                const py = Math.round(prop.pos[1] / snap) * snap;\n                const pz = Math.round(prop.pos[2] / snap) * snap;\n                instanceKey = `${baseName}_${px}_${py}_${pz}`;\n            }\n            if (!originalInstancesMap.has(instanceKey)) {\n                const grp = new THREE.Group();\n                grp.position.set(prop.pos[0], prop.pos[1], prop.pos[2]);\n                grp.rotation.set(prop.rot[0], prop.rot[1], prop.rot[2], 'ZYX');\n                grp.userData.baseName = baseName;\n                grp.userData.originalProps =[];\n                originalInstancesMap.set(instanceKey, grp);\n            }\n            const instanceGroup = originalInstancesMap.get(instanceKey);\n            instanceGroup.userData.originalProps.push(prop);\n            \n            const sceneMesh = prefabMesh.clone();\n            \n            if (isMountOrLandscape) {\n                sceneMesh.castShadow = false;\n                sceneMesh.receiveShadow = false;\n            }\n\n            const rootMatrix = new THREE.Matrix4().compose(\n                instanceGroup.position, instanceGroup.quaternion, new THREE.Vector3(1, 1, 1)\n            );\n            const propMatrix = new THREE.Matrix4().compose(\n                new THREE.Vector3(prop.pos[0], prop.pos[1], prop.pos[2]),\n                new THREE.Quaternion().setFromEuler(new THREE.Euler(prop.rot[0], prop.rot[1], prop.rot[2], 'ZYX')),\n                new THREE.Vector3(1, 1, 1)\n            );\n            const localMatrix = propMatrix.premultiply(rootMatrix.invert());\n            localMatrix.decompose(sceneMesh.position, sceneMesh.quaternion, new THREE.Vector3());\n            instanceGroup.add(sceneMesh);\n        }\n         \n                 if (!globalLoadedProps.has(prop.name)) {\n                     if (!prefabs.has(baseName)) {\n                         const group = new THREE.Group();\n                         group.userData.originalProps =[];\n                         group.userData.rootPos = new THREE.Vector3(prop.pos[0], prop.pos[1], prop.pos[2]);\n                         group.userData.rootRot = new THREE.Euler(prop.rot[0], prop.rot[1], prop.rot[2], 'ZYX');\n                         prefabs.set(baseName, group);\n                     }\n                     const group = prefabs.get(baseName);\n                     const currentPos = new THREE.Vector3(prop.pos[0], prop.pos[1], prop.pos[2]);\n                     const dist = group.userData.rootPos.distanceTo(currentPos);\n                     if (dist < 3000) {\n                         globalLoadedProps.add(prop.name);\n                         group.userData.originalProps.push(prop);\n                         const rootMatrix = new THREE.Matrix4().compose(\n                             group.userData.rootPos, new THREE.Quaternion().setFromEuler(group.userData.rootRot), new THREE.Vector3(1, 1, 1)\n                         );\n                         const propMatrix = new THREE.Matrix4().compose(\n                             currentPos, new THREE.Quaternion().setFromEuler(new THREE.Euler(prop.rot[0], prop.rot[1], prop.rot[2], 'ZYX')), new THREE.Vector3(1, 1, 1)\n                         );\n                         const localMatrix = propMatrix.premultiply(rootMatrix.invert());\n                         const localPos = new THREE.Vector3();\n                         const localQuat = new THREE.Quaternion();\n                         localMatrix.decompose(localPos, localQuat, new THREE.Vector3());\n                         prefabMesh.position.copy(localPos);\n                         prefabMesh.quaternion.copy(localQuat);\n                         group.add(prefabMesh);\n                     }\n                 }\n             }\n             if (buildWorld && originalMapGroup) {\n                 for (const grp of originalInstancesMap.values()) originalMapGroup.add(grp);\n             }\n             const sortedBaseNames = Array.from(prefabs.keys()).sort();\n            sortedBaseNames.forEach(baseName => {\n                if (!thumbnailItems.find(t => t.baseName === baseName)) addPrefabToUI(baseName, prefabs.get(baseName));\n            });\n            updatePropsCountBadge(mapData.props);\n        }\n         \n         async function renderMapList() {\n             const list = document.getElementById('map-list');\n             list.innerHTML = `\n                 <div style=\"padding: 24px; text-align: center; color: var(--md-sys-color-on-surface-variant); display: flex; flex-direction: column; align-items: center; gap: 8px;\">\n                     <span class=\"material-symbols-rounded\" style=\"animation: spin 2s linear infinite;\">sync</span>\n                     <span style=\"font-size: 14px;\">Fetching maps from external config...</span>\n                     <style>@keyframes spin { 100% { transform: rotate(360deg); } }</style>\n                 </div>\n             `;\n             try {\n                 const response = await fetch(EXTERNAL_MAPS_JSON_URL);\n                 if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);\n                 const data = await response.json();\n                 list.innerHTML = '';\n                 data.forEach(category => {\n                     category.subgroups.forEach(subgroup => {\n                         const subTitle = document.createElement('div');\n                         subTitle.style.padding = '12px 12px 6px 12px';\n                         subTitle.style.fontSize = '12px';\n                         subTitle.style.color = 'var(--md-sys-color-tertiary)';\n                         subTitle.style.fontWeight = '500';\n                         subTitle.innerText = subgroup.name;\n                         list.appendChild(subTitle);\n                         subgroup.maps.forEach(map => {\n                             const item = document.createElement('div');\n                             item.className = 'map-item';\n                             item.innerHTML = `\n                                 <span class=\"map-item-title\">${map.name}</span>\n                                 <div class=\"progress-container\" style=\"display:none; position: absolute; right: 16px; top: 50%; transform: translateY(-50%);\">\n                                     <div class=\"circular-progress\"><span class=\"circular-progress-text\">0%</span></div>\n                                 </div>\n                             `;\n                             item.onclick = () => loadMapLibrary(map.name, map.url, item, category.libraryJsonUrl);\n                             list.appendChild(item);\n                         });\n                     });\n                 });\n             } catch (error) {\n                 list.innerHTML = `\n                     <div style=\"padding: 16px; text-align: center; background: rgba(255,102,102,0.1); border: 1px solid var(--md-sys-color-error); border-radius: 12px; margin: 0 12px;\">\n                         <span class=\"material-symbols-rounded\" style=\"color: var(--md-sys-color-error); margin-bottom: 8px; font-size: 32px;\">wifi_off</span>\n                         <div style=\"color: var(--md-sys-color-error); font-size: 13px; font-weight: 500;\">Failed to fetch external maps.json</div>\n                     </div>\n                 `;\n             }\n         }\n         \n         function resetEditorState() {\n             document.getElementById('prefab-list').innerHTML = '';\n             prefabs.clear();\n             thumbnailItems.length = 0;\n             textureCache.clear();\n             modelCache.clear();\n             propDictCache = null;\n             window.loadedLibraries.clear();\n            globalLoadedProps.clear();\n            clearSceneOnly();\n            updatePropsCountBadge([]);\n         }\n         \n         function clearSceneOnly() {\n             if (ghost) {\n                 editorGroup.remove(ghost);\n                 ghost = null;\n                 currentPrefabGroup = null;\n                 document.querySelector('.grid-floating-panel').style.display = 'none';\n             }\n             const toRemove =[];\n             for (let i = 0; i < editorGroup.children.length; i++) {\n                 let child = editorGroup.children[i];\n                 if (!child.userData.isCollisionGroup) {\n                     toRemove.push(child);\n                 }\n             }\n             toRemove.forEach(c => editorGroup.remove(c));\n         }\n         \n         async function loadMapLibrary(mapName, mapUrl, itemElement, libraryJsonUrl) {\n             if (IS_USERSCRIPT_HOST) {\n                 showToast('Same-map mode: cannot switch libraries', true);\n                 return;\n             }\n             if (itemElement && itemElement.classList.contains('loading')) return;\n             document.getElementById('prefab-list').innerHTML = '';\n             thumbnailItems.length = 0;\n             prefabs.clear();\n             globalLoadedProps.clear();\n             \n             if (itemElement) {\n                 itemElement.classList.add('loading');\n                 const progContainer = itemElement.querySelector('.progress-container');\n                 const progCirc = itemElement.querySelector('.circular-progress');\n                 const progText = itemElement.querySelector('.circular-progress-text');\n                 if(progContainer) progContainer.style.display = 'block';\n                 var updateUI = (percent) => {\n                     const p = Math.floor(percent * 100);\n                     if(progCirc) progCirc.style.background = `conic-gradient(var(--md-sys-color-primary) ${p}%, transparent ${p}%)`;\n                     if(progText) progText.innerText = `${p}%`;\n                 };\n                 updateUI(0);\n             } else {\n                 var updateUI = () => {};\n             }\n         \n             try {\n                 window.currentLibraryUrl = libraryJsonUrl || null;\n                 window.currentLibraryBaseUrl = window.currentLibraryUrl ? window.currentLibraryUrl.substring(0, window.currentLibraryUrl.lastIndexOf('/')) : null;\n                 const baseUrl = mapUrl.substring(0, mapUrl.lastIndexOf('/'));\n                 window.currentMapBaseUrl = baseUrl;\n         \n                 const mapBuf = await fetchWithProgress(mapUrl, (p) => updateUI(p * 0.15));\n                const mapData = await parseMapBin(mapBuf);\n                window.defaultMapProps = clonePropsArray(mapData.props);\n                window.originalMapData = { ...mapData, props: clonePropsArray(mapData.props) };\n                window.currentEditorProps = clonePropsArray(mapData.props);\n                window.currentMapData = mapData;\n            updateCollisionButtonVisibility();\n         \n                 let lightmapData = null;\n                 try {\n                     const lmBuf = await fetchFile(`${baseUrl}/lightmapdata`);\n                     lightmapData = parseLightmapData(lmBuf);\n                 } catch (e) { console.warn(\"No lightmapdata found\"); }\n               \n                 applyLightmapData(lightmapData);\n                 \n                 window.currentLightmapData = lightmapData;\n         \n                 await processMap(mapData, false, (p) => updateUI(0.15 + p * 0.85), lightmapData);\n                 updateUI(1);\n         \n                 setTimeout(() => {\n                     document.getElementById('view-maps').style.display = 'none';\n                     document.getElementById('view-props').style.display = 'flex';\n                     if (itemElement) {\n                         itemElement.classList.remove('loading');\n                         const progContainer = itemElement.querySelector('.progress-container');\n                         if(progContainer) progContainer.style.display = 'none';\n                     }\n                 }, 400);\n             } catch (e) {\n                 console.error(e);\n                 showToast(`Failed to load ${mapName}`);\n                 if (itemElement) {\n                     itemElement.classList.remove('loading');\n                     const progContainer = itemElement.querySelector('.progress-container');\n                     if(progContainer) progContainer.style.display = 'none';\n                 }\n             }\n         }\n         \n         async function loadFromBoot(boot) {\n             const mapList = document.getElementById('map-list');\n             if (mapList) {\n                 mapList.innerHTML = `<div style=\"padding:16px;font-size:13px;color:var(--md-sys-color-on-surface-variant);line-height:1.5;\">\n                     <div style=\"color:var(--md-sys-color-primary);font-weight:600;margin-bottom:6px;\">${boot.mapName || ''} · ${boot.themeName || ''}</div>\n                  </div>`;\n             }\n             // Optional library\n             window.currentLibraryUrl = boot.libraryJsonUrl || null;\n             window.currentLibraryBaseUrl = boot.libraryBaseUrl || null;\n             window.currentMapBaseUrl = boot.mapBaseUrl;\n\n             showToast('Loading map…', false);\n             const mapUrl = boot.mapBinUrl || (boot.mapBaseUrl.replace(/\\/$/, '') + '/map.bin');\n             const mapBuf = await fetchWithProgress(mapUrl, () => {});\n             let mapData = await parseMapBin(mapBuf);\n\n            // Always keep pristine original props for same-map validation + meta stats\n            window.defaultMapProps = clonePropsArray(mapData.props);\n            window.originalMapData = { ...mapData, props: clonePropsArray(mapData.props) };\n\n             // If host already applied saved propEdits into boot.props, rebuild props list for editing\n             if (Array.isArray(boot.props) && boot.useBootProps) {\n                 mapData.props = boot.props.map((p, i) => ({\n                     id: typeof p.id === 'number' ? p.id : i,\n                     grpName: p.grpName || '',\n                     libName: p.libName || '',\n                     matID: p.matID,\n                     name: p.name,\n                     pos: [...p.pos],\n                     rot: p.rot ? [...p.rot] : [0,0,0],\n                     scale: p.scale ? [...p.scale] : [1,1,1]\n                 }));\n             }\n\n             window.currentEditorProps = clonePropsArray(mapData.props);\n             window.currentMapData = mapData;\n             updateCollisionButtonVisibility();\n\n             let lightmapData = null;\n             try {\n                 const lmBuf = await fetchFile(`${boot.mapBaseUrl.replace(/\\/$/, '')}/lightmapdata`);\n                 lightmapData = parseLightmapData(lmBuf);\n             } catch (e) { console.warn('No lightmapdata found'); }\n             applyLightmapData(lightmapData);\n             window.currentLightmapData = lightmapData;\n\n             // Build prefabs first\n             await processMap(window.originalMapData, false, null, lightmapData);\n             // Then load original layout into the scene for editing\n            await processMap(mapData, true, null, lightmapData);\n            updatePropsCountBadge(window.currentEditorProps || mapData.props);\n\n            // Frame camera like load-original\n             if (editorGroup) {\n                 editorGroup.updateMatrixWorld(true);\n                 const box = new THREE.Box3().setFromObject(editorGroup, true);\n                 if (!box.isEmpty() && box.min.x !== Infinity) {\n                     const center = box.getCenter(new THREE.Vector3());\n                     const size = box.getSize(new THREE.Vector3());\n                     const maxDim = Math.max(size.x, size.z);\n                     const fov = camera.fov * (Math.PI / 180);\n                     let cameraDistance = Math.abs(maxDim / 2 / Math.tan(fov / 2));\n                     cameraDistance = Math.max(cameraDistance, 50) * 1.2;\n                     camera.position.set(center.x, center.y + cameraDistance * 0.6, center.z + cameraDistance);\n                     camera.lookAt(center);\n                     if (typeof cameraTarget !== 'undefined' && cameraTarget) {\n                         cameraTarget.position.copy(camera.position);\n                     }\n                 }\n             }\n\n             document.getElementById('view-maps').style.display = 'none';\n             document.getElementById('view-props').style.display = 'flex';\n             showToast('Map loaded', false);\n         }\n\n         function collectScenePropsForApply() {\n             const propsToWrite = [];\n             let globalIdCounter = 0;\n\n             let originalMapGrp = editorGroup.children.find(c => c.userData.isOriginalMapGroup);\n             if (originalMapGrp) {\n                 for (const child of originalMapGrp.children) {\n                     if (child.userData.originalProps && child.userData.originalProps.length > 0) {\n                         let meshIdx = 0;\n                         for (const origProp of child.userData.originalProps) {\n                             const mesh = child.children[meshIdx++];\n                             if (!mesh) continue;\n                             const partMatrix = new THREE.Matrix4().multiplyMatrices(child.matrixWorld, mesh.matrix);\n                             const rawMatrix = partMatrix.premultiply(editorGroup.matrixWorld.clone().invert());\n                             const pos = new THREE.Vector3(); const quat = new THREE.Quaternion(); const scl = new THREE.Vector3();\n                             rawMatrix.decompose(pos, quat, scl);\n                             const euler = new THREE.Euler().setFromQuaternion(quat, 'ZYX');\n                             propsToWrite.push({\n                                 id: globalIdCounter,\n                                 grpName: origProp.grpName || '',\n                                 libName: origProp.libName || '',\n                                 matID: origProp.matID,\n                                 name: origProp.name,\n                                 pos: [pos.x, pos.y, pos.z],\n                                 rot: [euler.x, euler.y, euler.z],\n                                 scale: [scl.x, scl.y, scl.z]\n                             });\n                             globalIdCounter++;\n                         }\n                     }\n                 }\n             }\n\n             let instanceIndex = 1;\n             for (const child of editorGroup.children) {\n                 if (child === ghost || child.userData.isOriginalMapGroup || child.userData.isCollisionGroup) continue;\n                 if (child.userData.originalProps) {\n                     let meshIdx = 0;\n                     for (const origProp of child.userData.originalProps) {\n                         const mesh = child.children[meshIdx++];\n                         if (!mesh) continue;\n                         const partMatrix = new THREE.Matrix4().multiplyMatrices(child.matrixWorld, mesh.matrix);\n                         const rawMatrix = partMatrix.premultiply(editorGroup.matrixWorld.clone().invert());\n                         const pos = new THREE.Vector3(); const quat = new THREE.Quaternion(); const scl = new THREE.Vector3();\n                         rawMatrix.decompose(pos, quat, scl);\n                         const euler = new THREE.Euler().setFromQuaternion(quat, 'ZYX');\n                         let outGrpName = origProp.grpName;\n                         if (outGrpName && outGrpName !== '') outGrpName = outGrpName + '_inst' + instanceIndex;\n                         propsToWrite.push({\n                             id: globalIdCounter,\n                             grpName: outGrpName || '',\n                             libName: origProp.libName || '',\n                             matID: origProp.matID,\n                             name: origProp.name,\n                             pos: [pos.x, pos.y, pos.z],\n                             rot: [euler.x, euler.y, euler.z],\n                             scale: [scl.x, scl.y, scl.z]\n                         });\n                         globalIdCounter++;\n                     }\n                     instanceIndex++;\n                 }\n             }\n             // Note: caller/host performs safe merge against defaultMapProps.\n             // Scene list may be incomplete; do not invent placeholders here.\n             return propsToWrite;\n         }\n\n         function computePropMeta(originalProps, outProps) {\n             const getBase = n => n.replace(/[-_]sub[-_]?\\d+$/i, '');\n             const origMap = new Map();\n             for (const p of originalProps) {\n                 const b = getBase(p.name);\n                 const key = p.grpName ? b + '_' + p.grpName : b + '_' + Math.round(p.pos[0]) + '_' + Math.round(p.pos[1]) + '_' + Math.round(p.pos[2]);\n                 if (!origMap.has(key)) origMap.set(key, p);\n             }\n             const editMap = new Map();\n             for (const p of outProps) {\n                 const b = getBase(p.name);\n                 const key = p.grpName ? b + '_' + p.grpName : b + '_' + Math.round(p.pos[0]) + '_' + Math.round(p.pos[1]) + '_' + Math.round(p.pos[2]);\n                 if (!editMap.has(key)) editMap.set(key, p);\n             }\n             const origVals = Array.from(origMap.values());\n             const editVals = Array.from(editMap.values());\n             const usedEdit = new Set();\n             let moved = 0, matched = 0;\n             const nearly = (a, b) => Math.abs(a - b) < 1;\n             const sameXform = (a, b) => nearly(a.pos[0], b.pos[0]) && nearly(a.pos[1], b.pos[1]) && nearly(a.pos[2], b.pos[2]);\n             for (const o of origVals) {\n                 let found = -1;\n                 for (let i = 0; i < editVals.length; i++) {\n                     if (usedEdit.has(i)) continue;\n                     const e = editVals[i];\n                     if (getBase(e.name) === getBase(o.name)) {\n                         if (sameXform(e, o)) { found = i; break; }\n                         if (found < 0) found = i;\n                     }\n                 }\n                 if (found >= 0) {\n                     usedEdit.add(found);\n                     matched++;\n                     if (!sameXform(editVals[found], o)) moved++;\n                 }\n             }\n             return {\n                 deleted: origVals.length - matched,\n                 moved,\n                 added: editVals.length - matched,\n                 total: editVals.length\n             };\n         }\n\n         function applyEditsToHost() {\n             if (!IS_USERSCRIPT_HOST) return;\n             try {\n                 const sceneProps = collectScenePropsForApply();\n                 const original = window.defaultMapProps || [];\n                 const allowed = new Set(original.map(p => p.name));\n                 const filtered = sceneProps.filter(p => allowed.has(p.name));\n                 if (filtered.length !== sceneProps.length) {\n                     showToast('Skipped cross-map props', true);\n                 }\n\n                 // IMPORTANT: editor scene is often incomplete (terrain/no-geometry props\n                 // never enter originalMapGroup). Do NOT claim a full-scene replace.\n                 // Host merge will update matched + append adds, and keep missing originals.\n                 const meta = computePropMeta(original, filtered);\n                 meta.allowDelete = true;\n                 meta.exportIncomplete = false;\n\n                 parent.postMessage({\n                     type: 'map-editor-apply',\n                     mapName: BOOT.mapName,\n                     themeName: BOOT.themeName,\n                     propEdits: { props: filtered, meta }\n                 }, '*');\n                 showToast(\n                     meta.exportIncomplete\n                         ? 'Applied (safe merge: originals kept if missing from scene)'\n                         : 'Applied object edits',\n                     false\n                 );\n             } catch (err) {\n                 console.error(err);\n                 showToast('Apply failed: ' + err.message, true);\n             }\n         }\n\n         async function loadMain() {\n             try {\n                 initThree();\n                 setupEditorGroup();\n                 if (IS_USERSCRIPT_HOST) {\n                     // Keep map list UI shell but auto-load current map\n                     await loadFromBoot(BOOT);\n                 } else {\n                     await renderMapList();\n                 }\n                 setupUIEvents();\n\n                 if (IS_USERSCRIPT_HOST) {\n                    const title = document.querySelector('.m3-title');\n                    if (title) title.textContent = BOOT?.i18n?.editorTitle || 'Map Editor';\n\n                    const importBtn = document.getElementById('import-btn');\n                    if (importBtn) {\n                        importBtn.title = HOST_UI.uploadMapBin;\n                        importBtn.querySelector('span').innerText = 'upload';\n                    }\n\n                    const exportBtn = document.getElementById('export-btn');\n                    if (exportBtn) {\n                        exportBtn.title = HOST_UI.exportMapBin;\n                        exportBtn.querySelector('span').innerText = 'download';\n                    }\n\n                    const clearBtn = document.getElementById('clear-btn');\n                    const applyBtn = document.getElementById('load-original-btn');\n\n                    if (clearBtn && applyBtn) {\n                        clearBtn.title = HOST_UI.closeEditor;\n                        clearBtn.className = 'm3-btn m3-btn-error'; \n                        clearBtn.style.backgroundColor = 'rgba(255, 102, 102, 0.15)';\n                        clearBtn.style.border = '1px solid #FF6666';\n                        clearBtn.style.color = '#FF6666';\n                        clearBtn.querySelector('span').innerText = 'close';\n\n                        applyBtn.title = HOST_UI.applyEdits;\n                        applyBtn.className = 'm3-btn m3-btn-primary';\n                        applyBtn.style.backgroundColor = 'rgba(118, 255, 51, 0.15)';\n                        applyBtn.style.border = '1px solid #76FF33';\n                        applyBtn.style.color = '#76FF33';\n                        applyBtn.querySelector('span').innerText = 'check';\n\n                        const btnContainer = clearBtn.parentElement;\n                        applyBtn.style.flex = 'none';\n                        applyBtn.style.width = '48px';\n                        applyBtn.style.height = 'auto';\n                        applyBtn.style.padding = '12px 0';\n                        applyBtn.style.borderRadius = '12px';\n                        \n                        btnContainer.insertBefore(applyBtn, clearBtn); \n                    }\n\n                    const propsHeader = document.getElementById('props-header');\n                    if (propsHeader) propsHeader.style.display = 'none';\n                    const prefabList = document.getElementById('prefab-list');\n                    if (prefabList) prefabList.style.paddingTop = '12px';\n\n                    const backBtn = document.getElementById('back-to-maps-btn');\n                    if (backBtn) backBtn.style.display = 'none';\n\n                    const fileInput = document.getElementById('file-input');\n                    if (fileInput) fileInput.accept = '.bin';\n\n                    updatePropsCountBadge(window.currentEditorProps || window.defaultMapProps || []);\n                }\n             } catch (e) { console.error(\"Fatal initialization error:\", e); }\n         }\n         \n         document.addEventListener('visibilitychange', () => {\n    if (document.hidden) {\n    } else {\n        setTimeout(() => {\n                     window.dispatchEvent(new Event('resize'));\n                     if (thumbnailItems && thumbnailItems.length > 0) {\n                         for (const item of thumbnailItems) {\n                             item.model.traverse((child) => {\n                                 if (child.isMesh && child.material) child.material.needsUpdate = true;\n                             });\n                         }\n                     }\n                 }, 200);\n             }\n         });\n         \n        function getDecimalPrefix(url) {\n            if (!url) return 'common';\n            let folder = url.split('/').pop();\n            if (folder === 'null' || !folder) return 'common';\n            \n            if (/^[0-7]+$/.test(folder)) {\n                try {\n                    return BigInt(\"0o\" + folder).toString(10);\n                } catch(e) {\n                    return folder;\n                }\n            }\n            return folder;\n        }\n        \n         async function generateMapBin() {\n             const propsToWrite =[];\n             let idMapping = new Map();\n             let globalIdCounter = 0; \n           \n             let originalMapGrp = editorGroup.children.find(c => c.userData.isOriginalMapGroup);\n             if (originalMapGrp) {\n                 for (const child of originalMapGrp.children) {\n                     if (child.userData.originalProps && child.userData.originalProps.length > 0) {\n                         let meshIdx = 0;\n                         for (const origProp of child.userData.originalProps) {\n                             const mesh = child.children[meshIdx++];\n                             const partMatrix = new THREE.Matrix4().multiplyMatrices(child.matrixWorld, mesh.matrix);\n                             const rawMatrix = partMatrix.premultiply(editorGroup.matrixWorld.clone().invert());\n                             const pos = new THREE.Vector3(); const quat = new THREE.Quaternion(); const scl = new THREE.Vector3();\n                             rawMatrix.decompose(pos, quat, scl);\n                             const euler = new THREE.Euler().setFromQuaternion(quat, 'ZYX');\n                             propsToWrite.push({\n                                 ...origProp,\n                                 id: globalIdCounter,\n                                 pos:[pos.x, pos.y, pos.z],\n                                 rot:[euler.x, euler.y, euler.z],\n                                 scale:[scl.x, scl.y, scl.z]\n                             });\n                             idMapping.set(origProp.id, globalIdCounter);\n                             globalIdCounter++;\n                         }\n                     }\n                 }\n             }\n         \n             let instanceIndex = 1;\n             for (const child of editorGroup.children) {\n                 if (child === ghost || child.userData.isOriginalMapGroup || child.userData.isCollisionGroup) continue;  \n                 if (child.userData.originalProps) {\n                     let meshIdx = 0;\n                     for (const origProp of child.userData.originalProps) {\n                         const mesh = child.children[meshIdx++];\n                         const partMatrix = new THREE.Matrix4().multiplyMatrices(child.matrixWorld, mesh.matrix);\n                         const rawMatrix = partMatrix.premultiply(editorGroup.matrixWorld.clone().invert());\n                         const pos = new THREE.Vector3(); const quat = new THREE.Quaternion(); const scl = new THREE.Vector3();\n                         rawMatrix.decompose(pos, quat, scl);\n                         const euler = new THREE.Euler().setFromQuaternion(quat, 'ZYX');\n                         let outGrpName = origProp.grpName;\n                         if (outGrpName && outGrpName !== \"\") outGrpName = outGrpName + \"_inst\" + instanceIndex;\n                         propsToWrite.push({\n                            ...origProp,\n                            grpName: outGrpName,\n                            id: globalIdCounter,\n                            pos:[pos.x, pos.y, pos.z],\n                            rot:[euler.x, euler.y, euler.z],\n                            scale:[scl.x, scl.y, scl.z]\n                         });\n                         idMapping.set(origProp.id, globalIdCounter);\n                         globalIdCounter++;\n                     }\n                     instanceIndex++;\n                 }\n             }\n             \n             window.dynamicAtlasesToSlice =[]; \n             let nextMatID = 0;\n             const newMaterials =[];\n             const rectNameToMatID = new Map();\n             \n             for (const p of propsToWrite) {\n                 let libFolder = getDecimalPrefix(p._baseUrl);\n\n                 if (p._controlTexName) {\n                     const applyPrefix = (texName) => {\n                         if (!texName) return null;\n                         let baseName = texName.split('/').pop();\n                         return baseName.startsWith(libFolder + \"_\") ? baseName : `${libFolder}_${baseName}`;\n                     };\n\n                     let pCtrl = applyPrefix(p._controlTexName);\n                     let pS0 = applyPrefix(p._splat0TexName);\n                     let pS1 = applyPrefix(p._splat1TexName);\n                     let pS2 = applyPrefix(p._splat2TexName);\n                     let pS3 = applyPrefix(p._splat3TexName);\n\n                     let matKey = `TERRAIN_${pCtrl}_${pS0}_${pS1}_${pS2}_${pS3}`;\n                     if (!rectNameToMatID.has(matKey)) {\n                         rectNameToMatID.set(matKey, nextMatID);\n                         let texParams = [{ name: \"_Control\", texName: pCtrl }];\n                         if (pS0) texParams.push({ name: \"_Splat0\", texName: pS0 });\n                         if (pS1) texParams.push({ name: \"_Splat1\", texName: pS1 });\n                         if (pS2) texParams.push({ name: \"_Splat2\", texName: pS2 });\n                         if (pS3) texParams.push({ name: \"_Splat3\", texName: pS3 });\n\n                         newMaterials.push({ \n                             id: nextMatID, \n                             name: `Terrain_Auto_${nextMatID}`, \n                             shader: \"TankiOnline/Terrain\", \n                             texParams: texParams \n                         });\n                         nextMatID++;\n                     }\n                     p.matID = rectNameToMatID.get(matKey);\n\n                 } else if (p._atlasRect) {\n                     let atlasFolder = getDecimalPrefix(p._atlasBaseUrl);\n                     let uniqueTexName = `${atlasFolder}_${p._atlasRect.originalName}`;\n                     let rectKey = `${p._atlasBaseUrl}_${p._atlasRect.originalName}`;\n                     if (!rectNameToMatID.has(rectKey)) {\n                         rectNameToMatID.set(rectKey, nextMatID);\n                         newMaterials.push({ \n                             id: nextMatID, name: uniqueTexName, shader: \"TankiOnline/SingleTextureShader\", \n                             texParams:[{ name: \"_MainTex\", texName: uniqueTexName }] \n                         });\n                         window.dynamicAtlasesToSlice.push({ \n                             atlas: p._atlasName, rect: p._atlasRect, baseUrl: p._atlasBaseUrl, exportName: uniqueTexName\n                         });\n                         nextMatID++;\n                     }\n                     p.matID = rectNameToMatID.get(rectKey); \n                     \n                 } else if (p._baseTexName) {\n    let baseName = p._baseTexName.split('/').pop();\n    let uniqueTexName = baseName.startsWith(libFolder + \"_\") ? baseName : `${libFolder}_${baseName}`;\n    \n    let texKey = `${p._baseUrl}_${baseName}`;\n    \n    if (!rectNameToMatID.has(texKey)) { \n        rectNameToMatID.set(texKey, nextMatID);\n        newMaterials.push({\n            id: nextMatID, name: uniqueTexName, shader: \"TankiOnline/SingleTextureShader\",\n            texParams: [{ name: \"_MainTex\", texName: uniqueTexName }]\n        });\n        nextMatID++;\n    }\n    \n    p.matID = rectNameToMatID.get(texKey); \n}\n             }\n\n             const bitFlags =[];\n             const pushBit = (b) => bitFlags.push(b);\n             const bw = new BinaryWriter();\n\n             pushBit(false);\n             pushBit(false);\n\n             bw.writeStringLength(0); bw.writeStringLength(0); bw.writeStringLength(0);\n             bw.writeStringLength(0); bw.writeStringLength(0); bw.writeStringLength(0);\n\n             bw.writeStringLength(newMaterials.length);\n             for (const nMat of newMaterials) {\n                 bw.writeUint32(nMat.id, false);\n                 bw.writeString(nMat.name);\n                 pushBit(false); \n                 bw.writeString(nMat.shader);\n\n                 bw.writeStringLength(nMat.texParams.length);\n                 for (let tp of nMat.texParams) {\n                     pushBit(false); \n                     bw.writeString(tp.name);\n                     bw.writeString(tp.texName);\n                 }\n\n                 pushBit(false);\n                 pushBit(false);\n                 pushBit(false);\n             }\n\n             pushBit(false);\n\n             bw.writeStringLength(propsToWrite.length);\n             for (const p of propsToWrite) {\n                 if (p.grpName && p.grpName !== \"\") { pushBit(true); bw.writeString(p.grpName); } else { pushBit(false); }\n                 bw.writeUint32(p.id, false);\n                 bw.writeString(\"\");\n                 bw.writeUint32(p.matID, false); \n                 bw.writeString(p.name);\n                 bw.writeFloat32(p.pos[0], false); bw.writeFloat32(p.pos[1], false); bw.writeFloat32(p.pos[2], false);\n                 const isRotZero = (Math.abs(p.rot[0]) < 1e-5 && Math.abs(p.rot[1]) < 1e-5 && Math.abs(p.rot[2]) < 1e-5);\n                 if (!isRotZero) { pushBit(true); bw.writeFloat32(p.rot[0], false); bw.writeFloat32(p.rot[1], false); bw.writeFloat32(p.rot[2], false); } else { pushBit(false); }\n                 const isScaleOne = (Math.abs(p.scale[0]-1) < 1e-5 && Math.abs(p.scale[1]-1) < 1e-5 && Math.abs(p.scale[2]-1) < 1e-5);\n                 if (!isScaleOne) { pushBit(true); bw.writeFloat32(p.scale[0], false); bw.writeFloat32(p.scale[1], false); bw.writeFloat32(p.scale[2], false); } else { pushBit(false); }\n             }\n             \n             const header = packHeader(bitFlags);\n             const bodyBytes = bw.toUint8Array();\n             \n             const uncompressed = new Uint8Array(header.headerPrefix.length + header.extBytes.length + bodyBytes.length);\n             uncompressed.set(header.headerPrefix, 0);\n             uncompressed.set(header.extBytes, header.headerPrefix.length);\n             uncompressed.set(bodyBytes, header.headerPrefix.length + header.extBytes.length);\n             \n             const binZipped = await wrapPacketCompressed(uncompressed);\n             return { binData: binZipped, propsToWrite, idMapping };\n         }\n         \n         window.selectPrefab = function(baseName) {\n             try {\n                 window.isGhostFrozen = false;\n                 if (ghost) {\n                     editorGroup.remove(ghost);\n                     ghost = null;\n                     if (window.originalObjectBeingMoved) {\n                         if (window.originalObjectParent) window.originalObjectParent.add(window.originalObjectBeingMoved);\n                         else editorGroup.add(window.originalObjectBeingMoved);\n                         window.originalObjectBeingMoved = null;\n                         window.originalObjectParent = null;\n                     }\n                 }\n                 \n                 window.isContinuousCopyEnabled = false;\n                 const copyBtn = document.getElementById('continuous-copy-btn');\n                 if (copyBtn) copyBtn.className = 'm3-btn m3-btn-secondary';\n                 window.dragMode = 'none';\n                 if (window.updateDragModeUI) window.updateDragModeUI();\n         \n                 currentPrefabGroup = prefabs.get(baseName);\n                 window.currentBaseName = baseName;\n                 \n                 if (currentPrefabGroup) {\n                     ghost = currentPrefabGroup.clone();\n                     ghost.rotation.order = 'ZYX';\n                     ghost.traverse(child => {\n                         if (child.isMesh && child.material) {\n                             try {\n                                 const origMat = child.material;\n                                 if (Array.isArray(origMat)) {\n                                     child.material = origMat.map(m => {\n                                         const c = m.clone();\n                                         if (m.onBeforeCompile) c.onBeforeCompile = m.onBeforeCompile;\n                                         if (m.customProgramCacheKey) c.customProgramCacheKey = m.customProgramCacheKey;\n                                         c.transparent = true; c.opacity = 0.7; c.depthWrite = false;\n                                         return c;\n                                     });\n                                     child.userData.origColor = 0xffffff; \n                                 } else {\n                                     child.material = origMat.clone();\n                                     if (origMat.onBeforeCompile) child.material.onBeforeCompile = origMat.onBeforeCompile;\n                                     if (origMat.customProgramCacheKey) child.material.customProgramCacheKey = origMat.customProgramCacheKey;\n                                     child.material.transparent = true;\n                                     child.material.opacity = 0.7;\n                                     child.material.depthWrite = false;\n                                     child.userData.origColor = child.material.color ? child.material.color.getHex() : 0xffffff;\n                                 }\n                             } catch (matErr) { console.warn(\"Material cloning bypassed for safety\", matErr); }\n                         }\n                     });\n                     editorGroup.add(ghost);\n                     if (!window.isGhostLockedToOriginal) updateGhost(currentMousePos.x, currentMousePos.y);\n                     const fp = document.querySelector('.grid-floating-panel');\n                     if (fp) fp.style.display = 'flex';\n                 }\n                 if (isTouchDevice) {\n                     isUIOpen = false;\n                     const ui = document.getElementById('ui-container');\n                     if (ui) ui.style.transform = 'translateX(100%)';\n                 }\n             } catch(err) {\n                 console.error(\"Critical error in selectPrefab:\", err);\n                 showToast(`Error: ${err.message}`);\n             }\n         };\n         \n         function setupUIEvents() {\n             const uiContainer = document.getElementById('ui-container');\n             const menuToggle = document.getElementById('menu-toggle');\n             const prefabList = document.getElementById('prefab-list');\n             const propsHeader = document.getElementById('props-header');\n             let lastScrollY = 0;\n             prefabList.addEventListener('scroll', () => {\n                 if (!isTouchDevice) {\n                     propsHeader.style.transform = 'translateY(0)';\n                     return;\n                 }\n                 const currentScrollY = prefabList.scrollTop;\n                 if (currentScrollY > lastScrollY && currentScrollY > 60) {\n                     propsHeader.style.transform = 'translateY(-100%)';\n                 } else {\n                     propsHeader.style.transform = 'translateY(0)';\n                 }\n                 lastScrollY = currentScrollY;\n             });\n             const rotateBtn = document.getElementById('rotate-btn');\n             const exportBtn = document.getElementById('export-btn');\n             const importBtn = document.getElementById('import-btn');\n             const loadOriginalBtn = document.getElementById('load-original-btn');\n             const fileInput = document.getElementById('file-input');\n             const clearBtn = document.getElementById('clear-btn');\n             const gridHeightDisplay = document.getElementById('grid-height-display');\n             const gridZBtn = document.getElementById('grid-z-btn');\n             \n             const dialogOverlay = document.getElementById('m3-dialog-overlay');\n             const dialogContainer = document.getElementById('m3-dialog');\n             const dialogCancelBtn = document.getElementById('dialog-cancel-btn');\n             const dialogConfirmBtn = document.getElementById('dialog-confirm-btn');\n             const dialogTitleText = document.getElementById('dialog-title-text');\n             const dialogDescText = document.getElementById('dialog-desc-text');\n         \n             let currentDialogAction = null;\n         \n             function showDialog(title, desc, confirmText, actionCallback) {\n                 if (dialogTitleText) dialogTitleText.innerText = title;\n                 if (dialogDescText) dialogDescText.innerText = desc;\n                 if (dialogConfirmBtn) dialogConfirmBtn.innerText = confirmText;\n                 currentDialogAction = actionCallback;\n                 dialogOverlay.style.display = 'flex';\n                 void dialogOverlay.offsetWidth;\n                 dialogOverlay.style.opacity = '1';\n                 dialogContainer.style.transform = 'scale(1) translateY(0)';\n             }\n         \n             function closeDialog() {\n                 dialogOverlay.style.opacity = '0';\n                 dialogContainer.style.transform = 'scale(0.9) translateY(20px)';\n                 setTimeout(() => { dialogOverlay.style.display = 'none'; }, 300);\n             }\n         \n             dialogCancelBtn.addEventListener('click', closeDialog);\n         \n             dialogConfirmBtn.addEventListener('click', () => {\n                 if (currentDialogAction) currentDialogAction();\n                 closeDialog();\n             });\n         \n             const backToMapsBtn = document.getElementById('back-to-maps-btn');\n            if (backToMapsBtn) {\n                if (IS_USERSCRIPT_HOST) {\n                    backToMapsBtn.style.display = 'none';\n                } else {\n                    backToMapsBtn.addEventListener('click', () => {\n                        document.getElementById('view-props').style.display = 'none';\n                        document.getElementById('view-maps').style.display = 'flex';\n                    });\n                }\n            }\n        \n            if (clearBtn) {\n                clearBtn.addEventListener('click', () => {\n                    if (IS_USERSCRIPT_HOST) {\n                        parent.postMessage({ type: 'map-editor-cancel' }, '*');\n                        return;\n                    }\n                    showDialog(\"Clear Scene\", \"Are you sure you want to delete all objects in the scene?\", \"Delete\", () => { clearSceneOnly(); });\n                });\n            }\n        \n            if (loadOriginalBtn) {\n                loadOriginalBtn.addEventListener('click', () => {\n                    if (IS_USERSCRIPT_HOST) {\n                        applyEditsToHost();\n                        return;\n                    }\n                    if (!window.currentMapData) { showToast(\"No original map data available.\"); return; }\n                    showDialog(\"Load Original Map\", \"Are you sure you want to load the original map layout?\", \"Load Map\", async () => {\n                        try {\n                            await processMap(window.currentMapData, true, null, window.currentLightmapData);\n                            if (editorGroup) {\n                                editorGroup.updateMatrixWorld(true);\n                                const box = new THREE.Box3().setFromObject(editorGroup, true);\n                                if (!box.isEmpty() && box.min.x !== Infinity) {\n                                    const center = box.getCenter(new THREE.Vector3());\n                                    const size = box.getSize(new THREE.Vector3());\n                                    const maxDim = Math.max(size.x, size.z);\n                                    const fov = camera.fov * (Math.PI / 180);\n                                    let cameraDistance = Math.abs(maxDim / 2 / Math.tan(fov / 2));\n                                    cameraDistance = Math.max(cameraDistance, 50) * 1.2;\n                                    camera.position.set(center.x, center.y + cameraDistance * 0.6, center.z + cameraDistance);\n                                   camera.lookAt(center);\n                                   if (typeof cameraTarget !== 'undefined' && cameraTarget) {\n                                       cameraTarget.position.copy(camera.position);\n                                   }\n                               }\n                           }\n                           showToast(\"Original map loaded successfully!\", false);\n                        } catch (err) { console.error(err); showToast(\"Failed to load original map.\"); }\n                    });\n                });\n            }\n        \n             function updateDragModeUI() {\n                 rotateBtn.className = window.dragMode === 'rotate' ? 'm3-btn m3-btn-primary' : 'm3-btn m3-btn-secondary';\n                 gridZBtn.className = window.dragMode === 'gridZ' ? 'm3-btn m3-btn-primary' : 'm3-btn m3-btn-secondary';\n                 if (controls) controls.dragToLook = true;\n             }\n             window.updateDragModeUI = updateDragModeUI;\n    \n             rotateBtn.addEventListener('click', (e) => {\n                 e.preventDefault();\n                 window.dragMode = window.dragMode === 'rotate' ? 'none' : 'rotate';\n                 updateDragModeUI();\n                 if (window.dragMode === 'rotate' && !isTouchDevice && ghost && !window.isGhostFrozen) {\n                     showToast(\"Right-click to freeze the prop before dragging to adjust\", false);\n                 }\n             });\n             rotateBtn.addEventListener('contextmenu', (e) => {\n                 e.preventDefault();\n                 if (window.rotateButtonMode === 'horizontal') {\n                     window.rotateButtonMode = 'free'; rotateBtn.querySelector('span').innerText = '3d_rotation'; rotateBtn.title = \"Toggle Free Rotate\"; showToast(\"Switched to Free Rotate Mode\", false);\n                 } else {\n                     window.rotateButtonMode = 'horizontal'; rotateBtn.querySelector('span').innerText = 'rotate_right'; rotateBtn.title = \"Toggle Horizontal Rotate\"; showToast(\"Switched to Horizontal Rotate Mode\", false);\n                 }\n             });\n\n             gridZBtn.addEventListener('click', (e) => {\n                 e.preventDefault();\n                 window.dragMode = window.dragMode === 'gridZ' ? 'none' : 'gridZ';\n                 updateDragModeUI();\n                 if (window.dragMode === 'gridZ' && !isTouchDevice && ghost && !window.isGhostFrozen) {\n                     showToast(\"Right-click to freeze the prop before dragging to adjust\", false);\n                 }\n             });\n             gridZBtn.addEventListener('contextmenu', (e) => {\n                 e.preventDefault();\n                 currentGridHeight = 0; document.getElementById('grid-height-display').innerText = '0'; \n                 if (ghost) updateGhost(currentMousePos.x, currentMousePos.y, true); \n                 showToast(\"Grid Z Reset\", false);\n             });\n         \n             function updateGridHeight(delta) {\n                 currentGridHeight += delta;\n                 gridHeightDisplay.innerText = Math.round(currentGridHeight);\n                 if (ghost) updateGhost(currentMousePos.x, currentMousePos.y, true);\n             }\n         const lockHeightBtn = document.getElementById('lock-height-btn');\n             if (lockHeightBtn && !isTouchDevice) {\n                 lockHeightBtn.style.display = 'flex';\n                 window.isHeightLocked = false;\n                 \n                 lockHeightBtn.addEventListener('click', () => {\n                     window.isHeightLocked = !window.isHeightLocked;\n                     lockHeightBtn.classList.toggle('active', window.isHeightLocked); \n                 });\n             }\n             \n             const toggleCollisionBtn = document.getElementById('toggle-collision-btn');\n             if (toggleCollisionBtn) {\n                 toggleCollisionBtn.addEventListener('click', () => {\n                     const isActive = toggleCollisionBtn.classList.toggle('active');\n                     if (window.collisionGroup) {\n                         window.collisionGroup.visible = isActive;\n                     }\n                 });\n             }\n\n             function updateUIState() { uiContainer.style.transform = isUIOpen ? 'translateX(0)' : 'translateX(100%)'; }\n             updateUIState();\n             \n             window.addEventListener('resize', () => {\n                 const w = window.innerWidth;\n                 if(isTouchDevice && w < 768) { isUIOpen = false; } else if(!isTouchDevice && w >= 768) { isUIOpen = true; }\n                 updateUIState();\n             });\n             \n             menuToggle.addEventListener('click', () => { isUIOpen = !isUIOpen; updateUIState(); });\n         \n             const snapBtn = document.getElementById('snap-btn');\n             snapBtn.addEventListener('click', () => {\n                 isSnapping = !isSnapping; snapBtn.className = isSnapping ? 'm3-btn m3-btn-primary' : 'm3-btn m3-btn-secondary';\n             });\n             importBtn.addEventListener('click', () => {\n                fileInput.accept = '.bin';\n                fileInput.click();\n                if(isTouchDevice) { isUIOpen = false; updateUIState(); }\n            });\n            \n            fileInput.addEventListener('change', async (e) => {\n                const files = Array.from(e.target.files);\n                if (files.length === 0) return;\n                const file = files[0];\n                try {\n                    await importMapBinFromFile(file);\n                } catch (err) {\n                    console.error(err);\n                    showToast(`${HOST_UI.invalidMapBin}: ${err.message}`, true);\n                }\n                e.target.value = ''; \n             });\n         \n             const continuousCopyBtn = document.getElementById('continuous-copy-btn');\n             if (continuousCopyBtn) {\n                 continuousCopyBtn.addEventListener('click', () => {\n                     window.isContinuousCopyEnabled = !window.isContinuousCopyEnabled;\n                     continuousCopyBtn.className = window.isContinuousCopyEnabled ? 'm3-btn m3-btn-primary' : 'm3-btn m3-btn-secondary';\n                 });\n             }\n         \n             const cancelGhostBtn = document.getElementById('cancel-ghost-btn');\n             if (cancelGhostBtn) {\n                 cancelGhostBtn.addEventListener('click', () => {\n                     if (ghost) {\n                         editorGroup.remove(ghost); ghost = null; window.isGhostLockedToOriginal = false; window.isGhostFrozen = false; document.querySelector('.grid-floating-panel').style.display = 'none';\n                         if (window.originalObjectBeingMoved) {\n                             if (window.originalObjectParent) window.originalObjectParent.add(window.originalObjectBeingMoved);\n                             else editorGroup.add(window.originalObjectBeingMoved);\n                             window.originalObjectBeingMoved = null; window.originalObjectParent = null;\n                         }\n                     }\n                 });\n             }\n             exportBtn.addEventListener('click', async () => {\n                try {\n                    await exportCurrentMapBinFile();\n                } catch (err) {\n                    console.error(err);\n                    showToast(`${HOST_UI.exportFailed}: ${err.message}`, true);\n                }\n            });\n         \n             window.addEventListener('wheel', (e) => {\n                 if (e.target.closest('#ui-container')) return;\n                 if (ghost) {\n                     ghost.rotation.z += e.deltaY > 0 ? -Math.PI/8 : Math.PI/8;\n                     updateGhost(currentMousePos.x, currentMousePos.y); \n                 }\n             });\n         \n             let longPressTimer = null;\n             let selectedObjectForAction = null;\n         \n             function handleLongPress(clientX, clientY) {\n                 longPressTimer = null;\n                 if (ghost) return;\n                 mouse.x = (clientX / window.innerWidth) * 2 - 1;\n                 mouse.y = -(clientY / window.innerHeight) * 2 + 1;\n                 raycaster.setFromCamera(mouse, camera);\n                 const intersects = raycaster.intersectObjects(editorGroup.children, true);\n                 let hitObj = null;\n                 for (let ix of intersects) {\n                     let obj = ix.object;\n                     while (obj && obj !== editorGroup) {\n                         if (obj === ghost || obj.userData.isOriginalMapGroup || obj.userData.isCollisionGroup) break; \n                         if (obj.userData && (obj.userData.baseName || (obj.userData.originalProps && obj.userData.originalProps.length > 0))) {\n                             hitObj = obj; break;\n                         }\n                         obj = obj.parent;\n                     }\n                     if (hitObj) break;\n                 }\n                 if (hitObj) {\n                     if ('vibrate' in navigator) navigator.vibrate(50);\n                     selectedObjectForAction = hitObj;\n                     const cm = document.getElementById('context-menu');\n                     const title = document.getElementById('cm-title');\n                     let name = hitObj.userData.baseName;\n                     if (!name && hitObj.userData.originalProps && hitObj.userData.originalProps.length > 0) {\n                         let pName = hitObj.userData.originalProps[0].name;\n                         name = getCleanBaseName(pName);\n                     }\n                     title.innerText = name || \"Unknown Object\";\n                     cm.style.display = 'flex';\n                     const cmWidth = cm.offsetWidth; const cmHeight = cm.offsetHeight;\n                     cm.style.left = Math.max(16, Math.min(clientX, window.innerWidth - cmWidth - 16)) + 'px';\n                     cm.style.top = Math.max(16, Math.min(clientY, window.innerHeight - cmHeight - 16)) + 'px';\n                 }\n             }\n         \n             document.getElementById('cm-delete').onclick = () => {\n                 if (selectedObjectForAction) {\n                     if (selectedObjectForAction.parent) selectedObjectForAction.parent.remove(selectedObjectForAction);\n                     else editorGroup.remove(selectedObjectForAction);\n                 }\n                 document.getElementById('context-menu').style.display = 'none';\n                 selectedObjectForAction = null;\n             };\n         \n             document.getElementById('cm-move').onclick = () => {\n                 if (selectedObjectForAction) {\n                     let name = selectedObjectForAction.userData.baseName;\n                     if (!name && selectedObjectForAction.userData.originalProps && selectedObjectForAction.userData.originalProps.length > 0) {\n                         let pName = selectedObjectForAction.userData.originalProps[0].name;\n                         name = getCleanBaseName(pName);\n                     }\n                     const rot = selectedObjectForAction.rotation.clone();\n                    const pos = selectedObjectForAction.position.clone();\n                    const scales = selectedObjectForAction.children.map(c => c.scale.clone());\n                    window.originalObjectBeingMoved = selectedObjectForAction;\n                     window.originalObjectParent = selectedObjectForAction.parent;\n                     if (selectedObjectForAction.parent) selectedObjectForAction.parent.remove(selectedObjectForAction);\n                     else editorGroup.remove(selectedObjectForAction);\n                     if (name) {\n                         window.dragMode = 'none'; updateDragModeUI(); window.isGhostLockedToOriginal = true; \n                         \n                         if (!prefabs.has(name)) {\n                             const fallbackPrefab = window.originalObjectBeingMoved.clone();\n                             fallbackPrefab.position.set(0, 0, 0);\n                             fallbackPrefab.rotation.set(0, 0, 0);\n                             prefabs.set(name, fallbackPrefab);\n                         }\n                         \n                         window.selectPrefab(name);\n                         if (ghost) {\n                            ghost.rotation.copy(rot); ghost.position.copy(pos);\n                            ghost.children.forEach((c, i) => { if (scales[i]) c.scale.copy(scales[i]); });\n                            ghost.updateMatrixWorld(true);\n                             const box = new THREE.Box3().setFromObject(ghost, true);\n                             const originalWorldY = editorGroup.localToWorld(pos.clone()).y;\n                             let dip = 0;\n                             if (box.min.y !== Infinity) dip = (originalWorldY - box.min.y) / editorGroup.scale.z;\n                             editorGroup.remove(ghost);\n                             const originWorld = editorGroup.localToWorld(pos.clone());\n                             const downRay = new THREE.Raycaster(originWorld, new THREE.Vector3(0, -1, 0));\n                             const intersects = downRay.intersectObjects(editorGroup.children, true);\n                             let hitZ = 0;\n                             if (intersects.length > 0) { hitZ = editorGroup.worldToLocal(intersects[0].point).z; } \n                             else {\n                                 const zeroPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);\n                                 const ptWorld = new THREE.Vector3();\n                                 if (downRay.ray.intersectPlane(zeroPlane, ptWorld)) hitZ = editorGroup.worldToLocal(ptWorld).z;\n                             }\n                             editorGroup.add(ghost);\n                             let calculatedGridZ = (pos.z - dip) - hitZ;\n                             if (isSnapping) calculatedGridZ = Math.round(calculatedGridZ / 100) * 100;\n                             else calculatedGridZ = Math.round(calculatedGridZ);\n                             currentGridHeight = calculatedGridZ;\n                             const gridHeightDisplay = document.getElementById('grid-height-display');\n                             if (gridHeightDisplay) gridHeightDisplay.innerText = currentGridHeight;\n                             ghost.userData.baseHitPoint = pos.clone();\n                             ghost.userData.baseHitPoint.z = hitZ;\n                             updateGhost(currentMousePos.x, currentMousePos.y, true);\n                         }\n                     }\n                 }\n                 document.getElementById('context-menu').style.display = 'none';\n                 selectedObjectForAction = null;\n             };\n         \n             document.getElementById('cm-copy').onclick = () => {\n                 if (selectedObjectForAction) {\n                     let name = selectedObjectForAction.userData.baseName;\n                     if (!name && selectedObjectForAction.userData.originalProps && selectedObjectForAction.userData.originalProps.length > 0) {\n                         let pName = selectedObjectForAction.userData.originalProps[0].name;\n                         name = getCleanBaseName(pName);\n                     }\n                     const rot = selectedObjectForAction.rotation.clone();\n                    const pos = selectedObjectForAction.position.clone();\n                    const scales = selectedObjectForAction.children.map(c => c.scale.clone());\n                    window.originalObjectBeingMoved = null; window.originalObjectParent = null;\n                     if (name) {\n                         window.dragMode = 'none'; updateDragModeUI(); window.isGhostLockedToOriginal = true; \n                         \n                         if (!prefabs.has(name)) {\n                             const fallbackPrefab = selectedObjectForAction.clone();\n                             fallbackPrefab.position.set(0, 0, 0);\n                             fallbackPrefab.rotation.set(0, 0, 0);\n                             prefabs.set(name, fallbackPrefab);\n                         }\n                         \n                         window.selectPrefab(name);\n                         window.isContinuousCopyEnabled = true;\n                         const copyBtn = document.getElementById('continuous-copy-btn');\n                         if (copyBtn) copyBtn.className = 'm3-btn m3-btn-primary';\n                         if (ghost) {\n                            ghost.rotation.copy(rot); ghost.position.copy(pos);\n                            ghost.children.forEach((c, i) => { if (scales[i]) c.scale.copy(scales[i]); });\n                            ghost.updateMatrixWorld(true);\n                             const box = new THREE.Box3().setFromObject(ghost, true);\n                             const originalWorldY = editorGroup.localToWorld(pos.clone()).y;\n                             let dip = 0;\n                             if (box.min.y !== Infinity) dip = (originalWorldY - box.min.y) / editorGroup.scale.z;\n                             editorGroup.remove(ghost);\n                             const originWorld = editorGroup.localToWorld(pos.clone());\n                             const downRay = new THREE.Raycaster(originWorld, new THREE.Vector3(0, -1, 0));\n                             const intersects = downRay.intersectObjects(editorGroup.children, true);\n                             let hitZ = 0;\n                             if (intersects.length > 0) { hitZ = editorGroup.worldToLocal(intersects[0].point).z; } \n                             else {\n                                 const zeroPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);\n                                 const ptWorld = new THREE.Vector3();\n                                 if (downRay.ray.intersectPlane(zeroPlane, ptWorld)) hitZ = editorGroup.worldToLocal(ptWorld).z;\n                             }\n                             editorGroup.add(ghost);\n                             let calculatedGridZ = (pos.z - dip) - hitZ;\n                             if (isSnapping) calculatedGridZ = Math.round(calculatedGridZ / 100) * 100;\n                             else calculatedGridZ = Math.round(calculatedGridZ);\n                             currentGridHeight = calculatedGridZ;\n                             const gridHeightDisplay = document.getElementById('grid-height-display');\n                             if (gridHeightDisplay) gridHeightDisplay.innerText = currentGridHeight;\n                             ghost.userData.baseHitPoint = pos.clone();\n                             ghost.userData.baseHitPoint.z = hitZ;\n                             updateGhost(currentMousePos.x, currentMousePos.y, true);\n                         }\n                     }\n                 }\n                 document.getElementById('context-menu').style.display = 'none';\n                 selectedObjectForAction = null;\n             };\n         \n             renderer.domElement.addEventListener('pointerdown', (e) => {\n                 if (!e.isPrimary) return;\n\n                 if (e.button === 1) {\n                     e.preventDefault();\n                     window.isMiddlePanMode = !window.isMiddlePanMode;\n                     const anchorEl = document.getElementById('pan-anchor');\n                     if (window.isMiddlePanMode) {\n                         window.middlePanOrigin = { x: e.clientX, y: e.clientY };\n                         window.middlePanCurrent = { x: e.clientX, y: e.clientY };\n                         anchorEl.style.left = e.clientX + 'px';\n                         anchorEl.style.top = e.clientY + 'px';\n                         anchorEl.style.display = 'block';\n                     } else {\n                         anchorEl.style.display = 'none';\n                     }\n                     if (controls) controls.mouseStatus = 0; \n                     return;\n                 }\n                 \n                 if (window.isMiddlePanMode) {\n                     window.isMiddlePanMode = false;\n                     document.getElementById('pan-anchor').style.display = 'none';\n                     if (controls) controls.mouseStatus = 0;\n                 }\n\n                 isDragging = false;\n                 pointerDownPos = {x: e.clientX, y: e.clientY};\n                 \n                 if (e.button === 2) {\n                     document.getElementById('context-menu').style.display = 'none';\n                     if (ghost) {\n                 \n                         window.isGhostFrozen = !window.isGhostFrozen;\n                         if (window.isGhostFrozen) {\n                             showToast(\"Prop frozen in place\", false);\n                         } else {\n                             showToast(\"Prop unfrozen\", false);\n                             updateGhost(e.clientX, e.clientY);\n                         }\n                     } else {\n                         handleLongPress(e.clientX, e.clientY);\n                     }\n                     return;\n                 }\n         \n                 if (e.target.closest('#context-menu') || document.getElementById('context-menu').style.display === 'flex') {\n                     document.getElementById('context-menu').style.display = 'none';\n                 }\n                 \n                 if (window.dragMode !== 'none' && ghost && (window.cameraPointersCount || 0) < 2) {\n                     window.isEditingDrag = true; editDragStart = {x: e.clientX, y: e.clientY};\n                     initialGhostRot.copy(ghost.rotation); initialGridZ = currentGridHeight; window.hasSlidGridZ = false; return; \n                 }\n         \n                 if (window.isGhostLockedToOriginal) window.isGhostLockedToOriginal = false;\n            if (isTouchDevice) {\n                longPressTimer = setTimeout(() => handleLongPress(e.clientX, e.clientY), 500);\n            }\n            updateGhost(e.clientX, e.clientY);\n             });\n         \n             renderer.domElement.addEventListener('pointermove', (e) => {\n                 if (e.isPrimary) {\n                     if (window.isMiddlePanMode) {\n                         window.middlePanCurrent = { x: e.clientX, y: e.clientY };\n                         if (controls) controls.mouseStatus = 0;\n                         return;\n                     }\n\n                     if (Math.abs(e.clientX - pointerDownPos.x) > 15 || Math.abs(e.clientY - pointerDownPos.y) > 15) {\n                         isDragging = true;\n                         if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }\n                         if (window.isGhostLockedToOriginal && window.dragMode === 'none') window.isGhostLockedToOriginal = false;\n                     }\n                 }\n                 \n                 if (window.isEditingDrag && window.dragMode !== 'none' && ghost) {\n                     const deltaX = e.clientX - editDragStart.x;\n                     const deltaY = e.clientY - editDragStart.y;\n         \n                     if (window.dragMode === 'rotate') {\n                         let rotZ = deltaX * 0.02; let rotX = deltaY * 0.02; const snap = Math.PI / 4;\n                         const camRightWorld = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);\n                         const camUpWorld = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);\n                         const groupInv = editorGroup.matrixWorld.clone().invert();\n                         const camRightLocal = camRightWorld.clone().transformDirection(groupInv).normalize();\n                         const camUpLocal = camUpWorld.clone().transformDirection(groupInv).normalize();\n         \n                         if (window.rotateButtonMode === 'free') {\n                             const qInitial = new THREE.Quaternion().setFromEuler(initialGhostRot);\n                             const qUp = new THREE.Quaternion().setFromAxisAngle(camUpLocal, rotZ); \n                             const qRight = new THREE.Quaternion().setFromAxisAngle(camRightLocal, rotX);\n                             const finalQ = new THREE.Quaternion().copy(qUp).multiply(qRight).multiply(qInitial);\n                             if (isSnapping) {\n                                 const euler = new THREE.Euler().setFromQuaternion(finalQ, ghost.rotation.order);\n                                 euler.x = Math.round(euler.x / snap) * snap; euler.y = Math.round(euler.y / snap) * snap; euler.z = Math.round(euler.z / snap) * snap;\n                                 ghost.rotation.copy(euler);\n                             } else { ghost.quaternion.copy(finalQ); }\n                         } else {\n                             if (isSnapping) rotZ = Math.round(rotZ / snap) * snap;\n                             const isCameraInverted = camUpLocal.z < 0; \n                             let finalRotZ = rotZ;\n                             if (isCameraInverted) finalRotZ = -rotZ;\n                             ghost.rotation.set(initialGhostRot.x, initialGhostRot.y, initialGhostRot.z + finalRotZ);\n                         }\n                     } else if (window.dragMode === 'gridZ') {\n                         let deltaZ = -deltaY * 2; let newZ = initialGridZ + deltaZ;\n                         if (Math.abs(deltaY) > 5) window.hasSlidGridZ = true;\n                         if (isSnapping && window.hasSlidGridZ) newZ = Math.round(newZ / 100) * 100;\n                         else if (isSnapping && !window.hasSlidGridZ) newZ = initialGridZ; \n                         currentGridHeight = newZ;\n                         document.getElementById('grid-height-display').innerText = Math.round(currentGridHeight);\n                     }\n                     updateGhost(editDragStart.x, editDragStart.y, true); return;\n                 }\n                 if ((window.cameraPointersCount || 0) >= 2) return; \n                 updateGhost(e.clientX, e.clientY);\n             });\n         \n             renderer.domElement.addEventListener('pointerup', (e) => {\n                 if (!e.isPrimary) return;\n\n                 if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }\n                 if (window.isEditingDrag) {\n                     window.isEditingDrag = false;\n                     if (Math.abs(e.clientX - pointerDownPos.x) > 10 || Math.abs(e.clientY - pointerDownPos.y) > 10) return;\n                 }\n                 if (window.wasMultiTouch) return;\n                 \n                 if (!isDragging && ghost && (e.button === 0 || e.pointerType === 'touch')) {\n                     updateGhost(e.clientX, e.clientY, window.dragMode !== 'none' || window.isGhostLockedToOriginal);\n                     const instance = currentPrefabGroup.clone();\n                    instance.position.copy(ghost.position); instance.rotation.copy(ghost.rotation);\n                    instance.children.forEach((c, i) => { if (ghost.children[i]) c.scale.copy(ghost.children[i].scale); });\n                    instance.updateMatrixWorld(true);\n                     instance.userData.worldBox = new THREE.Box3().setFromObject(instance, true);\n                     instance.userData.baseName = window.currentBaseName;\n                     editorGroup.add(instance);\n                     window.originalObjectBeingMoved = null; window.originalObjectParent = null;\n         \n                     if (!window.isContinuousCopyEnabled) {\n                         editorGroup.remove(ghost); ghost = null; window.isGhostLockedToOriginal = false; window.isGhostFrozen = false; document.querySelector('.grid-floating-panel').style.display = 'none';\n                     } else {\n                         window.isGhostLockedToOriginal = false; window.isGhostFrozen = false; window.dragMode = 'none';\n                         if (window.updateDragModeUI) window.updateDragModeUI();\n                         updateGhost(e.clientX, e.clientY, false);\n                     }\n                 }\n             });\n         }\n         \n         function updateGhost(clientX, clientY, isLockedDrag = false) {\n             currentMousePos.x = clientX; currentMousePos.y = clientY;\n             if (!ghost) return;\n         \n             if (!isLockedDrag && !window.isGhostLockedToOriginal && !window.isGhostFrozen) {\n                 mouse.x = (clientX / window.innerWidth) * 2 - 1; mouse.y = -(clientY / window.innerHeight) * 2 + 1;\n                 raycaster.setFromCamera(mouse, camera);\n                 const intersects = raycaster.intersectObjects(editorGroup.children, true);\n                 let hitPoint = null; let objHitPoint = null;\n                 const validIntersects = intersects.filter(ix => {\n                     let obj = ix.object;\n                     while(obj) { if (obj === ghost || obj.userData.isCollisionGroup) return false; obj = obj.parent; }\n                     return true;\n                 });\n                 if (validIntersects.length > 0) objHitPoint = validIntersects[0].point;\n         \n                 groundPlane.set(new THREE.Vector3(0, 1, 0), 0);\n                 let zeroPlaneHitPoint = null; const zeroIntersect = new THREE.Vector3();\n                 if (raycaster.ray.intersectPlane(groundPlane, zeroIntersect)) zeroPlaneHitPoint = zeroIntersect;\n         \n                 if (camera.position.y >= 0) {\n                     if (objHitPoint && zeroPlaneHitPoint) {\n                         if (camera.position.distanceTo(objHitPoint) < camera.position.distanceTo(zeroPlaneHitPoint)) hitPoint = objHitPoint;\n                         else hitPoint = zeroPlaneHitPoint;\n                     } else if (objHitPoint) hitPoint = objHitPoint;\n                     else if (zeroPlaneHitPoint) hitPoint = zeroPlaneHitPoint;\n                 } else {\n                     if (objHitPoint) hitPoint = objHitPoint;\n                     else if (zeroPlaneHitPoint) hitPoint = zeroPlaneHitPoint;\n                 }\n                 if (!hitPoint) {\n                     hitPoint = raycaster.ray.at(1000, new THREE.Vector3());\n                     if (camera.position.y >= 0) hitPoint.y = 0;\n                 }\n                 if (hitPoint) {\n                     editorGroup.worldToLocal(hitPoint);\n                     if (isSnapping && currentPrefabGroup) {\n                         let snapped = false; let snapX = 250; let snapY = 250; let snapZ = 100;\n                         for (let i = 0; i < editorGroup.children.length; i++) {\n                             const child = editorGroup.children[i];\n                             if (child === ghost || child.userData.isOriginalMapGroup || child.userData.isCollisionGroup) continue;\n                             const dist = child.position.distanceTo(hitPoint);\n                             if (dist < 800.0) {\n                                 const diff = hitPoint.clone().sub(child.position);\n                                 hitPoint.x = child.position.x + Math.round(diff.x / snapX) * snapX;\n                                 hitPoint.y = child.position.y + Math.round(diff.y / snapY) * snapY;\n                                 hitPoint.z = child.position.z + Math.round(diff.z / snapZ) * snapZ;\n                                 snapped = true; break;\n                             }\n                         }\n                         if (!snapped) {\n                             hitPoint.x = Math.round(hitPoint.x / snapX) * snapX; hitPoint.y = Math.round(hitPoint.y / snapY) * snapY; hitPoint.z = Math.round(hitPoint.z / snapZ) * snapZ;\n                         }\n                     }\n                     ghost.userData.baseHitPoint = hitPoint.clone();\n                 }\n             }\n         \n             if (ghost.userData.baseHitPoint) {\n                 const hp = ghost.userData.baseHitPoint.clone();\n                 hp.z += currentGridHeight;\n                 ghost.position.copy(hp);\n                 ghost.updateMatrixWorld(true);\n                 const box = new THREE.Box3().setFromObject(ghost, true);\n                 const originalWorldY = editorGroup.localToWorld(hp.clone()).y;\n                 if (box.min.y !== Infinity) {\n                     const dip = originalWorldY - box.min.y;\n                     if (Math.abs(dip) > 0.001) ghost.position.z += dip / editorGroup.scale.z;\n                 }\n             }\n         }\n         \n         loadMain();\n             \n      </script>\n   </body>\n</html>\n";

    function buildEditorHtml(bootstrap) {
        let html = EMBEDDED_EDITOR_HTML;
        const bootJson = JSON.stringify(bootstrap).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
        const inject = '<scr' + 'ipt>window.__MAP_EDITOR_BOOT__=' + bootJson + ';</scr' + 'ipt>';
        if (html.includes('</head>')) {
            html = html.replace('</head>', inject + '</head>');
        } else {
            html = inject + html;
        }
        return html;
    }

    class MapEditorHost {
        constructor() {
            this.overlay = null;
            this.iframe = null;
            this.blobUrls = [];
            this.currentMap = null;
            this.currentTheme = null;
            this._onMessage = (e) => this.onMessage(e);
            window.addEventListener('message', this._onMessage);
        }

        revokeBlobs() {
            this.blobUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch (e) {} });
            this.blobUrls = [];
        }

        close() {
            if (this.overlay && this.overlay.parentNode) this.overlay.parentNode.removeChild(this.overlay);
            this.overlay = null;
            this.iframe = null;
            this.revokeBlobs();
        }

        async handleGmFetch(id, url) {
            try {
                const res = await gmFetch(url);
                const buffer = await res.arrayBuffer();
                if (this.iframe && this.iframe.contentWindow) {
                    this.iframe.contentWindow.postMessage({
                        type: 'gm-fetch-result',
                        id,
                        buffer,
                        contentType: 'application/octet-stream',
                        contentLength: buffer.byteLength
                    }, '*', [buffer]);
                }
            } catch (err) {
                if (this.iframe && this.iframe.contentWindow) {
                    this.iframe.contentWindow.postMessage({
                        type: 'gm-fetch-result',
                        id,
                        error: String(err && err.message ? err.message : err)
                    }, '*');
                }
            }
        }

        onMessage(e) {
            const data = e.data;
            if (!data || typeof data !== 'object') return;
            if (data.type === 'gm-fetch' && data.id != null && data.url) {
                this.handleGmFetch(data.id, data.url);
                return;
            }
            if (data.type === 'map-editor-cancel') {
                this.close();
            } else if (data.type === 'map-editor-apply') {
                const { mapName, themeName, propEdits } = data;
                Settings.setPropEdits(mapName, themeName, propEdits);
                Settings.getThemeData(mapName, themeName).propEditsEnabled = true;
                Settings.save();
                if (uiInstance) {
                    uiInstance.showToast(I18N.editorSaved, 3000);
                    uiInstance.render();
                }
                this.close();
            }
        }

        async open(mapConfig, themeConfig) {
            if (this.overlay) this.close();

            this.overlay = document.createElement('div');
            Object.assign(this.overlay.style, {
                position: 'fixed', inset: '0', zIndex: '10000000',
                background: '#001926', display: 'flex', alignItems: 'center',
                justifyContent: 'center', flexDirection: 'column', gap: '12px',
                color: '#BFD5FF', fontFamily: 'system-ui,sans-serif'
            });
            this.overlay.innerHTML = `<div style="width:40px;height:40px;border:3px solid #4D7380;border-top-color:#76FF33;border-radius:50%;animation:mrecspin 1s linear infinite"></div>
                <div>${I18N.editorLoading}</div>
                <style>@keyframes mrecspin{to{transform:rotate(360deg)}}</style>`;
            document.body.appendChild(this.overlay);

            try {
                const base = getResourceBase();
                let path = themeConfig.path.startsWith('/') ? themeConfig.path : '/' + themeConfig.path;
                let mapUrl = base + path;
                if (!mapUrl.endsWith('map.bin')) mapUrl += '/map.bin';
                const mapBaseUrl = mapUrl.substring(0, mapUrl.lastIndexOf('/'));

                const mapRes = await gmFetch(mapUrl);
                const mapBuf = await mapRes.arrayBuffer();
                const mapData = await parseMapBin(mapBuf);

                const themeData = Settings.getThemeData(mapConfig.name, themeConfig.name);
                let props = mapData.props;
                let useBootProps = false;
                if (themeData.propEdits && themeData.propEdits.props) {
                    props = applyPropEdits(mapData.props, themeData.propEdits);
                    useBootProps = true;
                }

                const bootProps = props.map(p => ({
                    id: p.id,
                    grpName: p.grpName || '',
                    libName: p.libName || '',
                    matID: p.matID,
                    name: p.name,
                    pos: [...p.pos],
                    rot: p.rot ? [...p.rot] : [0, 0, 0],
                    scale: p.scale ? [...p.scale] : [1, 1, 1]
                }));

                const bootstrap = {
                    userscriptMode: true,
                    useGmProxy: true,
                    mapName: mapConfig.name,
                    themeName: themeConfig.name,
                    mapBaseUrl,
                    mapBinUrl: mapUrl,
                    libraryJsonUrl: null,
                    libraryBaseUrl: null,
                    props: bootProps,
                    useBootProps,
                    i18n: {
                        editorTitle: I18N.editorTitle,
                        editorApply: I18N.editorApply,
                        editorCancel: I18N.editorCancel,
                        editorLoading: I18N.editorLoading,
                        sameMapOnly: I18N.sameMapOnly
                    }
                };

                const html = buildEditorHtml(bootstrap);
                const pageBlob = new Blob([html], { type: 'text/html' });
                const pageUrl = URL.createObjectURL(pageBlob);
                this.blobUrls.push(pageUrl);

                this.overlay.innerHTML = '';
                Object.assign(this.overlay.style, {
                    padding: '0', alignItems: 'stretch', justifyContent: 'stretch', gap: '0'
                });
                this.iframe = document.createElement('iframe');
                this.iframe.src = pageUrl;
                Object.assign(this.iframe.style, {
                    width: '100%', height: '100%', border: 'none', background: '#000'
                });
                this.iframe.setAttribute('allow', 'fullscreen; pointer-lock');
                this.iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-pointer-lock allow-downloads allow-modals allow-popups allow-forms');
                this.overlay.appendChild(this.iframe);

                this.currentMap = mapConfig.name;
                this.currentTheme = themeConfig.name;
            } catch (err) {
                console.error(err);
                if (uiInstance) uiInstance.showToast(I18N.editorError + ': ' + err.message, 5000);
                this.close();
            }
        }
    }
    const mapEditorHost = new MapEditorHost();

    // ==========================================
    // Settings UI
    // ==========================================
    class SettingsUI {
        constructor() {
            this.isOpen = false;
            this.isRecordingShortcut = false;
            this.isMobile = window.innerWidth <= 768 || 'ontouchstart' in window;

            this.container = document.createElement('div');
            this.container.style.position = 'fixed';
            this.container.style.top = '0';
            this.container.style.left = '0';
            this.container.style.width = '100%';
            this.container.style.height = '100%';
            this.container.style.pointerEvents = 'none';
            this.container.style.zIndex = '999999';
            document.body.appendChild(this.container);

            this.shadow = this.container.attachShadow({ mode: 'open' });
            this.injectStyles();
            this.buildDOM();
            this.bindEvents();
            this.render();

            if (this.isMobile) {
                if (!Settings.data.hintShown) this.showToast(I18N.toastMobileHint, 6000);
            } else {
                if (!Settings.data.shortcut) this.toggle(true);
            }
        }

        injectStyles() {
            const style = document.createElement('style');
            style.textContent = `
                :host {
                    --primary: #76FF33;
                    --on-primary: #00390A;
                    --bg: #001926;
                    --surface-container: rgba(191, 213, 255, 0.05);
                    --surface-container-high: rgba(191, 213, 255, 0.08);
                    --surface-container-highest: rgba(191, 213, 255, 0.12);
                    --on-surface: #E2E2E9;
                    --on-surface-variant: #BFD5FF;
                    --outline: #4D7380;
                    --error: #FF6666;
                    font-family: inherit;
                }
                * { box-sizing: border-box; font-family: inherit; }
                .m3-interactive { position: relative; overflow: hidden; cursor: pointer; transition: transform 0.2s, background-color 0.2s, border-color 0.2s; }
                .m3-interactive::after { content: ""; position: absolute; inset: 0; background: currentColor; opacity: 0; transition: opacity 0.2s; pointer-events: none; }
                .m3-interactive:hover::after { opacity: 0.08; }
                .m3-interactive:active { transform: scale(0.96); }
                .svg-icon { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; flex-shrink: 0; }
                .svg-icon svg { width: 100%; height: 100%; fill: currentColor; }
                .overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.6); opacity: 0; pointer-events: none; transition: opacity 0.3s; backdrop-filter: blur(4px); }
                .drawer { position: fixed; top: 0; right: 0; width: 420px; max-width: 85vw; height: 100%; background: var(--bg); color: var(--on-surface); pointer-events: auto; transform: translateX(100%); transition: transform 0.4s cubic-bezier(0.2, 0, 0, 1); display: flex; flex-direction: column; box-shadow: -8px 0 32px rgba(0,0,0,0.6); border-top-left-radius: 24px; border-bottom-left-radius: 24px; }
                .header { padding: 20px; display: flex; justify-content: space-between; align-items: center; gap: 8px; }
                .title-container { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }
                .title { font-size: 18px; font-weight: 600; color: var(--primary); margin: 0; white-space: nowrap; flex-shrink: 0; }
                .subtitle { font-size: 12px; color: #BFD5FF; font-weight: 500; opacity: 0.9; line-height: 1.3; }
                .icon-btn { background: transparent; border: none; color: var(--on-surface-variant); padding: 8px; border-radius: 50%; display: flex; align-items: center; justify-content: center; }
                .content { flex: 1; overflow-y: auto; padding: 0 24px 24px 24px; }
                .content::-webkit-scrollbar { width: 6px; }
                .content::-webkit-scrollbar-thumb { background: var(--surface-container-highest); border-radius: 3px; }
                .link-card { background: var(--surface-container-high); border-radius: 16px; padding: 16px; margin-bottom: 24px; display: flex; flex-direction: column; gap: 12px; }
                .btn { background: var(--surface-container-highest); color: var(--on-surface); border: 1px solid transparent; padding: 10px 16px; border-radius: 20px; font-weight: 500; display: inline-flex; align-items: center; gap: 8px; cursor: pointer; }
                .btn.primary { background: rgba(118, 255, 51, 0.15); color: var(--primary); border-color: var(--primary); }
                .btn.edit { background: rgba(191, 213, 255, 0.1); color: var(--on-surface-variant); border-color: var(--outline); width: 100%; justify-content: center; }
                .map-card { background: var(--surface-container); border-radius: 24px; padding: 16px; margin-bottom: 16px; border: 1px solid var(--surface-container-high); }
                .map-title { font-size: 16px; font-weight: 600; color: var(--on-surface); margin-bottom: 12px; padding-left: 4px; }
                .theme-tab-row { display: flex; gap: 12px; overflow-x: auto; padding-bottom: 8px; }
                .theme-tab-row::-webkit-scrollbar { height: 0; }
                .theme-tab { width: 48px; height: 48px; border-radius: 24px; flex-shrink: 0; background: var(--surface-container-highest); border: 2px solid transparent; display: flex; align-items: center; justify-content: center; color: var(--on-surface-variant); }
                .theme-tab.active { background: rgba(118, 255, 51, 0.15); border-color: var(--primary); }
                .theme-icon-mask { width: 26px; height: 26px; background-color: var(--on-surface-variant); -webkit-mask-size: contain; -webkit-mask-repeat: no-repeat; -webkit-mask-position: center; mask-size: contain; mask-repeat: no-repeat; mask-position: center; }
                .theme-tab.active .theme-icon-mask { background-color: var(--primary); }
                .theme-content-wrapper { display: grid; grid-template-rows: 0fr; transition: grid-template-rows 0.4s cubic-bezier(0.2, 0, 0, 1), margin-top 0.4s; margin-top: 0; }
                .theme-content-wrapper.open { grid-template-rows: 1fr; margin-top: 16px; }
                .theme-content-inner { overflow: hidden; display: flex; flex-direction: column; gap: 16px; }
                .theme-details-header { display: flex; justify-content: space-between; align-items: center; padding-bottom: 8px; border-bottom: 1px solid var(--surface-container-highest); }
                .theme-details-title { font-size: 15px; font-weight: 500; color: var(--primary); }
                .tags-container { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; background: var(--surface-container-high); border-radius: 12px; padding: 10px; border: 1px solid var(--outline); transition: border-color 0.2s; cursor: text; }
                .tags-container:focus-within { border-color: var(--primary); }
                .tag-chip { background: var(--surface-container-highest); color: var(--on-surface); height: 32px; padding: 0 4px 0 12px; border-radius: 8px; display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 500; border: 1px solid var(--outline); }
                .tag-chip-remove { display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 50%; color: var(--on-surface-variant); }
                .tag-chip-remove:hover { color: var(--error); background: rgba(255,102,102,0.1); }
                .tag-input { background: transparent; border: none; outline: none; color: var(--on-surface); flex: 1; min-width: 130px; font-size: 14px; height: 32px; }
                .model-list { display: flex; flex-direction: column; gap: 4px; background: var(--surface-container-high); border-radius: 12px; padding: 8px; max-height: 250px; overflow-y: auto; border: 1px solid var(--outline); }
                .model-list::-webkit-scrollbar { width: 4px; }
                .model-list::-webkit-scrollbar-thumb { background: var(--surface-container-highest); border-radius: 2px; }
                .model-item { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; border-radius: 8px; transition: background 0.2s; }
                .model-item:hover { background: var(--surface-container-highest); }
                .model-name { font-size: 13px; word-break: break-all; }
                .model-item.filtered .model-name { color: var(--error); text-decoration: line-through; opacity: 0.8; }
                .model-item.included .model-name { color: var(--primary); }
                .prop-edit-card { background: var(--surface-container-high); border-radius: 12px; padding: 12px; border: 1px solid var(--outline); display: flex; flex-direction: column; gap: 10px; }
                .prop-edit-meta { font-size: 12px; color: var(--on-surface-variant); line-height: 1.4; }
                .prop-edit-meta.has { color: var(--primary); }
                .toast { position: fixed; bottom: 32px; left: 50%; transform: translateX(-50%); background: var(--on-surface-variant); color: var(--bg); padding: 12px 24px; border-radius: 24px; font-weight: 600; opacity: 0; pointer-events: none; transition: opacity 0.3s, transform 0.3s; box-shadow: 0 8px 24px rgba(0,0,0,0.4); z-index: 1000000; }
                .m3-switch { position: relative; display: inline-flex; align-items: center; width: 52px; height: 32px; flex-shrink: 0; cursor: pointer; -webkit-tap-highlight-color: transparent; margin: 0; }
                .m3-switch input { opacity: 0; width: 0; height: 0; position: absolute; }
                .m3-switch-track { position: absolute; inset: 0; border-radius: 16px; border: 2px solid var(--outline); background: var(--surface-container-highest); transition: all 0.3s cubic-bezier(0.2, 0, 0, 1); box-sizing: border-box; }
                .m3-switch-thumb { position: absolute; top: 8px; left: 8px; width: 16px; height: 16px; border-radius: 16px; background: var(--on-surface-variant); transition: all 0.3s cubic-bezier(0.2, 0, 0, 1); display: flex; align-items: center; justify-content: center; pointer-events: none; }
                .m3-switch:hover .m3-switch-thumb { background: var(--on-surface); }
                .m3-switch:active .m3-switch-thumb { width: 24px; left: 4px; }
                .m3-switch input:checked + .m3-switch-track { background: var(--primary); border-color: var(--primary); }
                .m3-switch input:checked ~ .m3-switch-thumb { background: var(--on-primary); width: 24px; height: 24px; top: 4px; left: 24px; }
                .m3-switch:active input:checked ~ .m3-switch-thumb { width: 28px; left: 20px; }
                .m3-switch-thumb svg { width: 16px; height: 16px; fill: var(--primary); opacity: 0; transform: scale(0.2) rotate(-45deg); transition: all 0.3s cubic-bezier(0.2, 0, 0, 1); }
                .m3-switch input:checked ~ .m3-switch-thumb svg { opacity: 1; transform: scale(1) rotate(0); }
            `;
            this.shadow.appendChild(style);
        }

        buildDOM() {
            this.toastEl = document.createElement('div');
            this.toastEl.className = 'toast';
            this.shadow.appendChild(this.toastEl);

            // Inject custom dialog
            this.dialogOverlay = document.createElement('div');
            this.dialogOverlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:1000001;display:none;align-items:center;justify-content:center;opacity:0;transition:opacity 0.2s;backdrop-filter:blur(4px);pointer-events:auto;';
            this.dialogOverlay.innerHTML = `
                <div class="custom-dialog" style="background:var(--bg);border:1px solid var(--outline);border-radius:24px;padding:24px;width:320px;max-width:90vw;transform:scale(0.9);transition:transform 0.2s cubic-bezier(0.2,0,0,1);box-shadow:0 16px 32px rgba(0,0,0,0.5);">
                    <div style="font-size:18px;font-weight:600;color:var(--error);margin:0 0 12px 0;display:flex;align-items:center;gap:8px;"><span class="svg-icon" style="width:24px;height:24px;">${ICONS.restart_alt}</span><span id="cd-title"></span></div>
                    <div id="cd-desc" style="font-size:14px;color:var(--on-surface-variant);margin-bottom:24px;line-height:1.5;"></div>
                    <div style="display:flex;justify-content:flex-end;gap:12px;">
                        <button class="btn m3-interactive" id="cd-cancel">${I18N.btnCancel}</button>
                        <button class="btn m3-interactive" id="cd-confirm" style="color:var(--error);border-color:var(--error);background:rgba(255,102,102,0.15);">${I18N.btnConfirm}</button>
                    </div>
                </div>
            `;
            this.shadow.appendChild(this.dialogOverlay);
            this.dialogOverlay.querySelector('#cd-cancel').onclick = () => this.closeDialog();
            this.dialogOverlay.onclick = (e) => { if(e.target === this.dialogOverlay) this.closeDialog(); };

            this.overlay = document.createElement('div');
            this.overlay.className = 'overlay';
            this.shadow.appendChild(this.overlay);

            this.drawer = document.createElement('div');
            this.drawer.className = 'drawer';

            const shortcutCardHTML = this.isMobile ? '' : `
                <div class="link-card" id="shortcut-card">
                    <div style="font-size:13px; color:var(--on-surface-variant);">${I18N.shortcutDesc}</div>
                    <button class="btn m3-interactive" id="shortcut-btn" style="justify-content: center; width: 100%;">
                        <span class="svg-icon" style="width:20px;height:20px;">${ICONS.keyboard}</span>
                        <span id="shortcut-text">${I18N.setupShortcut}</span>
                    </button>
                </div>
            `;

            const offlineCardHTML = `
                <div class="link-card" id="offline-card">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div style="font-size:15px; font-weight: 600; color:var(--primary);">${I18N.offlineModeTitle}</div>
                    </div>
                    <div style="font-size:12px; color:var(--on-surface-variant); line-height:1.4;">${I18N.offlineModeDesc}</div>
                    <button class="btn m3-interactive" id="offline-btn" style="justify-content: center; width: 100%; border-color: var(--outline);">
                        <span class="svg-icon" style="width:20px;height:20px;">${ICONS.wifi_off}</span>
                        <span id="offline-text">${I18N.offlineModeBtn}</span>
                    </button>
                </div>
            `;

            this.drawer.innerHTML = `
                <div class="header">
                    <div class="title-container">
                        <h2 class="title">${I18N.panelTitle}</h2>
                        <div class="subtitle">${I18N.panelSubtitle}</div>
                    </div>
                    <button class="icon-btn m3-interactive" id="close-btn"><span class="svg-icon">${ICONS.close}</span></button>
                </div>
                <div class="content">
                    ${shortcutCardHTML}
                    ${offlineCardHTML}
                    <div id="maps-container"></div>
                </div>
            `;
            this.shadow.appendChild(this.drawer);

            this.mapsContainer = this.drawer.querySelector('#maps-container');
            if (!this.isMobile) {
                this.shortcutBtn = this.drawer.querySelector('#shortcut-btn');
                this.shortcutText = this.drawer.querySelector('#shortcut-text');
            }
        }

        bindEvents() {
            this.overlay.addEventListener('click', () => this.toggle(false));
            this.drawer.querySelector('#close-btn').addEventListener('click', () => this.toggle(false));

            const offlineBtn = this.drawer.querySelector('#offline-btn');
            const offlineText = this.drawer.querySelector('#offline-text');
            if (offlineBtn) {
                offlineBtn.addEventListener('click', () => {
                    if (!g._offlineMode) {
                        g._offlineMode = true;
                        if (g._activeWs) g._activeWs.close();
                        offlineText.innerText = I18N.offlineModeActiveBtn;
                        offlineBtn.style.background = 'rgba(255, 51, 102, 0.15)';
                        offlineBtn.style.borderColor = 'var(--error)';
                        offlineBtn.style.color = 'var(--error)';
                        this.showToast(I18N.toastOfflineActivated, 5000);
                        this.toggle(false);
                    } else {
                        this.showToast(I18N.toastOfflineAlreadyActive, 4000);
                    }
                });
            }

            if (!this.isMobile && this.shortcutBtn) {
                this.shortcutBtn.addEventListener('click', () => {
                    this.isRecordingShortcut = true;
                    this.shortcutText.innerText = I18N.pressKeys;
                    this.shortcutBtn.style.color = 'var(--error)';
                });
                window.addEventListener('keydown', (e) => {
                    if (this.isRecordingShortcut) {
                        e.preventDefault();
                        if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key) ||
                            ['ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'].includes(e.code)) return;
                        const sc = { ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, code: e.code };
                        Settings.data.shortcut = sc;
                        Settings.save();
                        this.isRecordingShortcut = false;
                        this.shortcutBtn.style.color = '';
                        this.updateShortcutUI();
                    } else {
                        const sc = Settings.data.shortcut;
                        if (sc) {
                            const matchCode = sc.code && sc.code === e.code;
                            const matchKey = sc.key && e.key.toLowerCase() === (sc.key ? sc.key.toLowerCase() : '');
                            if (e.ctrlKey === sc.ctrl && e.shiftKey === sc.shift && e.altKey === sc.alt && (matchCode || matchKey)) {
                                e.preventDefault();
                                this.toggle();
                            }
                        }
                    }
                });
            }

            let touchStartX = 0; let touchStartY = 0;
            window.addEventListener('touchstart', e => {
                touchStartX = e.changedTouches[0].screenX; touchStartY = e.changedTouches[0].screenY;
            }, { passive: true });
            window.addEventListener('touchend', e => {
                let touchEndX = e.changedTouches[0].screenX; let touchEndY = e.changedTouches[0].screenY;
                const inTopRightCorner = touchStartX > window.innerWidth - 50 && touchStartY < 120;
                const isValidSwipe = (touchEndX - touchStartX < -80) && (Math.abs(touchEndY - touchStartY) < 80);
                if (inTopRightCorner && isValidSwipe) {
                    this.toggle(true);
                    if (this.isMobile && !Settings.data.hintShown) { Settings.data.hintShown = true; Settings.save(); }
                }
            }, { passive: true });
        }

        showDialog(title, desc, confirmCallback) {
            this.dialogOverlay.querySelector('#cd-title').innerText = title;
            this.dialogOverlay.querySelector('#cd-desc').innerText = desc;
            this.dialogOverlay.querySelector('#cd-confirm').onclick = () => { confirmCallback(); this.closeDialog(); };
            this.dialogOverlay.style.display = 'flex';
            this.dialogOverlay.offsetHeight;
            this.dialogOverlay.style.opacity = '1';
            this.dialogOverlay.querySelector('.custom-dialog').style.transform = 'scale(1)';
        }
        closeDialog() {
            this.dialogOverlay.style.opacity = '0';
            this.dialogOverlay.querySelector('.custom-dialog').style.transform = 'scale(0.9)';
            setTimeout(() => { this.dialogOverlay.style.display = 'none'; }, 200);
        }

        updateShortcutUI() {
            if (!this.isMobile && this.shortcutText) {
                const sc = Settings.data.shortcut;
                if (!sc) {
                    this.shortcutText.innerText = I18N.setupShortcut; this.shortcutBtn.classList.remove('primary');
                } else {
                    const parts = [];
                    if (sc.ctrl) parts.push('Ctrl'); if (sc.alt) parts.push('Alt'); if (sc.shift) parts.push('Shift');
                    let keyStr = '';
                    if (sc.code) keyStr = sc.code.replace('Key', '').replace('Digit', '');
                    else if (sc.key) keyStr = sc.key.toUpperCase();
                    parts.push(keyStr);
                    this.shortcutText.innerText = parts.join(' + '); this.shortcutBtn.classList.add('primary');
                }
            }
        }

        showToast(msg, duration = 4000) {
            if (this.toastTimeout) clearTimeout(this.toastTimeout);
            this.toastEl.innerHTML = msg;
            this.toastEl.style.opacity = '1';
            this.toastEl.style.transform = 'translateX(-50%) translateY(0)';
            this.toastTimeout = setTimeout(() => {
                this.toastEl.style.opacity = '0';
                this.toastEl.style.transform = 'translateX(-50%) translateY(20px)';
            }, duration);
        }

        toggle(force) {
            const nextState = force !== undefined ? force : !this.isOpen;
            if (!nextState && !this.isMobile && !Settings.data.shortcut) {
                this.showToast(I18N.toastPcShortcut);
                if (this.shortcutBtn) {
                    this.shortcutBtn.style.color = 'var(--error)';
                    setTimeout(() => { this.shortcutBtn.style.color = ''; }, 1000);
                }
                return;
            }
            this.isOpen = nextState;
            if (this.isOpen) {
                this.drawer.style.transform = 'translateX(0)';
                this.overlay.style.pointerEvents = 'auto';
                this.overlay.style.opacity = '1';
            } else {
                this.drawer.style.transform = 'translateX(100%)';
                this.overlay.style.pointerEvents = 'none';
                this.overlay.style.opacity = '0';
            }
        }

        render() {
            this.updateShortcutUI();
            this.mapsContainer.innerHTML = '';

            MAP_CONFIGS.forEach((mapConfig) => {
                const mapCard = document.createElement('div');
                mapCard.className = 'map-card';

                const mapTitle = document.createElement('div');
                mapTitle.className = 'map-title';
                mapTitle.innerText = I18N.mapNames[mapConfig.name] || mapConfig.name;
                mapCard.appendChild(mapTitle);

                const tabRow = document.createElement('div');
                tabRow.className = 'theme-tab-row';
                mapCard.appendChild(tabRow);

                const contentsArea = document.createElement('div');
                mapCard.appendChild(contentsArea);

                let activeTab = null; let activeContent = null;

                mapConfig.themes.forEach((theme) => {
                    const tabBtn = document.createElement('button');
                    tabBtn.className = 'theme-tab m3-interactive';
                    tabBtn.title = I18N.themeNames[theme.name] || theme.name;

                    const iconUrl = THEME_ICONS[theme.name];
                    if (iconUrl) {
                        tabBtn.innerHTML = `<div class="theme-icon-mask" style="-webkit-mask-image: url('${iconUrl}'); mask-image: url('${iconUrl}');"></div>`;
                    } else { tabBtn.innerText = (I18N.themeNames[theme.name] || theme.name).charAt(0); }
                    tabRow.appendChild(tabBtn);

                    const contentWrapper = document.createElement('div');
                    contentWrapper.className = 'theme-content-wrapper';
                    const contentInner = document.createElement('div');
                    contentInner.className = 'theme-content-inner';
                    contentWrapper.appendChild(contentInner);

                    const detailsHeader = document.createElement('div');
                    detailsHeader.className = 'theme-details-header';
                    detailsHeader.innerHTML = `
                        <span class="theme-details-title">${I18N.themeNames[theme.name] || theme.name}</span>
                        <button class="btn m3-interactive" style="padding:4px 12px; font-size:12px; border-radius:12px;">
                            <span class="svg-icon" style="width:16px;height:16px;">${ICONS.restart_alt}</span> ${I18N.btnReset}
                        </button>
                    `;
                    contentInner.appendChild(detailsHeader);

                    // ---- Object editor card ----
                    const propCard = document.createElement('div');
                    propCard.className = 'prop-edit-card';

                    const renderPropCard = () => {
                        const tData = Settings.getThemeData(mapConfig.name, theme.name);
                        const summary = Settings.getPropEditsSummary(mapConfig.name, theme.name);
                        const isEnabled = tData.propEditsEnabled !== false;
                        const metaText = summary
                            ? (isEnabled ? I18N.propEditsSummary(summary) : '<span style="color:var(--error);text-decoration:line-through;">' + I18N.propEditsSummary(summary) + '</span>')
                            : I18N.propEditsNone;

                        propCard.innerHTML = `
                            <div style="display:flex; justify-content:space-between; align-items:center; gap:12px;">
                                <div style="display:flex; flex-direction:column; gap:8px; flex:1;">
                                    <div style="display:flex; justify-content:space-between; align-items:center;">
                                        <div style="font-size:13px;font-weight:600;color:var(--primary);">${I18N.propEditsLabel}</div>
                                        ${summary ? `
                                        <label class="m3-switch" title="Toggle Edits">
                                            <input type="checkbox" data-toggle-edits ${isEnabled ? 'checked' : ''}>
                                            <div class="m3-switch-track"></div>
                                            <div class="m3-switch-thumb">
                                                <svg viewBox="0 -960 960 960"><path d="M382-240 154-468q-11-11-11-28t11-28q11-11 28-11t28 11l172 172 422-422q11-11 28-11t28 11q11 11 11 28t-11 28L438-240q-11 11-28 11t-28-11Z"/></svg>
                                            </div>
                                        </label>
                                        ` : ''}
                                    </div>
                                    <div class="prop-edit-meta ${summary && isEnabled ? 'has' : ''}" id="prop-edit-meta-text-${theme.name}">${metaText}</div>
                                </div>

                                <div style="display:flex; gap:8px; align-items:center;">
                                    <button class="icon-btn m3-interactive" data-edit-map style="background:rgba(191,213,255,0.1); color:var(--on-surface-variant); border-radius:12px; width:36px; height:36px;" title="${I18N.editMap}">
                                        <span class="svg-icon" style="width:18px;height:18px;">${ICONS.edit}</span>
                                    </button>
                                    ${summary ? `
                                    <button class="icon-btn m3-interactive" data-clear-edits style="background:rgba(255,102,102,0.15); color:var(--error); border-radius:12px; width:36px; height:36px;" title="${I18N.clearPropEdits}">
                                        <span class="svg-icon" style="width:18px;height:18px;">${ICONS.restart_alt}</span>
                                    </button>
                                    ` : ''}
                                </div>
                            </div>
                        `;

                        const toggleInput = propCard.querySelector('[data-toggle-edits]');
                        if (toggleInput) {
                            toggleInput.onchange = () => {
                                // Local refresh: avoid rebuilding the outer DOM to keep the switch animation intact
                                Settings.togglePropEditsEnabled(mapConfig.name, theme.name);
                                const isNowEnabled = Settings.getThemeData(mapConfig.name, theme.name).propEditsEnabled !== false;
                                const metaContainer = propCard.querySelector('#prop-edit-meta-text-' + theme.name);
                                if (metaContainer) {
                                    metaContainer.className = 'prop-edit-meta ' + (summary && isNowEnabled ? 'has' : '');
                                    metaContainer.innerHTML = isNowEnabled
                                        ? I18N.propEditsSummary(summary)
                                        : '<span style="color:var(--error);text-decoration:line-through;">' + I18N.propEditsSummary(summary) + '</span>';
                                }
                            };
                        }

                        propCard.querySelector('[data-edit-map]').onclick = () => {
                            this.toggle(false); mapEditorHost.open(mapConfig, theme);
                        };

                        const clearBtn = propCard.querySelector('[data-clear-edits]');
                        if (clearBtn) {
                            clearBtn.onclick = () => {
                                this.showDialog(I18N.confirmResetTitle, I18N.confirmResetDesc, () => {
                                    Settings.clearPropEdits(mapConfig.name, theme.name);
                                    renderPropCard();
                                    this.showToast(I18N.clearPropEdits, 2000);
                                });
                            };
                        }
                    };

                    renderPropCard();
                    contentInner.appendChild(propCard);

                    // ---- Collision blacklist ----
                    const tagsLabel = document.createElement('div');
                    tagsLabel.style.fontSize = '12px'; tagsLabel.style.color = 'var(--on-surface-variant)';
                    tagsLabel.innerText = I18N.broadFilterLabel;
                    contentInner.appendChild(tagsLabel);

                    const tagsContainer = document.createElement('div');
                    tagsContainer.className = 'tags-container';
                    const tagInput = document.createElement('input');
                    tagInput.className = 'tag-input';
                    tagInput.placeholder = I18N.addKeyword;

                    const renderTags = () => {
                        const tData = Settings.getThemeData(mapConfig.name, theme.name);
                        tagsContainer.querySelectorAll('.tag-chip').forEach(el => el.remove());
                        tData.blacklist.forEach(word => {
                            const chip = document.createElement('div');
                            chip.className = 'tag-chip';
                            chip.innerHTML = `<span>${word}</span><span class="tag-chip-remove m3-interactive"><span class="svg-icon" style="width:14px;height:14px;">${ICONS.close}</span></span>`;
                            chip.querySelector('.tag-chip-remove').onclick = (e) => {
                                e.stopPropagation();
                                Settings.setBlacklistWords(mapConfig.name, theme.name, tData.blacklist.filter(w => w !== word));
                                renderTags(); renderModels();
                            };
                            tagsContainer.insertBefore(chip, tagInput);
                        });
                    };

                    tagInput.onkeydown = (e) => {
                        e.stopPropagation();
                        if (e.key === 'Enter' || e.key === ',') {
                            e.preventDefault();
                            const val = tagInput.value.trim().replace(/,/g, '');
                            if (val) {
                                const tData = Settings.getThemeData(mapConfig.name, theme.name);
                                if (!tData.blacklist.includes(val)) {
                                    Settings.setBlacklistWords(mapConfig.name, theme.name, [...tData.blacklist, val]);
                                    renderTags(); renderModels();
                                }
                            }
                            tagInput.value = '';
                        } else if (e.key === 'Backspace' && tagInput.value === '') {
                            const tData = Settings.getThemeData(mapConfig.name, theme.name);
                            if (tData.blacklist.length > 0) {
                                const newList = [...tData.blacklist]; newList.pop();
                                Settings.setBlacklistWords(mapConfig.name, theme.name, newList);
                                renderTags(); renderModels();
                            }
                        }
                    };
                    tagInput.onkeyup = (e) => e.stopPropagation();
                    tagInput.onkeypress = (e) => e.stopPropagation();
                    tagsContainer.appendChild(tagInput);
                    tagsContainer.onclick = () => tagInput.focus();
                    contentInner.appendChild(tagsContainer);

                    let decimalFolderId = '0';
                    if (theme.path) {
                        let rawFolderId = theme.path.split('/').pop();
                        decimalFolderId = rawFolderId;
                        if (/^[0-7]+$/.test(rawFolderId)) {
                            try { decimalFolderId = parseInt(rawFolderId, 8).toString(10); } catch (e) {}
                        }
                    }
                    const viewerUrl = `https://testanki1.github.io/maps/special/collision-regenerate?map=${decimalFolderId}`;

                    const listHeaderRow = document.createElement('div');
                    listHeaderRow.style.display = 'flex'; listHeaderRow.style.justifyContent = 'space-between'; listHeaderRow.style.alignItems = 'center';
                    const listLabel = document.createElement('div');
                    listLabel.style.fontSize = '12px'; listLabel.style.color = 'var(--on-surface-variant)';
                    listLabel.innerText = I18N.exactModelsLabel;

                    const viewModelBtn = document.createElement('a');
                    viewModelBtn.href = viewerUrl; viewModelBtn.target = '_blank';
                    viewModelBtn.className = 'm3-interactive';
                    Object.assign(viewModelBtn.style, {
                        display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px',
                        background: 'rgba(118,255,51,0.15)', color: 'var(--primary)', borderRadius: '12px',
                        textDecoration: 'none', fontSize: '12px', fontWeight: '500'
                    });
                    viewModelBtn.innerHTML = `<span class="svg-icon" style="width:14px; height:14px;">${ICONS.travel_explore}</span>${I18N.viewModels}`;
                    listHeaderRow.appendChild(listLabel); listHeaderRow.appendChild(viewModelBtn);
                    contentInner.appendChild(listHeaderRow);

                    const modelListContainer = document.createElement('div');
                    modelListContainer.className = 'model-list';
                    contentInner.appendChild(modelListContainer);

                    const renderModels = () => {
                        const tData = Settings.getThemeData(mapConfig.name, theme.name);
                        modelListContainer.innerHTML = '';
                        if (tData.knownModels.length === 0) {
                            modelListContainer.innerHTML = `<div style="padding:16px 8px; font-size:12px; color:var(--outline); text-align:center;">${I18N.loadingModels}</div>`;
                        } else {
                            const sortedModels = [...tData.knownModels].sort((a, b) => a.localeCompare(b));
                            sortedModels.forEach(modelName => {
                                const isFiltered = Settings.isModelFiltered(mapConfig.name, theme.name, modelName);
                                const item = document.createElement('div');
                                item.className = `model-item ${isFiltered ? 'filtered' : 'included'}`;
                                const icon = isFiltered ? 'visibility_off' : 'visibility';
                                const actionColor = isFiltered ? 'var(--error)' : 'var(--primary)';
                                item.innerHTML = `
                                    <span class="model-name">${modelName}</span>
                                    <button class="icon-btn m3-interactive" style="color: ${actionColor}; padding:4px;">
                                        <span class="svg-icon" style="width:20px; height:20px;">${ICONS[icon]}</span>
                                    </button>
                                `;
                                item.querySelector('button').onclick = () => {
                                    Settings.toggleModelExact(mapConfig.name, theme.name, modelName, isFiltered);
                                    renderModels();
                                };
                                modelListContainer.appendChild(item);
                            });
                        }
                    };

                    detailsHeader.querySelector('button').onclick = () => {
                        Settings.resetTheme(mapConfig.name, theme.name); renderTags(); renderModels();
                    };

                    renderTags(); renderModels();

                    tabBtn.onclick = () => {
                        if (activeTab === tabBtn) {
                            tabBtn.classList.remove('active'); contentWrapper.classList.remove('open');
                            activeTab = null; activeContent = null;
                        } else {
                            if (activeTab) { activeTab.classList.remove('active'); activeContent.classList.remove('open'); }
                            tabBtn.classList.add('active'); contentWrapper.classList.add('open');
                            activeTab = tabBtn; activeContent = contentWrapper;
                        }
                    };

                    contentsArea.appendChild(contentWrapper);
                    theme._updateUI = () => { renderModels(); };
                });
                this.mapsContainer.appendChild(mapCard);
            });
        }

        notifyModelsDiscovered(mapName, themeName) {
            const config = MAP_CONFIGS.find(m => m.name === mapName);
            if (!config) return;
            const theme = config.themes.find(t => t.name === themeName);
            if (theme && typeof theme._updateUI === 'function') theme._updateUI();
        }
    }

    // ==========================================
    // Preload models list
    // ==========================================
    async function preloadModels() {
        const base = getResourceBase();
        for (const map of MAP_CONFIGS) {
            for (const theme of map.themes) {
                if (!theme.path) continue;
                const tData = Settings.getThemeData(map.name, theme.name);
                if (tData.knownModels.length > 0) continue;
                let path = theme.path.startsWith('/') ? theme.path : '/' + theme.path;
                let url = base + path; if (!url.endsWith('map.bin')) url += '/map.bin';
                try {
                    const res = await pageFetch(url);
                    if (!res.ok) continue;
                    const buffer = await res.arrayBuffer();
                    const parsed = await parseMapBin(buffer);
                    const discovered = new Set();
                    parsed.props.forEach(p => { if (p.name) discovered.add(p.name); });
                    if (discovered.size > 0) {
                        Settings.addKnownModels(map.name, theme.name, discovered);
                        if (uiInstance) uiInstance.notifyModelsDiscovered(map.name, theme.name);
                    }
                } catch (e) {}
            }
        }
    }

    let uiInstance = null;

    function initApp() {
        if (uiInstance) return;
        uiInstance = new SettingsUI();
        preloadModels();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initApp);
    } else {
        initApp();
    }

    // ==========================================
    // Intercept map.bin + lightmap comp_light (fetch + XHR)
    // ==========================================
    const originalFetch = g.fetch.bind(g);
    g.originalFetch = originalFetch;

    g.fetch = async function (input, init) {
        let url = (input instanceof Request) ? input.url : String(input);

        // ---- lightmap-*_comp_light (only when that map theme has object edits) ----
        try {
            if (parseLightmapCompLightUrl(url)) {
                const replaced = await maybeReplaceCompLight(url, input, init);
                if (replaced) {
                    console.log('[MapEditor+Recollider] replaced comp_light', replaced.mapName, replaced.themeName, 'gray', replaced.gray, url.split('?')[0]);
                    return new Response(replaced.buffer, {
                        status: 200, statusText: 'OK',
                        headers: {
                            'Content-Type': replaced.mime,
                            'Content-Length': String(replaced.buffer.length)
                        }
                    });
                }
            }
        } catch (e) {
            console.error('[MapEditor+Recollider] lightmap intercept failed, passthrough', e);
        }

        // ---- map.bin ----
        if (url.endsWith('map.bin') || url.includes('/map.bin?') || url.includes('map.bin&')) {
            // normalize match: path ends with map.bin
            const pure = url.split('?')[0].split('#')[0];
            if (pure.endsWith('map.bin')) {
                for (const mapConfig of MAP_CONFIGS) {
                    for (const themeConfig of mapConfig.themes) {
                        if (themeConfig.path && url.includes(themeConfig.path)) {
                            try {
                                // IMPORTANT: use page fetch (not GM) so cookies/CDN behave like the game
                                const res = await originalFetch(input, init);
                                const buffer = await res.arrayBuffer();
                                const newBuffer = await generateMapBinLocal(url.split('?')[0], buffer, mapConfig, themeConfig);
                                return new Response(newBuffer, {
                                    status: 200, statusText: 'OK',
                                    headers: {
                                        'Content-Type': 'application/octet-stream',
                                        'Content-Length': String(newBuffer.length)
                                    }
                                });
                            } catch (e) {
                                console.error('[MapEditor+Recollider] fetch intercept failed, passthrough', e);
                                return originalFetch(input, init);
                            }
                        }
                    }
                }
            }
        }
        return originalFetch(input, init);
    };

    // Patch the PAGE's XMLHttpRequest (not the userscript sandbox's)
    const PageXHR = g.XMLHttpRequest;
    const originalOpen = PageXHR.prototype.open;
    const originalSend = PageXHR.prototype.send;

    PageXHR.prototype.open = function (method, url, ...args) {
        this._mrec_url = String(url);
        this._mrec_method = method;
        this._mrec_openArgs = args;
        this._mrec_mapConfig = null;
        this._mrec_themeConfig = null;
        this._mrec_lightmap = false;
        const pure = this._mrec_url.split('?')[0].split('#')[0];

        // lightmap comp_light for edited maps
        if (parseLightmapCompLightUrl(pure)) {
            const hit = findThemeByResourceUrl(this._mrec_url);
            if (hit && themeHasMapEdits(hit.mapConfig.name, hit.themeConfig.name)) {
                this._mrec_lightmap = true;
                this._mrec_mapConfig = hit.mapConfig;
                this._mrec_themeConfig = hit.themeConfig;
                // Delay real open until send (blob URL ready)
                return;
            }
        }

        if (pure.endsWith('map.bin')) {
            for (const mapConfig of MAP_CONFIGS) {
                for (const themeConfig of mapConfig.themes) {
                    if (themeConfig.path && this._mrec_url.includes(themeConfig.path)) {
                        this._mrec_mapConfig = mapConfig;
                        this._mrec_themeConfig = themeConfig;
                        break;
                    }
                }
                if (this._mrec_mapConfig) break;
            }
        }
        if (!this._mrec_mapConfig) return originalOpen.call(this, method, url, ...args);
        // Delay real open until send (blob URL ready) — same as original re-collider
    };

    PageXHR.prototype.send = function (body) {
        if (this._mrec_lightmap) {
            const url = this._mrec_url.split('?')[0];
            getWhiteLightmapBlobUrl(url).then(blobUrl => {
                if (!blobUrl) {
                    originalOpen.call(this, this._mrec_method, this._mrec_url, ...this._mrec_openArgs);
                    originalSend.call(this, body);
                    return;
                }
                originalOpen.call(this, this._mrec_method, blobUrl, ...this._mrec_openArgs);
                originalSend.call(this, body);
            }).catch(err => {
                console.error('[MapEditor+Recollider] lightmap XHR intercept failed, passthrough', err);
                originalOpen.call(this, this._mrec_method, this._mrec_url, ...this._mrec_openArgs);
                originalSend.call(this, body);
            });
            return;
        }
        if (this._mrec_mapConfig && this._mrec_themeConfig) {
            const url = this._mrec_url.split('?')[0];
            generateMapBinLocalAndGetBlobUrl(url, this._mrec_mapConfig, this._mrec_themeConfig).then(blobUrl => {
                originalOpen.call(this, this._mrec_method, blobUrl, ...this._mrec_openArgs);
                originalSend.call(this, body);
            }).catch(err => {
                console.error('[MapEditor+Recollider] XHR intercept failed, passthrough', err);
                originalOpen.call(this, this._mrec_method, this._mrec_url, ...this._mrec_openArgs);
                originalSend.call(this, body);
            });
            return;
        }
        return originalSend.call(this, body);
    };
})();
