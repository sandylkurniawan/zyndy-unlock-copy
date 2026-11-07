/* Zyndy Unlock Copy - background service worker
 * Tugas: mengambil byte gambar (lintas-origin, lewat host_permissions sehingga bebas CORS),
 * menormalkan ke PNG via OffscreenCanvas, downscale bila kebesaran, lalu kirim balik base64.
 */

const MAX_DIM = 1600; // batas sisi terpanjang agar ukuran DOCX wajar

function u8ToBase64(u8) {
  let out = "";
  const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) {
    out += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  }
  return btoa(out);
}

function base64ToU8(b64) {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

async function blobToNormalizedPng(blob) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch (e) {
    return null; // format tak bisa di-decode (mis. SVG di sebagian browser)
  }
  let w = bitmap.width, h = bitmap.height;
  if (!w || !h) { if (bitmap.close) bitmap.close(); return null; }

  let tw = w, th = h;
  const longest = Math.max(w, h);
  if (longest > MAX_DIM) {
    const s = MAX_DIM / longest;
    tw = Math.max(1, Math.round(w * s));
    th = Math.max(1, Math.round(h * s));
  }

  const canvas = new OffscreenCanvas(tw, th);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, tw, th);
  if (bitmap.close) bitmap.close();

  const outBlob = await canvas.convertToBlob({ type: "image/png" });
  const buf = await outBlob.arrayBuffer();
  return { b64: u8ToBase64(new Uint8Array(buf)), ext: "png", w: tw, h: th };
}

async function fetchImage(url) {
  try {
    if (!url) return null;

    // data: URI -> langsung decode
    if (/^data:/i.test(url)) {
      const m = /^data:([^;,]*)(;base64)?,([\s\S]*)$/i.exec(url);
      if (!m) return null;
      const mime = m[1] || "image/png";
      const isB64 = !!m[2];
      let bytes;
      if (isB64) bytes = base64ToU8(m[3]);
      else bytes = new TextEncoder().encode(decodeURIComponent(m[3]));
      return await blobToNormalizedPng(new Blob([bytes], { type: mime }));
    }

    // http(s) -> fetch (SW + host_permissions => bebas CORS)
    // Fix 6: timeout 15 detik agar tidak hang pada URL yang lambat/tidak respond
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let res;
    try {
      res = await fetch(url, { credentials: "include", redirect: "follow", signal: controller.signal });
    } catch (e1) {
      if (e1 && e1.name === "AbortError") { clearTimeout(timer); return null; }
      try {
        res = await fetch(url, { credentials: "omit", redirect: "follow", signal: controller.signal });
      } catch (e2) {
        clearTimeout(timer); return null;
      }
    } finally {
      clearTimeout(timer);
    }
    if (!res || !res.ok) return null;
    const blob = await res.blob();
    if (!blob || blob.size === 0) return null;
    return await blobToNormalizedPng(blob);
  } catch (e) {
    return null;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "ZYNDY_FETCH_IMAGES") {
    (async () => {
      const out = {};
      const list = Array.isArray(msg.images) ? msg.images : [];
      // batasi paralelisme agar tidak membanjiri
      const CONC = 5;
      let i = 0;
      async function worker() {
        while (i < list.length) {
          const idx = i++;
          const item = list[idx];
          out[item.id] = await fetchImage(item.url);
        }
      }
      const workers = [];
      for (let k = 0; k < Math.min(CONC, list.length); k++) workers.push(worker());
      await Promise.all(workers);
      sendResponse({ ok: true, images: out });
    })();
    return true; // async
  }
});
