// ---- ĐỌC NỘI DUNG TỪ URL ----
// Cùng một trang deploy một lần có thể gửi cho nhiều người khác nhau, nội dung
// truyền qua URL. Hai cách:
//   1. Tham số thường:  ?name=...&text=câu 1,câu 2&music=...&image=...
//   2. Tham số c:       JSON mã hoá Base64 URL-safe — dùng khi thư dài hoặc có
//      dấu phẩy (cách 1 tách câu theo dấu phẩy nên không chứa được dấu phẩy).

// Giải mã tham số c đúng MỘT lần lúc nạp trang, thay vì giải mã lại ở mỗi lần
// đọc tham số như bản cũ.
function decodeUrlContent() {
  const encoded = new URLSearchParams(window.location.search).get("c");
  if (!encoded) return {};

  try {
    const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(decodeURIComponent(escape(atob(base64)))) || {};
  } catch (e) {
    console.error("Error al decodificar el parámetro c:", e);
    return {};
  }
}

const urlContent = decodeUrlContent();

// Khi mở bằng ?id=..., index.html đã tải cấu hình LoveGift trước khi nạp file
// này. Chuẩn hoá lời nhắn/ảnh về schema `letter` để các màn dùng chung dữ liệu.
const lovegiftConfig = window.LOVEGIFT_CONFIG || {};
const lovegiftImages = Array.isArray(lovegiftConfig.images) ? lovegiftConfig.images : [];
if (!Array.isArray(urlContent.letter) && Array.isArray(lovegiftConfig.messages) && lovegiftConfig.messages.length > 0) {
    // Lọc lời nhắn rỗng TRƯỚC khi ghép ảnh, để ảnh thứ i luôn đi với lời nhắn
    // thứ i — cùng thứ tự với orbitMemories bên dưới.
    urlContent.letter = lovegiftConfig.messages
        .map(text => String(text || '').trim())
        .filter(Boolean)
        .map((text, i) => ({
            text,
            photo: lovegiftImages[i] || lovegiftImages[0] || null,
            label: `Recuerdo ${i + 1}`
        }));
}
if (lovegiftConfig.music && !urlContent.music) urlContent.music = lovegiftConfig.music;
if (lovegiftConfig.color) document.documentElement.style.setProperty('--amber', String(lovegiftConfig.color));

// toName/fromName đi qua đúng hai tham số mà phần còn lại của file đã đọc sẵn
// (`name`, `from`), nên không phải sửa chỗ nào khác. Trim vì dữ liệu nhập tay
// hay dính khoảng trắng đầu/cuối (" be siu xink").
const cleanConfigText = value => String(value == null ? '' : value).trim();
if (lovegiftConfig.toName && !urlContent.name) urlContent.name = cleanConfigText(lovegiftConfig.toName);
if (lovegiftConfig.fromName && !urlContent.from) urlContent.from = cleanConfigText(lovegiftConfig.fromName);
if (lovegiftConfig.finalMessage || lovegiftImages.length > 0) {
    const final = urlContent.final && typeof urlContent.final === 'object' ? urlContent.final : {};
    if (!final.message && lovegiftConfig.finalMessage) final.message = cleanConfigText(lovegiftConfig.finalMessage);
    // Người gửi thường tải lên nhiều ảnh hơn số lời nhắn; tấm dư cuối cùng để
    // dành cho lá thư kết thay vì bỏ không.
    if (!final.photo && lovegiftImages.length > 0) final.photo = lovegiftImages[lovegiftImages.length - 1];
    urlContent.final = final;
}

function getUrlParameter(name) {
  if (urlContent[name]) return urlContent[name];

  const regularParam = new URLSearchParams(window.location.search).get(name);
  if (regularParam) return regularParam;

  if (name === "music") {
    return "https://cdn.shopify.com/s/files/1/0825/5904/1766/files/tiktok-music-1792228824610-wqwm9j.mp3?v=1792228828";
  }

  return null;
}

// ---- TRẠNG THÁI DÙNG CHUNG ----
// Cảnh Three.js của màn 1 do rain.js dựng. orbit.js ghi `isPlaying = false` để
// tắt phần tính toán của màn 1 khi trái tim ngân hà đã che kín màn hình.
let scene, camera, renderer;
let isPlaying = false;
// Có overlay (orbit, lá thư) đang che màn 1: cú giữ tay ở màn 1 phải bỏ qua.
let isPopupOpen = false;
// Mốc đóng overlay gần nhất: cú chạm vừa bấm nút đóng không được lọt xuống
// màn 1 và tính thành một lần giữ tay.
let lastClickTime = 0;
let preloadedPopupImages = [];

function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// ---- CHẶN NỘI DUNG ĐỘC HẠI TỪ URL ----
// Trang này SINH RA ĐỂ GỬI LINK: ai cũng có thể lấy link của bạn, gắn ?c= chứa
// payload rồi gửi tiếp cho người khác — và nó chạy trên đúng domain của bạn.
// Mà text/label/name/from đều được nhét vào innerHTML ở popup, lá thư và màn
// orbit, nên phải escape trước khi ghép chuỗi.
function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Ảnh nằm trong thuộc tính src, nên escape thôi chưa đủ: `javascript:` và
// `data:text/html` vẫn chạy được dù không có dấu nháy nào. Vì vậy duyệt theo
// danh sách TRẮNG — chỉ http/https và đường dẫn tương đối — thay vì đi chặn
// từng scheme xấu, vốn luôn sót.
function safePhotoUrl(value) {
    if (!value) return null;

    const url = String(value).trim();

    // Chỉ dò scheme trên một bản đã bỏ hết ký tự điều khiển và khoảng trắng:
    // `java\nscript:alert(1)` là cách né bộ lọc quen thuộc, trình duyệt vẫn đọc
    // ra `javascript:`. Nhưng GIÁ TRỊ TRẢ VỀ luôn là `url` gốc — trả về bản đã
    // rút gọn thì mọi tên file có khoảng trắng ("anh cua em.jpg") sẽ hỏng.
    const probe = url.replace(/[\u0000-\u0020]/g, '');

    if (/^(https?:)?\/\//i.test(probe)) return url;   // https://... hoặc //...
    if (/^\.{0,2}\//.test(probe)) return url;         // ./photos/... , ../ , /photos/...
    if (/^[^:?#\\]+\.(webp|jpe?g|png|gif|avif)$/i.test(probe)) return url; // anh.webp

    console.warn('Imagen omitida, esquema no válido:', url);
    return null;
}

// Detect if device is mobile
function isMobileDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
           ('ontouchstart' in window) || 
           (navigator.maxTouchPoints > 0);
}


// ---- NỘI DUNG: SÁU LỜI NHẮN NGẮN ----
// Bản cũ giữ lời chúc và ảnh ở hai mảng RỜI: chữ chạy tuần tự còn ảnh chọn ngẫu
// nhiên, nên câu chữ và tấm ảnh đi kèm chẳng liên quan gì tới nhau. Giờ mỗi lời
// nhắn là một object mang sẵn ảnh của nó, đi theo đúng thứ tự đã sắp.
//
// Mỗi lời nhắn giữ trong MỘT câu: nó hiện trên card của một tấm ảnh ở màn 2,
// phải đọc hết trong một nhịp thở. Chỗ để viết dài là lá thư cuối.
//
// `label` là câu chúc ngắn (tối đa 30 ký tự), hiện trên chip ảnh ở màn kết
// và dòng mở đầu trong popup. Giữ ngắn để chip đọc đủ trong hai dòng.
//
// Thứ tự sáu nhịp là có chủ đích, không phải sáu câu chúc rời: mở → hoài niệm →
// phố hội → KHOẢNG LẶNG → có em → lời hẹn. Nhịp chùng ở mảnh 4 là chỗ quan
// trọng nhất; một bộ toàn ngọt sẽ nhàm, phải có nhịp lặng thì mảnh cuối mới
// nặng. Thay nội dung thì nên giữ lại một nhịp như vậy.
const DEFAULT_LETTER = [
    {
        label: 'VIC PERSI',
        photo: './photos/picture.jpeg',
        text: 'Hecho por VIC PERSI.'
    },
    {
        label: 'echo por vic persi',
        photo: './photos/_ (8).jpeg',
        text: 'No se me dan las bonitas palabras, así que te envío todo un jardín que llevo en el corazón.'
    },
    {
        label: 'echo por vic persi',
        photo: './photos/_ (9).jpeg',
        text: 'Con solo una sonrisa tuya, mi día entero se ilumina.'
    },
    {
        label: 'echo por vic persi',
        photo: './photos/_ (10).jpeg',
        // Ảnh duy nhất chụp ban ngày -> cần hạ sáng bằng filter cho khỏi lạc tông
        daylight: true,
        text: 'Gracias por haber sido siempre dulce, fuerte y paciente conmigo.'
    },
    {
        label: 'echo por vic persi',
        photo: './photos/new.jpeg',
        text: 'Hoy y todos los días, siempre serás la mujer más hermosa a mis ojos.'
    },
    {
        label: 'echo por vic persi',
        photo: './photos/nêww.jpeg',
        text: 'Deseo que te canses menos, que vivas mucha alegría y que siempre puedas ser tú misma.'
    },
    {
        label: 'echo por vic persi',
        photo: "./photos/pain'.jpeg",
        text: 'El próximo año, y en los que vendrán, quiero seguir siendo quien te regala flores.'
    }
];

const customMusic = getUrlParameter("music");
const recipientName = getUrlParameter("name") || 'ti';
const senderName = getUrlParameter("from") || '';

// Pool ảnh dự phòng khi một `photo` load hỏng. MỌI file ở đây phải tồn tại
// thật: một fallback tự nó 404 thì còn tệ hơn là không có fallback.
const LOCAL_PHOTO_FALLBACKS = [
    './photos/picture.jpeg',
    './photos/_ (8).jpeg',
    './photos/_ (9).jpeg',
    './photos/_ (10).jpeg',
    './photos/new.jpeg',
    './photos/nêww.jpeg',
    "./photos/pain'.jpeg"
];

function pickFallbackPhoto(exclude = '') {
    const choices = LOCAL_PHOTO_FALLBACKS.filter(photo => photo !== exclude);
    return choices[Math.floor(Math.random() * choices.length)] || LOCAL_PHOTO_FALLBACKS[0];
}

function buildLetter() {
    // Dạng đầy đủ: mảng letter trong tham số c, mỗi phần tử {text, photo, label}
    if (Array.isArray(urlContent.letter) && urlContent.letter.length > 0) {
        const parts = urlContent.letter
            .filter(part => part && part.text)
            .map((part, i) => ({
                text: String(part.text),
                // label tuỳ chọn: link cũ gửi đi trước khi có trường này vẫn chạy,
                // chỉ là chip trên token hiện "Ký ức 1, 2, 3..." thay cho tên riêng
                label: part.label ? String(part.label) : `Recuerdo ${i + 1}`,
                photo: part.photo || null,
                daylight: Boolean(part.daylight)
            }));
        if (parts.length > 0) return parts;
    }

    // Dạng cũ vẫn chạy được: ?text=câu 1,câu 2 (+ ?image= dùng chung cho mọi đoạn)
    const customText = getUrlParameter("text");
    if (customText) {
        const sharedPhoto = getUrlParameter("image");
        const parts = String(customText)
            .split(',')
            .map(msg => msg.trim())
            .filter(msg => msg.length > 0)
            .map((text, i) => ({
                text,
                label: `Recuerdo ${i + 1}`,
                photo: sharedPhoto || null,
                daylight: false
            }));
        if (parts.length > 0) return parts;
    }

    return DEFAULT_LETTER;
}

const letter = buildLetter().map(part => ({
    ...part,
    photo: safePhotoUrl(part.photo) || pickFallbackPhoto()
}));

// Ảnh bay quanh trái tim ở màn 2. Người gửi hay tải NHIỀU ảnh nhưng chỉ viết
// ÍT lời nhắn; nếu mỗi lời nhắn chỉ một token thì các ảnh dư biến mất. Nên khi
// số ảnh nhiều hơn số lời nhắn, mỗi ảnh một token và lời nhắn được dùng lặp
// vòng. `letter` giữ nguyên để nhịp khám phá ở màn 1 không bị kéo dài.
const orbitMemories = (() => {
    const images = lovegiftImages.map(safePhotoUrl).filter(Boolean);
    if (images.length <= letter.length) return letter;
    return images.map((photo, i) => {
        const source = letter[i % letter.length];
        return {
            text: source.text,
            label: i < letter.length ? source.label : `Recuerdo ${i + 1}`,
            photo,
            daylight: i < letter.length ? source.daylight : false
        };
    });
})();
const finalInput = urlContent.final && typeof urlContent.final === 'object' ? urlContent.final : {};

// Lá thư kết (mở ra sau khi chạm đủ 3 lần vào trái tim ở màn Orbit) là LỜI KẾT
// ngắn gọn, không phải bản ghép lại toàn bộ các mảnh ký ức đã đọc — những mảnh
// đó đã có đất riêng của chúng ở các tấm ảnh trên quỹ đạo rồi. Một câu finalMessage
// từ LoveGift/API là đủ.
const DEFAULT_FINAL_MESSAGE = 'En este 20 de octubre, solo deseo que siempre te sientas querida y que sonrías muchísimas veces. Gracias por hacer que mis días normales se vuelvan especiales.';
const finalLetter = {
    title: String(finalInput.title || `Para ${recipientName}`),
    photo: safePhotoUrl(finalInput.photo) || [...letter].reverse().map(part => safePhotoUrl(part.photo)).find(Boolean) || null,
    message: String(finalInput.message || DEFAULT_FINAL_MESSAGE).trim(),
    sign: String(senderName || '').trim()
};

function hideLoading() {
    const loading = document.getElementById('loading');
    if (!loading || loading.dataset.hidden === '1') return;

    loading.dataset.hidden = '1';
    loading.style.opacity = '0';
    setTimeout(() => {
        loading.style.display = 'none';
    }, 400);

    const threeContainer = document.getElementById('three-container');
    if (threeContainer) {
        threeContainer.style.opacity = '1';
    }
}


function createStars() {
    const starsContainer = document.getElementById('stars');
    
    for (let i = 0; i < 200; i++) {
        const star = document.createElement('div');
        star.className = 'star';
        star.style.left = Math.random() * 100 + '%';
        star.style.top = Math.random() * 100 + '%';
        star.style.width = Math.random() * 3 + 1 + 'px';
        star.style.height = star.style.width;
        star.style.animationDelay = Math.random() * 2 + 's';
        starsContainer.appendChild(star);
    }
}

// Create shooting stars
function createShootingStars() {
    const shootingStarsContainer = document.getElementById('shooting-stars');
    if (!shootingStarsContainer) return;

    // Create multiple shooting stars with random positions and delays
    const numShootingStars = 20; // Increased number of shooting stars
    
    for (let i = 0; i < numShootingStars; i++) {
        const shootingStar = document.createElement('div');
        shootingStar.className = 'shooting-star';
        
        // Random starting positions (top-right area for diagonal movement)
        const startX = Math.random() * (window.innerWidth * 0.8) + (window.innerWidth * 0.2);
        const startY = Math.random() * (window.innerHeight * 0.3);
        
        shootingStar.style.left = startX + 'px';
        shootingStar.style.top = startY + 'px';
        
        // Random animation delay (0-10 seconds)
        const delay = Math.random() * 10;
        shootingStar.style.animationDelay = delay + 's';
        
        // Add some size variation
        const size = 3 + Math.random() * 3; // 3-6px
        shootingStar.style.width = size + 'px';
        shootingStar.style.height = size + 'px';
        
        shootingStarsContainer.appendChild(shootingStar);
    }
    
    console.log(`Created ${numShootingStars} shooting stars`);
}


function buildPhotoMarkup(part) {
    const photo = safePhotoUrl(part.photo);
    if (!photo) return '';

    const dayClass = part.daylight ? ' class="is-daylight"' : '';
    // onerror: link ảnh từ URL người dùng có thể hỏng, khi đó thay bằng một ảnh
    // trong pool dự phòng thay vì để lại ô xám trống giữa trang thư.
    //
    // Đường dẫn fallback đi qua `data-fallback` chứ KHÔNG nhúng thẳng vào chuỗi
    // JS trong onerror: escapeHtml đổi `'` thành `&#39;`, mà trình duyệt giải mã
    // character reference TRƯỚC khi biên dịch handler, nên `pain'.jpeg` sẽ làm
    // `this.src='./photos/pain'.jpeg'` vỡ cú pháp và fallback chết câm.
    return `<figure class="popup-photo">
                <img src="${escapeHtml(photo)}" alt=""${dayClass}
                     data-fallback="${escapeHtml(pickFallbackPhoto(photo))}"
                     onerror="this.onerror=null; this.src=this.dataset.fallback;">
            </figure>`;
}


// ---- HÌNH TRÁI TIM DÙNG CHUNG ----
// Trái tim là một CHÒM SAO GẤP KHÚC 14 đỉnh kiểu bản đồ tử vi. orbit.js dùng
// nó để vẽ chòm sao quanh tim ngân hà ở màn 2.
//
// Thứ tự đỉnh = thứ tự nét vẽ chạy: mũi tim → cạnh phải → thuỳ phải → hõm →
// thuỳ trái → cạnh trái → về mũi tim. Toạ độ chuẩn hoá 0–100 theo khung tim.
const HEART_CONSTELLATION = [
    [50.0, 100.0], // 0  mũi tim
    [63.1, 78.3],
    [84.0, 59.2],
    [100.0, 37.5], // 3  cạnh phải
    [100.0, 14.5],
    [83.8, 0.0],   // 5  đỉnh thuỳ phải
    [63.1, 1.3],
    [50.0, 15.8],  // 7  hõm giữa
    [36.9, 1.3],
    [16.2, 0.0],   // 9  đỉnh thuỳ trái
    [0.0, 14.5],
    [0.0, 37.5],   // 11 cạnh trái
    [16.0, 59.2],
    [36.9, 78.3]
];
// Tỉ lệ rộng/cao của chòm sao trong ảnh mẫu (420 × 392 px).

// Đường cong trái tim chuẩn (x = 16sin³t, y = 13cos t − 5cos2t − 2cos3t − cos4t)
// chuẩn hoá về cùng hệ 0–100 với HEART_CONSTELLATION: đỉnh thuỳ ở y ≈ 0, mũi
// tim ở y = 100. Dùng cho viền tim trơn mờ bao ngoài chòm sao và cho vành tim
// ở cao trào màn 2.
function heartCurveNormalized(t) {
    const x = 16 * Math.pow(Math.sin(t), 3);
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    return [((x + 16) / 32) * 100, ((11.8 - y) / 28.8) * 100];
}

function spawnConstellationFlash(x, y) {
    const flash = document.createElement('div');
    flash.className = 'constellation-flash';
    flash.style.left = `${x}px`;
    flash.style.top = `${y}px`;
    document.body.appendChild(flash);
    return flash;
}


// ---- LÁ THƯ HOÀN CHỈNH (màn kết) ----
// ---- CHỮ HIỆN DẦN TỪNG KÝ TỰ (lá thư cuối) ----
// Bản trước dùng một dải mask trượt ngang qua cả dòng — tính lại thì dòng chữ
// bị ẩn tiệt suốt gần nửa thời lượng đầu rồi mới lộ ra qua một dải mờ hẹp,
// không hề ra cảm giác "hiện từng chữ". Giờ MỖI KÝ TỰ là một span riêng, hiện
// lên tuần tự theo animation-delay — đúng nghĩa đen "từng chữ hiện một".
const HW_CHAR_STAGGER_MS = 34; // khoảng cách giữa hai ký tự hiện ra
const HW_LINE_GAP = 200;       // nhịp nhấc bút giữa hai dòng
const HW_MAX_TOTAL = 9000;     // trần tổng thời lượng, xem ghi chú ở startHandwriting
let handwritingTimer = null;

// Tách một khối chữ thành từng dòng, mỗi ký tự một span riêng để hiện lần
// lượt. Dấu cách giữ nguyên là text node thường (không bọc span) để trình
// duyệt vẫn có chỗ xuống dòng tự nhiên giữa các từ.
//
// `.hw-char` PHẢI là `display: inline` (không phải inline-block) — inline-block
// biến mỗi ký tự thành một "atomic inline", và CSS cho phép ngắt dòng ngay
// trước/sau MỌI atomic inline dù hai bên không hề có khoảng trắng. Bản đầu
// dùng inline-block (để dùng `transform: translateY` cho hiệu ứng nhấc chữ)
// nên chữ có thể xuống dòng giữa chừng một từ — đúng lỗi "xuống dòng linh
// tinh" thấy trên mobile. `display: inline` thường KHÔNG atomic nên chỉ ngắt
// được ở dấu cách thật, y hệt text thường; hiệu ứng nhấc chữ chuyển sang dùng
// `position: relative; top` — thuộc tính này áp dụng được cho inline thường,
// không cần inline-block như transform.
function buildHandwritingLines(el) {
    if (!el) return [];

    // Lần mở thứ hai, textContent đã là chữ ĐÃ tách dòng — các `\n` nằm giữa
    // những thẻ span nên đọc lại sẽ mất hết, cả đoạn dồn thành một dòng. Vì
    // vậy giữ nguyên văn bản gốc ngay lần đầu và luôn dựng lại từ nó.
    if (el.dataset.hwSource === undefined) el.dataset.hwSource = el.textContent;

    const lines = el.dataset.hwSource.split('\n').map(line => line.trim()).filter(Boolean);
    if (!lines.length) return [];

    el.textContent = '';
    return lines.map(line => {
        const wrap = document.createElement('span');
        wrap.className = 'hw-line';
        const charSpans = [];
        // Array.from thay vì duyệt theo index: giữ nguyên các ký tự có dấu tổ
        // hợp (nếu có) thành một khối, không cắt gãy giữa chữ cái và dấu.
        Array.from(line).forEach(ch => {
            if (ch === ' ') {
                wrap.appendChild(document.createTextNode(' '));
                return;
            }
            const span = document.createElement('span');
            span.className = 'hw-char';
            span.textContent = ch;
            wrap.appendChild(span);
            charSpans.push(span);
        });
        el.appendChild(wrap);
        return { node: wrap, charSpans };
    });
}

function startHandwriting(sheet) {
    if (!sheet || prefersReducedMotion()) return;

    let lines = [];
    // Chỉ viết tay phần chữ CỦA LÁ THƯ. `.full-letter-lead` là nhãn in hoa
    // giãn chữ — cho nó chạy nét bút thì lạc hẳn, cứ để nó nằm yên.
    [sheet.querySelector('.full-letter-title'), sheet.querySelector('.full-letter-final-message')]
        .forEach(el => { lines = lines.concat(buildHandwritingLines(el)); });
    if (!lines.length) return;

    // Thư tuỳ biến qua ?c= có thể rất dài; co khoảng cách giữa các ký tự lại
    // để người xem không phải ngồi đợi cả phút mới đọc hết.
    const totalChars = lines.reduce((sum, line) => sum + line.charSpans.length, 0);
    const rawTotal = totalChars * HW_CHAR_STAGGER_MS + lines.length * HW_LINE_GAP;
    const scale = rawTotal > HW_MAX_TOTAL ? HW_MAX_TOTAL / rawTotal : 1;
    const stagger = HW_CHAR_STAGGER_MS * scale;
    const lineGap = HW_LINE_GAP * scale;

    let at = 0;
    lines.forEach(line => {
        line.charSpans.forEach(span => {
            span.style.setProperty('--hw-char-delay', `${Math.round(at)}ms`);
            at += stagger;
        });
        at += lineGap;
    });

    sheet.classList.remove('is-written');
    // Cùng lý do như runHeartLightChase(): phải ép trình duyệt chốt style giữa
    // hai lần đổi class, không thì lần mở thứ hai gộp làm một và chữ hiện thẳng.
    void sheet.offsetWidth;
    sheet.classList.add('is-writing');

    clearTimeout(handwritingTimer);
    // +220ms: khớp thời lượng hwCharIn của CHÍNH ký tự cuối cùng (khai báo cố
    // định trong CSS), cộng thêm 150ms nghỉ trước khi khoá lại thành is-written.
    handwritingTimer = setTimeout(() => finishHandwriting(sheet), at + 220 + 150);
}

// Chạm vào thư là viết xong ngay. Người đọc lại lần hai không phải ngồi đợi.
function finishHandwriting(sheet) {
    if (!sheet) return;
    clearTimeout(handwritingTimer);
    handwritingTimer = null;
    sheet.classList.remove('is-writing');
    sheet.classList.add('is-written');
}

function openFullLetter() {
    if (typeof isFinalLetterUnlocked !== 'undefined' && !isFinalLetterUnlocked) return;
    const overlay = document.getElementById('full-letter');
    const sheet = document.getElementById('full-letter-sheet');
    if (!overlay || !sheet) return;
    if (typeof stopHeartAmbient === 'function') stopHeartAmbient(false);

    // Dựng một lần rồi dùng lại, tránh nạp lại toàn bộ ảnh mỗi lần mở
    if (!sheet.dataset.built) {
        // --i để CSS xếp độ trễ so le, từng đoạn dâng lên thay vì cả tờ bật ra
        // một lượt ngay sau chớp sáng.
        sheet.innerHTML = `
            <button class="final-letter-dismiss" type="button" onclick="closeFullLetter()" aria-label="Cerrar la carta">×</button>
            <div class="full-letter-title" tabindex="-1">${escapeHtml(finalLetter.title)}</div>
            <div class="full-letter-lead">Para ti, en este 20 de octubre</div>
            <div class="full-letter-final-photo">${buildPhotoMarkup(finalLetter)}</div>
            <div class="full-letter-final-message">${escapeHtml(finalLetter.message)}</div>
            ${finalLetter.sign ? `<div class="full-letter-sign">Con cariño,<strong>${escapeHtml(finalLetter.sign)}</strong></div>` : ''}
            <button class="full-letter-close" type="button" onclick="closeFullLetter()">Cerrar la carta</button>
        `;
        sheet.dataset.built = '1';

        // Chạm vào tờ thư để viết xong ngay. Gắn ở giai đoạn capture và bỏ qua
        // khi bấm trúng nút, để cú chạm "bỏ qua" không nuốt mất nút Đóng.
        sheet.addEventListener('click', event => {
            if (event.target.closest('button')) return;
            if (sheet.classList.contains('is-writing')) finishHandwriting(sheet);
        });
    }

    isPopupOpen = true; // chặn cú giữ tay ở màn 1 khi lá thư đang mở
    if (typeof stopOrbitLoop === 'function') stopOrbitLoop();
    const heartRect = document.getElementById('orbit-heart')?.getBoundingClientRect();
    if (heartRect) sheet.style.transformOrigin = `${heartRect.left + heartRect.width / 2 - sheet.getBoundingClientRect().left}px ${heartRect.top + heartRect.height / 2}px`;
    const orbitOverlay = document.getElementById('memory-orbit');
    if (orbitOverlay) orbitOverlay.inert = true;
    overlay.classList.add('is-open');
    overlay.setAttribute('aria-hidden', 'false');
    overlay.scrollTop = 0;
    document.body.classList.remove('lantern-hover');
    sheet.querySelector('.full-letter-title').focus({ preventScroll: true });

    // Chờ hết finalLetterBloom (600ms) rồi mới đặt bút: tờ thư đang phóng to
    // từ tâm trái tim mà chữ đã chạy thì hai chuyển động giẫm lên nhau.
    clearTimeout(handwritingTimer);
    handwritingTimer = setTimeout(() => startHandwriting(sheet), prefersReducedMotion() ? 0 : 620);
}

function closeFullLetter() {
    const overlay = document.getElementById('full-letter');
    if (!overlay) return;

    overlay.classList.remove('is-open');
    overlay.setAttribute('aria-hidden', 'true');
    // Đóng giữa chừng: huỷ luôn lượt viết đang chờ, không thì nó nổ sau khi
    // thư đã khuất và lần mở sau bị cắt ngang giữa dòng.
    clearTimeout(handwritingTimer);
    handwritingTimer = null;
    document.getElementById('full-letter-sheet')?.classList.remove('is-writing', 'is-written');
    const orbitOverlay = document.getElementById('memory-orbit');
    if (orbitOverlay) orbitOverlay.inert = false;
    if (typeof orbitOpen !== 'undefined' && orbitOpen) {
        // Cao trào để sân khấu orbit ở trạng thái đã zoom vào tim; lùi lại.
        if (typeof resetOrbitZoom === 'function') resetOrbitZoom();
        startOrbitLoop();
        if (typeof syncHeartAmbientState === 'function') syncHeartAmbientState();
        document.getElementById('orbit-heart')?.focus({ preventScroll: true });
    }

    // Lá thư được mở TỪ TRONG orbit (chạm trái tim ở giữa quỹ đạo). Đóng nó thì
    // người xem rơi trở lại màn orbit, chứ chưa về màn mưa — nên khoá
    // cú giữ tay phải giữ nguyên, không được mở ra ở đây.
    if (typeof orbitOpen === 'undefined' || !orbitOpen) {
        isPopupOpen = false;
    }

    // Cùng lý do như handleClickOutside: chặn cú click này bubble lên window
    // rồi lập tức mở lại lá thư
    lastClickTime = Date.now();

}


// Global variable to track music state
let isMusicPlaying = false;
let musicToggleButton = null;

// Biểu tượng loa. Bản cũ dán lặp đoạn SVG này ở 5 chỗ khác nhau, mỗi chỗ lệch
// nhau một chút -> gom về một nguồn duy nhất.
function speakerIcon(isOn) {
    const waves = isOn
        ? `<path d="M15.54 8.46C16.4774 9.39764 17.0039 10.6692 17.0039 11.995C17.0039 13.3208 16.4774 14.5924 15.54 15.53M19.07 4.93C20.9447 6.80528 21.9979 9.34836 21.9979 12C21.9979 14.6516 20.9447 17.1947 19.07 19.07" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation: soundWave 1.5s ease-in-out infinite"/>`
        : `<line x1="23" y1="9" x2="17" y2="15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
           <line x1="17" y1="9" x2="23" y2="15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`;

    return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M11 5L6 9H2V15H6L11 19V5Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                ${waves}
            </svg>`;
}

// Đổi hình nút loa theo trạng thái. Màu nền để CSS lo, JS không gán inline nữa
// (bản cũ gán thẳng gradient đỏ vào style nên đè mất màu trong bảng màu mới).
function updateMusicButton(state) {
    if (!musicToggleButton) return;

    musicToggleButton.innerHTML = speakerIcon(state === 'on');
    musicToggleButton.classList.toggle('is-muted', state !== 'on');
    musicToggleButton.setAttribute(
        'aria-label',
        state === 'on' ? 'Silenciar música' : 'Activar música'
    );
}

// Phát nhạc nền. Dùng chung cho nút loa VÀ cú chạm màn hình đầu tiên
// (primeAutoplayOnFirstTouch) — cả hai đều là user gesture hợp lệ để trình
// duyệt cho phép phát audio có tiếng.
function playBackgroundMusic() {
    const audio = document.getElementById('backgroundMusic');
    if (!audio) return Promise.reject(new Error('no audio element'));

    // Bài hát tuỳ chỉnh (LoveGift hoặc ?music=) chỉ nạp vào audio Ở ĐÂY, lúc
    // đã có gesture — nạp sớm hơn thì thiếu user gesture, trình duyệt chặn
    // autoplay. Bản cũ có playBackgroundMusic() làm việc này nhưng không hàm
    // nào gọi nó, nên nút loa luôn phát nhạc mặc định hard code trong thẻ
    // <audio>, dù link đã kèm nhạc riêng.
    if (customMusic && audio.dataset.customSrcApplied !== '1') {
        audio.src = customMusic;
        audio.load();
        audio.dataset.customSrcApplied = '1';
    }

    audio.muted = false;
    audio.volume = 0.3;
    return audio.play().then(() => {
        isMusicPlaying = true;
        updateMusicButton('on');
    });
}

// Create persistent music toggle button
function createMusicToggleButton() {
    if (musicToggleButton) return; // Already exists

    const button = document.createElement('button');
    button.className = 'music-toggle-button';
    button.innerHTML = speakerIcon(false);
    button.setAttribute('aria-label', 'Activar música');
    // Toàn bộ style/keyframes/hover nằm trong index.html để media query mobile
    // (chuyển nút xuống góc dưới phải) có thể áp dụng được

    const toggleMusic = (e) => {
        e.preventDefault();
        e.stopPropagation();

        // Người dùng đã chú ý tới nút rồi, không cần nhấp nháy nữa
        button.classList.add('is-settled');

        const audio = document.getElementById('backgroundMusic');
        if (!audio) return;

        if (isMusicPlaying) {
            audio.pause();
            isMusicPlaying = false;
            updateMusicButton('off');
            return;
        }

        playBackgroundMusic().catch(error => {
            console.log('No se pudo reproducir la música:', error);
            isMusicPlaying = false;
            updateMusicButton('off');
        });
    };

    button.addEventListener('click', toggleMusic);
    // touchend cùng với click sẽ khiến một cú chạm trên mobile chạy toggle HAI
    // lần (bật rồi tắt ngay). Chỉ gắn touchend khi đúng là thiết bị cảm ứng, và
    // toggleMusic đã preventDefault nên trình duyệt không bắn thêm click giả.
    if (isMobileDevice()) {
        button.addEventListener('touchend', toggleMusic);
    }

    document.body.appendChild(button);
    musicToggleButton = button;
}

// Cú chạm/click ĐẦU TIÊN ở bất kỳ đâu trên trang (cú giữ tay ở màn mưa,
// nút loa, v.v.) cũng là một user gesture hợp lệ — tận dụng nó để tự phát nhạc,
// khỏi bắt người xem phải tìm đúng nút loa trước. 'touchend' và 'click' đều
// gắn vì cùng một cú chạm trên mobile bắn cả hai; cờ musicAutoplayAttempted
// chặn gọi audio.play() hai lần cho một lượt chạm (isMusicPlaying chỉ được
// set SAU khi promise play() resolve, nên không đủ nhanh để tự chặn).
let musicAutoplayAttempted = false;
function primeAutoplayOnFirstTouch() {
    const tryStart = () => {
        if (musicAutoplayAttempted || isMusicPlaying) return;
        musicAutoplayAttempted = true;
        playBackgroundMusic().catch(() => {
            // Trình duyệt vẫn từ chối (hiếm) — nút loa còn đó để bấm tay, và
            // cho phép lượt chạm sau thử lại.
            musicAutoplayAttempted = false;
        });
    };
    window.addEventListener('touchend', tryStart, { once: true, passive: true });
    window.addEventListener('click', tryStart, { once: true });
}
