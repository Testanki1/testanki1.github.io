const categories = new Map([
    ["hulls", ["wasp", "hopper", "hornet", "viking", "crusader", "hunter", "paladin", "dictator", "titan", "ares", "mammoth"]],
    ["turrets", ["firebird", "freeze", "isida", "tesla", "hammer", "twins", "ricochet", "vulcan", "smoky", "striker", "thunder", "scorpion", "magnum", "railgun", "gauss", "shaft"]],
    ["drones", ["crisis", "hyperion"]]
]);
const defaultTextures = {
    "wasp": "574/111243/33/322/31167700276263",
    "hopper": "564/5207/367/304/31244271140755",
    "hornet": "566/70102/323/346/31167700274103",
    "viking": "571/121215/5/23/31167700276142",
    "crusader": "566/4547/232/306/31330452744134",
    "hunter": "567/166366/55/140/31167700272025",
    "paladin": "573/47363/125/65/31222261301215",
    "dictator": "602/61700/245/106/31167700275611",
    "titan": "606/22645/10/357/31167700270522",
    "ares": "560/117661/334/334/31330453426702",
    "mammoth": "600/67314/131/54/31167700271637",
    "firebird": "573/113511/153/137/31167700271626",
    "freeze": "575/153310/123/250/31167700273561",
    "isida": "605/12650/334/263/31167700276234",
    "tesla": "567/20040/100/57/31254554136103",
    "hammer": "611/147301/37/333/31353636335156",
    "twins": "575/4122/336/247/31167700272424",
    "ricochet": "603/121326/210/264/31167700267554",
    "vulcan": "622/107753/242/303/31167700276134",
    "smoky": "566/114246/64/4/31167700272332",
    "striker": "0/16723/37/11/31167700275767",
    "thunder": "601/105644/16/124/31167700273301",
    "scorpion": "600/40107/4/364/31172771520222",
    "magnum": "0/16723/57/323/31167700274631",
    "railgun": "567/105205/202/122/31167700270037",
    "gauss": "611/61722/256/76/31167700275006",
    "shaft": "622/21305/321/374/31167700272525",
    "crisis": "562/45273/110/127/31167700270140",
    "hyperion": "556/107004/326/35/31167700276045"
};
const baseToUrl = "https://raw.githubusercontent.com/N3onTechF0X/TankiTextures/refs/heads/main/{folder}/{element}/{skin}/{file}"
const filenames = ["lightmap.webp", "image.webp", "texture.webp", "tracks.webp", "wheels.webp", "object.a3d", "object.3ds"]
