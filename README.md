# Zyndy Unlock Copy

Ekstensi Chrome (Manifest V3) dengan dua fungsi:

1. **Simpan artikel → DOCX** — mengambil **isi artikel saja** (teks + gambar), membuang
   ornamen web (navbar, iklan, sidebar, footer, komentar), lalu langsung mengunduhnya
   sebagai file **Word `.docx`** dengan gambar tertanam di dalamnya. Cocok untuk membaca
   offline, membuat catatan, atau arsip pribadi.
2. **Aktifkan kembali seleksi & copy** — memulihkan **select teks**, **copy/cut**,
   **klik kanan**, dan **drag** di halaman yang mematikannya, misalnya untuk mengutip
   sebagian teks, memakai alat bantu baca, atau menempel teks di formulir.

## Cara install (Load unpacked)

1. Buka `chrome://extensions`
2. Nyalakan **Developer mode** (pojok kanan atas)
3. Klik **Load unpacked** → pilih folder ekstensi ini
4. Pin ikon gemboknya ke toolbar biar gampang diakses

> Edge / Brave / Opera sama saja: buka halaman extensions → Developer mode → Load unpacked.

## Cara pakai

### Buka kunci copy
- **Toggle "Aktif di semua situs"** → kalau ON, ekstensi otomatis jalan tiap halaman dibuka.
- **Tombol "Buka kunci halaman ini"** → memaksa buka kunci tab aktif sekarang juga (tanpa reload).

Setelah aktif: blok teks pakai mouse seperti biasa, lalu `Ctrl/Cmd + C`, atau klik kanan → Copy.

### Simpan ke DOCX
- Buka halaman artikel → klik ikon ekstensi → tombol **"Simpan konten → DOCX"**.
- Ekstensi mengekstrak teks + gambar isi artikel, lalu file `.docx` otomatis terunduh
  (nama file = judul artikel). Akan muncul notifikasi kecil di pojok kanan-bawah halaman.

## Cara kerjanya

### Unlock
1. **Inject CSS** override `user-select: none` (+ varian webkit/moz/ms) jadi `text`.
2. **Listener fase-capture** di `window` + `document` untuk event `copy`, `cut`, `paste`,
   `contextmenu`, `selectstart`, `dragstart`. Dipasang di `document_start` (sebelum script
   halaman) lalu memanggil `stopImmediatePropagation()` — handler pemblokir halaman **tak
   pernah jalan**. Kita **tidak** `preventDefault`, jadi aksi native tetap normal.
3. **Bersih-bersih** atribut handler inline (`oncopy`, dst), inline style `user-select`, dan
   atribut `unselectable`. Node baru dipantau via `MutationObserver`.
4. Shortcut `Ctrl/Cmd + C / X / A` di-stop propagasinya. Bekerja juga di dalam `iframe`.

### DOCX
1. **Readability** (mesin Reader Mode Firefox) memisahkan konten utama dari ornamen web.
2. **Normalisasi gambar**: `<picture>`, lazy-load (`data-src`/`srcset`), URL relatif →
   absolut, dan melepas `<img>` dari dalam `<a>`.
3. **Walk DOM → model blok** (heading / paragraf / list / gambar) dengan format inline
   (tebal / miring / link).
4. **Service worker** mengambil byte tiap gambar (lewat `host_permissions`, jadi **tanpa kendala
   CORS**), menormalkannya ke PNG via `OffscreenCanvas` (downscale maks 1600px), kirim base64.
5. **Susun `.docx` (OOXML)** via JSZip: gambar tertanam inline, hyperlink eksternal, ukuran
   halaman A4, lalu unduh.

## Batasan jujur

- **Unlock**: tidak menembus paywall, login, atau konten ber-DRM. Hanya mematikan proteksi
  copy/select berbasis CSS/JS pada teks yang sudah tampil. Event `mousedown`/`mouseup`
  sengaja tak disentuh agar tombol/slider halaman tak rusak.
- **DOCX**:
  - Hanya frame utama yang diekstrak (artikel di dalam iframe tidak ikut).
  - Gambar **SVG** bisa terlewat (sebagian browser tak bisa men-decode-nya ke bitmap).
  - Halaman dengan sangat banyak gambar menghasilkan file besar (gambar di-downscale ke maks
    1600px sisi terpanjang untuk menjaga ukuran tetap wajar).
  - Tabel diratakan jadi paragraf (bukan tabel Word penuh).
  - Tidak menembus paywall/login — yang diambil hanya konten yang memang sudah tampil.

## File

```
Unlock Copy/
├── manifest.json       # MV3
├── content.js          # logika unlock (document_start, all_frames)
├── background.js       # service worker: ambil + normalisasi gambar artikel
├── docx.js             # ekstraksi konten + penyusun .docx (di-inject on-demand)
├── popup.html          # UI dark-glass
├── popup.js            # toggle + tombol force + tombol DOCX
├── lib/
│   ├── readability.js  # Mozilla Readability 0.6.0 (Apache 2.0)
│   ├── jszip.min.js    # JSZip 3.10.1 (MIT)
│   └── LICENSE-Apache-2.0.txt  # lisensi lengkap Readability
└── icons/              # 16 / 48 / 128
```

## Lisensi & credits

Kode ekstensi ini berlisensi [MIT](LICENSE) © 2026 ByZyndy.

Ekstensi ini memakai pustaka pihak ketiga berikut, masing-masing di bawah lisensi aslinya
(teks lengkap ada di [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md)):

- [Mozilla Readability](https://github.com/mozilla/readability) 0.6.0 © 2010 Arc90 Inc,
  lisensi Apache 2.0
- [JSZip](https://github.com/Stuk/jszip) 3.10.1 © Stuart Knightley dkk., lisensi MIT
  (termasuk [pako](https://github.com/nodeca/pako), lisensi MIT)

## Penggunaan yang bertanggung jawab

Ekstensi ini dibuat untuk keperluan pribadi: membaca offline, mencatat, mengutip dengan
menyebut sumber, dan aksesibilitas. **Anda bertanggung jawab mematuhi hak cipta dan
ketentuan situs yang Anda kunjungi.** Jangan gunakan untuk menyalin lalu menyebarkan ulang
atau menjual karya orang lain tanpa izin.

Perangkat lunak ini disediakan **"apa adanya" (AS IS)**, tanpa jaminan apa pun; pembuat
tidak bertanggung jawab atas penyalahgunaan oleh pengguna.

by ByZyndy
