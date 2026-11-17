/* ═══════════════════════════════════════════════════════════════════════
   In-browser ROM patcher — BPS, UPS and IPS.

   Everything here runs locally in the page. The base ROM is read with the
   File API, patched in memory, and handed back through a blob URL: it is
   never uploaded, and the site has no server to upload it to. That is the
   whole reason this exists rather than a link to an external patcher.

   We distribute a patch, never a built ROM. The player brings their own
   legally obtained base ROM.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  /* ── the one block to edit per release ──────────────────────────────
     Drop the patch in docs/patches/ and point `url` at it. If the file
     isn't there yet the UI falls back to "choose the patch you
     downloaded" instead of showing a broken button.
     Cloudflare caches .bin files at its edge but not .bps, and uncached
     downloads come from GitHub Pages, which slowed to a crawl at times on
     launch day; a .bin copy of a .bps (the same bytes) downloads from the
     cache. `name` is what the player sees. */
  var PATCH = {
    url: "patches/wishes-of-tomorrow-1.3.0.bps",
    name: "wishes-of-tomorrow-1.3.0.bps",
    outputName: "Wishes of Tomorrow 1.3.0.gba",
    base: {
      name: "Pokémon Emerald (U)",
      code: "BPEE",     // GBA header game code at 0xAC
      size: 16777216    // 16 MB
    }
  };

  /* ── CRC32 ──────────────────────────────────────────────────────── */
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes, start, end) {
    start = start || 0;
    end = (end === undefined) ? bytes.length : end;
    var c = 0xffffffff;
    for (var i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function magic(bytes, len) {
    var s = "";
    for (var i = 0; i < len; i++) s += String.fromCharCode(bytes[i]);
    return s;
  }

  function hex8(n) { return n.toString(16).toUpperCase().padStart(8, "0"); }

  function PatchError(msg, detail) {
    var e = new Error(msg);
    e.detail = detail;
    return e;
  }

  /* ── shared reader ──────────────────────────────────────────────── */
  function Reader(bytes, pos) {
    this.b = bytes;
    this.pos = pos || 0;
  }
  // BPS and UPS share this variable-width number encoding: 7 bits a byte,
  // high bit marks the last byte, and each continuation adds the next
  // power so encodings stay unique. Multiplication, not shifts — these
  // values can exceed what a 32-bit shift holds.
  Reader.prototype.varint = function () {
    var data = 0, shift = 1, x;
    for (;;) {
      x = this.b[this.pos++];
      if (x === undefined) throw PatchError("The patch file is truncated.");
      data += (x & 0x7f) * shift;
      if (x & 0x80) break;
      shift *= 128;
      data += shift;
    }
    return data;
  };

  function readU32LE(b, o) {
    return ((b[o]) | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  }

  /* ── BPS ────────────────────────────────────────────────────────── */
  function applyBPS(source, patch) {
    var r = new Reader(patch, 4);
    var sourceSize = r.varint();
    var targetSize = r.varint();
    var metaSize = r.varint();
    r.pos += metaSize;

    var footer = patch.length - 12;
    if (footer < r.pos) throw PatchError("The patch file is truncated.");

    var srcCrc = readU32LE(patch, footer);
    var tgtCrc = readU32LE(patch, footer + 4);
    var ownCrc = readU32LE(patch, footer + 8);
    if (crc32(patch, 0, footer + 8) !== ownCrc) {
      throw PatchError("The patch file itself is corrupt — download it again.");
    }
    checkSource(source, sourceSize, srcCrc);

    var target = new Uint8Array(targetSize);
    var outPos = 0, srcRel = 0, tgtRel = 0;

    while (r.pos < footer) {
      var data = r.varint();
      var action = data % 4;
      var length = Math.floor(data / 4) + 1;

      if (action === 0) {                     // SourceRead
        while (length--) { target[outPos] = source[outPos]; outPos++; }
      } else if (action === 1) {              // TargetRead
        while (length--) target[outPos++] = patch[r.pos++];
      } else {                                // SourceCopy / TargetCopy
        var d = r.varint();
        var delta = (d % 2 ? -1 : 1) * Math.floor(d / 2);
        if (action === 2) {
          srcRel += delta;
          while (length--) target[outPos++] = source[srcRel++];
        } else {
          tgtRel += delta;
          // Byte at a time on purpose: the ranges are allowed to overlap,
          // which is how BPS encodes runs.
          while (length--) target[outPos++] = target[tgtRel++];
        }
      }
    }

    if (outPos !== targetSize || crc32(target) !== tgtCrc) {
      throw PatchError("The patched ROM failed its checksum. The patch may be damaged.");
    }
    return target;
  }

  /* ── UPS ────────────────────────────────────────────────────────── */
  function applyUPS(source, patch) {
    var r = new Reader(patch, 4);
    var inputSize = r.varint();
    var outputSize = r.varint();

    var footer = patch.length - 12;
    if (footer < r.pos) throw PatchError("The patch file is truncated.");

    var srcCrc = readU32LE(patch, footer);
    var tgtCrc = readU32LE(patch, footer + 4);
    var ownCrc = readU32LE(patch, footer + 8);
    if (crc32(patch, 0, footer + 8) !== ownCrc) {
      throw PatchError("The patch file itself is corrupt — download it again.");
    }
    checkSource(source, inputSize, srcCrc);

    var target = new Uint8Array(outputSize);
    target.set(source.subarray(0, Math.min(inputSize, outputSize)));

    var outPos = 0;
    while (r.pos < footer) {
      outPos += r.varint();
      for (;;) {
        var x = patch[r.pos++];
        if (x === 0) break;
        if (outPos < outputSize) target[outPos] ^= x;
        outPos++;
      }
      outPos++;
    }

    if (crc32(target) !== tgtCrc) {
      throw PatchError("The patched ROM failed its checksum. The patch may be damaged.");
    }
    return target;
  }

  /* ── IPS ────────────────────────────────────────────────────────── */
  function applyIPS(source, patch) {
    // IPS carries no checksums, so the base ROM can only be sanity-checked
    // against the GBA header. Two passes: size the output, then write it.
    var pos = 5, end = source.length;
    while (pos < patch.length) {
      if (magic(patch.subarray(pos, pos + 3), 3) === "EOF") break;
      var off = (patch[pos] << 16) | (patch[pos + 1] << 8) | patch[pos + 2];
      pos += 3;
      var size = (patch[pos] << 8) | patch[pos + 1];
      pos += 2;
      if (size === 0) {
        var run = (patch[pos] << 8) | patch[pos + 1];
        pos += 3;
        end = Math.max(end, off + run);
      } else {
        pos += size;
        end = Math.max(end, off + size);
      }
    }

    var target = new Uint8Array(end);
    target.set(source);

    pos = 5;
    while (pos < patch.length) {
      if (magic(patch.subarray(pos, pos + 3), 3) === "EOF") break;
      var o = (patch[pos] << 16) | (patch[pos + 1] << 8) | patch[pos + 2];
      pos += 3;
      var s = (patch[pos] << 8) | patch[pos + 1];
      pos += 2;
      if (s === 0) {
        var count = (patch[pos] << 8) | patch[pos + 1];
        pos += 2;
        var value = patch[pos++];
        target.fill(value, o, o + count);
      } else {
        target.set(patch.subarray(pos, pos + s), o);
        pos += s;
      }
    }
    return target;
  }

  /* ── base-ROM validation ────────────────────────────────────────── */
  function checkSource(source, expectedSize, expectedCrc) {
    if (source.length !== expectedSize) {
      throw PatchError(
        "That base ROM is the wrong size.",
        "The patch expects " + fmtBytes(expectedSize) + ", your file is " +
        fmtBytes(source.length) + ". A headered or trimmed dump won't work."
      );
    }
    if (crc32(source) !== expectedCrc) {
      throw PatchError(
        "That isn't the base ROM this patch expects.",
        "Needs CRC32 " + hex8(expectedCrc) + ", yours is " + hex8(crc32(source)) +
        ". You likely have a different region or revision."
      );
    }
  }

  function headerCode(bytes) {
    return bytes.length > 0xb0 ? magic(bytes.subarray(0xac, 0xb0), 4) : "";
  }

  function fmtBytes(n) {
    if (n >= 1048576) return (n / 1048576).toFixed(n % 1048576 ? 1 : 0) + " MB";
    if (n >= 1024) return Math.round(n / 1024) + " KB";
    return n + " bytes";
  }

  function detectAndApply(source, patch) {
    var m4 = magic(patch, 4);
    if (m4 === "BPS1") return applyBPS(source, patch);
    if (m4 === "UPS1") return applyUPS(source, patch);
    if (magic(patch, 5) === "PATCH") return applyIPS(source, patch);
    throw PatchError("That file isn't a patch.", "Expected a .bps, .ups or .ips file.");
  }


  /* ── zip support ────────────────────────────────────────────────────
     Dumps often travel as a ~6 MB .zip of the 16 MB ROM, and iOS makes
     unzipping a chore, so the patcher accepts the zip directly. Minimal
     reader: walk the central directory, take the entry that looks most
     like a GBA ROM, inflate it with the browser's DecompressionStream. */
  function isZip(b) {
    return b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
  }
  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

  function inflateRaw(bytes) {
    if (typeof DecompressionStream === "undefined") {
      return Promise.reject(PatchError("This browser can't unzip files.",
        "Unzip it yourself and choose the .gba inside."));
    }
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Response(stream).arrayBuffer().then(function (buf) { return new Uint8Array(buf); });
  }

  function unzipRom(bytes) {
    var cantRead = PatchError("Couldn't read that zip file.", "Unzip it yourself and choose the .gba inside.");
    // End-of-central-directory record: scan back past any zip comment.
    var i = bytes.length - 22, stop = Math.max(0, bytes.length - 22 - 65535);
    while (i >= stop && u32(bytes, i) !== 0x06054b50) i--;
    if (i < stop || i < 0) return Promise.reject(cantRead);
    var count = u16(bytes, i + 10), off = u32(bytes, i + 16), best = null;
    for (var n = 0; n < count && u32(bytes, off) === 0x02014b50; n++) {
      var nlen = u16(bytes, off + 28), elen = u16(bytes, off + 30), clen = u16(bytes, off + 32);
      var name = "";
      for (var c = 0; c < nlen; c++) name += String.fromCharCode(bytes[off + 46 + c]);
      var e = {
        name: name,
        method: u16(bytes, off + 10),
        csize: u32(bytes, off + 20),
        usize: u32(bytes, off + 24),
        lho: u32(bytes, off + 42),
        isGba: /\.(gba|bin)$/i.test(name)
      };
      if (!best || (e.isGba && !best.isGba) || (e.isGba === best.isGba && e.usize > best.usize)) best = e;
      off += 46 + nlen + elen + clen;
    }
    if (!best || !best.usize) return Promise.reject(PatchError("That zip file looks empty."));
    if (best.method !== 0 && best.method !== 8) return Promise.reject(cantRead);
    var lh = best.lho;
    if (u32(bytes, lh) !== 0x04034b50) return Promise.reject(cantRead);
    var start = lh + 30 + u16(bytes, lh + 26) + u16(bytes, lh + 28);
    var data = bytes.subarray(start, start + best.csize);
    var out = best.method === 0 ? Promise.resolve(new Uint8Array(data)) : inflateRaw(data);
    return out.then(function (rom) {
      return { name: best.name.split("/").pop() || best.name, bytes: rom };
    });
  }

  /* ── UI ─────────────────────────────────────────────────────────── */
  var ui = {};
  var romBytes = null, romName = "";
  var patchBytes = null, patchName = "";
  var patchAvailable = false, patchSize = 0;
  var resultUrl = null;
  // The Update tab can ask for the player's own filename instead (see setOutputName).
  var outputName = PATCH.outputName;
  var patchedRom = null, playerBooted = false;
  // A save the Update tab wants loaded once the game is running.
  var pendingSave = null;

  /* ── in-browser player ──────────────────────────────────────────────
     EmulatorJS 4.2.3 (mGBA core), loaded on demand from this site's own
     copy in assets/emulatorjs/ (GPL-3.0, see the LICENSE there). Its CDN
     stopped serving pages on other sites, so the files live here now.
     The patched ROM is handed over as a blob made from the bytes already
     in memory, so nothing is re-downloaded and the ROM never leaves the
     browser. */
  var PLAYER = {
    data: "assets/emulatorjs/",
    core: "gba"
  };

  function $(sel) { return document.querySelector(sel); }

  function say(kind, msg, detail) {
    ui.status.className = "patch-status is-" + kind;
    ui.status.innerHTML = "";
    var strong = document.createElement("strong");
    strong.textContent = msg;
    ui.status.appendChild(strong);
    if (detail) {
      var small = document.createElement("span");
      small.textContent = detail;
      ui.status.appendChild(small);
    }
  }

  function readFile(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(new Uint8Array(fr.result)); };
      fr.onerror = function () { reject(new Error("Couldn't read that file.")); };
      fr.readAsArrayBuffer(file);
    });
  }

  function refresh() {
    ui.apply.disabled = !(romBytes && (patchBytes || patchAvailable));
  }

  function setSlot(slot, name, note, ok) {
    slot.querySelector("[data-slot-name]").textContent = name;
    slot.querySelector("[data-slot-note]").textContent = note;
    slot.dataset.state = ok ? "ok" : "";
  }

  async function onRom(file) {
    if (!file) return;
    try {
      romBytes = await readFile(file);
    } catch (err) {
      say("bad", err.message);
      return;
    }
    romName = file.name;
    var fromZip = false;

    // A zipped dump is fine — unzip it here rather than sending the
    // player off to find an unzipper (a real chore on a phone).
    if (isZip(romBytes)) {
      say("busy", "Unzipping…");
      try {
        var entry = await unzipRom(romBytes);
        romBytes = entry.bytes;
        romName = entry.name || file.name;
        fromZip = true;
      } catch (err) {
        romBytes = null;
        setSlot(ui.romSlot, file.name, "couldn't unzip", false);
        say("bad", err.message, err.detail);
        refresh();
        return;
      }
    }

    var code = headerCode(romBytes);
    var note = fmtBytes(romBytes.length) + (code ? " · " + code : "") +
      (fromZip ? " · unzipped" : "");
    setSlot(ui.romSlot, romName, note, true);

    // A friendly nudge before the real checksum test runs on apply.
    if (code && PATCH.base.code && code !== PATCH.base.code) {
      say("warn", "That looks like the wrong game.",
        "The header says " + code + "; this patch is for " + PATCH.base.name +
        " (" + PATCH.base.code + "). You can still try.");
    } else if (PATCH.base.size && romBytes.length !== PATCH.base.size) {
      say("warn", "That file isn't the usual size.",
        "The base ROM is " + fmtBytes(PATCH.base.size) + " unzipped; this file is " +
        fmtBytes(romBytes.length) + ". You can still try.");
    } else {
      say("idle", "Ready when you are.");
    }
    refresh();
  }

  async function onPatch(file) {
    if (!file) return;
    try {
      patchBytes = await readFile(file);
    } catch (err) {
      say("bad", err.message);
      return;
    }
    patchName = file.name;
    setSlot(ui.patchSlot, file.name, fmtBytes(patchBytes.length), true);
    say("idle", "Ready when you are.");
    refresh();
  }

  // The patch is tens of megabytes, so it is fetched on demand rather than on
  // page load — a visitor who never patches never downloads it.
  function ensurePatch() {
    if (patchBytes) return Promise.resolve();
    say("busy", "Downloading the patch…", "This happens once.");
    return fetch(PATCH.url).then(function (res) {
      if (!res.ok) throw PatchError("Couldn't download the patch.", "The server returned " + res.status + ".");
      // A compressed transfer's length isn't the patch's size, so then the
      // progress counts up without a total.
      var total = res.headers.get("content-encoding") ? 0 : parseInt(res.headers.get("content-length") || "0", 10);
      if (!res.body || !res.body.getReader) return res.arrayBuffer();
      // Read it in pieces so a slow connection shows progress instead of a
      // status that never changes.
      var reader = res.body.getReader(), parts = [], got = 0, shown = 0;
      return (function pump() {
        return reader.read().then(function (r) {
          if (r.done) {
            var all = new Uint8Array(got), at = 0;
            parts.forEach(function (p) { all.set(p, at); at += p.length; });
            return all.buffer;
          }
          parts.push(r.value);
          got += r.value.length;
          if (got - shown > 262144) {
            shown = got;
            say("busy", "Downloading the patch…",
              (total ? fmtBytes(got) + " of " + fmtBytes(total) : fmtBytes(got) + " so far") + " — this happens once.");
          }
          return pump();
        });
      })();
    }).then(function (buf) {
      patchBytes = new Uint8Array(buf);
      setSlot(ui.patchSlot, PATCH.name, fmtBytes(patchBytes.length) + " · downloaded", true);
    });
  }

  function apply() {
    ui.apply.disabled = true;

    ensurePatch().then(function () {
      say("busy", "Patching…", "Large ROMs take a moment.");
      // Yield a frame so the status paints before the synchronous work.
      return new Promise(function (r) { setTimeout(r, 30); });
    }).then(function () {
      var out;
      try {
        out = detectAndApply(romBytes, patchBytes);
      } catch (err) {
        say("bad", err.message, err.detail);
        ui.apply.disabled = false;
        return;
      }

      if (resultUrl) URL.revokeObjectURL(resultUrl);
      resultUrl = URL.createObjectURL(new Blob([out], { type: "application/octet-stream" }));
      ui.result.href = resultUrl;
      ui.result.download = outputName;
      ui.result.hidden = false;
      // Short label for the quest row's button; the full name goes in the title.
      ui.result.textContent = "Save (" + fmtBytes(out.length) + ")";
      ui.result.title = "Save " + outputName;

      patchedRom = out;
      if (ui.play) {
        ui.play.disabled = false;
        ui.play.removeAttribute("title");
      }
      say("ok", "Done — your patched ROM is ready.",
        "Nothing left this page; the file was built in your browser.");
      ui.apply.disabled = false;
    }).catch(function (err) {
      say("bad", err.message || "Something went wrong.", err.detail);
      ui.apply.disabled = false;
    });
  }

  /* ── fast-forward as a toggle ─────────────────────────────────────
     The emulator's on-screen "Fast" button only fast-forwards while held,
     which is miserable on a phone. Rebinding it to the persistent
     "Fast Forward" setting (the same one in the emulator's settings menu)
     turns it into a press-on / press-off toggle. Cloning the element
     drops the emulator's own hold listeners. */
  function makeFastForwardToggle() {
    var em = window.EJS_emulator;
    var btn = document.querySelector("#game .b_speed_fast");
    if (!em || !btn || !em.changeSettingOption) return;
    var clone = btn.cloneNode(true);
    btn.parentNode.replaceChild(clone, btn);
    function flip(e) {
      e.preventDefault();
      var on = !em.isFastForward;
      em.changeSettingOption("fastForward", on ? "enabled" : "disabled");
      clone.classList.toggle("ejs_virtualGamepad_button_down", on);
      em.displayMessage(on ? "FAST FORWARD ON" : "FAST FORWARD OFF");
    }
    clone.addEventListener("touchstart", flip);
    clone.addEventListener("mousedown", flip);
  }

  /* ── keep the emulator menu behind the ☰ button ───────────────────
     EmulatorJS opens its menu bar on any click on the game container,
     and its attempt to ignore touch-generated clicks checks
     e.pointerType === "touch" — a field iOS Safari's click events don't
     carry. So on iPhones, stray taps near the on-screen controls popped
     the menu mid-game. This capture-phase listener swallows clicks that
     land on the bare game area (canvas, virtual gamepad, or the
     container itself) before that menu listener sees them. The ☰ button
     and the menu's own controls are untouched. */
  function restrictMenuToButton() {
    var em = window.EJS_emulator;
    if (!em || !em.elements || !em.elements.parent) return;
    var parent = em.elements.parent;
    parent.addEventListener("click", function (e) {
      var t = e.target;
      if (!t) return;
      if (em.elements.menuToggle && em.elements.menuToggle.contains(t)) return;
      var bare = t === parent || t === em.game || t === em.canvas ||
        (em.virtualGamepad && em.virtualGamepad.contains(t));
      if (bare) e.stopPropagation();
    }, true);
  }

  /* ── fullscreen ─────────────────────────────────────────────────────
     Native Fullscreen API where it exists; on iPhone (which has no
     Fullscreen API for elements) the same button falls back to a
     fixed-position overlay that fills the visual viewport. */
  var fsActive = false;
  function setFs(on) {
    fsActive = on;
    ui.player.classList.toggle("is-fs", on);
    document.documentElement.classList.toggle("has-fs-player", on);
    if (ui.fs) ui.fs.textContent = on ? "Exit fullscreen" : "Fullscreen";
    // Nudge the emulator to re-measure its canvas.
    window.dispatchEvent(new Event("resize"));
  }
  function toggleFs() {
    var native = document.fullscreenEnabled && ui.player.requestFullscreen;
    if (!fsActive) {
      setFs(true);
      if (native) ui.player.requestFullscreen().catch(function () {});
    } else {
      if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen();
      setFs(false);
    }
  }

  function bootPlayer() {
    var btn = ui.activePlay || ui.play;
    if (!patchedRom) return;
    ui.player.hidden = false;
    ui.player.scrollIntoView({ block: "center", behavior: "smooth" });
    if (playerBooted) return;
    playerBooted = true;

    btn.disabled = true;
    btn.textContent = "Loading emulator…";

    // EmulatorJS is configured through globals that its loader reads.
    window.EJS_player = "#game";
    window.EJS_core = PLAYER.core;
    window.EJS_pathtodata = PLAYER.data;
    window.EJS_gameUrl = URL.createObjectURL(new Blob([patchedRom], { type: "application/octet-stream" }));
    window.EJS_gameName = "Wishes of Tomorrow";
    window.EJS_color = "#7614d8";
    window.EJS_backgroundColor = "#100d14";
    window.EJS_startButtonName = "PRESS START";
    window.EJS_alignStartButton = "center";
    // Menu entries we have no use for: cheats, the download cache manager,
    // and Exit (the Close button above the stage already does that).
    window.EJS_Buttons = { cheat: false, cacheManager: false, exitEmulation: false };
    window.EJS_defaultOptions = { "ff-ratio": "3.0" };
    window.EJS_startOnLoaded = true;
    window.EJS_onGameStart = function () {
      btn.disabled = false;
      btn.textContent = "Playing";
      var supplied = !!pendingSave;
      if (pendingSave) loadSave();
      makeFastForwardToggle();
      restrictMenuToButton();
      startKeeping(supplied);
    };

    var s = document.createElement("script");
    s.src = PLAYER.data + "loader.js";
    s.onerror = function () {
      playerBooted = false;
      btn.disabled = false;
      btn.textContent = btn === ui.play ? "Play in browser" : "Play";
      say("bad", "Couldn't load the emulator.",
        "The player didn't download — check your connection, or reload the page and press Play again. Your patched ROM is still ready to save.");
    };
    document.body.appendChild(s);
  }

  /* ── a save from another emulator ─────────────────────────────────
     The same steps as EmulatorJS's own "Import save" menu item: write the
     file where the core keeps its save, load it, then restart so the game
     reads it at boot like a cartridge would. Only the 128 KB of flash is
     written; an mGBA RTC trailer means nothing to the core. */
  function loadSave() {
    var gm = window.EJS_emulator && window.EJS_emulator.gameManager;
    if (!gm || !gm.getSaveFilePath) return;
    var bytes = pendingSave;
    pendingSave = null;
    try {
      var path = gm.getSaveFilePath(), FS = gm.FS, dir = "";
      path.split("/").slice(0, -1).forEach(function (part) {
        if (!part) return;
        dir += "/" + part;
        if (!FS.analyzePath(dir).exists) FS.mkdir(dir);
      });
      if (FS.analyzePath(path).exists) FS.unlink(path);
      FS.writeFile(path, bytes.subarray(0, 0x20000));
      gm.loadSaveFiles();
      gm.restart();
    } catch (e) {
      say("bad", "Couldn't load your save into the player.", String(e && e.message || e));
    }
  }

  /* ── keeping the game between visits ──────────────────────────────
     EmulatorJS keeps the cartridge save in this browser (IndexedDB, under
     the game's name), but only writes it there every 5 minutes, so a
     refresh soon after saving in the game lost it. Worse, on every
     beforeunload it ends the game by writing the save and unmounting its
     storage, and a page that dies in the middle of that leaves the save
     deleted from storage. So here:
     - the core writes its save every 5 seconds while playing, and when
       the tab is hidden (switching tabs or apps);
     - each new save is also copied into this site's own store in one
       write, which lands whole or not at all;
     - on beforeunload (this listener is added before EmulatorJS's) the
       save is written and copied one last time, and EmulatorJS's own
       exit writes are switched off for the unload;
     - on every boot, the copy goes back in if EmulatorJS's own is missing
       or older (a save loaded through the Update tab wins over both).
     The patched ROM is kept too, so a returning player gets "Continue"
     instead of patching again. None of it leaves the device, and any
     storage failure (private mode, a full disk) just means the old
     patch-again route. */
  var KEEP = { db: "wot-player", store: "keep" };
  var keepTimer = null, keepTicks = 0, leaving = false, lastSaveCrc = null;

  // One connection, kept open: a write during beforeunload has to be
  // issued right away, not after an open that may never finish.
  var keepConn = null;
  function keepDb() {
    if (keepConn) return Promise.resolve(keepConn);
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) return reject(new Error("no IndexedDB"));
      var req = indexedDB.open(KEEP.db, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore(KEEP.store); };
      req.onsuccess = function () {
        keepConn = req.result;
        keepConn.onversionchange = function () { keepConn.close(); keepConn = null; };
        resolve(keepConn);
      };
      req.onerror = function () { reject(req.error); };
    });
  }
  function keepTx(mode, work) {
    return keepDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(KEEP.store, mode), out = work(tx.objectStore(KEEP.store));
        tx.oncomplete = function () { resolve(out && out.result); };
        tx.onerror = tx.onabort = function () { reject(tx.error); };
      });
    });
  }
  function keepGet(key) { return keepTx("readonly", function (st) { return st.get(key); }); }

  // The cartridge save: the core writes it to its file (EmulatorJS's
  // storage), then a copy goes to this site's store if it changed.
  function keepSave(evenIfLeaving) {
    var em = window.EJS_emulator, gm = em && em.gameManager, bytes;
    if ((leaving && !evenIfLeaving) || !em || !em.started || !gm || !gm.saveSaveFiles || gm.saveSaveFiles === noWrite) return;
    try {
      gm.saveSaveFiles();
      bytes = gm.getSaveFile(false);
    } catch (e) { return; /* the core is busy; next tick */ }
    if (!bytes || !bytes.length) return;
    var sum = crc32(bytes);
    if (sum === lastSaveCrc) return;
    var copy = new Uint8Array(bytes);
    keepTx("readwrite", function (st) { st.put({ bytes: copy, at: Date.now() }, "save"); })
      .then(function () { lastSaveCrc = sum; }).catch(function () {});
  }
  // On boot: put the kept copy back if EmulatorJS's own is missing or older.
  function restoreSave() {
    return keepGet("save").then(function (copy) {
      var gm = window.EJS_emulator && window.EJS_emulator.gameManager;
      if (!copy || !copy.bytes || !gm || !gm.getSaveFilePath) return;
      var path = gm.getSaveFilePath(), fileAt = 0, exists = false;
      try {
        exists = gm.FS.analyzePath(path).exists;
        if (exists) fileAt = +gm.FS.stat(path).mtime;
      } catch (e) { /* treat as missing */ }
      lastSaveCrc = crc32(copy.bytes);
      if (exists && fileAt >= copy.at - 1000) return;
      pendingSave = copy.bytes instanceof Uint8Array ? copy.bytes : new Uint8Array(copy.bytes);
      loadSave();
    }).catch(function () {});
  }
  function touchPlayed() {
    keepGet("meta").then(function (meta) {
      if (!meta) return;
      meta.playedAt = Date.now();
      return keepTx("readwrite", function (st) { st.put(meta, "meta"); });
    }).catch(function () {});
  }
  function noWrite() {}
  function onBeforeUnload() {
    keepSave(true);
    leaving = true;
    var gm = window.EJS_emulator && window.EJS_emulator.gameManager;
    if (!gm || !gm.saveSaveFiles || gm.saveSaveFiles === noWrite) return;
    var real = gm.saveSaveFiles;
    gm.saveSaveFiles = noWrite;
    // Still here a second later: the unload was called off.
    setTimeout(function () { gm.saveSaveFiles = real; leaving = false; }, 1000);
  }

  // A page that is unloading also turns hidden, and its pagehide comes in
  // the same moment; a short wait tells the two apart, so switching tabs
  // or apps writes the save but a refresh or a closed tab doesn't.
  function onHidden() {
    if (document.visibilityState !== "hidden") return;
    setTimeout(function () {
      if (!leaving && document.visibilityState === "hidden") { keepSave(); touchPlayed(); }
    }, 100);
  }
  function onPageHide(e) {
    if (!e.persisted) leaving = true;
    touchPlayed();
  }
  function startKeeping(supplied) {
    if (keepTimer) return;
    window.addEventListener("pageshow", function () { leaving = false; });
    (supplied ? Promise.resolve() : restoreSave()).then(function () {
      keepTimer = setInterval(function () {
        keepSave();
        if (++keepTicks % 12 === 0) touchPlayed();
      }, 5000);
    });
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onPageHide);
    // The ROM itself, once per version.
    var rom = patchedRom;
    if (!rom) return;
    var crc = hex8(crc32(rom));
    keepGet("meta").then(function (meta) {
      if (meta && meta.crc === crc) return touchPlayed();
      return keepTx("readwrite", function (st) {
        st.put(rom, "rom");
        st.put({ crc: crc, name: outputName, size: rom.length, keptAt: Date.now(), playedAt: Date.now() }, "meta");
      });
    }).catch(function () {});
  }
  function forgetKept() {
    return keepTx("readwrite", function (st) { st.delete("rom"); st.delete("meta"); }).catch(function () {});
  }

  function whenText(t) {
    var d = new Date(t), now = new Date();
    var time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (d.toDateString() === now.toDateString()) return "today at " + time;
    var y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return "yesterday at " + time;
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  }

  // A returning player: a "Continue" row on top of the patch steps.
  function offerContinue(root) {
    var list = root.querySelector('[data-panel="patch-new"] .ff-quest-list');
    if (!list) return;
    keepGet("meta").then(function (meta) {
      if (!meta || !meta.crc) return;
      var row = document.createElement("li");
      row.className = "ff-quest-row";
      row.setAttribute("data-continue", "");
      row.innerHTML =
        '<span class="ff-quest-num" aria-hidden="true">&#9654;</span>' +
        '<div style="min-width: 0;"><div class="ff-quest-name">Continue your game</div>' +
        '<div class="ff-quest-sub">Kept in this browser, last played <span data-continue-when></span>. ' +
        '<button type="button" data-continue-forget style="background: none; border: 0; padding: 0; color: inherit; font: inherit; text-decoration: underline; cursor: pointer;">Forget it</button></div></div>' +
        '<div class="ff-quest-end"><button type="button" class="ff-btn ff-btn--violet ff-btn--sm" data-continue-play>Continue</button></div>';
      row.querySelector("[data-continue-when]").textContent = whenText(meta.playedAt || meta.keptAt);
      list.insertBefore(row, list.firstChild);
      var btn = row.querySelector("[data-continue-play]");
      btn.addEventListener("click", function () {
        if (playerBooted) { ui.player.hidden = false; ui.player.scrollIntoView({ block: "center", behavior: "smooth" }); return; }
        btn.disabled = true;
        btn.textContent = "Loading…";
        keepGet("rom").then(function (rom) {
          if (!rom || !rom.length) throw new Error("gone");
          patchedRom = rom instanceof Uint8Array ? rom : new Uint8Array(rom);
          outputName = meta.name || outputName;
          ui.activePlay = btn;
          bootPlayer();
        }).catch(function () {
          row.remove();
          say("bad", "Your kept game is gone from this browser.", "Patch your ROM again below; your save is still here and loads when you press Play.");
        });
      });
      row.querySelector("[data-continue-forget]").addEventListener("click", function () {
        forgetKept().then(function () { row.remove(); });
      });
    }).catch(function () {});
  }

  function closePlayer() {
    if (fsActive) toggleFs();
    ui.player.hidden = true;
    // Silence it rather than tear it down, so reopening is instant.
    try {
      if (window.EJS_emulator && window.EJS_emulator.pause) window.EJS_emulator.pause();
    } catch (e) { /* emulator not ready yet */ }
  }

  /* ── wiring ─────────────────────────────────────────────────────── */
  function init() {
    var root = $("[data-patcher]");
    if (!root) return;

    ui.status = root.querySelector("[data-patch-status]");
    ui.apply = root.querySelector("[data-patch-apply]");
    ui.result = root.querySelector("[data-patch-result]");
    ui.romSlot = root.querySelector("[data-slot=rom]");
    ui.patchSlot = root.querySelector("[data-slot=patch]");
    ui.romInput = root.querySelector("#rom-file");
    ui.patchInput = root.querySelector("#patch-file");

    ui.play = root.querySelector("[data-patch-play]");
    ui.player = root.querySelector("[data-player]");
    offerContinue(root);
    // Before EmulatorJS adds its own (it does when the player boots).
    window.addEventListener("beforeunload", onBeforeUnload);

    ui.romInput.addEventListener("change", function () { onRom(this.files[0]); });
    ui.patchInput.addEventListener("change", function () { onPatch(this.files[0]); });
    ui.apply.addEventListener("click", apply);
    if (ui.play) ui.play.addEventListener("click", function () { ui.activePlay = ui.play; bootPlayer(); });
    var closeBtn = root.querySelector("[data-player-close]");
    if (closeBtn) closeBtn.addEventListener("click", closePlayer);
    ui.fs = root.querySelector("[data-player-fs]");
    if (ui.fs) ui.fs.addEventListener("click", toggleFs);
    // Leaving native fullscreen via Esc or a system gesture: drop the overlay.
    document.addEventListener("fullscreenchange", function () {
      if (!document.fullscreenElement && fsActive) setFs(false);
    });

    // Drag and drop onto either slot.
    [[ui.romSlot, onRom], [ui.patchSlot, onPatch]].forEach(function (pair) {
      var el = pair[0], handler = pair[1];
      ["dragenter", "dragover"].forEach(function (ev) {
        el.addEventListener(ev, function (e) { e.preventDefault(); el.dataset.drop = "1"; });
      });
      ["dragleave", "drop"].forEach(function (ev) {
        el.addEventListener(ev, function () { delete el.dataset.drop; });
      });
      el.addEventListener("drop", function (e) {
        e.preventDefault();
        if (e.dataTransfer.files.length) handler(e.dataTransfer.files[0]);
      });
    });

    setSlot(ui.romSlot, "No file chosen",
      PATCH.base.name + " · " + fmtBytes(PATCH.base.size) + " · .gba or .zip", false);

    // Only ask whether the patch exists and how big it is — a HEAD request,
    // not the file itself. The bytes come down when the player presses Apply.
    // no-store: a cached HEAD waits behind any download of the same file
    // still in progress (another tab), which left the page on "Loading".
    // If the server is slow to answer, carry on without the size.
    var slow = new Promise(function (resolve) { setTimeout(function () { resolve(null); }, 6000); });
    Promise.race([fetch(PATCH.url, { method: "HEAD", cache: "no-store" }), slow]).then(function (res) {
      if (res && !res.ok) throw new Error(String(res.status));
      patchAvailable = true;
      // (a compressed answer's length is not the patch's size)
      patchSize = res && !res.headers.get("content-encoding") ? parseInt(res.headers.get("content-length") || "0", 10) : 0;
      patchName = PATCH.name;
      setSlot(ui.patchSlot, patchName,
        (patchSize ? fmtBytes(patchSize) + " · " : "") + "downloads when you patch", true);
      root.dataset.patchReady = "1";
      // Only fill in the size. The href stays on the release asset so the
      // download registers with GitHub and feeds the counter; pointing it at
      // this local copy would make that number permanently zero.
      document.querySelectorAll("[data-patch-link] .dl-meta").forEach(function (meta) {
        meta.textContent = (patchSize ? fmtBytes(patchSize) + " " : "") + "↓";
      });
      say("idle", "Choose your base ROM to begin.");
      refresh();
    }).catch(function () {
      // No published patch yet: fall back to letting the player supply one.
      setSlot(ui.patchSlot, "No file chosen", "Choose the .bps you downloaded", false);
      root.dataset.patchManual = "1";
      say("idle", "Choose your base ROM and the patch file to begin.");
      refresh();
    });

    refresh();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // Exposed so the patch engine can be exercised directly against known
  // fixtures without driving the file inputs.
  window.WoTPatcher = {
    crc32: crc32,
    applyBPS: applyBPS,
    applyUPS: applyUPS,
    applyIPS: applyIPS,
    detectAndApply: detectAndApply,
    isZip: isZip,
    unzipRom: unzipRom,
    // For assets/updater.js: name the next patched ROM after the player's
    // old file, and boot the player with a ROM the Update tab built.
    setOutputName: function (name) {
      outputName = name || PATCH.outputName;
      if (ui.result && !ui.result.hidden) {
        ui.result.download = outputName;
        ui.result.title = "Save " + outputName;
      }
    },
    patchUrl: PATCH.url,
    // An already-running player keeps its ROM; a save still loads into it.
    play: function (bytes, button, save) {
      pendingSave = save || null;
      if (playerBooted) {
        ui.player.hidden = false;
        ui.player.scrollIntoView({ block: "center", behavior: "smooth" });
        if (pendingSave && window.EJS_emulator && window.EJS_emulator.started) loadSave();
        return;
      }
      patchedRom = bytes;
      ui.activePlay = button;
      bootPlayer();
    }
  };
})();
