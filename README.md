# WA Gateway Self Hosted

WhatsApp API mandiri berbasis Node.js, Express, Baileys, MySQL, Redis, Socket.IO, dan dashboard HTML/Bootstrap.

## Fitur

- Multi session WhatsApp.
- Login QR realtime via dashboard.
- Session restore dengan auth storage Baileys.
- REST API dengan API key atau JWT.
- Kirim pesan text dan media.
- Terima pesan masuk, simpan log, emit websocket, dan forward ke webhook aktif.
- MySQL schema otomatis dibuat saat aplikasi start.
- Redis opsional untuk cache status session.
- Docker, Docker Compose, Nginx, dan PM2 config.

## Menjalankan di Laragon

1. Install atau aktifkan Node.js 22+ di Laragon.
2. Pastikan MySQL Laragon berjalan.
3. Pastikan Redis Laragon berjalan jika ingin cache status aktif.
4. Copy `.env.example` menjadi `.env`.
5. Sesuaikan `API_KEYS`, `JWT_SECRET`, dan konfigurasi MySQL.
6. Jalankan:

```bash
npm install
npm run dev
```

Dashboard tersedia di `http://localhost:3000`.

> Catatan: aplikasi akan membuat database `wa_gateway` dan tabel yang diperlukan jika user MySQL punya izin `CREATE DATABASE`.
> Jika `node` dari PATH Windows bermasalah di Laragon, jalankan dari PowerShell dengan path Node Laragon:
>
> ```powershell
> $env:Path = 'C:\laragon\bin\nodejs\node-v22;' + $env:Path
> npm install
> npm run dev
> ```
>
> Di mesin ini Node Laragon yang tersedia adalah v20.10.0, sehingga `npm install` memberi warning engine karena PRD menargetkan Node 22+. Install tetap berhasil untuk validasi lokal awal.

## API Auth

Endpoint API tidak berubah setelah API key diganti. Yang berubah hanya nilai autentikasi yang harus dikirim.

Gunakan API key dari file `.env`:

```env
API_KEYS=isi-api-key-anda
```

Untuk konfigurasi lokal saat ini, API key ada di file `.env` project. Gunakan salah satu metode auth berikut.

```http
X-API-KEY: isi-api-key-anda
```

atau:

```http
Authorization: Bearer <jwt>
```

JWT bisa dibuat dari API key:

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"apiKey\":\"isi-api-key-anda\"}"
```

## Endpoint Utama

```http
POST /api/session
GET /api/sessions
GET /api/session/:id/qrcode
GET /api/session/:id/status
POST /api/logout
DELETE /api/session/:id
POST /api/send-message
POST /api/send-media
GET /api/messages
DELETE /api/messages
DELETE /api/messages/:id
GET /api/contacts
POST /api/contacts
POST /api/contacts/import
GET /api/contacts/export
GET /api/contacts/template
DELETE /api/contacts
PATCH /api/contacts/:id
DELETE /api/contacts/:id
POST /api/broadcast
GET /api/webhooks
POST /api/webhooks
PATCH /api/webhooks/:id
DELETE /api/webhooks/:id
```

`GET /api/messages` dan `GET /api/contacts` mendukung pagination:

```text
?page=1&limit=10
?page=1&limit=20
?page=1&limit=50
?page=1&limit=100
?page=1&limit=500
?page=1&limit=1000
?page=1&limit=all
```

Response pagination:

```json
{
  "success": true,
  "total": 120,
  "page": 1,
  "perPage": 10,
  "data": []
}
```

## Kirim Pesan

```bash
curl -X POST http://localhost:3000/api/send-message \
  -H "Content-Type: application/json" \
  -H "X-API-KEY: isi-api-key-anda" \
  -d "{\"session\":\"sales\",\"phone\":\"628123456789\",\"message\":\"Halo\"}"
```

## Kirim Media

```bash
curl -X POST http://localhost:3000/api/send-media \
  -H "X-API-KEY: isi-api-key-anda" \
  -F "session=sales" \
  -F "phone=628123456789" \
  -F "type=image" \
  -F "caption=Halo" \
  -F "file=@C:/path/to/image.jpg"
```

`type` yang didukung: `image`, `document`, `audio`, `video`.

## Hapus Message Log

Hapus semua log pesan:

```bash
curl -X DELETE http://localhost:3000/api/messages \
  -H "X-API-KEY: isi-api-key-anda"
```

Hapus semua log pesan untuk satu session:

```bash
curl -X DELETE "http://localhost:3000/api/messages?session=sales" \
  -H "X-API-KEY: isi-api-key-anda"
```

Hapus satu log berdasarkan ID:

```bash
curl -X DELETE http://localhost:3000/api/messages/1 \
  -H "X-API-KEY: isi-api-key-anda"
```

## Import, Export, dan Broadcast Kontak

Format Excel wajib memiliki header:

```text
Nama | No telp
```

Download template:

```bash
curl http://localhost:3000/api/contacts/template \
  -H "X-API-KEY: isi-api-key-anda" \
  --output template-kontak-wa.xlsx
```

Import kontak:

```bash
curl -X POST http://localhost:3000/api/contacts/import \
  -H "X-API-KEY: isi-api-key-anda" \
  -F "file=@C:/path/to/kontak.xlsx"
```

Tambah kontak manual:

```bash
curl -X POST http://localhost:3000/api/contacts \
  -H "Content-Type: application/json" \
  -H "X-API-KEY: isi-api-key-anda" \
  -d "{\"name\":\"Budi Santoso\",\"phone\":\"08123456789\"}"
```

Edit kontak:

```bash
curl -X PATCH http://localhost:3000/api/contacts/1 \
  -H "Content-Type: application/json" \
  -H "X-API-KEY: isi-api-key-anda" \
  -d "{\"name\":\"Budi Update\",\"phone\":\"628123456789\"}"
```

Export kontak:

```bash
curl http://localhost:3000/api/contacts/export \
  -H "X-API-KEY: isi-api-key-anda" \
  --output wa-contacts.xlsx
```

Broadcast ke semua kontak:

```bash
curl -X POST http://localhost:3000/api/broadcast \
  -H "Content-Type: application/json" \
  -H "X-API-KEY: isi-api-key-anda" \
  -d "{\"session\":\"sales\",\"message\":\"Halo {nama}, ini pesan broadcast\",\"delayMs\":1500}"
```

Placeholder pesan yang didukung: `{nama}`, `{name}`, `{phone}`, `{no_telp}`.

## Kirim Lewat URL Saja

Gunakan endpoint ini jika sistem pemanggil tidak bisa mengirim header. API key dikirim lewat query `apikey`.

Text:

```text
http://localhost:3000/api/url/send-message?apikey=isi-api-key-anda&session=sales&phone=628123456789&message=Halo%20dari%20URL
```

Foto dari URL:

```text
http://localhost:3000/api/url/send-media?apikey=isi-api-key-anda&session=sales&phone=628123456789&type=image&url=https%3A%2F%2Fexample.com%2Ffoto.jpg&caption=Foto%20produk
```

Video dari URL:

```text
http://localhost:3000/api/url/send-media?apikey=isi-api-key-anda&session=sales&phone=628123456789&type=video&url=https%3A%2F%2Fexample.com%2Fvideo.mp4&caption=Video%20produk
```

File/dokumen dari URL:

```text
http://localhost:3000/api/url/send-media?apikey=isi-api-key-anda&session=sales&phone=628123456789&type=document&url=https%3A%2F%2Fexample.com%2Finvoice.pdf&filename=invoice.pdf&mimetype=application%2Fpdf
```

Audio dari URL:

```text
http://localhost:3000/api/url/send-media?apikey=isi-api-key-anda&session=sales&phone=628123456789&type=audio&url=https%3A%2F%2Fexample.com%2Faudio.mp3&mimetype=audio%2Fmpeg
```

URL file harus bisa diakses oleh server Node.js. Untuk produksi, lebih aman tetap memakai header `X-API-KEY` atau JWT daripada menaruh API key di URL/log.

## Websocket Events

- `qr`
- `connected`
- `disconnected`
- `message_received`
- `message_sent`
- `status_changed`

## PM2

```bash
pm2 start ecosystem.config.cjs
pm2 save
```

## Docker

```bash
docker compose up -d --build
```
