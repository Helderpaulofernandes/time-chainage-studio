// Playback export: draws each frame offline (title strip, chart at the play date, legend) and encodes it as MP4.
// MP4 uses the browser's WebCodecs encoder and mp4-muxer (loaded only when needed); WebM via MediaRecorder is the fallback.
import { renderChart, renderLegend, activeAt, geometry } from "./render.js";
import { renderCorridor } from "./corridor.js";
import { logoSvg, logoWidth, onColour } from "./brand.js";
import { niceDate, esc, DAY, DOW } from "./util.js";

const FONT = "IBM Plex Sans Condensed, Arial Narrow, Arial, sans-serif";
const MUXER_URL = "https://cdn.jsdelivr.net/npm/mp4-muxer@5.1.3/build/mp4-muxer.min.js";

function loadScript(src) {
  return new Promise((res, rej) => {
    if ([...document.scripts].some(s => s.src === src)) return res();
    const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("Could not load the video library. Check the internet connection."));
    document.head.append(s);
  });
}

// The corridor view sized for a frame: in "both" it takes at most 45% of the height (lanes shrink rather than the chart),
// on its own its lanes grow to fill the frame.
function corridorFor(p, t, w, h, mode, phase, compact) {
  const base = { width: w, compact, playTime: t, hideDate: true, phase };
  let r = renderCorridor(p, base);
  const fixed = r.C.lanesTop + 8, n = Math.max(1, r.C.lanes.length);
  const room = mode === "both" ? h * 0.45 : h;
  const lh = mode === "both" ? (r.height > room ? Math.max(10, (room - fixed) / n) : null) : Math.min(60, Math.max(10, (room - fixed) / n));
  if (lh) r = renderCorridor(p, { ...base, laneHeight: lh });
  return r;
}

// The chart for a frame. weeks = 0 fits the whole programme into the height; otherwise the chart shows that many
// weeks at a readable scale and follows the date line (kept 40% down), with its header and chainage axis fixed on top.
function chartFor(p, t, x, y, w, h, { compact, header, weeks }) {
  const noHeader = !header;
  if (!weeks) {
    const { svg, G } = renderChart(p, { width: w, height: h, compact, playTime: t, noHeader });
    return `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="0 0 ${G.W} ${G.H}" preserveAspectRatio="xMidYMin meet">${svg}</svg>`;
  }
  const g0 = geometry(p, { width: w, compact, noHeader }), s = w / g0.W;
  const topH = g0.top * s, gridOut = h - topH - 4;
  if (gridOut < 40) return chartFor(p, t, x, y, w, h, { compact, header, weeks: 0 });
  const gridV = gridOut / s;
  const { svg, G } = renderChart(p, { width: w, ppd: gridV / (weeks * 7), compact, playTime: t, noHeader });
  if (G.GH <= gridV) return `<svg x="${x}" y="${y}" width="${w}" height="${(G.H * s).toFixed(1)}" viewBox="0 0 ${G.W} ${G.H}">${svg}</svg>`;
  const y0 = Math.max(G.top, Math.min(G.top + G.GH - gridV, G.Y(t) - gridV * 0.4));
  return `<svg x="${x}" y="${y}" width="${w}" height="${topH.toFixed(1)}" viewBox="0 0 ${G.W} ${G.top}">${svg}</svg>` +
    `<svg x="${x}" y="${(y + topH).toFixed(1)}" width="${w}" height="${gridOut.toFixed(1)}" viewBox="0 ${y0.toFixed(1)} ${G.W} ${gridV.toFixed(1)}">${svg}</svg>` +
    `<rect x="${x + G.L * s}" y="${(y + topH).toFixed(1)}" width="${((G.R - G.L) * s).toFixed(1)}" height="${gridOut.toFixed(1)}" fill="none" stroke="#5D6B70"/>`;
}

// Default chart window: follow the date over 13 weeks when the corridor shares the frame, else the whole programme.
export const defaultWeeks = mode => (mode === "both" ? 13 : 0);

// One frame as an SVG string of size W x H. mode: "chart" | "corridor" | "both".
export function frameSvg(p, t, W, H, { mode = "chart", phase = 0, header = true, weeks = defaultWeeks(mode) } = {}) {
  const head = Math.round(H * 0.085), legendW = Math.round(W * 0.17), pad = 12, compact = W < 1500;
  const ds = (p.datasets.find(d => d.id === p.view.main_dataset) || {}).name || "";
  const n = activeAt(p, t).length, d = new Date(t);
  const aw = W - legendW - pad * 3, ah = H - head - pad * 2;
  let cor = "", corH = 0;
  if (mode === "corridor" || mode === "both") {
    const r = corridorFor(p, t, aw, ah, mode, phase, compact);
    corH = Math.min(ah, r.height);
    cor = `<svg x="${pad}" y="${head + pad}" width="${aw}" height="${corH}" viewBox="0 0 ${r.width} ${r.height}" preserveAspectRatio="xMinYMin meet">${r.svg}</svg>`;
  }
  const gap = cor ? 8 : 0, chH = ah - corH - gap;
  let chartSvg = "";
  if (mode !== "corridor" && chH > 40) {
    chartSvg = chartFor(p, t, pad, head + pad + corH + gap, aw, chH, { compact, header, weeks });
  }
  const lg = renderLegend(p, { size: 11 });
  const lgScale = Math.min(1, (H - head - pad * 2) / Math.max(1, lg.height));
  const ts = Math.round(head * 0.36), ss = Math.round(head * 0.2);
  const br = p.brand, bg = (br && br.colour) || "#18262B", fg = onColour(bg), fg2 = fg === "#FFFFFF" ? "#C9D2D2" : "#5D6B70";
  const lh = head - pad, lw = logoWidth(br, lh - 8, W * 0.16);
  const logo = lw ? `<rect x="${pad}" y="${pad / 2}" width="${lw + 12}" height="${lh}" rx="3" fill="#fff"/>` + logoSvg(br, pad + 6, pad / 2 + 4, lw, lh - 8) : "";
  const tx = lw ? pad * 2 + lw + 16 : pad * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">
    <rect width="${W}" height="${H}" fill="#fff"/>
    <rect width="${W}" height="${head}" fill="${bg}"/>${logo}
    <text x="${tx}" y="${head * 0.48}" font-size="${ts}" font-weight="700" fill="${fg}">${esc(p.meta.title || p.name)}</text>
    <text x="${tx}" y="${head * 0.82}" font-size="${ss}" fill="${fg2}">${esc(ds)}</text>
    <text x="${W - pad * 2}" y="${head * 0.5}" font-size="${ts}" font-weight="700" fill="${fg}" text-anchor="end">${esc(DOW[d.getUTCDay()] + " " + niceDate(t))}</text>
    <text x="${W - pad * 2}" y="${head * 0.82}" font-size="${ss}" fill="${fg2}" text-anchor="end">${n ? `${n} activit${n === 1 ? "y" : "ies"} under way` : "nothing under way"}</text>
    ${cor}${chartSvg}
    <g transform="translate(${W - legendW - pad} ${head + pad}) scale(${lgScale})">${lg.svg}</g>
  </svg>`;
}

// Decode an SVG string into an image that can be drawn (with any opacity) many times.
async function svgImage(svg) {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try { const img = new Image(); img.src = url; await img.decode(); return img; } finally { URL.revokeObjectURL(url); }
}

// Background colour of the intro / outro cards: "white", "brand" or "black"
export function cardBg(p, bg) { return bg === "black" ? "#000000" : bg === "brand" ? ((p.brand && p.brand.colour) || "#18262B") : "#FFFFFF"; }

// Intro / outro card, in two layers so they can fade separately: the logo, and the text under it.
// o: { bg, title, subtitle, details, line, content, tagline } (blank title / subtitle use the project's own)
// content: "project" (logo + project name, the default), "logo" (logo only), "tagline" (logo + tagline), "name" (project name only)
export function cardSvg(p, W, H, layer, o = {}) {
  const br = p.brand, m = p.meta || {}, bgc = cardBg(p, o.bg), onBg = onColour(bgc);
  let content = o.content || "project";
  if ((content === "logo" || content === "tagline") && !(br && (br.logo || br.name))) content = "project"; // nothing to show: fall back
  const tagline = (o.tagline || (br && br.tagline) || "").trim();
  if (content === "tagline" && !tagline) content = "logo";
  const titleCol = bgc === "#FFFFFF" ? ((br && br.colour) || "#18262B") : onBg;
  const muted = onBg === "#FFFFFF" ? "#C9D2D2" : "#5D6B70";
  const ds = (p.datasets.find(d => d.id === p.view.main_dataset) || {}).name || "";
  const hasLogo = !!(br && br.logo) && content !== "name";
  let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">`;
  if (layer === "logo") {
    if (content === "name") return out + "</svg>";
    const solo = content === "logo", tag = content === "tagline";
    if (hasLogo) {
      // logo only: larger and centred; with a tagline: a little higher to leave room
      const bw = W * (solo ? 0.5 : 0.4), bh = H * (solo ? 0.42 : 0.34), x = (W - bw) / 2, y = solo ? (H - bh) / 2 : tag ? H * 0.2 : H * 0.16;
      // on a coloured background the logo sits on a white plate so it keeps its own colours
      if (bgc !== "#FFFFFF") { const lw = Math.min(bw, logoWidth(br, bh)), pw = lw + H * 0.06, ph = Math.min(bh, lw / ((br.logo_w || 3) / (br.logo_h || 1))) + H * 0.06;
        out += `<rect x="${(W - pw) / 2}" y="${y + (bh - ph) / 2}" width="${pw}" height="${ph}" rx="${H * 0.012}" fill="#fff"/>`; }
      out += logoSvg(br, x, y, bw, bh, "center");
    } else if (br && br.name) out += `<text x="${W / 2}" y="${H * (solo ? 0.52 : 0.36)}" text-anchor="middle" font-size="${Math.round(H * 0.06)}" font-weight="700" letter-spacing="2" fill="${titleCol}">${esc(br.name.toUpperCase())}</text>`;
  } else if (content === "logo") {
    if (o.line) out += `<text x="${W / 2}" y="${H * 0.86}" text-anchor="middle" font-size="${Math.round(H * 0.026)}" fill="${muted}">${esc(o.line)}</text>`;
  } else if (content === "tagline") {
    const mid = Math.round(H * 0.042);
    out += `<rect x="${W * 0.44}" y="${H * 0.62}" width="${W * 0.12}" height="${Math.max(2, H * 0.004)}" fill="${(br && br.accent) || "#C00000"}"/>`;
    out += `<text x="${W / 2}" y="${H * 0.62 + mid * 1.9}" text-anchor="middle" font-size="${mid}" font-weight="600" fill="${titleCol}">${esc(tagline)}</text>`;
    if (o.line) out += `<text x="${W / 2}" y="${H * 0.62 + mid * 3.4}" text-anchor="middle" font-size="${Math.round(H * 0.026)}" fill="${muted}">${esc(o.line)}</text>`;
  } else {
    const y = hasLogo || (content !== "name" && br && br.name) ? H * 0.6 : H * 0.46, big = Math.round(H * 0.062), mid = Math.round(H * 0.03), sm = Math.round(H * 0.022);
    out += `<rect x="${W * 0.42}" y="${y - big * 1.45}" width="${W * 0.16}" height="${Math.max(2, H * 0.004)}" fill="${(br && br.accent) || "#C00000"}"/>`;
    out += `<text x="${W / 2}" y="${y}" text-anchor="middle" font-size="${big}" font-weight="700" fill="${titleCol}">${esc(o.title || m.title || p.name)}</text>`;
    let yy = y;
    const sub = o.subtitle || [m.subtitle, ds].filter(Boolean).join(" · ");
    if (sub) { yy += mid * 1.7; out += `<text x="${W / 2}" y="${yy}" text-anchor="middle" font-size="${mid}" fill="${muted}">${esc(sub)}</text>`; }
    if (o.details !== false) {
      const foot = ["Time–chainage programme", m.client, m.contract].filter(Boolean).join(" · ");
      yy += sm * 2.2; out += `<text x="${W / 2}" y="${yy}" text-anchor="middle" font-size="${sm}" letter-spacing="1" fill="${muted}">${esc(foot.toUpperCase())}</text>`;
    }
    if (o.line) { yy += mid * 2.2; out += `<text x="${W / 2}" y="${yy}" text-anchor="middle" font-size="${mid}" font-weight="600" fill="${titleCol}">${esc(o.line)}</text>`; }
  }
  return out + "</svg>";
}

async function drawSvg(ctx, svg, W, H) {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image(); img.decoding = "async"; img.src = url;
    await img.decode();
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H); ctx.drawImage(img, 0, 0, W, H);
  } finally { URL.revokeObjectURL(url); }
}

// Still image of the chart at time t.
export async function exportFrame(p, t, W = 1920, H = 1080, opts = {}) {
  const cv = Object.assign(document.createElement("canvas"), { width: W, height: H });
  await drawSvg(cv.getContext("2d"), frameSvg(p, t, W, H, { phase: 0.3, ...opts }), W, H);
  return new Promise(res => cv.toBlob(res, "image/png"));
}

// Music: mix the chosen track to the video's length at 48 kHz stereo, with volume, fades, a start offset and looping.
export async function decodeAudio(file) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ac = new AC();
  try { return await ac.decodeAudioData(await file.arrayBuffer()); }
  catch (e) { throw new Error("This browser cannot read that audio file. Try an MP3, M4A, WAV or OGG file."); }
  finally { ac.close?.(); }
}
async function mixMusic(m, seconds) {
  const rate = 48000, len = Math.ceil(seconds * rate);
  const oc = new OfflineAudioContext(2, len, rate);
  const src = oc.createBufferSource(); src.buffer = m.buffer;
  const start = Math.max(0, Math.min(m.start_at || 0, m.buffer.duration - 0.5));
  if (m.buffer.duration - start < seconds) { src.loop = true; src.loopStart = start; src.loopEnd = m.buffer.duration; }
  const g = oc.createGain(), vol = Math.max(0, Math.min(1, m.volume ?? 0.8));
  const fi = Math.min(m.fade_in ?? 1, seconds / 2), fo = Math.min(m.fade_out ?? 3, seconds / 2);
  g.gain.setValueAtTime(fi > 0 ? 0 : vol, 0);
  if (fi > 0) g.gain.linearRampToValueAtTime(vol, fi);
  g.gain.setValueAtTime(vol, Math.max(fi, seconds - fo));
  if (fo > 0) g.gain.linearRampToValueAtTime(0, seconds);
  src.connect(g).connect(oc.destination); src.start(0, start);
  return oc.startRendering();
}
async function audioConfig() {
  if (typeof AudioEncoder === "undefined") return null;
  for (const [codec, mux] of [["mp4a.40.2", "aac"], ["opus", "opus"]]) {
    const cfg = { codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 };
    try { if ((await AudioEncoder.isConfigSupported(cfg)).supported) return { cfg, mux }; } catch (e) { /* try the next codec */ }
  }
  return null;
}

// Encode the playback from t0 to t1 into a video of `seconds` length. onProgress(0..1); return false from it to cancel.
// intro / outro: false, or { seconds, bg, title, subtitle, details, line }. The intro fades the logo in, then the project
// name, then crossfades into the time-chainage; the outro crossfades back to the card and fades out to its background.
// music: null, or { buffer (AudioBuffer), volume, fade_in, fade_out, start_at }.
export async function exportVideo(p, { t0, t1, seconds = 20, fps = 30, W = 1920, H = 1080, hold = 2, mode = "chart", header = true, weeks = defaultWeeks(mode),
  intro = { seconds: 4 }, outro = { seconds: 3 }, music = null, onProgress = () => true }) {
  if (intro === true) intro = { seconds: 4 }; if (outro === true) outro = { seconds: 3 };
  const IN = intro ? Math.max(2, Math.min(15, +intro.seconds || 4)) : 0, OUT = outro ? Math.max(2, Math.min(15, +outro.seconds || 3)) : 0;
  const frames = Math.max(2, Math.round(seconds * fps)), extra = Math.round((outro ? 1 : hold) * fps);
  const nIn = Math.round(IN * fps), nOut = Math.round(OUT * fps), total = nIn + frames + extra + nOut;
  const cv = Object.assign(document.createElement("canvas"), { width: W, height: H });
  const ctx = cv.getContext("2d");
  const tAt = i => t0 + (t1 - t0) * Math.min(1, i / (frames - 1));
  const svgAt = i => frameSvg(p, tAt(i), W, H, { mode, header, weeks, phase: (i / fps) % 1 });
  const cardOf = async o => o ? Promise.all([svgImage(cardSvg(p, W, H, "logo", o)), svgImage(cardSvg(p, W, H, "text", o))]) : null;
  const [cIn, cOut, first, last] = await Promise.all([cardOf(intro), cardOf(outro), intro ? svgImage(svgAt(0)) : null, outro ? svgImage(svgAt(frames - 1)) : null]);
  const ramp = (x, a, b) => Math.max(0, Math.min(1, (x - a) / (b - a)));
  const ease = x => x * x * (3 - 2 * x);
  const layer = (img, a) => { if (a > 0.001) { ctx.globalAlpha = a; ctx.drawImage(img, 0, 0, W, H); } };
  const bgIn = intro ? cardBg(p, intro.bg) : "#FFFFFF", bgOut = outro ? cardBg(p, outro.bg) : "#FFFFFF";
  async function draw(i) {
    ctx.globalAlpha = 1;
    if (i < nIn) {
      const k = i / fps, xf = Math.min(0.8, IN * 0.25), x = ease(ramp(k, IN - xf, IN));   // crossfade into the chart
      ctx.fillStyle = bgIn; ctx.fillRect(0, 0, W, H);
      layer(first, x);
      layer(cIn[0], ease(ramp(k, IN * 0.05, IN * 0.3)) * (1 - x));                       // logo fades in
      layer(cIn[1], ease(ramp(k, IN * 0.35, IN * 0.55)) * (1 - x));                      // then the project name
    } else if (i < nIn + frames + extra) {
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
      ctx.drawImage(await svgImage(svgAt(Math.min(i - nIn, frames - 1))), 0, 0, W, H);
    } else {
      const k = (i - nIn - frames - extra) / fps, xf = Math.min(0.8, OUT * 0.27), x = ease(ramp(k, 0, xf));
      const fo = 1 - ease(ramp(k, OUT - Math.min(1, OUT * 0.33), OUT));                     // card fades out to the background
      ctx.fillStyle = bgOut; ctx.fillRect(0, 0, W, H);
      layer(last, 1 - x);
      layer(cOut[0], x * fo); layer(cOut[1], x * fo);
    }
    ctx.globalAlpha = 1;
  }
  const duration = total / fps;
  const mixed = music && music.buffer ? await mixMusic(music, duration) : null;
  const useWebCodecs = typeof VideoEncoder !== "undefined";
  if (useWebCodecs) {
    await loadScript(MUXER_URL);
    const codec = W * H > 1280 * 720 ? "avc1.640028" : "avc1.42001f", bitrate = W * H > 1280 * 720 ? 8e6 : 5e6;
    const cfg = { codec, width: W, height: H, bitrate, framerate: fps };
    if (!(await VideoEncoder.isConfigSupported(cfg)).supported) throw new Error("This browser cannot encode MP4 at that size. Try 1280 × 720.");
    const ac = mixed ? await audioConfig() : null;
    if (mixed && !ac) throw new Error("This browser cannot add music to an MP4. Untick the music, or use Edge or Chrome.");
    const muxer = new Mp4Muxer.Muxer({ target: new Mp4Muxer.ArrayBufferTarget(), video: { codec: "avc", width: W, height: H },
      ...(ac ? { audio: { codec: ac.mux, numberOfChannels: 2, sampleRate: 48000 } } : {}), fastStart: "in-memory" });
    let fail = null;
    if (ac) {
      const aenc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: e => (fail = e) });
      aenc.configure(ac.cfg);
      const L = mixed.getChannelData(0), R = mixed.getChannelData(1), step = 4800;
      for (let o = 0; o < mixed.length; o += step) {
        const n = Math.min(step, mixed.length - o), data = new Float32Array(n * 2);
        data.set(L.subarray(o, o + n), 0); data.set(R.subarray(o, o + n), n);
        const ad = new AudioData({ format: "f32-planar", sampleRate: 48000, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((o / 48000) * 1e6), data });
        aenc.encode(ad); ad.close();
      }
      await aenc.flush(); aenc.close();
      if (fail) throw fail;
    }
    const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: e => (fail = e) });
    enc.configure(cfg);
    for (let i = 0; i < total; i++) {
      if (fail) throw fail;
      await draw(i);
      const vf = new VideoFrame(cv, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
      enc.encode(vf, { keyFrame: i % (fps * 2) === 0 }); vf.close();
      while (enc.encodeQueueSize > 8) await new Promise(r => setTimeout(r, 5));
      if (onProgress(i / total) === false) { enc.close(); return null; }
    }
    await enc.flush(); muxer.finalize();
    return { blob: new Blob([muxer.target.buffer], { type: "video/mp4" }), ext: "mp4" };
  }
  // fallback: real-time recording of the canvas (WebM), with the music played into the recording
  const type = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm";
  const stream = cv.captureStream(0), track = stream.getVideoTracks()[0], chunks = [];
  let actx = null, asrc = null;
  if (mixed) {
    actx = new AudioContext(); const dest = actx.createMediaStreamDestination();
    asrc = actx.createBufferSource(); asrc.buffer = mixed; asrc.connect(dest);
    dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
  }
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 6e6 });
  rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  const done = new Promise(r => (rec.onstop = r));
  rec.start(); asrc?.start();
  const start = performance.now();
  for (let i = 0; i < total; i++) {
    await draw(i);
    track.requestFrame();
    const wait = start + (i + 1) * (1000 / fps) - performance.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    if (onProgress(i / total) === false) { rec.stop(); actx?.close(); return null; }
  }
  rec.stop(); await done; actx?.close();
  return { blob: new Blob(chunks, { type: "video/webm" }), ext: "webm" };
}
