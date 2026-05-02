// ==UserScript==
// @name         Remastered Maps Re-collider
// @namespace    http://tampermonkey.net/
// @version      2.2
// @description  Regenerate collisions for Remastered maps + Offline Mode for Out-of-bounds Exploration
// @match        *://*.3dtank.com/play*
// @match        *://*.tankionline.com/play*
// @match        *://*.test-eu.tankionline.com/browser-public/index.html*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    // ==========================================
    // Offline Mode (WebSocket hijack core)
    // ==========================================
    window._offlineMode = false;
    window._activeWs = null;
    const OriginalWebSocket = window.WebSocket;
    const listenerMap = new WeakMap();

    window.WebSocket = new Proxy(OriginalWebSocket, {
        construct(target, args) {
            const ws = new target(...args);
            window._activeWs = ws;

            const wsProxy = new Proxy(ws, {
                get(obj, prop) {
                    if (prop === 'readyState') {
                        return window._offlineMode ? 1 : obj.readyState; // Keep readyState as OPEN (1)
                    }
                    if (prop === 'addEventListener') {
                        return function(type, listener, options) {
                            const wrapped = function(event) {
                                if (window._offlineMode && (type === 'close' || type === 'error')) {
                                    console.log(`[Offline] Blocked ${type} event.`);
                                    return; // Silently intercept disconnect events
                                }
                                return listener.apply(this, arguments);
                            };
                            listenerMap.set(listener, wrapped);
                            return obj.addEventListener(type, wrapped, options);
                        };
                    }
                    if (prop === 'removeEventListener') {
                        return function(type, listener, options) {
                            const wrapped = listenerMap.get(listener);
                            return obj.removeEventListener(type, wrapped || listener, options);
                        };
                    }
                    if (prop === 'send') {
                        return function(data) {
                            if (window._offlineMode) return; // Drop packets
                            try { return obj.send(data); } catch(e) {}
                        };
                    }
                    if (typeof obj[prop] === 'function') {
                        return obj[prop].bind(obj);
                    }
                    return obj[prop];
                },
                set(obj, prop, value) {
                    if (prop === 'onclose' || prop === 'onerror') {
                        obj[prop] = function(event) {
                            if (window._offlineMode) return;
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
    // Localization (i18n)
    // ==========================================
    const isZh = navigator.language.toLowerCase().startsWith('zh');
    const I18N = {
        toastMobileHint: isZh ? "从右上角向左滑动以配置碰撞" : "Swipe left from the TOP-RIGHT corner to config collisions",
        toastPcShortcut: isZh ? "请设置快捷键以关闭此面板" : "Please setup a shortcut to close this panel",
        shortcutDesc: isZh ? "打开/关闭此面板的快捷键：" : "Shortcut to open/close this panel:",
        setupShortcut: isZh ? "设置快捷键" : "Setup Shortcut",
        pressKeys: isZh ? "请按键..." : "Press keys...",
        panelTitle: isZh ? "碰撞配置" : "Collision Config",
        btnReset: isZh ? "重置" : "Reset",
        broadFilterLabel: isZh ? "过滤含有以下关键词的模型碰撞：" : "Filter model collisions containing these keywords:",
        addKeyword: isZh ? "添加关键词..." : "Add keyword...",
        exactModelsLabel: isZh ? "设置含碰撞的模型：" : "Set models with collisions:",
        viewModels: isZh ? "查看模型" : "View Models",
        loadingModels: isZh ? "加载模型中...<br><span style=\"font-size:10px; opacity:0.7\">或者进入地图加载。</span>" : "Loading models...<br><span style=\"font-size:10px; opacity:0.7\">Or join the map to load manually.</span>",
        mapNames: {
            "Highland REMASTER": isZh ? "高原 重制" : "Highland REMASTER",
            "Parma REMASTER": isZh ? "边塞角斗场 重制" : "Parma REMASTER"
        },
        themeNames: {
            "Summer Day": isZh ? "夏天的白天" : "Summer Day",
            "Summer Evening": isZh ? "夏天的傍晚" : "Summer Evening",
            "Autumn": isZh ? "秋天" : "Autumn",
            "Winter Day": isZh ? "冬天的白天" : "Winter Day"
        },
        offlineModeTitle: isZh ? "脱机模式" : "Offline Mode",
        offlineModeDesc: isZh ? "切断服务器连接并屏蔽掉线提示，配合碰撞生成以探索地图外区域。" : "Disconnect server and suppress disconnect alerts to explore out-of-bounds.",
        offlineModeBtn: isZh ? "开启脱机" : "Enable Offline",
        offlineModeActiveBtn: isZh ? "脱机运行中" : "Offline Active",
        toastOfflineActivated: isZh ? "已脱机！" : "Offline enabled!",
        toastOfflineAlreadyActive: isZh ? "已处于脱机状态。若想恢复请刷新网页。" : "Already offline. Refresh the page to play normally."
    };

    // ==========================================
    // Icon SVG Resources
    // ==========================================
    const ICONS = {
        close: `<svg viewBox="0 -960 960 960"><path d="M480-424 284-228q-11 11-28 11t-28-11q-11-11-11-28t11-28l196-196-196-196q-11-11-11-28t11-28q11-11 28-11t28 11l196 196 196-196q11-11 28-11t28 11q11 11 11 28t-11 28L536-480l196 196q11 11 11 28t-11 28q-11 11-28 11t-28-11L480-424Z"/></svg>`,
        travel_explore: `<svg viewBox="0 -960 960 960"><path d="M80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q127 0 226.5 70T851-629q7 17 .5 34T828-572q-16 5-30.5-3T777-599q-24-60-69-106t-108-71v16q0 33-23.5 56.5T520-680h-80v80q0 17-11.5 28.5T400-560h-80v80h40q17 0 28.5 11.5T400-440v80h-40L168-552q-3 18-5.5 36t-2.5 36q0 122 80.5 213T443-162q16 2 26.5 13.5T480-120q0 17-11.5 28.5T441-82Q288-97 184-210T80-480Zm736 352L716-228q-21 12-45 20t-51 8q-75 0-127.5-52.5T440-380q0-75 52.5-127.5T620-560q75 0 127.5 52.5T800-380q0 27-8 51t-20 45l100 100q11 11 11 28t-11 28q-11 11-28 11t-28-11ZM691-309q29-29 29-71t-29-71q-29-29-71-29t-71 29q-29 29-29 71t29 71q29 29 71 29t71-29Z"/></svg>`,
        keyboard: `<svg viewBox="0 -960 960 960"><path d="M160-200q-33 0-56.5-23.5T80-280v-400q0-33 23.5-56.5T160-760h640q33 0 56.5 23.5T880-680v400q0 33-23.5 56.5T800-200H160Zm0-80h640v-400H160v400Zm200-40h240q17 0 28.5-11.5T640-360q0-17-11.5-28.5T600-400H360q-17 0-28.5 11.5T320-360q0 17 11.5 28.5T360-320Zm-200 40v-400 400Zm108.5-291.5Q280-583 280-600t-11.5-28.5Q257-640 240-640t-28.5 11.5Q200-617 200-600t11.5 28.5Q223-560 240-560t28.5-11.5Zm120 0Q400-583 400-600t-11.5-28.5Q377-640 360-640t-28.5 11.5Q320-617 320-600t11.5 28.5Q343-560 360-560t28.5-11.5Zm120 0Q520-583 520-600t-11.5-28.5Q497-640 480-640t-28.5 11.5Q440-617 440-600t11.5 28.5Q463-560 480-560t28.5-11.5Zm120 0Q640-583 640-600t-11.5-28.5Q617-640 600-640t-28.5 11.5Q560-617 560-600t11.5 28.5Q583-560 600-560t28.5-11.5Zm120 0Q760-583 760-600t-11.5-28.5Q737-640 720-640t-28.5 11.5Q680-617 680-600t11.5 28.5Q703-560 720-560t28.5-11.5Zm-480 120Q280-463 280-480t-11.5-28.5Q257-520 240-520t-28.5 11.5Q200-497 200-480t11.5 28.5Q223-440 240-440t28.5-11.5Zm120 0Q400-463 400-480t-11.5-28.5Q377-520 360-520t-28.5 11.5Q320-497 320-480t11.5 28.5Q343-440 360-440t28.5-11.5Zm120 0Q520-463 520-480t-11.5-28.5Q497-520 480-520t-28.5 11.5Q440-497 440-480t11.5 28.5Q463-440 480-440t28.5-11.5Zm120 0Q640-463 640-480t-11.5-28.5Q617-520 600-520t-28.5 11.5Q560-497 560-480t11.5 28.5Q583-440 600-440t28.5-11.5Zm120 0Q760-463 760-480t-11.5-28.5Q737-520 720-520t-28.5 11.5Q680-497 680-480t11.5 28.5Q703-440 720-440t28.5-11.5Z"/></svg>`,
        restart_alt: `<svg viewBox="0 -960 960 960"><path d="M393-132q-103-29-168-113.5T160-440q0-57 19-108.5t54-94.5q11-12 27-12.5t29 12.5q11 11 11.5 27T290-586q-24 31-37 68t-13 78q0 81 47.5 144.5T410-209q13 4 21.5 15t8.5 24q0 20-14 31.5t-33 6.5Zm174 0q-19 5-33-7t-14-32q0-12 8.5-23t21.5-15q75-24 122.5-87T720-440q0-100-70-170t-170-70h-3l16 16q11 11 11 28t-11 28q-11 11-28 11t-28-11l-84-84q-6-6-8.5-13t-2.5-15q0-8 2.5-15t8.5-13l84-84q11-11 28-11t28 11q11 11 11 28t-11 28l-16 16h3q134 0 227 93t93 227q0 109-65 194T567-132Z"/></svg>`,
        visibility: `<svg viewBox="0 -960 960 960"><path d="M607.5-372.5Q660-425 660-500t-52.5-127.5Q555-680 480-680t-127.5 52.5Q300-575 300-500t52.5 127.5Q405-320 480-320t127.5-52.5Zm-204-51Q372-455 372-500t31.5-76.5Q435-608 480-608t76.5 31.5Q588-545 588-500t-31.5 76.5Q525-392 480-392t-76.5-31.5ZM235.5-272Q125-344 61-462q-5-9-7.5-18.5T51-500q0-10 2.5-19.5T61-538q64-118 174.5-190T480-800q134 0 244.5 72T899-538q5 9 7.5 18.5T909-500q0 10-2.5 19.5T899-462q-64 118-174.5 190T480-200q-134 0-244.5-72ZM480-500Zm207.5 160.5Q782-399 832-500q-50-101-144.5-160.5T480-720q-113 0-207.5 59.5T128-500q50 101 144.5 160.5T480-280q113 0 207.5-59.5Z"/></svg>`,
        visibility_off: `<svg viewBox="0 -960 960 960"><path d="M607-627q29 29 42.5 66t9.5 76q0 15-11 25.5T622-449q-15 0-25.5-10.5T586-485q5-26-3-50t-25-41q-17-17-41-26t-51-4q-15 0-25.5-11T430-643q0-15 10.5-25.5T466-679q38-4 75 9.5t66 42.5Zm-127-93q-19 0-37 1.5t-36 5.5q-17 3-30.5-5T358-742q-5-16 3.5-31t24.5-18q23-5 46.5-7t47.5-2q137 0 250.5 72T904-534q4 8 6 16.5t2 17.5q0 9-1.5 17.5T905-466q-18 40-44.5 75T802-327q-12 11-28 9t-26-16q-10-14-8.5-30.5T753-392q24-23 44-50t35-58q-50-101-144.5-160.5T480-720Zm0 520q-134 0-245-72.5T60-463q-5-8-7.5-17.5T50-500q0-10 2-19t7-18q20-40 46.5-76.5T166-680l-83-84q-11-12-10.5-28.5T84-820q11-11 28-11t28 11l680 680q11 11 11.5 27.5T820-84q-11 11-28 11t-28-11L624-222q-35 11-71 16.5t-73 5.5ZM222-624q-29 26-53 57t-41 67q50 101 144.5 160.5T480-280q20 0 39-2.5t39-5.5l-36-38q-11 3-21 4.5t-21 1.5q-75 0-127.5-52.5T300-500q0-11 1.5-21t4.5-21l-84-82Zm319 93Zm-151 75Z"/></svg>`,
        wifi_off: `<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor"><path d="M762-84 414-434q-31 7-59.5 19T301-386q-21 14-46.5 14.5T212-389q-18-18-16.5-43.5T217-473q23-17 48.5-31t52.5-26l-90-90q-26 14-50.5 29.5T130-557q-20 16-45.5 16T42-559q-18-18-17-43t21-41q22-18 45-34.5t49-30.5l-56-56q-11-11-11-28t11-28q11-11 28-11t28 11l679 679q12 12 12 28.5T819-84q-12 11-28.5 11.5T762-84Zm-353-65.5Q380-179 380-220q0-42 29-71t71-29q42 0 71 29t29 71q0 41-29 70.5T480-120q-42 0-71-29.5ZM753-395q-16 16-37.5 15.5T678-396l-10-10-10-10-96-96q-13-13-5-27t28-9q45 11 85.5 31t75.5 47q18 14 20.5 36.5T753-395Zm165-164q-17 18-42 18.5T831-556q-72-59-161.5-91.5T480-680q-21 0-40.5 1.5T400-674q-25 4-45-10.5T331-724q-4-25 11-45t40-24q24-4 48.5-5.5T480-800q125 0 235.5 41.5T914-644q20 17 21 42t-17 43Z"/></svg>`
    };

    const THEME_ICONS = {
        "Summer Day": "https://s.eu.tankionline.com/static/images/summer_day.14c71f7e.svg",
        "Summer Evening": "https://s.eu.tankionline.com/static/images/summer_evening.a77627d2.svg",
        "Autumn": "https://s.eu.tankionline.com/static/images/autumn_day.ef311d44.svg",
        "Winter Day": "https://s.eu.tankionline.com/static/images/winter_day.618f73d3.svg"
    };

    // ==========================================
    // Resource Path Detection Logic (Pre-fetch URLs)
    // ==========================================
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
        if (host.includes('3dtank.com')) {
            return 'https://res.3dtank.com';
        } else if (host.includes('tankionline.com') && !host.includes('test-eu')) {
            return 'https://s.eu.tankionline.com';
        } else if (host.includes('test-eu.tankionline.com')) {
            return window.location.origin + '/resources';
        }
        return window.location.origin;
    }

    // ==========================================
    // Configuration and Data Structures
    // ==========================================
    const MAP_CONFIGS =[
        {
            name: "Highland REMASTER",
            themes:[
                { name: "Summer Day", path: "570/174542/371/116/31466700330223" },
                { name: "Summer Evening", path: "570/174542/371/160/31627625355227" },
                { name: "Autumn", path: "570/174542/371/121/31466510627011" },
                { name: "Winter Day", path: "570/174542/371/124/31466554330716" }
            ],
            defaultBlacklist:['tank','birch','beech','brick_pile','bd','forest','landscape','mount','chest','road','conc_pile','tree_flat','bush_flat','plane','tetrapod','tree','grass','flower','bush','river','pipe','ivy','rdecal','block']
        },
        {
            name: "Parma REMASTER",
            themes:[
                { name: "Summer Day", path: "570/174542/371/104/31526471323603" },
                { name: "Autumn", path: "570/174542/371/107/31526471745474" },
                { name: "Winter Day", path: "570/174542/371/112/31526472317644" }
            ],
            defaultBlacklist:['mount_','landscape','flat','ivy','bd','bush','flower','grass', 'crane', 'grab', 'car', 'track', 'crawler', 'tree', 'moss','pipe','saw','soil','garage','road','block','wall_frame','claw','const','chest','tetrapod','gouge']
        }
    ];

    // ==========================================
    // State and Storage Manager
    // ==========================================
    const STORAGE_KEY = 'Tanki_Remaster_Col_Settings';
    const SUB_SUFFIX_REGEX = /(?:-|_)?sub(?:-|_)?\d+$/i;

    class SettingsManager {
        constructor() { this.data = this.load(); }
        load() {
            let data = { hintShown: false, shortcut: null, maps: {} };
            try {
                const stored = localStorage.getItem(STORAGE_KEY);
                if (stored) data = { ...data, ...JSON.parse(stored) };
                let changed = false;
                for (const map in data.maps) {
                    for (const theme in data.maps[map]) {
                        const t = data.maps[map][theme];
                        if (t.knownModels && t.knownModels.length > 0) {
                            const cleaned = new Set();
                            t.knownModels.forEach(m => cleaned.add(m.replace(SUB_SUFFIX_REGEX, '')));
                            const newModels = Array.from(cleaned);
                            if (newModels.length !== t.knownModels.length || !newModels.every((m, i) => m === t.knownModels[i])) {
                                t.knownModels = newModels; changed = true;
                            }
                        }
                    }
                }
                if (changed) localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
            } catch(e) {}
            return data;
        }
        save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data)); }
        initThemeIfMissing(mapName, themeName) {
            if (!this.data.maps[mapName]) this.data.maps[mapName] = {};
            if (!this.data.maps[mapName][themeName]) {
                const config = MAP_CONFIGS.find(c => c.name === mapName);
                this.data.maps[mapName][themeName] = { blacklist: config ?[...config.defaultBlacklist] :[], whitelist:[], knownModels:[] };
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
                theme.knownModels = newKnownModels; changed = true;
            }
            if (changed) this.save();
        }
        resetTheme(mapName, themeName) {
            const config = MAP_CONFIGS.find(c => c.name === mapName);
            if (config) {
                this.data.maps[mapName][themeName].blacklist =[...config.defaultBlacklist];
                this.data.maps[mapName][themeName].whitelist =[];
                this.save();
            }
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
    // UI Layer (Shadow DOM)
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

                .m3-interactive {
                    position: relative; overflow: hidden; cursor: pointer;
                    transition: transform 0.2s cubic-bezier(0.2, 0, 0, 1), background-color 0.2s, border-color 0.2s;
                }
                .m3-interactive::after {
                    content: ""; position: absolute; inset: 0; background: currentColor; opacity: 0;
                    transition: opacity 0.2s; pointer-events: none;
                }
                .m3-interactive:hover::after { opacity: 0.08; }
                .m3-interactive:active { transform: scale(0.96); }

                .svg-icon {
                    display: inline-flex; align-items: center; justify-content: center;
                    width: 24px; height: 24px; flex-shrink: 0;
                }
                .svg-icon svg { width: 100%; height: 100%; fill: currentColor; }

                .overlay {
                    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                    background: rgba(0, 0, 0, 0.6); opacity: 0; pointer-events: none;
                    transition: opacity 0.3s cubic-bezier(0.2, 0, 0, 1);
                    backdrop-filter: blur(4px);
                }

                .drawer {
                    position: fixed; top: 0; right: 0;
                    width: 420px; max-width: 85vw; height: 100%;
                    background: var(--bg); color: var(--on-surface);
                    pointer-events: auto; transform: translateX(100%);
                    transition: transform 0.4s cubic-bezier(0.2, 0, 0, 1);
                    display: flex; flex-direction: column;
                    box-shadow: -8px 0 32px rgba(0,0,0,0.6);
                    border-top-left-radius: 24px; border-bottom-left-radius: 24px;
                }

                .header {
                    padding: 24px 24px 16px 24px;
                    display: flex; justify-content: space-between; align-items: center;
                }
                .title { font-size: 22px; font-weight: 600; color: var(--primary); margin: 0; }

                .icon-btn {
                    background: transparent; border: none; color: var(--on-surface-variant);
                    padding: 8px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
                }

                .content { flex: 1; overflow-y: auto; padding: 16px 24px 24px 24px; }
                .content::-webkit-scrollbar { width: 6px; }
                .content::-webkit-scrollbar-thumb { background: var(--surface-container-highest); border-radius: 3px; }

                .link-card {
                    background: var(--surface-container-high); border-radius: 16px;
                    padding: 16px; margin-bottom: 24px; display: flex; flex-direction: column; gap: 12px;
                }

                .btn {
                    background: var(--surface-container-highest); color: var(--on-surface);
                    border: 1px solid transparent; padding: 10px 16px; border-radius: 20px;
                    font-weight: 500; display: inline-flex; align-items: center; gap: 8px;
                }
                .btn.primary { background: rgba(118, 255, 51, 0.15); color: var(--primary); border-color: var(--primary); }

                .map-card {
                    background: var(--surface-container); border-radius: 24px;
                    padding: 16px; margin-bottom: 16px; border: 1px solid var(--surface-container-high);
                }
                .map-title {
                    font-size: 16px; font-weight: 600; color: var(--on-surface);
                    margin-bottom: 12px; padding-left: 4px;
                }
                .theme-tab-row { display: flex; gap: 12px; overflow-x: auto; padding-bottom: 8px; }
                .theme-tab-row::-webkit-scrollbar { height: 0; }

                .theme-tab {
                    width: 48px; height: 48px; border-radius: 24px; flex-shrink: 0;
                    background: var(--surface-container-highest); border: 2px solid transparent;
                    display: flex; align-items: center; justify-content: center;
                    color: var(--on-surface-variant);
                }
                .theme-tab.active { background: rgba(118, 255, 51, 0.15); border-color: var(--primary); }

                .theme-icon-mask {
                    width: 26px; height: 26px; background-color: var(--on-surface-variant);
                    -webkit-mask-size: contain; -webkit-mask-repeat: no-repeat; -webkit-mask-position: center;
                    mask-size: contain; mask-repeat: no-repeat; mask-position: center;
                }
                .theme-tab.active .theme-icon-mask { background-color: var(--primary); }

                .theme-content-wrapper {
                    display: grid; grid-template-rows: 0fr;
                    transition: grid-template-rows 0.4s cubic-bezier(0.2, 0, 0, 1), margin-top 0.4s cubic-bezier(0.2, 0, 0, 1);
                    margin-top: 0;
                }
                .theme-content-wrapper.open { grid-template-rows: 1fr; margin-top: 16px; }
                .theme-content-inner { overflow: hidden; display: flex; flex-direction: column; gap: 16px; }

                .theme-details-header {
                    display: flex; justify-content: space-between; align-items: center;
                    padding-bottom: 8px; border-bottom: 1px solid var(--surface-container-highest);
                }
                .theme-details-title { font-size: 15px; font-weight: 500; color: var(--primary); }

                .tags-container {
                    display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
                    background: var(--surface-container-high); border-radius: 12px; padding: 10px;
                    border: 1px solid var(--outline); transition: border-color 0.2s; cursor: text;
                }
                .tags-container:focus-within { border-color: var(--primary); }

                .tag-chip {
                    background: var(--surface-container-highest); color: var(--on-surface);
                    height: 32px; padding: 0 4px 0 12px; border-radius: 8px;
                    display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 500;
                    border: 1px solid var(--outline);
                }
                .tag-chip-remove {
                    display: flex; align-items: center; justify-content: center;
                    width: 24px; height: 24px; border-radius: 50%; color: var(--on-surface-variant);
                }
                .tag-chip-remove:hover { color: var(--error); background: rgba(255,102,102,0.1); }

                .tag-input {
                    background: transparent; border: none; outline: none; color: var(--on-surface);
                    flex: 1; min-width: 130px; font-size: 14px; height: 32px;
                }

                .model-list {
                    display: flex; flex-direction: column; gap: 4px;
                    background: var(--surface-container-high); border-radius: 12px; padding: 8px;
                    max-height: 250px; overflow-y: auto; border: 1px solid var(--outline);
                }
                .model-list::-webkit-scrollbar { width: 4px; }
                .model-list::-webkit-scrollbar-thumb { background: var(--surface-container-highest); border-radius: 2px; }

                .model-item {
                    display: flex; justify-content: space-between; align-items: center;
                    padding: 8px 12px; border-radius: 8px; transition: background 0.2s;
                }
                .model-item:hover { background: var(--surface-container-highest); }
                .model-name { font-size: 13px; word-break: break-all; }

                .model-item.filtered .model-name { color: var(--error); text-decoration: line-through; opacity: 0.8; }
                .model-item.included .model-name { color: var(--primary); }

                .toast {
                    position: fixed; bottom: 32px; left: 50%; transform: translateX(-50%);
                    background: var(--on-surface-variant); color: var(--bg);
                    padding: 12px 24px; border-radius: 24px;
                    font-weight: 600; opacity: 0; pointer-events: none;
                    transition: opacity 0.3s cubic-bezier(0.2, 0, 0, 1), transform 0.3s cubic-bezier(0.2, 0, 0, 1);
                    box-shadow: 0 8px 24px rgba(0,0,0,0.4); z-index: 1000000;
                }
            `;
            this.shadow.appendChild(style);
        }

        buildDOM() {
            this.toastEl = document.createElement('div');
            this.toastEl.className = 'toast';
            this.shadow.appendChild(this.toastEl);

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

            // Offline mode panel
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
                    <h2 class="title">${I18N.panelTitle}</h2>
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
                    if (!window._offlineMode) {
                        window._offlineMode = true;
                        if (window._activeWs) {
                            window._activeWs.close(); // Disconnect connection
                        }

                        // Update UI
                        offlineText.innerText = I18N.offlineModeActiveBtn;
                        offlineBtn.style.background = 'rgba(255, 51, 102, 0.15)';
                        offlineBtn.style.borderColor = 'var(--error)';
                        offlineBtn.style.color = 'var(--error)';

                        // Show toast
                        this.showToast(I18N.toastOfflineActivated, 5000);
                        this.toggle(false); // Auto close drawer
                    } else {
                        this.showToast(I18N.toastOfflineAlreadyActive, 4000);
                    }
                });
            }

            if (!this.isMobile && this.shortcutBtn) {
                this.shortcutBtn.addEventListener('click', () => {
                    this.isRecordingShortcut = true;
                    this.shortcutText.innerText = I18N.pressKeys;
                    this.shortcutBtn.style.color = "var(--error)";
                });

                window.addEventListener('keydown', (e) => {
                    if (this.isRecordingShortcut) {
                        e.preventDefault();
                        if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
                        const sc = { ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, key: e.key.toLowerCase() };
                        Settings.data.shortcut = sc;
                        Settings.save();
                        this.isRecordingShortcut = false;
                        this.shortcutBtn.style.color = "";
                        this.updateShortcutUI();
                    } else {
                        const sc = Settings.data.shortcut;
                        if (sc && e.ctrlKey === sc.ctrl && e.shiftKey === sc.shift && e.altKey === sc.alt && e.key.toLowerCase() === sc.key) {
                            e.preventDefault();
                            this.toggle();
                        }
                    }
                });
            }

            let touchStartX = 0; let touchStartY = 0;
            window.addEventListener('touchstart', e => {
                touchStartX = e.changedTouches[0].screenX; touchStartY = e.changedTouches[0].screenY;
            }, {passive: true});
            window.addEventListener('touchend', e => {
                let touchEndX = e.changedTouches[0].screenX; let touchEndY = e.changedTouches[0].screenY;
                const inTopRightCorner = touchStartX > window.innerWidth - 50 && touchStartY < 120;
                const isValidSwipe = (touchEndX - touchStartX < -80) && (Math.abs(touchEndY - touchStartY) < 80);
                if (inTopRightCorner && isValidSwipe) {
                    this.toggle(true);
                    if (this.isMobile && !Settings.data.hintShown) { Settings.data.hintShown = true; Settings.save(); }
                }
            }, {passive: true});
        }

        updateShortcutUI() {
            if (!this.isMobile && this.shortcutText) {
                const sc = Settings.data.shortcut;
                if (!sc) {
                    this.shortcutText.innerText = I18N.setupShortcut; this.shortcutBtn.classList.remove('primary');
                } else {
                    const parts =[];
                    if (sc.ctrl) parts.push('Ctrl'); if (sc.alt) parts.push('Alt'); if (sc.shift) parts.push('Shift');
                    parts.push(sc.key.toUpperCase());
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
                    this.shortcutBtn.style.color = "var(--error)";
                    setTimeout(() => { this.shortcutBtn.style.color = ""; }, 1000);
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
                        if (e.key === 'Enter' || e.key === ',') {
                            e.preventDefault();
                            const val = tagInput.value.trim().replace(/,/g, '');
                            if (val) {
                                const tData = Settings.getThemeData(mapConfig.name, theme.name);
                                if (!tData.blacklist.includes(val)) {
                                    Settings.setBlacklistWords(mapConfig.name, theme.name,[...tData.blacklist, val]);
                                    renderTags(); renderModels();
                                }
                            }
                            tagInput.value = '';
                        } else if (e.key === 'Backspace' && tagInput.value === '') {
                            const tData = Settings.getThemeData(mapConfig.name, theme.name);
                            if (tData.blacklist.length > 0) {
                                const newList =[...tData.blacklist]; newList.pop();
                                Settings.setBlacklistWords(mapConfig.name, theme.name, newList);
                                renderTags(); renderModels();
                            }
                        }
                    };
                    tagsContainer.appendChild(tagInput);
                    tagsContainer.onclick = () => tagInput.focus();
                    contentInner.appendChild(tagsContainer);

                    let rawFolderId = theme.path.split('/').pop();
                    let decimalFolderId = rawFolderId;
                    if (/^[0-7]+$/.test(rawFolderId)) {
                        try { decimalFolderId = window.BigInt("0o" + rawFolderId).toString(10); } catch (e) {}
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
                            const sortedModels =[...tData.knownModels].sort((a,b) => a.localeCompare(b));
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
    // Core Collision Parsing and Generation Logic
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
            let str = "";
            while(true) {
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
        constructor() { this.chunks =[]; this.length = 0; }
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
        _add(b) { this.chunks.push(b); this.length += b.length; }
        toUint8Array() {
            const res = new Uint8Array(this.length);
            let offset = 0;
            for(const chunk of this.chunks) { res.set(chunk, offset); offset += chunk.length; }
            return res;
        }
    }

    async function decompressZlib(uint8array) {
        const ds = new window.DecompressionStream("deflate");
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

    function parseA3DSimple(buffer) {
        const stream = new BinaryStream(buffer);
        const sig = new TextDecoder().decode(stream.readBytes(4));
        if (sig !== "A3D\0") throw new Error("Invalid A3D signature");
        const version = stream.readUint16(true);
        stream.readUint16(true); stream.readUint32(true); stream.readUint32(true);

        const matSig = stream.readUint32(true); const matLen = stream.readUint32(true); const matCount = stream.readUint32(true);
        for(let i=0; i<matCount; i++) {
            if(version===3) { stream.readLengthPrefixedStringA3D(); stream.offset+=12; stream.readLengthPrefixedStringA3D(); }
            else { stream.readNullTerminatedString(); stream.offset+=12; stream.readNullTerminatedString(); }
        }
        if(version===3) stream.offset += (((matLen + 3) >> 2) << 2) - matLen;

        const meshes =[];
        const meshSig = stream.readUint32(true); const meshLen = stream.readUint32(true); const meshCount = stream.readUint32(true);

        for(let i=0; i<meshCount; i++) {
            let mName = "Mesh_" + i;
            if(version===3) { mName = stream.readLengthPrefixedStringA3D(); stream.offset += 28; }
            const vertexCount = stream.readUint32(true);
            const vBufCount = stream.readUint32(true);
            const buffers = {};
            for(let b=0; b<vBufCount; b++) {
                const bType = stream.readUint32(true);
                const numFloats = {1:3, 2:2, 3:3, 4:2, 5:4, 6:3}[bType] || 0;
                const byteLen = vertexCount * numFloats * 4;
                if (bType === 1) {
                    const sliceBuf = stream.buffer.slice(stream.offset, stream.offset + byteLen);
                    buffers.position = new Float32Array(sliceBuf.buffer);
                }
                stream.offset += byteLen;
            }

            const submeshCount = stream.readUint32(true);
            let mainIndices =[];

            for(let s=0; s<submeshCount; s++) {
                if(version===2) {
                    const fCount = stream.readUint32(true);
                    const iCount = fCount * 3;
                    const sliceBuf = stream.buffer.slice(stream.offset, stream.offset + iCount * 2);
                    stream.offset += iCount * 2 + fCount * 4; stream.readUint16(true);
                    const indices = new Uint16Array(sliceBuf.buffer, sliceBuf.byteOffset, iCount);
                    for(let k=0; k<indices.length; k++) mainIndices.push(indices[k]);
                } else {
                    const iCount = stream.readUint32(true);
                    const sliceBuf = stream.buffer.slice(stream.offset, stream.offset + iCount * 2);
                    stream.offset += iCount * 2; stream.offset += (((iCount * 2 + 3) >> 2) << 2) - (iCount * 2);
                    const indices = new Uint16Array(sliceBuf.buffer, sliceBuf.byteOffset, iCount);
                    for(let k=0; k<indices.length; k++) mainIndices.push(indices[k]);
                }
            }
            meshes.push({ name: mName, position: buffers.position, index: mainIndices });
        }

        const namedMeshes = {};
        if (stream.offset < stream.buffer.byteLength) {
            const transformSig = stream.readUint32(true);
            if (transformSig === 3) {
                const transformLen = stream.readUint32(true); const transformCount = stream.readUint32(true);
                const transforms =[];
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
                    const objects =[];
                    for (let i = 0; i < objectCount; i++) {
                        let name = ""; let mID = 0; let tID = 0;
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
                            let newPos = new Float32Array(mesh.position.length);
                            for(let v=0; v<mesh.position.length; v+=3) {
                                let x = mesh.position[v] * tf.sx; let y = mesh.position[v+1] * tf.sy; let z = mesh.position[v+2] * tf.sz;
                                let ix = tf.rw * x + tf.ry * z - tf.rz * y; let iy = tf.rw * y + tf.rz * x - tf.rx * z;
                                let iz = tf.rw * z + tf.rx * y - tf.ry * x; let iw = -tf.rx * x - tf.ry * y - tf.rz * z;
                                let dx = ix * tf.rw + iw * -tf.rx + iy * -tf.rz - iz * -tf.ry;
                                let dy = iy * tf.rw + iw * -tf.ry + iz * -tf.rx - ix * -tf.rz;
                                let dz = iz * tf.rw + iw * -tf.rz + ix * -tf.ry - iy * -tf.rx;
                                newPos[v] = dx + tf.px; newPos[v+1] = dy + tf.py; newPos[v+2] = dz + tf.pz;
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

    async function parseMapBin(buffer) {
        const stream = new BinaryStream(buffer);
        const packet = await unwrapPacket(stream);
        const originalPacketBuffer = new Uint8Array(packet.buffer);

        const fullOriginalBits =[];
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

        const optMask =[...fullOriginalBits].reverse();
        const popBit = () => optMask.pop();

        const skipObjectArray = (p, cb) => { const len = p.readStringLength(); for(let i=0; i<len; i++) cb(p); };
        const readV3 = () =>[packet.readFloat32(false), packet.readFloat32(false), packet.readFloat32(false)];

        const result = { props:[] };
        result.originalPacketBuffer = originalPacketBuffer;

        if (popBit()) {
            const atlasLen = packet.readStringLength();
            for(let i=0; i<atlasLen; i++) {
                packet.readInt32(false); packet.readString(); packet.readUint32(false);
                const rectLen = packet.readStringLength();
                for(let j=0; j<rectLen; j++) {
                    packet.readUint32(false); packet.readString(); packet.readString();
                    packet.readUint32(false); packet.readUint32(false); packet.readUint32(false);
                }
                packet.readUint32(false);
            }
        }

        if (popBit()) skipObjectArray(packet, p => { p.readUint32(false); p.readString(); p.offset+=12; p.readString(); });

        result.collisionOffsetStart = packet.offset;

        const readCols = () => {
            let len = packet.readStringLength(); for(let i=0; i<len; i++) { packet.offset += 9 * 4; }
            len = packet.readStringLength(); for(let i=0; i<len; i++) { packet.offset += 8 + 6*4 + 8; }
            len = packet.readStringLength(); for(let i=0; i<len; i++) { packet.offset += 8 + 15*4; }
        };
        readCols(); readCols();

        result.collisionOffsetEnd = packet.offset;

        const matLen = packet.readStringLength();
        for(let i=0; i<matLen; i++) {
            packet.readUint32(false); packet.readString();
            if (popBit()) skipObjectArray(packet, p => { p.readString(); p.offset+=4; });
            packet.readString();
            const texLen = packet.readStringLength();
            for(let j=0; j<texLen; j++) {
                if (popBit()) packet.readString();
                packet.readString(); packet.readString();
            }
            if (popBit()) skipObjectArray(packet, p => { p.readString(); p.offset+=8; });
            if (popBit()) skipObjectArray(packet, p => { p.readString(); p.offset+=12; });
            if (popBit()) skipObjectArray(packet, p => { p.readString(); p.offset+=16; });
        }

        if (popBit()) skipObjectArray(packet, p => { p.offset+=28; });

        const propLen = packet.readStringLength();
        for(let i=0; i<propLen; i++) {
            let grpName = ""; if(popBit()) grpName = packet.readString();
            const id = packet.readUint32(false); const libName = packet.readString();
            const matID = packet.readUint32(false); const name = packet.readString();
            const pos = readV3(); const rot = popBit() ? readV3() :[0,0,0]; const scale = popBit() ? readV3() :[1,1,1];
            result.props.push({ id, grpName, libName, matID, name, pos, rot, scale });
        }

        return result;
    }

    async function generateMapBinLocal(mapUrl, originalBuffer, mapConfig, themeConfig) {
        const mapBaseUrl = mapUrl.substring(0, mapUrl.lastIndexOf('/'));
        const mapData = await parseMapBin(originalBuffer);

        let mainA3dData = null;
        try {
            const a3dRes = await window.originalFetch(`${mapBaseUrl}/models.a3d`);
            if (a3dRes.ok) {
                const a3dBuf = await a3dRes.arrayBuffer();
                mainA3dData = parseA3DSimple(a3dBuf);
            }
        } catch(e) {}

        const extraA3dCache = {}; const newShapes3 =[];
        const discoveredModels = new Set();

        for (const prop of mapData.props) {
            const exactName = prop.name || "";
            if (exactName) discoveredModels.add(exactName);

            if (Settings.isModelFiltered(mapConfig.name, themeConfig.name, exactName)) continue;

            let geometry = null;
            if (mainA3dData) {
                if (mainA3dData.namedMeshes && mainA3dData.namedMeshes[prop.name]) { geometry = mainA3dData.namedMeshes[prop.name]; }
                else {
                    const matchedKey = Object.keys(mainA3dData.namedMeshes || {}).find(k => k.toLowerCase() === prop.name.toLowerCase());
                    if (matchedKey) geometry = mainA3dData.namedMeshes[matchedKey];
                }
            }

            if (!geometry && prop.libName) {
                const fileName = prop.name + ".a3d";
                if (!extraA3dCache[fileName]) {
                    try {
                        const res = await window.originalFetch(`${mapBaseUrl}/${fileName}`);
                        if (res.ok) { const buf = await res.arrayBuffer(); extraA3dCache[fileName] = parseA3DSimple(buf); }
                        else { extraA3dCache[fileName] = "failed"; }
                    } catch(e) { extraA3dCache[fileName] = "failed"; }
                }
                const extraData = extraA3dCache[fileName];
                if (extraData && extraData !== "failed") {
                    if (extraData.namedMeshes && Object.keys(extraData.namedMeshes).length > 0) { geometry = Object.values(extraData.namedMeshes)[0]; }
                    else if (extraData.meshes && extraData.meshes.length > 0) { geometry = extraData.meshes[0]; }
                }
            }

            if (!geometry) continue;

            const px = prop.pos[0], py = prop.pos[1], pz = prop.pos[2];
            const rx = prop.rot[0], ry = prop.rot[1], rz = prop.rot[2];
            const sx = prop.scale[0], sy = prop.scale[1], sz = prop.scale[2];
            const posAttr = geometry.position; const index = geometry.index;
            const getVertex = (idx) => [posAttr[idx * 3] * sx, posAttr[idx * 3 + 1] * sy, posAttr[idx * 3 + 2] * sz];

            if (index && index.length > 0) {
                for (let i = 0; i < index.length; i += 3) {
                    const v1 = getVertex(index[i]); const v2 = getVertex(index[i+1]); const v3 = getVertex(index[i+2]);
                    newShapes3.push({ f1: 0, data:[ px, py, pz, rx, ry, rz, ...v1, ...v2, ...v3 ] });
                }
            } else {
                for (let i = 0; i < posAttr.length / 3; i += 3) {
                    const v1 = getVertex(i); const v2 = getVertex(i+1); const v3 = getVertex(i+2);
                    newShapes3.push({ f1: 0, data:[ px, py, pz, rx, ry, rz, ...v1, ...v2, ...v3 ] });
                }
            }
        }

        Settings.addKnownModels(mapConfig.name, themeConfig.name, discoveredModels);
        if (uiInstance && uiInstance.isOpen) { uiInstance.notifyModelsDiscovered(mapConfig.name, themeConfig.name); }

        const bwCol = new BinaryWriter();
        bwCol.writeStringLength(0); bwCol.writeStringLength(0); bwCol.writeStringLength(newShapes3.length);
        for (const d of newShapes3) { bwCol.writeFloat64(d.f1, false); for (let i=0; i<15; i++) bwCol.writeFloat32(d.data[i], false); }
        bwCol.writeStringLength(0); bwCol.writeStringLength(0); bwCol.writeStringLength(0);

        const colBytes = bwCol.toUint8Array();
        const origBuf = mapData.originalPacketBuffer;
        const start = mapData.collisionOffsetStart; const end = mapData.collisionOffsetEnd;

        const finalPayload = new Uint8Array(start + colBytes.length + (origBuf.length - end));
        finalPayload.set(origBuf.subarray(0, start), 0);
        finalPayload.set(colBytes, start);
        finalPayload.set(origBuf.subarray(end), start + colBytes.length);

        const bwFinal = new BinaryWriter();
        const len = finalPayload.length;
        let flags = 0;
        if (len <= 0x3FFF) {
            flags = (len >> 8) & 0b00111111; bwFinal.writeUint8(flags); bwFinal.writeUint8(len & 0xFF);
        } else {
            flags = 0b10000000 | (Math.floor(len / 16777216) & 0b00111111);
            bwFinal.writeUint8(flags); bwFinal.writeUint8((len >> 16) & 0xFF); bwFinal.writeUint8((len >> 8) & 0xFF); bwFinal.writeUint8(len & 0xFF);
        }
        bwFinal.writeBytes(finalPayload);
        return bwFinal.toUint8Array();
    }

    const blobCache = {};
    async function generateMapBinLocalAndGetBlobUrl(url, mapConfig, themeConfig) {
        if (blobCache[url]) return blobCache[url];
        console.log(`[Tampermonkey] Generating local collision for map: ${mapConfig.name} - ${themeConfig.name}`);
        const res = await window.originalFetch(url);
        const buffer = await res.arrayBuffer();
        try {
            const newBuffer = await generateMapBinLocal(url, buffer, mapConfig, themeConfig);
            const blob = new Blob([newBuffer], { type: 'application/octet-stream' });
            const blobUrl = URL.createObjectURL(blob);
            blobCache[url] = blobUrl;
            return blobUrl;
        } catch(e) {
            console.error(`[Tampermonkey] Failed locally for ${mapConfig.name}`, e); return url;
        }
    }

    // ==========================================
    // Auto Pre-load Models (Pre-load map.bin to discover models without joining)
    // ==========================================
    async function preloadModels() {
        const base = getResourceBase();
        for (const map of MAP_CONFIGS) {
            for (const theme of map.themes) {
                const tData = Settings.getThemeData(map.name, theme.name);
                if (tData.knownModels.length > 0) continue;
                let path = theme.path.startsWith('/') ? theme.path : '/' + theme.path;
                let url = base + path; if (!url.endsWith('map.bin')) url += '/map.bin';
                try {
                    const res = await window.originalFetch(url);
                    if (res.ok) {
                        const buffer = await res.arrayBuffer();
                        const parsed = await parseMapBin(buffer);
                        const discovered = new Set();
                        parsed.props.forEach(p => { if(p.name) discovered.add(p.name); });
                        if (discovered.size > 0) {
                            Settings.addKnownModels(map.name, theme.name, discovered);
                            if (uiInstance) uiInstance.notifyModelsDiscovered(map.name, theme.name);
                        }
                    }
                } catch(e) { console.warn(`[Tampermonkey] Preload failed for ${theme.name}, waiting for actual join...`, e); }
            }
        }
    }

    // ==========================================
    // Interceptors and Initialization
    // ==========================================
    let uiInstance = null;

    document.addEventListener('DOMContentLoaded', () => {
        uiInstance = new SettingsUI();
        preloadModels();
    });

    const originalFetch = window.fetch;
    window.originalFetch = originalFetch;

    window.fetch = async function(input, init) {
        let url = (input instanceof Request) ? input.url : String(input);

        if (url.endsWith("map.bin")) {
            for (const mapConfig of MAP_CONFIGS) {
                for (const themeConfig of mapConfig.themes) {
                    if (url.includes(themeConfig.path)) {
                        console.log(`[Tampermonkey] Fetch Intercepted & Mocked: ${mapConfig.name}`);
                        const res = await originalFetch.call(this, input, init);
                        const buffer = await res.arrayBuffer();
                        const newBuffer = await generateMapBinLocal(url, buffer, mapConfig, themeConfig);
                        return new Response(newBuffer, {
                            status: 200, statusText: "OK",
                            headers: { "Content-Type": "application/octet-stream", "Content-Length": newBuffer.length.toString() }
                        });
                    }
                }
            }
        }
        return originalFetch.call(this, input, init);
    };

    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url, ...args) {
        this._url = String(url); this._method = method; this._openArgs = args;
        this._matchedMapConfig = null; this._matchedThemeConfig = null;
        if (this._url.endsWith("map.bin")) {
            for (const mapConfig of MAP_CONFIGS) {
                for (const themeConfig of mapConfig.themes) {
                    if (this._url.includes(themeConfig.path)) {
                        this._matchedMapConfig = mapConfig; this._matchedThemeConfig = themeConfig; break;
                    }
                }
                if (this._matchedMapConfig) break;
            }
        }
        if (!this._matchedMapConfig) return originalOpen.call(this, method, url, ...args);
    };

    XMLHttpRequest.prototype.send = function(body) {
        if (this._matchedMapConfig && this._matchedThemeConfig) {
            generateMapBinLocalAndGetBlobUrl(this._url, this._matchedMapConfig, this._matchedThemeConfig).then(blobUrl => {
                originalOpen.call(this, this._method, blobUrl, ...this._openArgs);
                originalSend.call(this, body);
            });
            return;
        }
        return originalSend.call(this, body);
    };

})();
