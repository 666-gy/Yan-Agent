'use strict';

// Native Linux/macOS builds use the same application source, with runtime
// resources selected for the host architecture. Windows releases keep the
// existing package.json build configuration and NSIS flow.
const pkg = require('../package.json');
const platform = process.platform;
if (!['linux', 'darwin'].includes(platform)) throw Error('Run Linux/macOS builds on their native OS');
const config = structuredClone(pkg.build);
config.directories.output = `dist/${platform}-${process.arch}`;
config.icon = 'renderer/assets/logo-light.png';
config.files.push('!lib/native/**/*.exe', '!node_modules/opencode-*/**/*', '!node_modules/@colbymchenry/codegraph-*/**/*', '!node_modules/sherpa-onnx-*/**/*');
config.compression = 'normal';
config.extraResources = [
  { from: `node_modules/@colbymchenry/codegraph-${platform}-${process.arch}`, to: 'codegraph-runtime' },
  { from: 'node_modules/@officecli/officecli/vendor', to: 'officecli-runtime' },
  { from: 'output/playwright-runtime', to: 'playwright-runtime', filter: ['**/*', '!browsers/**/*'] },
  { from: 'output/opencode-runtime', to: 'opencode-runtime' }
];
config.linux = {
  target: ['AppImage', 'tar.gz'], category: 'Development',
  icon: 'renderer/assets/logo-light.png',
  artifactName: 'Yan.Agent-${version}-linux-${arch}.${ext}'
};
config.mac = {
  target: ['dmg', 'zip'], category: 'public.app-category.developer-tools',
  icon: 'renderer/assets/logo-light.png',
  artifactName: 'Yan.Agent-${version}-mac-${arch}.${ext}',
  // Initial portability builds are unsigned test artifacts. Developer ID
  // signing/notarization needs a separate release configuration and credentials.
  identity: null,
  extendInfo: { NSMicrophoneUsageDescription: 'Yan Agent 使用麦克风录制语音输入。' }
};
module.exports = config;
