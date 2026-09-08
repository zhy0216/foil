import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { ICON_SIZES } from './manifest';

// Deterministic rasterization with the pinned Playwright Chromium. Preserve the
// original vector's viewBox, padding, paths and ink; add a pale toolbar backing.
const svg = await readFile(fileURLToPath(import.meta.resolve('@foil/editor/brand/foil-mark.svg')), 'utf8');
const output = new URL('../public/icons/', import.meta.url);
const artifacts = new URL('../artifacts/', import.meta.url);
await mkdir(output, { recursive: true });
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ channel: 'chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 600, height: 360 }, deviceScaleFactor: 1 });
  const icons = await page.evaluate(async ({ svg, sizes }) => {
    const mark = new Image();
    mark.src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
    await mark.decode();
    return sizes.map(size => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#faf9f6';
      ctx.beginPath();
      ctx.roundRect(0, 0, size, size, size * 0.18);
      ctx.fill();
      ctx.drawImage(mark, 0, 0, size, size);
      return { size, url: canvas.toDataURL('image/png') };
    });
  }, { svg, sizes: ICON_SIZES });
  for (const icon of icons) await writeFile(new URL(`${icon.size}.png`, output), Buffer.from(icon.url.split(',')[1], 'base64'));
  await page.setContent(`<style>body{margin:0;font:14px system-ui}.row{height:180px;display:flex;align-items:center;justify-content:space-evenly}.row>div{text-align:center}.label{margin-top:8px}</style>` +
    ['#ffffff', '#202124'].map((background, index) => `<div class="row" style="background:${background};color:${index ? '#fff' : '#222'}">` +
      icons.map(icon => `<div><img width="${icon.size}" height="${icon.size}" src="${icon.url}"><div class="label">${icon.size} px</div></div>`).join('') + '</div>').join(''));
  await page.screenshot({ path: fileURLToPath(new URL('icon-preview.png', artifacts)) });
  console.log(`Rendered existing Foil vector at ${ICON_SIZES.join('/')} px with Chromium ${browser.version()}`);
} finally {
  await browser.close();
}
