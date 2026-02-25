#!/usr/bin/env node
/**
 * Generate macOS tray icons from original app icon
 *
 * Requirements:
 *   npm install sharp --save-dev
 *
 * Usage:
 *   node scripts/generate-tray-icons.js
 *
 * Output:
 *   public/tray/tray-stopped.png    - Gray/outline style
 *   public/tray/tray-running.png    - Filled black
 *   public/tray/tray-starting.png   - Half-filled (animated feel)
 *   public/tray/tray-error.png      - Red indicator
 */

const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const SIZES = {
  // macOS tray icon sizes
  normal: 22,
  retina: 44,
};

const SOURCE_ICON = path.join(__dirname, '..', 'public', 'icon.png');
const OUTPUT_DIR = path.join(__dirname, '..', 'public', 'tray');

async function generateTrayIcons() {
  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  console.log('Loading source icon:', SOURCE_ICON);

  // Load original icon
  const sourceImage = sharp(SOURCE_ICON);
  const metadata = await sourceImage.metadata();
  console.log('Source icon size:', metadata.width, 'x', metadata.height);

  // Resize to tray icon size (44x44 for @2x, will be scaled down for @1x)
  const resized = await sourceImage
    .resize(SIZES.retina, SIZES.retina, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();

  // Generate stopped icon (gray outline style)
  console.log('Generating tray-stopped.png...');
  await sharp(resized)
    .flatten({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .modulate({ saturation: 0 }) // Grayscale
    .threshold(128) // Binary black/white
    .negate() // Invert to get black icon on transparent
    .toFile(path.join(OUTPUT_DIR, 'tray-stopped.png'));

  // Generate running icon (solid black filled)
  console.log('Generating tray-running.png...');
  await sharp(resized)
    .flatten({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .modulate({ saturation: 0 })
    .threshold(1) // Almost everything becomes black
    .toFile(path.join(OUTPUT_DIR, 'tray-running.png'));

  // Generate starting icon (similar to running but slightly lighter)
  console.log('Generating tray-starting.png...');
  await sharp(resized)
    .flatten({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .modulate({ saturation: 0, brightness: 1.2 })
    .threshold(80)
    .toFile(path.join(OUTPUT_DIR, 'tray-starting.png'));

  // Generate error icon (with red tint)
  console.log('Generating tray-error.png...');
  await sharp(resized)
    .flatten({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .modulate({ saturation: 0 })
    .threshold(128)
    .tint({ r: 255, g: 100, b: 100 }) // Red tint
    .toFile(path.join(OUTPUT_DIR, 'tray-error.png'));

  // Also generate @2x versions
  console.log('Generating @2x versions...');

  // @2x stopped
  await sharp(SOURCE_ICON)
    .resize(SIZES.retina, SIZES.retina, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .modulate({ saturation: 0 })
    .threshold(128)
    .negate()
    .toFile(path.join(OUTPUT_DIR, 'tray-stopped@2x.png'));

  // @2x running
  await sharp(SOURCE_ICON)
    .resize(SIZES.retina, SIZES.retina, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .modulate({ saturation: 0 })
    .threshold(1)
    .toFile(path.join(OUTPUT_DIR, 'tray-running@2x.png'));

  console.log('Done! Tray icons generated in:', OUTPUT_DIR);
  console.log('\nGenerated files:');
  const files = fs.readdirSync(OUTPUT_DIR).filter(f => f.endsWith('.png'));
  files.forEach(f => {
    const stat = fs.statSync(path.join(OUTPUT_DIR, f));
    console.log(`  ${f} (${stat.size} bytes)`);
  });
}

generateTrayIcons().catch(err => {
  console.error('Error generating tray icons:', err);
  process.exit(1);
});
