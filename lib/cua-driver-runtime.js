'use strict';

const fs = require('node:fs');
const path = require('node:path');

const VERSION = '0.34.0';
const ARCHIVE_SHA256 = 'bcc520e50861c7092cf775846fec76ae386d7dcd6b5b408608b0ea4423a8b888';
const ARCHIVE_URL = `https://github.com/trycua/cua/releases/download/cua-driver-rs-v${VERSION}/cua-driver-rs-${VERSION}-windows-x86_64-binary.zip`;

function resolveDriver(appRoot) {
  const root = String(appRoot).replace(/([\\/])app\.asar([\\/]|$)/, '$1app.asar.unpacked$2');
  const command = path.join(root, 'lib', 'native', 'cua-driver', 'cua-driver.exe');
  return { command, available: process.platform === 'win32' && process.arch === 'x64' && fs.existsSync(command) };
}

module.exports = { VERSION, ARCHIVE_SHA256, ARCHIVE_URL, resolveDriver };
