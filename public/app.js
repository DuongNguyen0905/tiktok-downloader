const urlInput = document.getElementById("url-input");
const fetchBtn = document.getElementById("fetch-btn");
const pasteBtn = document.getElementById("paste-btn");
const resetBtn = document.getElementById("reset-btn");
const output = document.getElementById("output");
const wakeBanner = document.getElementById("wake-banner");

fetchBtn.addEventListener("click", handleFetch);
// Enter xuong dong binh thuong (can de go/dan nhieu link, moi dong 1 cai). Ctrl/Cmd+Enter
// moi la phim tat de gui luon, cho ai quen thao tac nhanh bang ban phim.
urlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    handleFetch();
  }
});
urlInput.addEventListener("input", autoResizeUrlInput);
pasteBtn.addEventListener("click", handlePaste);
if (resetBtn) resetBtn.addEventListener("click", handleReset);

// O nhap la <textarea> de ho tro dan nhieu link (moi dong 1 cai) nhung van trong giong
// 1 o input binh thuong khi chi co 1 dong - tu phong chieu cao theo noi dung go/dan vao.
function autoResizeUrlInput() {
  urlInput.style.height = "auto";
  urlInput.style.height = Math.min(urlInput.scrollHeight, 220) + "px";
}
autoResizeUrlInput();

// Render goi free-tier: server tu "ngu" sau mot thoi gian khong ai dung, request dau
// tien sau do co the mat ~30-50s de "thuc day". Ping /healthz ngay khi mo trang de danh
// thuc truoc, va CHI hien canh bao neu that su cham (qua nguong) - tranh hien banner
// thua khi server von di dang thuc san (truong hop binh thuong, pho bien hon).
(function wakeServer() {
  if (!wakeBanner) return;
  const showTimer = setTimeout(() => { wakeBanner.hidden = false; }, 2500);
  fetch("/healthz").catch(() => {}).finally(() => {
    clearTimeout(showTimer);
    wakeBanner.hidden = true;
  });
})();

// Xoa ket qua cu + o nhap de dan link moi ma khong phai tai lai trang.
function handleReset() {
  urlInput.value = "";
  autoResizeUrlInput();
  output.innerHTML = "";
  urlInput.focus();
}

async function handlePaste() {
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      urlInput.value = text;
      autoResizeUrlInput();
      urlInput.focus();
      handleFetch(); // dan xong tu dong lay luon cho nhanh
    }
  } catch (err) {
    // Trinh duyet chan quyen doc clipboard (vd Firefox, hoac chua cap quyen) -> fallback: focus de nguoi dung tu Ctrl+V.
    urlInput.focus();
    output.innerHTML = `<div class="status error">Không tự dán được (trình duyệt chặn quyền clipboard). Hãy bấm vào ô nhập và bấm Ctrl+V.</div>`;
  }
}

// Hien loi kem nut "Thu lai" - bam vao se goi lai handleFetch() voi link dang co san
// trong o nhap (o nhap khong bi xoa khi loi), khong phai tu dan lai link.
function renderError(message, detail) {
  output.innerHTML = `<div class="status error">
    ❌ ${escapeHtml(message)}${detail ? `<br><small>${escapeHtml(detail)}</small>` : ""}
    <div class="status-actions">
      <button type="button" class="btn-dl-sm" id="retry-btn">🔄 Thử lại</button>
    </div>
  </div>`;
  const retryBtn = document.getElementById("retry-btn");
  if (retryBtn) retryBtn.addEventListener("click", handleFetch);
}

// Tach 1 doan text thanh nhieu link TikTok rieng biet - CHI khi TUNG DONG deu tu chua 1
// link TikTok (vd dan nhieu link, moi dong 1 cai). Neu chi 1 dong duy nhat co link (vd
// dan nguyen tin nhan chia se nhieu dong nhung chi 1 link ben trong), giu nguyen ca doan
// nhu 1 link duy nhat - tranh hieu nham thanh "nhieu link" ma hau het se bi loi.
function splitTiktokLinks(text) {
  const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const tiktokLines = lines.filter((l) => /tiktok\.com/i.test(l));
  if (tiktokLines.length >= 2) return tiktokLines;
  return [text.trim()];
}

function handleFetch() {
  const raw = urlInput.value.trim();
  if (!raw) return;

  const urls = splitTiktokLinks(raw);
  if (urls.length > 1) return fetchBatch(urls);
  return fetchSingle(urls[0]);
}

async function fetchSingle(url) {
  fetchBtn.disabled = true;
  output.innerHTML = `<div class="status">⏳ Đang lấy dữ liệu từ TikTok...</div>`;

  // Neu lau hon binh thuong thi goi y ly do (server moi khoi dong lai / TikTok dang
  // gioi han) de nguoi dung yen tam cho thay vi tuong app bi treo.
  const slowHintTimer = setTimeout(() => {
    const statusEl = output.querySelector(".status");
    if (statusEl) {
      statusEl.innerHTML = `⏳ Đang lấy dữ liệu từ TikTok...
        <small>Hơi lâu hơn bình thường — có thể do server mới khởi động lại hoặc TikTok đang giới hạn truy cập, vui lòng chờ thêm chút.</small>`;
    }
  }, 6000);

  try {
    const res = await fetch("/api/fetch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      renderError(json.error || "Có lỗi xảy ra.", json.detail);
      return;
    }
    renderResult(json.data);
    saveToHistory(url, json.data);
  } catch (err) {
    renderError("Lỗi kết nối: " + err.message);
  } finally {
    clearTimeout(slowHintTimer);
    fetchBtn.disabled = false;
  }
}

// Xu ly 1 link va cap nhat ngay vao `container` cua no trong hang doi (thay the bang
// the ket qua neu thanh cong, hoac bao loi kem nut "thu lai" rieng cho link do neu that
// bai - thu lai 1 link khong anh huong cac link khac trong hang doi).
async function fetchOneAndAppend(url, container) {
  container.className = "status";
  container.textContent = "⏳ Đang lấy dữ liệu...";
  try {
    const res = await fetch("/api/fetch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      renderBatchItemError(container, url, json.error || "Có lỗi xảy ra.", json.detail);
      return;
    }
    container.replaceWith(createResultCardElement(json.data));
    saveToHistory(url, json.data);
  } catch (err) {
    renderBatchItemError(container, url, "Lỗi kết nối: " + err.message);
  }
}

function renderBatchItemError(container, url, message, detail) {
  const shortUrl = url.length > 70 ? url.slice(0, 70) + "…" : url;
  container.className = "status error";
  container.innerHTML = `❌ <small>${escapeHtml(shortUrl)}</small><br>${escapeHtml(message)}${detail ? `<br><small>${escapeHtml(detail)}</small>` : ""}
    <div class="status-actions">
      <button type="button" class="btn-dl-sm retry-one">🔄 Thử lại link này</button>
    </div>`;
  const retryBtn = container.querySelector(".retry-one");
  if (retryBtn) retryBtn.addEventListener("click", () => fetchOneAndAppend(url, container));
}

// Dan nhieu link (moi dong 1 cai) duoc xu ly LAN LUOT (khong dong thoi) de khong vuot
// rate limit cua server va cua chinh TikTok/cac trang du phong. Tao san hang doi "dang
// cho" de thay ngay co bao nhieu link se duoc xu ly, roi lan luot thay the tung cai.
async function fetchBatch(urls) {
  fetchBtn.disabled = true;
  const origLabel = fetchBtn.textContent;
  output.innerHTML = "";

  const containers = urls.map((url) => {
    const div = document.createElement("div");
    div.className = "status";
    div.textContent = "⏳ Đang chờ...";
    output.appendChild(div);
    return div;
  });

  for (let i = 0; i < urls.length; i++) {
    fetchBtn.textContent = `⏳ Đang xử lý ${i + 1}/${urls.length}...`;
    await fetchOneAndAppend(urls[i], containers[i]);
  }

  fetchBtn.disabled = false;
  fetchBtn.textContent = origLabel;
}

function dlUrl(src, name, type) {
  return `/api/download?src=${encodeURIComponent(src)}&name=${encodeURIComponent(name)}&type=${type}`;
}

function fmtSize(bytes) {
  if (!bytes) return "";
  return (bytes / 1048576).toFixed(2) + " MB";
}

function codecLabel(codec) {
  return codec === "h264" ? "H.264" : "H.265";
}

// Nhan giai thich cho tung ban, de nguoi dung hieu vi sao ban nay duoc chon.
function qualityBadges(q, isPrimary) {
  const b = [];
  if (isPrimary) b.push('<span class="q-badge">nét nhất</span>');
  // Ban "adapt_*/lower_*" cua TikTok phong to do phan giai roi nen manh:
  // nhieu pixel hon nhung it chi tiet thuc hon ban chinh.
  if (q.adaptive) b.push('<span class="q-badge q-warn">bản nén mạnh</span>');
  if (q.codec !== "h264") b.push('<span class="q-badge q-warn">máy cũ có thể không mở</span>');
  return b.join("");
}

// Nut tai 1 muc chat luong: dong tren la do phan giai + dung luong,
// dong duoi ghi ro codec de nguoi dung biet may minh co mo duoc khong.
function qualityBtnHtml(q, safeName, isPrimary) {
  const cls = isPrimary ? "btn-dl primary" : "btn-dl-sm";
  const name = safeName + "_" + q.label + "_" + q.codec;
  return `<a class="${cls}" href="${dlUrl(q.url, name, "video")}">
    <span class="q-main">
      <span class="q-top">${isPrimary ? "⬇ Tải " : "⬇ "}${q.label} · ${fmtSize(q.size)}</span>
      <span class="q-sub">${q.width}×${q.height} · ${codecLabel(q.codec)}${qualityBadges(q, isPrimary)}</span>
    </span>
  </a>`;
}

// Phan loai noi dung de quyet dinh nut tai chinh: video thuong hoac anh (slideshow).
// Da kiem tra thuc te (link Live Photo that): TikTok KHONG cung cap ban "video ghep
// san" nao cho bai dang anh qua API nay - moi anh deu la anh tinh (bitrate_images luon
// null). Truoc day nham content.video (chi chua NHAC NEN, mime_type=audio_mpeg cho bai
// dang anh) thanh "co ban dong" nen sinh ra nhan "Live Photo" sai - da bo hoan toan.
function classifyKind(data) {
  return data.type === "video" ? "video" : "photo";
}

const KIND_META = {
  video: { badge: "🎬 VIDEO" },
  photo: { badge: "🖼️ ẢNH" },
};

// Dong dau tien cua ket qua: tong hop so anh + nut tai tat ca trong 1 lan bam.
function summaryHtml(count, hint, btnLabel) {
  return `<div class="media-summary">
    <div class="count">📸 Tìm thấy ${count} ảnh<small>${hint}</small></div>
    <button class="btn-dl primary dl-all-images">${btnLabel}</button>
  </div>`;
}

// CDN anh/video cua TikTok doi khi chan hotlink dua tren Referer (giong CDN video
// - da gap khi lam proxy tai video). The <img>/<video> tay ban goi thang toi CDN
// nen trinh duyet tu dong gui Referer la trang web cua minh -> co the bi chan
// KHONG DEU (tuy edge server) -> hien tuong "thinh thoang loi khong hien anh".
// Fix 2 lop: (1) referrerpolicy="no-referrer" de khong gui Referer chan duoc phan lon
// truong hop, (2) neu van loi thi tu dong fallback sang proxy /api/download cua minh
// (da biet chac chan hoat dong vi dung de tai file that).
function previewFallbackAttr(rawSrc) {
  const proxied = dlUrl(rawSrc, "preview", "image").replace(/"/g, "&quot;");
  return `onerror="if(!this.dataset.fallback){this.dataset.fallback='1';this.src='${proxied}';}"`;
}

// The <video> khong tu tai lai khi doi src bang onerror nhu <img> - phai goi load()
// tuong minh de trinh duyet thuc su thu lai voi src moi (ban proxy qua server).
function videoFallbackAttr(rawSrc) {
  const proxied = dlUrl(rawSrc, "preview", "video").replace(/"/g, "&quot;");
  return `onerror="if(!this.dataset.fallback){this.dataset.fallback='1';this.src='${proxied}';this.load();}"`;
}

// Luoi anh: moi anh nam trong 1 the rieng, nut tai dat ngay duoi anh do.
function imageGridHtml(images, safeName) {
  return `<div class="img-grid">${images.map((src, i) => `
    <div class="img-card">
      <img src="${src}" loading="lazy" alt="Ảnh ${i + 1}" referrerpolicy="no-referrer" ${previewFallbackAttr(src)}/>
      <a class="btn-dl-sm" href="${dlUrl(src, safeName + "_" + (i + 1), "image")}">⬇ Tải ảnh ${i + 1}</a>
    </div>`).join("")}</div>`;
}

// Dung lai HTML tho cua 1 the ket qua (khong gan vao trang) - de dung chung cho ca tai
// 1 link (thay het noi dung #output) lan tai nhieu link (them 1 the moi vao hang doi,
// #output luc nay co the dang chua nhieu the khac).
function buildResultHtml(data) {
  const safeName = (data.author.nickname || "tiktok").replace(/[^\w\-]/g, "_");
  const kind = classifyKind(data);
  const meta = KIND_META[kind];
  const n = (data.images || []).length;

  let html = `<div class="result-card">
    <div class="type-badge">${meta.badge}</div>`;

  // Voi noi dung dang anh, dat dong tong hop len tren cung cho de thay.
  if (kind === "photo" && n) {
    html += summaryHtml(
      n,
      "Bấm nút dưới mỗi ảnh để tải riêng, hoặc tải tất cả cùng lúc.",
      `⬇ Tải tất cả ${n} ảnh`
    );
  }

  html += `<div class="result-head">
      <img src="${data.author.avatar || ""}" alt="" onerror="this.style.display='none'"/>
      <div>
        <div class="name">${escapeHtml(data.author.nickname || "Không rõ tác giả")}</div>
        <div class="desc">${escapeHtml((data.desc || "").slice(0, 120))}</div>
      </div>
    </div>`;

  if (kind === "video") {
    const previewSrc = data.videoNoWatermark || data.videoWatermark;
    const qs = data.videoQualities || [];
    html += `<video src="${previewSrc}" controls playsinline referrerpolicy="no-referrer" ${videoFallbackAttr(previewSrc)}></video>`;

    if (qs.length) {
      // Server da chon san ban tot nhat (bitrate cao nhat, uu tien H.264).
      const top = data.videoBest || qs[0];
      // Ban nhieu pixel nhat thuong la ban adaptive phong to - de nguoi dung tu thu neu muon.
      const alt = data.videoMostPixels;
      const showAlt = alt && alt.url !== top.url;
      const rest = qs.filter((q) => q.url !== top.url && (!showAlt || q.url !== alt.url));

      html += `<div class="dl-row">
        ${qualityBtnHtml(top, safeName, true)}
        ${showAlt ? qualityBtnHtml(alt, safeName, false) : ""}
      </div>`;

      if (rest.length) {
        html += `<details class="q-more">
          <summary>Các chất lượng khác (${rest.length})</summary>
          <div class="q-list">${rest.map((q) => qualityBtnHtml(q, safeName, false)).join("")}</div>
        </details>`;
      }
    } else {
      // Engine du phong (v2/v3) khong tra ve danh sach chat luong.
      html += `<div class="dl-row">
        <a class="btn-dl primary" href="${dlUrl(previewSrc, safeName + "_video", "video")}">⬇ Tải video</a>
        ${data.videoWatermark ? `<a class="btn-dl" href="${dlUrl(data.videoWatermark, safeName + "_watermark", "video")}">⬇ Bản có watermark</a>` : ""}
      </div>`;
    }

    html += `<div class="dl-row" style="margin-top:10px">
        ${data.music ? `<a class="btn-dl" href="${dlUrl(data.music, safeName + "_audio", "audio")}">🎵 Nhạc nền</a>` : ""}
        ${data.coverStatic ? `<a class="btn-dl" href="${dlUrl(data.coverStatic, safeName + "_cover_static", "image")}">🖼 Ảnh bìa tĩnh</a>` : ""}
        ${data.coverDynamic ? `<a class="btn-dl" href="${dlUrl(data.coverDynamic, safeName + "_cover_dynamic", "image")}">🌀 Ảnh bìa động</a>` : ""}
      </div>`;
  } else if (kind === "photo" && n) {
    html += imageGridHtml(data.images, safeName);
    if (data.music) {
      html += `<div class="dl-row">
        <a class="btn-dl" href="${dlUrl(data.music, safeName + "_audio", "audio")}">🎵 Nhạc nền</a>
      </div>`;
    }
  } else {
    html += `<div class="status error">Không tìm thấy media để tải.</div>`;
  }

  html += `</div>`;
  return html;
}

// Dung class thay vi id cho nut "Tai tat ca anh" vi khi tai nhieu link co the co NHIEU
// the ket qua (nhieu bai dang anh) cung luc tren trang - id trung nhau se chi bat duoc
// nut dau tien.
function createResultCardElement(data) {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = buildResultHtml(data);
  const card = wrapper.firstElementChild;

  const allBtn = card.querySelector(".dl-all-images");
  if (allBtn) {
    const safeName = (data.author.nickname || "tiktok").replace(/[^\w\-]/g, "_");
    allBtn.addEventListener("click", () => downloadAllImages(data.images, safeName, allBtn));
  }
  return card;
}

function renderResult(data) {
  output.innerHTML = "";
  output.appendChild(createResultCardElement(data));
}

// Tai lan luot tung anh (co gian cach nho) de trinh duyet khong chan tai hang loat cung luc.
function downloadAllImages(images, safeName, btn) {
  const label = btn ? btn.textContent : "";
  if (btn) { btn.disabled = true; btn.textContent = `⏳ Đang tải ${images.length} ảnh...`; }

  images.forEach((src, i) => {
    setTimeout(() => {
      const a = document.createElement("a");
      a.href = dlUrl(src, safeName + "_" + (i + 1), "image");
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();

      // Anh cuoi cung da gui xong -> tra nut ve trang thai binh thuong.
      if (i === images.length - 1 && btn) {
        setTimeout(() => { btn.disabled = false; btn.textContent = label; }, 600);
      }
    }, i * 400);
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/* ============================================================
   LICH SU LINK VUA TAI (luu trong localStorage cua trinh duyet,
   khong gui len server) - bam vao 1 muc de dien lai link va tai lai.
   ============================================================ */

const HISTORY_KEY = "tiksave_history_v1";
const HISTORY_LIMIT = 12;
const historyWrap = document.getElementById("history-wrap");
const historyList = document.getElementById("history-list");
const historyClearBtn = document.getElementById("history-clear");

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    // localStorage co the bi chan (che do an danh, quyen trinh duyet...) - bo qua lich su.
    return [];
  }
}

function persistHistory(list) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
  } catch {
    // Bo qua neu khong luu duoc - khong lam gian doan chuc nang tai chinh.
  }
}

function saveToHistory(url, data) {
  const entry = {
    url,
    type: data.type,
    nickname: data.author?.nickname || "TikTok",
    savedAt: Date.now(),
  };
  let list = loadHistory().filter((it) => it.url !== url);
  list.unshift(entry);
  list = list.slice(0, HISTORY_LIMIT);
  persistHistory(list);
  renderHistory();
}

function removeFromHistory(url) {
  persistHistory(loadHistory().filter((it) => it.url !== url));
  renderHistory();
}

function clearHistory() {
  persistHistory([]);
  renderHistory();
}

function renderHistory() {
  if (!historyWrap || !historyList) return;
  const list = loadHistory();
  historyWrap.hidden = list.length === 0;
  historyList.innerHTML = "";

  list.forEach((item) => {
    const chip = document.createElement("div");
    chip.className = "history-item";
    chip.title = item.url;

    const icon = document.createElement("span");
    icon.className = "h-icon";
    icon.textContent = item.type === "image" ? "🖼️" : "🎬";

    const name = document.createElement("span");
    name.className = "h-name";
    name.textContent = item.nickname || "TikTok";

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "h-remove";
    remove.title = "Bỏ khỏi lịch sử";
    remove.textContent = "×";
    remove.addEventListener("click", (e) => {
      e.stopPropagation();
      removeFromHistory(item.url);
    });

    chip.addEventListener("click", () => {
      urlInput.value = item.url;
      handleFetch();
    });

    chip.append(icon, name, remove);
    historyList.appendChild(chip);
  });
}

if (historyClearBtn) historyClearBtn.addEventListener("click", clearHistory);

renderHistory();

/* ============================================================
   TABS - chon 1 trong 2 chuc nang (Tai TikTok / Live Photo -> Video)
   de khong hien ca 2 khoi chuc nang cung luc gay roi mat.
   ============================================================ */

const TAB_KEY = "tiksave_tab_v1";
const tabBtnTiktok = document.getElementById("tab-btn-tiktok");
const tabBtnLivephoto = document.getElementById("tab-btn-livephoto");
const tabPanelTiktok = document.getElementById("tab-panel-tiktok");
const tabPanelLivephoto = document.getElementById("tab-panel-livephoto");

function switchTab(tab) {
  const isTiktok = tab !== "livephoto";
  tabPanelTiktok.hidden = !isTiktok;
  tabPanelLivephoto.hidden = isTiktok;
  tabBtnTiktok.classList.toggle("active", isTiktok);
  tabBtnLivephoto.classList.toggle("active", !isTiktok);
  tabBtnTiktok.setAttribute("aria-selected", String(isTiktok));
  tabBtnLivephoto.setAttribute("aria-selected", String(!isTiktok));
  try { localStorage.setItem(TAB_KEY, isTiktok ? "tiktok" : "livephoto"); } catch {}
}

if (tabBtnTiktok) tabBtnTiktok.addEventListener("click", () => switchTab("tiktok"));
if (tabBtnLivephoto) tabBtnLivephoto.addEventListener("click", () => switchTab("livephoto"));

(function initTab() {
  if (!tabPanelTiktok || !tabPanelLivephoto) return;
  let saved = "tiktok";
  try { saved = localStorage.getItem(TAB_KEY) || "tiktok"; } catch {}
  switchTab(saved);
})();

/* ============================================================
   LIVE PHOTO -> VIDEO (xu ly tren server bang ffmpeg, xem server.js)
   Nguoi dung co the chon NHIEU Live Photo cung luc - tu ghep file
   anh + video thanh tung Live Photo theo TEN FILE giong nhau (dung
   cach iPhone xuat file: IMG_1234.HEIC + IMG_1234.MOV), roi gui
   LAN LUOT tung Live Photo len server (giong cach xu ly nhieu link
   TikTok o tren) de khong lam qua tai server free-tier yeu.
   ============================================================ */

const LP_MAX_FILES = 24; // ~12 Live Photo (anh+video) moi lan chon

const lpPickBtn = document.getElementById("lp-pick-btn");
const lpFileInput = document.getElementById("lp-file-input");
const lpConvertBtn = document.getElementById("lp-convert-btn");
const lpFilelist = document.getElementById("lp-filelist");
const lpGroupHint = document.getElementById("lp-group-hint");
const lpOutput = document.getElementById("lp-output");

let lpGroups = []; // [{ name, files: File[] }]
let lpObjectUrls = [];

// Ghep cac file da chon thanh tung "Live Photo" theo ten file (bo duoi mo rong, khong
// phan biet hoa/thuong) - day la cach iPhone xuat Live Photo thanh cap 2 file cung ten.
function groupLivePhotoFiles(files) {
  const order = [];
  const map = new Map();
  files.forEach((file) => {
    const dot = file.name.lastIndexOf(".");
    const base = (dot > 0 ? file.name.slice(0, dot) : file.name).toLowerCase();
    if (!map.has(base)) {
      map.set(base, { name: dot > 0 ? file.name.slice(0, dot) : file.name, files: [] });
      order.push(base);
    }
    map.get(base).files.push(file);
  });
  // Server (multer) chi nhan toi da 2 file/request - neu trung ten hon 2 file (hiem) thi
  // chi lay 2 file dau, tranh gui thua bi server tu choi ca nhom.
  return order.map((key) => {
    const g = map.get(key);
    return { name: g.name, files: g.files.slice(0, 2) };
  });
}

if (lpPickBtn) lpPickBtn.addEventListener("click", () => lpFileInput.click());

if (lpFileInput) {
  lpFileInput.addEventListener("change", () => {
    const picked = Array.from(lpFileInput.files || []).slice(0, LP_MAX_FILES);
    lpGroups = groupLivePhotoFiles(picked);
    lpFileInput.value = ""; // cho phep chon lai dung file do lan sau neu can
    renderLpFilelist();
  });
}

function renderLpFilelist() {
  lpFilelist.innerHTML = "";
  lpGroups.forEach((group, i) => {
    const chip = document.createElement("div");
    chip.className = "lp-file-chip";

    const totalSize = group.files.reduce((sum, f) => sum + f.size, 0);
    const fileNames = group.files.map((f) => f.name).join(" + ");

    const info = document.createElement("span");
    info.innerHTML = `<b>${escapeHtml(group.name)}</b> · ${escapeHtml(fileNames)} · ${(totalSize / 1048576).toFixed(2)} MB`;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "lp-remove";
    remove.title = "Bỏ Live Photo này";
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      lpGroups.splice(i, 1);
      renderLpFilelist();
    });

    chip.append(info, remove);
    lpFilelist.appendChild(chip);
  });

  if (lpGroupHint) {
    lpGroupHint.hidden = lpGroups.length === 0;
    lpGroupHint.textContent = lpGroups.length
      ? `🎞️ Sẽ chuyển đổi ${lpGroups.length} Live Photo (ghép theo tên file trùng nhau).`
      : "";
  }
  lpConvertBtn.disabled = lpGroups.length === 0;
}

if (lpConvertBtn) lpConvertBtn.addEventListener("click", convertLivePhoto);

async function convertLivePhoto() {
  if (!lpGroups.length) return;

  lpConvertBtn.disabled = true;
  const origLabel = lpConvertBtn.textContent;
  lpOutput.innerHTML = "";

  // Doi batch moi -> giai phong cac blob URL cua lan chuyen doi truoc, tranh ro ri bo nho.
  lpObjectUrls.forEach((u) => URL.revokeObjectURL(u));
  lpObjectUrls = [];

  const containers = lpGroups.map((group) => {
    const div = document.createElement("div");
    div.className = "status";
    div.textContent = `⏳ Đang chờ: ${group.name}`;
    lpOutput.appendChild(div);
    return div;
  });

  for (let i = 0; i < lpGroups.length; i++) {
    lpConvertBtn.textContent = `⏳ Đang xử lý ${i + 1}/${lpGroups.length}...`;
    await convertOneLivePhotoAndAppend(lpGroups[i], containers[i]);
  }

  lpConvertBtn.textContent = origLabel;
  lpConvertBtn.disabled = lpGroups.length === 0;
}

// Xu ly 1 Live Photo (toi da 2 file) va cap nhat ngay vao `container` cua no trong hang
// doi - giong fetchOneAndAppend o tren cho TikTok, de 1 Live Photo loi khong anh huong
// cac Live Photo con lai va co the thu lai rieng tung cai.
async function convertOneLivePhotoAndAppend(group, container) {
  container.className = "status";
  container.textContent = `⏳ Đang xử lý: ${group.name}...`;

  const formData = new FormData();
  group.files.forEach((file) => formData.append("files", file));

  try {
    const res = await fetch("/api/live-photo", { method: "POST", body: formData });

    if (!res.ok) {
      let message = "Chuyển đổi thất bại.";
      let detail = "";
      try {
        const json = await res.json();
        message = json.error || message;
        detail = json.detail || "";
      } catch {
        // Phan hoi khong phai JSON (vd loi server la): giu thong bao mac dinh.
      }
      renderLpItemError(container, group, message, detail);
      return;
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    lpObjectUrls.push(url);

    const card = document.createElement("div");
    card.className = "lp-result";
    card.innerHTML = `
      <div class="lp-result-name">🎬 ${escapeHtml(group.name)}</div>
      <video src="${url}" controls playsinline></video>
      <div class="dl-row">
        <a class="btn-dl primary" href="${url}" download="${escapeHtml(group.name)}.mp4">⬇ Tải video .mp4</a>
      </div>`;
    container.replaceWith(card);
  } catch (err) {
    renderLpItemError(container, group, "Lỗi kết nối: " + err.message);
  }
}

function renderLpItemError(container, group, message, detail) {
  container.className = "status error";
  container.innerHTML = `❌ <b>${escapeHtml(group.name)}</b>: ${escapeHtml(message)}${detail ? `<br><small>${escapeHtml(detail)}</small>` : ""}
    <div class="status-actions">
      <button type="button" class="btn-dl-sm retry-one">🔄 Thử lại</button>
    </div>`;
  const retryBtn = container.querySelector(".retry-one");
  if (retryBtn) retryBtn.addEventListener("click", () => convertOneLivePhotoAndAppend(group, container));
}
