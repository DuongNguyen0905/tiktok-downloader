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

  const versions = ["v1", "v3", "v2"];
  let lastError = "";
  for (const version of versions) {
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
