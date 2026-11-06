// Branding: a library of company brands kept in this browser, and the copy each project carries (p.brand),
// so a project file shared with someone else keeps its logo. A brand is a name, a logo and two colours.
import { esc, uid } from "./util.js";

const KEY = "tcs-brands";
export const BRAND_DEFAULTS = { name: "", tagline: "", logo: null, logo_w: 0, logo_h: 0, colour: "#18262B", accent: "#C00000" };

export function listBrands() {
  try { const v = JSON.parse(localStorage.getItem(KEY) || "[]"); return Array.isArray(v) ? v : []; } catch (e) { return []; }
}
function store(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); }
  catch (e) { throw new Error("The browser has no room left to keep this brand. Use a smaller logo image."); }
}
export function saveBrand(b) {
  const list = listBrands(), i = list.findIndex(x => x.id === b.id);
  const rec = { ...BRAND_DEFAULTS, ...b, id: b.id || uid("br_") };
  if (rec.is_default) list.forEach(x => (x.is_default = false));
  if (i >= 0) list[i] = rec; else list.push(rec);
  store(list);
  return rec;
}
export function deleteBrand(id) { store(listBrands().filter(b => b.id !== id)); }
export const defaultBrand = () => listBrands().find(b => b.is_default) || null;
// The copy a project keeps (library-only flags dropped)
export const projectCopy = b => (b ? (({ is_default, ...rest }) => ({ ...BRAND_DEFAULTS, ...rest }))(b) : null);

// Text colour that reads on a given background
export function onColour(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || ""); if (!m) return "#fff";
  const n = parseInt(m[1], 16), r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#18262B" : "#FFFFFF";
}

// Read a logo file. Raster images are scaled down (longest side 1200 px, PNG) so the library stays small.
export function readLogo(file) {
  return new Promise((res, rej) => {
    if (!file) return rej(new Error("Choose a logo file first."));
    if (!/^image\/(png|jpeg|gif|webp|svg\+xml)$/.test(file.type)) return rej(new Error("Choose a PNG, JPG, GIF, WebP or SVG image."));
    const fr = new FileReader();
    fr.onerror = () => rej(new Error("Could not read that file."));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => rej(new Error("That file is not an image this browser can show."));
      img.onload = () => {
        let w = img.naturalWidth || 600, hh = img.naturalHeight || 200;
        if (file.type === "image/svg+xml") return res({ logo: fr.result, logo_w: w, logo_h: hh });
        const k = Math.min(1, 1200 / Math.max(w, hh)); w = Math.round(w * k); hh = Math.round(hh * k);
        const cv = Object.assign(document.createElement("canvas"), { width: w, height: hh });
        cv.getContext("2d").drawImage(img, 0, 0, w, hh);
        res({ logo: cv.toDataURL("image/png"), logo_w: w, logo_h: hh });
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}

// The logo fitted inside a box, as SVG. align: "left" | "center" | "right"
export function logoSvg(b, x, y, w, h, align = "left", opacity = 1) {
  if (!b || !b.logo) return "";
  const r = (b.logo_w || 3) / (b.logo_h || 1);
  let lw = w, lh = w / r; if (lh > h) { lh = h; lw = h * r; }
  const lx = align === "center" ? x + (w - lw) / 2 : align === "right" ? x + w - lw : x;
  return `<image href="${esc(b.logo)}" x="${lx.toFixed(2)}" y="${(y + (h - lh) / 2).toFixed(2)}" width="${lw.toFixed(2)}" height="${lh.toFixed(2)}" preserveAspectRatio="xMidYMid meet" opacity="${opacity}"/>`;
}
// Width the logo takes when fitted to height h (capped at maxW)
export const logoWidth = (b, h, maxW = Infinity) => (b && b.logo ? Math.min(maxW, h * ((b.logo_w || 3) / (b.logo_h || 1))) : 0);
