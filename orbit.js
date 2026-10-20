// ---- TRÁI TIM NGÂN HÀ (Memory Orbit) ----
//
// Màn kết: một trái tim phát sáng ở giữa, các tấm ảnh của từng lời nhắn bay
// quanh nó trên một quỹ đạo ellipse. Chạm một tấm ảnh là đọc lại lời nhắn của
// nó; chạm trái tim là mở lá thư hoàn chỉnh.
//
// Port từ dự án `traitimnganha` (Next.js + React) sang vanilla. Bản gốc ghi rõ
// trong README của nó: "Everything is DOM and CSS — no canvas, no WebGL, no
// animation library", nên phần phải chuyển chỉ là cú pháp React, còn toán quỹ
// đạo và các hằng số nhịp điệu giữ nguyên.
//
// File tách riêng khỏi script.js (đã hơn 1600 dòng) nhưng vẫn là script thường
// dùng chung global scope, đúng kiểu đang có của dự án — không module, không
// build step.

// ---- HẰNG SỐ NHỊP ĐIỆU (giữ nguyên số của bản gốc) ----
const ORBIT_PERIOD_S = 52;        // một vòng quỹ đạo
const ORBIT_PERIOD_REDUCED_S = 96; // khi bật giảm chuyển động
const ORBIT_SURGE_EVERY_S = 11;   // chu kỳ tăng tốc
const ORBIT_SURGE_DUR_S = 0.75;   // thời gian mỗi cú tăng tốc
const ORBIT_SURGE_FACTOR = 4;     // tăng tốc gấp mấy lần
const ORBIT_SPINUP_S = 2.2;       // quay nhanh lúc mở rồi lắng dần
const ORBIT_CARD_CLOSE_MS = 400;  // khớp với thời lượng animation thoát của card

let orbitBuilt = false;
let orbitOpen = false;
let orbitFrame = 0;
let orbitRotation = 0;
let orbitElapsed = 0;
let orbitClock = 0;
let orbitPrevTime = null;
let orbitTokens = [];
let orbitLines = [];
let orbitStageSize = { w: 0, h: 0 };
let orbitResizeObserver = null;
let orbitCardIndex = -1;
let orbitTier = null;

const HEART_TAP_TARGET = 3;
const HEART_BURST_MS = 2700;
let heartCharge = 0;
let isHeartBursting = false;
let isFinalLetterUnlocked = false;
let lastHeartTapTime = -Infinity;
let heartBurstTimer = null;
let heartBeatAnimation = null;
// Nhịp chạm làm quỹ đạo chậm lại rồi đi tiếp. PHẢI là đường cong mềm: bản
// trước nhân tốc độ với 0.3 trong đúng một khung hình rồi bật lại 1 sau 420ms
// — cả 7 tấm ảnh khựng rồi vọt, chính là cảm giác "giật giật" khi chạm tim.
let heartSlowStart = -Infinity;
const HEART_SLOW_MS = 800;
// Nhịp thứ 3: phanh quỹ đạo về 0 rồi mới dừng vòng rAF, thay vì đứng khựng.
let orbitBrake = null;
let heartAmbientTimer = null;
let heartAmbientRunId = 0;

const HEART_AMBIENT = [
    { interval: 1650, regular: 4, lite: 2 },
    { interval: 1450, regular: 6, lite: 3 },
    { interval: 1250, regular: 8, lite: 4 }
];

function updateHeartCharge() {
    const progress = document.getElementById('heart-progress-wrap');
    if (!progress) return;
    progress.setAttribute('aria-valuenow', String(heartCharge));
    document.getElementById('heart-progress-fill').style.transform = `scaleX(${heartCharge / HEART_TAP_TARGET})`;
    document.getElementById('heart-progress-label').textContent = isFinalLetterUnlocked
        ? 'Carta del 20/10 abierta' : `${heartCharge}/${HEART_TAP_TARGET} latidos`;
    const hint = document.getElementById('heart-progress-hint');
    if (hint) {
        const hints = ['Toca el corazón para recibir la carta del 20/10', 'Solo faltan dos latidos', 'Un último latido…'];
        hint.textContent = isFinalLetterUnlocked ? 'Toca para releer la carta del 20/10'
            : hints[Math.min(heartCharge, hints.length - 1)];
    }
    document.getElementById('orbit-heart').setAttribute('aria-label', isFinalLetterUnlocked
        ? 'Volver a abrir la carta del 20/10' : `Abrir la carta del 20/10: ${heartCharge} de ${HEART_TAP_TARGET} latidos`);
    const stage = document.getElementById('orbit-stage');
    const level = isFinalLetterUnlocked ? 0 : Math.min(heartCharge, HEART_AMBIENT.length - 1);
    // Nhịp đập nhanh dần theo số lần chạm bằng playbackRate — KHÔNG đổi
    // animation-duration: đổi thời lượng của một animation đang chạy làm trình
    // duyệt tính lại tiến độ theo thời lượng mới và trái tim nhảy sang pha
    // khác. updatePlaybackRate() giữ nguyên vị trí hiện tại.
    const pulse = document.querySelector('.ol-heart')?.getAnimations?.()
        .find(anim => anim.animationName === 'ol-heart-pulse');
    pulse?.updatePlaybackRate(HEART_AMBIENT[0].interval / HEART_AMBIENT[level].interval);
}

function heartAmbientAllowed() {
    return orbitOpen
        && !orbitArrival
        && !document.hidden
        && !orbitReduced()
        && !isHeartBursting
        && orbitCardIndex < 0
        && !document.getElementById('full-letter')?.classList.contains('is-open');
}

function stopHeartAmbient(removeHearts = false) {
    heartAmbientRunId++;
    clearTimeout(heartAmbientTimer);
    heartAmbientTimer = null;
    document.getElementById('orbit-stage')?.classList.add('is-heart-paused');
    if (removeHearts) releaseAllHearts();
}

function startHeartAmbient() {
    stopHeartAmbient(false);
    if (!heartAmbientAllowed()) return;

    const stage = document.getElementById('orbit-stage');
    stage?.classList.remove('is-heart-paused');
    const runId = heartAmbientRunId;

    const beat = () => {
        if (runId !== heartAmbientRunId || !heartAmbientAllowed()) return;
        const level = isFinalLetterUnlocked ? 0 : Math.min(heartCharge, HEART_AMBIENT.length - 1);
        const config = HEART_AMBIENT[level];
        // Rải số tim của nhịp này đều ra cả khoảng interval (jitter), để vòi
        // phun chảy liên tục chứ không bật từng cụm theo nhịp đập.
        spawnFountainHearts(orbitDeviceTier().lite ? config.lite : config.regular, {
            jitter: config.interval
        });
        heartAmbientTimer = setTimeout(beat, config.interval);
    };

    // Cho màn orbit kịp hiện rõ rồi mới thả cụm tim đầu tiên.
    heartAmbientTimer = setTimeout(beat, 380);
}

function syncHeartAmbientState() {
    if (heartAmbientAllowed()) startHeartAmbient();
    else stopHeartAmbient(false);
}

function clearHeartEffects() {
    stopHeartAmbient(true);
    clearTimeout(heartBurstTimer);
    heartBurstTimer = null;
    heartBeatAnimation?.cancel();
    heartBeatAnimation = null;
    heartSlowStart = -Infinity;
    orbitBrake = null;
    document.querySelectorAll('.ol-heart-effect').forEach(node => node.remove());
    document.getElementById('orbit-stage')?.classList.remove('is-heart-bursting');
    releaseAllHearts();
    resetOrbitZoom(true);
}

function resetHeartCharge() {
    clearHeartEffects();
    heartCharge = 0;
    isHeartBursting = false;
    isFinalLetterUnlocked = false;
    lastHeartTapTime = -Infinity;
    updateHeartCharge();
}

const HEART_FLOAT_IMAGES = [
    './tim/heart-watercolor-pink.png',
    './tim/heart-watercolor-coral.png',
    './tim/heart-watercolor-plum.png'
];
// Nạp trước để cụm đầu tiên không xuất hiện trễ trong lúc ảnh vừa tải.
HEART_FLOAT_IMAGES.forEach(src => {
    const image = new Image();
    image.src = src;
});

// ---- TIM BÓNG (glossy) ----
// Tim trong video tham chiếu bóng như thạch: đậm ở đáy, highlight trắng ở góc
// trên trái. Ba ảnh watercolor ở trên mềm quá khi chỉ còn 14–20px, nên sinh
// thêm 5 tông SVG ngay tại chỗ — không thêm file ảnh nào.
const GLOSS_TONES = [
    ['#ffc2d4', '#e8577f'], // hồng
    ['#ffd0c2', '#e0706a'], // san hô
    ['#e6d4ff', '#9c7ad6'], // oải hương
    ['#ffe0c8', '#e79a6a'], // đào
    ['#ffb3c1', '#c93b62']  // đỏ hồng
];

function glossHeartSvg([light, deep]) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 58">
<defs><radialGradient id="g" cx="36%" cy="28%" r="78%">
<stop offset="0" stop-color="#fff" stop-opacity=".95"/>
<stop offset=".3" stop-color="${light}"/>
<stop offset="1" stop-color="${deep}"/>
</radialGradient></defs>
<path d="M32 56C10 40 2 30 2 18A15 15 0 0 1 32 10A15 15 0 0 1 62 18C62 30 54 40 32 56Z" fill="url(#g)" fill-opacity=".94"/>
<ellipse cx="19" cy="17" rx="7" ry="4.2" fill="#fff" fill-opacity=".72" transform="rotate(-32 19 17)"/>
</svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const HEART_GLOSS_IMAGES = GLOSS_TONES.map(glossHeartSvg);

// 70% tim bóng, 30% watercolor — giữ chút chất màu nước của trái tim chính.
function pickHeartImage() {
    return Math.random() < 0.7
        ? HEART_GLOSS_IMAGES[Math.floor(Math.random() * HEART_GLOSS_IMAGES.length)]
        : HEART_FLOAT_IMAGES[Math.floor(Math.random() * HEART_FLOAT_IMAGES.length)];
}

// ---- VÒI PHUN TIM (DOM pool) ----
// Bản trước tạo <img> mới cho mỗi chiếc tim rồi setTimeout(remove) — tới 120
// node sinh ra rồi bỏ đi liên tục suốt lúc màn orbit mở. Giờ dựng sẵn một pool
// cố định, tim bay xong thì trả về pool: số node không đổi suốt buổi xem.
const HEART_POOL_SIZE = { lite: 16, regular: 34 };
let heartPool = [];
let orbitHeartW = 320; // bề rộng khung trái tim chính, đo lại khi resize

function buildHeartPool(container, size) {
    heartPool = Array.from({ length: size }, () => {
        const node = document.createElement('img');
        node.className = 'ol-fountain-heart';
        node.alt = '';
        node.decoding = 'async';
        node.draggable = false;
        node.setAttribute('aria-hidden', 'true');
        container.appendChild(node);
        return { node, busy: false, anim: null };
    });
}

function acquireHeart() {
    const item = heartPool.find(h => !h.busy);
    if (item) item.busy = true;
    return item || null;
}

function releaseHeart(item) {
    item.anim?.cancel();
    item.anim = null;
    item.busy = false;
}

function releaseAllHearts() {
    heartPool.forEach(releaseHeart);
}

// Tim chui ra từ SAU hõm trái tim chính rồi phun lên theo hình quạt, vọt nhanh
// rồi lơ lửng và tan ở độ cao cỡ một trái tim — đúng nhịp giây 3–9 của video
// tham chiếu. `spread` là nửa góc quạt (độ), `reach` là quãng bay theo bề
// rộng trái tim.
function spawnFountainHearts(count, options = {}) {
    if (orbitReduced() || count <= 0) return;
    const W = orbitHeartW;
    const spread = options.spread ?? 48;
    const [reachMin, reachMax] = options.reach ?? [0.55, 1.05];
    const [durMin, durMax] = options.duration ?? [2600, 3600];

    for (let i = 0; i < count; i++) {
        const item = acquireHeart();
        if (!item) return;
        const { node } = item;
        const angle = (-90 + (Math.random() * 2 - 1) * spread) * Math.PI / 180;
        const dist = W * (reachMin + Math.random() * (reachMax - reachMin));
        const ox = (Math.random() - 0.5) * W * 0.2;
        const oy = -W * 0.18;
        const dx = Math.cos(angle) * dist;
        const dy = Math.sin(angle) * dist;
        const sway = (Math.random() - 0.5) * 28;
        const rot = -20 + Math.random() * 40;
        // Đa số tim nhỏ; thỉnh thoảng một chiếc to hơn cho có nhịp.
        const size = Math.random() < 0.7 ? 14 + Math.random() * 7 : 21 + Math.random() * 10;
        const scale = options.scale ?? 1;
        const duration = durMin + Math.random() * (durMax - durMin);
        const at = (fx, fy, s, r) =>
            `translate(-50%, -50%) translate(${(ox + fx).toFixed(1)}px, ${(oy + fy).toFixed(1)}px) scale(${s.toFixed(3)}) rotate(${r.toFixed(1)}deg)`;

        node.src = pickHeartImage();
        node.style.width = `${(size * scale).toFixed(1)}px`;
        item.anim = node.animate([
            { transform: at(0, 0, 0.3, 0), opacity: 0 },
            { transform: at(dx * 0.12, dy * 0.12, 1, rot * 0.2), opacity: 1, offset: 0.15 },
            { transform: at(dx * 0.6 + sway, dy * 0.6, 1, rot * 0.6), opacity: 1, offset: 0.55 },
            { transform: at(dx, dy, 0.85, rot), opacity: 0 }
        ], {
            duration,
            delay: (options.delay || 0) + Math.random() * (options.jitter ?? 260),
            easing: 'cubic-bezier(.15, .6, .3, 1)',
            fill: 'both'
        });
        item.anim.onfinish = () => releaseHeart(item);
    }
}

// ---- TIM VỆ TINH TRÊN VÒNG QUỸ ĐẠO ----
// Vòng quỹ đạo nghiêng ôm trái tim chính (toạ độ theo đơn vị = 1% bề rộng tim,
// khớp đúng với svg .ol-orbit-back/.ol-orbit-front dựng trong buildOrbitScene).
// Vài chiếc tim to bay trên vòng này, đi qua TRƯỚC rồi vòng ra SAU tim chính —
// thứ tạo chiều sâu trong traitim1.png.
const HEART_RING = { rx: 78, ry: 20, cy: 8, tilt: -14 };
let satellites = [];

function buildSatellites(container, count) {
    satellites = Array.from({ length: count }, (_, i) => {
        const node = document.createElement('img');
        node.className = 'ol-satellite';
        node.alt = '';
        node.decoding = 'async';
        node.draggable = false;
        node.setAttribute('aria-hidden', 'true');
        node.src = HEART_GLOSS_IMAGES[(i * 2) % HEART_GLOSS_IMAGES.length];
        node.style.width = `${[40, 32, 36][i % 3]}px`;
        container.appendChild(node);
        return { node, phase: (Math.PI * 2 * i) / count + 0.4, tilt: [-12, 14, -6][i % 3] };
    });
}

function layoutSatellites(rotation) {
    if (satellites.length === 0) return;
    const unit = orbitHeartW / 100;
    const t = (HEART_RING.tilt * Math.PI) / 180;
    const cos = Math.cos(t), sin = Math.sin(t);
    // Kích thước gốc tính cho tim 320px; trên điện thoại tim chỉ còn ~200px.
    const fit = Math.min(1, Math.max(0.68, orbitHeartW / 320));
    satellites.forEach(s => {
        const a = rotation + s.phase;
        const x0 = Math.cos(a) * HEART_RING.rx;
        const y0 = Math.sin(a) * HEART_RING.ry;
        const x = (x0 * cos - y0 * sin) * unit;
        const y = (x0 * sin + y0 * cos + HEART_RING.cy) * unit;
        // sin(a) > 0 là nửa dưới của ellipse = nửa phía trước tim chính.
        const depth = (Math.sin(a) + 1) / 2;
        s.node.style.transform =
            `translate(-50%, -50%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${((0.66 + 0.46 * depth) * fit).toFixed(3)}) rotate(${s.tilt}deg)`;
        s.node.style.zIndex = depth > 0.5 ? '7' : '3';
        s.node.style.opacity = ((0.5 + 0.5 * depth) * arrivalProgress(ARRIVAL.satStart, ARRIVAL.satDur)).toFixed(3);
    });
}

function spawnHeartEffects(finalBurst = false) {
    if (orbitReduced()) return;
    // Tim/hạt sáng bay ra nằm ở lớp RIÊNG (#heart-burst), không phải con của
    // #heart-charge — xem chú thích ở HTML. Vòng nhẫn shockwave thì vẫn hợp lý
    // khi bám theo nhịp phóng to của #heart-charge nên giữ nguyên ở đó.
    const ring = document.getElementById('heart-charge');
    const burst = document.getElementById('heart-burst');
    const add = (target, className, x, y, delay = 0, life = 2200) => {
        const node = document.createElement('span');
        node.className = `ol-heart-effect ${className}`;
        node.style.setProperty('--dx', `${x}px`);
        node.style.setProperty('--dy', `${y}px`);
        node.style.animationDelay = `${delay}ms`;
        target.appendChild(node);
        setTimeout(() => node.remove(), life);
        return node;
    };
    add(ring, 'ol-heart-pulse-ring', 0, 0);
    if (finalBurst) {
        add(ring, 'ol-heart-pulse-ring', 0, 0, 130);
        add(ring, 'ol-heart-pulse-ring', 0, 0, 300);
        formHeartRing(burst);
        return;
    }
    const count = orbitDeviceTier().lite ? 6 : 6 + heartCharge;
    const radius = Math.min(burst.clientWidth * (1.15 + heartCharge * 0.08), 300);
    for (let i = 0; i < count; i++) {
        const t = (i * 2 * Math.PI) / count;
        add(burst, 'ol-heart-particle', Math.cos(t) * radius, Math.sin(t) * radius);
    }
}

// ---- CAO TRÀO: TIM XẾP THÀNH VÀNH TRÁI TIM ----
// Giây 10–11 của video: chùm tim không nổ tung ngẫu nhiên mà bay từ tâm ra
// ĐÁP đúng vào các điểm trên một đường cong trái tim lớn quanh tim chính, nhún
// nhẹ tại chỗ, rồi theo cú zoom bay tản ra mép màn hình.
const HEART_FORM_SCALE = 1.75; // vành tim so với bề rộng trái tim chính

function formHeartRing(burst) {
    const count = orbitDeviceTier().lite ? 20 : 36;
    const W = orbitHeartW * HEART_FORM_SCALE;
    const total = HEART_BURST_MS;

    for (let i = 0; i < count; i++) {
        const [nx, ny] = heartCurveNormalized((Math.PI * 2 * i) / count);
        // Tâm hình học của đường cong ~ y 45%, trái tim chính nằm hơi thấp
        // trong khung (58% là mũi nhọn) nên đẩy cả vành xuống 4%.
        const x = ((nx - 50) / 100) * W;
        const y = ((ny - 45) / 100) * W * 0.92 + orbitHeartW * 0.04;
        const size = 20 + Math.random() * 14;
        const rot = -18 + Math.random() * 36;
        const delay = i * 6;
        const at = (fx, fy, sc, r) =>
            `translate(-50%, -50%) translate(${fx.toFixed(1)}px, ${fy.toFixed(1)}px) scale(${sc}) rotate(${r.toFixed(1)}deg)`;
        const bob = (i % 2 ? 1 : -1) * 4;

        const node = document.createElement('img');
        node.className = 'ol-heart-effect ol-form-heart';
        node.src = pickHeartImage();
        node.alt = '';
        node.draggable = false;
        node.style.width = `${size.toFixed(1)}px`;
        burst.appendChild(node);
        // Mốc thời gian (phần trăm của `total`) khớp với completeHeartCharge:
        // 0–33% bay ra đáp chỗ · 33–58% nhún tại chỗ · 58–100% theo cú zoom
        // bay tản ra xa gấp 2,4 lần.
        node.animate([
            { transform: at(0, 0, 0.2, 0), opacity: 0 },
            { transform: at(x, y, 1.12, rot), opacity: 1, offset: 0.26 },
            { transform: at(x, y, 1, rot), opacity: 1, offset: 0.33 },
            { transform: at(x, y + bob, 1.05, rot * 0.7), opacity: 1, offset: 0.46 },
            { transform: at(x, y, 1, rot), opacity: 1, offset: 0.58 },
            { transform: at(x * 2.4, y * 2.4, 1.6, rot * 1.6), opacity: 0 }
        ], { duration: total - delay, delay, easing: 'cubic-bezier(.3, .1, .3, 1)', fill: 'both' });
        // Lifetime phải phủ hết delay + duration, không thì tim bị gỡ giữa
        // đường bay (bài học ở plan-03 D).
        setTimeout(() => node.remove(), total + 400);
    }
}

// ---- ZOOM VÀO TRÁI TIM ----
let orbitZoomAnimation = null;
let orbitVeilAnimation = null;

function playOrbitZoom(delayMs, durationMs) {
    const stage = document.getElementById('orbit-stage');
    const heart = document.getElementById('orbit-heart');
    const veil = document.getElementById('orbit-zoom-veil');
    if (!stage || !heart) return;
    const s = stage.getBoundingClientRect();
    const h = heart.getBoundingClientRect();
    stage.style.transformOrigin = `${h.left + h.width / 2 - s.left}px ${h.top + h.height * 0.52 - s.top}px`;
    // will-change: rasterize sân khấu một lần rồi phóng texture lên. Không có
    // nó, trình duyệt vẽ lại cả sân khấu (ảnh, bóng đổ, blur) ở từng mức zoom
    // trung gian — trên điện thoại là tụt khung ngay đoạn đẹp nhất. Không đổi
    // opacity của cả sân khấu nữa: lớp phủ màu tim đã che dần, còn opacity
    // nhóm trên một layer lớn như vậy là thêm một lượt vẽ offscreen mỗi frame.
    stage.style.willChange = 'transform';
    orbitZoomAnimation = stage.animate([
        { transform: 'scale(1)' },
        { transform: 'scale(3.2)' }
    ], { duration: durationMs, delay: delayMs, easing: 'cubic-bezier(.55, 0, .75, .4)', fill: 'both' });
    if (veil) {
        orbitVeilAnimation = veil.animate([{ opacity: 0 }, { opacity: 1 }], {
            duration: 420, delay: delayMs + durationMs - 260, easing: 'ease-out', fill: 'both'
        });
    }
}

// Đóng lá thư quay về orbit: lùi cú zoom lại thay vì bật cảnh về ngay.
// `instant` dùng khi đóng/reset hẳn orbit — không cần diễn.
function resetOrbitZoom(instant = false) {
    const zoom = orbitZoomAnimation;
    const veil = orbitVeilAnimation;
    const stageEl = document.getElementById('orbit-stage');
    const release = () => { if (stageEl) stageEl.style.willChange = ''; };
    orbitZoomAnimation = null;
    orbitVeilAnimation = null;
    const heartAnim = heartBeatAnimation;
    if (!zoom) {
        veil?.cancel();
        release();
        return;
    }
    if (instant || orbitReduced()) {
        zoom.cancel();
        veil?.cancel();
        release();
        return;
    }
    // reverse() chạy ngược từ đúng vị trí hiện tại, kể cả khi animation đã
    // "finished" và đang giữ khung cuối nhờ fill.
    const rewind = (anim, rate) => {
        anim.updatePlaybackRate(rate);
        anim.reverse();
    };
    rewind(zoom, 1.6);
    zoom.onfinish = () => { zoom.cancel(); release(); };
    if (veil) {
        rewind(veil, 1.6);
        veil.onfinish = () => veil.cancel();
    }
    // Trái tim chính đã mờ trong lúc cao trào; hiện lại cùng lúc với cú lùi.
    if (heartAnim && heartAnim === heartBeatAnimation) {
        rewind(heartAnim, 2.4);
        heartAnim.onfinish = () => {
            heartAnim.cancel();
            if (heartBeatAnimation === heartAnim) heartBeatAnimation = null;
        };
    }
}

// Cỡ hiện tại của phần tử (đọc TRƯỚC khi huỷ animation đang giữ nó). Nhịp mới
// phải bắt đầu từ đúng cỡ này — bắt đầu từ một số cố định như scale(0.96) là
// tim co giật một phát mỗi lần chạm, vì nhịp trước để nó ở ~1.02–1.04.
function currentScale(el) {
    const m = getComputedStyle(el).transform;
    if (!m || m === 'none') return 1;
    const v = m.match(/matrix\(([^,]+),\s*([^,]+)/);
    return v ? Math.hypot(parseFloat(v[1]), parseFloat(v[2])) : 1;
}

function playChargedHeartbeat() {
    const wrapper = document.getElementById('heart-charge');
    const from = currentScale(wrapper);
    heartBeatAnimation?.cancel();
    if (orbitReduced()) {
        heartBeatAnimation = wrapper.animate([{ opacity: 0.8 }, { opacity: 1 }], { duration: 120 });
        return;
    }
    const peak = 1.16 + heartCharge * 0.09;
    const rest = 1 + heartCharge * 0.018;
    heartBeatAnimation = wrapper.animate([
        { transform: `scale(${from.toFixed(3)})` }, { transform: `scale(${peak})` },
        { transform: `scale(${heartCharge >= 6 ? 1 : rest})` },
        { transform: `scale(${heartCharge >= 6 ? peak : rest})` },
        { transform: `scale(${rest})` }
    ], { duration: 420, easing: 'ease-out', fill: 'forwards' });
    heartSlowStart = performance.now();
    spawnHeartEffects();
    // Mỗi nhịp chạm là một cú phun dày, quạt rộng và bay xa hơn vòi phun nền.
    const tapCounts = orbitDeviceTier().lite ? [0, 6, 9] : [0, 10, 16];
    spawnFountainHearts(tapCounts[heartCharge] || tapCounts[tapCounts.length - 1], {
        spread: 70,
        reach: [0.8, 1.35],
        duration: [1900, 2600],
        jitter: 140,
        scale: 1.15
    });
}

// Timeline cao trào (HEART_BURST_MS = 2700):
//   0–900ms     tim bay ra xếp thành vành trái tim, chòm sao chạy sáng một vòng
//   900–1560ms  vành tim nhún tại chỗ, trái tim chính mờ dần
//   1560–2400   ZOOM thẳng vào trái tim, vành tim bay tản ra mép
//   2400–2700   lớp phủ màu tim hiện lên → mở lá thư
function completeHeartCharge() {
    isHeartBursting = true;
    stopHeartAmbient(false);
    brakeOrbit(650);
    const wrapper = document.getElementById('heart-charge');
    const from = currentScale(wrapper);
    heartBeatAnimation?.cancel();
    const stage = document.getElementById('orbit-stage');
    stage.classList.add('is-heart-bursting');
    if (!orbitReduced()) {
        spawnHeartEffects(true);
        runOrbitConstellationChase();
        // Tim chính nảy một nhịp mạnh rồi lùi mờ vào giữa vành tim — vành
        // tim mới là nhân vật chính của cao trào này.
        heartBeatAnimation = wrapper.animate([
            { transform: `scale(${from.toFixed(3)})`, opacity: 1 },
            { transform: 'scale(1.18)', opacity: 1, offset: 0.1 },
            { transform: 'scale(1)', opacity: 0.9, offset: 0.33 },
            { transform: 'scale(0.94)', opacity: 0.28, offset: 0.58 },
            { transform: 'scale(1.05)', opacity: 0.2 }
        ], { duration: HEART_BURST_MS, easing: 'ease-in-out', fill: 'forwards' });
        playOrbitZoom(Math.round(HEART_BURST_MS * 0.58), Math.round(HEART_BURST_MS * 0.31));
    }
    heartBurstTimer = setTimeout(() => {
        if (!orbitOpen || !isHeartBursting) return;
        isFinalLetterUnlocked = true;
        isHeartBursting = false;
        heartBurstTimer = null;
        // KHÔNG huỷ heartBeatAnimation/zoom ở đây: lá thư mở đè lên đúng khung
        // cảnh đã zoom. closeFullLetter() → resetOrbitZoom() mới lùi chúng lại;
        // huỷ ngay bây giờ thì trái tim bật sáng trở lại sau lớp thư đang hiện.
        stage.classList.remove('is-heart-bursting');
        updateHeartCharge();
        openFullLetter();
    }, orbitReduced() ? 180 : HEART_BURST_MS);
}

function handleHeartTap(event) {
    event.stopPropagation();
    if (!orbitOpen || isHeartBursting || orbitCardIndex >= 0) return;
    if (orbitArrival && !orbitArrival.heartReady) return;
    if (isFinalLetterUnlocked) { openFullLetter(); return; }
    const now = performance.now();
    if (now - lastHeartTapTime < 120) return;
    lastHeartTapTime = now;
    heartCharge = Math.min(HEART_TAP_TARGET, heartCharge + 1);
    updateHeartCharge();
    if (heartCharge === HEART_TAP_TARGET) completeHeartCharge();
    else {
        playChargedHeartbeat();
        startHeartAmbient();
    }
}

// ---- NHIỄU CÓ SEED ----
// Port nguyên từ rand.ts. Cùng index + salt luôn ra cùng một số, nên bầu trời
// giống hệt nhau ở mọi lần mở — dùng Math.random() thì mỗi lần đóng/mở lại là
// một bầu trời khác, và người xem nhận ra ngay là đồ giả.
function orbitRand(index, salt = 1) {
    const value = 43758.5453 * Math.sin((index + 1) * 12.9898 * salt);
    return value - Math.floor(value);
}

function orbitRound(value, digits = 2) {
    return Number(value.toFixed(digits));
}

// ---- PHÂN HẠNG MÁY ----
// Port readTier(). `lite` bỏ hết blur và làm thưa mọi lớp sinh tự động; `rich`
// là đầu kia, nơi quầng sáng sau trái tim đủ sức gánh thêm một lớp blur.
// Máy không đổi giữa chừng nên đo một lần rồi nhớ luôn.
function orbitDeviceTier() {
    if (orbitTier) return orbitTier;

    const cores = navigator.hardwareConcurrency || 4;
    const memory = navigator.deviceMemory;
    const lite = cores <= 4 || (typeof memory === 'number' && memory <= 4);

    orbitTier = { lite, rich: !lite && cores >= 8 };
    return orbitTier;
}

function orbitReduced() {
    return typeof prefersReducedMotion === 'function' && prefersReducedMotion();
}

// ---- CÁC LỚP BẦU TRỜI ----
// Tinh vân đào–tím, hai lớp sao parallax, hạt sáng bay lên, sao băng. Dựng bằng chuỗi HTML một lần rồi thôi — chúng không bao giờ đổi sau khi
// dựng, nên không cần giữ tham chiếu tới từng phần tử.

function buildOrbitNebulae(reduce, lite) {
    const clouds = [
        { color: 'rgba(201,138,130,0.30)', w: '70vw', left: '8%', top: '12%', anim: 'ol-nebula-a 26s ease-in-out infinite' },
        { color: 'rgba(200,184,217,0.24)', w: '62vw', left: '52%', top: '30%', anim: 'ol-nebula-b 32s ease-in-out infinite' },
        { color: 'rgba(217,197,163,0.22)', w: '58vw', left: '26%', top: '58%', anim: 'ol-nebula-a 38s ease-in-out infinite' }
    ];

    return clouds.map(cloud => `
        <div class="ol-nebula" style="
            left:${cloud.left}; top:${cloud.top};
            width:${cloud.w}; height:${cloud.w};
            background: radial-gradient(circle, ${cloud.color} 0%, transparent 68%);
            filter:${lite ? 'none' : 'blur(18px)'};
            animation:${reduce || lite ? 'none' : cloud.anim};"></div>
    `).join('');
}

function buildOrbitStarLayer(count, salt, anim, reduce, lite) {
    const palette = [
        { c: 'var(--ol-ivory)', g: 'rgba(255,248,234,' },
        { c: 'var(--ol-champagne)', g: 'rgba(232,201,178,' },
        { c: 'rgba(200,184,217,0.95)', g: 'rgba(200,184,217,' }
    ];

    let html = '';
    for (let i = 0; i < count; i++) {
        const hue = orbitRand(i, salt + 7);
        const tone = hue < 0.62 ? palette[0] : hue < 0.84 ? palette[1] : palette[2];
        const big = orbitRand(i, salt + 8) > 0.85;
        const glow = big ? orbitRound(7 + 5 * orbitRand(i, salt + 9)) : 5;
        const size = orbitRound((big ? 1.6 : 0.8) + 1.9 * orbitRand(i, salt + 2));
        const dur = orbitRound(3 + 5 * orbitRand(i, salt + 3));
        const delay = orbitRound(5 * orbitRand(i, salt + 4));
        const min = orbitRound(0.1 + 0.2 * orbitRand(i, salt + 5), 3);
        const max = orbitRound((big ? 0.7 : 0.55) + 0.4 * orbitRand(i, salt + 6), 3);

        html += `<span class="ol-star" style="
            left:${orbitRound(100 * orbitRand(i, salt), 3)}%;
            top:${orbitRound(100 * orbitRand(i, salt + 1), 3)}%;
            width:${size}px; height:${size}px;
            background:${tone.c};
            box-shadow:0 0 ${glow}px ${tone.g}${big ? '0.85' : '0.7'});
            animation:${reduce || lite ? 'none' : `ol-twinkle ${dur}s ease-in-out ${delay}s infinite`};
            --star-min:${min}; --star-max:${max};"></span>`;
    }

    return `<div class="ol-starlayer" style="animation:${reduce || lite ? 'none' : anim};">${html}</div>`;
}

// Hạt sáng bay lên (champagne + hồng phấn) — tiếp nối lớp sparkles của màn 1.
function buildOrbitSparkles(reduce, lite) {
    let html = '';
    for (let i = 0; i < (lite ? 16 : 32); i++) {
        const dur = orbitRound(9 + 10 * orbitRand(i, 251));
        const pink = orbitRand(i, 263) < 0.55;
        html += `<span class="ol-spark" style="
            left:${orbitRound(100 * orbitRand(i, 257), 3)}%;
            ${reduce ? `top:${orbitRound(100 * orbitRand(i, 269), 2)}%;` : ''}
            background:${pink ? '#ffd0dc' : '#ffeacc'};
            box-shadow:0 0 6px ${pink ? 'rgba(255,170,190,0.8)' : 'rgba(255,220,168,0.8)'};
            animation:${reduce ? 'none' : `ol-spark-rise ${dur}s linear ${orbitRound(-dur * orbitRand(i, 271))}s infinite`};
            --spark-max:${orbitRound(0.35 + 0.5 * orbitRand(i, 277), 3)};"></span>`;
    }
    return `<div class="ol-layer ol-clip">${html}</div>`;
}

// Cánh hoa hồng bay chéo — lấy chất liệu từ chính tranh tim hoa ở giữa để nền
// và trái tim là một bộ. Ba lớp lồng nhau tách ba chuyển động: rơi (ngoài),
// lắc ngang (giữa), lật xoay 3D (trong), mỗi lớp một nhịp nên không lặp đều.
function buildOrbitPetals(reduce, lite) {
    const tones = [
        ['#ffe3ec', '#f7a8c4'],
        ['#ffd0de', '#ee66a6'],
        ['#fff1f4', '#f5b8c8'],
        ['#ffc2d4', '#e0507f']
    ];
    let html = '';

    for (let i = 0; i < (lite ? 9 : 18); i++) {
        const depth = orbitRand(i, 311);
        const [light, deep] = tones[Math.floor(orbitRand(i, 313) * tones.length)];
        const size = orbitRound(13 + 12 * depth);
        const fall = orbitRound(14 + 12 * (1 - depth));
        const sway = orbitRound(3 + 3 * orbitRand(i, 317));
        const spin = orbitRound(4 + 5 * orbitRand(i, 331));
        const top = reduce ? `top:${orbitRound(100 * orbitRand(i, 337), 2)}%;` : '';

        html += `<span class="ol-petal" style="
            left:${orbitRound(-10 + 100 * orbitRand(i, 347), 2)}%; ${top}
            opacity:${orbitRound(0.45 + 0.45 * depth, 3)};
            filter:${lite || depth > 0.45 ? 'none' : `blur(${orbitRound(1.4 * (1 - depth / 0.45), 2)}px)`};
            animation:${reduce ? 'none' : `ol-petal-fall ${fall}s linear ${orbitRound(-fall * orbitRand(i, 349))}s infinite`};
            --petal-drift:${Math.round(12 + 18 * orbitRand(i, 353))}vw;">
            <span class="ol-petal-sway" style="animation:${reduce ? 'none' : `ol-petal-sway ${sway}s ease-in-out ${orbitRound(-sway * orbitRand(i, 359))}s infinite alternate`};">
                <span class="ol-petal-leaf" style="
                    width:${size}px; height:${orbitRound(size * 0.82)}px;
                    background:radial-gradient(120% 120% at 20% 20%, ${light} 0%, ${deep} 100%);
                    animation:${reduce ? 'none' : `ol-petal-spin ${spin}s linear ${orbitRound(-spin * orbitRand(i, 367))}s infinite`};
                    transform:rotate(${Math.round(360 * orbitRand(i, 373))}deg);"></span>
            </span>
        </span>`;
    }

    return `<div class="ol-layer ol-clip">${html}</div>`;
}

// Bướm: cánh trên + cánh dưới có vân, chấm trắng viền mép, thân và râu. Mỗi
// nửa cánh là một lớp riêng vỗ bằng rotateY trong không gian 3D nên trông như
// cánh gập thật chứ không bóp dẹt. Ba con lượn vòng quanh mép màn hình suốt
// (không bao giờ ra khỏi khung), chừa vùng giữa cho trái tim.
function buildOrbitButterflies(reduce, lite) {
    const wingSvg = `
        <svg viewBox="0 0 50 62" aria-hidden="true">
            <path d="M50 27 C41 7 20 -1 7 5 C-2 10 2 25 13 30 C25 35 40 33 50 31 Z"
                  fill="url(#ol-bfly-upper)" stroke="#a8345f" stroke-width="1.1"/>
            <path d="M50 32 C38 33 22 39 18 49 C15 58 26 62 34 55 C42 49 47 41 50 35 Z"
                  fill="url(#ol-bfly-lower)" stroke="#a8345f" stroke-width="1.1"/>
            <g fill="none" stroke="rgba(130,30,70,0.38)" stroke-width="0.7" stroke-linecap="round">
                <path d="M49 28 C38 18 24 10 10 8"/><path d="M49 29 C36 24 22 22 9 20"/>
                <path d="M49 30 C38 30 26 30 15 29"/><path d="M49 34 C40 38 30 44 23 52"/>
                <path d="M49 35 C44 42 38 49 32 55"/>
            </g>
            <ellipse cx="22" cy="15" rx="5.5" ry="4" fill="rgba(255,255,255,0.55)"/>
            <g fill="#fff8f2">
                <circle cx="9" cy="9" r="1.4"/><circle cx="5.5" cy="15" r="1.2"/>
                <circle cx="7" cy="22" r="1.2"/><circle cx="20" cy="54" r="1.1"/>
                <circle cx="27" cy="58" r="1.1"/>
            </g>
        </svg>`;

    const butterfly = `
        <span class="ol-bfly-body">
            <span class="ol-bfly-wing is-left">${wingSvg}</span>
            <span class="ol-bfly-wing is-right">${wingSvg}</span>
            <svg class="ol-bfly-thorax" viewBox="0 0 20 62" aria-hidden="true">
                <path d="M10 14 C6 8 4 3 2 1 M10 14 C14 8 16 3 18 1" fill="none" stroke="#5a1f36" stroke-width="1" stroke-linecap="round"/>
                <circle cx="2" cy="1.5" r="1.5" fill="#5a1f36"/><circle cx="18" cy="1.5" r="1.5" fill="#5a1f36"/>
                <ellipse cx="10" cy="33" rx="2.6" ry="17" fill="#6b2541"/>
                <ellipse cx="10" cy="22" rx="3.2" ry="5" fill="#7d2d4d"/>
            </svg>
        </span>`;

    const flights = [
        { path: 'ol-bfly-path-a', dur: 24, delay: 0, size: 58, flap: 0.26 },
        { path: 'ol-bfly-path-b', dur: 28, delay: -9, size: 50, flap: 0.3 },
        { path: 'ol-bfly-path-c', dur: 32, delay: -17, size: 42, flap: 0.24 }
    ].slice(0, lite ? 2 : 3);

    const html = flights.map(f => `
        <span class="ol-bfly" style="
            width:${f.size}px; height:${Math.round(f.size * 0.62)}px;
            animation:${reduce ? 'none' : `${f.path} ${f.dur}s ease-in-out ${f.delay}s infinite`};
            --flap:${f.flap}s;">
            <span class="ol-bfly-bob" style="animation:${reduce ? 'none' : `ol-bfly-bob ${orbitRound(2.2 + f.flap * 3)}s ease-in-out infinite alternate`};">${butterfly}</span>
        </span>`).join('');

    return `<div class="ol-layer ol-clip${reduce ? ' is-still' : ''}">
        <svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
            <radialGradient id="ol-bfly-upper" cx="100%" cy="50%" r="100%">
                <stop offset="0" stop-color="#fff3e8"/>
                <stop offset="0.35" stop-color="#ffc4d6"/>
                <stop offset="0.8" stop-color="#ef7fa6"/>
                <stop offset="1" stop-color="#c94f7e"/>
            </radialGradient>
            <radialGradient id="ol-bfly-lower" cx="100%" cy="20%" r="100%">
                <stop offset="0" stop-color="#fff0e4"/>
                <stop offset="0.45" stop-color="#ffb8cc"/>
                <stop offset="1" stop-color="#d9628f"/>
            </radialGradient>
        </defs></svg>
        ${html}
    </div>`;
}

function buildOrbitShootingStars(reduce, lite) {
    if (reduce) return '';

    const all = [
        { top: '16%', left: '-6%', x: 460, y: 150, rot: 18, dur: 7, delay: 2 },
        { top: '44%', left: '-8%', x: 520, y: 90, rot: 10, dur: 9, delay: 6 },
        { top: '8%', left: '30%', x: 360, y: 220, rot: 32, dur: 11, delay: 9.5 }
    ];

    const streaks = all.slice(0, lite ? 1 : 2);
    const html = streaks.map(s => `
        <span class="ol-shoot" style="
            top:${s.top}; left:${s.left};
            animation: ol-shoot ${s.dur}s ease-in ${s.delay}s infinite;
            --shoot-x:${s.x}px; --shoot-y:${s.y}px; --shoot-rot:${s.rot}deg;"></span>
    `).join('');

    return `<div class="ol-layer ol-clip">${html}</div>`;
}

// ---- CHÒM SAO TRÁI TIM Ở MÀN 2 ----
// Cùng dữ liệu HEART_CONSTELLATION với chòm sao màn 1 (script.js): trái tim
// sao người xem vừa ghép xong "đi theo" sang màn này, nằm mờ sau trái tim chính.
// viewBox giữ đúng tỉ lệ 420×392 của ảnh mẫu (+ lề 30 cho tia sáng của sao),
// nên không phải kéo giãn và nét không bị méo.
function buildOrbitConstellation(lite) {
    const pts = HEART_CONSTELLATION.map(([x, y]) => [x * 4.2, y * 3.92]);
    const d = `${pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')} Z`;
    const big = new Set([0, 5, 9]); // mũi tim + hai đỉnh thuỳ: đúng 3 sao ký ức ở màn 1
    const stars = pts.map(([x, y], i) => {
        const r = big.has(i) ? 7 : 4.6;
        const g = big.has(i) ? 17 : 10;
        return `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)})">
            <g class="ol-cstar" style="--i:${i}; --tw:${((i * 0.41) % 2.4).toFixed(2)}s">
                <path d="M0 ${-r} L${r * 0.2} ${-r * 0.2} L${r} 0 L${r * 0.2} ${r * 0.2} L0 ${r} L${-r * 0.2} ${r * 0.2} L${-r} 0 L${-r * 0.2} ${-r * 0.2}Z"/>
                <line x1="${-g}" y1="0" x2="${g}" y2="0"/><line x1="0" y1="${-g}" x2="0" y2="${g}"/>
            </g></g>`;
    }).join('');
    return `<svg class="ol-constellation" viewBox="-30 -30 480 452" aria-hidden="true">
        <path class="ol-const-base" d="${d}"/>
        <path class="ol-const-draw" d="${d}" pathLength="100"/>
        ${lite ? '' : `<path class="ol-const-comet" d="${d}" pathLength="100"/>`}
        ${stars}
    </svg>`;
}

// Viền tim trơn mảnh ôm sát trái tim chính — chỉ một cung sáng trượt quanh,
// không phải vòng khép kín (giây 6 của video).
function buildOrbitHeartOutline() {
    const pts = [];
    for (let i = 0; i <= 80; i++) {
        const [x, y] = heartCurveNormalized((Math.PI * 2 * i) / 80);
        pts.push(`${i ? 'L' : 'M'}${x.toFixed(2)} ${(y * 0.9).toFixed(2)}`);
    }
    return `<svg class="ol-heart-outline" viewBox="-2 -2 104 94" aria-hidden="true">
        <path d="${pts.join(' ')}Z" pathLength="100"/>
    </svg>`;
}

// Vòng quỹ đạo nghiêng có hạt chấm, chia hai nửa: nửa trên nằm SAU trái tim,
// nửa dưới nằm TRƯỚC — vòng như xuyên qua tim. Hệ đơn vị 1 = 1% bề rộng tim,
// cùng HEART_RING mà layoutSatellites() dùng, nên tim vệ tinh chạy đúng trên nét.
function buildOrbitRingHalf(half) {
    const { rx, ry, cy, tilt } = HEART_RING;
    const d = half === 'back'
        ? `M ${-rx} 0 A ${rx} ${ry} 0 0 1 ${rx} 0`
        : `M ${rx} 0 A ${rx} ${ry} 0 0 1 ${-rx} 0`;
    return `<svg class="ol-orbit ol-orbit-${half}" viewBox="-90 -90 180 180" aria-hidden="true">
        <g transform="translate(0 ${cy}) rotate(${tilt})">
            <path class="ol-orbit-arc" d="${d}" pathLength="100"/>
            <path class="ol-orbit-beads" d="${d}"/>
        </g>
    </svg>`;
}

// Vệt sáng chạy trọn chòm sao màn 2 một vòng — mở đầu cao trào.
function runOrbitConstellationChase() {
    const svg = document.querySelector('.ol-constellation');
    if (!svg) return;
    svg.classList.remove('is-chasing');
    void svg.getBoundingClientRect();
    svg.classList.add('is-chasing');
    setTimeout(() => svg.classList.remove('is-chasing'), 1600);
}

// Trao tay từ màn 1: chòm sao màn 1 vừa bay tới đúng chỗ này, nên chòm sao
// màn 2 bật sáng 100% ngay (không vẽ lại) rồi dịu dần về mức nghỉ.
function arriveOrbitConstellation() {
    const svg = document.querySelector('.ol-constellation');
    if (!svg) return;
    svg.classList.remove('is-drawn');
    void svg.getBoundingClientRect();
    svg.classList.add('is-arrived');
}

// Mỗi lần mở orbit, chòm sao VẼ LẠI từ mũi tim — nối tiếp đúng khoảnh khắc
// chòm sao màn 1 vừa khép vòng.
function replayOrbitConstellation() {
    const svg = document.querySelector('.ol-constellation');
    if (!svg) return;
    svg.classList.remove('is-drawn', 'is-arrived');
    void svg.getBoundingClientRect();
    svg.classList.add('is-drawn');
}

// ---- DỰNG SÂN KHẤU ----
// Chip dưới mỗi token: khi LoveGift có lời nhắn thì hiện luôn lời nhắn (rút gọn)
// thay cho "Ký ức 1, 2...". Cắt ở ranh giới từ để không đứt giữa chữ tiếng Việt;
// CSS vẫn giữ line-clamp làm lưới an toàn cho màn hẹp.
const ORBIT_CHIP_MAX_CHARS = 26;
function orbitChipLabel(part, i) {
    const messages = window.LOVEGIFT_CONFIG && window.LOVEGIFT_CONFIG.messages;
    const text = String(part.text || '').replace(/\s+/g, ' ').trim();
    if (!Array.isArray(messages) || messages.length === 0 || !text) {
        return part.label || `Recuerdo ${i + 1}`;
    }
    const chars = Array.from(text);
    if (chars.length <= ORBIT_CHIP_MAX_CHARS) return text;
    const cut = chars.slice(0, ORBIT_CHIP_MAX_CHARS).join('');
    const lastSpace = cut.lastIndexOf(' ');
    const head = lastSpace > ORBIT_CHIP_MAX_CHARS * 0.6 ? cut.slice(0, lastSpace) : cut;
    return `${head.replace(/[\s,.;:!?-]+$/, '')}…`;
}

function buildOrbitScene() {
    if (orbitBuilt) return;

    const overlay = document.getElementById('memory-orbit');
    if (!overlay) return;

    const { lite, rich } = orbitDeviceTier();
    const reduce = orbitReduced();

    // Token: mỗi lời nhắn một tấm ảnh. Ảnh hỏng thì ẩn <img>, để lại khung sáng
    // có chữ cái đầu của nhãn — tốt hơn một ô xám trống đang bay vòng quanh.
    const tokensHtml = orbitMemories.map((part, i) => {
        const photo = safePhotoUrl(part.photo);
        const label = escapeHtml(orbitChipLabel(part, i));
        const dayClass = part.daylight ? ' is-daylight' : '';
        const fallbackPhoto = pickFallbackPhoto(photo || '');
        const img = photo
            ? `<img src="${escapeHtml(photo)}" alt="" class="${dayClass.trim()}" onerror="this.onerror=null; this.src='${escapeHtml(fallbackPhoto)}'">`
            : `<img src="${escapeHtml(fallbackPhoto)}" alt="" class="${dayClass.trim()}">`;

        return `<button type="button" class="ol-token" data-index="${i}"
                        aria-label="Releer recuerdo: ${label}">
                    <span class="ol-token-thumb"><span class="ol-token-fallback">${label.slice(0, 1)}</span>${img}</span>
                    <span class="ol-token-label">${label}</span>
                </button>`;
    }).join('');

    // Mỗi token một đường nối mảnh về tâm — giữ cảm giác "chòm sao" của màn
    // trước, để hai màn nối vào nhau chứ không phải hai thứ rời rạc.
    const linesHtml = lite ? '' : orbitMemories.map(() =>
        `<line class="ol-line" stroke="var(--ol-constellation)" stroke-width="1" stroke-linecap="round" style="opacity:0"></line>`
    ).join('');

    overlay.innerHTML = `
        <div class="ol-sky">
            ${buildOrbitNebulae(reduce, lite)}
            ${buildOrbitStarLayer(lite ? 9 : 26, 3, 'ol-star-pan-1 90s linear infinite alternate', reduce, lite)}
            ${buildOrbitStarLayer(lite ? 7 : 16, 31, 'ol-star-pan-2 130s linear infinite alternate', reduce, lite)}

            ${buildOrbitSparkles(reduce, lite)}
            ${buildOrbitPetals(reduce, lite)}
            ${buildOrbitButterflies(reduce, lite)}
            ${buildOrbitShootingStars(reduce, lite)}

            <div class="ol-halo" style="animation:${reduce || lite ? 'none' : 'ol-breathe 7.2s ease-in-out infinite'};"></div>
            <div class="ol-haze"></div>
            <div class="ol-vignette"></div>
        </div>

        <div class="ol-stage" id="orbit-stage">
            <div class="ol-ellipse-glow"></div>
            <img class="ol-ring" src="./assets/orbit/orbit-ring-cosmic-soft-01.svg" alt="" aria-hidden="true">
            <svg class="ol-lines" id="orbit-lines" aria-hidden="true">${linesHtml}</svg>

            <div class="ol-core">
                <div class="ol-core-float" style="animation:${reduce || lite ? 'none' : 'ol-core-float 7s ease-in-out infinite'};">
                    <span class="ol-heart-aura" aria-hidden="true" style="
                        filter:${rich && !reduce ? 'blur(8px)' : 'none'};
                        animation:${reduce || lite ? 'none' : 'ol-heart-glow 3.6s ease-in-out infinite'};"></span>
                    ${buildOrbitConstellation(lite)}
                    ${buildOrbitHeartOutline()}
                    ${buildOrbitRingHalf('back')}
                    <div class="ol-fountain" id="heart-fountain" aria-hidden="true"></div>
                    <div class="ol-heart-charge" id="heart-charge">
                    <button type="button" class="ol-heart-btn" id="orbit-heart"
                            aria-label="Abrir la carta del 20/10">
                        <img class="ol-heart" src="./assets/orbit/traitimnew.webp" alt="">
                    </button>
                    </div>
                    ${buildOrbitRingHalf('front')}
                    <div class="ol-satellites" id="heart-satellites" aria-hidden="true"></div>
                    <!-- Lớp riêng cho tim/hạt sáng bay ra. TÁCH khỏi #heart-charge
                         chủ đích: #heart-charge tự phóng to rồi mờ dần khi cao
                         trào chạy (xem completeHeartCharge trong orbit.js), nên
                         hiệu ứng nào làm con của nó cũng bị kéo mờ theo cha —
                         đúng lúc tim bay ra đẹp nhất thì cha đã gần tắt. Đặt
                         ngang hàng để hiệu ứng giữ nguyên độ sáng của chính nó. -->
                    <div class="ol-heart-burst" id="heart-burst" aria-hidden="true"></div>
                </div>
            </div>

            <div class="ol-heart-progress" id="heart-progress-wrap" role="progressbar"
                 aria-label="Progreso para abrir la carta del 20/10" aria-valuemin="0" aria-valuemax="3" aria-valuenow="0">
                <div class="ol-heart-progress-track"><span id="heart-progress-fill"></span></div>
                <span id="heart-progress-label">0/3 latidos</span>
                <span class="ol-heart-hint" id="heart-progress-hint">Toca el corazón para recibir la carta del 20/10</span>
            </div>

            <div class="ol-titles">
                <p class="ol-eyebrow">HECHO POR VIC PERSI</p>
                <span class="ol-rule" aria-hidden="true"><i></i><b></b><i></i></span>
                <h2 class="ol-title">Para ${escapeHtml(recipientName)}</h2>
            </div>

            ${tokensHtml}
        </div>

        <div class="ol-zoom-veil" id="orbit-zoom-veil" aria-hidden="true"></div>
        <button type="button" class="ol-close" id="orbit-close" aria-label="Volver a la lluvia de amor">&times;</button>

        <div class="ol-overlay" id="orbit-card" aria-hidden="true" role="dialog" aria-modal="true">
            <div class="ol-scrim"></div>
            <div class="ol-card" id="orbit-card-body"></div>
        </div>
    `;

    const stage = overlay.querySelector('#orbit-stage');
    const heartCharge = overlay.querySelector('#heart-charge');
    const fountain = overlay.querySelector('#heart-fountain');
    if (fountain) buildHeartPool(fountain, lite ? HEART_POOL_SIZE.lite : HEART_POOL_SIZE.regular);
    // Vệ tinh là con TRỰC TIẾP của .ol-core-float (không nằm trong một lớp
    // bọc có z-index), để z-index 3/7 của từng chiếc xen được vào giữa vòng
    // quỹ đạo sau (3), trái tim (5) và vòng quỹ đạo trước (6).
    const satelliteHost = overlay.querySelector('#heart-satellites');
    if (satelliteHost) {
        const coreFloat = satelliteHost.parentElement;
        buildSatellites(coreFloat, lite ? 2 : 3);
        satelliteHost.remove();
    }
    orbitTokens = Array.from(overlay.querySelectorAll('.ol-token'));
    orbitLines = Array.from(overlay.querySelectorAll('.ol-line'));

    orbitTokens.forEach(token => {
        token.addEventListener('click', event => {
            event.stopPropagation();
            openOrbitCard(Number(token.dataset.index));
        });
    });

    const heart = overlay.querySelector('#orbit-heart');
    if (heart) {
        // Native button click covers mouse, touch, Enter and Space exactly once.
        heart.addEventListener('click', handleHeartTap);
    }

    const close = overlay.querySelector('#orbit-close');
    if (close) {
        close.addEventListener('click', event => {
            event.stopPropagation();
            closeMemoryOrbit();
        });
    }

    const card = overlay.querySelector('#orbit-card');
    if (card) {
        card.addEventListener('click', event => {
            if (event.target === card || event.target.classList.contains('ol-scrim')) {
                closeOrbitCard();
            }
        });
    }

    // Toàn bộ toạ độ quỹ đạo tính từ kích thước sân khấu, nên phải ĐO chứ không
    // đoán. ResizeObserver bắt được cả trường hợp thanh địa chỉ mobile co lại,
    // thứ mà sự kiện resize của window bỏ sót.
    if (typeof ResizeObserver !== 'undefined' && stage) {
        orbitResizeObserver = new ResizeObserver(() => {
            orbitStageSize = { w: stage.clientWidth, h: stage.clientHeight };
            if (heartCharge) orbitHeartW = heartCharge.offsetWidth || orbitHeartW;
            layoutOrbit();
        });
        orbitResizeObserver.observe(stage);
    }

    orbitBuilt = true;
}

// ---- TOÁN QUỸ ĐẠO ----
// Port hàm layout() của bản gốc, giữ nguyên mọi hằng số.
//
// Mọi giá trị dưới đây ghi THẲNG vào element.style trong vòng rAF. Bản gốc ghi
// rõ lý do và đây là chỗ dễ làm sai nhất khi port: cho các giá trị này đi qua
// một vòng render hay để token mang transition thì mỗi frame lại mở một
// transition mới, và cảnh giật liên tục.
function layoutOrbit() {
    const count = orbitTokens.length;
    if (count === 0 || orbitStageSize.w === 0) return;

    const cx = orbitStageSize.w / 2;
    const cy = 0.46 * orbitStageSize.h;
    const compact = orbitStageSize.w <= 768 && orbitStageSize.h > orbitStageSize.w;
    // Chừa chỗ cho chip hai dòng ở mép màn hình. Ellipse cao hơn trên
    // điện thoại để chip phía trước không đè lên ảnh kế bên.
    const rx = Math.min(0.44 * orbitStageSize.w, 360, orbitStageSize.w / 2 - 54);
    const ry = compact ? Math.min(orbitStageSize.h * 0.25, rx * 1.35) : 0.62 * rx;
    // Nhiều ảnh (người gửi tải lên hơn 8 tấm) thì thu nhỏ token để khỏi đè
    // nhau, và rút ngắn độ trễ để tấm cuối vẫn bay ra kịp trong cảnh đến.
    const crowd = count > 8 ? Math.max(0.55, Math.sqrt(8 / count)) : 1;
    const stagger = count > 1 ? Math.min(ARRIVAL.tokenStagger, 450 / (count - 1)) : 0;

    for (let i = 0; i < count; i++) {
        const token = orbitTokens[i];
        if (!token) continue;

        const angle = -Math.PI / 2 + (i / count) * Math.PI * 2 + orbitRotation;
        // Lúc màn 2 vừa "đến", từng tấm ảnh bay từ TÂM trái tim ra đúng chỗ
        // của nó trên quỹ đạo (vọt quá một chút rồi về). Hết cảnh đến thì
        // e = 1 và mọi thứ như cũ.
        const e = arrivalProgress(ARRIVAL.tokenStart + i * stagger, ARRIVAL.tokenDur);
        const k = e >= 1 ? 1 : easeOutBack(e);
        const x = Math.cos(angle) * rx * k;
        const y = Math.sin(angle) * ry * k;
        if (orbitArrival) token.classList.toggle('is-ready', e >= 1);

        // 0 ở nửa xa của ellipse, 1 ở nửa gần. Một con số này kéo theo cả tỉ lệ,
        // độ mờ, độ nhoè và z-index — nhờ vậy ảnh ở nửa xa thật sự đi vòng ra
        // SAU trái tim chứ không phải chỉ nhỏ đi.
        const depth = (Math.sin(angle) + 1) / 2;
        const scale = compact ? 0.42 + 0.46 * depth
            : orbitStageSize.h <= 500 ? 0.48 + 0.62 * depth : 0.52 + 0.78 * depth;
        const blur = orbitRound((1 - depth) * 2.6, 1);

        token.style.transform =
            `translate(-50%, -50%) translate(${orbitRound(cx + x, 1)}px, ${orbitRound(cy + y, 1)}px) scale(${orbitRound(crowd * scale * (0.3 + 0.7 * e), 3)})`;
        token.style.zIndex = String(Math.round(80 * depth));
        token.style.opacity = String(orbitRound((0.4 + 0.6 * depth) * e, 3));
        token.style.filter = blur > 0.15 ? `blur(${blur}px)` : 'none';

        const line = orbitLines[i];
        if (line) {
            line.setAttribute('x1', String(orbitRound(cx, 1)));
            line.setAttribute('y1', String(orbitRound(cy, 1)));
            line.setAttribute('x2', String(orbitRound(cx + x, 1)));
            line.setAttribute('y2', String(orbitRound(cy + y, 1)));
            line.style.opacity = String(orbitRound((0.05 + 0.18 * depth) * e, 3));
        }
    }

    // Vệ tinh quay nhanh hơn ảnh 2,4 lần; giảm chuyển động thì đứng yên.
    layoutSatellites(orbitReduced() ? 0 : orbitRotation * 2.4);
}

function tickOrbit(now) {
    if (orbitPrevTime == null) orbitPrevTime = now;
    const dt = (now - orbitPrevTime) / 1000;
    orbitPrevTime = now;

    const reduce = orbitReduced();
    const { lite } = orbitDeviceTier();
    const speed = (2 * Math.PI) / (reduce ? ORBIT_PERIOD_REDUCED_S : ORBIT_PERIOD_S);
    const surge = lite || reduce ? 1 : ORBIT_SURGE_FACTOR;

    // Cứ 11s quỹ đạo lại lướt nhanh một nhịp rồi chậm lại, vào/ra theo đường
    // smoothstep. Đây là chi tiết giữ cho vòng quay khỏi ra cảm giác máy móc.
    orbitClock += dt;
    const phase = orbitClock % ORBIT_SURGE_EVERY_S;
    const t = phase / ORBIT_SURGE_DUR_S;
    const burst = phase < ORBIT_SURGE_DUR_S
        ? 1 + (surge - 1) * Math.sin(t * t * (3 - 2 * t) * Math.PI)
        : 1;

    // Và lúc vừa mở thì quay nhanh rồi lắng dần sau 2.2s, để cảnh "khởi động"
    // chứ không đứng sẵn ở tốc độ đều.
    orbitElapsed += dt;
    const spinUp = Math.min(1, orbitElapsed / ORBIT_SPINUP_S);
    const boost = reduce ? 1 : 1 + (1 - spinUp) * 1.6;

    orbitRotation += dt * speed * burst * boost * orbitSpeedFactor(now);
    layoutOrbit();
    if (orbitBrake && now - orbitBrake.start >= orbitBrake.dur) {
        // Phanh xong: dừng hẳn vòng rAF để nhường GPU cho cao trào.
        orbitBrake = null;
        orbitFrame = 0;
        orbitPrevTime = null;
        return;
    }
    orbitFrame = requestAnimationFrame(tickOrbit);
}

// Hệ số tốc độ quỹ đạo, luôn liên tục theo thời gian (không có bậc thang):
//   · chạm tim: 1 → 0.3 trong 25% đầu, rồi 0.3 → 1 trong 75% còn lại, cả
//     hai đoạn theo smoothstep (đạo hàm = 0 ở hai đầu, không có cú giật)
//   · phanh ở nhịp 3: nhân thêm (1 − q)², trượt êm về 0
const smoothstep = x => x * x * (3 - 2 * x);

function orbitSpeedFactor(now) {
    let factor = 1;
    const p = (now - heartSlowStart) / HEART_SLOW_MS;
    if (p >= 0 && p < 1) {
        const dip = p < 0.25 ? smoothstep(p / 0.25) : 1 - smoothstep((p - 0.25) / 0.75);
        factor -= 0.7 * dip;
    }
    if (orbitBrake) {
        const q = Math.min(1, (now - orbitBrake.start) / orbitBrake.dur);
        factor *= (1 - q) * (1 - q);
    }
    return factor;
}

function brakeOrbit(ms) {
    if (!orbitFrame || orbitReduced()) {
        stopOrbitLoop();
        return;
    }
    orbitBrake = { start: performance.now(), dur: ms };
}

function startOrbitLoop() {
    if (orbitFrame || !orbitOpen || document.hidden || isHeartBursting || orbitCardIndex >= 0 || document.getElementById('full-letter').classList.contains('is-open')) return;
    orbitPrevTime = null;
    orbitFrame = requestAnimationFrame(tickOrbit);
}

function stopOrbitLoop() {
    orbitBrake = null;
    if (!orbitFrame) return;
    cancelAnimationFrame(orbitFrame);
    orbitFrame = 0;
    orbitPrevTime = null;
}

// ---- MỞ / ĐÓNG ----
// mode:
//   'arrive' — đi tiếp từ màn 1 (rain.js, startRainExit): chỉ trời ngân
//              hà hiện ra; chòm sao màn 1 vẫn đang bay tới. Trái tim chỉ nở
//              khi script.js gọi beginOrbitArrival() lúc trao tay.
//   'bloom'  — mở orbit không qua màn 1: tim nở + ảnh bay
//              ra ngay, chòm sao tự vẽ lại từ mũi tim.
//   'plain'  — giảm chuyển động: hiện ra một lượt như bản cũ.
function openMemoryOrbit(options = {}) {
    const overlay = document.getElementById('memory-orbit');
    if (!overlay || orbitOpen) return;
    const mode = orbitReduced() ? 'plain' : (options.mode || 'bloom');

    buildOrbitScene();

    orbitOpen = true;
    // Chặn raycast: một cú chạm lọt qua sẽ mở popup đè lên chính màn orbit.
    isPopupOpen = true;
    // Dừng vòng rAF của Three.js — trừ khi đang đi tiếp từ màn 1: lúc đó đèn
    // lồng còn phải trôi cho cú "bay lên trời", script.js tự dừng khi trao tay.
    if (mode !== 'arrive') isPlaying = false;

    overlay.classList.add('is-open');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.remove('lantern-hover');

    const stage = overlay.querySelector('#orbit-stage');
    if (stage) {
        orbitStageSize = { w: stage.clientWidth, h: stage.clientHeight };
    }
    orbitHeartW = document.getElementById('heart-charge')?.offsetWidth || orbitHeartW;

    // Đặt vòng quay về mốc đầu để cú spin-up chạy lại mỗi lần mở.
    orbitElapsed = 0;
    orbitClock = 0;
    updateHeartCharge();

    if (mode === 'plain') {
        replayOrbitConstellation();
        layoutOrbit();
        if (heartCharge === HEART_TAP_TARGET && !isFinalLetterUnlocked) completeHeartCharge();
        if (!isHeartBursting) {
            startOrbitLoop();
            startHeartAmbient();
        }
        return;
    }

    orbitArrival = { t0: null, heartReady: false, anims: [], timer: null };
    overlay.classList.add('is-arriving');
    layoutOrbit();
    startOrbitLoop();
    if (mode === 'bloom') {
        replayOrbitConstellation();
        beginOrbitArrival();
    }
}

// ---- CẢNH "ĐẾN" CỦA MÀN 2 ----
// Mốc tính từ lúc trái tim bắt đầu nở (beginOrbitArrival). Tổng 1,5s.
const ARRIVAL = {
    tokenStart: 300, tokenStagger: 70, tokenDur: 750,  // ảnh bay từ tim ra quỹ đạo
    satStart: 450, satDur: 700,                        // tim vệ tinh hiện dần
    heartReady: 1250,                                  // từ đây chạm tim mới tính nhịp
    done: 1500
};
let orbitArrival = null;

// 0 → 1 cho một phần tử bắt đầu ở `delay`, kéo dài `dur` (ms). Ngoài cảnh đến
// luôn là 1; trong cảnh đến mà tim chưa nở thì là 0 (ảnh nằm gọn ở tâm, vô hình).
function arrivalProgress(delay, dur) {
    if (!orbitArrival) return 1;
    if (orbitArrival.t0 == null) return 0;
    return Math.min(1, Math.max(0, (performance.now() - orbitArrival.t0 - delay) / dur));
}

function easeOutBack(t) {
    const c1 = 1.25, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

// Trái tim nở ra từ tâm chòm sao: điểm sáng → tim phồng lên → hai vòng xung
// kích → vòng quỹ đạo tự vẽ → ảnh bay ra → chữ và gợi ý hiện cuối.
function beginOrbitArrival() {
    const overlay = document.getElementById('memory-orbit');
    if (!overlay || !orbitArrival || orbitArrival.t0 != null) return;
    orbitArrival.t0 = performance.now();
    // Cú spin-up 2,2s trùng đúng lúc ảnh bay ra.
    orbitElapsed = 0;
    overlay.classList.add('is-blooming');

    const heartBtn = document.getElementById('orbit-heart');
    const aura = overlay.querySelector('.ol-heart-aura');
    const track = anim => { orbitArrival.anims.push(anim); return anim; };

    if (heartBtn) {
        const r = heartBtn.getBoundingClientRect();
        if (typeof spawnConstellationFlash === 'function') {
            const flash = spawnConstellationFlash(r.left + r.width / 2, r.top + r.height * 0.5);
            flash.classList.add('is-small');
            setTimeout(() => flash.remove(), 900);
        }
        track(heartBtn.animate([
            { transform: 'scale(0.2)', opacity: 0 },
            { transform: 'scale(1.08)', opacity: 1, offset: 0.62 },
            { transform: 'scale(1)', opacity: 1 }
        ], { duration: 800, easing: 'cubic-bezier(.2, .9, .3, 1.1)', fill: 'both' }));
    }
    if (aura) {
        // WAAPI thắng animation inline ol-heart-glow trong lúc chạy, xong thì
        // animation cũ tự chạy tiếp.
        track(aura.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 900, easing: 'ease-out', fill: 'both' }));
    }
    const ring = document.getElementById('heart-charge');
    if (ring) {
        [150, 350].forEach(delay => {
            const node = document.createElement('span');
            node.className = 'ol-heart-effect ol-heart-pulse-ring';
            node.style.animationDelay = `${delay}ms`;
            ring.appendChild(node);
            setTimeout(() => node.remove(), delay + 1000);
        });
    }

    orbitArrival.timer = setTimeout(() => {
        if (orbitArrival) orbitArrival.heartReady = true;
    }, ARRIVAL.heartReady);
    orbitArrival.doneTimer = setTimeout(completeOrbitArrival, ARRIVAL.done);
}

function completeOrbitArrival() {
    const overlay = document.getElementById('memory-orbit');
    if (!orbitArrival) return;
    clearTimeout(orbitArrival.timer);
    clearTimeout(orbitArrival.doneTimer);
    // Trạng thái cuối của các animation trùng với trạng thái tự nhiên, nên
    // huỷ đi không gây giật.
    orbitArrival.anims.forEach(anim => anim.cancel());
    orbitArrival = null;
    overlay?.classList.remove('is-arriving', 'is-blooming');
    orbitTokens.forEach(token => token.classList.remove('is-ready'));
    layoutOrbit();
    if (heartCharge === HEART_TAP_TARGET && !isFinalLetterUnlocked) completeHeartCharge();
    else startHeartAmbient();
}

// Tua nhanh: người xem chạm màn hình trong lúc chuyển cảnh.
function finishOrbitArrival() {
    if (!orbitArrival) return;
    if (orbitArrival.t0 == null) beginOrbitArrival();
    orbitArrival.anims.forEach(anim => anim.finish());
    completeOrbitArrival();
}

// Đóng/reset giữa cảnh đến: gỡ sạch, không chạy nốt.
function cancelOrbitArrival() {
    if (!orbitArrival) return;
    clearTimeout(orbitArrival.timer);
    clearTimeout(orbitArrival.doneTimer);
    orbitArrival.anims.forEach(anim => anim.cancel());
    orbitArrival = null;
    document.getElementById('memory-orbit')?.classList.remove('is-arriving', 'is-blooming');
    orbitTokens.forEach(token => token.classList.remove('is-ready'));
}

function closeMemoryOrbit() {
    const overlay = document.getElementById('memory-orbit');
    if (!overlay || !orbitOpen) return;

    closeOrbitCard();
    cancelOrbitArrival();
    stopHeartAmbient(true);
    stopOrbitLoop();
    clearHeartEffects();
    isHeartBursting = false;
    // Trả camera và lớp tối của màn mưa về như trước cú chuyển cảnh.
    if (typeof restoreRainSky === 'function') restoreRainSky();

    orbitOpen = false;
    overlay.classList.remove('is-open');
    overlay.setAttribute('aria-hidden', 'true');

    isPopupOpen = false;
    // CHỈ bật lại cờ, KHÔNG gọi animate(). Hàm đó gọi requestAnimationFrame(animate)
    // vô điều kiện ngay dòng đầu, nên vòng lặp của nó chưa bao giờ dừng — nó chỉ
    // bỏ qua phần tính toán khi isPlaying false. Gọi lại là sinh thêm một vòng
    // rAF thứ hai chạy song song mãi mãi, và mỗi lần đóng orbit lại thêm một vòng.
    isPlaying = true;

    // Cùng cái bẫy mà closePopup() và closeFullLetter() đã dính: nút đóng nằm
    // trên overlay, overlay biến mất, cú click tiếp tục bubble lên window,
    // raycast trúng chiếc đèn nằm sau nút — và orbit mở lại ngay lập tức.
    lastClickTime = Date.now();
}

// ---- CARD LỜI NHẮN ----
function openOrbitCard(index) {
    if (isHeartBursting) return;
    const part = orbitMemories[index];
    const card = document.getElementById('orbit-card');
    const body = document.getElementById('orbit-card-body');
    if (!part || !card || !body) return;

    orbitCardIndex = index;
    // Dừng quỹ đạo khi đang đọc: ảnh vẫn bay sau lớp mờ chỉ tổ kéo mắt khỏi chữ.
    stopHeartAmbient(false);
    stopOrbitLoop();

    const label = escapeHtml(part.label || `Recuerdo ${index + 1}`);
    body.innerHTML = `
        <button type="button" class="ol-back" onclick="closeOrbitCard()">
            <span aria-hidden="true">‹</span> VOLVER
        </button>
        <div class="ol-card-paper">
            <p class="ol-card-eyebrow">${label}</p>
            ${buildPhotoMarkup(part)}
            <p class="ol-card-text">${escapeHtml(part.text)}</p>
        </div>
    `;

    card.classList.add('is-open');
    card.removeAttribute('data-closing');
    card.setAttribute('aria-hidden', 'false');

    const stage = document.getElementById('orbit-stage');
    if (stage) stage.classList.add('is-dimmed');
}

function closeOrbitCard() {
    const card = document.getElementById('orbit-card');
    if (!card || !card.classList.contains('is-open')) return;

    orbitCardIndex = -1;
    card.setAttribute('data-closing', 'true');
    card.setAttribute('aria-hidden', 'true');

    const stage = document.getElementById('orbit-stage');
    if (stage) stage.classList.remove('is-dimmed');

    // Giữ card lại đủ lâu cho animation thoát chạy hết rồi mới gỡ, đúng cách
    // bản gốc làm bằng state `closing`.
    setTimeout(() => {
        card.classList.remove('is-open');
        card.removeAttribute('data-closing');
        if (orbitOpen) {
            startOrbitLoop();
            syncHeartAmbientState();
        }
    }, ORBIT_CARD_CLOSE_MS);
}

// ---- BÀN PHÍM ----
document.addEventListener('keydown', event => {
    if (event.key === 'Tab' && document.getElementById('full-letter').classList.contains('is-open')) {
        const buttons = Array.from(document.querySelectorAll('#full-letter button'));
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (event.shiftKey && (document.activeElement === first || !buttons.includes(document.activeElement))) {
            event.preventDefault(); last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault(); first.focus();
        }
        return;
    }
    if (event.key !== 'Escape' || !orbitOpen) return;

    if (document.getElementById('full-letter').classList.contains('is-open')) {
        event.stopImmediatePropagation();
        closeFullLetter();
        return;
    }

    if (document.getElementById('orbit-card')?.classList.contains('is-open')) {
        closeOrbitCard();
    } else {
        closeMemoryOrbit();
    }
});

// ---- TIẾT KIỆM TÀI NGUYÊN ----
// Chuyển tab thì huỷ vòng rAF hẳn, quay lại thì chạy tiếp. Không làm thì quỹ
// đạo vẫn quay trong nền và pin vẫn tụt dù không ai nhìn.
document.addEventListener('visibilitychange', () => {
    if (!orbitOpen) return;

    if (document.hidden) {
        stopHeartAmbient(false);
        stopOrbitLoop();
    } else if (!document.getElementById('orbit-card')?.classList.contains('is-open')) {
        startOrbitLoop();
        syncHeartAmbientState();
    }
});

const orbitMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const handleOrbitMotionChange = () => syncHeartAmbientState();
if (typeof orbitMotionQuery.addEventListener === 'function') {
    orbitMotionQuery.addEventListener('change', handleOrbitMotionChange);
} else if (typeof orbitMotionQuery.addListener === 'function') {
    orbitMotionQuery.addListener(handleOrbitMotionChange);
}
