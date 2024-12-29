// ==UserScript==
// @name         3D坦克皮肤模型替换（测试版）
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  替换3D坦克炮塔、底盘、无人机皮肤、节日装饰品、迷彩
// @author       Testanki
// @match        *://*.3dtank.com/play*
// @match        *://*.tankionline.com/play*
// @match        *://*.test-eu.tankionline.com/*
// @match        *://*.test-ru.tankionline.com/*
// @grant        none
// ==/UserScript==

(function() {
	'use strict';
        const currentVersionCode = 7;
    const versionUrl = 'https://testanki1.github.io/models/version.json';

    // 检查更新
    fetch(versionUrl)
        .then(response => {
            if (!response.ok) throw new Error('网络错误');
            return response.json();
        })
        .then(data => {
            const latestVersion = data.version;
            const latestVersionCode = data.version_code;
            const updateInfo = data.update_info;
            const downloadUrl = data.download_url;

            if (latestVersionCode > currentVersionCode) {
                const message = `
                    有新版本可用！\n
                    最新版本：${latestVersion}\n
                    更新内容：${updateInfo}\n
                `;
                if (confirm(message + "点击确定下载新版本？")) {
                    window.location.href = downloadUrl;
                }
            }
        })
        .catch(error => {
            console.error('更新检查失败:', error);
        });

const currentUrl = window.location.href;
	const turretsRedirectMap = {
		"firebird": {
			"default": "573/113511/153/137/31167700271626",
			"XT": "0/16722/167/100/31033604530020",
			"LC": "606/154706/226/46/31033604523453",
			"DC": "574/111547/344/362/31033604472221",
			"DC_OLD": "546/140033/371/67/31033604465511",
			"GT": "620/113215/220/43/31033604507506"
		},
		"freeze": {
			"default": "575/153310/123/250/31167700273561",
			"XT": "545/126533/221/204/31033604562720",
			"XT_HD": "607/133452/43/130/31033604565055",
			"LC": "605/14613/143/127/31033604552551",
			"IC": "605/135171/211/104/31033604546324",
			"GT": "613/146472/243/156/31033604531607",
			"SE": "575/141301/263/323/31033604560325"
		},
		"isida": {
			"default": "605/12650/334/263/31167700276234",
			"XT": "547/121262/134/345/31033604677132",
			"LC": "606/155040/263/253/31033604672363",
			"GT": "605/12655/270/246/31033604660301"
		},
		"tesla": {
			"default": "567/20040/100/57/31167700274267",
			"XT_HD": "567/20040/100/30/31033605140327",
			"LC": "604/60235/244/25/31033605125726",
			"RF": "616/167677/151/223/31033605130425"
		},
		"hammer": {
			"default": "611/147301/37/333/31167700274311",
			"XT": "550/160307/363/221/31033604643362",
			"LC": "601/166273/204/221/31033604634650",
			"DC": "604/4215/36/135/31033605266363",
            "IC": "623/41371/53/15/31150312633557",
            "GT": "623/151743/74/104/31173555130540"
		},
		"twins": {
			"default": "575/4122/336/247/31167700272424",
			"XT": "547/35525/56/66/31033605232035",
			"LC": "577/157371/340/255/31033605210405",
			"SP": "573/113554/112/100/31033605224225",
			"RF": "607/24114/77/214/31033605215045",
			"GT": "617/163502/325/41/31033605175257"
		},
		"ricochet": {
			"default": "603/121326/210/264/31167700267554",
			"XT": "546/5477/152/352/31033605004772",
			"LC": "556/131232/204/234/31033604772501",
			"RF": "577/176465/41/10/31033605000151"
		},
		"vulcan": {
			"default": "622/107753/242/303/31167700276134",
			"XT": "0/16722/260/334/31033604733427",
			"PR": "556/15741/256/125/31033605241104",
			"UT": "560/31363/210/347/31033604717360",
			"DC": "613/2044/314/224/31033604703141"
		},
		"smoky": {
			"default": "566/114246/64/4/31167700272332",
			"XT": "0/114/153/53/31033605053755",
			"LC": "577/171773/42/54/31033605047550",
			"GT": "607/133661/133/27/31033605036471"
		},
		"striker": {
			"default": "0/16723/37/11/31167700275767",
			"XT": "551/70756/233/273/31033605117137",
			"UT": "570/164502/316/245/31033605234224"
		},
		"thunder": {
			"default": "601/105644/16/124/31167700273301",
			"XT": "0/16722/167/101/31033605170145",
			"PR": "557/14251/175/251/31033605155427",
			"UT": "551/122165/142/136/31033605157155",
			"LC": "545/14356/174/306/31033605151121",
			"GT": "603/104171/41/115/31033605030161",
			"XT_HD": "617/134472/113/60/31033605164111"
		},
		"scorpion": {
			"default": "600/40107/4/364/31172771520222",
			"XT_HD": "602/132677/206/41/31033605253521"
		},
		"magnum": {
			"default": "0/16723/57/323/31167700274631",
			"XT": "550/75104/53/350/31033604732253",
			"SP": "612/42416/374/133/31033604725533",
            "SNOWMAN": "575/77444/65/233/31167700273100"
		},
		"railgun": {
			"default": "567/105205/202/122/31167700270037",
			"XT": "0/16722/6/301/31033604764033",
			"LC": "550/121443/145/146/31033604745456",
			"PR": "553/116715/27/132/31033604752652",
			"UT": "556/177362/212/346/31033604754562",
			"GT": "606/155010/245/142/31033604735353"
		},
		"gauss": {
			"default": "611/61722/256/76/31167700275006",
			"XT": "560/124462/246/14/31033604617041",
			"PR": "554/41313/45/141/31033604572567",
			"UT": "563/51105/72/133/31033605272237",
			"GT": "613/146442/233/316/31033604574743",
			"IC": "614/75662/326/41/31033604602505"
		},
		"shaft": {
			"default": "622/21305/321/374/31167700272525",
			"XT": "546/73531/62/216/31033605014624",
			"LC": "600/170471/174/26/31033605260624",
                        "DC": "622/107573/220/101/31123207764670"
		}
	};

	const hullsRedirectMap = {
		"wasp": {
			"default": "574/111243/33/322/31167700276263",
			"XT": "0/16722/167/77/31033610130736",
			"DC": "574/113351/211/154/31033610052500",
			"LC": "577/171773/42/62/31033610115062",
			"GT": "620/112773/325/5/31033610100325"
		},
		"hopper": {
			"default": "564/5207/367/304/31167700276066",
			"XT_HD": "564/41402/173/47/31033610315703",
			"RF": "616/167677/151/211/31033607331063"
		},
		"hornet": {
			"default": "566/70102/323/346/31167700274103",
			"XT": "0/16722/6/305/31033607424605",
			"LC": "551/32007/310/225/31033607400400",
			"PR": "553/1466/317/276/31033607413764",
			"UT": "562/165115/303/236/31033610210055",
			"GT": "605/27506/77/216/31033607347661",
            "XT_HD": "623/127512/235/65/31166467457145"
		},
		"viking": {
			"default": "571/121215/5/23/31167700276142",
			"XT": "0/16722/167/76/31033610034165",
			"LC": "545/14403/373/22/31033607776373",
			"PR": "557/14273/215/344/31033610007323",
			"UT": "552/54655/57/366/31033610356100",
			"GT": "603/64520/263/244/31033607745375",
			"XT_HD": "606/155145/337/205/31033610020277",
			"DC": "604/7224/253/317/31033610256112"
		},
		"crusader": {
			"default": "566/4547/232/306/31167700273327",
			"XT_HD": "566/40410/335/237/31033610341433",
			"RF": "607/24114/77/31/31033607224317"
		},
		"hunter": {
			"default": "567/166366/55/140/31167700272025",
			"XT": "547/121236/44/244/31033607523721",
			"LC": "577/157453/256/241/31033607506717",
			"PR": "554/155720/136/73/31033607521775",
			"UT": "561/113562/137/140/31033610302174",
			"GT": "607/133630/253/171/31033607471473",
			"DC": "613/14407/324/50/31033607446007"
		},
		"paladin": {
			"default": "573/47363/125/65/31167700273617",
			"XT_HD": "573/47363/125/60/31033610367705",
			"RF": "577/176465/41/12/31033607640405"
		},
		"dictator": {
			"default": "602/61700/245/106/31167700275611",
			"XT": "546/125503/267/14/31033607303502",
			"LC": "600/170471/174/17/31033610146055",
			"GT": "606/154745/265/375/31033607235725",
			"SP": "621/133615/104/57/31066757323353"
		},
		"titan": {
			"default": "606/22645/10/357/31167700270522",
			"XT": "545/41207/304/132/31033607734572",
			"LC": "601/166273/204/222/31033607677022",
			"PR": "555/103037/265/247/31033607711541",
			"SP": "612/40333/350/361/31033607720032"
		},
		"ares": {
			"default": "560/117661/334/334/31167700276015",
			"XT_HD": "562/161162/24/375/31033610137021"
		},
		"mammoth": {
			"default": "600/67314/131/54/31167700271637",
			"XT": "0/16722/260/335/31033607615546",
			"LC": "557/31354/323/254/31033607553520",
			"UT": "571/76747/372/131/31033610235472",
			"SP": "573/113554/112/106/31033607575155",
			"GT": "617/163502/325/33/31033607536216"
		}
	};

	const dronesRedirectMap = {
		"hyperion": {
			"default": "556/107004/326/35/31167700276045",
			"XT": "603/140170/104/322/30545000710642"
		},
		"crisis": {
			"default": "562/45273/110/127/31167700270140",
			"XT": "602/142250/300/167/30545000710756"
		}
	};
    const festivalsRedirectMap = {
    "garage": {
        "default": "601/166176/165/206/30545000710421",
        "万圣节": "613/2501/252/46/30545000710615",
        "新年_2025": "623/152656/155/20/31173045365546"
    },
    "sandbox": {
        "default": "570/174542/371/61/30544540056777",
        "FESTIVE_SEASON": "570/174542/371/62/30544541264567"
    },
    "forest": {
        "default": "0/16723/204/143/30545207067664",
        "FESTIVE_SEASON": "0/16723/204/144/30545210267003"
    },
    "new_years_library": {
        "default": "553/105167/27/302/30546776460526",
        "NEW_YEARS": "570/174542/371/71/31167243462337"
    },
    "new_years_map": {
        "default": "544/77313/263/311/30545211407625",
        "NEW_YEARS": "570/174542/371/72/31167257256577"
    },
    "new_years_music": {
        "default": "602/103320/104/163/30654312275414",
        "FESTIVE_SEASON": "575/163160/137/356/30653770533354",
        "NEW_YEARS": "575/163160/137/356/30653770533354"
    }
};
const paintsRedirectMap = {
		"lightmap": {
			"橄榄绿": "0/0/332/376/30545000607534",
			"中国红": "0/0/345/314/30545000606635"
		}
	};

// 允许的选项正则表达式
	const hullsPattern = /^(XT|XT_HD|LC|PR|UT|DC|GT|RF|SP)$/i;
	const turretsPattern = /^(XT|XT_HD|LC|PR|UT|DC|DC_OLD|IC|GT|RF|SE|SP|SNOWMAN)$/i;
	const dronesPattern = /^(XT)$/i;
    const festivalsPattern = /^(万圣节|新年_2025|Festive_Season|New_Years)$/i;
    const paintsPattern = /^(橄榄绿|中国红)$/i;

	// 从 localStorage 中获取上次的选择
	let lastHullChoice = localStorage.getItem('userChoiceHull') || 'XT';
	let lastTurretChoice = localStorage.getItem('userChoiceTurret') || 'XT';
	let lastDroneChoice = localStorage.getItem('userChoiceDrone') || 'XT';
    let lastFestivalChoice = localStorage.getItem('userChoiceFestival') || '万圣节';
    let lastOriginalPaintChoice = localStorage.getItem('originalChoicePaint') || '橄榄绿';
    let lastNewPaintChoice = localStorage.getItem('newChoicePaint') || '中国红';

	// 选择底盘，确保用户输入合法
	let userChoiceHull = prompt("请选择要使用的底盘模型替换 (XT/XT_HD(XT 高清)/LC（遗产）/PR（青春）/UT（超高）/DC（恶魔）/GT（跑车）/RF（复古未来）/SP（蒸汽朋克）):", lastHullChoice);
	if (userChoiceHull === null) {
		userChoiceHull = ''; // 用户点击取消，设置为空
	} else {
		while (!hullsPattern.test(userChoiceHull)) {
			alert("输入无效，请输入有效的底盘皮肤系列：XT, XT_HD, LC, PR, UT, DC, GT, RF, SP");
			userChoiceHull = prompt("请选择要使用的底盘模型替换 (XT/XT_HD(XT 高清)/LC（遗产）/PR（青春）/UT（超高）/DC（恶魔）/GT（跑车）/RF（复古未来）/SP（蒸汽朋克）):", lastHullChoice);
			if (userChoiceHull === null) {
				userChoiceHull = ''; // 用户点击取消，设置为空
				break;
			}
		}
	}

	// 选择炮塔，确保用户输入合法
	let userChoiceTurret = prompt("请选择要使用的炮塔模型替换 (XT/XT_HD（XT 高清）/LC（遗产）/PR（青春）/UT（超高）/DC（恶魔）/DC_OLD（恶魔旧）/IC（冰）/GT（跑车）/RF（复古未来）/SE（秘密）/SP（蒸汽朋克）):", lastTurretChoice);
	if (userChoiceTurret === null) {
		userChoiceTurret = ''; // 用户点击取消，设置为空
	} else {
		while (!turretsPattern.test(userChoiceTurret)) {
			alert("输入无效，请输入有效的炮塔皮肤系列：XT, XT_HD, LC, PR, UT, DC, DC_OLD, IC, GT, RF, SE, SP");
			userChoiceTurret = prompt("请选择要使用的炮塔模型替换 (XT/XT_HD（XT 高清）/LC（遗产）/PR（青春）/UT（超高）/DC（恶魔）/DC_OLD（恶魔旧）/IC（冰）/GT（跑车）/RF（复古未来）/SE（秘密）/SP（蒸汽朋克）):", lastTurretChoice);
			if (userChoiceTurret === null) {
				userChoiceTurret = ''; // 用户点击取消，设置为空
				break;
			}
		}
	}

	// 选择无人机，确保用户输入合法
	let userChoiceDrone = prompt("请选择要使用的无人机模型替换 (XT):", lastDroneChoice);
	if (userChoiceDrone === null) {
		userChoiceDrone = ''; // 用户点击取消，设置为空
	} else {
		while (!dronesPattern.test(userChoiceDrone)) {
			alert("输入无效，请输入有效的无人机皮肤系列：XT");
			userChoiceDrone = prompt("请选择要使用的无人机模型替换 (XT):", lastDroneChoice);
			if (userChoiceDrone === null) {
				userChoiceDrone = ''; // 用户点击取消，设置为空
				break;
			}
		}
	}
    let userChoiceFestival = prompt("请选择要使用的节日替换 (万圣节/新年_2025)（点击取消可不进行替换）:", lastFestivalChoice);
	if (userChoiceFestival === null) {
		userChoiceFestival = ''; // 用户点击取消，设置为空
	} else {
		while (!festivalsPattern.test(userChoiceFestival)) {
			alert("输入无效，请输入有效的节日：万圣节, 新年_2025");
			userChoiceFestival = prompt("请选择要使用的节日替换 (万圣节/新年_2025):", lastFestivalChoice);
			if (userChoiceFestival === null) {
				userChoiceFestival = ''; // 用户点击取消，设置为空
				break;
			}
		}
	}
let originalChoicePaint = prompt("请选择待替换迷彩 :", lastOriginalPaintChoice);
	if (originalChoicePaint === null) {
		originalChoicePaint = ''; // 用户点击取消，设置为空
	} else {
		while (!paintsPattern.test(originalChoicePaint)) {
			alert("输入无效，请输入有效的迷彩");
			originalChoicePaint = prompt("请选择待替换迷彩:", lastOriginalPaintChoice);
			if (originalChoicePaint === null) {
				originalChoicePaint = ''; // 用户点击取消，设置为空
				break;
			}
		}
	}
    let newChoicePaint = prompt("请选择要使用的替换后迷彩:", lastNewPaintChoice);
	if (newChoicePaint === null) {
		newChoicePaint = ''; // 用户点击取消，设置为空
	} else {
		while (!paintsPattern.test(newChoicePaint)) {
			alert("输入无效，请输入有效的迷彩");
			newChoicePaint = prompt("请选择要使用的替换后迷彩:", lastNewPaintChoice);
			if (newChoicePaint === null) {
				newChoicePaint = ''; // 用户点击取消，设置为空
				break;
			}
		}
	}
	// 确认继续
	const confirmationMessage = `您选择了底盘 ${userChoiceHull ? userChoiceHull.toUpperCase() : '未选择'}、炮塔 ${userChoiceTurret ? userChoiceTurret.toUpperCase() : '未选择'} 、无人机 ${userChoiceDrone ? userChoiceDrone.toUpperCase() : '未选择'}、节日 ${userChoiceFestival ? userChoiceFestival.toUpperCase() : '未选择'}、迷彩将 ${originalChoicePaint ? originalChoicePaint.toUpperCase() : '未选择'} 替换为 ${newChoicePaint ? newChoicePaint.toUpperCase() : '未选择'}。点击确定继续。`;
	if (confirm(confirmationMessage)) {
		// 将用户选择存储到 localStorage
		localStorage.setItem('userChoiceHull', userChoiceHull);
		localStorage.setItem('userChoiceTurret', userChoiceTurret);
		localStorage.setItem('userChoiceDrone', userChoiceDrone);
        localStorage.setItem('userChoiceFestival', userChoiceFestival);
        localStorage.setItem('originalChoicePaint', originalChoicePaint);
        localStorage.setItem('newChoicePaint', newChoicePaint);

		if (userChoiceHull && hullsRedirectMap[userChoiceHull]) {
			const hullsMap = hullsRedirectMap;
			document.querySelectorAll('script, link, img, audio, video, source').forEach(tag => {
				for (const key in hullsMap) {
					if (tag.src && tag.src.includes(hullsMap[key].default)) {
						const newSrc = hullsMap[key][userChoiceHull];
						if (newSrc) {
							tag.src = tag.src.replace(hullsMap[key].default, newSrc);
						}
					}
					if (tag.href && tag.href.includes(hullsMap[key].default)) {
						const newHref = hullsMap[key][userChoiceHull];
						if (newHref) {
							tag.href = tag.href.replace(hullsMap[key].default, newHref);
						}
					}
				}
			});
		}


		// 替换炮塔资源
		if (userChoiceTurret && turretsRedirectMap[userChoiceTurret]) {
			const turretMap = turretsRedirectMap;
			document.querySelectorAll('script, link, img, audio, video, source').forEach(tag => {
				for (const key in turretMap) {
					if (tag.src && tag.src.includes(turretMap[key].default)) {
						const newSrc = turretMap[key][userChoiceTurret];
						if (newSrc) {
							tag.src = tag.src.replace(turretMap[key].default, newSrc);
						}
					}
					if (tag.href && tag.href.includes(turretMap[key].default)) {
						const newHref = turretMap[key][userChoiceTurret];
						if (newHref) {
							tag.href = tag.href.replace(turretMap[key].default, newHref);
						}
					}
				}
			});
		}

		// 替换无人机资源
		if (userChoiceDrone && dronesRedirectMap[userChoiceDrone]) {
			const droneMap = dronesRedirectMap;
			document.querySelectorAll('script, link, img, audio, video, source').forEach(tag => {
				for (const key in droneMap) {
					if (tag.src && tag.src.includes(droneMap[key].default)) {
						const newSrc = droneMap[key][userChoiceDrone];
						if (newSrc) {
							tag.src = tag.src.replace(droneMap[key].default, newSrc);
						}
					}
					if (tag.href && tag.href.includes(droneMap[key].default)) {
						const newHref = droneMap[key][userChoiceDrone];
						if (newHref) {
							tag.href = tag.href.replace(droneMap[key].default, newHref);
						}
					}
				}
			});
		}
if (userChoiceFestival && festivalsRedirectMap[userChoiceFestival]) {
			const festivalMap = festivalsRedirectMap;
			document.querySelectorAll('script, link, img, audio, video, source').forEach(tag => {
				for (const key in festivalMap) {
					if (tag.src && tag.src.includes(festivalMap[key].default)) {
						const newSrc = festivalMap[key][userChoiceFestival];
						if (newSrc) {
							tag.src = tag.src.replace(festivalMap[key].default, newSrc);
						}
					}
					if (tag.href && tag.href.includes(festivalMap[key].default)) {
						const newHref = festivalMap[key][userChoiceFestival];
						if (newHref) {
							tag.href = tag.href.replace(festivalMap[key].default, newHref);
						}
					}
				}
			});
		}
if (originalChoicePaint && paintsRedirectMap[originalChoicePaint] && newChoicePaint && paintsRedirectMap[newChoicePaint]) {
			const paintMap = paintsRedirectMap;
			document.querySelectorAll('script, link, img, audio, video, source').forEach(tag => {
				for (const key in paintMap) {
					if (tag.src && tag.src.includes(paintMap[key][originalChoicePaint])) {
						const oldSrc = paintMap[key][originalChoicePaint];
                        const newSrc = paintMap[key][newChoicePaint];
						if (newSrc) {
							tag.src = tag.src.replace(oldSrc, newSrc);
						}
					}
					if (tag.href && tag.href.includes(paintMap[key][originalChoicePaint])) {
						const oldHref = paintMap[key][originalChoicePaint];
                        const newHref = paintMap[key][newChoicePaint];
						if (newHref) {
							tag.href = tag.href.replace(oldHref, newHref);
						}
					}
				}
			});
		}
		// 拦截 fetch 请求
		const originalFetch = window.fetch;
		window.fetch = function(input, init) {
			if (typeof input === 'string') {
				for (const key in hullsRedirectMap) {
					if (input.includes(hullsRedirectMap[key].default) && hullsRedirectMap[key][userChoiceHull.toUpperCase()]) {
						input = input.replace(hullsRedirectMap[key].default, hullsRedirectMap[key][userChoiceHull.toUpperCase()]);
						break;
					}
				}
				for (const key in turretsRedirectMap) {
					if (input.includes(turretsRedirectMap[key].default) && turretsRedirectMap[key][userChoiceTurret.toUpperCase()]) {
						input = input.replace(turretsRedirectMap[key].default, turretsRedirectMap[key][userChoiceTurret.toUpperCase()]);
						break;
					}
				}
				for (const key in dronesRedirectMap) {
					if (input.includes(dronesRedirectMap[key].default) && dronesRedirectMap[key][userChoiceDrone.toUpperCase()]) {
						input = input.replace(dronesRedirectMap[key].default, dronesRedirectMap[key][userChoiceDrone.toUpperCase()]);
						break;
					}
				}
                for (const key in festivalsRedirectMap) {
					if (input.includes(festivalsRedirectMap[key].default) && festivalsRedirectMap[key][userChoiceFestival.toUpperCase()]) {
						input = input.replace(festivalsRedirectMap[key].default, festivalsRedirectMap[key][userChoiceFestival.toUpperCase()]);
						break;
					}
				}
                for (const key in paintsRedirectMap) {
					if (input.includes(paintsRedirectMap[key][originalChoicePaint.toUpperCase()]) && paintsRedirectMap[key][newChoicePaint.toUpperCase()]) {
						input = input.replace(paintsRedirectMap[key][originalChoicePaint.toUpperCase()], paintsRedirectMap[key][newChoicePaint.toUpperCase()]);
						break;
					}
				}
			}
			return originalFetch(input, init);
		};

		// 拦截 XMLHttpRequest 请求
		const originalOpen = XMLHttpRequest.prototype.open;
		XMLHttpRequest.prototype.open = function(method, url) {
			for (const key in hullsRedirectMap) {
				if (url.includes(hullsRedirectMap[key].default) && hullsRedirectMap[key][userChoiceHull.toUpperCase()]) {
					url = url.replace(hullsRedirectMap[key].default, hullsRedirectMap[key][userChoiceHull.toUpperCase()]);
					break;
				}
			}
			for (const key in turretsRedirectMap) {
				if (url.includes(turretsRedirectMap[key].default) && turretsRedirectMap[key][userChoiceTurret.toUpperCase()]) {
					url = url.replace(turretsRedirectMap[key].default, turretsRedirectMap[key][userChoiceTurret.toUpperCase()]);
					break;
				}
			}
			for (const key in dronesRedirectMap) {
				if (url.includes(dronesRedirectMap[key].default) && dronesRedirectMap[key][userChoiceDrone.toUpperCase()]) {
					url = url.replace(dronesRedirectMap[key].default, dronesRedirectMap[key][userChoiceDrone.toUpperCase()]);
					break;
				}
			}
            for (const key in festivalsRedirectMap) {
				if (url.includes(festivalsRedirectMap[key].default) && festivalsRedirectMap[key][userChoiceFestival.toUpperCase()]) {
					url = url.replace(festivalsRedirectMap[key].default, festivalsRedirectMap[key][userChoiceFestival.toUpperCase()]);
					break;
				}
			}
            for (const key in paintsRedirectMap) {
				if (url.includes(paintsRedirectMap[key][originalChoicePaint.toUpperCase()]) && paintsRedirectMap[key][newChoicePaint.toUpperCase()]) {
					url = url.replace(paintsRedirectMap[key][originalChoicePaint.toUpperCase()], paintsRedirectMap[key][newChoicePaint.toUpperCase()]);
					break;
				}
			}
			// Similar checks for turretsRedirectMap and dronesRedirectMap...
			originalOpen.call(this, method, url);
		};

	} else {
		alert("选择已取消，页面将继续加载原始内容。");
	}
})();
