// Renders the screens of one piece of the social agenda from its artboard in the design canvas.
// Usage: node tools/social_render.js <artboard .dc.html> <folder with the canvas uploads> <out folder> <piece id, e.g. m07>
// The artboard is plain HTML: each screen is a 1080 x 1350 block with class "s". Uploads are addressed as /_blob/<id>.
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const [, , src, assets, out, id] = process.argv;
if (!src || !assets || !out || !/^m\d{2}$/.test(id || '')) { console.error('usage: node tools/social_render.js <artboard> <assets dir> <out dir> <mNN>'); process.exit(1); }
const ROOT = path.resolve(__dirname, '..'), FONT = { 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'DemiBold', 700: 'Bold', 800: 'Bold' };
(async () => {
  let h = fs.readFileSync(src, 'utf8');
  const style = (h.match(/<helmet>\s*<style>([\s\S]*?)<\/style>\s*<\/helmet>/) || [])[1] || '', body = (h.match(/<\/helmet>([\s\S]*?)<\/x-dc>/) || [])[1] || '';
  // which upload is which weight of the brand font, so a missing upload falls back to the font kept with the site
  const weight = {}; style.replace(/@font-face\{font-family:B;src:url\(\/_blob\/([0-9a-f]{32})\);font-weight:(\d+)\}/g, (m, k, w) => { weight[k] = w; });
  const files = {}; fs.readdirSync(assets).forEach((f) => { const k = f.split('.')[0]; if (/^[0-9a-f]{32}$/.test(k)) files[k] = path.join(assets, f); });
  const missing = new Set();
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1200, height: 1400 }, deviceScaleFactor: 1 });
  await p.route('**/_blob/**', (r) => { const k = r.request().url().split('/_blob/')[1].slice(0, 32); let f = files[k];
    if (!f && weight[k]) f = path.join(ROOT, 'agenda', 'f', 'BDOGrotesk-' + FONT[weight[k]] + '.woff2');
    if (!f || !fs.existsSync(f)) { missing.add(k); return r.fulfill({ status: 404, body: '' }); }
    const ext = path.extname(f).slice(1), ct = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', svg: 'image/svg+xml', woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf' }[ext] || 'application/octet-stream';
    return r.fulfill({ status: 200, contentType: ct, body: fs.readFileSync(f) }); });
  await p.route('http://piece.local/', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta charset="utf-8"><style>' + style + '</style></head><body>' + body + '</body></html>' }));
  await p.goto('http://piece.local/'); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(600);
  const screens = await p.$$('.s'); fs.mkdirSync(out, { recursive: true }); const made = [];
  for (let i = 0; i < screens.length; i++) { const f = path.join(out, id + '_' + String(i + 1).padStart(2, '0') + '.jpg'); await screens[i].screenshot({ path: f, type: 'jpeg', quality: 90 }); made.push(f); }
  await b.close(); console.log(JSON.stringify({ screens: made.length, files: made.map((f) => path.basename(f)), missingUploads: [...missing] }));
})();
