// ==UserScript==
// @name         Garage → Highland Map Swap
// @namespace    tanki/garage-swap
// @version      1.5.0
// @description  Replaces the Highland map loaded by the game with the Garage scene in real-time locally in the browser: fetches original object.a3d + textures, performs client-side conversion (collisions/spawns/materials/map.bin/models.a3d/lightmapdata) without cloud uploads. Includes an offline mode.
// @author       you
// @match        *://*.3dtank.com/play*
// @match        *://*.tankionline.com/play*
// @match        *://*.test-eu.tankionline.com/browser-public/index.html*
// @grant        none
// @run-at       document-start
// ==/UserScript==

/*
 * Principle:
 * ---------------------------------------------------------------------------
 * 1. Intercept window.fetch / XMLHttpRequest at document-start before the game initializes.
 * 2. Whenever a request targets a "Highland" map directory (the 4 themes in maps.json), block remote fetching:
 *      map.bin / models.a3d / lightmapdata / meta.info  -> Return locally generated data directly;
 *      Garage textures (Bush/Flags/... -astc.ktx|.webp) -> Redirect to garage asset directory;
 *      Ground textures (ground.webp|-astc.ktx)         -> Redirect to the actual terrain texture present in the current theme;
 *      Others (built-in terrain/atlases, etc.)         -> Pass through untouched.
 * 3. Required assets are fetched once from the garage directory (object.a3d ~573 KB + meta.info 2.4 KB, ~0.6 MB total).
 *    All subsequent processing is computed entirely in-browser via GarageMapCore: vertex baking, collision triangles,
 *    spawn points, material tables, map.bin (deflate) / models.a3d (v2) / lightmapdata / meta.info — no proxy servers involved.
 * 4. The entire garage is exported: courtyard, platform, factory/terrain/decorative tanks (outdoor, with collision),
 *    tree walls, far mountains, sky card (only 2 camera helpers are dropped).
 *    Spawn coordinates are broadcast by the server (prepareToSpawn/spawn protocol with position), so the client ignores
 *    spawn points inside map.bin. The garage is shifted as a whole to (-12000, -6000, ground z≈800): factory buildings
 *    are positioned south of all 159 Highland spawn points (verified: no spawn point is inside a building or wall),
 *    while the courtyard remains inside the spawn area. A 28 km × 16.4 km grass plane is generated below the spawn area
 *    (using theme terrain textures: grass1 / withered_grass / grass1_snow) + matching collision plane, placed 3 units below
 *    the garage terrain so garage surfaces render natively where present.
 * 5. Lightmap uses a constant grayscale level (default 128): the shader calculates light = min(2*(ambient+main*illum), 2*texel/255).
 *    255 doubles the brightness across the scene (overexposure), whereas 128 caps brightness at 1.0 (textures display at authored brightness).
 *    Configurable via the UI slider and persisted in localStorage.
 *
 * UI: A small circular button at the top-right corner (status dot: Gray=Idle / Green=Swapped / Red=Error / Orange=Offline).
 *     Click the button or swipe left from the top-right corner to open the drawer: Offline mode (WebSocket interception:
 *     readyState always reports OPEN, send is dropped, close/error suppressed, and current connection is closed; refresh to restore),
 *     Rebuild, Disable swap, Hide button.
 * Debugging: window.GarageSwap.status() / .rebuild() / .disable() / .offline() / .openPanel()
 */

/* Garage -> map-format converter core.
 * Pure JS (no Node APIs): shared by standalone tools and by the userscript.
 * Formats reverse-engineered from the game client and the map editor.
 *
 * buildFromGarage({ objectA3d, garageMeta, deflate, cfg }) -> { files, stats, textureNames }
 */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;   // Node
    root.GarageMapCore = api;                                                 // browser
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    // ---------------------------------------------------------------- defaults
    const DEFAULT_CFG = {
        // Only the two camera helpers are dropped: the complete garage scene is exported
        // (courtyard, factory/terrain surroundings 'outdoor', tree line, far mountains, sky card 'gsky').
        skipNames: ['cam0', 'cam_t0'],
        // -> collision triangles. 'outdoor' (terrain around the courtyard, buildings, decorative
        // tanks, the valley and the mountain ring) is solid too, so the surroundings can be driven on.
        solidNames: ['flr', 'wall', 'tnk_base', 'belt_l', 'belt_r', 'tnk_plat', 'outdoor'],
        floorName: 'flr',                                    // used for the safety plane + spawn ring
        floorMargin: 350,                                    // spawn ring inset from the floor bounds
        floorSpawnZ: 5,                                      // spawn height above the floor
        spawnRings: [
            { type: 2, count: 8, radius: 0.82, phase: 0 },
            { type: 3, count: 8, radius: 0.82, phase: Math.PI / 8 },
            { type: 4, count: 12, radius: 0.62, phase: Math.PI / 12 },
            { type: 5, count: 12, radius: 0.45, phase: Math.PI / 24 }
        ],
        planePadding: 400,                                   // safety plane is floor bounds + this (only when ground is off)
        // Where the garage (its local origin = centre of the tank platform) is put in battle-world
        // coordinates. The client never reads map.bin spawn points: the server sends the spawn
        // position (protocol prepareToSpawn/spawn(position, orientation)), so players appear at
        // Highland's spawn points: x -22250..-1750, y -8000..2250, z 900 or 1500 (spawn z = ground + ~100).
        // The garage scenery ('outdoor') lies south of the courtyard (local y -255..-4500 with the
        // factory buildings, the valley further south, mountains at -40 km). With the anchor at
        // y = -6000 the buildings are south of every spawn point (checked against all 159: none is
        // inside/over a building or wall, 3 are on the courtyard floor, 6 on the flat garage terrain),
        // while the courtyard stays inside the spawn field. Floor top at z 800 gives the ~100 drop.
        anchor: { x: -12000, y: -6000, z: 800 },
        // Flat ground under the whole spawn area so nobody falls into the void: one visible quad grid
        // textured with `texture` (resolved per theme by the userscript, e.g. grass1 / withered_grass /
        // grass1_snow from the Highland directory itself) + one collision plane of the same size.
        // It sits 3 units under the garage terrain (z 0 local), so wherever the garage has its own
        // ground the garage shows; minY stops just north of the garage valley (local y -4500).
        ground: {
            enabled: true, name: 'ground', texture: 'ground',
            minX: -26000, maxX: 2000, minY: -10400, maxY: 6000,   // spawn bbox + margin; minY = anchor.y - 4400
            zOffset: -3,                                          // relative to anchor.z (floor bottom is -2)
            cell: 2000,                                           // quad grid cell size
            tile: 1000                                            // texture repeat length (world units)
        },
        light: { colorInt: 0xffeec68e, ambientInt: 0xffa0b4c8, angleX: -1.0, angleZ: -0.5, name: 'lightmap-0_comp_light' },
        // constant lightmap texel (0..255). Shader: light = min(2*(ambient+main*illum), 2*texel/255)
        // -> 255 = cap 2.0 (overexposed), 128 = cap 1.0 (neutral).
        lightmapLevel: 128,
        // Shaders. The client's SingleTextureShader path never enables alpha test (Config.useAlphaTest
        // is false for that shader name), so textures with transparency have to use
        // TankiOnline/SpriteShader - exactly what Highland does for bushes/grass/trees/backdrops.
        // That shader REQUIRES the four scalar parameters below (client throws "Could not find
        // parameter" otherwise); alpha test threshold is 0.8 with mip compensation.
        // Which garage textures need it was measured from the WebP alpha channel sampled at the
        // meshes' UVs: Flags 37% / Grass 79% / Bush 43% / Tree1 18% / Tree_Wall 7% of samples are
        // transparent; every other texture is 100% opaque.
        shader: 'TankiOnline/SingleTextureShader',
        spriteShader: 'TankiOnline/SpriteShader',
        spriteMaterials: {                                   // per texture: same flags Highland uses
            Grass: { _Grass: 1, _UseWind: 1 },              //  = Highland "Grass_material"
            Bush: { _Grass: 0, _UseWind: 1 },               //  = Highland "bush1"/"bush2"
            Tree1: { _Grass: 0, _UseWind: 0 },              //  = Highland "Tree_Beech"
            Tree_Wall: { _Grass: 0, _UseWind: 0 },          //  = Highland "Tree_bdrop"
            Flags: { _Grass: 0, _UseWind: 0 }
        },
        spriteScalarDefaults: { _FogMax: 1, _UseSpriteLightingMode: 1 },
        // Highland's standard scalar block for SingleTextureShader (client only reads _FogMax).
        singleTextureScalars: { _FogMax: 1, _Surface: 0, _Blend: 0, _SurfaceType: 0, _ZWrite: 1, _SrcBlend: 1, _DstBlend: 0, _SrcBlendAlpha: 1, _DstBlendAlpha: 0 },
        // far scenery keeps 20% visibility through the fog, like Highland's "Landscape_a" (_FogMax 0.8)
        fogMaxOverrides: { Outdoor_2048: 0.8, sky1: 0.8 },
        mapName: 'garage_arena'
    };

    // ---- constant lightmap ---------------------------------------------------
    // The garage has no baked lightmap, so the lightmap is one constant grey level (cfg.lightmapLevel,
    // 0..255, same in R/G/B, alpha 255). How the client uses it (map SingleTexture shader):
    //     light = min(2.0 * (ambient + main * illumination), 2.0 * lightmapTexel)
    // and the KTX loader remaps the sRGB ASTC formats to their linear twins (37847 -> 37815), so the
    // texel value is used as-is: 255 -> cap 2.0 (everything doubled = the overexposure that was
    // reported), 128 -> cap 1.0 (textures reproduced at their authored brightness, faces turned away
    // from the theme light may be darker when 2*ambient < 1). For reference Highland's own lightmap
    // texels are: 25% = 88, median 148, 75% = 215, sunlit 250 (measured on the 1024x1024 mip).
    // Both variants are generated locally:
    //  WebP: 8x8 lossless VP8L, ~34 bytes (single-symbol prefix codes -> zero bits per pixel).
    //  ASTC: same container the game itself ships for this texture slot on Highland
    //        (KTX1, 4096x4096, 13 mip levels, glInternalFormat 0x93D7 = SRGB8_ALPHA8 ASTC 8x8,
    //         glBaseInternalFormat 0x1908), every 16-byte tile an ASTC void-extent constant-colour
    //         block in the exact byte pattern the game's own encoder emits for constant tiles
    //         (`fc fd ff..ff` + four 16-bit channels, each the 8-bit value replicated).
    const ASTC_MAGIC = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x31, 0x31, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];
    const ASTC_KV = [0x17, 0x00, 0x00, 0x00, 0x4b, 0x54, 0x58, 0x6f, 0x72, 0x69, 0x65, 0x6e,
        0x74, 0x61, 0x74, 0x69, 0x6f, 0x6e, 0x00, 0x53, 0x3d, 0x72, 0x2c, 0x54, 0x3d, 0x64, 0x00, 0x00];
    const LIGHTMAP_ASTC = { width: 4096, height: 4096, glInternalFormat: 0x93d7, glBaseInternalFormat: 0x1908 };

    /** ASTC void-extent (LDR) block for a constant colour; channels are 8-bit values. */
    function astcSolidBlock(r, g, b, a) {
        const c = v => Math.max(0, Math.min(255, Math.round(v)));
        return [0xfc, 0xfd, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
            c(r), c(r), c(g), c(g), c(b), c(b), c(a), c(a)];
    }
    const ASTC_WHITE_BLOCK = astcSolidBlock(255, 255, 255, 255);

    /** KTX1 container filled with one constant ASTC 8x8 tile (see above). */
    function buildSolidAstcKtx(level, over) {
        const L = level === undefined ? 255 : level;
        const block = astcSolidBlock(L, L, L, 255);
        const o = Object.assign({}, LIGHTMAP_ASTC, over || {});
        const mipCount = Math.floor(Math.log2(Math.max(o.width, o.height))) + 1;
        const perMip = [];
        let blocks = 0;
        for (let m = 0; m < mipCount; m++) {
            const w = Math.max(1, o.width >> m), h = Math.max(1, o.height >> m);
            const nb = Math.ceil(w / 8) * Math.ceil(h / 8);
            perMip.push(nb);
            blocks += nb;
        }
        const out = new Uint8Array(64 + ASTC_KV.length + mipCount * 4 + blocks * 16);
        out.set(ASTC_MAGIC, 0);
        const dv = new DataView(out.buffer);
        [0x04030201, 0, 1, 0, o.glInternalFormat, o.glBaseInternalFormat,
            o.width, o.height, 0, 0, 1, mipCount, ASTC_KV.length]
            .forEach((v, i) => dv.setUint32(12 + i * 4, v, true));
        out.set(ASTC_KV, 64);
        let off = 64 + ASTC_KV.length;
        for (let m = 0; m < mipCount; m++) {
            dv.setUint32(off, perMip[m] * 16, true);
            off += 4;
            for (let b = 0; b < perMip[m]; b++) { out.set(block, off); off += 16; }
        }
        if (off !== out.length) throw new Error('ASTC size mismatch');
        return out;
    }
    function buildWhiteAstcKtx(over) { return buildSolidAstcKtx(255, over); }

    /**
     * Lossless WebP (VP8L) of a solid colour. Header + five single-symbol prefix codes; a
     * single-symbol code costs 0 bits per pixel, so there is no pixel data at all.
     * Verified against libwebp (Pillow) for every grey level 0..255.
     */
    function buildSolidWebP(r, g, b, a, width, height) {
        const w = width || 8, h = height || 8;
        const bits = [];
        const put = (value, n) => { for (let i = 0; i < n; i++) bits.push((value >>> i) & 1); };   // LSB first
        put(w - 1, 14); put(h - 1, 14); put(a < 255 ? 1 : 0, 1); put(0, 3);   // size, alpha_is_used, version
        put(0, 1);                                    // no transform
        put(0, 1);                                    // no colour cache
        put(0, 1);                                    // no meta prefix codes
        for (const sym of [g, r, b, a, 0]) {          // green, red, blue, alpha, distance
            put(1, 1);                                // simple code
            put(0, 1);                                // one symbol
            put(1, 1);                                // symbol stored in 8 bits
            put(sym & 0xff, 8);
        }
        const payload = new Uint8Array(1 + Math.ceil(bits.length / 8) + 4);   // + 4 zero bytes of slack
        payload[0] = 0x2f;                            // VP8L signature
        for (let i = 0; i < bits.length; i++) if (bits[i]) payload[1 + (i >> 3)] |= 1 << (i & 7);
        const chunkLen = payload.length, padded = chunkLen + (chunkLen & 1);
        const out = new Uint8Array(12 + 8 + padded);
        const dv = new DataView(out.buffer);
        out.set([0x52, 0x49, 0x46, 0x46], 0); dv.setUint32(4, out.length - 8, true);           // RIFF size
        out.set([0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c], 8); dv.setUint32(16, chunkLen, true);   // WEBP VP8L
        out.set(payload, 20);
        return out;
    }
    function buildSolidWebPGrey(level) { const L = level === undefined ? 255 : level; return buildSolidWebP(L, L, L, 255); }

    // ---------------------------------------------------------------- helpers
    function b64decode(str) {
        if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(str, 'base64'));
        const bin = atob(str);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    }

    // ---- MD5 (compact, works in browser + Node)
    function md5(bytes) {
        const rl = (x, n) => (x << n) | (x >>> (32 - n));
        const add = (a, b) => (a + b) | 0;
        const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
            5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
            4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
            6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
        const K = new Int32Array(64);
        for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
        const len = bytes.length;
        const withPad = new Uint8Array((((len + 8) >> 6) + 1) << 6);
        withPad.set(bytes);
        withPad[len] = 0x80;
        const bitLen = len * 8;
        const dv = new DataView(withPad.buffer);
        dv.setUint32(withPad.length - 8, bitLen >>> 0, true);
        dv.setUint32(withPad.length - 4, Math.floor(bitLen / 4294967296), true);
        let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
        const M = new Int32Array(16);
        for (let off = 0; off < withPad.length; off += 64) {
            for (let i = 0; i < 16; i++) M[i] = dv.getInt32(off + i * 4, true);
            let A = a0, B = b0, C = c0, D = d0;
            for (let i = 0; i < 64; i++) {
                let F, g;
                if (i < 16) { F = (B & C) | (~B & D); g = i; }
                else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
                else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
                else { F = C ^ (B | ~D); g = (7 * i) % 16; }
                F = add(add(add(F, A), K[i]), M[g]);
                A = D; D = C; C = B;
                B = add(B, rl(F, S[i]));
            }
            a0 = add(a0, A); b0 = add(b0, B); c0 = add(c0, C); d0 = add(d0, D);
        }
        const out = new Uint8Array(16);
        const odv = new DataView(out.buffer);
        odv.setInt32(0, a0, true); odv.setInt32(4, b0, true); odv.setInt32(8, c0, true); odv.setInt32(12, d0, true);
        let hex = '';
        for (let i = 0; i < 16; i++) hex += out[i].toString(16).padStart(2, '0');
        return hex;
    }

    function quatRotate(q, v) {
        const x = q[0], y = q[1], z = q[2], w = q[3];
        const ix = w * v[0] + y * v[2] - z * v[1];
        const iy = w * v[1] + z * v[0] - x * v[2];
        const iz = w * v[2] + x * v[1] - y * v[0];
        const iw = -x * v[0] - y * v[1] - z * v[2];
        return [
            ix * w + iw * -x + iy * -z - iz * -y,
            iy * w + iw * -y + iz * -x - ix * -z,
            iz * w + iw * -z + ix * -y - iy * -x
        ];
    }
    const norm3 = v => { const l = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

    // ------------------------------------------------------------- byte writer
    function W() { this.parts = []; }
    W.prototype.raw = function (b) { this.parts.push(b); return this; };
    W.prototype.u8 = function (v) { this.parts.push(new Uint8Array([v & 0xff])); return this; };
    W.prototype.u16be = function (v) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v & 0xffff, false); this.parts.push(b); return this; };
    W.prototype.u32le = function (v) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, true); this.parts.push(b); return this; };
    W.prototype.i32le = function (v) { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, v | 0, true); this.parts.push(b); return this; };
    W.prototype.f32le = function (v) { const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, v, true); this.parts.push(b); return this; };
    W.prototype.f64le = function (v) { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, v, true); this.parts.push(b); return this; };
    W.prototype.u32be = function (v) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, false); this.parts.push(b); return this; };
    W.prototype.f32be = function (v) { const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, v, false); this.parts.push(b); return this; };
    W.prototype.f64be = function (v) { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, v, false); this.parts.push(b); return this; };
    W.prototype.u8str = function (s) { // lightmapdata uses a 1-byte length prefix
        const bytes = new Uint8Array(s.length);
        for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 0xff;
        this.u8(bytes.length); this.parts.push(bytes); return this;
    };
    W.prototype.nulstr = function (s) {
        const e = [];
        for (let i = 0; i < s.length; i++) e.push(s.charCodeAt(i) & 0xff);
        e.push(0);
        this.parts.push(new Uint8Array(e));
        return this;
    };
    W.prototype.strLen = function (n) {   // editor map.bin varint string length
        if (n <= 0x7f) this.u8(n);
        else if (n <= 0x3fff) { this.u8(0x80 | (n >> 8)); this.u8(n & 0xff); }
        else { this.u8(0xc0 | (n >> 16)); this.u16be(n & 0xffff); }
        return this;
    };
    W.prototype.mstr = function (s) {     // map.bin string (utf8, varint length)
        const bytes = [];
        for (let i = 0; i < s.length; i++) {
            const c = s.charCodeAt(i);
            if (c < 0x80) bytes.push(c);
            else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
            else bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
        }
        this.strLen(bytes.length);
        this.parts.push(new Uint8Array(bytes));
        return this;
    };
    W.prototype.buf = function () {
        let len = 0;
        for (const p of this.parts) len += p.length;
        const out = new Uint8Array(len);
        let o = 0;
        for (const p of this.parts) { out.set(p, o); o += p.length; }
        return out;
    };

    // ------------------------------------------------------------- A3D reading
    const A3D_COMPS = { 1: 3, 2: 2, 3: 3, 4: 2, 5: 4, 6: 3 };

    function reader(bytes) {
        const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
        let o = 0;
        return {
            b, dv,
            get off() { return o; }, set off(v) { o = v; },
            u32() { const v = dv.getUint32(o, true); o += 4; return v; },
            i32() { const v = dv.getInt32(o, true); o += 4; return v; },
            f32() { const v = dv.getFloat32(o, true); o += 4; return v; },
            str3() {
                const n = dv.getUint32(o, true); o += 4;
                let s = '';
                const end = o + n;
                for (const c of b.subarray(o, end)) s += String.fromCharCode(c);
                o = end + ((((n + 3) >> 2) << 2) - n);
                return s;
            },
            skip(n) { o += n; }
        };
    }

    // Reads the garage object.a3d (A3D v3, official block layout: root id 1, materials=4, meshes=2,
    // transforms=3, objects=5) and returns meshes/objects ready to be baked into world space.
    function readGarageA3D(bytes) {
        const r = reader(bytes);
        const magic = String.fromCharCode(r.b[0], r.b[1], r.b[2], r.b[3]);
        if (magic !== 'A3D\u0000') throw new Error('not an A3D file: ' + JSON.stringify(magic));
        r.off = 4;
        const version = r.u32(), rootId = r.u32(), rootSize = r.u32();
        if (version !== 3) throw new Error('expected A3D v3, got v' + version);
        if (rootId !== 1) throw new Error('unexpected A3D root block id ' + rootId);
        const out = { version, materials: [], meshes: [], transforms: [], objects: [] };
        const total = r.b.length;
        let p = 16;
        while (p + 8 <= total) {
            const id = r.dv.getUint32(p, true), size = r.dv.getUint32(p + 4, true);
            const end = p + 8 + size;
            r.off = p + 8;
            const count = r.u32();
            if (id === 4) {
                for (let i = 0; i < count; i++) {
                    const name = r.str3();
                    const color = [r.f32(), r.f32(), r.f32()];
                    const texName = r.str3().replace(/\.(png|webp|tga|jpg)$/i, '');
                    out.materials.push({ name, color, texName });
                }
            } else if (id === 2) {
                for (let i = 0; i < count; i++) {
                    const name = r.str3();
                    r.skip(28);                       // bbox (6 f32) + radius
                    const vertexCount = r.u32(), attrCount = r.u32();
                    const attributes = [];
                    for (let a = 0; a < attrCount; a++) {
                        const type = r.u32();
                        const comps = A3D_COMPS[type];
                        if (!comps) throw new Error('unknown vertex attribute type ' + type);
                        const data = new Float32Array(vertexCount * comps);
                        for (let k = 0; k < data.length; k++) data[k] = r.f32();
                        attributes.push({ type, comps, data });
                    }
                    const subCount = r.u32();
                    const submeshes = [];
                    for (let s = 0; s < subCount; s++) {
                        const indexCount = r.u32();
                        const indices = new Uint16Array(indexCount);
                        for (let k = 0; k < indexCount; k++) { indices[k] = r.dv.getUint16(r.off, true); r.skip(2); }
                        if (indexCount & 1) r.skip(2);
                        submeshes.push({ indices });
                    }
                    out.meshes.push({ name, vertexCount, attributes, submeshes });
                }
            } else if (id === 3) {
                for (let i = 0; i < count; i++) {
                    const name = r.str3();
                    const pos = [r.f32(), r.f32(), r.f32()];
                    const quat = [r.f32(), r.f32(), r.f32(), r.f32()];
                    let scale = [r.f32(), r.f32(), r.f32()];
                    if (!scale[0] && !scale[1] && !scale[2]) scale = [1, 1, 1];
                    if (!quat[0] && !quat[1] && !quat[2] && !quat[3]) quat[3] = 1;
                    out.transforms.push({ name, pos, quat, scale });
                }
                for (let i = 0; i < count; i++) r.i32();   // parents
            } else if (id === 5) {
                for (let i = 0; i < count; i++) {
                    const geo = r.u32(), node = r.u32();
                    const mc = r.u32();
                    const matIds = [];
                    for (let j = 0; j < mc; j++) matIds.push(r.i32());
                    out.objects.push({ geo, node, matIds });
                }
            }
            p = end;
        }
        out.objects.forEach(o => { o.name = out.transforms[o.node] ? out.transforms[o.node].name : ''; });
        return out;
    }

    // ------------------------------------------------------- garage -> geometry
    // Bakes each object's node transform into its vertices (that is what the map format needs:
    // prop placement stays identity and the geometry is already in world space).
    function bakeObjects(a3d, cfg) {
        const skip = new Set(cfg.skipNames || []);
        const built = [];
        for (const o of a3d.objects) {
            if (skip.has(o.name)) continue;
            const src = a3d.meshes[o.geo];
            const tf = a3d.transforms[o.node];
            if (!src || !tf) continue;
            const posAttr = src.attributes.find(a => a.type === 1);
            const nrmAttr = src.attributes.find(a => a.type === 3) || src.attributes.find(a => a.type === 6);
            const uvAttr = src.attributes.find(a => a.type === 2) || src.attributes.find(a => a.type === 4);
            const vertexCount = src.vertexCount;
            const positions = new Float32Array(vertexCount * 3);
            for (let v = 0; v < vertexCount; v++) {
                const local = [posAttr.data[v * 3] * tf.scale[0], posAttr.data[v * 3 + 1] * tf.scale[1], posAttr.data[v * 3 + 2] * tf.scale[2]];
                const rot = quatRotate(tf.quat, local);
                positions[v * 3] = rot[0] + tf.pos[0];
                positions[v * 3 + 1] = rot[1] + tf.pos[1];
                positions[v * 3 + 2] = rot[2] + tf.pos[2];
            }
            let normals = null;
            if (nrmAttr) {
                normals = new Float32Array(vertexCount * 3);
                for (let v = 0; v < vertexCount; v++) {
                    const n = norm3([nrmAttr.data[v * 3], nrmAttr.data[v * 3 + 1], nrmAttr.data[v * 3 + 2]]);
                    const rot = quatRotate(tf.quat, n);
                    normals[v * 3] = rot[0]; normals[v * 3 + 1] = rot[1]; normals[v * 3 + 2] = rot[2];
                }
            }
            const matId = (o.matIds && o.matIds.length) ? o.matIds[0] : 0;
            const mesh = {
                name: o.name, vertexCount, positions, normals,
                uvs: uvAttr ? uvAttr.data : null,
                indices: src.submeshes.length ? src.submeshes[0].indices : new Uint16Array(0),
                srcMatId: matId,
                texName: (a3d.materials[matId] || {}).texName || ''
            };
            let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
            for (let v = 0; v < vertexCount; v++) for (let c = 0; c < 3; c++) {
                const val = positions[v * 3 + c];
                if (val < min[c]) min[c] = val;
                if (val > max[c]) max[c] = val;
            }
            mesh.min = min; mesh.max = max;
            built.push(mesh);
        }
        return built;
    }

    // ------------------------------------------------- placement in battle space
    // Adds cfg.anchor to every baked vertex (props keep identity placement in map.bin, so this is
    // the only place the offset has to be applied; collision/spawns derive from these positions).
    function placeObjects(built, cfg) {
        const a = Object.assign({ x: 0, y: 0, z: 0 }, cfg.anchor || {});
        if (!a.x && !a.y && !a.z) return built;
        const d = [a.x, a.y, a.z];
        for (const b of built) {
            for (let v = 0; v < b.vertexCount; v++) for (let c = 0; c < 3; c++) b.positions[v * 3 + c] += d[c];
            b.min = b.min.map((v, c) => v + d[c]);
            b.max = b.max.map((v, c) => v + d[c]);
        }
        return built;
    }

    // Visible ground: a quad grid (CCW seen from +z, like the garage floor) with world-space tiling
    // UVs (u = x / tile) - the garage floor itself already relies on REPEAT wrapping (its UVs go to 1.88).
    function buildGround(cfg, srcMatId) {
        const g = cfg.ground;
        if (!g || g.enabled === false) return null;
        const az = (cfg.anchor && cfg.anchor.z) || 0;
        const z = az + (g.zOffset || 0);
        const cell = g.cell || 2000, tile = g.tile || 1000;
        const nx = Math.max(1, Math.ceil((g.maxX - g.minX) / cell));
        const ny = Math.max(1, Math.ceil((g.maxY - g.minY) / cell));
        const vertexCount = (nx + 1) * (ny + 1);
        if (vertexCount > 65535) throw new Error('ground grid too fine for u16 indices');
        const positions = new Float32Array(vertexCount * 3);
        const normals = new Float32Array(vertexCount * 3);
        const uvs = new Float32Array(vertexCount * 2);
        for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
            const v = j * (nx + 1) + i;
            const x = g.minX + (g.maxX - g.minX) * i / nx;
            const y = g.minY + (g.maxY - g.minY) * j / ny;
            positions[v * 3] = x; positions[v * 3 + 1] = y; positions[v * 3 + 2] = z;
            normals[v * 3 + 2] = 1;
            uvs[v * 2] = x / tile; uvs[v * 2 + 1] = y / tile;
        }
        const indices = new Uint16Array(nx * ny * 6);
        let k = 0;
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
            const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
            indices[k++] = a; indices[k++] = b; indices[k++] = d;    // (x+,y+) winding -> normal +z
            indices[k++] = a; indices[k++] = d; indices[k++] = c;
        }
        return {
            name: g.name || 'ground', vertexCount, positions, normals, uvs, indices,
            srcMatId, texName: g.texture || 'ground',
            min: [g.minX, g.minY, z], max: [g.maxX, g.maxY, z],
            isGround: true
        };
    }

    // ----------------------------------------------------------- models.a3d v2
    // v2 is what shipped maps (Highland/Cross/Parma) use and what both the game client's
    // v1/v2 reader and the editor's parseA3D expect: meshes have no name/bbox, the transform
    // block has no names, and names live in the objects block.
    function buildModelsA3D(a3dMaterials, built) {
        const matW = new W();
        for (const m of a3dMaterials) {
            matW.nulstr(m.name);
            matW.f32le(m.color[0]); matW.f32le(m.color[1]); matW.f32le(m.color[2]);
            matW.nulstr(m.texName || '');
        }
        const meshW = new W();
        for (const b of built) {
            meshW.u32le(b.vertexCount);
            const attrs = [{ type: 1, data: b.positions }];
            if (b.uvs) attrs.push({ type: 2, data: b.uvs });
            if (b.normals) attrs.push({ type: 3, data: b.normals });
            meshW.u32le(attrs.length);
            for (const a of attrs) {
                meshW.u32le(a.type);
                for (let k = 0; k < a.data.length; k++) meshW.f32le(a.data[k]);
            }
            meshW.u32le(1);                                   // submesh count
            const idx = b.indices;
            const faceCount = Math.floor(idx.length / 3);
            meshW.u32le(faceCount);                           // v2 submesh = faceCount ...
            for (let k = 0; k < faceCount * 3; k++) meshW.raw(new Uint8Array([idx[k] & 0xff, idx[k] >> 8]));
            for (let k = 0; k < faceCount; k++) meshW.u32le(0);   // ... per-face dword ...
            const matId = b.srcMatId | 0;
            meshW.raw(new Uint8Array([matId & 0xff, (matId >> 8) & 0xff]));  // ... u16 material id
        }
        const tfW = new W();
        for (let i = 0; i < built.length; i++) {
            tfW.f32le(0); tfW.f32le(0); tfW.f32le(0);
            tfW.f32le(0); tfW.f32le(0); tfW.f32le(0); tfW.f32le(1);
            tfW.f32le(1); tfW.f32le(1); tfW.f32le(1);
        }
        for (let i = 0; i < built.length; i++) tfW.i32le(-1);
        const objW = new W();
        built.forEach((b, i) => { objW.nulstr(b.name); objW.u32le(i); objW.u32le(i); });

        const out = new W();
        out.raw(new Uint8Array([0x41, 0x33, 0x44, 0x00]));    // "A3D\0"
        out.u32le(2);
        const body = [];
        const addBlock = (id, payload, count) => {
            const bw = new W();
            bw.u32le(id); bw.u32le(payload.length); bw.u32le(count); bw.raw(payload);
            body.push(bw.buf());
        };
        addBlock(4, matW.buf(), a3dMaterials.length);
        addBlock(2, meshW.buf(), built.length);
        addBlock(3, tfW.buf(), built.length);
        addBlock(5, objW.buf(), built.length);
        let total = 0;
        for (const p of body) total += p.length;
        out.u32le(1);          // root block id (client throws "not a root block" otherwise)
        out.u32le(total);
        for (const p of body) out.raw(p);
        return out.buf();
    }

    // --------------------------------------------------------------- map.bin
    function buildCollision(built, cfg) {
        const solid = new Set(cfg.solidNames || []);
        const col = { t1: [], t2: [], t3: [] };
        for (const b of built) {
            if (!solid.has(b.name)) continue;
            const idx = b.indices;
            for (let k = 0; k + 2 < idx.length; k += 3) {
                const a = idx[k], c = idx[k + 1], d = idx[k + 2];
                col.t3.push({
                    f1: 0,
                    data: [0, 0, 0, 0, 0, 0,
                        b.positions[a * 3], b.positions[a * 3 + 1], b.positions[a * 3 + 2],
                        b.positions[c * 3], b.positions[c * 3 + 1], b.positions[c * 3 + 2],
                        b.positions[d * 3], b.positions[d * 3 + 1], b.positions[d * 3 + 2]]
                });
            }
        }
        // CollisionPlane = { length (y extent), position, rotation, width (x extent) }; the client
        // builds the body from (width, length) * 0.5 half-extents around `position`.
        const ground = built.find(b => b.isGround);
        const floor = built.find(b => b.name === cfg.floorName);
        if (ground) {
            col.t2.push({
                f1: ground.max[1] - ground.min[1],
                f2: ground.max[0] - ground.min[0],
                data: [(ground.min[0] + ground.max[0]) / 2, (ground.min[1] + ground.max[1]) / 2, ground.min[2], 0, 0, 0]
            });
        } else if (floor) {
            const cx = (floor.min[0] + floor.max[0]) / 2, cy = (floor.min[1] + floor.max[1]) / 2;
            col.t2.push({
                f1: floor.max[1] - floor.min[1] + cfg.planePadding,
                f2: floor.max[0] - floor.min[0] + cfg.planePadding,
                data: [cx, cy, floor.min[2] - 2, 0, 0, 0]
            });
        }
        return col;
    }

    function buildSpawns(built, cfg) {
        const floor = built.find(b => b.name === cfg.floorName);
        if (!floor) return [];
        const cx = (floor.min[0] + floor.max[0]) / 2, cy = (floor.min[1] + floor.max[1]) / 2;
        const rx = (floor.max[0] - floor.min[0]) / 2 - cfg.floorMargin;
        const ry = (floor.max[1] - floor.min[1]) / 2 - cfg.floorMargin;
        const r0 = Math.min(rx, ry);                     // keep the rings circular
        const z = floor.max[2] + cfg.floorSpawnZ;
        const out = [];
        for (const ring of cfg.spawnRings) {
            for (let i = 0; i < ring.count; i++) {
                const a = ring.phase + (i / ring.count) * Math.PI * 2;
                out.push({
                    pos: [cx + Math.cos(a) * r0 * ring.radius, cy + Math.sin(a) * r0 * ring.radius, z],
                    rot: [0, 0, a + Math.PI],
                    type: ring.type
                });
            }
        }
        return out;
    }

    // materials: one SingleTextureShader per distinct texture (map materials reference textures
    // relative to the map base url via libraryName "" -- see buildMapBin)
    function buildMaterials(built, cfg) {
        const byTex = new Map();
        const materials = [];
        const scalarList = obj => Object.keys(obj).map(name => ({ name, value: obj[name] }));
        for (const b of built) {
            const tex = b.texName || 'default';
            if (!byTex.has(tex)) {
                byTex.set(tex, materials.length);
                const sprite = cfg.spriteMaterials && cfg.spriteMaterials[tex];
                const fogMax = (cfg.fogMaxOverrides && cfg.fogMaxOverrides[tex] != null) ? cfg.fogMaxOverrides[tex] : undefined;
                let shader, scalar;
                if (sprite) {
                    shader = cfg.spriteShader;
                    scalar = scalarList(Object.assign({}, cfg.spriteScalarDefaults, sprite));
                } else {
                    shader = cfg.shader;
                    scalar = scalarList(Object.assign({}, cfg.singleTextureScalars));
                }
                if (fogMax !== undefined) for (const sc of scalar) if (sc.name === '_FogMax') sc.value = fogMax;
                materials.push({
                    id: materials.length, name: tex, shader, scalar,
                    texParams: [{ name: '_BaseMap', texName: tex }]
                });
            }
            b.mapMatId = byTex.get(tex);
        }
        return materials;
    }

    function packMapBits(bits, body) {
        const extCount = Math.ceil(bits.length / 8) || 1;
        const ext = new Uint8Array(extCount).fill(0xff);
        for (let i = 0; i < bits.length; i++) if (bits[i]) ext[i >> 3] &= ~(1 << (7 - (i % 8)));
        let header;
        if (extCount <= 63) header = new Uint8Array([0x80 | extCount]);
        else {
            header = new Uint8Array(3);
            header[0] = 0x80 | 0x40 | ((extCount >> 16) & 0x3f);
            new DataView(header.buffer).setUint16(1, extCount & 0xffff, false);
        }
        const payload = new Uint8Array(header.length + ext.length + body.length);
        payload.set(header, 0); payload.set(ext, header.length); payload.set(body, header.length + ext.length);
        return payload;
    }

    function buildMapBin(materials, spawns, built, col, cfg) {
        const body = new W();
        const bits = [];
        const bit = v => bits.push(v);
        bit(false);                                  // no atlases
        bit(false);                                  // no batches
        const writeCols = c => {
            body.strLen(c.t1.length);
            for (const s of c.t1) for (let k = 0; k < 9; k++) body.f32be(s[k]);
            body.strLen(c.t2.length);
            for (const s of c.t2) {
                body.f64be(s.f1);
                for (let k = 0; k < 6; k++) body.f32be(s.data[k]);
                body.f64be(s.f2);
            }
            body.strLen(c.t3.length);
            for (const s of c.t3) {
                body.f64be(s.f1);
                for (let k = 0; k < 15; k++) body.f32be(s.data[k]);
            }
        };
        writeCols(col);
        writeCols({ t1: [], t2: [], t3: [] });        // outside-gaming-zone: empty
        body.strLen(materials.length);
        for (const m of materials) {
            body.u32be(m.id);
            body.mstr(m.name);
            if (m.scalar && m.scalar.length) {        // scalar parameters: [{name, f32 value}]
                bit(true);
                body.strLen(m.scalar.length);
                for (const sc of m.scalar) { body.mstr(sc.name); body.f32be(sc.value); }
            } else bit(false);
            body.mstr(m.shader);
            body.strLen(m.texParams.length);
            for (const tp of m.texParams) {
                // libraryName MUST be present and empty ("" = the map's own directory).
                // The client drops every texture parameter whose libraryName is null from the
                // "textures to load" set (filterNot(libName == null)) and only resolves those via
                // the atlas table; with no atlases the prop ends up with an empty texture map and
                // the client throws "Could not find texture by name X; keys: []".
                // Highland's own map.bin uses "" for all 79 non-atlas texture parameters.
                bit(true);                            // libraryName present ...
                body.mstr('');                        // ... and empty -> <map dir>/<texName>.webp|-astc.ktx
                body.mstr(tp.name);
                body.mstr(tp.texName);
            }
            bit(false); bit(false); bit(false);       // no vector2/3/4 parameters
        }
        bit(true);                                    // spawn points present
        body.strLen(spawns.length);
        for (const s of spawns) {
            body.f32be(s.pos[0]); body.f32be(s.pos[1]); body.f32be(s.pos[2]);
            body.f32be(s.rot[0]); body.f32be(s.rot[1]); body.f32be(s.rot[2]);
            body.u32be(s.type);
        }
        body.strLen(built.length);
        built.forEach((b, i) => {
            bit(false);                               // no group name
            body.u32be(i);
            body.mstr('');                            // empty libraryName -> models.a3d
            body.u32be(b.mapMatId);
            body.mstr(b.name);
            body.f32be(0); body.f32be(0); body.f32be(0);   // placement baked into the mesh
            bit(false); bit(false);                   // rotation 0 / scale 1 omitted
        });
        return packMapBits(bits, body.buf());
    }

    function wrapDeflated(payload, compressed) {
        const out = new Uint8Array(4 + compressed.length);
        const len = compressed.length;
        out[0] = 0xc0 | ((len >> 24) & 0x3f);
        out[1] = (len >> 16) & 0xff;
        out[2] = (len >> 8) & 0xff;
        out[3] = len & 0xff;
        out.set(compressed, 4);
        return out;
    }

    // ------------------------------------------------------------ lightmapdata
    function buildLightmapData(built, cfg) {
        const light = cfg.light;
        const w = new W();
        w.u32le(2);
        w.u32le(light.colorInt >>> 0);
        w.u32le(light.ambientInt >>> 0);
        w.f32le(light.angleX);
        w.f32le(light.angleZ);
        w.u32le(1);
        w.u8str(light.name);
        w.u32le(built.length);                        // one entry per prop (index = prop index)
        built.forEach((b, i) => {
            w.i32le(i);                               // index
            w.i32le(0);                               // lightmap 0
            w.f32le(1); w.f32le(1); w.f32le(0); w.f32le(0);   // uv scale/offset
            w.u8(0);                                  // no per-object uv array
            w.u8(1); w.u8(1);                         // castShadows, receiveShadows
        });
        w.u32le(0); w.u32le(0); w.u32le(0); w.u32le(0);
        return w.buf();
    }

    // ---------------------------------------------------------------- pipeline
    function utf8(str) {
        const out = [];
        for (let i = 0; i < str.length; i++) {
            const c = str.charCodeAt(i);
            if (c < 0x80) out.push(c);
            else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
            else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
        }
        return new Uint8Array(out);
    }

    /**
     * @param {Object} opts
     *   objectA3d  : ArrayBuffer|Uint8Array  garage object.a3d bytes
     *   garageMeta : Array<{name,size,md5}>  parsed garage meta.info (for texture size/md5)
     *   deflate    : (u8) => Promise<Uint8Array>  zlib/deflate wrapper
     *   cfg        : overrides for DEFAULT_CFG
     */
    async function buildFromGarage(opts) {
        const cfg = Object.assign({}, DEFAULT_CFG, opts.cfg || {});
        if (opts.cfg && opts.cfg.ground) cfg.ground = Object.assign({}, DEFAULT_CFG.ground, opts.cfg.ground);
        if (opts.cfg && opts.cfg.anchor) cfg.anchor = Object.assign({}, DEFAULT_CFG.anchor, opts.cfg.anchor);
        const a3d = readGarageA3D(opts.objectA3d);
        const built = placeObjects(bakeObjects(a3d, cfg), cfg);
        if (!built.length) throw new Error('no garage meshes found');
        const a3dMaterials = a3d.materials.slice();
        const ground = buildGround(cfg, a3dMaterials.length);
        if (ground) {
            a3dMaterials.push({ name: ground.name, color: [1, 1, 1], texName: ground.texName });
            built.push(ground);                            // last prop; textures/lightmap entries follow automatically
        }
        const materials = buildMaterials(built, cfg);
        const col = buildCollision(built, cfg);
        const spawns = buildSpawns(built, cfg);
        const payload = buildMapBin(materials, spawns, built, col, cfg);
        const compressed = await opts.deflate(payload);
        const mapBin = wrapDeflated(payload, compressed);
        const modelsA3D = buildModelsA3D(a3dMaterials, built);
        const lightmapdata = buildLightmapData(built, cfg);

        // meta.info: garage texture entries (minus object.a3d) + our own files
        const meta = [];
        const garageMeta = opts.garageMeta || [];
        for (const e of garageMeta) {
            if (e.name === 'object.a3d' || e.name === 'meta.info') continue;
            meta.push({ name: e.name, size: e.size, md5: e.md5 });
        }
        const lightmapWebp = buildSolidWebPGrey(cfg.lightmapLevel);
        const lightmapAstc = buildSolidAstcKtx(cfg.lightmapLevel);
        const known = new Set(meta.map(m => m.name));
        const push = (name, bytes, hash) => {
            if (known.has(name)) return;
            known.add(name);
            meta.push({ name, size: bytes.length, md5: hash });
        };
        push(cfg.light.name + '.webp', lightmapWebp, md5(lightmapWebp));
        push(cfg.light.name + '-astc.ktx', lightmapAstc, md5(lightmapAstc));
        push('map.bin', mapBin, md5(mapBin));
        push('models.a3d', modelsA3D, md5(modelsA3D));
        push('lightmapdata', lightmapdata, md5(lightmapdata));
        meta.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

        return {
            files: {
                'map.bin': mapBin,
                'models.a3d': modelsA3D,
                'lightmapdata': lightmapdata,
                'meta.info': utf8(JSON.stringify(meta, null, 2) + '\n'),
                [cfg.light.name + '.webp']: lightmapWebp,          // flat-white lightmap (webp renderer)
                [cfg.light.name + '-astc.ktx']: lightmapAstc       // flat-white lightmap (astc renderer)
            },
            aux: {
                [cfg.light.name + '.webp']: lightmapWebp
            },
            // garage textures (served from the garage directory) - the ground texture is *not* in
            // here: it is resolved per theme by the userscript
            textures: [...new Set(built.filter(b => !b.isGround).map(b => b.texName).filter(Boolean))],
            groundTexture: ground ? ground.texName : null,
            anchor: cfg.anchor,
            stats: {
                objects: built.length,
                lightmapLevel: cfg.lightmapLevel,
                spriteMaterials: materials.filter(m => m.shader === cfg.spriteShader).length,
                groundQuads: ground ? ground.indices.length / 6 : 0,
                lightmapAstcBytes: lightmapAstc.length,
                materials: materials.length,
                triangles: col.t3.length,
                planes: col.t2.length,
                spawns: spawns.length,
                mapBinBytes: mapBin.length,
                modelsBytes: modelsA3D.length,
                lightmapdataBytes: lightmapdata.length
            }
        };
    }

    return {
        DEFAULT_CFG, LIGHTMAP_ASTC, ASTC_WHITE_BLOCK, astcSolidBlock, buildWhiteAstcKtx, buildSolidAstcKtx,
        buildSolidWebP, buildSolidWebPGrey,
        md5, readGarageA3D, bakeObjects, placeObjects, buildGround, buildModelsA3D, buildMapBin,
        buildCollision, buildSpawns, buildMaterials, buildLightmapData,
        buildFromGarage
    };
});

/* Browser side of the garage -> Highland swap: request interception + UI.
 * Runs after GarageMapCore has been defined.
 * Dependencies: window.fetch / XMLHttpRequest / CompressionStream (all standard in modern browsers). */
(function () {
    'use strict';
    const core = globalThis.GarageMapCore;
    if (!core) { console.error('[Garage → Highland] Converter core not loaded (GarageMapCore missing)'); return; }

    // ------------------------------------------------------------------ Configuration
    const CFG = {
        enabled: true,
        // Map directories to intercept (the 4 themes of Highland REMASTER MM in maps.json).
        // To swap other maps, append their directory fragments here.
        // ground = large ground texture, derived from existing terrain textures within that theme
        // (verified in meta.info: both .webp and -astc.ktx exist), allowing the ground to match seasons.
        targets: [
            { name: 'Highland Summer Day', path: '570/174542/371/116/31656237623240', ground: 'grass1' },
            { name: 'Highland Summer Evening', path: '570/174542/371/160/31656237625001', ground: 'grass1' },
            { name: 'Highland Autumn', path: '570/174542/371/121/31656237623231', ground: 'withered_grass' },
            { name: 'Highland Winter Day', path: '570/174542/371/124/31656237623250', ground: 'grass1_snow' }
        ],
        // Garage assets base URL (raw source files fetched once and converted locally)
        garageBase: 'https://res.3dtank.com/637/150166/40/350/31772150500767/',
        // Conversion parameters; lightmapLevel can be tuned via the slider and stored in localStorage
        cfg: {},
        debug: true,
        showButton: true          // Small top-right circular button; drawer can also be opened by swiping left
    };

    const LOG = (...a) => { if (CFG.debug) console.log('%c[Garage → Highland]', 'color:#76FF33', ...a); };
    const LS_KEY = 'garageSwap.lightmapLevel';
    try {
        const saved = parseInt(window.localStorage.getItem(LS_KEY), 10);
        if (saved >= 0 && saved <= 255) CFG.cfg.lightmapLevel = saved;
    } catch (e) {}
    const lightmapLevel = () => (CFG.cfg.lightmapLevel !== undefined ? CFG.cfg.lightmapLevel : core.DEFAULT_CFG.lightmapLevel);

    // --------------------------------------------------------------- Build cache
    let buildPromise = null, buildResult = null, buildError = null;
    const hijackLog = [];

    async function fetchBytes(url) {
        const res = await window.originalFetch(url, { credentials: 'omit' });
        if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
        return new Uint8Array(await res.arrayBuffer());
    }

    async function deflateBytes(bytes) {
        if (typeof CompressionStream === 'function') {
            const cs = new CompressionStream('deflate');
            const w = cs.writable.getWriter();
            w.write(bytes); w.close();
            return new Uint8Array(await new Response(cs.readable).arrayBuffer());
        }
        throw new Error('Browser does not support CompressionStream; cannot compress map.bin');
    }

    function build() {
        if (!buildPromise) {
            buildPromise = (async () => {
                const t0 = performance.now();
                LOG('Starting local conversion: fetching garage assets from', CFG.garageBase);
                const [objectA3d, metaText] = await Promise.all([
                    fetchBytes(CFG.garageBase + 'object.a3d'),
                    window.originalFetch(CFG.garageBase + 'meta.info', { credentials: 'omit' }).then(r => r.text())
                ]);
                const garageMeta = JSON.parse(metaText.replace(/\\_/g, '_'));   // Underscores in garage meta.info are escaped as \_
                const res = await core.buildFromGarage({
                    objectA3d, garageMeta, deflate: deflateBytes, cfg: CFG.cfg
                });
                buildResult = res;
                LOG(`Conversion finished in ${Math.round(performance.now() - t0)} ms`, res.stats);
                updateUI();
                return res;
            })().catch(err => { buildError = err; LOG('Conversion failed', err); updateUI(); throw err; });
        }
        return buildPromise;
    }

    // ------------------------------------------------------------ Request classification
    function classify(url) {
        if (!url) return null;
        for (const t of CFG.targets) {
            const i = url.indexOf(t.path);
            if (i < 0) continue;
            const dirUrl = url.slice(0, i + t.path.length);
            const rest = url.slice(i + t.path.length).replace(/^\/+/, '');
            const file = rest.split('?')[0].split('#')[0];
            return { target: t, dirUrl, file, base: file.split('/').pop() };
        }
        return null;
    }

    /**
     * Determines what to return for a intercepted request.
     * @returns {Promise<null | {bytes:Uint8Array, type:string} | {redirect:string}>}
     *          null = do not intercept, proceed with original network request
     */
    async function serveFile(url) {
        if (!CFG.enabled) return null;
        const hit = classify(url);
        if (!hit) return null;
        const res = await build();
        const lmName = (CFG.cfg.light && CFG.cfg.light.name) || core.DEFAULT_CFG.light.name;

        if (hit.base === 'meta.info') return { bytes: res.files['meta.info'], type: 'application/json' };
        if (hit.base === lmName + '.webp') return { bytes: res.files[hit.base], type: 'image/webp' };
        if (res.files[hit.base]) return { bytes: res.files[hit.base], type: 'application/octet-stream' };
        // Large ground texture: named "ground" in map.bin, re-routed to existing terrain texture in this theme
        const g = res.groundTexture;
        if (g && hit.target.ground && (hit.base === g + '.webp' || hit.base === g + '-astc.ktx')) {
            return { redirect: hit.dirUrl + '/' + hit.target.ground + hit.base.slice(g.length) };
        }
        // Garage textures: redirect directly to the garage resource directory
        const tex = res.textures.find(t => hit.base === t + '.webp' || hit.base === t + '-astc.ktx');
        if (tex) return { redirect: CFG.garageBase + hit.base };
        return null;   // Others pass through
    }

    let hijackCount = 0;
    function noteHijack(url, what) {
        hijackCount++;
        hijackLog.push({ url, what, at: new Date().toISOString() });
        if (hijackLog.length > 60) hijackLog.shift();
        LOG('Intercepted', what, url);
        updateUI();
    }

    // --------------------------------------------------------------- Fetch Hook
    const origFetch = window.originalFetch || window.fetch;
    window.originalFetch = origFetch;

    window.fetch = async function (input, init) {
        let url = '';
        try { url = (input && typeof input === 'object' && 'url' in input) ? input.url : String(input); } catch (e) { url = ''; }
        if (classify(url) && CFG.enabled) {
            try {
                const served = await serveFile(url);
                if (served) {
                    if (served.redirect) {
                        noteHijack(url, '→ ' + served.redirect.split('/').pop());
                        const next = (input && typeof input === 'object' && 'url' in input)
                            ? new Request(served.redirect, input) : served.redirect;
                        return origFetch.call(this, next, init);
                    }
                    noteHijack(url, 'Generated locally');
                    return new Response(served.bytes, {
                        status: 200, statusText: 'OK',
                        headers: {
                            'Content-Type': served.type,
                            'Content-Length': String(served.bytes.length),
                            'X-Garage-Swap': '1'
                        }
                    });
                }
            } catch (e) { LOG('Intercept failed, falling back to original request', url, e); }
        }
        return origFetch.call(this, input, init);
    };

    // ---------------------------------------------------------------- XHR Hook
    // Interception pattern: open() records parameters; send() substitutes the URL with a blob or garage URL,
    // then performs the actual open + send. Any method calls required to run in OPENED state
    // (setRequestHeader, overrideMimeType, responseType) are buffered and reapplied.
    const XHRP = XMLHttpRequest.prototype;
    const xhrOpen = XHRP.open, xhrSend = XHRP.send;
    const xhrSetHeader = XHRP.setRequestHeader;
    const xhrMime = XHRP.overrideMimeType;
    const xhrAbort = XHRP.abort;
    const rtDesc = Object.getOwnPropertyDescriptor(XHRP, 'responseType');

    XHRP.open = function (method, url, ...rest) {
        this.__gsUrl = String(url);
        this.__gsMethod = method;
        this.__gsRest = rest;
        this.__gsHit = classify(this.__gsUrl) ? method : null;
        this.__gsHdr = [];
        this.__gsRT = undefined;
        this.__gsMime = undefined;
        this.__gsAborted = false;
        if (!this.__gsHit) return xhrOpen.call(this, method, url, ...rest);
        return undefined;
    };
    XHRP.send = function (body) {
        if (!this.__gsHit) return xhrSend.call(this, body);
        const self = this;
        (async () => {
            if (self.__gsAborted) return;
            let url = self.__gsUrl, revoke = null;
            try {
                const served = await serveFile(self.__gsUrl);
                if (served) {
                    if (served.redirect) { url = served.redirect; noteHijack(self.__gsUrl, '→ ' + url.split('/').pop()); }
                    else {
                        const blob = new Blob([served.bytes], { type: served.type });
                        url = URL.createObjectURL(blob); revoke = url;
                        noteHijack(self.__gsUrl, 'Generated locally');
                    }
                }
            } catch (e) { LOG('XHR intercept failed, falling back', e); }
            if (revoke) setTimeout(() => URL.revokeObjectURL(revoke), 60000);
            if (self.__gsAborted) return;
            self.__gsHit = null;                // Forward subsequent calls to native XHR
            xhrOpen.call(self, self.__gsMethod, url, ...self.__gsRest);
            for (const [n, v] of (self.__gsHdr || [])) { try { xhrSetHeader.call(self, n, v); } catch (e) {} }
            if (self.__gsMime !== undefined && xhrMime) { try { xhrMime.call(self, self.__gsMime); } catch (e) {} }
            if (self.__gsRT !== undefined && rtDesc && rtDesc.set) { try { rtDesc.set.call(self, self.__gsRT); } catch (e) {} }
            self.__gsUrl = url;
            xhrSend.call(self, body);
        })();
        return undefined;
    };
    XHRP.setRequestHeader = function (name, value) {
        if (this.__gsHit) { (this.__gsHdr = this.__gsHdr || []).push([name, value]); return; }
        return xhrSetHeader.apply(this, arguments);
    };
    if (xhrMime) XHRP.overrideMimeType = function (mime) {
        if (this.__gsHit) { this.__gsMime = mime; return; }
        return xhrMime.apply(this, arguments);
    };
    if (rtDesc && rtDesc.set) Object.defineProperty(XHRP, 'responseType', {
        configurable: true, enumerable: rtDesc.enumerable,
        get() { return rtDesc.get.call(this); },
        set(v) { if (this.__gsHit) { this.__gsRT = v; return; } rtDesc.set.call(this, v); }
    });
    XHRP.abort = function () {
        if (this.__gsHit) this.__gsAborted = true;
        return xhrAbort.apply(this, arguments);
    };

    // ------------------------------------------- Offline Mode (WebSocket Interception)
    // When enabled: readyState always reports OPEN, send() is suppressed, close/error events and
    // callbacks are blocked, and the active socket is closed locally. The client remains in-game,
    // allowing free roaming outside borders. Refresh page to restore connection.
    if (typeof window.WebSocket === 'function') {
        window._offlineMode = window._offlineMode || false;
        window._activeWs = window._activeWs || null;
        const OriginalWebSocket = window.WebSocket;
        const listenerMap = new WeakMap();
        window.WebSocket = new Proxy(OriginalWebSocket, {
            construct(target, args) {
                const ws = new target(...args);
                window._activeWs = ws;
                return new Proxy(ws, {
                    get(obj, prop) {
                        if (prop === 'readyState') return window._offlineMode ? 1 : obj.readyState;
                        if (prop === 'addEventListener') {
                            return function (type, listener, options) {
                                const wrapped = function (event) {
                                    if (window._offlineMode && (type === 'close' || type === 'error')) return;
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
                                if (window._offlineMode) return;
                                try { return obj.send(data); } catch (e) {}
                            };
                        }
                        if (typeof obj[prop] === 'function') return obj[prop].bind(obj);
                        return obj[prop];
                    },
                    set(obj, prop, value) {
                        if (prop === 'onclose' || prop === 'onerror') {
                            obj[prop] = function (event) {
                                if (window._offlineMode) return;
                                if (typeof value === 'function') return value.apply(this, arguments);
                            };
                            return true;
                        }
                        obj[prop] = value;
                        return true;
                    }
                });
            }
        });
    }
    function enableOffline() {
        if (window._offlineMode) return false;
        window._offlineMode = true;
        try { if (window._activeWs) window._activeWs.close(); } catch (e) {}
        LOG('Offline mode enabled (refresh page to reconnect)');
        return true;
    }

    // ------------------------------------------------------------------- UI
    const ICON_CLOSE = '<svg viewBox="0 -960 960 960"><path d="M480-424 284-228q-11 11-28 11t-28-11q-11-11-11-28t11-28l196-196-196-196q-11-11-11-28t11-28q11-11 28-11t28 11l196 196 196-196q11-11 28-11t28 11q11 11 11 28t-11 28L536-480l196 196q11 11 11 28t-11 28q-11 11-28 11t-28-11L480-424Z"/></svg>';
    const ICON_WIFI_OFF = '<svg viewBox="0 -960 960 960"><path d="M762-84 414-434q-31 7-59.5 19T301-386q-21 14-46.5 14.5T212-389q-18-18-16.5-43.5T217-473q23-17 48.5-31t52.5-26l-90-90q-26 14-50.5 29.5T130-557q-20 16-45.5 16T42-559q-18-18-17-43t21-41q22-18 45-34.5t49-30.5l-56-56q-11-11-11-28t11-28q11-11 28-11t28 11l679 679q12 12 12 28.5T819-84q-12 11-28.5 11.5T762-84Zm-353-65.5Q380-179 380-220q0-42 29-71t71-29q42 0 71 29t29 71q0 41-29 70.5T480-120q-42 0-71-29.5ZM753-395q-16 16-37.5 15.5T678-396l-10-10-10-10-96-96q-13-13-5-27t28-9q45 11 85.5 31t75.5 47q18 14 20.5 36.5T753-395Zm165-164q-17 18-42 18.5T831-556q-72-59-161.5-91.5T480-680q-21 0-40.5 1.5T400-674q-25 4-45-10.5T331-724q-4-25 11-45t40-24q24-4 48.5-5.5T480-800q125 0 235.5 41.5T914-644q20 17 21 42t-17 43Z"/></svg>';
    const ICON_SWAP = '<svg viewBox="0 -960 960 960"><path d="M280-160 80-360l200-200 56 57-103 103h287v80H233l103 103-56 57Zm400-240-56-57 103-103H440v-80h287L624-743l56-57 200 200-200 200Z"/></svg>';
    const UI_CSS = `
        :host { --primary:#76FF33; --bg:#001926; --surface-high:rgba(191,213,255,.08); --surface-highest:rgba(191,213,255,.12);
                --on-surface:#E2E2E9; --on-surface-variant:#BFD5FF; --outline:#4D7380; --error:#FF6666; font-family:Rubik,system-ui,sans-serif; }
        * { box-sizing:border-box; font-family:inherit; }
        .m3-interactive { position:relative; overflow:hidden; cursor:pointer; transition:transform .2s, background-color .2s, border-color .2s, opacity .3s; }
        .m3-interactive::after { content:""; position:absolute; inset:0; background:currentColor; opacity:0; transition:opacity .2s; pointer-events:none; }
        .m3-interactive:hover::after { opacity:.08; }
        .m3-interactive:active { transform:scale(.96); }
        .svg-icon { display:inline-flex; align-items:center; justify-content:center; width:20px; height:20px; flex-shrink:0; }
        .svg-icon svg { width:100%; height:100%; fill:currentColor; }
        .fab { position:fixed; top:8px; right:8px; width:34px; height:34px; border-radius:17px; border:1px solid rgba(118,255,51,.45);
               background:rgba(0,25,38,.75); color:var(--primary); pointer-events:auto; display:flex; align-items:center; justify-content:center;
               padding:0; opacity:.55; box-shadow:0 2px 8px rgba(0,0,0,.35); }
        .fab:hover { opacity:1; }
        .fab .dot { position:absolute; right:2px; bottom:2px; width:9px; height:9px; border-radius:50%; background:#888; border:1px solid var(--bg); }
        .fab .dot.ok { background:var(--primary); } .fab .dot.err { background:var(--error); } .fab .dot.off { background:#FFB74D; }
        .overlay { position:fixed; inset:0; background:rgba(0,0,0,.6); opacity:0; pointer-events:none; transition:opacity .3s; backdrop-filter:blur(4px); }
        .drawer { position:fixed; top:0; right:0; width:380px; max-width:85vw; height:100%; background:var(--bg); color:var(--on-surface); pointer-events:auto;
                  transform:translateX(100%); transition:transform .4s cubic-bezier(.2,0,0,1); display:flex; flex-direction:column;
                  box-shadow:-8px 0 32px rgba(0,0,0,.6); border-top-left-radius:24px; border-bottom-left-radius:24px; }
        .header { padding:20px; display:flex; justify-content:space-between; align-items:center; gap:8px; }
        .title-container { display:flex; flex-direction:column; gap:4px; flex:1; min-width:0; }
        .title { font-size:18px; font-weight:600; color:var(--primary); margin:0; white-space:nowrap; }
        .subtitle { font-size:12px; color:var(--on-surface-variant); opacity:.9; line-height:1.3; }
        .icon-btn { background:transparent; border:none; color:var(--on-surface-variant); padding:8px; border-radius:50%; display:flex; align-items:center; justify-content:center; }
        .icon-btn .svg-icon { width:24px; height:24px; }
        .content { flex:1; overflow-y:auto; padding:0 24px 24px 24px; }
        .link-card { background:var(--surface-high); border-radius:16px; padding:16px; margin-bottom:16px; display:flex; flex-direction:column; gap:12px; }
        .card-title { font-size:15px; font-weight:600; color:var(--primary); }
        .card-desc { font-size:12px; color:var(--on-surface-variant); line-height:1.4; white-space:pre-line; }
        .btn { background:var(--surface-highest); color:var(--on-surface); border:1px solid transparent; padding:10px 16px; border-radius:20px; font-weight:500;
               display:inline-flex; align-items:center; justify-content:center; gap:8px; font-size:14px; }
        .btn.full { width:100%; border-color:var(--outline); }
        .btn.active { background:rgba(255,51,102,.15); border-color:var(--error); color:var(--error); }
        .row { display:flex; gap:8px; flex-wrap:wrap; }
        .slider-row { display:flex; flex-direction:column; gap:6px; }
        .slider-label { font-size:12px; color:var(--on-surface-variant); }
        input[type=range] { width:100%; accent-color:var(--primary); pointer-events:auto; }
        .row .btn { flex:1; font-size:13px; padding:8px 10px; }
        .toast { position:fixed; bottom:32px; left:50%; transform:translateX(-50%) translateY(20px); background:var(--on-surface-variant); color:var(--bg);
                 padding:12px 24px; border-radius:24px; font-weight:600; opacity:0; pointer-events:none; transition:opacity .3s, transform .3s;
                 box-shadow:0 8px 24px rgba(0,0,0,.4); max-width:90vw; text-align:center; }
    `;
    let ui = null;
    function createUI() {
        if (ui || typeof document === 'undefined' || !document.body) return;
        const host = document.createElement('div');
        host.id = 'garage-swap-ui';
        host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483646;';
        document.body.appendChild(host);
        const shadow = host.attachShadow({ mode: 'open' });
        shadow.innerHTML = `<style>${UI_CSS}</style>
            <button class="fab m3-interactive" id="fab" title="Garage → Highland"><span class="svg-icon">${ICON_SWAP}</span><span class="dot" id="dot"></span></button>
            <div class="overlay" id="overlay"></div>
            <div class="drawer" id="drawer">
                <div class="header">
                    <div class="title-container"><h2 class="title">Garage → Highland</h2><div class="subtitle" id="status"></div></div>
                    <button class="icon-btn m3-interactive" id="close-btn"><span class="svg-icon">${ICON_CLOSE}</span></button>
                </div>
                <div class="content">
                    <div class="link-card" id="offline-card">
                        <div class="card-title">Offline Mode</div>
                        <div class="card-desc">Disconnects from the server and suppresses disconnect prompts, allowing boundary exploration.</div>
                        <button class="btn full m3-interactive" id="offline-btn"><span class="svg-icon">${ICON_WIFI_OFF}</span><span id="offline-text">Enable Offline</span></button>
                    </div>
                    <div class="link-card">
                        <div class="card-title">Map Replacement</div>
                        <div class="card-desc" id="detail"></div>
                        <div class="slider-row">
                            <span class="slider-label" id="lm-label"></span>
                            <input type="range" id="lm-slider" min="48" max="255" step="1">
                        </div>
                        <div class="row">
                            <button class="btn m3-interactive" id="rebuild-btn">Rebuild</button>
                            <button class="btn m3-interactive" id="toggle-btn">Disable Swap</button>
                            <button class="btn m3-interactive" id="hide-btn">Hide Button</button>
                        </div>
                    </div>
                </div>
            </div>
            <div class="toast" id="toast"></div>`;
        const $ = id => shadow.getElementById(id);
        ui = { host, shadow, fab: $('fab'), dot: $('dot'), overlay: $('overlay'), drawer: $('drawer'), status: $('status'),
               detail: $('detail'), offlineBtn: $('offline-btn'), offlineText: $('offline-text'), toggleBtn: $('toggle-btn'),
               lmSlider: $('lm-slider'), lmLabel: $('lm-label'), toast: $('toast'), open: false, toastTimer: null };
        ui.lmSlider.value = String(lightmapLevel());
        let lmTimer = null;
        ui.lmSlider.addEventListener('input', () => { CFG.cfg.lightmapLevel = parseInt(ui.lmSlider.value, 10); updateUI(); });
        ui.lmSlider.addEventListener('change', () => {
            CFG.cfg.lightmapLevel = parseInt(ui.lmSlider.value, 10);
            try { window.localStorage.setItem(LS_KEY, String(CFG.cfg.lightmapLevel)); } catch (e) {}
            clearTimeout(lmTimer);
            lmTimer = setTimeout(async () => {
                buildPromise = null; buildError = null; updateUI();
                try { await build(); showToast(`Lightmap ${lightmapLevel()} applied (takes effect on next map load)`); } catch (e) { showToast('Conversion failed: ' + e.message, 6000); }
            }, 400);
        });
        const toggle = force => {
            ui.open = force !== undefined ? force : !ui.open;
            ui.drawer.style.transform = ui.open ? 'translateX(0)' : 'translateX(100%)';
            ui.overlay.style.pointerEvents = ui.open ? 'auto' : 'none';
            ui.overlay.style.opacity = ui.open ? '1' : '0';
            if (ui.open) updateUI();
        };
        ui.toggle = toggle;
        ui.fab.addEventListener('click', () => toggle());
        ui.overlay.addEventListener('click', () => toggle(false));
        $('close-btn').addEventListener('click', () => toggle(false));
        ui.offlineBtn.addEventListener('click', () => {
            if (enableOffline()) { updateUI(); showToast('Offline mode enabled!', 5000); toggle(false); }
            else showToast('Already in offline mode. Refresh page to restore connection.', 4000);
        });
        $('rebuild-btn').addEventListener('click', async () => {
            buildPromise = null; buildError = null; updateUI();
            try { await build(); showToast('Conversion complete'); } catch (e) { showToast('Conversion failed: ' + e.message, 6000); }
        });
        ui.toggleBtn.addEventListener('click', () => {
            CFG.enabled = !CFG.enabled; updateUI();
            showToast(CFG.enabled ? 'Swap enabled (takes effect on next Highland entry)' : 'Swap disabled (takes effect on next Highland entry)');
        });
        $('hide-btn').addEventListener('click', () => { ui.fab.style.display = 'none'; toggle(false); showToast('Button hidden; swipe left from top-right corner to reopen panel'); });

        // Gesture: swipe left from top-right corner (50x120px region) by >= 80px to open panel
        let tx = 0, ty = 0;
        window.addEventListener('touchstart', e => { tx = e.changedTouches[0].screenX; ty = e.changedTouches[0].screenY; }, { passive: true });
        window.addEventListener('touchend', e => {
            const ex = e.changedTouches[0].screenX, ey = e.changedTouches[0].screenY;
            if (tx > window.innerWidth - 50 && ty < 120 && ex - tx < -80 && Math.abs(ey - ty) < 80) toggle(true);
        }, { passive: true });
        if (!CFG.showButton) ui.fab.style.display = 'none';
        updateUI();
    }
    function showToast(msg, duration) {
        if (!ui) return;
        clearTimeout(ui.toastTimer);
        ui.toast.textContent = msg;
        ui.toast.style.opacity = '1';
        ui.toast.style.transform = 'translateX(-50%) translateY(0)';
        ui.toastTimer = setTimeout(() => { ui.toast.style.opacity = '0'; ui.toast.style.transform = 'translateX(-50%) translateY(20px)'; }, duration || 4000);
    }
    function statusText() {
        if (!CFG.enabled) return 'Swap disabled';
        if (buildError) return 'Conversion failed: ' + buildError.message;
        if (!buildResult) return 'Waiting for map to load...';
        return `Swapped · Intercepted ${hijackCount} times` + (window._offlineMode ? ' · Offline' : '');
    }
    function detailText() {
        if (!buildResult) return 'Automatically converts when loading any Highland theme (~0.6 MB garage assets, 0.3–1s).';
        const s = buildResult.stats, a = buildResult.anchor || {};
        const last = hijackLog.slice(-3).map(h => h.url.split('/').pop().split('?')[0]).join(', ');
        return `${s.objects} objects / ${s.triangles} collision tris / Ground: ${s.groundQuads} quads\nAnchor (${a.x}, ${a.y}, ${a.z}) · map.bin ${(s.mapBinBytes / 1024).toFixed(0)} KB` + (last ? `\nRecent intercepts: ${last}` : '');
    }
    function updateUI() {
        if (!ui) return;
        ui.status.textContent = statusText();
        ui.detail.textContent = detailText();
        ui.dot.className = 'dot ' + (window._offlineMode ? 'off' : buildError ? 'err' : buildResult ? 'ok' : '');
        ui.toggleBtn.textContent = CFG.enabled ? 'Disable Swap' : 'Enable Swap';
        const L = lightmapLevel();
        ui.lmLabel.textContent = `Lightmap brightness: ${L} (Shader cap ${(2 * L / 255).toFixed(2)}; 128 = neutral, 255 = overexposed)`;
        if (String(ui.lmSlider.value) !== String(L)) ui.lmSlider.value = String(L);
        if (window._offlineMode) { ui.offlineText.textContent = 'Offline Active'; ui.offlineBtn.classList.add('active'); }
    }
    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', createUI);
        else createUI();
    }

    // ------------------------------------------------------------------ Debugging API
    globalThis.GarageSwap = {
        CFG, core,
        build,
        classify,
        serveFile,
        status: () => ({ buildResult, buildError, hijackCount, hijackLog, cfg: CFG }),
        rebuild: () => { buildPromise = null; buildError = null; return build(); },
        disable: () => { CFG.enabled = false; updateUI(); },
        enable: () => { CFG.enabled = true; updateUI(); },
        offline: enableOffline,
        openPanel: () => { createUI(); if (ui) ui.toggle(true); }
    };
    LOG('Injected, matching targets:', CFG.targets.map(t => t.path).join(' | '));
})();
