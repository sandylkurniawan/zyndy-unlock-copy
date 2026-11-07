/* Zyndy Unlock Copy - docx.js (di-inject on-demand)
 * Alur:
 *  1) Readability ekstrak konten utama (buang navbar/iklan/sidebar/footer).
 *  2) Normalisasi DOM hasil: lazy-img, <picture>, srcset, absolutkan URL, lepas img dari <a>.
 *  3) Walk -> model blok (heading / paragraf / list / gambar) dengan run inline (bold/italic/link).
 *  4) Minta byte gambar ke service worker (lintas-origin, tanpa kendala CORS) -> base64 PNG.
 *  5) Bangun .docx (OOXML) via JSZip, gambar tertanam inline, lalu download.
 *
 * Dependensi global yang sudah di-inject lebih dulu: Readability, JSZip.
 */
(async function () {
  // ---- util UI: toast ringan di halaman ----
  function toast(text, kind) {
    try {
      let t = document.getElementById("__zyndy_toast");
      if (!t) {
        t = document.createElement("div");
        t.id = "__zyndy_toast";
        t.style.cssText =
          "position:fixed;z-index:2147483647;right:18px;bottom:18px;max-width:320px;" +
          "padding:12px 16px;border-radius:12px;font:600 13px/1.4 'Segoe UI',system-ui,sans-serif;" +
          "color:#07241f;background:#34e0c4;box-shadow:0 8px 30px rgba(0,0,0,.35);" +
          "transition:opacity .25s ease, transform .25s ease;transform:translateY(8px);opacity:0;";
        document.documentElement.appendChild(t);
      }
      t.style.background = kind === "err" ? "#ff6b6b" : (kind === "work" ? "#1b2a3a" : "#34e0c4");
      t.style.color = kind === "work" ? "#e8eef6" : (kind === "err" ? "#fff" : "#07241f");
      t.textContent = text;
      requestAnimationFrame(() => { t.style.opacity = "1"; t.style.transform = "translateY(0)"; });
      clearTimeout(t.__hide);
      if (kind !== "work") {
        t.__hide = setTimeout(() => {
          t.style.opacity = "0"; t.style.transform = "translateY(8px)";
        }, kind === "err" ? 5000 : 3500);
      }
    } catch (e) {}
  }

  function fail(msg) {
    toast(msg, "err");
    return { ok: false, error: msg };
  }

  try {
    toast("Mengekstrak konten...", "work");

    const BASE = document.baseURI || location.href;
    const PAGE_TITLE = (document.title || "konten").trim();

    function absUrl(u) {
      if (!u) return "";
      u = String(u).trim();
      if (!u || u.startsWith("javascript:")) return "";
      try { return new URL(u, BASE).href; } catch (e) { return u; }
    }

    // ---------- 1) Readability ----------
    let article = null;
    try {
      const clone = document.cloneNode(true);
      try {
        const b = clone.createElement("base");
        b.setAttribute("href", BASE);
        (clone.head || clone.documentElement).prepend(b);
      } catch (e) {}
      article = new Readability(clone, { charThreshold: 200 }).parse();
    } catch (e) { article = null; }

    // ---------- bangun container DOM dari hasil ----------
    let root = null;
    let docTitle = PAGE_TITLE;
    if (article && article.content) {
      const holder = document.implementation.createHTMLDocument("x");
      holder.body.innerHTML = article.content;
      root = holder.body;
      if (article.title) docTitle = article.title.trim();
    } else {
      // fallback: main/article, lalu body dgn pembersihan
      const cand = document.querySelector("main, article, [role='main']");
      const src = cand || document.body;
      const holder = document.implementation.createHTMLDocument("x");
      holder.body.innerHTML = src.innerHTML;
      root = holder.body;
      const junk = root.querySelectorAll(
        "script,style,noscript,template,nav,header,footer,aside,form,iframe,svg,button," +
        "input,select,textarea,[role='navigation'],[role='banner'],[role='contentinfo']," +
        ".nav,.navbar,.menu,.sidebar,.advert,.ads,.ad,.cookie,.share,.social,.comments,.comment"
      );
      junk.forEach((n) => n.remove());
    }

    // ---------- 2) Normalisasi DOM ----------
    // 2a. picture -> img
    // FIX #4: dulu hanya ambil kandidat pertama dari srcset (bisa resolusi terendah).
    // Sekarang ambil kandidat dengan width descriptor terbesar.
    root.querySelectorAll("picture").forEach((pic) => {
      let img = pic.querySelector("img");
      if (!img) {
        const src = pic.querySelector("source");
        if (src) {
          img = root.ownerDocument.createElement("img");
          const ss = src.getAttribute("srcset") || src.getAttribute("src") || "";
          if (ss) {
            // Ambil URL dengan width descriptor terbesar dari srcset
            let bestSrc = ss.split(",")[0].trim().split(/\s+/)[0], bestW = -1;
            ss.split(",").forEach(p => {
              const seg = p.trim().split(/\s+/);
              const mw = /(\d+)w/.exec(seg[1] || "");
              const w = mw ? parseInt(mw[1], 10) : 0;
              if (w > bestW) { bestW = w; bestSrc = seg[0]; }
            });
            if (bestSrc) img.setAttribute("src", bestSrc);
          }
        }
      }
      if (img) pic.replaceWith(img); else pic.remove();
    });

    // 2b. lazy-load + srcset -> src absolut; buang yg tak ada src
    function bestFromSrcset(ss) {
      if (!ss) return "";
      // ambil kandidat resolusi tertinggi
      const parts = ss.split(",").map((s) => s.trim()).filter(Boolean);
      let best = parts[0] ? parts[0].split(/\s+/)[0] : "", bestW = -1;
      for (const p of parts) {
        const seg = p.split(/\s+/);
        const url = seg[0];
        let w = 0;
        const d = seg[1] || "";
        const mw = /(\d+)w/.exec(d);
        const mx = /(\d+(?:\.\d+)?)x/.exec(d);
        if (mw) w = parseInt(mw[1], 10);
        else if (mx) w = Math.round(parseFloat(mx[1]) * 1000);
        if (w > bestW) { bestW = w; best = url; }
      }
      return best;
    }
    root.querySelectorAll("img").forEach((img) => {
      let src = img.getAttribute("src") || "";
      const isPlaceholder =
        !src ||
        /^data:image\/(gif|svg)/i.test(src) ||
        /(blank|placeholder|spacer|1x1|lazy)\.(gif|png)/i.test(src) ||
        (/^data:/.test(src) && src.length < 200);
      if (isPlaceholder) {
        const cand =
          img.getAttribute("data-src") ||
          img.getAttribute("data-original") ||
          img.getAttribute("data-lazy-src") ||
          img.getAttribute("data-lazy") ||
          bestFromSrcset(img.getAttribute("data-srcset")) ||
          bestFromSrcset(img.getAttribute("srcset")) ||
          src;
        if (cand) src = cand;
      } else if (img.getAttribute("srcset")) {
        const b = bestFromSrcset(img.getAttribute("srcset"));
        if (b) src = b;
      }
      src = absUrl(src);
      if (!src) { img.remove(); return; }
      img.setAttribute("src", src);
    });

    // 2c. lepas img dari dalam <a> agar tidak hilang saat parsing inline
    root.querySelectorAll("a img").forEach((img) => {
      const a = img.closest("a");
      if (a && a.parentNode) a.parentNode.insertBefore(img, a);
    });

    // ---------- 3) Walk -> model blok ----------
    const BLOCK = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "PRE", "FIGCAPTION"]);
    const blocks = [];
    const imageRequests = []; // {id, url}
    let imgKey = 0;

    function pushImage(imgEl) {
      const src = imgEl.getAttribute("src");
      if (!src) return;
      const id = "img" + (imgKey++);
      imageRequests.push({ id: id, url: src });
      blocks.push({ type: "image", id: id, alt: imgEl.getAttribute("alt") || "" });
    }

    function collectInline(node, fmt, runs) {
      node.childNodes.forEach((child) => {
        if (child.nodeType === 3) {
          const t = child.nodeValue.replace(/\s+/g, " ");
          if (t) runs.push(Object.assign({ text: t }, fmt));
        } else if (child.nodeType === 1) {
          const tag = child.tagName;
          if (tag === "BR") { runs.push({ br: true }); return; }
          if (tag === "IMG") { return; } // gambar inline diabaikan (ditangani level blok)
          if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") return;
          if (tag === "B" || tag === "STRONG") collectInline(child, Object.assign({}, fmt, { bold: true }), runs);
          else if (tag === "I" || tag === "EM" || tag === "CITE") collectInline(child, Object.assign({}, fmt, { italic: true }), runs);
          else if (tag === "U" || tag === "INS") collectInline(child, Object.assign({}, fmt, { underline: true }), runs);
          else if (tag === "S" || tag === "DEL" || tag === "STRIKE") collectInline(child, Object.assign({}, fmt, { strike: true }), runs);
          else if (tag === "CODE" || tag === "KBD" || tag === "SAMP" || tag === "TT") collectInline(child, Object.assign({}, fmt, { mono: true }), runs);
          else if (tag === "A") {
            const href = absUrl(child.getAttribute("href"));
            collectInline(child, Object.assign({}, fmt, href ? { href: href } : {}), runs);
          } else {
            collectInline(child, fmt, runs); // span, mark, small, sup, sub, dst.
          }
        }
      });
    }

    function inlineRuns(node, fmt) {
      const runs = [];
      collectInline(node, fmt || {}, runs);
      return runs;
    }

    function hasText(runs) {
      return runs.some((r) => r.text && r.text.trim() !== "");
    }
    function trimRuns(runs) {
      // buang br di ujung & spasi berlebih di awal/akhir
      while (runs.length && runs[0].br) runs.shift();
      while (runs.length && runs[runs.length - 1].br) runs.pop();
      return runs;
    }

    function handleList(el, ordered, level) {
      let idx = 1;
      Array.prototype.forEach.call(el.children, (li) => {
        if (li.tagName !== "LI") return;
        const runs = [];
        const nested = [];
        const imgs = [];
        Array.prototype.forEach.call(li.childNodes, (n) => {
          if (n.nodeType === 1 && (n.tagName === "UL" || n.tagName === "OL")) { nested.push(n); return; }
          if (n.nodeType === 1 && n.tagName === "IMG") { imgs.push(n); return; }
          // sisanya inline-kan: handle text node langsung, element node via collectInline
          if (n.nodeType === 3) {
            const t = n.nodeValue.replace(/\s+/g, " ");
            if (t) runs.push({ text: t });
          } else if (n.nodeType === 1) {
            collectInline(n, {}, runs);
          }
        });
        trimRuns(runs);
        if (hasText(runs)) blocks.push({ type: "list", ordered: ordered, level: level, number: idx, runs: runs });
        imgs.forEach(pushImage);
        nested.forEach((nl) => handleList(nl, nl.tagName === "OL", level + 1));
        idx++;
      });
    }

    function handleBlock(el) {
      const tag = el.tagName;
      if (/^H[1-6]$/.test(tag)) {
        const runs = trimRuns(inlineRuns(el, {}));
        if (hasText(runs)) blocks.push({ type: "heading", level: parseInt(tag[1], 10), runs: runs });
      } else if (tag === "PRE") {
        const text = el.textContent || "";
        blocks.push({ type: "pre", text: text });
      } else if (tag === "BLOCKQUOTE") {
        const runs = trimRuns(inlineRuns(el, { italic: true }));
        if (hasText(runs)) blocks.push({ type: "quote", runs: runs });
        el.querySelectorAll("img").forEach(pushImage);
      } else if (tag === "UL" || tag === "OL") {
        handleList(el, tag === "OL", 1);
      } else if (tag === "TABLE") {
        Array.prototype.forEach.call(el.querySelectorAll("tr"), (tr) => {
          const cellRuns = [];
          Array.prototype.forEach.call(tr.children, (cell, ci) => {
            if (ci > 0) cellRuns.push({ text: "    " });
            collectInline(cell, {}, cellRuns);
          });
          trimRuns(cellRuns);
          if (hasText(cellRuns)) blocks.push({ type: "para", runs: cellRuns });
        });
        el.querySelectorAll("img").forEach(pushImage);
      } else {
        // P, FIGCAPTION, DIV, FIGURE, SECTION, dll -> emit
        emit(el);
      }
    }

    function emit(container) {
      let runs = [];
      const flush = () => {
        trimRuns(runs);
        if (hasText(runs)) blocks.push({ type: "para", runs: runs });
        runs = [];
      };
      Array.prototype.forEach.call(container.childNodes, (child) => {
        if (child.nodeType === 3) {
          const t = child.nodeValue.replace(/\s+/g, " ");
          if (t.trim() || runs.length) runs.push({ text: t });
        } else if (child.nodeType === 1) {
          const tag = child.tagName;
          if (tag === "IMG") { flush(); pushImage(child); }
          else if (tag === "BR") { runs.push({ br: true }); }
          else if (tag === "A") {
            const href = absUrl(child.getAttribute("href"));
            // anchor bisa membungkus blok? jarang. perlakukan inline.
            collectInline(child, href ? { href: href } : {}, runs);
          } else if (tag === "B" || tag === "STRONG") collectInline(child, { bold: true }, runs);
          else if (tag === "I" || tag === "EM" || tag === "CITE") collectInline(child, { italic: true }, runs);
          else if (tag === "U" || tag === "INS") collectInline(child, { underline: true }, runs);
          else if (tag === "S" || tag === "DEL" || tag === "STRIKE") collectInline(child, { strike: true }, runs);
          else if (tag === "CODE" || tag === "KBD" || tag === "SAMP" || tag === "TT") collectInline(child, { mono: true }, runs);
          else if (tag === "SPAN" || tag === "MARK" || tag === "SMALL" || tag === "SUP" || tag === "SUB" ||
                   tag === "ABBR" || tag === "TIME" || tag === "Q" || tag === "LABEL" || tag === "FONT") {
            collectInline(child, {}, runs);
          } else if (BLOCK.has(tag) || tag === "UL" || tag === "OL" || tag === "TABLE" ||
                     tag === "FIGURE" || tag === "DIV" || tag === "SECTION" || tag === "ARTICLE" ||
                     tag === "MAIN" || tag === "DL" || tag === "DT" || tag === "DD" ||
                     tag === "HEADER" || tag === "FOOTER" || tag === "ASIDE") {
            flush();
            handleBlock(child);
          } else if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "IFRAME") {
            // abaikan
          } else {
            collectInline(child, {}, runs);
          }
        }
      });
      flush();
    }

    emit(root);

    if (!blocks.length) return fail("Tidak ada konten yang bisa diekstrak dari halaman ini.");

    // ---------- 4) Minta byte gambar ke service worker ----------
    let fetched = {};
    // Fix 8: batasi maks 60 gambar agar tidak OOM / terlalu lama
    const MAX_IMAGES = 60;
    if (imageRequests.length > MAX_IMAGES) {
      toast("⚠️ " + imageRequests.length + " gambar ditemukan — dibatasi " + MAX_IMAGES + " teratas.", "work");
      imageRequests.splice(MAX_IMAGES);
    }

    if (imageRequests.length) {
      toast("Mengambil " + imageRequests.length + " gambar...", "work");
      try {
        const resp = await chrome.runtime.sendMessage({ type: "ZYNDY_FETCH_IMAGES", images: imageRequests });
        if (resp && resp.images) fetched = resp.images;
      } catch (e) {
        fetched = {}; // lanjut tanpa gambar bila gagal
      }
    }

    // ---------- 5) Bangun DOCX ----------
    toast("Menyusun dokumen DOCX...", "work");

    function esc(s) {
      return String(s == null ? "" : s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    // A4 + margin 1 inci
    const PAGE_W = 11906, PAGE_H = 16838, MARGIN = 1440;
    const PRINTABLE_EMU = (PAGE_W - 2 * MARGIN) * 635; // 1 twip = 635 EMU
    const EMU_PER_PX = 9525;

    const HSZ = { 1: 36, 2: 30, 3: 28, 4: 26, 5: 24, 6: 24 }; // half-points
    const BODY_SZ = 22; // 11pt

    // relationships & media
    const imageRels = [];   // {rid, target}
    const mediaFiles = [];  // {name, b64}
    const linkRels = [];    // {rid, target}
    const linkMap = {};
    let imgIndex = 0;
    let docPrId = 1;
    let linkId = 0;

    function linkRid(href) {
      if (linkMap[href]) return linkMap[href];
      linkId++;
      const rid = "rIdLink" + linkId;
      linkMap[href] = rid;
      linkRels.push({ rid: rid, target: href });
      return rid;
    }

    function runXml(run, sz) {
      if (run.br) return "<w:r><w:br/></w:r>";
      const props = [];
      if (run.bold) props.push("<w:b/>");
      if (run.italic) props.push("<w:i/>");
      if (run.strike) props.push("<w:strike/>");
      if (run.underline || run.href) props.push('<w:u w:val="single"/>');
      if (run.href) props.push('<w:color w:val="0563C1"/>');
      if (run.mono) props.push('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>');
      const size = run.sz || sz || BODY_SZ;
      props.push('<w:sz w:val="' + size + '"/><w:szCs w:val="' + size + '"/>');
      return "<w:r><w:rPr>" + props.join("") + '</w:rPr><w:t xml:space="preserve">' + esc(run.text) + "</w:t></w:r>";
    }

    function runsXml(runs, sz) {
      let out = "";
      for (const r of runs) {
        if (r.href && !r.br && r.text) {
          out += '<w:hyperlink r:id="' + linkRid(r.href) + '" w:history="1">' + runXml(r, sz) + "</w:hyperlink>";
        } else {
          out += runXml(r, sz);
        }
      }
      return out;
    }

    function paraXml(runs, opts) {
      opts = opts || {};
      const p = [];
      if (opts.indent) p.push('<w:ind w:left="' + opts.indent + '"/>');
      if (opts.jc) p.push('<w:jc w:val="' + opts.jc + '"/>');
      if (opts.heading) { p.push('<w:spacing w:before="240" w:after="120"/>'); p.push("<w:keepNext/>"); }
      else p.push('<w:spacing w:after="160"/>');
      return "<w:p><w:pPr>" + p.join("") + "</w:pPr>" + runsXml(runs, opts.sz) + "</w:p>";
    }

    function imageXml(data, alt) {
      let cx = data.w * EMU_PER_PX;
      let cy = data.h * EMU_PER_PX;
      if (cx > PRINTABLE_EMU) { const s = PRINTABLE_EMU / cx; cx = Math.round(PRINTABLE_EMU); cy = Math.round(cy * s); }
      cx = Math.max(1, Math.round(cx)); cy = Math.max(1, Math.round(cy));

      imgIndex++;
      const name = "image" + imgIndex + ".png";
      const rid = "rIdImg" + imgIndex;
      mediaFiles.push({ name: name, b64: data.b64 });
      imageRels.push({ rid: rid, target: "media/" + name });
      const id = docPrId++;
      const altEsc = esc(alt || ("Gambar " + imgIndex));

      return "<w:p><w:pPr><w:spacing w:after=\"160\"/><w:jc w:val=\"center\"/></w:pPr>" +
        "<w:r><w:drawing>" +
        '<wp:inline distT="0" distB="0" distL="0" distR="0">' +
        '<wp:extent cx="' + cx + '" cy="' + cy + '"/>' +
        '<wp:docPr id="' + id + '" name="Picture ' + id + '" descr="' + altEsc + '"/>' +
        '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
        "<a:graphic>" +
        '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
        "<pic:pic>" +
        '<pic:nvPicPr><pic:cNvPr id="' + id + '" name="' + name + '" descr="' + altEsc + '"/><pic:cNvPicPr/></pic:nvPicPr>' +
        '<pic:blipFill><a:blip r:embed="' + rid + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
        '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm>' +
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
        "</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>";
    }

    // judul dokumen di atas
    const bodyParts = [];
    if (docTitle) bodyParts.push(paraXml([{ text: docTitle, bold: true, sz: 40 }], { heading: true, sz: 40 }));

    for (const b of blocks) {
      if (b.type === "heading") {
        bodyParts.push(paraXml(b.runs.map((r) => Object.assign({}, r, { bold: true, sz: HSZ[b.level] || 26 })),
          { heading: true, sz: HSZ[b.level] || 26 }));
      } else if (b.type === "para") {
        bodyParts.push(paraXml(b.runs, {}));
      } else if (b.type === "quote") {
        bodyParts.push(paraXml(b.runs, { indent: 720 }));
      } else if (b.type === "pre") {
        const lines = b.text.replace(/\t/g, "    ").split(/\r?\n/);
        const runs = [];
        lines.forEach((ln, i) => {
          if (i > 0) runs.push({ br: true });
          runs.push({ text: ln, mono: true });
        });
        bodyParts.push(paraXml(runs, { indent: 360 }));
      } else if (b.type === "list") {
        const prefix = b.ordered ? (b.number + ". ") : "• ";
        const runs = [{ text: prefix }].concat(b.runs);
        bodyParts.push(paraXml(runs, { indent: 360 + b.level * 360 }));
      } else if (b.type === "image") {
        const data = fetched[b.id];
        if (data && data.b64) bodyParts.push(imageXml(data, b.alt));
        else if (b.alt) bodyParts.push(paraXml([{ text: "[Gambar: " + b.alt + "]", italic: true }], {}));
      }
    }

    const sectPr =
      "<w:sectPr>" +
      '<w:pgSz w:w="' + PAGE_W + '" w:h="' + PAGE_H + '"/>' +
      '<w:pgMar w:top="' + MARGIN + '" w:right="' + MARGIN + '" w:bottom="' + MARGIN + '" w:left="' + MARGIN +
      '" w:header="720" w:footer="720" w:gutter="0"/>' +
      "</w:sectPr>";

    const documentXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
      'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
      'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
      'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      "<w:body>" + bodyParts.join("") + sectPr + "</w:body></w:document>";

    const contentTypes =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="png" ContentType="image/png"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      "</Types>";

    const rootRels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      "</Relationships>";

    let docRels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
    imageRels.forEach((r) => {
      docRels += '<Relationship Id="' + r.rid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="' + r.target + '"/>';
    });
    linkRels.forEach((r) => {
      docRels += '<Relationship Id="' + r.rid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="' + esc(r.target) + '" TargetMode="External"/>';
    });
    docRels += "</Relationships>";

    // ---------- zip ----------
    const zip = new JSZip();
    zip.file("[Content_Types].xml", contentTypes);
    zip.folder("_rels").file(".rels", rootRels);
    const word = zip.folder("word");
    word.file("document.xml", documentXml);
    word.folder("_rels").file("document.xml.rels", docRels);
    if (mediaFiles.length) {
      const media = word.folder("media");
      mediaFiles.forEach((m) => media.file(m.name, m.b64, { base64: true }));
    }

    const blob = await zip.generateAsync({
      type: "blob",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      compression: "DEFLATE",
      compressionOptions: { level: 6 }
    });

    // ---------- download ----------
    let fname = (docTitle || PAGE_TITLE || "konten")
      .replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
    if (!fname) fname = "konten";
    fname += ".docx";

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fname;
    a.style.display = "none";
    document.documentElement.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15000);

    toast("DOCX tersimpan: " + imgIndex + " gambar ✓", "ok");
    return { ok: true, images: imgIndex, blocks: blocks.length };
  } catch (e) {
    return fail("Gagal membuat DOCX: " + (e && e.message ? e.message : e));
  }
})();
