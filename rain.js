// ---- MÀN 1: MƯA LỜI YÊU · GIỮ TAY ĐỂ GOM ----
// Lời yêu 3D rơi như mưa, tim đỏ rơi xen kẽ, hạt sáng lấp lánh (thông số lấy
// từ rain-3d-new, viết lại bằng Three r128 cho chung một WebGL context với
// cú chuyển cảnh). Người xem đặt ngón tay lên màn hình: mưa bị hút về chỗ
// ngón tay, xoáy như lốc rồi siết dần thành một trái tim. Giữ đủ HOLD_MS rồi
// thả tay → trái tim co về đúng chỗ tim ngân hà ở màn 2 và nở ra ở đó.
//
// File này nạp SAU script.js (dùng letter, getUrlParameter, nhạc, helper...)
// và TRƯỚC orbit.js. Hàm của orbit.js chỉ được gọi khi người xem đã thả tay,
// lúc đó orbit.js chắc chắn đã nạp xong.

// Frases predeterminadas. ?rain= o un mensaje de LoveGift puede reemplazarlas.
const DEFAULT_RAIN_MESSAGES = [
    'VIC PERSI ❤️',
    'VIC PERSI te ama ❤️',
    'Con amor, VIC PERSI 🌹',
    'VIC PERSI siempre contigo 💕',
    'Para ti, de VIC PERSI 💐',
    'VIC PERSI piensa en ti 💭❤️',
    'Mi amor es tuyo, VIC PERSI 💞',
    'VIC PERSI: mi corazón es tuyo 💘',
    'Eres todo mi mundo 🌍💕',
    'progrmador 💖',
    'Siempre a tu lado 💍✨',
    'diseñador grafico 🥰',
    'VIC PERSI ❤️🥰',
    'Contigo soy feliz 🌸💞',
    'white hack🌹',
    'Eres mi destino 💫',
    'VIC PERSI 💗',
    'Por toda la vida solo te amaré a ti 💋',
    'Eres la más bella del mundo 🌎💐',
    'VIC PERSI te lleva en el corazón ❤️',
    'A tu lado encuentro la paz 🌷☁️',
    'Te amo más que ayer 💝',
    'Eres lo más maravilloso 🎀💕'
];

const RAIN_MAX_CHARS = 60;

function buildRainMessages() {
    const fromUrl = getUrlParameter('rain');
    const list = Array.isArray(fromUrl)
        ? fromUrl
        : (typeof fromUrl === 'string' ? fromUrl.split(',') : null);
    const pick = arr => (arr || [])
        .map(text => String(text || '').trim().slice(0, RAIN_MAX_CHARS))
        .filter(Boolean);

    const custom = pick(list);
    if (custom.length) return custom;
    const fromLovegift = pick(lovegiftConfig.messages);
    if (fromLovegift.length) return fromLovegift;
    return DEFAULT_RAIN_MESSAGES;
}

const rainMessages = buildRainMessages();

// Máy yếu: giảm độ phân giải vẽ. Cùng tiêu chí với orbitDeviceTier() ở orbit.js.
const RAIN_LITE = (() => {
    const cores = navigator.hardwareConcurrency || 4;
    const memory = navigator.deviceMemory;
    return cores <= 4 || (typeof memory === 'number' && memory <= 4);
})();

// Mọi con số dưới đây chép từ rain-3d-new (home.js: Zr, Hr, Nr, Fr, kr và
// particle-effect.js: w0) để màn mưa trông y như bản gốc.
const RAIN = {
    fov: 100,
    camX: -10,
    camZ: 30,
    // Lưới chữ 8 lớp sâu × 15 cột. Câu dài (> 20 ký tự) giãn cách 6, ngắn 3.
    textRows: 8,
    textCols: 15,
    fontSize: 1.5,
    letterSpacing: -0.1,
    wrapWords: 8,
    textFloor: -30,
    textSpeed: [14, 20],
    // Lưới tim 10 × 10, rơi từ y 50–70 xuống -40.
    heartRows: 10,
    heartCols: 10,
    heartScale: 0.15,
    heartTop: [50, 70],
    heartFloor: -40,
    heartSpeed: [5, 15],
    heartColor: 0xff1e00,
    sparkles: 1000,
    pink: new THREE.Color('#EE66A6').convertSRGBToLinear(),
    blue: new THREE.Color('#99DDFF').convertSRGBToLinear(),
    colorPeriod: 2.5,
    // Bản gốc: emissiveIntensity 1.5 cộng ánh sáng môi trường, toneMapped tắt.
    textGlow: 1.15,
    bloom: { strength: 0.9, radius: 0.7, threshold: 0.1 }
};

// Giữ tay bao lâu thì tim hình thành.
const HOLD_MS = 1800;
// "Bay xuyên mưa" sau khi thả tay (ms / đơn vị thế giới). Xem plan-07 §2.3.
const RAIN_EXIT = {
    pulse: 500,          // tim ngân hà đập một nhịp trước khi bay
    steer: 1300,         // camera lái vào tâm tim
    duration: 3600,      // tổng quãng lao tới — xuyên qua tim ở ~1,4 s
    distance: 200,       // camera.z = 30 − distance·p²
    fovKick: 18,         // FOV 100 → 118
    tunnelFrom: 900,     // từ đây vật lọt ra sau camera được đặt lại phía trước
    glowStart: 1700,
    glowFull: 3300,
    orbitOpen: 2700,
    veilStart: 2700,
    veilDur: 600,
    handoff: 3200,
    bloomPeak: 2.4
};

let rainItems = [];
let rainSparkles = null;
let rainComposer = null;
let rainBloom = null;
let rainClock = null;
let rainTime = 0;
let rainHeartSize = 6;
let rainGlow = null;
let rainGalaxy = null;

// Trái tim ngân hà lúc giữ tay (plan-07 §2.5): hạt sáng xoắn ốc về thành một
// trái tim 3D dày; vài tim đỏ đậu trên viền; vài câu chữ bay thành vòng quỹ
// đạo quanh tim. Còn lại vẫn là mưa, chỉ chậm dần và mờ bớt.
const GALAXY = {
    count: RAIN_LITE ? 1600 : 2800,
    edgeHearts: 30,
    ringTexts: 12,
    depth: 0.38,       // độ phồng 3D, theo nửa bề ngang tim
    turns: 1,          // số vòng xoắn khi hạt bay vào — phải là số nguyên
    // Vầng chữ bao quanh tim (elip trong mặt phẳng tim), theo nửa bề ngang tim.
    haloX: 1.6,
    haloY: 1.3
};

// Trạng thái cú giữ tay. center = điểm ngón tay trên mặt phẳng z = 0 (toạ độ
// thế giới), centerGoal là nơi ngón tay đang ở — tâm lốc đuổi theo cho mượt.
const hold = {
    active: false,
    pointerId: null,
    start: 0,
    progress: 0,
    formed: false,
    center: new THREE.Vector3(),
    centerGoal: new THREE.Vector3(),
    screen: { x: 0, y: 0 }
};

// Chuyển cảnh sang màn 2 đang chạy (null nếu không).
let rainExit = null;

// ---- HÌNH HỌC ----
// Chiều cao/rộng khung nhìn (đơn vị thế giới) ở độ sâu z — xấp xỉ, đủ để
// ước lượng cỡ trái tim.
function viewHeightAt(z) {
    return 2 * (RAIN.camZ - z) * Math.tan(THREE.MathUtils.degToRad(RAIN.fov / 2));
}

function viewWidthAt(z) {
    return viewHeightAt(z) * (window.innerWidth / window.innerHeight);
}

function randBetween([min, max]) {
    return min + Math.random() * (max - min);
}

// Điểm trên viền tim, gốc ở giữa tim, nửa bề ngang = 1.
// heartCurveNormalized (script.js) trả về hệ 0–100 với y hướng xuống.
function heartPoint(t) {
    const [x, y] = heartCurveNormalized(t);
    return [(x - 50) / 50, ((50 - y) / 50) * (28.8 / 32)];
}

// Đổi toạ độ màn hình (px) sang điểm trên mặt phẳng z = 0.
function screenToWorld(x, y, out) {
    const v = new THREE.Vector3((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1, 0.5);
    v.unproject(camera);
    const dir = v.sub(camera.position).normalize();
    const dist = -camera.position.z / dir.z;
    return out.copy(camera.position).add(dir.multiplyScalar(dist));
}

// ---- CHỮ ----
// Bản gốc dùng troika-three-text (font Mali, cỡ 1.5, giãn chữ -0.1, tự xuống
// dòng sau 8 từ). Ở đây vẽ MỘT lần lên canvas rồi dán lên mặt phẳng, cùng kích
// thước thế giới. Chữ vẽ trắng rồi phủ trắng cả emoji (troika cũng vẽ emoji một
// màu), màu hồng ↔ xanh nhuộm qua material.color.
function wrapRainText(text) {
    const words = text.split(/\s+/).filter(Boolean);
    const lines = [];
    for (let i = 0; i < words.length; i += RAIN.wrapWords) {
        lines.push(words.slice(i, i + RAIN.wrapWords).join(' '));
    }
    return lines;
}

function makeTextTexture(text) {
    const fontPx = 96;
    const lineH = fontPx * 1.2;
    const pad = Math.ceil(fontPx * 0.2);
    const font = `${fontPx}px 'Mali', sans-serif`;
    const lines = wrapRainText(text);

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const setup = () => {
        ctx.font = font;
        if ('letterSpacing' in ctx) ctx.letterSpacing = `${RAIN.letterSpacing * fontPx}px`;
    };
    setup();
    const textW = Math.max(...lines.map(line => ctx.measureText(line).width));
    canvas.width = Math.ceil(textW + pad * 2);
    canvas.height = Math.ceil(lines.length * lineH + pad * 2);

    // Đổi kích thước canvas là mất hết trạng thái ctx, phải đặt lại.
    setup();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    lines.forEach((line, i) => ctx.fillText(line, canvas.width / 2, pad + lineH * (i + 0.5)));
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const texture = new THREE.CanvasTexture(canvas);
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const unit = RAIN.fontSize / fontPx;
    return { texture, width: canvas.width * unit, height: canvas.height * unit };
}

// ---- DỰNG CẢNH ----
function initRainScene() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    camera = new THREE.PerspectiveCamera(RAIN.fov, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(RAIN.camX, 0, RAIN.camZ);
    camera.lookAt(0, 0, 0);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, RAIN_LITE ? 1.5 : 2));
    renderer.setClearColor(0x000000, 1);

    const container = document.getElementById('three-container');
    container.style.opacity = '0';
    container.style.transition = 'opacity 0.8s ease';
    container.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 1));
    const magenta = new THREE.PointLight(0xff00ff, 0.5, 20);
    magenta.position.set(10, 10, 0);
    scene.add(magenta);

    // Bloom như bản gốc (ngưỡng 0.1: gần như mọi thứ sáng đều toả quầng).
    if (THREE.EffectComposer && THREE.UnrealBloomPass) {
        rainComposer = new THREE.EffectComposer(renderer);
        rainComposer.addPass(new THREE.RenderPass(scene, camera));
        rainBloom = new THREE.UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            RAIN.bloom.strength, RAIN.bloom.radius, RAIN.bloom.threshold
        );
        rainComposer.addPass(rainBloom);
    }

    // Đốm sáng cuối đường hầm (cú bay sang màn 2). Gắn vào camera nên camera
    // phải nằm trong scene thì con của nó mới được vẽ.
    rainGlow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: makeGlowTexture(),
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 0
    }));
    rainGlow.renderOrder = 10;
    rainGlow.visible = false;
    camera.add(rainGlow);
    scene.add(camera);

    rainClock = new THREE.Clock();
}

function makeGlowTexture() {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255, 255, 255, 1)');
    g.addColorStop(0.18, 'rgba(255, 220, 236, 0.95)');
    g.addColorStop(0.45, 'rgba(255, 120, 180, 0.55)');
    g.addColorStop(1, 'rgba(255, 60, 140, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(canvas);
}

// Rơi kiểu bản gốc: y = top − (t·speed mod (top − floor)). Lần đầu lấy pha
// ngẫu nhiên để mở trang đã thấy mưa khắp nơi.
function resetRainFall(item) {
    item.rain.y = item.top - Math.random() * (item.top - item.floor);
}

// Màn mở đầu vừa mở quà: đưa cả cơn mưa lên trên mép màn hình để nó đổ ào
// xuống từ trên, nối tiếp những cánh hồng đang rơi — thay vì hiện ra đã đầy sẵn.
function rainPourIn() {
    rainItems.forEach(item => {
        // Mép trên khung nhìn ở đúng độ sâu của vật (vật sau camera: lấy tối thiểu).
        const viewTop = Math.max(4, viewHeightAt(item.home.z) / 2);
        item.rain.y = viewTop + 2 + Math.random() * (item.kind === 'heart' ? 40 : 55);
    });
}

function createRainTexts() {
    const textures = rainMessages.map(makeTextTexture);
    const plane = new THREE.PlaneGeometry(1, 1);
    let a = 0;
    for (let row = 0; row < RAIN.textRows; row++) {
        for (let col = 0; col < RAIN.textCols; col++, a++) {
            const m = a % rainMessages.length;
            const step = rainMessages[m].length > 20 ? 6 : 3;
            const material = new THREE.MeshBasicMaterial({
                map: textures[m].texture,
                transparent: true,
                depthWrite: false,
                side: THREE.DoubleSide
            });
            const mesh = new THREE.Mesh(plane, material);
            mesh.scale.set(textures[m].width, textures[m].height, 1);
            const item = {
                kind: 'text',
                obj: mesh,
                material,
                base: { x: textures[m].width, y: textures[m].height },
                rain: new THREE.Vector3(-40 + col * step, 0, -10 + row * step * 1.5),
                home: { x: -40 + col * step, z: -10 + row * step * 1.5 },
                top: -10 + Math.random() * 100,
                floor: RAIN.textFloor,
                speed: randBetween(RAIN.textSpeed),
                // Lệch pha màu, như `delay` của bản gốc.
                hue: Math.random() * 2,
                g: 0,
                delay: 0
            };
            resetRainFall(item);
            mesh.position.copy(item.rain);
            scene.add(mesh);
            rainItems.push(item);
        }
    }
}

// ---- ẢNH RƠI ----
// Ảnh người gửi tải lên (LoveGift `image`) rơi lẫn trong mưa chữ, dạng ảnh
// polaroid viền kem. Không có ảnh riêng thì dùng ảnh mặc định của lá thư.
// Ảnh nạp xong tấm nào thì thả tấm đó vào mưa — không bắt màn mưa chờ ảnh.
const RAIN_PHOTO = {
    count: RAIN_LITE ? 10 : 18,
    width: 5.4,             // đơn vị thế giới; cao tự theo khung polaroid
    speed: [7, 11],         // rơi chậm hơn chữ cho kịp nhìn
    tint: 0xf4f0ec,         // ảnh vẽ ngoài bloom (xem animate) nên giữ gần nguyên màu
    layer: 1
};

function rainPhotoUrls() {
    const fromConfig = (typeof lovegiftImages !== 'undefined' ? lovegiftImages : [])
        .map(safePhotoUrl).filter(Boolean);
    const urls = fromConfig.length
        ? fromConfig
        : (typeof letter !== 'undefined' ? letter.map(part => part.photo) : []).filter(Boolean);
    return [...new Set(urls)];
}

// Ảnh → canvas polaroid: cắt vừa khung vuông (object-fit: cover), viền kem,
// lề dưới dày hơn như ảnh lấy liền.
function makePolaroidTexture(img) {
    const W = 256, pad = 12, bottom = 44, inner = W - pad * 2;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = pad + inner + bottom;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fbf4ea';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    ctx.drawImage(img,
        (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side,
        pad, pad, inner, inner);
    ctx.font = "26px 'Mali', sans-serif";
    ctx.fillStyle = '#d9779f';
    ctx.textAlign = 'center';
    ctx.fillText('♥', W / 2, pad + inner + 32);
    const texture = new THREE.CanvasTexture(canvas);
    texture.anisotropy = 4;
    return { texture, aspect: canvas.height / canvas.width };
}

function createRainPhotos() {
    const urls = rainPhotoUrls();
    if (!urls.length) return;
    const plane = new THREE.PlaneGeometry(1, 1);
    let made = 0;

    urls.forEach((url, u) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            let tex;
            try { tex = makePolaroidTexture(img); } catch (e) { return; }
            // Chia đều số ảnh rơi cho các tấm; tấm đầu nhận phần dư.
            const share = Math.floor(RAIN_PHOTO.count / urls.length) + (u < RAIN_PHOTO.count % urls.length ? 1 : 0);
            for (let i = 0; i < Math.max(1, share); i++) {
                const material = new THREE.MeshBasicMaterial({
                    map: tex.texture,
                    color: RAIN_PHOTO.tint,
                    transparent: true,
                    depthWrite: false,
                    side: THREE.DoubleSide
                });
                const mesh = new THREE.Mesh(plane, material);
                const base = { x: RAIN_PHOTO.width, y: RAIN_PHOTO.width * tex.aspect };
                mesh.scale.set(base.x, base.y, 1);
                const n = made++;
                // Rải theo lưới thưa lệch nhau để ảnh không chồng lên nhau.
                const x = -36 + ((n * 37) % 80) + Math.random() * 4;
                const z = -8 + ((n * 23) % 56) + Math.random() * 3;
                const item = {
                    kind: 'photo',
                    obj: mesh,
                    material,
                    base,
                    rain: new THREE.Vector3(x, 0, z),
                    home: { x, z },
                    top: 10 + Math.random() * 80,
                    floor: RAIN.textFloor - 4,
                    speed: randBetween(RAIN_PHOTO.speed),
                    tilt: (Math.random() - 0.5) * 0.5,
                    sway: Math.random() * Math.PI * 2,
                    g: 0,
                    delay: 0
                };
                resetRainFall(item);
                mesh.position.copy(item.rain);
                mesh.rotation.z = item.tilt;
                // Lớp riêng: RenderPass của bloom không thấy ảnh, ảnh được vẽ
                // thêm một lượt sau bloom để khỏi bị cháy sáng.
                mesh.layers.set(RAIN_PHOTO.layer);
                scene.add(mesh);
                rainItems.push(item);
            }
        };
        img.onerror = () => console.warn('No se pudo cargar la imagen que cae:', url);
        img.src = url;
    });
}

// heart.obj của bản gốc: chỉ có v và f (v//vn), mặt tứ giác → tách tam giác.
function parseHeartObj(text) {
    const v = [];
    const vn = [];
    const pos = [];
    const nor = [];
    text.split('\n').forEach(line => {
        const parts = line.trim().split(/\s+/);
        if (parts[0] === 'v') v.push(parts.slice(1, 4).map(Number));
        else if (parts[0] === 'vn') vn.push(parts.slice(1, 4).map(Number));
        else if (parts[0] === 'f') {
            const idx = parts.slice(1).map(token => token.split('/'));
            for (let i = 1; i < idx.length - 1; i++) {
                [idx[0], idx[i], idx[i + 1]].forEach(([vi, , ni]) => {
                    pos.push(...v[Number(vi) - 1]);
                    if (ni && vn[Number(ni) - 1]) nor.push(...vn[Number(ni) - 1]);
                });
            }
        }
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    if (nor.length === pos.length) geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    else geometry.computeVertexNormals();
    return geometry;
}

function loadHeartGeometry() {
    return fetch(`./assets/rain/heart.obj?v=${window.APP_VERSION || ''}`)
        .then(res => (res.ok ? res.text() : Promise.reject(res.status)))
        .then(parseHeartObj)
        .catch(err => {
            console.warn('No se pudo cargar heart.obj, se usa el corazón prearmado:', err);
            return makeFallbackHeartGeometry();
        });
}

function makeFallbackHeartGeometry() {
    const s = new THREE.Shape();
    s.moveTo(0, 3.5);
    s.bezierCurveTo(0, 6, -4.5, 7.5, -7, 4.5);
    s.bezierCurveTo(-9.5, 1.2, -6, -2.5, 0, -7.5);
    s.bezierCurveTo(6, -2.5, 9.5, 1.2, 7, 4.5);
    s.bezierCurveTo(4.5, 7.5, 0, 6, 0, 3.5);
    const geometry = new THREE.ExtrudeGeometry(s, { depth: 3, bevelEnabled: true, bevelThickness: 1, bevelSize: 0.8, bevelSegments: 2 });
    geometry.center();
    geometry.rotateX(Math.PI / 2);
    return geometry;
}

function createRainHearts(geometry) {
    // #e62e00 phát sáng 1.3 của bản gốc, sau khi đổi màu tuyến tính → sRGB thì
    // ra đỏ cam ~#ff3a00. r128 không quản lý màu nên đặt thẳng màu đích.
    const material = new THREE.MeshStandardMaterial({
        color: 0x000000,
        emissive: RAIN.heartColor,
        emissiveIntensity: 1,
        roughness: 0.6
    });
    for (let row = 0; row < RAIN.heartRows; row++) {
        for (let col = 0; col < RAIN.heartCols; col++) {
            const group = new THREE.Group();
            const mesh = new THREE.Mesh(geometry, material);
            mesh.rotation.x = -Math.PI / 2;
            group.add(mesh);
            group.scale.setScalar(RAIN.heartScale);
            const item = {
                kind: 'heart',
                obj: group,
                mesh,
                base: RAIN.heartScale,
                rain: new THREE.Vector3(-40 + col * 6, 0, -8 + row * 6 * 1.5),
                home: { x: -40 + col * 6, z: -8 + row * 6 * 1.5 },
                top: randBetween(RAIN.heartTop),
                floor: RAIN.heartFloor,
                speed: randBetween(RAIN.heartSpeed),
                g: 0,
                delay: 0
            };
            resetRainFall(item);
            group.position.copy(item.rain);
            scene.add(group);
            rainItems.push(item);
        }
    }
}

// 1000 hạt trắng li ti bay lên, trôi ngang (particle-effect.js của bản gốc).
function createRainSparkles() {
    const count = RAIN.sparkles;
    const positions = new Float32Array(count * 3);
    const speeds = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        const k = i * 3;
        positions[k] = (Math.random() - 0.5) * 50;
        positions[k + 1] = (Math.random() - 0.5) * 100;
        positions[k + 2] = (Math.random() - 0.5) * 50;
        speeds[k] = (Math.random() - 0.5) * 0.1;
        speeds[k + 1] = 0.02 + Math.random() * 0.05;
        speeds[k + 2] = (Math.random() - 0.5) * 0.1;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    rainSparkles = new THREE.Points(geometry, new THREE.PointsMaterial({ size: 0.03, color: 0xffffff }));
    rainSparkles.position.z = -1;
    rainSparkles.userData.speeds = speeds;
    scene.add(rainSparkles);
}

function updateRainSparkles(dt) {
    const attr = rainSparkles.geometry.attributes.position;
    const m = attr.array;
    const h = rainSparkles.userData.speeds;
    for (let k = 0; k < m.length; k += 3) {
        m[k] += h[k] * dt * 80;
        m[k + 1] += h[k + 1] * dt * 20;
        m[k + 2] += h[k + 2] * dt * 80;
        if (m[k + 1] > 25) {
            m[k + 1] = -25;
            m[k] = (Math.random() - 0.5) * 50;
            m[k + 2] = (Math.random() - 0.5) * 50;
        }
    }
    attr.needsUpdate = true;
}

// ---- TRÁI TIM NGÂN HÀ ----
// Toạ độ trong khung riêng của tim: gốc ở tâm, nửa bề ngang = 1, +z hướng về
// camera. rainGalaxy (Points) chính là khung đó: đặt ở hold.center, quay mặt
// về camera, phóng to rainHeartSize — nhờ vậy tim không bị méo khi camera lệch.
const GALAXY_VERT = `
    attribute float size;
    attribute float alpha;
    attribute vec3 tint;
    attribute float phase;
    uniform float uScale;
    uniform float uTime;
    varying vec3 vTint;
    varying float vAlpha;
    void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float twinkle = 0.75 + 0.25 * sin(uTime * 2.6 + phase);
        vTint = tint;
        vAlpha = alpha * twinkle;
        gl_PointSize = size * uScale / -mv.z;
        gl_Position = projectionMatrix * mv;
    }`;
const GALAXY_FRAG = `
    uniform float uOpacity;
    varying vec3 vTint;
    varying float vAlpha;
    void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vTint, a * a * vAlpha * uOpacity);
    }`;

function createGalaxyHeart() {
    const n = GALAXY.count;
    const start = new Float32Array(n * 3);   // r, góc, z lúc bắt đầu (toạ độ cực)
    const slot = new Float32Array(n * 3);    // r, góc, z trên tim
    const delay = new Float32Array(n);
    const positions = new Float32Array(n * 3);
    const sizes = new Float32Array(n);
    const alphas = new Float32Array(n);
    const tints = new Float32Array(n * 3);
    const phases = new Float32Array(n);
    const palette = ['#ff8fb1', '#ff5c8a', '#ffc2d4', '#fff0f5', '#ff9ec7', '#99DDFF'].map(c => new THREE.Color(c));

    for (let i = 0; i < n; i++) {
        // 30% nằm sát viền cho tim có nét, còn lại lấp đầy (dày dần ra ngoài).
        const edge = i % 10 < 3;
        const [hx, hy] = heartPoint(Math.random() * Math.PI * 2);
        const k = edge ? 0.97 + Math.random() * 0.06 : Math.pow(Math.random(), 0.45);
        const x = hx * k + (Math.random() - 0.5) * 0.03;
        const y = hy * k + (Math.random() - 0.5) * 0.03;
        const z = (Math.random() - 0.5) * 2 * GALAXY.depth * Math.sqrt(Math.max(0, 1 - k * k));
        slot[i * 3] = Math.hypot(x, y);
        slot[i * 3 + 1] = Math.atan2(y, x);
        slot[i * 3 + 2] = z;

        start[i * 3] = 2.2 + Math.random() * 2.2;
        start[i * 3 + 1] = Math.random() * Math.PI * 2;
        start[i * 3 + 2] = (Math.random() - 0.5) * 3;
        // Ở xa bay vào sau, viền thành hình cuối cùng.
        delay[i] = Math.random() * 0.35 + (edge ? 0.12 : 0);

        sizes[i] = edge ? 0.32 + Math.random() * 0.3 : 0.18 + Math.random() * 0.4;
        const c = edge && Math.random() < 0.5 ? palette[3] : palette[Math.floor(Math.random() * palette.length)];
        tints.set([c.r, c.g, c.b], i * 3);
        phases[i] = Math.random() * Math.PI * 2;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1));
    geometry.setAttribute('tint', new THREE.BufferAttribute(tints, 3));
    geometry.setAttribute('phase', new THREE.BufferAttribute(phases, 1));
    const material = new THREE.ShaderMaterial({
        vertexShader: GALAXY_VERT,
        fragmentShader: GALAXY_FRAG,
        uniforms: {
            uScale: { value: 1 },
            uTime: { value: 0 },
            uOpacity: { value: 1 }
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });
    rainGalaxy = new THREE.Points(geometry, material);
    rainGalaxy.frustumCulled = false;
    rainGalaxy.visible = false;
    rainGalaxy.userData = { start, slot, delay, spin: 0 };
    scene.add(rainGalaxy);
    updateGalaxyScale();
}

// Cỡ hạt tính theo pixel như PointsMaterial (chiều cao khung vẽ / 2).
function updateGalaxyScale() {
    if (!rainGalaxy) return;
    rainGalaxy.material.uniforms.uScale.value = renderer.getDrawingBufferSize(new THREE.Vector2()).y / 2;
}

// Chọn vai cho cú gom này: tim đỏ và chữ ở gần ngón tay nhất được gọi vào,
// còn lại vẫn rơi. Chỉ chọn lại khi cú gom trước đã tan hết.
function assignGatherRoles() {
    const byDistance = kind => rainItems
        .filter(item => item.kind === kind)
        .map(item => {
            const pos = item.obj.position;
            // Vật sau lưng camera hoặc quá gần ống kính thì không gọi.
            const behind = pos.z > camera.position.z - 6;
            const d = Math.hypot(pos.x - hold.center.x, pos.y - hold.center.y) + (behind ? 1e4 : 0);
            return { item, d };
        })
        .sort((a, b) => a.d - b.d);

    rainItems.forEach(item => { item.role = null; });
    byDistance('heart').slice(0, GALAXY.edgeHearts).forEach(({ item }, i) => {
        const [x, y] = heartPoint((i / GALAXY.edgeHearts) * Math.PI * 2);
        item.role = 'edge';
        item.slot = { x: x * 1.05, y: y * 1.05, z: 0.05 };
    });
    byDistance('text').slice(0, GALAXY.ringTexts).forEach(({ item }, i) => {
        item.role = 'ring';
        item.slot = { angle: (i / GALAXY.ringTexts) * Math.PI * 2 };
    });
    const reach = viewWidthAt(0) * 0.9;
    rainItems.forEach(item => {
        const pos = item.obj.position;
        const d = Math.hypot(pos.x - hold.center.x, pos.y - hold.center.y);
        item.delay = Math.min(0.4, (d / reach) * 0.4) + Math.random() * 0.08;
        item.phase = Math.random() * Math.PI * 2;
    });
}

const _local = new THREE.Vector3();

// Đặt khung tim ở tâm lốc, SONG SONG với màn hình (cùng hướng camera) — mặt
// phẳng song song màn hình thì phép chiếu không làm méo, kể cả ở mép với góc
// nhìn 100°. Quay mặt về vị trí camera thì tim lệch tâm bị kéo giãn.
function placeGalaxyFrame(scale, spinY) {
    rainGalaxy.position.copy(hold.center);
    rainGalaxy.quaternion.copy(camera.quaternion);
    rainGalaxy.rotateY(spinY);
    rainGalaxy.scale.setScalar(scale);
    rainGalaxy.updateMatrixWorld();
}

function updateGalaxyParticles(p, beat) {
    const { start, slot, delay } = rainGalaxy.userData;
    const geo = rainGalaxy.geometry;
    const pos = geo.attributes.position.array;
    const alpha = geo.attributes.alpha.array;
    let any = false;
    for (let i = 0; i < alpha.length; i++) {
        const g = THREE.MathUtils.clamp((p - delay[i]) / 0.55, 0, 1);
        const e = easeInOut(g);
        const k = i * 3;
        // Bay theo đường xoắn ốc: nội suy bán kính và góc, góc cộng thêm vài vòng.
        const r = (start[k] + (slot[k] - start[k]) * e) * beat;
        const a = start[k + 1] + (slot[k + 1] + GALAXY.turns * Math.PI * 2 - start[k + 1]) * e;
        pos[k] = Math.cos(a) * r;
        pos[k + 1] = Math.sin(a) * r;
        pos[k + 2] = start[k + 2] + (slot[k + 2] - start[k + 2]) * e;
        alpha[i] = Math.min(1, g * 2.2);
        if (g > 0) any = true;
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.alpha.needsUpdate = true;
    rainGalaxy.visible = any;
}

// Bề ngang nửa trái tim (đơn vị thế giới ở z = 0): chiếm ~70% cạnh ngắn màn hình.
function updateHeartSize() {
    rainHeartSize = Math.min(viewWidthAt(0), viewHeightAt(0)) * 0.3;
    updateGalaxyScale();
}

// ---- GIỮ TAY ĐỂ GOM ----
let holdUi = null;

function buildHoldUi() {
    const hint = document.createElement('div');
    hint.className = 'hold-hint';
    hint.id = 'hold-hint';
    hint.innerHTML = `
        <span class="hold-hint-touch" aria-hidden="true">
            <i></i><i></i>
            <svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
        </span>
        <span class="hold-hint-text">toca &amp; mantén para reunir el amor</span>`;
    document.body.appendChild(hint);

    const ring = document.createElement('div');
    ring.className = 'hold-ring';
    ring.setAttribute('aria-hidden', 'true');
    ring.innerHTML = `
        <svg viewBox="0 0 120 120">
            <circle class="hold-ring-track" cx="60" cy="60" r="52"/>
            <circle class="hold-ring-fill" cx="60" cy="60" r="52" pathLength="100"/>
        </svg>
        <span class="hold-ring-label">Mantén presionado…</span>`;
    document.body.appendChild(ring);

    holdUi = {
        hint,
        ring,
        fill: ring.querySelector('.hold-ring-fill'),
        label: ring.querySelector('.hold-ring-label')
    };
}

function setHintVisible(visible) {
    holdUi?.hint.classList.toggle('is-visible', visible);
}

function canStartHold(event) {
    if (rainExit || isPopupOpen || hold.active) return false;
    if (document.body.classList.contains('intro-open')) return false;
    if (typeof orbitOpen !== 'undefined' && orbitOpen) return false;
    // Vừa bấm nút đóng một overlay: cú chạm đó không phải cú giữ tay.
    if (Date.now() - lastClickTime < 350) return false;
    if (event.button != null && event.button > 0) return false;
    const target = event.target;
    return !(target && target.closest && target.closest('button, a, input, .music-toggle-button'));
}

function onHoldStart(event) {
    if (!canStartHold(event)) return;
    hold.active = true;
    hold.pointerId = event.pointerId;
    // Chạm lại khi lốc cũ chưa tan hết: đi tiếp từ mức đang có thay vì về 0,
    // không thì cả cơn lốc giật nở ra rồi mới siết lại.
    hold.start = performance.now() - hold.progress * HOLD_MS;
    hold.formed = false;
    hold.screen.x = event.clientX;
    hold.screen.y = event.clientY;
    heartCenterAt(event.clientX, event.clientY, hold.centerGoal);
    // Cú gom trước đã tan hết thì chọn lại vật được gọi theo chỗ ngón tay mới.
    if (!rainItems.some(item => item.g > 0) && hold.progress === 0) {
        hold.center.copy(hold.centerGoal);
        assignGatherRoles();
    }

    setHintVisible(false);
    holdUi.ring.classList.remove('is-formed');
    holdUi.label.textContent = 'Mantén presionado…';
    holdUi.ring.classList.add('is-active');
    moveHoldRing();
}

function onHoldMove(event) {
    if (!hold.active || event.pointerId !== hold.pointerId) return;
    hold.screen.x = event.clientX;
    hold.screen.y = event.clientY;
    heartCenterAt(event.clientX, event.clientY, hold.centerGoal);
    moveHoldRing();
}

function onHoldEnd(event) {
    if (!hold.active || event.pointerId !== hold.pointerId) return;
    hold.active = false;
    holdUi.ring.classList.remove('is-active', 'is-formed');

    if (hold.formed) {
        startRainExit();
        return;
    }
    // Thả sớm: lốc nới ra dần (updateHold) và mưa bay về chỗ cũ (g giảm về 0
    // trong updateRain), gợi ý hiện lại.
    setTimeout(() => {
        if (!hold.active && !rainExit && !isPopupOpen) setHintVisible(true);
    }, 900);
}

// Tâm trái tim: lệch về phía ngón tay một nửa, để tim to vẫn nằm gọn trong
// màn hình.
// Vòng đếm ngược vẫn bám đúng ngón tay.
const HEART_FOLLOW = 0.5;

function heartCenterAt(x, y, out) {
    const nx = ((x / window.innerWidth) * 2 - 1) * HEART_FOLLOW;
    const ny = ((y / window.innerHeight) * 2 - 1) * HEART_FOLLOW;
    screenToWorld(((nx + 1) / 2) * window.innerWidth, ((ny + 1) / 2) * window.innerHeight, out);
    return clampHeartCenter(out);
}

const _edgeX = new THREE.Vector3();
const _edgeY = new THREE.Vector3();
const _probe = new THREE.Vector3();

function clampHeartCenter(v) {
    // Góc nhìn 100° kéo giãn mạnh ở mép màn hình, nên đo thẳng: chiếu 4 điểm
    // mép tim lên màn hình rồi đẩy tâm vào cho đủ chỗ.
    const limit = 0.9;
    _edgeX.setFromMatrixColumn(camera.matrixWorld, 0);
    _edgeY.setFromMatrixColumn(camera.matrixWorld, 1);
    for (let pass = 0; pass < 4; pass++) {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        [[1.12, 0], [-1.12, 0], [0, 1.05], [0, -1.1]].forEach(([ax, ay]) => {
            _probe.copy(v)
                .addScaledVector(_edgeX, ax * rainHeartSize)
                .addScaledVector(_edgeY, ay * rainHeartSize)
                .project(camera);
            minX = Math.min(minX, _probe.x);
            maxX = Math.max(maxX, _probe.x);
            minY = Math.min(minY, _probe.y);
            maxY = Math.max(maxY, _probe.y);
        });
        let dx = 0, dy = 0;
        if (maxX - minX > 2 * limit) dx = -(minX + maxX) / 2;
        else if (minX < -limit) dx = -limit - minX;
        else if (maxX > limit) dx = limit - maxX;
        if (maxY - minY > 2 * limit) dy = -(minY + maxY) / 2;
        else if (minY < -limit) dy = -limit - minY;
        else if (maxY > limit) dy = limit - maxY;
        if (Math.abs(dx) < 0.002 && Math.abs(dy) < 0.002) break;
        const c = _probe.copy(v).project(camera);
        screenToWorld(((c.x + dx + 1) / 2) * window.innerWidth, ((1 - (c.y + dy)) / 2) * window.innerHeight, v);
    }
    return v;
}

function moveHoldRing() {
    holdUi.ring.style.transform = `translate(${hold.screen.x}px, ${hold.screen.y}px)`;
    // Ngón tay sát mép: kéo nhãn vào trong cho khỏi tràn ra ngoài màn hình.
    const half = holdUi.label.offsetWidth / 2 + 12;
    const shift = Math.max(0, half - hold.screen.x) - Math.max(0, hold.screen.x + half - window.innerWidth);
    holdUi.ring.style.setProperty('--label-shift', `${shift}px`);
}

function updateHold(now, dt) {
    if (!hold.active) {
        if (!rainExit) hold.progress = Math.max(0, hold.progress - dt / 0.8);
        return;
    }
    hold.progress = Math.min(1, (now - hold.start) / HOLD_MS);
    holdUi.fill.style.strokeDashoffset = String(100 * (1 - hold.progress));
    if (hold.progress >= 1 && !hold.formed) {
        hold.formed = true;
        holdUi.ring.classList.add('is-formed');
        holdUi.label.textContent = '¡Ya puedes soltar! ♥';
        moveHoldRing();
        if (navigator.vibrate) navigator.vibrate(35);
    }
}

// ---- VÒNG LẶP ----
function easeInOut(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

const _target = new THREE.Vector3();
const _tint = new THREE.Color();

function rainTextColor(item) {
    // Màu hồng ↔ xanh theo sin(t / 2.5) như bản gốc. Tính trong không gian
    // tuyến tính, nhân độ sáng phát quang rồi mới đổi về sRGB.
    const t = (Math.sin((rainTime + item.hue) / RAIN.colorPeriod) + 1) / 2;
    _tint.lerpColors(RAIN.pink, RAIN.blue, t).multiplyScalar(RAIN.textGlow);
    _tint.setRGB(Math.min(1, _tint.r), Math.min(1, _tint.g), Math.min(1, _tint.b)).convertLinearToSRGB();
    item.material.color.copy(_tint);
}

function updateRain(dt, now) {
    if (rainExit) {
        updateRainFlight(dt, now, rainExit);
        return;
    }
    updateHold(now, dt);
    // Tâm lốc đuổi theo ngón tay.
    hold.center.lerp(hold.centerGoal, 1 - Math.exp(-dt * 10));

    const p = hold.progress;
    const ease = easeInOut(p);
    // Đã thành hình: tim đập nhẹ theo nhịp.
    const beat = hold.formed ? 1 + 0.045 * Math.pow(Math.sin(rainTime * 5.2), 8) : 1;
    const gathering = hold.active || p > 0;
    // Mưa chậm dần và mờ bớt để tim ngân hà nổi lên.
    const slow = 1 - 0.8 * ease;
    const dim = 1 - 0.75 * ease;
    // Vật đang rơi chắn giữa tim và camera thì gần như tắt hẳn.
    const hide = 1 - 0.95 * ease;
    const frontZ = hold.center.z + 3;
    // Điện thoại dọc hẹp: co vầng chữ cho khỏi tràn ra ngoài màn hình.
    const haloX = Math.min(GALAXY.haloX, (0.4 * viewWidthAt(0)) / rainHeartSize);

    if (rainGalaxy) {
        if (gathering) {
            // Xoay nhẹ quanh trục đứng lúc đang thành hình, rồi chỉ lắc rất khẽ.
            // Tim rất to và gần camera: lắc quá ~5° là nửa bên gần bị phóng to, méo.
            const spinY = (1 - ease) * 1.2 + Math.sin(rainTime * 0.7) * 0.08;
            placeGalaxyFrame(rainHeartSize, spinY);
            updateGalaxyParticles(p * 1.35, beat);
        } else if (rainGalaxy.visible) {
            updateGalaxyParticles(0, 1);
        }
        rainGalaxy.material.uniforms.uTime.value = rainTime;
    }

    rainItems.forEach(item => {
        const called = gathering && item.role;
        // Mưa chỉ dừng lại theo mức bị hút, để lúc thả tay vật thể bay về
        // đúng chỗ của nó trong cơn mưa thay vì nhảy cóc.
        item.rain.y -= item.speed * dt * (1 - item.g) * slow;
        if (item.rain.y < item.floor) item.rain.y += item.top - item.floor;

        const goal = called ? THREE.MathUtils.clamp((p * 1.6 - item.delay) / 0.8, 0, 1) : 0;
        item.g += (goal - item.g) * (1 - Math.exp(-dt * (gathering ? 3.2 : 2.2)));
        if (item.g < 0.0005) item.g = 0;

        const pos = item.obj.position;
        const inFront = !item.role && item.rain.z > frontZ;
        if (item.g === 0 || !item.role || !rainGalaxy) {
            pos.copy(item.rain);
        } else {
            if (item.role === 'edge') {
                _local.set(item.slot.x * beat, item.slot.y * beat, item.slot.z);
            } else {
                // Vầng chữ quay chậm quanh tim.
                const a = item.slot.angle + rainTime * 0.12;
                _local.set(Math.cos(a) * haloX, Math.sin(a) * GALAXY.haloY - 0.08, 0);
            }
            _target.copy(_local).applyMatrix4(rainGalaxy.matrixWorld);
            pos.lerpVectors(item.rain, _target, easeInOut(item.g));
        }

        if (item.kind === 'heart') {
            // Bản gốc: rotation.z += 0.01 mỗi khung hình.
            item.mesh.rotation.z += 0.6 * dt;
            const shrink = inFront ? hide : 1;
            item.obj.scale.setScalar(Math.max(0.0001, item.base * (1 - 0.55 * item.g) * shrink));
        } else {
            // Chữ trên vầng giữ nguyên cỡ để đọc được.
            item.obj.scale.set(item.base.x, item.base.y, 1);
            if (item.kind === 'text') rainTextColor(item);
            else item.obj.rotation.z = item.tilt + Math.sin(rainTime * 0.9 + item.sway) * 0.12;
            item.material.opacity = item.role ? dim + (1 - dim) * item.g : (inFront ? hide : dim);
        }
    });

    if (rainSparkles) updateRainSparkles(dt);
}

// ---- BAY XUYÊN MƯA ----
const _look = new THREE.Vector3();
const _ahead = new THREE.Vector3();

// Đặt một vật ra phía trước camera, quanh trục bay, chừa trống ở giữa để
// không có chữ nào đập thẳng vào mặt.
function placeInTunnel(vec, near, far, rMin, rMax) {
    const angle = Math.random() * Math.PI * 2;
    const r = rMin + Math.random() * (rMax - rMin);
    vec.set(
        camera.position.x + Math.cos(angle) * r * 1.3,
        camera.position.y + Math.sin(angle) * r,
        camera.position.z - near - Math.random() * (far - near)
    );
}

function updateRainFlight(dt, now, exit) {
    const E = RAIN_EXIT;
    const t = now - exit.start;
    const p = Math.min(1, t / E.duration);
    const steer = easeInOut(Math.min(1, t / E.steer));

    // Camera: lái vào tâm tim, lao tới nhanh dần, FOV giãn ra.
    camera.position.set(
        exit.camFrom.x + (exit.aim.x - exit.camFrom.x) * steer,
        exit.camFrom.y + (exit.aim.y - exit.camFrom.y) * steer,
        exit.camFrom.z - E.distance * p * p
    );
    camera.fov = RAIN.fov + E.fovKick * THREE.MathUtils.smoothstep(p, 0.15, 0.75);
    camera.updateProjectionMatrix();
    _ahead.set(camera.position.x, camera.position.y, camera.position.z - 10);
    _look.lerpVectors(exit.lookFrom, _ahead, steer);
    camera.lookAt(_look);
    camera.updateMatrixWorld();

    // Nhịp đập trước khi bay: tim chữ phồng ra rồi về.
    const beat = t < E.pulse ? Math.sin((t / E.pulse) * Math.PI) * 0.12 : 0;
    const fadeOut = 1 - THREE.MathUtils.smoothstep(t, E.handoff - 250, E.handoff + 150);

    const wake = THREE.MathUtils.smoothstep(t, 0, 700);
    rainItems.forEach(item => {
        const pos = item.obj.position;
        const back = item.exitFrom + (1 - item.exitFrom) * wake;
        item.rain.y -= item.speed * dt * 0.3;
        if (t > E.tunnelFrom && item.rain.z > camera.position.z + 1) {
            placeInTunnel(item.rain, 15, 75, 7, 32);
        }
        if (beat) {
            pos.set(
                item.rain.x + (item.rain.x - exit.aim.x) * beat,
                item.rain.y + (item.rain.y - exit.aim.y) * beat,
                item.rain.z
            );
        } else {
            pos.copy(item.rain);
        }
        if (item.kind === 'heart') {
            item.mesh.rotation.z += 0.6 * dt;
            item.obj.scale.setScalar(Math.max(0.0001, item.base * fadeOut * back));
        } else {
            if (item.kind === 'text') rainTextColor(item);
            item.material.opacity = fadeOut * back;
        }
    });

    if (rainGalaxy && rainGalaxy.visible) {
        rainGalaxy.material.uniforms.uOpacity.value = fadeOut;
        rainGalaxy.material.uniforms.uTime.value = rainTime;
    }

    // Hạt sáng cũng đi theo đường hầm.
    if (rainSparkles) {
        const attr = rainSparkles.geometry.attributes.position;
        const m = attr.array;
        const z0 = rainSparkles.position.z;
        for (let k = 0; k < m.length; k += 3) {
            if (m[k + 2] + z0 > camera.position.z + 1) {
                placeInTunnel(_target, 5, 90, 1, 30);
                m[k] = _target.x;
                m[k + 1] = _target.y;
                m[k + 2] = _target.z - z0;
            }
        }
        attr.needsUpdate = true;
    }

    // Đốm sáng cuối đường hầm: nằm đúng điểm màn hình của tim màn 2.
    const glowP = THREE.MathUtils.smoothstep(t, E.glowStart, E.glowFull);
    rainGlow.visible = glowP > 0;
    if (rainGlow.visible) {
        const d = 8;
        const halfH = d * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
        rainGlow.position.set(exit.ndc.x * halfH * camera.aspect, exit.ndc.y * halfH, -d);
        rainGlow.scale.setScalar(halfH * 2 * (0.03 + 2.4 * glowP * glowP));
        rainGlow.material.opacity = Math.min(1, glowP * 1.6);
    }
    if (rainBloom) rainBloom.strength = RAIN.bloom.strength + (E.bloomPeak - RAIN.bloom.strength) * glowP;
}

function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(0.05, rainClock.getDelta());
    // Orbit đã che kín màn hình: khỏi tính, khỏi vẽ.
    if (!isPlaying && !rainExit) return;
    rainTime += dt;
    updateRain(dt, performance.now());
    if (rainComposer) rainComposer.render();
    else renderer.render(scene, camera);
    renderRainPhotos();
}

// Lượt vẽ thứ hai chỉ cho ảnh rơi, chồng lên khung hình đã có bloom. Tắt nền
// và autoClear để không xoá mất lượt trước.
function renderRainPhotos() {
    if (!rainItems.some(item => item.kind === 'photo')) return;
    const background = scene.background;
    scene.background = null;
    renderer.autoClear = false;
    renderer.clearDepth();
    camera.layers.set(RAIN_PHOTO.layer);
    renderer.render(scene, camera);
    camera.layers.set(0);
    renderer.autoClear = true;
    scene.background = background;
}

// ---- CHUYỂN CẢNH SANG MÀN 2: BAY XUYÊN MƯA ----
// 0      trái tim ngân hà đứng yên tại chỗ, đập một nhịp
// 0–1300 camera chậm rãi lái vào tâm tim, xuyên qua tim ở ~1,4 s, vào hầm lời yêu
// 1700   đốm sáng hiện ở đúng chỗ tim màn 2, to dần, bloom mạnh dần
// 2700   trời ngân hà màn 2 hiện ra (openMemoryOrbit 'arrive'), lớp tối phủ dần
// 3200   trao tay: tim màn 2 nở, ảnh bay ra quỹ đạo
// Chạm màn hình giữa chừng → tua thẳng tới cuối.
function startRainExit() {
    if (rainExit) return;
    if (typeof buildOrbitScene === 'function') buildOrbitScene();

    const flash = spawnConstellationFlash(hold.screen.x, hold.screen.y);
    setTimeout(() => flash.remove(), 1000);

    if (prefersReducedMotion()) {
        openMemoryOrbit();
        resetRainGather();
        return;
    }

    // Đích của đốm sáng là tâm trái tim màn 2: overlay còn ẩn nhưng đã có layout.
    const heart = document.getElementById('orbit-heart')?.getBoundingClientRect();
    const sx = heart && heart.width ? heart.left + heart.width / 2 : window.innerWidth / 2;
    const sy = heart && heart.width ? heart.top + heart.height / 2 : window.innerHeight / 2;

    // Tim chữ đứng yên đúng chỗ đang hiện để camera bay xuyên qua nó.
    rainItems.forEach(item => {
        item.rain.copy(item.obj.position);
        item.g = 0;
        // Mức mờ/co lúc thả tay — cú bay đưa dần về bình thường, không bật sáng.
        item.exitFrom = item.kind === 'heart' ? item.obj.scale.x / item.base : item.material.opacity;
    });

    const exit = {
        start: performance.now(),
        camFrom: camera.position.clone(),
        lookFrom: new THREE.Vector3(0, 0, 0),
        aim: hold.center.clone(),
        ndc: { x: (sx / window.innerWidth) * 2 - 1, y: -(sy / window.innerHeight) * 2 + 1 },
        timers: [],
        anims: []
    };
    rainExit = exit;
    setHintVisible(false);

    const at = (ms, fn) => exit.timers.push(setTimeout(() => {
        if (rainExit === exit) fn();
    }, ms));
    const veil = document.getElementById('sky-veil');
    if (veil) {
        exit.anims.push(veil.animate([{ opacity: 0 }, { opacity: 1 }], {
            duration: RAIN_EXIT.veilDur,
            delay: RAIN_EXIT.veilStart,
            easing: 'ease-in',
            fill: 'forwards'
        }));
    }
    at(RAIN_EXIT.orbitOpen, () => openMemoryOrbit({ mode: 'arrive' }));
    at(RAIN_EXIT.handoff, () => beginOrbitArrival());
    at(RAIN_EXIT.handoff + ARRIVAL.done + 20, finishRainExit);
    // Đăng ký sau một nhịp để cú thả tay vừa rồi không tự tua luôn.
    at(250, () => document.addEventListener('pointerdown', skipRainExit, true));
}

function skipRainExit() {
    if (!rainExit) return;
    if (typeof orbitOpen !== 'undefined' && !orbitOpen) openMemoryOrbit({ mode: 'arrive' });
    if (typeof finishOrbitArrival === 'function') finishOrbitArrival();
    finishRainExit();
}

function finishRainExit() {
    const exit = rainExit;
    if (!exit) return;
    exit.timers.forEach(clearTimeout);
    document.removeEventListener('pointerdown', skipRainExit, true);
    rainExit = null;
    // Màn 2 che kín rồi: dừng màn 1 cho nhẹ máy. Mưa được trả về trạng thái
    // rơi tự do, để lúc đóng orbit người xem quay lại một cơn mưa mới.
    isPlaying = false;
    resetRainGather();
    // Giữ lớp tối tới khi đóng orbit (restoreRainSky) — gỡ bây giờ thì màn 1
    // lóe lên sau lớp trong suốt của orbit lúc nó đang fade.
    exit.anims.forEach(anim => anim.finish());
    rainExitAnims = exit.anims;
}

let rainExitAnims = [];

function resetRainGather() {
    hold.active = false;
    hold.progress = 0;
    hold.formed = false;
    rainItems.forEach(item => {
        item.g = 0;
        item.rain.x = item.home.x;
        item.rain.z = item.home.z;
        resetRainFall(item);
        item.obj.position.copy(item.rain);
        if (item.material) item.material.opacity = 1;
        if (item.kind === 'heart') item.obj.scale.setScalar(item.base);
        else item.obj.scale.set(item.base.x, item.base.y, 1);
    });
    // Hạt sáng về lại khối ban đầu quanh gốc toạ độ.
    if (rainSparkles) {
        const m = rainSparkles.geometry.attributes.position.array;
        for (let k = 0; k < m.length; k += 3) {
            m[k] = (Math.random() - 0.5) * 50;
            m[k + 1] = (Math.random() - 0.5) * 100;
            m[k + 2] = (Math.random() - 0.5) * 50;
        }
        rainSparkles.geometry.attributes.position.needsUpdate = true;
    }
    camera.position.set(RAIN.camX, 0, RAIN.camZ);
    camera.fov = RAIN.fov;
    camera.updateProjectionMatrix();
    camera.lookAt(0, 0, 0);
    if (rainGlow) {
        rainGlow.visible = false;
        rainGlow.material.opacity = 0;
    }
    if (rainBloom) rainBloom.strength = RAIN.bloom.strength;
    if (rainGalaxy) {
        rainGalaxy.geometry.attributes.alpha.array.fill(0);
        rainGalaxy.geometry.attributes.alpha.needsUpdate = true;
        rainGalaxy.material.uniforms.uOpacity.value = 1;
        rainGalaxy.visible = false;
    }
    rainItems.forEach(item => { item.role = null; });
}

// orbit.js gọi khi đóng màn 2 (nút ×): trả lại bầu trời mưa.
function restoreRainSky() {
    if (rainExit) {
        rainExit.timers.forEach(clearTimeout);
        document.removeEventListener('pointerdown', skipRainExit, true);
        rainExit = null;
        resetRainGather();
    }
    rainExitAnims.forEach(anim => anim.cancel());
    rainExitAnims = [];
    setHintVisible(true);
}

// ---- KHUNG HÌNH ----
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (rainComposer) rainComposer.setSize(window.innerWidth, window.innerHeight);
    updateHeartSize();
}

// ---- KHỞI ĐỘNG ----
// Font Mali phải có sẵn trước khi vẽ texture chữ, không thì canvas vẽ bằng
// font dự phòng và giữ nguyên như vậy mãi.
function waitForFont() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    const timeout = new Promise(resolve => setTimeout(resolve, 2500));
    return Promise.race([document.fonts.load("96px 'Mali'").catch(() => {}), timeout]);
}

function bootRain() {
    initRainScene();
    createRainSparkles();
    buildHoldUi();
    updateHeartSize();

    Promise.all([waitForFont(), loadHeartGeometry()]).then(([, heartGeometry]) => {
        createRainTexts();
        createRainHearts(heartGeometry);
        createRainPhotos();
        createGalaxyHeart();
        isPlaying = true;
        animate();
        hideLoading();
        window.rainReady = true;
        document.dispatchEvent(new Event('rain:ready'));
        // Còn màn mở đầu (intro.js) thì để nó tự bật gợi ý khi mưa đã đổ xuống.
        setTimeout(() => {
            if (!document.body.classList.contains('intro-open')) setHintVisible(true);
        }, 900);
    });

    window.addEventListener('resize', onWindowResize);
    window.addEventListener('pointerdown', onHoldStart);
    window.addEventListener('pointermove', onHoldMove);
    window.addEventListener('pointerup', onHoldEnd);
    window.addEventListener('pointercancel', onHoldEnd);
    // Giữ tay lâu trên Android bật menu ngữ cảnh, trên desktop là chuột phải.
    window.addEventListener('contextmenu', event => {
        if (!isPopupOpen) event.preventDefault();
    });

    createMusicToggleButton();
    primeAutoplayOnFirstTouch();

    // Nạp trước ảnh của màn 2 khi màn 1 đã chạy ổn định, để lúc thả tay ảnh
    // bay ra quỹ đạo không bị ô trống.
    setTimeout(() => {
        orbitMemories.forEach(part => {
            if (!part.photo) return;
            const img = new Image();
            img.src = part.photo;
            preloadedPopupImages.push(img);
        });
    }, 2500);

    console.log(`Lloviendo ${rainMessages.length} frases de amor, ${orbitMemories.length} recuerdos, para: ${recipientName}`);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootRain, { once: true });
} else {
    bootRain();
}

document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        isPlaying = false;
        return;
    }
    // Màn 2 đang che kín: giữ màn 1 tắt.
    isPlaying = typeof orbitOpen === 'undefined' || !orbitOpen;
    // Bỏ khoảng thời gian tab bị ẩn, không thì frame đầu tiên nhảy cóc.
    rainClock?.getDelta();
});
