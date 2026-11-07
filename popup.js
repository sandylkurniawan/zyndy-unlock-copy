/* Zyndy Unlock Copy - popup */
var KEY = "zyndy_unlock";
var toggle = document.getElementById("toggle");
var statusEl = document.getElementById("status");
var statusText = document.getElementById("status-text");
var forceBtn = document.getElementById("force");

function setStatus(on) {
  statusText.textContent = on ? "Aktif di semua situs" : "Nonaktif";
  statusEl.className = on ? "status on" : "status";
}

// Muat status awal
chrome.storage.local.get(KEY, function (res) {
  var enabled = !!(res[KEY] && res[KEY].enabled);
  toggle.checked = enabled;
  setStatus(enabled);
});

// Ubah toggle global -> content script semua tab bereaksi via storage.onChanged
toggle.addEventListener("change", function () {
  var enabled = toggle.checked;
  chrome.storage.local.set({ "zyndy_unlock": { enabled: enabled } });
  setStatus(enabled);
});

// Tombol force: buka kunci tab aktif sekarang juga
forceBtn.addEventListener("click", async function () {
  var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  var tab = tabs && tabs[0];
  if (!tab || !tab.id) return;

  var original = forceBtn.textContent;
  forceBtn.disabled = true;
  forceBtn.textContent = "Membuka...";

  try {
    await chrome.tabs.sendMessage(tab.id, { type: "ZYNDY_FORCE" });
  } catch (e) {
    // Content script belum ada (mis. baru install, halaman belum di-reload) -> suntik dulu
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        files: ["content.js"]
      });
      // Fix 3: cek apakah force benar-benar berhasil setelah inject
      var sent = false;
      try { await chrome.tabs.sendMessage(tab.id, { type: "ZYNDY_FORCE" }); sent = true; } catch (e2) {}
      if (!sent) {
        forceBtn.textContent = "Coba reload halaman";
        setTimeout(function () { forceBtn.textContent = original; forceBtn.disabled = false; }, 1800);
        return;
      }
    } catch (err) {
      forceBtn.textContent = "Tidak bisa di sini";
      setTimeout(function () { forceBtn.textContent = original; forceBtn.disabled = false; }, 1400);
      return;
    }
  }

  forceBtn.textContent = "Terbuka \u2713";
  setTimeout(function () { forceBtn.textContent = original; forceBtn.disabled = false; }, 1300);
});

// Tombol "Simpan konten -> DOCX": inject lib + docx.js ke tab aktif (frame utama)
var docxBtn = document.getElementById("docx");
docxBtn.addEventListener("click", async function () {
  var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  var tab = tabs && tabs[0];
  if (!tab || !tab.id) return;

  var url = tab.url || "";
  if (/^(chrome|edge|about|chrome-extension|devtools):/i.test(url) || url.indexOf("chrome.google.com/webstore") !== -1) {
    docxBtn.textContent = "Tidak bisa di halaman ini";
    setTimeout(function () { docxBtn.textContent = "Simpan konten \u2192 DOCX"; }, 1600);
    return;
  }

  var original = docxBtn.innerHTML;
  docxBtn.disabled = true;
  docxBtn.textContent = "Memproses...";

  // FIX #2: simpan referensi timer agar bisa dibatalkan jika proses selesai lebih cepat
  // Timer panjang (120 detik) diperlukan karena 60 gambar @15s timeout = bisa makan waktu lama.
  // Sebelumnya 2200ms → user bisa klik lagi di tengah proses (trigger download ganda).
  var resetTimer = setTimeout(function () { docxBtn.innerHTML = original; docxBtn.disabled = false; }, 120000);

  try {
    var results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },          // hanya frame utama
      files: ["lib/readability.js", "lib/jszip.min.js", "docx.js"]
    });
    var res = results && results[0] && results[0].result;
    if (res && res.ok) {
      docxBtn.textContent = "Tersimpan \u2713 (" + res.images + " gambar)";
    } else if (res && res.error) {
      docxBtn.textContent = "Gagal: " + res.error.slice(0, 40);
    } else {
      // FIX #1: res undefined terjadi jika docx.js throw sebelum return, atau halaman
      // tidak mengijinkan executeScript return value. Sebelumnya: "Memproses di tab..."
      // yang muncul dan tidak ter-reset dengan cepat. Sekarang pesan lebih jelas.
      docxBtn.textContent = "Gagal: coba reload halaman";
    }
  } catch (e) {
    docxBtn.textContent = "Tidak bisa di sini";
  }

  // Selesai (sukses/gagal) — batalkan timer panjang, reset segera dengan delay pendek
  clearTimeout(resetTimer);
  setTimeout(function () { docxBtn.innerHTML = original; docxBtn.disabled = false; }, 2200);
});
