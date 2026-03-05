#!/usr/bin/env node
/**
 * 生成 / 检查托盘图标
 *
 * public/tray/ 下的文件说明：
 *
 *   macOS（已手工制作，提交在 git 中）：
 *     trayTemplate.png    — 22x22 黑色剪影 + alpha（macOS Template Image @1x）
 *     trayTemplate@2x.png — 44x44 黑色剪影 + alpha（macOS Template Image @2x）
 *
 *   Windows / Linux（此脚本自动从 64x64.png 生成）：
 *     tray.png    — 32x32 彩色
 *     tray@2x.png — 64x64 彩色
 *
 * Usage:
 *   node scripts/tools/generate-tray-icons.js
 */

const path = require('path');
const fs = require('fs');
const { getProjectRoot } = require('../utils/project-paths');

const projectRoot = getProjectRoot();
const LOGO_ICON = path.join(projectRoot, 'public', '64x64.png');
const OUTPUT_DIR = path.join(projectRoot, 'public', 'tray');

async function generateTrayIcons() {
  const sharp = require('sharp');

  if (!fs.existsSync(LOGO_ICON)) {
    console.error('Source icon not found:', LOGO_ICON);
    process.exit(1);
  }

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // ---- macOS: 检查手工模板图标是否存在 ----
  for (const f of ['trayTemplate.png', 'trayTemplate@2x.png']) {
    const p = path.join(OUTPUT_DIR, f);
    if (!fs.existsSync(p)) {
      console.warn(`  WARNING: macOS template icon missing: ${f} — please craft manually (black silhouette + alpha)`);
    } else {
      console.log(`  macOS template: ${f} (exists)`);
    }
  }

  // ---- Windows / Linux: 从 64x64 logo 生成彩色图标 ----
  // Logo 占画布 ~75%，四周留透明 padding
  for (const { size, suffix } of [
    { size: 32, suffix: 'tray.png' },
    { size: 64, suffix: 'tray@2x.png' },
  ]) {
    const logoSize = Math.round(size * 0.75);
    const padding = Math.round((size - logoSize) / 2);

    const outPath = path.join(OUTPUT_DIR, suffix);
    await sharp(LOGO_ICON)
      .resize(logoSize, logoSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .extend({
        top: padding,
        bottom: size - logoSize - padding,
        left: padding,
        right: size - logoSize - padding,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toFile(outPath);

    console.log(`  colored: ${suffix} (${size}x${size})`);
  }

  console.log('Done! Tray dir:', OUTPUT_DIR);
}

generateTrayIcons().catch(err => {
  console.error('Error generating tray icons:', err);
  process.exit(1);
});
