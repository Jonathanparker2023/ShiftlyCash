/**
 * Generates every app-icon asset from the single source of truth: public/logo.svg
 * (the gold Bashflow skyline). Run with: node scripts/generate-icons.mjs
 *
 * Outputs:
 *   src/app/apple-icon.png   180x180  iOS/iPadOS home-screen icon
 *   src/app/icon.svg         vector   browser tab icon (preferred)
 *   src/app/icon.png         512x512  general-purpose raster fallback
 *   src/app/favicon.ico      32+16    browser tab icon (PNG-in-ICO)
 *   public/icon-192.png      192x192  web-app manifest
 *   public/icon-512.png      512x512  web-app manifest
 *
 * iOS masks icons into a squircle and does NOT honor transparency (it
 * composites onto black), so the brand background is baked in and the
 * artwork is inset to survive the corner mask.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Matches the window-cutout colour inside logo.svg, so the towers read as solid. */
const BRAND_BG = "#0b0c0e";

/** Artwork bounding box within logo.svg's 96x96 viewBox. */
const ART = { x: 8, y: 4, w: 77, h: 83 };

/** Fraction of the canvas height the skyline should occupy. Leaves iOS mask headroom. */
const ART_HEIGHT_RATIO = 0.74;

const logo = readFileSync(path.join(root, "public/logo.svg"), "utf8");
const inner = logo.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");

/** Wraps the skyline on the brand background, centred and inset, at `size` px. */
function composeIcon(size) {
  const scale = (size * ART_HEIGHT_RATIO) / ART.h;
  const dx = (size - ART.w * scale) / 2 - ART.x * scale;
  const dy = (size - ART.h * scale) / 2 - ART.y * scale;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
      `<rect width="${size}" height="${size}" fill="${BRAND_BG}"/>` +
      `<g transform="translate(${dx.toFixed(2)} ${dy.toFixed(2)}) scale(${scale.toFixed(5)})">${inner}</g>` +
      `</svg>`,
  );
}

// `density` oversamples the SVG so gradients stay smooth; `resize` then pins the
// output to the exact pixel size. Without the resize, density silently scales the
// raster past the requested size (and ICO entries stop matching their PNG payload).
const png = (size) =>
  sharp(composeIcon(size), { density: 384 })
    .resize(size, size)
    .png({ palette: true, quality: 92, effort: 9 })
    .toBuffer();

/**
 * ICO payloads must be true-colour RGBA — Next's ICO decoder rejects the indexed
 * PNGs that `palette: true` produces. These are 48px and under, so the extra
 * bytes are irrelevant.
 */
const icoPng = (size) =>
  sharp(composeIcon(size), { density: 384 })
    .resize(size, size)
    .ensureAlpha()
    .png({ palette: false, compressionLevel: 9 })
    .toBuffer();

/** Minimal ICO container. Every modern browser reads PNG-encoded ICO entries. */
function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  let offset = 6 + entries.length * 16;
  const dir = [];
  for (const { size, data } of entries) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 means 256)
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // height
    entry.writeUInt8(0, 2); // palette count
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    dir.push(entry);
  }

  return Buffer.concat([header, ...dir, ...entries.map((e) => e.data)]);
}

const write = (rel, buf) => {
  writeFileSync(path.join(root, rel), buf);
  console.log(`  ${rel}  ${(buf.length / 1024).toFixed(1)} KB`);
};

console.log("Generating Bashflow icons from public/logo.svg");

write("src/app/icon.svg", composeIcon(96));

write("src/app/apple-icon.png", await png(180));
write("src/app/icon.png", await png(512));
write("public/icon-192.png", await png(192));
write("public/icon-512.png", await png(512));
write(
  "src/app/favicon.ico",
  buildIco([
    { size: 16, data: await icoPng(16) },
    { size: 32, data: await icoPng(32) },
    { size: 48, data: await icoPng(48) },
  ]),
);

console.log("Done.");
