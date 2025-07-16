// ==UserScript==
// @name         Overrider
// @version      3.2.0
// @description  Override any file in game
// @author       N3onTechF0X
// @icon         https://raw.githubusercontent.com/N3onTechF0X/Overrider/main/logo.png
// @match        https://*.tankionline.com/*
// @match        https://*.3dtank.com/*
// @require      https://testanki1.github.io/overrider/consts.js
// @require      https://testanki1.github.io/overrider/overrider.src.js
// @require      https://testanki1.github.io/overrider/utils.js
// @grant        GM_xmlhttpRequest
// ==/UserScript==

resourcesOverrider.push({
    from: `574/111243/33/322/31167700276263/meta.info`,
    to: `https://testanki1.github.io/spider/meta.info`
},
{
    from: `574/111243/33/322/31167700276263/object.a3d`,
    to: `https://testanki1.github.io/spider/object.a3d`
},
{
    from: `574/111243/33/322/31167700276263/lightmap.webp`,
    to: `https://testanki1.github.io/spider/lightmap.webp`
},
{
    from: `574/111243/33/322/31167700276263/tracks.webp`,
    to: `https://testanki1.github.io/spider/tracks.webp`
});
