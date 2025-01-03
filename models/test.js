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
                    有新版本可用！
                    最新版本：${latestVersion}
                    更新内容：${updateInfo}
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
    const shotEffectsRedirectMap = {
		"firebird_1": {
			"default": "546/145213/173/213/30545000703101",
			"幻影黑": "546/145213/172/34/30545000702774"
		},
        "firebird_2": {
			"default": "546/145213/174/235/30545000702754",
			"幻影黑": "546/145213/172/326/30545000703020"
		},
        "firebird_default": {
			"default": "547/76730/307/376/30545000607113"
		},
        "freeze_1": {
			"default": "546/145213/144/251/30545000702776",
			"": "0/0/345/314/30545000606635"
		},
        "freeze_2": {
			"default": "546/145213/142/206/30545000703057",
			"": "0/0/345/314/30545000606635"
		},
        "freeze_3": {
			"default": "547/76731/351/230/30545000607164",
			"": "0/0/345/314/30545000606635"
		},
        "isida_1": {
			"default": "546/147603/120/334/30545000606002",
			"": "0/0/345/314/30545000606635"
		},
        "isida_2": {
			"default": "546/145213/160/162/30545000702667",
			"": "0/0/345/314/30545000606635"
		},
        "isida_3": {
			"default": "546/147613/376/315/30545000606067",
			"": "0/0/345/314/30545000606635"
		},
        "isida_4": {
			"default": "546/145213/157/16/30545000703112",
			"": "0/0/345/314/30545000606635"
		},
        "tesla_1": {
			"default": "562/24337/265/306/30545000607156",
			"": "0/0/345/314/30545000606635"
		},
        "tesla_2": {
			"default": "562/24337/265/320/30545000606123",
			"": "0/0/345/314/30545000606635"
		},
        "tesla_3": {
			"default": "545/117451/153/325/30545000607527",
			"": "0/0/345/314/30545000606635"
		},
        "hammer_1": {
			"default": "0/16721/360/360/30545000607546",
			"": "0/0/345/314/30545000606635"
		},
        "hammer_2": {
			"default": "0/16721/360/356/30545000607553",
			"": "0/0/345/314/30545000606635"
		},
        "hammer_3": {
			"default": "0/16721/360/361/30545000606454",
			"": "0/0/345/314/30545000606635"
		},
        "hammer_4": {
			"default": "0/16721/360/363/30545000605632",
			"": "0/0/345/314/30545000606635"
		},
        "hammer_5": {
			"default": "0/16721/360/357/30545000606647",
			"": "0/0/345/314/30545000606635"
		},
        "hammer_6": {
			"default": "0/16721/360/354/30545000702655",
			"": "0/0/345/314/30545000606635"
		},
        "hammer_7": {
			"default": "0/16721/360/353/30545000702716",
			"": "0/0/345/314/30545000606635"
		},
        "hammer_8": {
			"default": "0/16721/360/362/30545000607320",
			"": "0/0/345/314/30545000606635"
		},
        "hammer_9": {
			"default": "0/16721/360/355/30545000702620",
			"": "0/0/345/314/30545000606635"
		},
        "twins_1": {
			"default": "546/145213/165/145/30545000702663",
			"": "0/0/345/314/30545000606635"
		},
        "twins_2": {
			"default": "0/1374/273/16/30545000606047",
			"": "0/0/345/314/30545000606635"
		},
        "twins_3": {
			"default": "546/147411/176/204/30545000607302",
			"": "0/0/345/314/30545000606635"
		},
        "twins_4": {
			"default": "546/145213/166/330/30545000702745",
			"": "0/0/345/314/30545000606635"
		},
        "ricochet_1": {
			"default": "546/147741/131/160/30545000606467",
			"": "0/0/345/314/30545000606635"
		},
        "ricochet_2": {
			"default": "546/145213/211/227/30545000703056",
			"": "0/0/345/314/30545000606635"
		},
        "ricochet_3": {
			"default": "546/145213/207/24/30545000703106",
			"": "0/0/345/314/30545000606635"
		},
        "ricochet_4": {
			"default": "546/147746/300/166/30545000605533",
			"": "0/0/345/314/30545000606635"
		},
        "vulcan_1": {
			"default": "0/16721/360/350/30545000702746",
			"": "0/0/345/314/30545000606635"
		},
        "vulcan_2": {
			"default": "546/145213/124/120/30545000703060",
			"": "0/0/345/314/30545000606635"
		},
        "vulcan_3": {
			"default": "546/145213/117/343/30545000702623",
			"": "0/0/345/314/30545000606635"
		},
        "smoky_1": {
			"default": "546/145213/140/271/30545000702755",
			"": "0/0/345/314/30545000606635"
		},
        "smoky_2": {
			"default": "0/1374/264/44/30545000607440",
			"": "0/0/345/314/30545000606635"
		},
        "smoky_3": {
			"default": "566/124613/346/51/30545000606147",
			"": "0/0/345/314/30545000606635"
		},
        "smoky_4": {
			"default": "566/124613/346/64/30545000607002",
			"": "0/0/345/314/30545000606635"
		},
        "smoky_5": {
			"default": "566/124613/346/70/30545000606325",
			"": "0/0/345/314/30545000606635"
		},
        "smoky_6": {
			"default": "566/124613/346/65/30545000702606",
			"": "0/0/345/314/30545000606635"
		},
        "smoky_7": {
			"default": "566/124716/12/375/30545000607150",
			"": "0/0/345/314/30545000606635"
		},
        "smoky_8": {
			"default": "555/127561/370/247/30545000605433",
			"": "0/0/345/314/30545000606635"
		},
        "striker_1": {
			"default": "546/145213/114/104/30545000703026",
			"": "0/0/345/314/30545000606635"
		},
        "striker_2": {
			"default": "0/1374/272/334/30545000605627",
			"": "0/0/345/314/30545000606635"
		},
        "striker_3": {
			"default": "0/16723/37/5/30545000607467",
			"": "0/0/345/314/30545000606635"
		},
        "striker_4": {
			"default": "546/150052/46/102/30545000605332",
			"": "0/0/345/314/30545000606635"
		},
        "thunder_1": {
			"default": "546/145213/174/374/30545000703122",
			"": "0/0/345/314/30545000606635"
		},
        "thunder_2": {
			"default": "555/127645/160/2/30545000605641",
			"": "0/0/345/314/30545000606635"
		},
        "thunder_3": {
			"default": "555/127647/64/315/30545000607202",
			"": "0/0/345/314/30545000606635"
		},
        "thunder_4": {
			"default": "555/127647/233/165/30545000606002",
			"": "0/0/345/314/30545000606635"
		},
        "thunder_5": {
			"default": "555/127650/133/357/30545000605351",
			"": "0/0/345/314/30545000606635"
		},
        "scorpion_1": {
			"default": "546/145213/177/370/30545000702654",
			"": "0/0/345/314/30545000606635"
		},
        "scorpion_2": {
			"default": "0/16723/73/211/30545000606641",
			"": "0/0/345/314/30545000606635"
		},
        "scorpion_3": {
			"default": "0/16723/73/210/30545000607024",
			"": "0/0/345/314/30545000606635"
		},
        "magnum_1": {
			"default": "546/145213/177/44/30545000702741",
			"": "0/0/345/314/30545000606635"
		},
        "magnum_2": {
			"default": "0/16723/73/212/30545000607471",
			"": "0/0/345/314/30545000606635"
		},
        "railgun_1": {
			"default": "546/150126/51/246/30545000607361",
			"": "0/0/345/314/30545000606635"
		},
        "railgun_2": {
			"default": "546/150126/253/153/30545000607325",
			"": "0/0/345/314/30545000606635"
		},
        "railgun_3": {
			"default": "546/150125/227/36/30545000606325",
			"": "0/0/345/314/30545000606635"
		},
        "railgun_4": {
			"default": "0/114/115/306/30545000606127",
			"": "0/0/345/314/30545000606635"
		},
        "railgun_5": {
			"default": "0/114/115/307/30545000607351",
			"": "0/0/345/314/30545000606635"
		},
        "railgun_6": {
			"default": "614/167157/112/162/30635634260772",
			"": "0/0/345/314/30545000606635"
		},
        "railgun_7": {
			"default": "546/145213/145/15/30545000702572",
			"": "0/0/345/314/30545000606635"
		},
        "railgun_8": {
			"default": "0/1374/276/15/30545000702736",
			"": "0/0/345/314/30545000606635"
		},
        "railgun_9": {
			"default": "546/145213/153/303/30545000703106",
			"": "0/0/345/314/30545000606635"
		},
        "gauss_1": {
			"default": "552/154717/221/301/30545000605726",
			"": "0/0/345/314/30545000606635"
		},
        "gauss_2": {
			"default": "552/132670/36/315/30545000606571",
			"": "0/0/345/314/30545000606635"
		},
        "gauss_3": {
			"default": "552/132670/163/5/30545000607131",
			"": "0/0/345/314/30545000606635"
		},
        "gauss_4": {
			"default": "552/132671/261/325/30545000607130",
			"": "0/0/345/314/30545000606635"
		},
        "gauss_5": {
			"default": "552/132672/57/244/30545000606601",
			"": "0/0/345/314/30545000606635"
		},
        "gauss_6": {
			"default": "552/132667/104/225/30545000702742",
			"": "0/0/345/314/30545000606635"
		},
        "gauss_7": {
			"default": "552/132667/257/15/30545000703127",
			"": "0/0/345/314/30545000606635"
		},
        "gauss_8": {
			"default": "552/132672/221/154/30545000607025",
			"": "0/0/345/314/30545000606635"
		},
        "gauss_9": {
			"default": "552/132666/160/177/30545000606500",
			"": "0/0/345/314/30545000606635"
		},
        "gauss_10": {
			"default": "601/107774/12/325/30061777036640",
			"": "0/0/345/314/30545000606635"
		},
        "shaft_1": {
			"default": "622/51212/316/3/31112242547477",
			"": "0/0/345/314/30545000606635"
		},
        "shaft_2": {
			"default": "546/145213/127/45/30545000703054",
			"": "0/0/345/314/30545000606635"
		},
        "shaft_3": {
			"default": "546/145213/132/373/30545000703117",
			"": "0/0/345/314/30545000606635"
		},
        "shaft_4": {
			"default": "0/1374/273/107/30545000607370",
			"": "0/0/345/314/30545000606635"
		},
        "shaft_5": {
			"default": "546/150162/53/137/30545000605710",
			"": "0/0/345/314/30545000606635"
		}
	};
	const paintsRedirectMap = {
		"lightmap": {
			"橄榄绿": "0/0/332/376/30545000607534",
			"中国红": "0/0/345/314/30545000606635"
		}
	};

	const hullsPattern = /^(XT|XT_HD|LC|PR|UT|DC|GT|RF|SP)$/i;
	const turretsPattern = /^(XT|XT_HD|LC|PR|UT|DC|DC_OLD|IC|GT|RF|SE|SP|SNOWMAN)$/i;
	const dronesPattern = /^(XT)$/i;
	const festivalsPattern = /^(万圣节|新年_2025|Festive_Season|New_Years)$/i;
    const shotEffectsPattern = /^(幻影黑)$/i;
	const paintsPattern = /^(橄榄绿|中国红)$/i;

	let lastHullChoice = localStorage.getItem('userChoiceHull') || 'XT';
	let lastTurretChoice = localStorage.getItem('userChoiceTurret') || 'XT';
	let lastDroneChoice = localStorage.getItem('userChoiceDrone') || 'XT';
	let lastFestivalChoice = localStorage.getItem('userChoiceFestival') || '万圣节';
    let lastShotEffectChoice = localStorage.getItem('userChoiceShotEffect') || '万圣节';
	let lastOriginalPaintChoice = localStorage.getItem('originalChoicePaint') || '橄榄绿';
	let lastNewPaintChoice = localStorage.getItem('newChoicePaint') || '中国红';

	function getUserChoice(promptMessage, lastChoice, pattern, invalidMessage) {
		let userChoice = prompt(promptMessage, lastChoice);
		if (userChoice === null) {
			return '';
		} else {
			while (!pattern.test(userChoice)) {
				alert(invalidMessage);
				userChoice = prompt(promptMessage, lastChoice);
				if (userChoice === null) {
					return '';
				}
			}
		}
		return userChoice;
	}

	let userChoiceHull = getUserChoice(
		"请选择要使用的底盘模型替换 (XT/XT_HD(XT 高清)/LC（遗产）/PR（青春）/UT（超高）/DC（恶魔）/GT（跑车）/RF（复古未来）/SP（蒸汽朋克）)（点击取消可不进行替换）:",
		lastHullChoice,
		hullsPattern,
		"输入无效，请输入有效的底盘皮肤系列：XT, XT_HD, LC, PR, UT, DC, GT, RF, SP"
	);

	let userChoiceTurret = getUserChoice(
		"请选择要使用的炮塔模型替换 (XT/XT_HD（XT 高清）/LC（遗产）/PR（青春）/UT（超高）/DC（恶魔）/DC_OLD（恶魔旧）/IC（冰）/GT（跑车）/RF（复古未来）/SE（秘密）/SP（蒸汽朋克）)（点击取消可不进行替换）:",
		lastTurretChoice,
		turretsPattern,
		"输入无效，请输入有效的炮塔皮肤系列：XT, XT_HD, LC, PR, UT, DC, DC_OLD, IC, GT, RF, SE, SP"
	);

	let userChoiceDrone = getUserChoice(
		"请选择要使用的无人机模型替换 (XT)（点击取消可不进行替换）:",
		lastDroneChoice,
		dronesPattern,
		"输入无效，请输入有效的无人机皮肤系列：XT"
	);

	let userChoiceFestival = getUserChoice(
		"请选择要使用的节日替换 (万圣节/新年_2025)（点击取消可不进行替换）:",
		lastFestivalChoice,
		festivalsPattern,
		"输入无效，请输入有效的节日：万圣节, 新年_2025"
	);

    let userChoiceShotEffect = getUserChoice(
		"请选择要使用的射击效果替换 (万圣节/新年_2025)（点击取消可不进行替换）:",
		lastShotEffectChoice,
		shotEffectsPattern,
		"输入无效，请输入有效的射击效果：万圣节, 新年_2025"
	);

	let originalChoicePaint = getUserChoice(
		"请选择待替换迷彩（点击取消可不进行替换） :",
		lastOriginalPaintChoice,
		paintsPattern,
		"输入无效，请输入有效的迷彩"
	);

	let newChoicePaint = getUserChoice(
		"请选择要使用的替换后迷彩（点击取消可不进行替换）:",
		lastNewPaintChoice,
		paintsPattern,
		"输入无效，请输入有效的迷彩"
	);

	const confirmationMessage = `
    您选择了：
    底盘 ${userChoiceHull ? userChoiceHull.toUpperCase() : '不替换'}
    炮塔 ${userChoiceTurret ? userChoiceTurret.toUpperCase() : '不替换'}
    无人机 ${userChoiceDrone ? userChoiceDrone.toUpperCase() : '不替换'}
    节日 ${userChoiceFestival ? userChoiceFestival.toUpperCase() : '不替换'}
    射击效果 ${userChoiceShotEffect ? userChoiceShotEffect.toUpperCase() : '不替换'}
    迷彩将 ${originalChoicePaint ? originalChoicePaint.toUpperCase() : '不替换'} 替换为 ${newChoicePaint ? newChoicePaint.toUpperCase() : '不替换'}。
    点击确定继续。`;
	if (confirm(confirmationMessage)) {
		localStorage.setItem('userChoiceHull', userChoiceHull);
		localStorage.setItem('userChoiceTurret', userChoiceTurret);
		localStorage.setItem('userChoiceDrone', userChoiceDrone);
		localStorage.setItem('userChoiceFestival', userChoiceFestival);
        localStorage.setItem('userChoiceShotEffect', userChoiceShotEffect);
		localStorage.setItem('originalChoicePaint', originalChoicePaint);
		localStorage.setItem('newChoicePaint', newChoicePaint);

		function replaceResources(redirectMap, userChoice) {
			if (userChoice && redirectMap[userChoice]) {
				const map = redirectMap;
				document.querySelectorAll('script, link, img, audio, video, source').forEach(tag => {
					for (const key in map) {
						if (tag.src && tag.src.includes(map[key].default)) {
							const newSrc = map[key][userChoice];
							if (newSrc) {
								tag.src = tag.src.replace(map[key].default, newSrc);
							}
						}
						if (tag.href && tag.href.includes(map[key].default)) {
							const newHref = map[key][userChoice];
							if (newHref) {
								tag.href = tag.href.replace(map[key].default, newHref);
							}
						}
					}
				});
			}
		}

		replaceResources(hullsRedirectMap, userChoiceHull);
		replaceResources(turretsRedirectMap, userChoiceTurret);
		replaceResources(dronesRedirectMap, userChoiceDrone);
		replaceResources(festivalsRedirectMap, userChoiceFestival);
        replaceResources(shotEffectsRedirectMap, userChoiceShotEffect);

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

		const originalFetch = window.fetch;
		window.fetch = function(input, init) {
			if (typeof input === 'string') {
				function replaceInputResource(input, redirectMap, userChoice) {
					const choiceKey = userChoice.toUpperCase();
					for (const key in redirectMap) {
						if (input.includes(redirectMap[key].default) && redirectMap[key][choiceKey]) {
							input = input.replace(redirectMap[key].default, redirectMap[key][choiceKey]);
							break;
						}
					}
					return input;
				}

				input = replaceInputResource(input, hullsRedirectMap, userChoiceHull);
				input = replaceInputResource(input, turretsRedirectMap, userChoiceTurret);
				input = replaceInputResource(input, dronesRedirectMap, userChoiceDrone);
				input = replaceInputResource(input, festivalsRedirectMap, userChoiceFestival);
                input = replaceInputResource(input, shotEffectsRedirectMap, userChoiceShotEffect);

				for (const key in paintsRedirectMap) {
					if (input.includes(paintsRedirectMap[key][originalChoicePaint.toUpperCase()]) && paintsRedirectMap[key][newChoicePaint.toUpperCase()]) {
						input = input.replace(paintsRedirectMap[key][originalChoicePaint.toUpperCase()], paintsRedirectMap[key][newChoicePaint.toUpperCase()]);
						break;
					}
				}
			}
			return originalFetch(input, init);
		};

		const originalOpen = XMLHttpRequest.prototype.open;
		XMLHttpRequest.prototype.open = function(method, url) {
			function replaceUrlResource(url, redirectMap, userChoice) {
				const choiceKey = userChoice.toUpperCase();
				for (const key in redirectMap) {
					if (url.includes(redirectMap[key].default) && redirectMap[key][choiceKey]) {
						url = url.replace(redirectMap[key].default, redirectMap[key][choiceKey]);
						break; // 找到第一个匹配后就停止替换
					}
				}
				return url;
			}

			url = replaceUrlResource(url, hullsRedirectMap, userChoiceHull);
			url = replaceUrlResource(url, turretsRedirectMap, userChoiceTurret);
			url = replaceUrlResource(url, dronesRedirectMap, userChoiceDrone);
			url = replaceUrlResource(url, festivalsRedirectMap, userChoiceFestival);
            url = replaceUrlResource(url, shotEffectsRedirectMap, userChoiceShotEffect);

			for (const key in paintsRedirectMap) {
				if (url.includes(paintsRedirectMap[key][originalChoicePaint.toUpperCase()]) && paintsRedirectMap[key][newChoicePaint.toUpperCase()]) {
					url = url.replace(paintsRedirectMap[key][originalChoicePaint.toUpperCase()], paintsRedirectMap[key][newChoicePaint.toUpperCase()]);
					break;
				}
			}
			originalOpen.call(this, method, url);
		};

	} else {
		alert("选择已取消，页面将继续加载原始内容。");
	}
})();
