// Server tai video/anh TikTok khong watermark.
// Dung thu vien @tobyg74/tiktok-api-dl de lay link goc (khong watermark) tu URL TikTok cong khai.
// Chi nen dung cho noi dung ban so huu hoac duoc phep tai ve ca nhan - xem README.md.

const express = require("express");
const path = require("path");
const axios = require("axios");
const Tiktok = require("@tobyg74/tiktok-api-dl");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3001;

// Cac domain CDN hop le duoc phep proxy tai ve (chan dung endpoint nay lam open proxy).
const ALLOWED_HOST_PATTERNS = [
  /tiktokcdn/i,
  /tiktokv\.com$/i,
  /tiktok\.com$/i,
  /muscdn\.com$/i,
  /musicaldown\.com$/i,
  /ssstik\.io$/i,
];

function isAllowedHost(urlStr) {
  try {
    const u = new URL(urlStr);
    if (u.protocol !== "https:") return false;
    return ALLOWED_HOST_PATTERNS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

// URL nao mang dau hieu watermark cua TikTok thi loai bo (endpoint /aweme/v1/play/ co watermark=1).
function hasWatermarkMark(url) {
  return /watermark=1|logo_name=/i.test(url || "");
}

// Nhan de nguoi dung hieu: uu tien chieu nho (do phan giai dung nghia video doc).
function qualityLabel(w, h) {
  const shortSide = Math.min(w || 0, h || 0);
  if (!shortSide) return "Khong ro";
  return shortSide + "p";
}

// TikTok tra ve NHIEU muc chat luong o nhung field khac nhau. Ham nay quet het,
// loai ban co watermark, roi sap xep de ban dep nhat (nhieu pixel nhat) len dau.
// Luu y: download_addr bi bo qua - no la ban "tai ve" cua TikTok, thuong kem watermark.
function extractVideoQualities(rawVideo) {
  if (!rawVideo || typeof rawVideo !== "object") return [];
  const out = [];

  const push = (addr, source, codec) => {
    if (!addr || !Array.isArray(addr.url_list)) return;
    const url = addr.url_list.find((u) => u && !hasWatermarkMark(u));
    if (!url) return;
    out.push({
      url,
      width: addr.width || 0,
      height: addr.height || 0,
      size: addr.data_size || 0,
      source,
      codec: codec || "h264",
    });
  };

  push(rawVideo.play_addr, "play_addr", "h264");
  push(rawVideo.play_addr_h264, "play_addr_h264", "h264");
  push(rawVideo.play_addr_bytevc1, "play_addr_bytevc1", "h265");
  if (Array.isArray(rawVideo.bit_rate)) {
    rawVideo.bit_rate.forEach((b, i) => {
      if (!b) return;
      push(b.play_addr, "bit_rate[" + i + "]" + (b.gear_name ? " " + b.gear_name : ""), b.is_bytevc1 ? "h265" : "h264");
    });
  }

  // Bo ban trung nhau (cung do phan giai + cung dung luong).
  const seen = new Set();
  const uniq = out.filter((q) => {
    const key = q.width + "x" + q.height + ":" + q.size;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Nhieu pixel truoc; cung do phan giai thi ban nang hon (it nen hon) truoc.
  uniq.sort((a, b) => (b.width * b.height) - (a.width * a.height) || b.size - a.size);

  return uniq.map((q) => ({
    ...q,
    label: qualityLabel(q.width, q.height),
    // H.264 phat duoc tren moi may/phan mem; H.265 net hon o cung dung luong
    // nhung may cu hoac Windows thieu HEVC extension co the khong mo duoc.
    compatible: q.codec === "h264",
  }));
}

// Anh trong bai slideshow: uu tien display_image (ban goc, khong watermark),
// tranh cac field *watermark_image*.
function extractImageUrls(rawContent) {
  const imgs = rawContent && rawContent.image_post_info && rawContent.image_post_info.images;
  if (!Array.isArray(imgs)) return [];
  return imgs
    .map((im) => {
      const d = im && im.display_image;
      if (!d || !Array.isArray(d.url_list)) return null;
      return d.url_list.find((u) => u && !hasWatermarkMark(u)) || null;
    })
    .filter(Boolean);
}

// Chuan hoa response tu 3 phien ban khac nhau cua thu vien ve 1 dinh dang chung.
// coverStatic = anh bia tinh (originCover), coverDynamic = anh bia dong/webp chuyen dong (dynamicCover).
function normalize(raw, version) {
  if (!raw || raw.status !== "success" || !raw.result) return null;
  const r = raw.result;

  if (version === "v1") {
    return {
      type: r.type === "image" ? "image" : "video",
      desc: r.desc || "",
      author: { nickname: r.author?.nickname || r.author?.username || "", avatar: r.author?.avatarMedium?.[0] || "" },
      coverStatic: r.video?.originCover?.[0] || r.originCover?.[0] || r.video?.cover?.[0] || r.cover?.[0] || "",
      coverDynamic: r.video?.dynamicCover?.[0] || r.dynamicCover?.[0] || "",
      videoNoWatermark: r.video?.playAddr?.[0] || r.video?.downloadAddr?.[0] || "",
      videoWatermark: "",
      images: r.images || [],
      music: r.music?.playUrl?.[0] || "",
    };
  }
  if (version === "v3") {
    return {
      type: r.type === "image" ? "image" : "video",
      desc: r.desc || "",
      author: { nickname: r.author?.nickname || "", avatar: r.author?.avatar || "" },
      coverStatic: "",
      coverDynamic: "",
      videoNoWatermark: r.videoHD || "",
      videoWatermark: r.videoWatermark || "",
      images: r.images || [],
      music: r.music || "",
    };
  }
  if (version === "v2") {
    return {
      type: r.type === "image" ? "image" : "video",
      desc: r.desc || "",
      author: { nickname: r.author?.nickname || "", avatar: r.author?.avatar || "" },
      coverStatic: "",
      coverDynamic: "",
      videoNoWatermark: r.video?.playAddr || r.direct || "",
      videoWatermark: "",
      images: r.images || [],
      music: r.music?.playUrl || "",
    };
  }
  return null;
}

// Nguoi dung co the dan nguyen ca doan chia se tu app TikTok tren dien thoai
// (vi du: "Xem video nay tren TikTok! https://vm.tiktok.com/ZM8abcxyz/ 07/25")
// thay vi chi mot link sach tu thanh dia chi trinh duyet laptop -> tu tim link that trong doan text.
function extractTiktokUrl(input) {
  if (!input || typeof input !== "string") return null;
  const match = input.match(/https?:\/\/\S*tiktok\.com\S*/i);
  if (!match) return null;
  // Bo dau cau thua o cuoi (dau cham, dau ngoac...) hay dinh vao link khi copy tu tin nhan/caption.
  return match[0].replace(/[)\]}>,;.!?"'“”‘’。，！？]+$/, "");
}

// Thu lan luot nhieu "engine" (v1 -> v3 -> v2) vi TikTok hay doi cau truc, engine nay hong thi dung engine khac.
app.post("/api/fetch", async (req, res) => {
  const { url: rawInput } = req.body || {};
  const url = extractTiktokUrl(rawInput);
  if (!url) {
    return res.status(400).json({ error: "Khong tim thay link TikTok hop le trong noi dung ban dan vao." });
  }

  let lastError = "";

  // Engine v1 truoc: goi SONG SONG 2 dang de khong cham hon.
  //  - ban parsed: co day du metadata (tac gia, mo ta, nhac, anh bia)
  //  - ban raw (showOriginalResponse): rong metadata NHUNG chua danh sach cac muc chat luong
  // Ghep 2 ban lai moi co du "metadata day du + chat luong cao nhat".
  try {
    const [parsedR, rawR] = await Promise.allSettled([
      Tiktok.Downloader(url, { version: "v1" }),
      Tiktok.Downloader(url, { version: "v1", showOriginalResponse: true }),
    ]);

    const parsed = parsedR.status === "fulfilled" ? parsedR.value : null;
    const data = normalize(parsed, "v1");

    if (data) {
      const rawContent =
        rawR.status === "fulfilled" && rawR.value?.resultNotParsed?.content
          ? rawR.value.resultNotParsed.content
          : null;

      if (rawContent) {
        const qualities = extractVideoQualities(rawContent.video);
        if (qualities.length) {
          data.videoQualities = qualities;
          data.videoNoWatermark = qualities[0].url; // ban nhieu pixel nhat
          // Ban H.264 net nhat - dung lam phuong an du khi ban cao nhat la H.265
          // (mot so may/phan mem khong giai ma duoc H.265).
          const bestH264 = qualities.find((q) => q.compatible);
          if (bestH264) data.videoCompatible = bestH264;
        }
        // Anh goc tu raw thuong day du hon ban parsed.
        const rawImages = extractImageUrls(rawContent);
        if (rawImages.length >= (data.images?.length || 0)) data.images = rawImages;
      }

      if (data.videoNoWatermark || data.videoWatermark || data.images.length) {
        return res.json({ ok: true, engine: rawContent ? "v1+raw" : "v1", data });
      }
    }
    lastError = parsed?.message || "Khong lay duoc du lieu tu v1";
  } catch (err) {
    lastError = err.message;
  }

  // v1 that bai thi thu cac engine con lai (khong co thong tin chat luong chi tiet).
  for (const version of ["v3", "v2"]) {
    try {
      const raw = await Tiktok.Downloader(url, { version });
      const data = normalize(raw, version);
      if (data && (data.videoNoWatermark || data.videoWatermark || data.images.length)) {
        return res.json({ ok: true, engine: version, data });
      }
      lastError = raw?.message || "Khong lay duoc du lieu";
    } catch (err) {
      lastError = err.message;
    }
  }
  res.status(502).json({ error: "Khong lay duoc video/anh. TikTok co the da doi cau truc hoac link khong hop le.", detail: lastError });
});

// Proxy tai file ve may nguoi dung voi ten file dep + dung header Referer de qua duoc hotlink-protection cua CDN.
app.get("/api/download", async (req, res) => {
  const { src, name } = req.query;
  if (!src || !isAllowedHost(src)) {
    return res.status(400).json({ error: "URL nguon khong hop le." });
  }
  try {
    const upstream = await axios.get(src, {
      responseType: "stream",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Referer: "https://www.tiktok.com/",
      },
      timeout: 20000,
    });
    const ext = /\.(mp4|jpeg|jpg|png|webp)(\?|$)/i.exec(src)?.[1] || (req.query.type === "image" ? "jpg" : "mp4");
    const filename = (name || "tiktok-download").replace(/[^\w\-]/g, "_") + "." + ext;
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    if (upstream.headers["content-type"]) res.setHeader("Content-Type", upstream.headers["content-type"]);
    upstream.data.pipe(res);
  } catch (err) {
    res.status(502).json({ error: "Tai file that bai.", detail: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`TikTok downloader dang chay tai http://localhost:${PORT}`);
});
