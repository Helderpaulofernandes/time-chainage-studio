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

// Intro / outro card, in two layers so they can fade separately: the logo, and the project name with its details.
export function cardSvg(p, W, H, layer) {
  const br = p.brand, col = (br && br.colour) || "#18262B", m = p.meta || {};
  const ds = (p.datasets.find(d => d.id === p.view.main_dataset) || {}).name || "";
  const hasLogo = !!(br && br.logo);
  let o = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">`;
  if (layer === "logo") {
    if (hasLogo) o += logoSvg(br, W * 0.3, H * 0.16, W * 0.4, H * 0.34, "center");
    else if (br && br.name) o += `<text x="${W / 2}" y="${H * 0.36}" text-anchor="middle" font-size="${Math.round(H * 0.06)}" font-weight="700" letter-spacing="2" fill="${col}">${esc(br.name.toUpperCase())}</text>`;
  } else {
    const y = hasLogo || (br && br.name) ? H * 0.6 : H * 0.46, big = Math.round(H * 0.062), mid = Math.round(H * 0.03), sm = Math.round(H * 0.022);
    o += `<rect x="${W * 0.42}" y="${y - big * 1.45}" width="${W * 0.16}" height="${Math.max(2, H * 0.004)}" fill="${(br && br.accent) || "#C00000"}"/>`;
    o += `<text x="${W / 2}" y="${y}" text-anchor="middle" font-size="${big}" font-weight="700" fill="${col}">${esc(m.title || p.name)}</text>`;
    const sub = [m.subtitle, ds].filter(Boolean).join(" · ");
    if (sub) o += `<text x="${W / 2}" y="${y + mid * 1.7}" text-anchor="middle" font-size="${mid}" fill="#5D6B70">${esc(sub)}</text>`;
    const foot = ["Time–chainage programme", m.client, m.contract].filter(Boolean).join(" · ");
    o += `<text x="${W / 2}" y="${y + mid * 1.7 + sm * 2.2}" text-anchor="middle" font-size="${sm}" letter-spacing="1" fill="#5D6B70">${esc(foot.toUpperCase())}</text>`;
  }
  return o + "</svg>";
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

// Encode the playback from t0 to t1 into a video of `seconds` length. onProgress(0..1); return false from it to cancel.
// With intro on: the logo fades in, then the project name, then the card crossfades into the time-chainage.
// The outro crossfades back to the card and fades it out to white.
export async function exportVideo(p, { t0, t1, seconds = 20, fps = 30, W = 1920, H = 1080, hold = 2, mode = "chart", header = true, weeks = defaultWeeks(mode), intro = true, onProgress = () => true }) {
  const frames = Math.max(2, Math.round(seconds * fps)), extra = Math.round((intro ? 1 : hold) * fps);
  const IN = intro ? 4 : 0, OUT = intro ? 3 : 0, nIn = Math.round(IN * fps), nOut = Math.round(OUT * fps);
  const total = nIn + frames + extra + nOut;
  const cv = Object.assign(document.createElement("canvas"), { width: W, height: H });
  const ctx = cv.getContext("2d");
  const tAt = i => t0 + (t1 - t0) * Math.min(1, i / (frames - 1));
  const svgAt = i => frameSvg(p, tAt(i), W, H, { mode, header, weeks, phase: (i / fps) % 1 });
  let card = null, first = null, last = null;
  if (intro) [card, first, last] = await Promise.all([
    Promise.all([svgImage(cardSvg(p, W, H, "logo")), svgImage(cardSvg(p, W, H, "text"))]), svgImage(svgAt(0)), svgImage(svgAt(frames - 1))]);
  const ramp = (x, a, b) => Math.max(0, Math.min(1, (x - a) / (b - a)));
  const ease = x => x * x * (3 - 2 * x);
  const layer = (img, a) => { if (a > 0.001) { ctx.globalAlpha = a; ctx.drawImage(img, 0, 0, W, H); } };
  async function draw(i) {
    ctx.globalAlpha = 1; ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
    if (i < nIn) {
      const k = i / fps, x = ease(ramp(k, IN - 0.8, IN));          // crossfade into the chart over the last 0.8 s
      layer(first, x);
      layer(card[0], ease(ramp(k, 0.2, 1.2)) * (1 - x));            // logo fades in
      layer(card[1], ease(ramp(k, 1.4, 2.2)) * (1 - x));            // then the project name
    } else if (i < nIn + frames + extra) {
      const j = Math.min(i - nIn, frames - 1);
      const svg = svgAt(j); ctx.globalAlpha = 1;
      const img = await svgImage(svg); ctx.drawImage(img, 0, 0, W, H);
    } else {
      const k = (i - nIn - frames - extra) / fps, x = ease(ramp(k, 0, 0.8)), out = 1 - ease(ramp(k, OUT - 1, OUT));
      layer(last, 1 - x);
      layer(card[0], x * out); layer(card[1], x * out);
    }
    ctx.globalAlpha = 1;
  }
  const useWebCodecs = typeof VideoEncoder !== "undefined";
  if (useWebCodecs) {
    await loadScript(MUXER_URL);
    const codec = W * H > 1280 * 720 ? "avc1.640028" : "avc1.42001f", bitrate = W * H > 1280 * 720 ? 8e6 : 5e6;
    const cfg = { codec, width: W, height: H, bitrate, framerate: fps };
    if (!(await VideoEncoder.isConfigSupported(cfg)).supported) throw new Error("This browser cannot encode MP4 at that size. Try 1280 × 720.");
    const muxer = new Mp4Muxer.Muxer({ target: new Mp4Muxer.ArrayBufferTarget(), video: { codec: "avc", width: W, height: H }, fastStart: "in-memory" });
    let fail = null;
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
  // fallback: real-time recording of the canvas (WebM)
  const type = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm";
  const stream = cv.captureStream(0), track = stream.getVideoTracks()[0], chunks = [];
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 6e6 });
  rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  const done = new Promise(r => (rec.onstop = r));
  rec.start();
  const start = performance.now();
  for (let i = 0; i < total; i++) {
    await draw(i);
    track.requestFrame();
    const wait = start + (i + 1) * (1000 / fps) - performance.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    if (onProgress(i / total) === false) { rec.stop(); return null; }
  }
  rec.stop(); await done;
  return { blob: new Blob(chunks, { type: "video/webm" }), ext: "webm" };
}
