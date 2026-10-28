// Server tai video/anh TikTok khong watermark.
// Dung thu vien @tobyg74/tiktok-api-dl de lay link goc (khong watermark) tu URL TikTok cong khai.
// Chi nen dung cho noi dung ban so huu hoac duoc phep tai ve ca nhan - xem README.md.

const express = require("express");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const axios = require("axios");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const ffprobePath = require("ffprobe-static").path;
const Tiktok = require("@tobyg74/tiktok-api-dl");

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

const app = express();

// Render dung reverse proxy phia truoc app. Neu khong bat trust proxy, moi nguoi
// dung se bi tinh chung 1 IP (IP cua proxy noi bo) -> rate limit se gioi han
// nham CA SERVER thay vi tung nguoi dung rieng le. Chi tin header cua 1 hop proxy
// dau tien (dung voi Render), khong tin toan bo chuoi X-Forwarded-For tu client.
app.set("trust proxy", 1);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3001;

// Chan lam dung/bot goi lien tuc lam qua tai server free-tier (0.1 CPU, 512MB RAM)
// va lam ton bang thong mien phi khi proxy tai file. Gioi han rong rai, khong anh
// huong nguoi dung binh thuong (moi nguoi thuong chi fetch vai lan/tai vai file).
const fetchLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Bạn thao tác hơi nhanh, vui lòng đợi vài phút rồi thử lại." },
});

const downloadLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 40, // cao hon fetch vi 1 video co the co nhieu file (video + nhac + anh bia + nhieu anh slideshow)
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Bạn tải hơi nhanh, vui lòng đợi vài phút rồi thử lại." },
});

// Chuyen doi Live Photo ton nhieu CPU hon nhieu so voi cac endpoint con lai (phai chay
// ffmpeg) - gioi han chat hon de 1 nguoi khong the lam qua tai server free-tier yeu.
// Gioi han cao hon muc "so lan bam nut" thong thuong vi giao dien cho phep chon NHIEU
// Live Photo cung luc - moi Live Photo duoc gui thanh 1 request rieng, xu ly lan luot
// (xem convertLivePhoto trong app.js), nen 1 lan "chuyen doi hang loat" cua nguoi dung
// co the chiem vai chuc request trong cung 1 khung gio.
const livePhotoLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Bạn chuyển đổi hơi nhanh, vui lòng đợi vài phút rồi thử lại." },
});

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

  const push = (addr, source, codec, gear) => {
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
      gear: gear || "",
      // TikTok dat ten "adapt_*/lower_*/lowest_*" cho cac ban adaptive streaming (dung khi
      // mang yeu). Ban "adapt_lower_720" phong to len 720p roi nen manh -> nhieu pixel hon
      // nhung KHONG net hon ban chinh. Danh dau de khong nham la ban tot nhat.
      adaptive: /adapt|lower|lowest/i.test(gear || ""),
    });
  };

  push(rawVideo.play_addr, "play_addr", "h264", "");
  push(rawVideo.play_addr_h264, "play_addr_h264", "h264", "");
  push(rawVideo.play_addr_bytevc1, "play_addr_bytevc1", "h265", "");
  if (Array.isArray(rawVideo.bit_rate)) {
    rawVideo.bit_rate.forEach((b, i) => {
      if (!b) return;
      push(b.play_addr, "bit_rate[" + i + "]", b.is_bytevc1 ? "h265" : "h264", b.gear_name || "");
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

  // Dung luong (bitrate) truoc, so pixel chi la tie-break.
  // Ly do: cung 1 video nguon, bitrate cao = it nen = it artifact = net hon thuc su.
  // Sap theo pixel se dua ban "adapt_lower_720" (phong to roi nen manh) len dau -> sai.
  uniq.sort((a, b) => b.size - a.size || (b.width * b.height) - (a.width * a.height));

  return uniq.map((q) => ({
    ...q,
    label: qualityLabel(q.width, q.height),
    // H.264 phat duoc tren moi may/phan mem; H.265 net hon o cung dung luong
    // nhung may cu hoac Windows thieu HEVC extension co the khong mo duoc.
    compatible: q.codec === "h264",
  }));
}

// Chon ban tot nhat cho nguoi dung: bitrate cao nhat, va uu tien H.264 khi hai ban
// gan tuong duong - vi H.265 net hon o cung dung luong nhung may cu / Windows thieu
// HEVC extension co the khong mo duoc file.
function pickBestQuality(list) {
  if (!list || !list.length) return null;
  const top = list[0]; // list da sap theo dung luong giam dan
  if (top.codec === "h264") return top;
  const nearH264 = list.find((q) => q.codec === "h264" && q.size >= top.size * 0.85);
  return nearH264 || top;
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

// Cac engine ben trong thu vien (v1 = API noi bo TikTok, v2 = ssstik.io) tu dong retry
// toi 20 LAN khi bi TikTok/CDN gioi han, KHONG co timeout rieng cho moi lan thu - gap
// luc TikTok chan (hay xay ra voi server dat o datacenter nhu Render) co the "treo" tham
// chi 20-30 giay cho 1 engine truoc khi bao that bai. Boc timeout rieng de cat lo som va
// chuyen sang engine khac cho nhanh, thay vi nguoi dung phai cho het chuoi retry do.
// Cho v1 mot khoang ngan de tra loi truoc khi dong thoi goi them engine du phong
// (xem /api/fetch) - tranh goi du thua sang trang ngoai khi v1 von di da nhanh,
// nhung van rut ngan dang ke thoi gian cho toi da luc TikTok dang cham/gioi han.
const RACE_GRACE_MS = 1500;
const RACE_TIMEOUT_MS = 8000;

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ __timedOut: true }), ms);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

// Lay 1 url khong watermark dau tien trong 1 "addr" tho (dang { url_list: [...] }) cua TikTok.
function pickRawUrl(addr) {
  if (!addr || !Array.isArray(addr.url_list)) return "";
  return addr.url_list.find((u) => u && !hasWatermarkMark(u)) || "";
}

// Dung TRUC TIEP ket qua "raw" (showOriginalResponse) cua engine v1 - no da kem san
// metadata DA PARSE (author/music, xem tiktokAPIDownloader.js trong thu vien) LAN noi
// dung GOC (de lay day du cac muc chat luong video/anh). Truoc day phai goi THEM 1 lan
// "parsed" rieng chi de lay metadata -> ton gap doi so request toi API hay bi TikTok gioi
// han. Gop lai con 1 lan goi giup nhanh hon va it bi chan hon.
function buildFromRawV1(raw) {
  if (!raw || raw.status !== "success" || !raw.resultNotParsed) return null;
  const { content, author, music } = raw.resultNotParsed;
  if (!content) return null;

  const isImage = !!content.image_post_info;
  const data = {
    type: isImage ? "image" : "video",
    desc: content.desc || "",
    author: {
      nickname: author?.nickname || author?.uniqueId || "",
      avatar: author?.avatarMedium?.[0] || author?.avatarThumb?.[0] || "",
    },
    coverStatic: pickRawUrl(content.video?.origin_cover) || pickRawUrl(content.video?.cover) || "",
    coverDynamic: pickRawUrl(content.video?.dynamic_cover) || "",
    videoNoWatermark: "",
    videoWatermark: "",
    images: extractImageUrls(content),
    music: music?.playUrl?.[0] || "",
  };

  // Xem ghi chu o extractVideoQualities/extractImageUrls: content.video ton tai ca o bai
  // dang anh (chi chua nhac nen) nen chi doc nhu video that khi day dung la bai dang video.
  if (!isImage) {
    const qualities = extractVideoQualities(content.video);
    if (qualities.length) {
      data.videoQualities = qualities;
      const best = pickBestQuality(qualities);
      data.videoBest = best;
      data.videoNoWatermark = best.url;
      // Ban nhieu pixel nhat (thuong la ban adaptive phong to) - de nguoi dung
      // muon thu thi co, nhung khong dat lam mac dinh.
      const mostPixels = [...qualities].sort(
        (a, b) => (b.width * b.height) - (a.width * a.height) || b.size - a.size
      )[0];
      if (mostPixels && mostPixels.url !== best.url) data.videoMostPixels = mostPixels;
    }
  }

  return data;
}

// Endpoint sieu nhe danh cho dich vu ping ben ngoai (cron) goi dinh ky, giup
// server tren goi free khong "ngu" -> nguoi dung khong phai doi ~50s khi vao trang.
// Khong doc file, khong goi TikTok, chi tra ve 1 dong text.
app.get("/healthz", (req, res) => {
  res.type("text/plain").send("ok");
});

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

function isUsableResult(data) {
  return !!(data && (data.videoNoWatermark || data.videoWatermark || (data.images && data.images.length)));
}

// Goi 1 engine, gioi han thoi gian, va tra ve null (khong bao gio reject) khi that bai/
// qua thoi gian cho - de dung duoc chung voi raceFirstUsable ben duoi.
function runEngine(url, version, onError) {
  const callOpts = version === "v1" ? { version: "v1", showOriginalResponse: true } : { version };
  return withTimeout(Tiktok.Downloader(url, callOpts), RACE_TIMEOUT_MS)
    .then((raw) => {
      if (raw && raw.__timedOut) {
        onError(`Engine ${version} qua thoi gian cho.`);
        return null;
      }
      const data = version === "v1" ? buildFromRawV1(raw) : normalize(raw, version);
      if (!isUsableResult(data)) {
        onError(raw?.message || `Khong lay duoc du lieu tu ${version}`);
        return null;
      }
      return { version, data };
    })
    .catch((err) => {
      onError(err?.message);
      return null;
    });
}

// Dua vao mang promise (khong bao gio reject, tra null neu that bai) - tra ve ket qua
// HOP LE dau tien xong truoc, khong doi cac promise con lai.
function raceFirstUsable(promises) {
  return new Promise((resolve) => {
    let remaining = promises.length;
    promises.forEach((p) => {
      p.then((result) => {
        remaining--;
        if (result) resolve(result);
        else if (remaining === 0) resolve(null);
      });
    });
  });
}

app.post("/api/fetch", fetchLimiter, async (req, res) => {
  const { url: rawInput } = req.body || {};
  const url = extractTiktokUrl(rawInput);
  if (!url) {
    return res.status(400).json({ error: "Khong tim thay link TikTok hop le trong noi dung ban dan vao." });
  }

  let lastError = "Khong lay duoc du lieu.";
  const setError = (msg) => { if (msg) lastError = msg; };

  // v1 (API TikTok that) duoc uu tien goi truoc - thuong nhanh nhat va cho day du cac
  // muc chat luong video. Chi cho no 1 khoang ngan (RACE_GRACE_MS); neu chua xong (TikTok
  // dang cham/gioi han) thi goi THEM 2 engine du phong (v3, v2) chay SONG SONG voi v1 dang
  // cho, roi dung engine nao co ket qua hop le ve truoc tien. Cach nay nhanh hon han kieu
  // "cho het v1 roi moi thu engine khac" truoc day, ma van tranh goi du thua sang 2 trang
  // ngoai (musicaldown/ssstik) trong truong hop v1 von di da tra loi nhanh.
  const v1Promise = runEngine(url, "v1", setError);
  let winner = await Promise.race([
    v1Promise,
    new Promise((resolve) => setTimeout(() => resolve(undefined), RACE_GRACE_MS)),
  ]);

  if (!winner) {
    winner = await raceFirstUsable([
      v1Promise,
      runEngine(url, "v3", setError),
      runEngine(url, "v2", setError),
    ]);
  }

  if (winner) {
    return res.json({ ok: true, engine: winner.version, data: winner.data });
  }
  res.status(502).json({ error: "Khong lay duoc video/anh. TikTok co the da doi cau truc hoac link khong hop le.", detail: lastError });
});

// Proxy tai file ve may nguoi dung voi ten file dep + dung header Referer de qua duoc hotlink-protection cua CDN.
app.get("/api/download", downloadLimiter, async (req, res) => {
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

// ===================== LIVE PHOTO -> VIDEO =====================
// Live Photo cua iPhone gom 2 phan: anh tinh + 1 doan video ngan (~3s, dang .MOV).
// Khi xuat ra khoi iPhone (AirDrop, Luu ban goc tu iCloud...), thuong duoc 1 trong 2
// dang: (1) 2 file rieng cung ten (anh + .MOV), hoac (2) chi 1 file .MOV (da la video,
// mot so duong chia se chi giu lai phan nay). Ban ffmpeg-static dung o day KHONG co
// demuxer HEIF nen KHONG the doc truc tiep file HEIC/anh tinh - chi xu ly duoc file nao
// thuc su la video (co track video doc duoc).
//
// Dien thoai Android (OPPO/ColorOS, Samsung, Pixel...) lai xuat Live/Motion Photo theo
// kieu KHAC: KHONG tach rieng 2 file nhu iPhone, ma GHEP video MP4 vao ngay SAU du lieu
// anh JPEG, tat ca trong 1 file .jpg DUY NHAT (chuan "Motion Photo" cua Google ma hau het
// hang Android dung de tuong thich Google Photos). ffprobe doc file nay chi thay phan anh
// JPEG o dau nen bao "khong co video" - phai tu do tim va tach rieng doan MP4 nam BEN
// TRONG file truoc (xem extractEmbeddedMotionVideo ben duoi). Neu khong tim thay ca cap
// 2 file cua iPhone lan video nhung ben trong cua Android, moi ket luan anh khong co
// chuyen dong de trich xuat.

// Moi file MP4/MOV hop le deu bat dau bang 1 "box" ten "ftyp" (4 byte kich thuoc + chuoi
// "ftyp"). Day la cach phat hien doc lap voi hang may/phien ban app (khong phu thuoc doc
// dung 1 the metadata rieng cua tung hang nhu GCamera:MicroVideoOffset cua Google hay
// trailer rieng cua Samsung) - chi can do tim dau hieu nay NGAY TRONG du lieu file de tim
// diem bat dau cua doan video nhung ben trong, roi tach phan con lai cua file ra thanh 1
// file MP4 rieng.
function extractEmbeddedMotionVideo(filePath) {
  return new Promise((resolve) => {
    fs.readFile(filePath, (err, buf) => {
      if (err) return resolve(null);
      const marker = Buffer.from("ftyp", "ascii");
      // Bo qua 8 byte dau (header JPEG/HEIC that khong the trung ngay tu dau) de tranh
      // nham chinh file goc (vd HEIC) thanh "co video nhung ben trong chinh no".
      const idx = buf.indexOf(marker, 8);
      if (idx < 8) return resolve(null);
      const videoStart = idx - 4; // lui lai 4 byte de lay ca truong kich thuoc cua box ftyp
      // Doan con lai qua nho thi chac chan khong phai 1 video that (vd trung ngau nhien
      // 4 byte "ftyp" trong du lieu nen cua anh) - bo qua, se bi probeHasVideoStream loai tiep.
      if (videoStart <= 0 || buf.length - videoStart < 1024) return resolve(null);
      resolve(buf.subarray(videoStart));
    });
  });
}

const LIVE_PHOTO_TMP_DIR = path.join(os.tmpdir(), "tiksave-livephoto");
fs.mkdirSync(LIVE_PHOTO_TMP_DIR, { recursive: true });

const livePhotoUpload = multer({
  dest: LIVE_PHOTO_TMP_DIR,
  limits: {
    fileSize: 80 * 1024 * 1024, // Live Photo thuong duoi 20-30MB tong ca 2 file - 80MB la rong rai.
    files: 2,
  },
});

// Kiem tra 1 file co chua video THAT SU (nhieu khung hinh theo thoi gian) hay khong -
// bat ke duoi file/mimetype nguoi dung dat ten gi, tin vao noi dung thuc te ffprobe doc
// duoc. QUAN TRONG: anh tinh (JPEG/PNG/HEIC...) khi dua qua ffprobe CUNG hien ra nhu 1
// "video stream" (ffmpeg coi moi anh la video 1 khung hinh qua demuxer image2/mjpeg...) -
// neu chi kiem tra "co stream video" se nham MOI anh tinh thanh "co chuyen dong". Phai
// phan biet them bang frame rate thuc su (anh tinh: avg_frame_rate = 0/0) va thoi luong
// co y nghia (anh tinh: ~0.04s do ffmpeg gan tam, video that: vai giay tro len).
function probeHasVideoStream(filePath) {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err || !data || !Array.isArray(data.streams)) return resolve(false);
      const videoStream = data.streams.find((s) => s.codec_type === "video");
      if (!videoStream) return resolve(false);

      const frameRate = videoStream.avg_frame_rate || "0/0";
      const hasRealFrameRate = frameRate !== "0/0" && frameRate !== "N/A";
      const duration = parseFloat(data.format?.duration || videoStream.duration || "0");
      const hasMeaningfulDuration = duration > 0.3;

      resolve(hasRealFrameRate && hasMeaningfulDuration);
    });
  });
}

// Chuyen 1 file video (bat ke container goc) thanh .mp4. Uu tien "copy" (chi dong goi
// lai container, khong giai ma/ma hoa lai) vi cuc nhanh va nhe CPU - rat phu hop server
// free-tier yeu. Chi khi copy that bai (vd container/codec khong tuong thich) moi chuyen
// ma lai bang H.264/AAC (cham hon nhieu, chi dung khi bat buoc).
function convertToMp4(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions(["-c copy", "-movflags +faststart"])
      .toFormat("mp4")
      .on("end", resolve)
      .on("error", () => {
        // Fallback: chuyen ma that su (cham hon, nhung tuong thich rong hon).
        ffmpeg(inputPath)
          .outputOptions([
            "-c:v libx264",
            "-preset veryfast",
            "-crf 23",
            "-c:a aac",
            "-movflags +faststart",
          ])
          .toFormat("mp4")
          .on("end", resolve)
          .on("error", reject)
          .save(outputPath);
      })
      .save(outputPath);
  });
}

function cleanupFiles(paths) {
  paths.forEach((p) => {
    if (!p) return;
    fs.unlink(p, () => {}); // bo qua loi xoa (vd file khong ton tai) - khong quan trong.
  });
}

// Boc multer bang middleware rieng de tra loi JSON gon gang khi upload loi (vd file qua
// lon) thay vi de Express tra ve trang loi 500 mac dinh khong than thien.
function handleLivePhotoUpload(req, res, next) {
  livePhotoUpload.array("files", 2)(req, res, (err) => {
    if (!err) return next();
    const msg =
      err.code === "LIMIT_FILE_SIZE"
        ? "File quá lớn (giới hạn 80MB mỗi file)."
        : err.code === "LIMIT_FILE_COUNT"
        ? "Chỉ được chọn tối đa 2 file (ảnh + video Live Photo)."
        : "Tải file lên thất bại.";
    res.status(400).json({ error: msg, detail: err.message });
  });
}

app.post("/api/live-photo", livePhotoLimiter, handleLivePhotoUpload, async (req, res) => {
  const uploaded = req.files || [];
  const uploadedPaths = uploaded.map((f) => f.path);

  if (!uploaded.length) {
    return res.status(400).json({ error: "Chưa chọn file nào. Hãy chọn ảnh/video Live Photo của bạn." });
  }

  // Khai bao ben ngoai try de catch cung don duoc file output/file tach rieng lo do (vd
  // convertToMp4 loi giua chung, da tao 1 phan file dau ra truoc khi bao loi).
  let outPath;
  let extractedPath; // file MP4 tach tu Motion Photo Android (neu co) - can don dep rieng
  try {
    // Tim file dau tien THUC SU co track video (bo qua ten file/duoi mo rong) - truong hop
    // iPhone (file .MOV rieng hoac video doc lap).
    let videoFile = null;
    for (const f of uploaded) {
      if (await probeHasVideoStream(f.path)) {
        videoFile = f;
        break;
      }
    }

    // Khong co file nao la video "thuan" - thu tiep truong hop Motion Photo Android (OPPO,
    // Samsung, Pixel...): video MP4 nam LONG BEN TRONG 1 file anh JPEG duy nhat.
    if (!videoFile) {
      for (const f of uploaded) {
        const embedded = await extractEmbeddedMotionVideo(f.path);
        if (!embedded) continue;
        const tmpPath = path.join(LIVE_PHOTO_TMP_DIR, crypto.randomUUID() + ".mp4");
        await fs.promises.writeFile(tmpPath, embedded);
        if (await probeHasVideoStream(tmpPath)) {
          videoFile = { path: tmpPath };
          extractedPath = tmpPath;
          break;
        }
        cleanupFiles([tmpPath]);
      }
    }

    if (!videoFile) {
      cleanupFiles(uploadedPaths);
      return res.status(422).json({
        error: "Không tìm thấy phần chuyển động (video) trong file bạn gửi lên.",
        detail:
          "Live Photo của iPhone gồm ảnh tĩnh + một đoạn video ngắn riêng (2 file cùng tên); " +
          "Motion Photo của Android (OPPO, Samsung, Pixel...) là 1 file ảnh có video ghép bên " +
          "trong. Nếu bạn chỉ có 1 ảnh tĩnh thường (không còn giữ video đi kèm/bên trong), phần " +
          "chuyển động không còn trong file đó để trích xuất - hãy thử xuất/chia sẻ lại ảnh ở " +
          "định dạng gốc (tránh các app chỉnh sửa/nén ảnh làm mất phần video nhúng).",
      });
    }

    outPath = path.join(LIVE_PHOTO_TMP_DIR, crypto.randomUUID() + ".mp4");
    await convertToMp4(videoFile.path, outPath);

    res.setHeader("Content-Disposition", 'attachment; filename="live_photo.mp4"');
    res.setHeader("Content-Type", "video/mp4");
    const stream = fs.createReadStream(outPath);
    const cleanup = () => cleanupFiles([...uploadedPaths, extractedPath, outPath]);
    stream.pipe(res);
    stream.on("close", cleanup);
    stream.on("error", cleanup);
  } catch (err) {
    cleanupFiles([...uploadedPaths, extractedPath, outPath]);
    res.status(500).json({ error: "Chuyển đổi thất bại.", detail: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`TikTok downloader dang chay tai http://localhost:${PORT}`);
});
