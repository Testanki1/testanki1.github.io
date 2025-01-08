// ==UserScript==
// @name         3D坦克美化包（非官方）
// @namespace    http://tampermonkey.net/
// @version      1.2_Beta_1
// @description  替换3D坦克炮塔、底盘、无人机皮肤、节日装饰品、迷彩、射击效果
// @author       Testanki
// @match        *://*.3dtank.com/play*
// @match        *://*.tankionline.com/play*
// @match        *://*.test-eu.tankionline.com/*
// @match        *://*.test-ru.tankionline.com/*
// @grant        none
// ==/UserScript==

(function() {
	'use strict';
	const currentVersionCode = 8;
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
                    3D坦克美化包有新版本可用！
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
			"雪人": "575/77444/65/233/31167700273100"
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
			"DC": "622/107573/220/101/31123207764670",
            "GT": "623/152225/145/72/31172445577356"
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
        "sandbox_summer": {
			"default": "570/174542/371/60/30544532052123",
			"教程": "0/1/304/263/30741245714771"
		},
		"sandbox_winter": {
			"default": "570/174542/371/61/30544540056777",
			"节日季节 主题": "570/174542/371/62/30544541264567"
		},
		"forest_winter": {
			"default": "0/16723/204/143/30545207067664",
			"节日季节 主题": "0/16723/204/144/30545210267003"
		},
		"new_years_library": {
			"default": "553/105167/27/302/30546776460526",
			"新年 重制": "570/174542/371/71/31167243462337"
		},
		"new_years_map": {
			"default": "544/77313/263/311/30545211407625",
			"新年 重制": "570/174542/371/72/31167257256577"
		},
		"new_years_music": {
			"default": "602/103320/104/163/30654312275414",
			"节日季节 主题": "575/163160/137/356/30653770533354",
			"新年 重制": "575/163160/137/356/30653770533354"
		}
	};
    const shotEffectsRedirectMap = {
		"firebird_1": {
			"default": "546/145213/173/213/30545000703101",
			"幻影黑": "546/145213/172/34/30545000702774",
            "岩浆": "546/145213/173/346/30545000702745",
            "粉红色": "546/145213/173/61/30545000702662",
            "深红色": null
		},
        "firebird_2": {
			"default": "546/145213/174/235/30545000702754",
			"幻影黑": "546/145213/172/326/30545000703020",
            "岩浆": "546/145213/172/171/30545000703031",
            "粉红色": "546/145213/171/277/30545000703113",
            "深红色": null
		},
        "freeze_1": {
			"default": "546/145213/144/251/30545000702776",
			"寒冷": "546/145213/143/357/30545000703103",
            "毒": "546/145213/142/53/30545000702770",
            "暗月": null,
            "雪": null
		},
        "freeze_2": {
			"default": "546/145213/142/206/30545000703057",
			"寒冷": "546/145213/144/114/30545000703120",
            "毒": "546/145213/141/312/30545000702717",
            "暗月": null,
            "雪": null
		},
        "isida_1": {
			"default": "546/147613/376/315/30545000606067",
			"火": "546/147614/265/140/30545000606433",
            "太阳": "546/147614/315/217/30545000607355",

		},
        "isida_2": {
			"default": "546/145213/157/16/30545000703112",
			"火": "546/145213/160/314/30545000702744",
            "太阳": "546/145213/157/147/30545000703060"
		},
        "tesla_1": {
			"default": "562/24337/265/306/30545000607156"
		},
        "tesla_2": {
			"default": "562/24337/265/320/30545000606123"
		},
        "tesla_3": {
			"default": "545/117451/153/325/30545000607527"
		},
        "hammer_1": {
			"default": "0/16721/360/363/30545000605632",
			"水": "552/51671/2/323/30545000605746",
            "岩浆": null,
            "虚空": null,
            "毒": null,
            "日食": null,
            "天空蓝": null,
            "血液": null
		},
        "hammer_2": {
			"default": "0/16721/360/354/30545000702655",
			"水": "552/51665/316/67/30545000703052",
            "岩浆": null,
            "虚空": null,
            "毒": null,
            "日食": null,
            "天空蓝": null,
            "血液": null
		},
        "hammer_3": {
			"default": "0/16721/360/353/30545000702716",
			"水": "552/51633/372/42/30545000703044",
            "岩浆": null,
            "虚空": null,
            "毒": null,
            "日食": null,
            "天空蓝": null,
            "血液": null
		},
        "hammer_4": {
			"default": "0/16721/360/362/30545000607320",
			"水": "552/51670/1/143/30545000606152",
            "岩浆": null,
            "虚空": null,
            "毒": null,
            "日食": null,
            "天空蓝": null,
            "血液": null
		},
        "twins_1": {
			"default": "546/145213/165/145/30545000702663",
			"珊瑚礁": "546/145213/165/10/30545000702632",
            "暗月": "546/145213/164/122/30545000703054",
            "天空": null,
            "金": null,
            "紫罗兰色": null,
            "电": null,
            "爆破手": null
		},
        "twins_2": {
			"default": "546/147411/176/204/30545000607302",
			"珊瑚礁": "546/147443/56/222/30545000607142",
            "暗月": "546/147443/205/75/30545000606311",
            "天空": null,
            "金": null,
            "紫罗兰色": null,
            "电": null,
            "爆破手": null
		},
        "twins_3": {
			"default": "546/145213/166/330/30545000702745",
			"珊瑚礁": "546/145213/166/37/30545000703044",
            "暗月": "546/145213/165/302/30545000703114",
            "天空": null,
            "金": null,
            "紫罗兰色": null,
            "电": null,
            "爆破手": null
		},
        "ricochet_1": {
			"default": "546/147741/131/160/30545000606467",
			"电": "546/147741/302/146/30545000607410",
            "金": "546/147743/0/265/30545000607037",
            "深红色": "546/147741/236/332/30545000607462",
            "烟雾": null,
            "岩浆": null,
            "紫罗兰色": null,
            "毒": null,
            "水": null,
            "爆破手": null
		},
        "ricochet_2": {
			"default": "546/145213/211/227/30545000703056",
			"电": "546/145213/210/204/30545000702650",
            "金": "546/145213/201/277/30545000703045",
            "深红色": "546/145213/203/206/30545000702623",
            "烟雾": null,
            "岩浆": null,
            "紫罗兰色": null,
            "毒": null,
            "水": null,
            "爆破手": null
		},
        "ricochet_3": {
			"default": "546/145213/207/24/30545000703106",
			"电": "546/145213/206/136/30545000703055",
            "金": "546/145213/214/32/30545000703012",
            "深红色": "546/145213/205/250/30545000703067",
            "烟雾": null,
            "岩浆": null,
            "紫罗兰色": null,
            "毒": null,
            "水": null,
            "爆破手": null
		},
        "ricochet_4": {
			"default": "546/147746/300/166/30545000605533",
			"电": "546/147747/362/5/30545000607041",
            "金": "546/147750/20/205/30545000605607",
            "深红色": "546/147746/376/1/30545000606504",
            "烟雾": null,
            "岩浆": null,
            "紫罗兰色": null,
            "毒": null,
            "水": null,
            "爆破手": null
		},
        "vulcan_1": {
			"default": "546/145213/124/120/30545000703060",
			"神秘的红色": "560/33733/324/111/30545000702647"
		},
        "vulcan_2": {
			"default": "546/145213/117/343/30545000702623",
			"神秘的红色": "560/33733/324/104/30545000702743"
		},
        "smoky_1": {
			"default": "546/145213/140/271/30545000702755"
		},
        "smoky_2": {
			"default": "0/1374/264/44/30545000607440"
		},
        "smoky_3": {
			"default": "566/124613/346/51/30545000606147"
		},
        "smoky_4": {
			"default": "566/124613/346/64/30545000607002"
		},
        "smoky_5": {
			"default": "566/124613/346/70/30545000606325"
		},
        "smoky_6": {
			"default": "566/124613/346/65/30545000702606"
		},
        "smoky_7": {
			"default": "566/124716/12/375/30545000607150"
		},
        "smoky_8": {
			"default": "555/127561/370/247/30545000605433"
		},
        "striker_1": {
			"default": "546/145213/114/104/30545000703026",
			"紫罗兰色": "546/145213/115/262/30545000702665",
            "毒": null,
            "深红色": null,
            "天空蓝": null
		},
        "striker_2": {
			"default": "546/150052/46/102/30545000605332",
			"紫罗兰色": "546/150053/175/72/30545000607442",
            "毒": null,
            "深红色": null,
            "天空蓝": null
		},
        "thunder_1": {
			"default": "546/145213/174/374/30545000703122"
		},
        "thunder_2": {
			"default": "555/127645/160/2/30545000605641"
		},
        "thunder_3": {
			"default": "555/127647/64/315/30545000607202"
		},
        "thunder_4": {
			"default": "555/127647/233/165/30545000606002"
		},
        "thunder_5": {
			"default": "555/127650/133/357/30545000605351"
		},
        "scorpion_1": {
			"default": "546/145213/177/370/30545000702654"
		},
        "scorpion_2": {
			"default": "0/16723/73/211/30545000606641"
		},
        "scorpion_3": {
			"default": "0/16723/73/210/30545000607024"
		},
        "magnum_1": {
			"default": "546/145213/177/44/30545000702741",
			"天空蓝": "554/153573/307/234/30545000703017",
            "深红色": "554/153573/310/141/30545000702743",
            "毒": "554/153573/311/60/30545000702612",
            "紫罗兰色": "554/153573/311/171/30545000703070",
            "日食": null
		},
        "magnum_2": {
			"default": "546/145213/177/370/30545000702654",
			"天空蓝": "554/153573/311/277/30545000702760",
            "深红色": "554/153573/312/2/30545000702566",
            "毒": "554/153573/312/212/30545000702764",
            "紫罗兰色": "554/153573/312/317/30545000703014",
            "日食": null
		},

        "railgun_1": {
			"default": "546/150126/51/246/30545000607361",
			"血液": "546/150135/217/70/30545000607516",
            "橄榄绿": "546/150137/76/311/30545000607006",
            "雪": "546/150137/212/373/30545000607076",
            "天空蓝": "546/150136/157/164/30545000605652",
            "金": null,
            "紫罗兰色": null,
            "黑暗": null,
            "魔法": null
		},
        "railgun_2": {
			"default": "546/150126/253/153/30545000607325",
			"血液": "546/150140/120/227/30545000605435",
            "橄榄绿": "546/150141/317/134/30545000607352",
            "雪": "546/150142/34/243/30545000606654",
            "天空蓝": "546/150140/221/33/30545000607077",
            "金": null,
            "紫罗兰色": null,
            "黑暗": null,
            "魔法": null
		},
        "railgun_3": {
			"default": "546/150125/227/36/30545000606325",
			"血液": "546/150132/137/312/30545000606477",
            "橄榄绿": "546/150133/361/63/30545000607371",
            "雪": "546/150134/61/330/30545000607361",
            "天空蓝": "546/150132/273/312/30545000607533",
            "金": null,
            "紫罗兰色": null,
            "黑暗": null,
            "魔法": null
		},
        "gauss_1": {
			"default": "552/132670/36/315/30545000606571",
			"暴力": "560/161445/44/340/30545000607420"
		},
        "gauss_2": {
			"default": "552/132670/163/5/30545000607131",
			"暴力": "560/161445/44/342/30545000607416"
		},
        "gauss_3": {
			"default": "552/132672/57/244/30545000606601",
			"暴力": "560/161445/44/341/30545000606255"
		},
        "gauss_4": {
			"default": "552/132667/104/225/30545000702742",
			"暴力": "560/161445/44/337/30545000702761"
		},
        "gauss_5": {
			"default": "552/132667/257/15/30545000703127",
			"暴力": "560/161445/44/324/30545000703027"
		},
        "gauss_6": {
			"default": "552/132672/221/154/30545000607025",
			"暴力": "560/161445/44/336/30545000606725"
		},
        "gauss_7": {
			"default": "552/132666/160/177/30545000606500",
			"暴力": "560/161445/44/343/30545000606270"
		},
        "gauss_8": {
			"default": "552/132671/132/330/30545000607211",
			"暴力": "560/161445/44/334/30545000606221"
		},
        "shaft_1": {
			"default": "546/145213/127/45/30545000703054",
			"天空蓝": "546/145213/135/15/30545000703075",
            "日食": "546/145213/130/216/30545000703046",
            "正午": "546/145213/134/5/30545000703107",
            "橄榄绿": null,
            "水": null,
            "虚空": null,
            "血液": null,
            "紫罗兰色": null,
            "岩浆": null
		},
        "shaft_2": {
			"default": "546/145213/132/373/30545000703117",
			"天空蓝": "546/145213/130/65/30545000703014",
            "日食": "546/145213/127/200/30545000702732",
            "正午": "546/145213/137/251/30545000702663",
            "橄榄绿": null,
            "水": null,
            "虚空": null,
            "血液": null,
            "紫罗兰色": null,
            "岩浆": null
		},
        "shaft_3": {
			"default": "546/150162/53/137/30545000605710",
			"天空蓝": "546/150162/346/234/30545000607140",
            "日食": "546/150163/364/61/30545000606306",
            "正午": "546/150165/141/234/30545000606565",
            "橄榄绿": null,
            "水": null,
            "虚空": null,
            "血液": null,
            "紫罗兰色": null,
            "岩浆": null
		}
	};
	const paintsRedirectMap = {
		"paints": {
			"橄榄绿": "0/0/332/376/30545000607534",
			"中国红": "0/0/345/314/30545000606635",
            "光谱": "537/157270/46/364/30545000703055",
            "坦克币坦克": "556/15724/147/2/30545000702723"
		}
	};

	const hullsPattern = /^(|XT|XT_HD|LC|PR|UT|DC|GT|RF|SP)$/i;
	const turretsPattern = /^(|XT|XT_HD|LC|PR|UT|DC|DC_OLD|IC|GT|RF|SE|SP|雪人)$/i;
	const dronesPattern = /^(|XT)$/i;
	const festivalsPattern = /^(|万圣节|新年_2025|节日季节 主题|新年 重制|教程)$/i;
    const shotEffectsPattern = /^(|幻影黑|岩浆|粉红色|寒冷|毒|火|太阳|水|珊瑚礁|暗月|电|金|深红色|紫罗兰色|天空蓝|暴力|爆破手|黑暗|魔法|日食|神秘的红色|天空|虚空|血液|雪|正午|烟雾)$/i;
	const paintsPattern = /^(|橄榄绿|中国红|光谱|坦克币坦克)$/i;

	let lastHullChoice = localStorage.getItem('userChoiceHull') || '';
	let lastTurretChoice = localStorage.getItem('userChoiceTurret') || '';
	let lastDroneChoice = localStorage.getItem('userChoiceDrone') || '';
	let lastFestivalChoice = localStorage.getItem('userChoiceFestival') || '';
    let lastShotEffectChoice = localStorage.getItem('userChoiceShotEffect') || '';
	let lastOriginalPaintChoice = localStorage.getItem('originalChoicePaint') || '';
	let lastNewPaintChoice = localStorage.getItem('newChoicePaint') || '';

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
		"请选择要使用的射击效果替换 (幻影黑/岩浆/粉红色/寒冷/毒/火/太阳/水/珊瑚礁/暗月/电/金/深红色/紫罗兰色/天空蓝/暴力/爆破手/黑暗/魔法/日食/神秘的红色/天空/虚空/血液/雪/正午/烟雾)（点击取消可不进行替换）:",
		lastShotEffectChoice,
		shotEffectsPattern,
		"输入无效，请输入有效的射击效果：幻影黑, 岩浆, 粉红色, 寒冷, 毒, 火, 太阳, 水, 珊瑚礁, 暗月, 电, 金, 深红色, 紫罗兰色, 天空蓝, 暴力, 爆破手, 黑暗, 魔法, 日食, 神秘的红色, 天空, 虚空, 血液, 雪, 正午, 烟雾"
	);

	let originalChoicePaint = getUserChoice(
		"请选择待替换迷彩（点击取消可不进行替换，若替换为动态迷彩，请确保原迷彩为动态迷彩，否则将显示为静态） :",
		lastOriginalPaintChoice,
		paintsPattern,
		"输入无效，请输入有效的迷彩"
	);

	let newChoicePaint = getUserChoice(
		"请选择要使用的替换后迷彩（点击取消可不进行替换，若替换为动态迷彩，请确保原迷彩为动态迷彩，否则将显示为静态）:",
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
    迷彩 ${originalChoicePaint ? originalChoicePaint.toUpperCase() : '不替换'} → ${newChoicePaint ? newChoicePaint.toUpperCase() : '不替换'}。
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
