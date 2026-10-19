// ==================================================================
// MÀN MỞ ĐẦU — "Đóa hồng hé nở" (plan-07 §0)
// Nụ hồng neon thở nhẹ trên nền đen. Chạm → nhạc vào, hồng nở bừng, cánh hoa
// tung lên rồi rơi xuống, cơn mưa lời yêu đổ ào từ trên theo. Cú chạm này cũng
// là user gesture hợp lệ để phát nhạc có tiếng ngay từ giây đầu.
// ==================================================================

const INTRO = {
    bloom: 1900,       // ms: hồng nở hết (vòng ngoài nở trước, vòng trong sau)
    burst: 1250,       // cánh hoa tung lên
    roseOut: 1950,     // hồng mờ dần, mưa bắt đầu đổ
    bgOut: 2200,       // nền đen của màn mở đầu tan, lộ cơn mưa
    unlock: 3700,      // cho phép giữ tay gom yêu thương
    hint: 4700,        // hiện gợi ý "chạm & giữ"
    done: 5500,        // gỡ hẳn màn mở đầu
    petals: 30
};

// ---- BÔNG HỒNG 3D ----
// Mỗi cánh là một mặt cong: khum ngang vào tâm, mép trên cuộn ra ngoài, dán ảnh
// chụp cánh hồng thật và nhận ánh sáng — chính phần đổ bóng trên mặt cong làm
// hoa trông như thật. 5 vòng cánh xoắn ốc; độ ngả của từng vòng nội suy giữa
// "nụ" và "nở" theo một tham số open (0 → 1).
const ROSE_RINGS = [
    // n cánh, rộng, cao, bán kính gốc, độ ngả lúc nụ / lúc nở (rad), khum, cuộn
    { n: 3, w: 0.95, h: 1.05, r: 0.04, bud: 0.02, open: 0.20, cup: 0.42, curl: 0.10 },
    { n: 4, w: 1.15, h: 1.22, r: 0.10, bud: 0.05, open: 0.38, cup: 0.40, curl: 0.18 },
    { n: 5, w: 1.38, h: 1.40, r: 0.17, bud: 0.09, open: 0.58, cup: 0.36, curl: 0.28 },
    { n: 6, w: 1.62, h: 1.55, r: 0.25, bud: 0.15, open: 0.78, cup: 0.32, curl: 0.38 },
    { n: 7, w: 1.85, h: 1.66, r: 0.33, bud: 0.24, open: 0.98, cup: 0.28, curl: 0.46 }
];

let introRose = null;

// ---- CÁNH HOA TÔNG VINTAGE ----
// Ảnh gốc là cánh hồng đỏ. Đổi màu ngay trong trình duyệt: lấy độ sáng từng
// điểm ảnh (giữ nguyên vân cánh và chỗ sáng tối) rồi tô lại theo dải màu hồng
// phấn – blush – kem, giống tông mận–đào của màn 2.
const INTRO_PETAL_RAMP = [
    [0.0, [192, 132, 136]],    // hồng mận nhạt ở chỗ tối
    [0.5, [236, 186, 180]],    // blush
    [0.8, [242, 214, 200]],    // hồng kem
    [1.0, [253, 243, 232]]     // kem sáng ở gốc cánh
];
const introPetalCanvases = {};
const introPetalUrls = {};

function rampColor(t) {
    for (let i = 1; i < INTRO_PETAL_RAMP.length; i++) {
        const [t1, c1] = INTRO_PETAL_RAMP[i];
        const [t0, c0] = INTRO_PETAL_RAMP[i - 1];
        if (t <= t1) {
            const f = (t - t0) / (t1 - t0);
            return [0, 1, 2].map(j => c0[j] + (c1[j] - c0[j]) * f);
        }
    }
    return INTRO_PETAL_RAMP[INTRO_PETAL_RAMP.length - 1][1];
}

function introPetalCanvas(name) {
    if (!introPetalCanvases[name]) {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 256;
        introPetalCanvases[name] = canvas;
    }
    return introPetalCanvases[name];
}

function introPetalUrl(name) {
    return introPetalUrls[name] || `./assets/intro/${name}.webp`;
}

const introPetalReady = Promise.all(['petal', 'petal-b'].map(name => new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
        const canvas = introPetalCanvas(name);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const px = data.data;
        for (let i = 0; i < px.length; i += 4) {
            if (!px[i + 3]) continue;
            // Cánh đỏ: kênh đỏ mang vân, kênh xanh lá sáng lên ở chỗ trắng gần gốc.
            const r = px[i] / 255;
            const g = px[i + 1] / 255;
            const t = Math.min(1, Math.max(0, (r - 0.42) / 0.58 * 0.75 + g * 0.6));
            const [cr, cg, cb] = rampColor(t);
            px[i] = cr; px[i + 1] = cg; px[i + 2] = cb;
        }
        ctx.putImageData(data, 0, 0);
        try { introPetalUrls[name] = canvas.toDataURL('image/png'); } catch (e) { /* file:// */ }
        resolve();
    };
    img.onerror = resolve;
    img.src = `./assets/intro/${name}.webp`;
})));

function makePetalGeometry(w, h, cup, curl) {
    const geo = new THREE.PlaneGeometry(w, h, 12, 14);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i) + h / 2;          // gốc cánh ở y = 0
        const u = x / (w / 2);                  // -1 … 1 theo bề ngang
        const v = y / h;                        // 0 … 1 từ gốc lên mép
        // Khum: hai mép ôm vào tâm hoa (−z), khum mạnh dần lên phía trên.
        let z = -cup * u * u * (0.35 + 0.65 * v);
        // Mép trên cuộn ngược ra ngoài (+z), và hơi gợn.
        const t = Math.max(0, v - 0.55) / 0.45;
        z += curl * t * t * (1 + 0.25 * Math.sin(u * 3.1));
        // Gốc cánh thót lại cho liền vào đài hoa.
        pos.setXYZ(i, x * (0.55 + 0.45 * Math.sqrt(v)), y, z);
    }
    geo.computeVertexNormals();
    return geo;
}

// Lá hồng: hình bầu dục nhọn đầu, gập nhẹ theo gân giữa, chóp hơi cong xuống.
function makeLeafGeometry(w, h) {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.bezierCurveTo(w * 0.55, h * 0.18, w * 0.6, h * 0.62, 0, h);
    shape.bezierCurveTo(-w * 0.6, h * 0.62, -w * 0.55, h * 0.18, 0, 0);
    const geo = new THREE.ShapeGeometry(shape, 16);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const v = y / h;
        pos.setZ(i, Math.abs(x) * 0.45 - 0.18 * v * v);
    }
    geo.computeVertexNormals();
    return geo;
}

function createIntroRose(canvas) {
    if (typeof THREE === 'undefined' || !canvas) return null;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let renderer;
    try {
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    } catch (e) {
        return null;
    }
    renderer.setPixelRatio(dpr);
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, canvas.clientWidth / canvas.clientHeight, 0.1, 100);
    // Khung dọc: hoa ở phần trên, thân dài chạy xuống gần đáy khung.
    camera.position.set(0, 3.4, 13);
    camera.lookAt(0, -1.9, 0);

    // Đèn chính ấm từ trên-trái, đèn viền hồng phía sau để mép cánh sáng lên.
    scene.add(new THREE.HemisphereLight(0xfff2e6, 0x8a6070, 0.85));
    const key = new THREE.DirectionalLight(0xfff1e2, 1.2);
    key.position.set(-3, 6, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xffd2b8, 0.7);
    rim.position.set(2.5, 2, -5);
    scene.add(rim);

    const texA = new THREE.CanvasTexture(introPetalCanvas('petal'));
    const texB = new THREE.CanvasTexture(introPetalCanvas('petal-b'));
    [texA, texB].forEach(tex => { tex.encoding = THREE.sRGBEncoding; tex.anisotropy = 4; });
    // Ảnh cánh nạp xong (và đã đổi sang tông vintage) thì báo texture cập nhật.
    introPetalReady.then(() => { texA.needsUpdate = true; texB.needsUpdate = true; });

    const flower = new THREE.Group();
    flower.position.y = 0.2;
    scene.add(flower);

    const petals = [];
    ROSE_RINGS.forEach((ring, k) => {
        const geo = makePetalGeometry(ring.w, ring.h, ring.cup, ring.curl);
        const mat = new THREE.MeshStandardMaterial({
            map: k < 2 ? texB : texA,
            color: new THREE.Color().setHSL(0.02, 0.3, 0.9 + 0.025 * k),
            roughness: 0.62,
            metalness: 0,
            side: THREE.DoubleSide,
            alphaTest: 0.45
        });
        for (let i = 0; i < ring.n; i++) {
            const angle = (Math.PI * 2 * i) / ring.n + k * 0.62 + (i % 2 ? 0.08 : -0.05);
            const pivot = new THREE.Object3D();
            pivot.rotation.y = angle;
            const holder = new THREE.Object3D();
            holder.position.z = ring.r;
            holder.position.y = -0.05 * k;
            const mesh = new THREE.Mesh(geo, mat);
            // Mỗi cánh xoay lệch một chút quanh trục dọc cho bớt đều như máy.
            mesh.rotation.y = (i % 2 ? 1 : -1) * 0.12;
            holder.add(mesh);
            pivot.add(holder);
            flower.add(pivot);
            petals.push({ holder, ring, k, jitter: (Math.sin(i * 12.9 + k * 7.1) * 0.5) * 0.08 });
        }
    });

    // Đài hoa xanh dưới cùng + cuống.
    const green = new THREE.MeshStandardMaterial({ color: 0x5d7356, roughness: 0.85, side: THREE.DoubleSide });
    const sepalGeo = makePetalGeometry(0.28, 0.75, 0.08, 0.2);
    for (let i = 0; i < 5; i++) {
        const pivot = new THREE.Object3D();
        pivot.rotation.y = (Math.PI * 2 * i) / 5 + 0.3;
        const holder = new THREE.Object3D();
        holder.position.set(0, -0.14, 0.12);
        holder.rotation.x = 2.2;
        holder.add(new THREE.Mesh(sepalGeo, green));
        pivot.add(holder);
        flower.add(pivot);
    }
    // Thân dài, cong chữ S rất nhẹ, có hai lá và vài gai.
    const stemCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, -0.1, 0),
        new THREE.Vector3(0.06, -1.5, 0.04),
        new THREE.Vector3(-0.1, -3.2, 0.08),
        new THREE.Vector3(0.04, -5.0, 0.02),
        new THREE.Vector3(-0.02, -6.6, 0)
    ]);
    const stemMat = new THREE.MeshStandardMaterial({ color: 0x55694d, roughness: 0.8 });
    flower.add(new THREE.Mesh(new THREE.TubeGeometry(stemCurve, 64, 0.075, 10, false), stemMat));

    const leafMat = new THREE.MeshStandardMaterial({ color: 0x6f8766, roughness: 0.65, side: THREE.DoubleSide });
    const leafGeo = makeLeafGeometry(0.62, 1.25);
    [
        { t: 0.36, side: 1, yaw: 0.5, scale: 1 },
        { t: 0.6, side: -1, yaw: -2.4, scale: 0.85 }
    ].forEach(leaf => {
        const at = stemCurve.getPointAt(leaf.t);
        const holder = new THREE.Object3D();
        holder.position.copy(at);
        holder.rotation.y = leaf.yaw;
        const mesh = new THREE.Mesh(leafGeo, leafMat);
        // Lá chĩa chéo lên, ngả ra ngoài thân.
        mesh.rotation.z = -leaf.side * 0.95;
        mesh.rotation.x = 0.35;
        mesh.scale.setScalar(leaf.scale);
        holder.add(mesh);
        flower.add(holder);
    });

    const thornGeo = new THREE.ConeGeometry(0.035, 0.16, 6);
    [0.2, 0.47, 0.72, 0.85].forEach((t, i) => {
        const thorn = new THREE.Mesh(thornGeo, stemMat);
        thorn.position.copy(stemCurve.getPointAt(t));
        thorn.rotation.set(0.4, i * 2.1, (i % 2 ? 1 : -1) * 1.9);
        flower.add(thorn);
    });

    const state = {
        renderer, scene, camera, flower, petals,
        open: 0, openFrom: 0, openStart: 0, opening: false,
        start: performance.now(), raf: 0, stopped: false,
        w: canvas.clientWidth, h: canvas.clientHeight
    };

    const ease = t => 1 - Math.pow(1 - t, 3);
    const frame = now => {
        if (state.stopped) return;
        const t = (now - state.start) / 1000;
        let base;
        if (state.opening) {
            base = Math.min(1, (now - state.openStart) / INTRO.bloom);
        } else {
            // Nụ "thở": hé ra rất khẽ rồi khép lại.
            base = 0.06 + 0.04 * Math.sin(t * 1.9);
        }
        state.petals.forEach(p => {
            // Vòng ngoài nở trước, vòng trong theo sau.
            const lag = (4 - p.k) * 0.09;
            const o = state.opening
                ? state.openFrom + (1 - state.openFrom) * ease(Math.max(0, Math.min(1, (base - lag) / 0.64)))
                : base;
            p.holder.rotation.x = p.ring.bud + (p.ring.open - p.ring.bud) * o + p.jitter;
        });
        // Khung canvas đổi cỡ (xoay máy, media query) thì vẽ lại theo cỡ mới.
        if (canvas.clientWidth !== state.w || canvas.clientHeight !== state.h) {
            state.w = canvas.clientWidth;
            state.h = canvas.clientHeight;
            renderer.setSize(state.w, state.h, false);
            camera.aspect = state.w / state.h;
            camera.updateProjectionMatrix();
        }
        flower.rotation.y = t * 0.22;
        flower.rotation.z = Math.sin(t * 0.8) * 0.03;
        renderer.render(scene, camera);
        state.raf = requestAnimationFrame(frame);
    };
    state.raf = requestAnimationFrame(frame);
    requestAnimationFrame(() => canvas.classList.add('is-shown'));
    return state;
}

function buildIntroDust() {
    const layer = document.getElementById('intro-dust');
    if (!layer || introReducedMotion()) return;
    let html = '';
    for (let i = 0; i < 26; i++) {
        // Dồn quanh vùng giữa, nơi hoa đứng dưới luồng đèn.
        const x = 50 + (Math.random() - 0.5) * 70;
        const y = 15 + Math.random() * 70;
        html += `<i style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%;` +
            `--d:${(7 + Math.random() * 6).toFixed(1)}s;--delay:${(-Math.random() * 10).toFixed(1)}s;` +
            `--dx:${Math.round((Math.random() - 0.5) * 40)}px;--o:${(0.35 + Math.random() * 0.5).toFixed(2)};` +
            `transform:scale(${(0.5 + Math.random() * 0.8).toFixed(2)})"></i>`;
    }
    layer.innerHTML = html;
}

function bloomIntroRose() {
    if (!introRose) return;
    introRose.openFrom = 0.08;
    introRose.openStart = performance.now();
    introRose.opening = true;
}

function disposeIntroRose() {
    if (!introRose) return;
    introRose.stopped = true;
    cancelAnimationFrame(introRose.raf);
    introRose.scene.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
            if (obj.material.map) obj.material.map.dispose();
            obj.material.dispose();
        }
    });
    introRose.renderer.dispose();
    introRose = null;
}

let introStarted = false;

function introReducedMotion() {
    return typeof prefersReducedMotion === 'function' && prefersReducedMotion();
}

function setupIntro() {
    const intro = document.getElementById('intro');
    if (!intro) return;

    introRose = createIntroRose(document.getElementById('intro-rose-canvas'));
    buildIntroDust();

    const button = document.getElementById('intro-btn');
    const markReady = () => {
        intro.classList.add('is-ready');
        if (button) {
            button.disabled = false;
            button.textContent = 'Toca para abrir el regalo ♡';
        }
    };
    if (window.rainReady) markReady();
    else document.addEventListener('rain:ready', markReady, { once: true });

    // Chạm bất kỳ đâu trên màn mở đầu cũng mở quà, không bắt nhắm đúng nút.
    intro.addEventListener('click', () => {
        if (window.rainReady) openIntro(intro);
    });
}

function openIntro(intro) {
    if (introStarted) return;
    introStarted = true;

    if (typeof playBackgroundMusic === 'function') {
        musicAutoplayAttempted = true;
        playBackgroundMusic().catch(() => { musicAutoplayAttempted = false; });
    }

    const at = (ms, fn) => setTimeout(fn, ms);

    if (introReducedMotion()) {
        intro.classList.add('is-opening', 'is-leaving');
        at(600, () => finishIntro(intro));
        return;
    }

    intro.classList.add('is-opening');
    bloomIntroRose();
    at(INTRO.burst, () => burstIntroPetals(intro));
    at(INTRO.roseOut, () => {
        intro.classList.add('is-rose-out');
        if (typeof rainPourIn === 'function') rainPourIn();
    });
    at(INTRO.bgOut, () => intro.classList.add('is-leaving'));
    at(INTRO.unlock, () => document.body.classList.remove('intro-open'));
    at(INTRO.hint, () => { if (typeof setHintVisible === 'function') setHintVisible(true); });
    at(INTRO.done, () => { disposeIntroRose(); intro.remove(); });
}

function finishIntro(intro) {
    document.body.classList.remove('intro-open');
    if (typeof setHintVisible === 'function') setHintVisible(true);
    disposeIntroRose();
    intro.remove();
}

// Cánh hoa bung ra từ tâm đóa hồng: vọt lên (chậm dần) rồi rơi (nhanh dần),
// vừa rơi vừa lắc và lật. Web Animations cho phép mỗi chặng một easing riêng.
function burstIntroPetals(intro) {
    const layer = intro.querySelector('.intro-petals');
    const rose = intro.querySelector('.intro-rose-canvas');
    if (!layer || !rose) return;

    const r = rose.getBoundingClientRect();
    const x0 = r.left + r.width / 2;
    const y0 = r.top + r.height * 0.24;
    const H = window.innerHeight;
    const W = window.innerWidth;

    for (let i = 0; i < INTRO.petals; i++) {
        const el = document.createElement('span');
        // Cùng ảnh cánh hồng thật với bông hoa, sáng tối khác nhau cho có chiều sâu.
        const size = 16 + Math.random() * 18;
        el.className = 'intro-petal';
        el.style.width = `${size}px`;
        el.style.height = `${size}px`;
        el.style.backgroundImage = `url(${introPetalUrl(i % 3 ? 'petal' : 'petal-b')})`;
        el.style.filter = `brightness(${(0.8 + Math.random() * 0.35).toFixed(2)})`;
        layer.appendChild(el);

        // Tỏa ra hình quạt hướng lên, rộng theo bề ngang màn hình.
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.1;
        const reach = 90 + Math.random() * Math.min(W, H) * 0.35;
        const peakX = x0 + Math.cos(angle) * reach;
        const peakY = y0 + Math.sin(angle) * reach;
        const endX = peakX + (Math.random() - 0.3) * W * 0.25;
        const sway = (Math.random() < 0.5 ? -1 : 1) * (20 + Math.random() * 30);
        const spin = (Math.random() < 0.5 ? -1 : 1) * (360 + Math.random() * 540);
        const dur = 2600 + Math.random() * 1400;
        const p = (x, y, rot, tilt, s) =>
            `translate3d(${x - size / 2}px, ${y - size / 2}px, 0) rotate(${rot}deg) rotateX(${tilt}deg) scale(${s})`;

        el.animate([
            { transform: p(x0, y0, 0, 0, 0.3), opacity: 0, easing: 'cubic-bezier(0.15, 0.8, 0.3, 1)' },
            { transform: p(peakX, peakY, spin * 0.25, 40, 1), opacity: 1, offset: 0.24, easing: 'cubic-bezier(0.45, 0, 0.75, 0.6)' },
            { transform: p((peakX + endX) / 2 + sway, (peakY + H) / 2, spin * 0.6, -30, 1), opacity: 1, offset: 0.62, easing: 'cubic-bezier(0.4, 0, 0.8, 0.8)' },
            { transform: p(endX - sway, H + 40, spin, 50, 0.9), opacity: 0.85 }
        ], { duration: dur, delay: Math.random() * 180, fill: 'both' });
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupIntro, { once: true });
} else {
    setupIntro();
}
