#!/usr/bin/env node
'use strict';

const path = require('path');

/**
 * Electron client project root (crates/agent-electron-client).
 * This file lives at scripts/utils/, so ../.. always points to project root.
 */
function getProjectRoot() {
  return path.resolve(__dirname, '..', '..');
}

function resolveFromProject(...parts) {
  return path.join(getProjectRoot(), ...parts);
}

module.exports = {
  getProjectRoot,
  resolveFromProject,
};
