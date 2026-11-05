// Playback export: draws each frame offline (title strip, chart at the play date, legend) and encodes it as MP4.
// MP4 uses the browser's WebCodecs encoder and mp4-muxer (loaded only when needed); WebM via MediaRecorder is the fallback.
import { renderChart, renderLegend, playDynamic, activeAt } from "./render.js";
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

// One frame as an SVG string of size W x H.
export function frameSvg(p, t, W, H) {
  const head = Math.round(H * 0.085), legendW = Math.round(W * 0.17), pad = 12;
  const ds = (p.datasets.find(d => d.id === p.view.main_dataset) || {}).name || "";
  const n = activeAt(p, t).length, d = new Date(t);
  const { svg: chart, G } = renderChart(p, { width: W - legendW - pad * 3, height: H - head - pad * 2, compact: W < 1500, playTime: t });
  const lg = renderLegend(p, { size: 11 });
  const lgScale = Math.min(1, (H - head - pad * 2) / Math.max(1, lg.height));
  const ts = Math.round(head * 0.36), ss = Math.round(head * 0.2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">
    <rect width="${W}" height="${H}" fill="#fff"/>
    <rect width="${W}" height="${head}" fill="#18262B"/>
    <text x="${pad * 2}" y="${head * 0.48}" font-size="${ts}" font-weight="700" fill="#fff">${esc(p.meta.title || p.name)}</text>
    <text x="${pad * 2}" y="${head * 0.82}" font-size="${ss}" fill="#C9D2D2">${esc(ds)}</text>
    <text x="${W - pad * 2}" y="${head * 0.5}" font-size="${ts}" font-weight="700" fill="#fff" text-anchor="end">${esc(DOW[d.getUTCDay()] + " " + niceDate(t))}</text>
    <text x="${W - pad * 2}" y="${head * 0.82}" font-size="${ss}" fill="#C9D2D2" text-anchor="end">${n ? `${n} activit${n === 1 ? "y" : "ies"} under way` : "nothing under way"}</text>
    <svg x="${pad}" y="${head + pad}" width="${W - legendW - pad * 3}" height="${H - head - pad * 2}" viewBox="0 0 ${G.W} ${G.H}" preserveAspectRatio="xMidYMid meet">${chart}</svg>
    <g transform="translate(${W - legendW - pad} ${head + pad}) scale(${lgScale})">${lg.svg}</g>
  </svg>`;
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
export async function exportFrame(p, t, W = 1920, H = 1080) {
  const cv = Object.assign(document.createElement("canvas"), { width: W, height: H });
  await drawSvg(cv.getContext("2d"), frameSvg(p, t, W, H), W, H);
  return new Promise(res => cv.toBlob(res, "image/png"));
}

// Encode the playback from t0 to t1 into a video of `seconds` length. onProgress(0..1); return false from it to cancel.
export async function exportVideo(p, { t0, t1, seconds = 20, fps = 30, W = 1920, H = 1080, hold = 2, onProgress = () => true }) {
  const frames = Math.max(2, Math.round(seconds * fps)), extra = Math.round(hold * fps);
  const cv = Object.assign(document.createElement("canvas"), { width: W, height: H });
  const ctx = cv.getContext("2d");
  const tAt = i => t0 + (t1 - t0) * Math.min(1, i / (frames - 1));
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
    for (let i = 0; i < frames + extra; i++) {
      if (fail) throw fail;
      await drawSvg(ctx, frameSvg(p, tAt(i), W, H), W, H);
      const vf = new VideoFrame(cv, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
      enc.encode(vf, { keyFrame: i % (fps * 2) === 0 }); vf.close();
      while (enc.encodeQueueSize > 8) await new Promise(r => setTimeout(r, 5));
      if (onProgress(i / (frames + extra)) === false) { enc.close(); return null; }
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
  for (let i = 0; i < frames + extra; i++) {
    await drawSvg(ctx, frameSvg(p, tAt(i), W, H), W, H);
    track.requestFrame();
    const wait = start + (i + 1) * (1000 / fps) - performance.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    if (onProgress(i / (frames + extra)) === false) { rec.stop(); return null; }
  }
  rec.stop(); await done;
  return { blob: new Blob(chunks, { type: "video/webm" }), ext: "webm" };
}
