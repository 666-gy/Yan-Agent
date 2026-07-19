/**
 * Yan Agent — Pre-installed UI kit registry (React Bits + Uiverse)
 */
const fs = require('fs');
const path = require('path');

const KITS = {
  'react-bits': { label: 'React Bits', dir: 'react-bits' },
  uiverse: { label: 'Uiverse (Universe UI)', dir: 'uiverse' }
};

let catalogCache = {};

function kitRoot(appRoot) {
  return path.join(appRoot, 'lib', 'ui-kits');
}

function loadCatalog(appRoot, kitId) {
  const key = kitId;
  if (catalogCache[key]) return catalogCache[key];
  const meta = KITS[kitId];
  if (!meta) return null;
  const file = path.join(kitRoot(appRoot), meta.dir, 'catalog.json');
  if (!fs.existsSync(file)) return null;
  catalogCache[key] = JSON.parse(fs.readFileSync(file, 'utf8'));
  return catalogCache[key];
}

function listKits(appRoot) {
  return Object.entries(KITS).map(([id, meta]) => {
    const cat = loadCatalog(appRoot, id);
    return {
      id,
      name: cat?.name || meta.label,
      homepage: cat?.homepage,
      count: id === 'react-bits' ? (cat?.componentCount || cat?.components?.length || 0) : (cat?.patterns?.length || 0),
      note: cat?.note
    };
  });
}

function normalizeKitId(id) {
  const s = String(id || '').trim().toLowerCase();
  if (s === 'reactbits' || s === 'react_bits' || s === 'react-bits') return 'react-bits';
  if (s === 'universe' || s === 'universe-ui' || s === 'uiverse') return 'uiverse';
  return s;
}

function normalizeComponentId(name) {
  return String(name || '').trim().replace(/\s+/g, '');
}

function findReactBitsComponent(catalog, query) {
  const q = normalizeComponentId(query);
  if (!q) return null;
  let hit = catalog.components.find(c => normalizeComponentId(c.id) === q || normalizeComponentId(c.title) === q);
  if (hit) return hit;
  const lower = q.toLowerCase();
  hit = catalog.components.find(c =>
    c.id.toLowerCase().includes(lower) ||
    (c.title || '').toLowerCase().includes(lower) ||
    (c.description || '').toLowerCase().includes(lower)
  );
  return hit || null;
}

function findUiversePattern(catalog, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return null;
  let hit = catalog.patterns.find(p => p.id.toLowerCase() === q || p.name.toLowerCase() === q);
  if (hit) return hit;
  return catalog.patterns.find(p =>
    p.id.toLowerCase().includes(q) ||
    p.name.toLowerCase().includes(q) ||
    (p.desc || '').toLowerCase().includes(q) ||
    (p.category || '').toLowerCase().includes(q)
  ) || null;
}

function listUiKit(appRoot, kitId, query = '') {
  const kid = normalizeKitId(kitId);
  const catalog = loadCatalog(appRoot, kid);
  if (!catalog) return { error: `Unknown UI kit: ${kitId}. Available: ${Object.keys(KITS).join(', ')}` };

  const q = String(query || '').trim().toLowerCase();
  if (kid === 'react-bits') {
    let items = catalog.components || [];
    if (q) {
      items = items.filter(c =>
        c.id.toLowerCase().includes(q) ||
        (c.title || '').toLowerCase().includes(q) ||
        (c.category || '').toLowerCase().includes(q) ||
        (c.description || '').toLowerCase().includes(q)
      );
    }
    return {
      kit: kid,
      count: items.length,
      items: items.slice(0, 60).map(c => ({
        id: c.id,
        title: c.title,
        category: c.category,
        desc: c.description,
        variants: c.variants
      }))
    };
  }

  let items = catalog.patterns || [];
  if (q) {
    items = items.filter(p =>
      p.id.toLowerCase().includes(q) ||
      p.name.toLowerCase().includes(q) ||
      (p.category || '').toLowerCase().includes(q)
    );
  }
  return {
    kit: kid,
    count: items.length,
    items: items.map(p => ({ id: p.id, name: p.name, category: p.category, desc: p.desc }))
  };
}

function readReactBits(appRoot, component, variant = 'JS-CSS') {
  const catalog = loadCatalog(appRoot, 'react-bits');
  const comp = findReactBitsComponent(catalog, component);
  if (!comp) {
    const suggestions = (catalog.components || [])
      .filter(c => String(component).length >= 3 && c.id.toLowerCase().includes(String(component).toLowerCase()))
      .slice(0, 5)
      .map(c => c.id);
    return { error: `React Bits component not found: ${component}`, suggestions };
  }
  const v = String(variant || 'JS-CSS').toUpperCase().replace(/\s+/g, '-');
  const variantKey = v.includes('-') ? v : `${v}`;
  const normalized = ['JS-CSS', 'JS-TW', 'TS-CSS', 'TS-TW'].find(x => x === variantKey) ||
    comp.variants?.[0] || 'JS-CSS';
  const regRel = comp.paths?.[normalized]?.registry || `registry/${comp.id}-${normalized}.json`;
  const regPath = path.join(kitRoot(appRoot), 'react-bits', regRel);
  if (!fs.existsSync(regPath)) {
    return { error: `Registry file missing: ${regRel}`, component: comp.id, variant: normalized };
  }
  const reg = JSON.parse(fs.readFileSync(regPath, 'utf8'));
  const files = (reg.files || []).map(f => ({
    path: f.path,
    content: f.content || ''
  }));
  const lines = [
    `# React Bits: ${comp.title} (${normalized})`,
    `Category: ${comp.category}`,
    comp.description ? `Description: ${comp.description}` : '',
    reg.dependencies?.length ? `Dependencies: ${reg.dependencies.join(', ')}` : '',
    comp.paths?.[normalized]?.source ? `Upstream source: ${comp.paths[normalized].source}` : '',
    '',
    '## Agent notes',
    '- Pre-installed locally — do NOT fetch from GitHub.',
    '- For static .html: adapt to vanilla HTML/CSS or use uiverse kit.',
    '- install deps in workspace if using React variant.',
    ''
  ].filter(Boolean);

  for (const f of files) {
    lines.push(`## File: ${f.path}`, '```', f.content, '```', '');
  }
  return {
    ok: true,
    kit: 'react-bits',
    component: comp.id,
    variant: normalized,
    category: comp.category,
    dependencies: reg.dependencies || [],
    content: lines.join('\n')
  };
}

function readUiverse(appRoot, component) {
  const catalog = loadCatalog(appRoot, 'uiverse');
  const pat = findUiversePattern(catalog, component);
  if (!pat) {
    return {
      error: `Uiverse pattern not found: ${component}`,
      suggestions: (catalog.patterns || []).map(p => p.id)
    };
  }
  const content = [
    `# Uiverse: ${pat.name}`,
    `Category: ${pat.category}`,
    pat.desc || '',
    '',
    '## HTML',
    '```html',
    pat.html,
    '```',
    '',
    '## CSS',
    '```css',
    pat.css,
    '```',
    '',
    'Paste into your .html file. Prefer this kit for static HTML pages.'
  ].join('\n');
  return { ok: true, kit: 'uiverse', component: pat.id, content };
}

function readUiKit(appRoot, kitId, component, variant) {
  const kid = normalizeKitId(kitId);
  if (kid === 'react-bits') return readReactBits(appRoot, component, variant);
  if (kid === 'uiverse') return readUiverse(appRoot, component);
  return { error: `Unknown UI kit: ${kitId}` };
}

function formatPromptSection(appRoot) {
  const kits = listKits(appRoot);
  const lines = kits.map(k =>
    `- **${k.id}** (${k.name}): ${k.count} items pre-installed — use read_ui_kit, never fetch GitHub for react-bits`
  );
  lines.push('- Static HTML (.html): prefer `uiverse`; React/animated: `react-bits`');
  lines.push('- BlurText category is **Text Animations** → folder `TextAnimations` (not Components)');
  return lines.join('\n');
}

function clearCache() {
  catalogCache = {};
}

module.exports = {
  KITS,
  listKits,
  listUiKit,
  readUiKit,
  formatPromptSection,
  clearCache
};
