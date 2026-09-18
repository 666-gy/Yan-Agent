'use strict';

// Simple Icons assets are bundled locally so review documents remain usable
// offline and when the Electron app is packaged.
(() => {
  const byExtension = Object.freeze({
    js: 'javascript', cjs: 'javascript', mjs: 'javascript', jsx: 'react',
    ts: 'typescript', tsx: 'react',
    html: 'html5', htm: 'html5', xhtml: 'html5',
    css: 'css', scss: 'sass', sass: 'sass', less: 'less',
    json: 'json', jsonc: 'json', md: 'markdown', markdown: 'markdown',
    yml: 'yaml', yaml: 'yaml', toml: 'toml', xml: 'xml',
    py: 'python', java: 'openjdk', c: 'c', h: 'c',
    cc: 'cplusplus', cpp: 'cplusplus', cxx: 'cplusplus', hpp: 'cplusplus',
    cs: 'dotnet', fs: 'fsharp', fsx: 'fsharp', go: 'go', rs: 'rust',
    rb: 'ruby', php: 'php', swift: 'swift', kt: 'kotlin', kts: 'kotlin',
    scala: 'scala', lua: 'lua', r: 'r', dart: 'dart',
    sh: 'gnubash', bash: 'gnubash', zsh: 'shell', fish: 'shell', ps1: 'shell',
    docker: 'docker', lock: 'git',
    svg: 'svg',
    tf: 'terraform', hcl: 'terraform', sql: 'sqlite', graphql: 'graphql',
    tex: 'latex', gradle: 'gradle', cmake: 'cmake',
    ipynb: 'python'
  });
  const byName = Object.freeze({
    dockerfile: 'docker', makefile: 'make',
    'package.json': 'npm', 'package-lock.json': 'npm',
    'yarn.lock': 'yarn', 'pnpm-lock.yaml': 'pnpm',
    '.gitignore': 'git', '.gitattributes': 'git',
    '.eslintrc': 'eslint', '.prettierrc': 'prettier'
  });

  function slugForFile(filePath) {
    const normalized = String(filePath || '').replace(/\\/g, '/').toLowerCase();
    const basename = normalized.split('/').pop() || '';
    if (byName[basename]) return byName[basename];
    const extension = basename.includes('.') && !basename.endsWith('.')
      ? basename.split('.').pop() || ''
      : '';
    return byExtension[extension] || '';
  }

  function urlForSlug(slug) {
    if (!slug || !/^[a-z0-9-]+$/.test(slug)) return '';
    try {
      return new URL(`assets/simple-icons/${slug}.svg`, document.baseURI).href;
    } catch {
      return `assets/simple-icons/${slug}.svg`;
    }
  }

  globalThis.YanSimpleFileIcons = Object.freeze({ slugForFile, urlForSlug });
})();
