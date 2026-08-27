const urlInput = document.getElementById("url-input");
const fetchBtn = document.getElementById("fetch-btn");
const pasteBtn = document.getElementById("paste-btn");
const resetBtn = document.getElementById("reset-btn");
const output = document.getElementById("output");

fetchBtn.addEventListener("click", handleFetch);
urlInput.addEventListener("keydown", (e) => { if (e.key === "Enter") handleFetch(); });
pasteBtn.addEventListener("click", handlePaste);
if (resetBtn) resetBtn.addEventListener("click", handleReset);

// Xoa ket qua cu + o nhap de dan link moi ma khong phai tai lai trang.
function handleReset() {
  urlInput.value = "";
  output.innerHTML = "";
  urlInput.focus();
}

async function handlePaste() {
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      urlInput.value = text;
      urlInput.focus();
      handleFetch(); // dan xong tu dong lay luon cho nhanh
    }
  } catch (err) {
    // Trinh duyet chan quyen doc clipboard (vd Firefox, hoac chua cap quyen) -> fallback: focus de nguoi dung tu Ctrl+V.
    urlInput.focus();
    output.innerHTML = `<div class="status error">Không tự dán được (trình duyệt chặn quyền clipboard). Hãy bấm vào ô nhập và bấm Ctrl+V.</div>`;
  }
}

async function handleFetch() {
  const url = urlInput.value.trim();
  if (!url) return;

  fetchBtn.disabled = true;
  output.innerHTML = `<div class="status">⏳ Đang lấy dữ liệu từ TikTok...</div>`;

  try {
    const res = await fetch("/api/fetch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      output.innerHTML = `<div class="status error">❌ ${escapeHtml(json.error || "Có lỗi xảy ra.")}${json.detail ? `<br><small>${escapeHtml(json.detail)}</small>` : ""}</div>`;
      return;
    }
    renderResult(json.data);
  } catch (err) {
    output.innerHTML = `<div class="status error">❌ Lỗi kết nối: ${escapeHtml(err.message)}</div>`;
  } finally {
    fetchBtn.disabled = false;
  }
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

// Nut tai 1 muc chat luong: dong tren la do phan giai + dung luong,
// dong duoi ghi ro codec de nguoi dung biet may minh co mo duoc khong.
function qualityBtnHtml(q, safeName, isPrimary) {
  const cls = isPrimary ? "btn-dl primary" : "btn-dl-sm";
  const name = safeName + "_" + q.label + "_" + q.codec;
  const badge = q.compatible ? '<span class="q-badge">tương thích mọi máy</span>' : "";
  return `<a class="${cls}" href="${dlUrl(q.url, name, "video")}">
    <span class="q-main">
      <span class="q-top">${isPrimary ? "⬇ Tải " : "⬇ "}${q.label} · ${fmtSize(q.size)}</span>
      <span class="q-sub">${q.width}×${q.height} · ${codecLabel(q.codec)}${badge}</span>
    </span>
  </a>`;
}

// Phan loai noi dung de quyet dinh nut tai chinh: video thuong / anh tinh (slideshow) / "live photo"
// (slideshow ma TikTok co dung sinh ban dong kem nhac - coi nhu tuong duong Live Photo).
function classifyKind(data) {
  if (data.type === "video") return "video";
  if (data.type === "image" && data.videoNoWatermark) return "livePhoto";
  return "photo";
}

const KIND_META = {
  video: { badge: "🎬 VIDEO" },
  livePhoto: { badge: "🎞️ LIVE PHOTO" },
  photo: { badge: "🖼️ ẢNH" },
};

// Dong dau tien cua ket qua: tong hop so anh + nut tai tat ca trong 1 lan bam.
function summaryHtml(count, hint, btnLabel) {
  return `<div class="media-summary">
    <div class="count">📸 Tìm thấy ${count} ảnh<small>${hint}</small></div>
    <button class="btn-dl primary" id="dl-all-images">${btnLabel}</button>
  </div>`;
}

// Luoi anh: moi anh nam trong 1 the rieng, nut tai dat ngay duoi anh do.
function imageGridHtml(images, safeName) {
  return `<div class="img-grid">${images.map((src, i) => `
    <div class="img-card">
      <img src="${src}" loading="lazy" alt="Ảnh ${i + 1}"/>
      <a class="btn-dl-sm" href="${dlUrl(src, safeName + "_" + (i + 1), "image")}">⬇ Tải ảnh ${i + 1}</a>
    </div>`).join("")}</div>`;
}

function renderResult(data) {
  const safeName = (data.author.nickname || "tiktok").replace(/[^\w\-]/g, "_");
  const kind = classifyKind(data);
  const meta = KIND_META[kind];
  const n = (data.images || []).length;

  let html = `<div class="result-card">
    <div class="type-badge">${meta.badge}</div>`;

  // Voi noi dung dang anh, dat dong tong hop len tren cung cho de thay.
  if ((kind === "photo" || kind === "livePhoto") && n) {
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
    html += `<video src="${previewSrc}" controls playsinline></video>`;

    if (qs.length) {
      const top = qs[0];
      const compat = data.videoCompatible;
      // Neu ban net nhat khong phai H.264, dua luon phuong an H.264 ra ngoai
      // de nguoi dung co duong thoat khi may khong mo duoc H.265.
      const showCompat = compat && compat.url !== top.url;
      const rest = qs.slice(1).filter((q) => !showCompat || q.url !== compat.url);

      html += `<div class="dl-row">
        ${qualityBtnHtml(top, safeName, true)}
        ${showCompat ? qualityBtnHtml(compat, safeName, false) : ""}
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
  } else if (kind === "livePhoto") {
    html += `<video src="${data.videoNoWatermark}" controls playsinline loop></video>
      ${imageGridHtml(data.images, safeName)}
      <div class="dl-row">
        <a class="btn-dl primary" href="${dlUrl(data.videoNoWatermark, safeName + "_live_photo", "video")}">⬇ Tải Live Photo (bản động)</a>
        ${data.music ? `<a class="btn-dl" href="${dlUrl(data.music, safeName + "_audio", "audio")}">🎵 Nhạc nền</a>` : ""}
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
  output.innerHTML = html;

  const allBtn = document.getElementById("dl-all-images");
  if (allBtn) {
    allBtn.addEventListener("click", () => downloadAllImages(data.images, safeName, allBtn));
  }
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
