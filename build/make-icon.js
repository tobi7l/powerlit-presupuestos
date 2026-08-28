const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const pngToIco = require('png-to-ico');

const logoPath = path.join(__dirname, '..', 'src', 'logo.png');
const outDir = __dirname;

async function main() {
  const logo = fs.readFileSync(logoPath);
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngBuffers = [];

  for (const size of sizes) {
    const canvasSize = size;
    const pad = Math.round(size * 0.06);
    const target = canvasSize - pad * 2;
    const resized = await sharp(logo)
      .resize(target, target, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    pngBuffers.push(resized);
    if (size === 256) fs.writeFileSync(path.join(outDir, 'icon.png'), resized);
  }

  const icoBuffer = await pngToIco(pngBuffers);
  fs.writeFileSync(path.join(outDir, 'icon.ico'), icoBuffer);
  console.log('icon.ico generado en', path.join(outDir, 'icon.ico'));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
