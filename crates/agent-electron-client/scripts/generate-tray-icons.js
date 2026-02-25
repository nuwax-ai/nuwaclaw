#!/usr/bin/env node
/**
 * Generate macOS tray icons from original app icon
 *
 * macOS tray icons should be Template Images:
 * - Black silhouette on transparent background
 * - System handles light/dark mode automatically
 *
 * Requirements:
 *   npm install sharp --save-dev
 *
 * Usage:
 *   node scripts/generate-tray-icons.js
 */

const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const SIZES = {
  normal: 22,
  retina: 44,
};

const SOURCE_ICON = path.join(__dirname, '..', 'public', 'icon.png');
const OUTPUT_DIR = path.join(__dirname, '..', 'public', 'tray');

async function generateTrayIcons() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  console.log('Loading source icon:', SOURCE_ICON);
  const metadata = await sharp(SOURCE_ICON).metadata();
  console.log('Source icon size:', metadata.width, 'x', metadata.height);

  console.log('Generating tray icons as Template Images...');

  // Helper to create template image (black on transparent)
  async function createTemplateIcon(outputPath, size) {
    // Load original and resize
    const resized = await sharp(SOURCE_ICON)
      .resize(size, size, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const { data, info } = resized;
    const pixels = new Uint8Array(data);

    // Create output buffer - black silhouette with alpha from original
    const output = new Uint8Array(info.width * info.height * 4);

    for (let i = 0; i < info.width * info.height; i++) {
      const r = pixels[i * 4];
      const g = pixels[i * 4 + 1];
      const b = pixels[i * 4 + 2];
      const a = pixels[i * 4 + 3];

      if (a === 0) {
        // Fully transparent → keep transparent
        output[i * 4] = 0;
        output[i * 4 + 1] = 0;
        output[i * 4 + 2] = 0;
        output[i * 4 + 3] = 0;
      } else if (r > 200 && g > 200 && b > 200) {
        // Near-white pixel → treat as background, make transparent
        output[i * 4] = 0;
        output[i * 4 + 1] = 0;
        output[i * 4 + 2] = 0;
        output[i * 4 + 3] = 0;
      } else {
        // Colored pixel (the AI logo) → black silhouette, preserve alpha for anti-aliasing
        output[i * 4] = 0;     // R
        output[i * 4 + 1] = 0; // G
        output[i * 4 + 2] = 0; // B
        output[i * 4 + 3] = a; // Preserve original alpha for smooth edges
      }
    }

    await sharp(output, {
      raw: {
        width: info.width,
        height: info.height,
        channels: 4
      }
    }).png().toFile(outputPath);
  }

  // Generate @2x icons (44x44)
  console.log('Generating @2x icons...');
  await createTemplateIcon(path.join(OUTPUT_DIR, 'tray-stopped@2x.png'), SIZES.retina);
  await createTemplateIcon(path.join(OUTPUT_DIR, 'tray-running@2x.png'), SIZES.retina);
  await createTemplateIcon(path.join(OUTPUT_DIR, 'tray-starting@2x.png'), SIZES.retina);
  await createTemplateIcon(path.join(OUTPUT_DIR, 'tray-error@2x.png'), SIZES.retina);

  // Generate @1x icons (22x22)
  console.log('Generating @1x icons...');
  await createTemplateIcon(path.join(OUTPUT_DIR, 'tray-stopped.png'), SIZES.normal);
  await createTemplateIcon(path.join(OUTPUT_DIR, 'tray-running.png'), SIZES.normal);
  await createTemplateIcon(path.join(OUTPUT_DIR, 'tray-starting.png'), SIZES.normal);
  await createTemplateIcon(path.join(OUTPUT_DIR, 'tray-error.png'), SIZES.normal);

  console.log('Done! Tray icons generated in:', OUTPUT_DIR);
  console.log('\nGenerated files:');
  const files = fs.readdirSync(OUTPUT_DIR).filter(f => f.endsWith('.png'));
  for (const f of files) {
    const stat = fs.statSync(path.join(OUTPUT_DIR, f));
    const info = await sharp(path.join(OUTPUT_DIR, f)).metadata();
    console.log(`  ${f} (${stat.size} bytes, ${info.width}x${info.height}, ${info.channels} channels)`);
  }
}

generateTrayIcons().catch(err => {
  console.error('Error generating tray icons:', err);
  process.exit(1);
});
