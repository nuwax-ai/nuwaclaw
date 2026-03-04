#!/usr/bin/env node
/**
 * 生成托盘统一图标：将 public/32x32.png 复制到 public/tray/ 作为 32x32.png 与 32x32@2x.png。
 * 托盘所有状态（运行/停止/错误/启动中）共用该图标，状态通过 tooltip 区分。
 *
 * Requirements:
 *   npm install sharp --save-dev（可选，仅需复制时可不装）
 *
 * Usage:
 *   node scripts/tools/generate-tray-icons.js
 */

const path = require('path');
const fs = require('fs');
const { getProjectRoot } = require('../utils/project-paths');

const projectRoot = getProjectRoot();
const SOURCE_ICON = path.join(projectRoot, 'public', '32x32.png');
const OUTPUT_DIR = path.join(projectRoot, 'public', 'tray');

async function generateTrayIcons() {
  if (!fs.existsSync(SOURCE_ICON)) {
    console.error('Source icon not found:', SOURCE_ICON);
    process.exit(1);
  }

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const out1 = path.join(OUTPUT_DIR, '32x32.png');
  const out2 = path.join(OUTPUT_DIR, '32x32@2x.png');

  fs.copyFileSync(SOURCE_ICON, out1);
  fs.copyFileSync(SOURCE_ICON, out2);

  console.log('Tray icons (unified):');
  console.log('  Copied', SOURCE_ICON, '->', out1);
  console.log('  Copied', SOURCE_ICON, '->', out2);
  console.log('Done! Tray dir:', OUTPUT_DIR);
}

generateTrayIcons().catch(err => {
  console.error('Error generating tray icons:', err);
  process.exit(1);
});
