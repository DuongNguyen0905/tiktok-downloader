# 🎵 CAS TikTok Downloader

Web tải video, ảnh và "Live Photo" (slideshow có bản dựng động) từ TikTok, không watermark.
Không cần cài đặt gì để dùng — dán link vào là lấy về.

## ⚠️ Lưu ý sử dụng

Chỉ dùng để tải nội dung bạn sở hữu hoặc được phép lưu lại cho mục đích cá nhân (xem lại
video của chính bạn, lưu offline...). Vui lòng tôn trọng bản quyền và ghi công tác giả gốc
nếu chia sẻ lại — không dùng công cụ này để đăng lại nội dung của người khác như của mình.
Đây là dự án cá nhân, không lưu trữ nội dung nào trên server.

## Tính năng

- Tự nhận diện loại nội dung và hiện nút tải phù hợp: **Video**, **Ảnh (photo/slideshow)**,
  hoặc **Live Photo** (slideshow có bản dựng động kèm nhạc).
- Video: tải bản không watermark, bản có watermark (nếu có), nhạc nền, ảnh bìa tĩnh + ảnh bìa động.
- Ảnh/slideshow: tải từng ảnh riêng hoặc tải tất cả cùng lúc.
- Nút "📋 Dán" để dán nhanh link từ clipboard và tự động lấy về.
- Nhận link ở mọi định dạng: link đầy đủ (`tiktok.com/@user/video/...`, `.../photo/...`),
  link rút gọn (`vt.tiktok.com`, `vm.tiktok.com`), hoặc cả đoạn text chia sẻ có kèm caption
  copy nguyên từ app TikTok trên điện thoại — tool tự tìm link bên trong.
- Không giới hạn thiết bị: dùng link copy từ điện thoại hay từ trình duyệt laptop đều được.

## Chạy thử ở máy (tuỳ chọn — không bắt buộc nếu đã deploy)

```bash
npm install
npm start
```

Mở `http://localhost:3001`.

## 🚀 Deploy thành web sống (không cần chạy code local)

Dùng [Render.com](https://render.com) — có gói **free**, deploy thẳng từ repo GitHub này.

### Cách 1 — Deploy bằng Blueprint (khuyên dùng, ít bước nhất)

1. Đăng nhập / đăng ký [Render.com](https://dashboard.render.com) bằng tài khoản GitHub của bạn.
2. Vào **New +** → **Blueprint**.
3. Chọn repo `tiktok-downloader` này (vì repo private, Render sẽ hỏi quyền truy cập GitHub —
   đồng ý cấp quyền cho repo này).
4. Render tự đọc file [`render.yaml`](render.yaml) có sẵn trong repo và tạo Web Service đúng cấu hình.
5. Bấm **Apply** / **Deploy** — đợi build xong (khoảng 1-2 phút) là có link web dùng ngay,
   dạng `https://tiktok-downloader-xxxx.onrender.com`.

### Cách 2 — Tạo Web Service thủ công

1. **New +** → **Web Service** → chọn repo này.
2. Environment: **Node**. Build Command: `npm install`. Start Command: `npm start`.
3. Plan: **Free**. Bấm **Create Web Service**.

### Lưu ý về gói Free của Render

- Server sẽ "ngủ" sau ~15 phút không có request, lần truy cập kế tiếp sẽ mất khoảng 30-50 giây
  để "thức dậy" — đây là giới hạn bình thường của gói free, không phải lỗi.
- Không cần thẻ tín dụng cho gói free ở thời điểm viết README này, nhưng chính sách của Render
  có thể thay đổi — kiểm tra lại khi đăng ký.

## Cấu trúc dự án

- [`server.js`](server.js) — Express server: API `/api/fetch` (lấy link media) và
  `/api/download` (proxy tải file về máy, tự trích link TikTok từ text dán vào).
- [`public/`](public) — giao diện web (HTML/CSS/JS thuần, không cần build).
- [`render.yaml`](render.yaml) — cấu hình deploy tự động cho Render.

## Công nghệ

Node.js, Express, [`@tobyg74/tiktok-api-dl`](https://www.npmjs.com/package/@tobyg74/tiktok-api-dl)
để lấy dữ liệu media gốc từ TikTok.
