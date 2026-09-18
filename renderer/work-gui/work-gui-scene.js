// Yan Work GUI — a continuous riverside settlement, driven by real runtime events.
// Geometry/materials are shared; static scenery is instanced before the first frame.
(() => {
  'use strict';
  const T = window.THREE;

  const C = {
    paper: 0xe9eee5, water: 0x87b9b5, ripple: 0xc9e0d3, grass: 0xa9bc87,
    grassLight: 0xbdcb9b, bank: 0xd2d3b5, soil: 0xaba88a, path: 0xe4dcc2,
    wall: 0xf0e4c9, trim: 0xdbcdad, timber: 0x86664b, timberLight: 0xb68d63,
    roof: 0x547976, roofLight: 0x71908a, terracotta: 0xbc7355, coral: 0xdb9070,
    leaf: 0x63855e, leafLight: 0x819d6a, leafDark: 0x436c54, gold: 0xd9b369,
    ink: 0x304a49, window: 0x395d60, glass: 0x83a5a0, cream: 0xfff0cb,
    metal: 0x435b5c, rock: 0xa4b0a0, flower: 0xebcf91, red: 0xb9614f
  };
  const ZONES = {
    dock: { x: -38, z: 22, label: '出发码头', activity: '接收任务' },
    tower: { x: -33, z: -18, label: '远望台', activity: '搜索与探索' },
    workshop: { x: -25, z: 3, label: '编程工坊', activity: '编写与修改' },
    forge: { x: -15, z: 22, label: '测试工场', activity: '运行与验证' },
    hall: { x: -10, z: -15, label: '协作广场', activity: '计划与协作' },
    library: { x: -15, z: -32, label: '记忆书屋', activity: '阅读与检索' },
    studio: { x: 0, z: 3, label: '创作室', activity: '图像与媒体' },
    lighthouse: { x: 39, z: -24, label: '交付灯塔', activity: '成果与交付' }
  };
  const stationName = zone => ZONES[zone]?.label || zone;
  window.YanWorkGuiScene = { stationName };
  if (!T) return;
  const LIFE = [
    { x: 27, z: 22, activity: '在咖啡庭院休息', pose: 'coffee' },
    { x: 32, z: -1, activity: '在花园散步', pose: 'garden' },
    { x: 20, z: -19, activity: '在河边读书', pose: 'read' },
    { x: 40, z: 14, activity: '在长椅上歇一会儿', pose: 'sit' }
  ];
  function seed(text) {
    let h = 2166136261;
    for (const c of String(text)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return (h >>> 0) / 4294967295;
  }
  function rng(initial) {
    let n = initial;
    return () => { n = (n * 1664525 + 1013904223) >>> 0; return n / 4294967296; };
  }

  function create(canvas, options = {}) {
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    let reducedMotion = motionQuery.matches;
    let disposed = false, time = 0, sceneName = 'overview';
    const pixelRequests = [];
    let width = 1, height = 1, day = 'day', storm = false, followId = '';
    let renderer;
    try {
      renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'default' });
    } catch (error) { console.warn('[work-gui] WebGL unavailable:', error.message); return null; }
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;
    const scene = new T.Scene();
    scene.background = new T.Color(C.paper);
    scene.fog = new T.Fog(C.paper, 165, 350);
    const camera = new T.OrthographicCamera(-65, 65, 45, -45, 0.1, 500);
    const hemi = new T.HemisphereLight(0xf4f1de, 0x739a88, 2.1);
    scene.add(hemi);
    const sun = new T.DirectionalLight(0xffe7be, 2.8);
    sun.position.set(-45, 85, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -90, right: 90, top: 80, bottom: -80, near: 1, far: 200 });
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.12;
    sun.shadow.radius = 4;
    scene.add(sun);
    const staticRoot = new T.Group();
    scene.add(staticRoot);
    const geometries = new Map(), materials = new Map(), textures = new Set();
    const labels = [], stations = new Map(), characters = new Map(), pickables = [];
    const effects = [], ripples = [], birds = [];
    const random = rng(42026);
    const vector = new T.Vector3();
    const view = { x: 0, z: 0, span: 112, yaw: 0.40, pitch: 0.86 };
    const goal = { ...view };
    const previews = { overview: [0, 0, 106], worksite: [-20, -3, 65], home: [29, 7, 58] };

    function material(color, glow = false) {
      const key = color + ':' + glow;
      if (!materials.has(key)) materials.set(key, new T.MeshStandardMaterial({
        color, roughness: 0.94, metalness: 0, emissive: glow ? color : 0, emissiveIntensity: glow ? 0.35 : 0
      }));
      return materials.get(key);
    }
    function geometry(key, factory) {
      if (!geometries.has(key)) geometries.set(key, factory());
      return geometries.get(key);
    }
    function mesh(parent, geo, color, x = 0, y = 0, z = 0) {
      const m = new T.Mesh(geo, material(color));
      m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
    }
    function box(parent, w, h, d, color, x = 0, y = 0, z = 0) {
      const m = mesh(parent, geometry('box', () => new T.BoxGeometry(1, 1, 1)), color, x, y, z);
      m.scale.set(w, h, d); return m;
    }
    function round(parent, w, h, d, color, x = 0, y = 0, z = 0, radius = 0.12) {
      const key = ['round', w, h, d, radius].join(':');
      const geo = geometry(key, () => {
        const shape = new T.Shape(), a = -w / 2, b = -h / 2, r = Math.min(radius, w / 2, h / 2);
        shape.moveTo(a + r, b); shape.lineTo(a + w - r, b);
        shape.quadraticCurveTo(a + w, b, a + w, b + r); shape.lineTo(a + w, b + h - r);
        shape.quadraticCurveTo(a + w, b + h, a + w - r, b + h); shape.lineTo(a + r, b + h);
        shape.quadraticCurveTo(a, b + h, a, b + h - r); shape.lineTo(a, b + r);
        shape.quadraticCurveTo(a, b, a + r, b);
        const g = new T.ExtrudeGeometry(shape, { depth: d - r, bevelEnabled: true, bevelSize: r / 2, bevelThickness: r / 2, bevelSegments: 2, steps: 1, curveSegments: 3 });
        g.translate(0, 0, -(d - r) / 2); return g;
      });
      return mesh(parent, geo, color, x, y, z);
    }
    function cylinder(parent, r, h, color, x = 0, y = 0, z = 0, rTop = r) {
      const geo = geometry('cyl:' + rTop / r, () => new T.CylinderGeometry(rTop / r, 1, 1, 16));
      const m = mesh(parent, geo, color, x, y, z); m.scale.set(r, h, r); return m;
    }
    function sphere(parent, r, color, x, y, z, sx = 1, sy = 1, sz = 1) {
      const m = mesh(parent, geometry('sphere', () => new T.IcosahedronGeometry(1, 2)), color, x, y, z);
      m.scale.set(r * sx, r * sy, r * sz); return m;
    }
    function beam(parent, from, to, radius, color) {
      const start = new T.Vector3(...from), end = new T.Vector3(...to);
      const m = cylinder(parent, radius, start.distanceTo(end), color);
      m.position.copy(start).add(end).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), end.sub(start).normalize()); return m;
    }
    function slab(points, top, depth, color) {
      const shape = new T.Shape();
      points.forEach(([x, z], i) => { if (!i) shape.moveTo(x, -z); else shape.lineTo(x, -z); });
      shape.closePath();
      const geo = new T.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: 0.55, bevelThickness: 0.08, bevelSegments: 2, steps: 1 });
      geo.rotateX(-Math.PI / 2); geometries.set('slab' + geometries.size, geo);
      return mesh(staticRoot, geo, color, 0, top - depth, 0);
    }
    let roadLevel = 0;
    function road(points, breadth = 2.5) {
      const level = 0.14 + roadLevel++ * 0.006;
      for (let i = 1; i < points.length; i++) {
        const [ax, az] = points[i - 1], [bx, bz] = points[i];
        const m = box(staticRoot, breadth, 0.10, Math.hypot(bx - ax, bz - az), C.path, (ax + bx) / 2, level + i * 0.0003, (az + bz) / 2);
        m.rotation.y = Math.atan2(bx - ax, bz - az);
        cylinder(staticRoot, breadth / 2, 0.10, C.path, bx, level + i * 0.0003 + 0.001, bz);
      }
    }
    function tree(x, z, scale = 1, golden = false) {
      const g = new T.Group(); g.position.set(x, 0.12, z); g.scale.setScalar(scale); staticRoot.add(g);
      cylinder(g, 0.25, 3.8, C.timber, 0, 1.9, 0, 0.17);
      beam(g, [0, 2, 0], [1.0, 3.6, 0.2], 0.13, C.timber);
      const leaf = golden ? C.gold : C.leaf;
      sphere(g, 1.65, leaf, 0, 4.4, 0, 1, 1.2, 0.9);
      sphere(g, 1.3, golden ? C.flower : C.leafLight, -1.0, 3.7, 0.6);
      sphere(g, 1.25, golden ? C.gold : C.leafDark, 1, 3.6, -0.3);
    }
    function planter(parent, x, z, length = 2.2) {
      round(parent, length, 0.65, 0.85, C.timberLight, x, 0.4, z, 0.1);
      for (let i = 0; i < 4; i++) {
        const px = x - length / 2 + 0.35 + i * length / 4;
        sphere(parent, 0.36, C.leafDark, px, 0.9, z, 1, 0.8, 1);
        sphere(parent, 0.15, i % 2 ? C.flower : C.coral, px, 1.2, z);
      }
    }
    function bench(x, z, angle = 0) {
      const g = new T.Group(); g.position.set(x, 0, z); g.rotation.y = angle; staticRoot.add(g);
      for (let j = 0; j < 3; j++) box(g, 3, 0.13, 0.22, C.timberLight, 0, 0.9, j * 0.3);
      for (let j = 0; j < 2; j++) box(g, 3, 0.24, 0.13, C.timberLight, 0, 1.45 + j * 0.32, -0.08);
      for (const x of [-1, 1]) { box(g, 0.16, 0.9, 0.7, C.metal, x, 0.45, 0.25); box(g, 0.14, 1.6, 0.14, C.metal, x, 0.9, -0.08); }
    }
    function lamp(x, z) {
      cylinder(staticRoot, 0.10, 3.5, C.metal, x, 1.75, z);
      round(staticRoot, 0.62, 0.8, 0.62, C.cream, x, 3.6, z);
      box(staticRoot, 0.85, 0.13, 0.85, C.roof, x, 4.05, z);
    }
    function label(text, x, y, z, major = false) {
      const cv = document.createElement('canvas'); cv.width = 512; cv.height = 96;
      const ctx = cv.getContext('2d');
      ctx.font = (major ? '600 33px ' : '500 30px ') + '"Microsoft YaHei",sans-serif';
      const w = Math.min(490, ctx.measureText(text).width + 38);
      ctx.fillStyle = major ? '#304a49' : '#fff9e9';
      ctx.beginPath(); ctx.roundRect((512 - w) / 2, 10, w, 65, 10); ctx.fill();
      ctx.fillStyle = major ? '#fff3d8' : '#304a49';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 256, 43, 458);
      const texture = new T.CanvasTexture(cv); texture.colorSpace = T.SRGBColorSpace; textures.add(texture);
      const mat = new T.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
      materials.set('label:' + materials.size, mat);
      const s = new T.Sprite(mat); s.position.set(x, y, z); s.scale.set(12.8, 2.4, 1); s.renderOrder = 5;
      scene.add(s); labels.push({ sprite: s, major }); return s;
    }

    // Continuous terrain: two banks, connected by footbridges; water continues beyond the map.
    const sea = box(staticRoot, 900, 0.3, 900, C.water, 0, -2.1, 0);
    sea.receiveShadow = false;
    const west = [[-48,-26],[-40,-39],[-19,-43],[2,-39],[5,-28],[2,-18],[6,-6],[4,7],[7,20],[1,33],[-13,38],[-36,33],[-47,23],[-50,1]];
    const east = [[16,-31],[27,-39],[43,-33],[50,-17],[49,3],[54,18],[45,31],[29,36],[16,29],[15,17],[12,6],[14,-8],[12,-19]];
    for (const outline of [west, east]) {
      slab(outline, -0.9, 3.3, C.soil);
      slab(outline.map(([x,z]) => [x * 0.993, z * 0.992]), -0.1, 0.9, C.bank);
      slab(outline.map(([x,z]) => [x * 0.982, z * 0.976]), 0, 0.25, C.grass);
    }
    // Small reed islands and distant land lend the scene a horizon without a hard display plinth.
    for (const [x,z,s] of [[-68,35,6],[67,-44,9],[74,36,5],[-62,-61,8]]) {
      cylinder(staticRoot, s, 1.6, C.bank, x, -2.1, z, s * 0.88);
      cylinder(staticRoot, s * 0.86, 0.3, C.grass, x, -1.2, z);
      tree(x, z, 0.85);
    }
    const laneWest = [[-37,26],[-32,13],[-18,12],[-6,12],[-5,-6],[-20,-6],[-29,-6],[-29,-11],[-21,-23],[-11,-23]];
    road(laneWest, 3.1);
    road([[-29,-6],[-24,-6],[-24,7]], 2.4);
    road([[-18,12],[-15,16]], 2.5);
    road([[-5,-6],[-2,-8],[-10,-8]], 2.5);
    road([[-5,-6],[2,-12],[22,-12],[30,-12],[36,-19]], 2.7);
    road([[-6,12],[2,16],[21,16],[30,16],[41,16]], 3);
    road([[22,-12],[23,0],[21,16],[28,29]], 2.8);
    road([[23,0],[32,6],[41,6]], 2.3);
    function bridge(z) {
      const g = new T.Group(); staticRoot.add(g); g.position.set(10, 0.15, z);
      for (let i = 0; i < 18; i++) {
        const x = -8.5 + i, arch = Math.sin(i / 17 * Math.PI) * 0.65;
        box(g, 0.91, 0.25, 3.1, i % 3 === 0 ? C.timberLight : C.timber, x, arch, 0);
        if (i % 3 === 0) for (const side of [-1.7, 1.7]) cylinder(g, 0.09, 1.45, C.timber, x, arch + 0.7, side);
        if (i) for (const side of [-1.7, 1.7]) beam(g, [x - 1, Math.sin((i - 1) / 17 * Math.PI) * 0.65 + 1.3, side], [x, arch + 1.3, side], 0.07, C.timberLight);
      }
    }
    bridge(-12); bridge(16);
    for (let i = 0; i < 90; i++) {
      const x = random() * 130 - 65, z = random() * 105 - 52;
      if ((x > 4 && x < 12) || x < -52 || x > 56 || z < -45 || z > 39) {
        const m = box(scene, 0.6 + random() * 2, 0.015, 0.055, C.ripple, x, -1.85, z);
        m.castShadow = false; ripples.push(m);
      }
    }

    function desk(g, x, z, type = 'code') {
      round(g, 2.4, 0.20, 1.3, C.timberLight, x, 1.65, z, 0.08);
      for (const dx of [-0.9, 0.9]) box(g, 0.13, 1.6, 0.9, C.metal, x + dx, 0.8, z);
      if (type === 'code') {
        round(g, 1.3, 0.88, 0.10, C.ink, x, 2.35, z - 0.32, 0.08);
        round(g, 1.13, 0.70, 0.025, C.glass, x, 2.36, z - 0.24, 0.04);
        for (let i = 0; i < 4; i++) box(g, 0.3 + (i % 2) * 0.35, 0.028, 0.03, C.cream, x - 0.22 + i % 2 * 0.1, 2.54 - i * 0.12, z - 0.22);
        box(g, 0.08, 0.3, 0.08, C.metal, x, 1.9, z - 0.32);
        round(g, 1.1, 0.065, 0.36, C.cream, x, 1.8, z + 0.25, 0.04);
      } else {
        for (let i = 0; i < 3; i++) {
          const b = box(g, 0.8, 0.11, 0.65, i % 2 ? C.terracotta : C.roof, x + 0.3, 1.81 + i * 0.12, z);
          b.rotation.y = i * 0.12;
        }
      }
      cylinder(g, 0.13, 0.28, C.cream, x - 0.8, 1.92, z + 0.25);
      round(g, 0.9, 0.16, 0.8, C.roof, x, 0.82, z + 1.0);
      box(g, 0.16, 0.76, 0.16, C.timber, x, 0.38, z + 1);
    }
    function room(zone, x, z, variant) {
      const g = new T.Group(); g.position.set(x, 0.15, z); staticRoot.add(g);
      const w = variant === 'library' ? 8 : 7.2, d = 5.7, h = 4.6;
      round(g, w + 1.8, 0.45, d + 2.8, C.trim, 0, 0.2, 0.65, 0.2);
      for (let j = 0; j < 10; j++) box(g, w + 1.2, 0.08, 0.55, j % 2 ? C.wall : C.trim, 0, 0.48, -2.2 + j * 0.65);
      round(g, w, h, 0.3, C.wall, 0, h / 2 + 0.4, -d / 2, 0.08);
      box(g, 0.3, h, d, C.wall, -w / 2, h / 2 + 0.4, 0);
      // An open facade exposes the action; the rear half-roof keeps a distinct silhouette.
      for (const px of [-w / 2, w / 2]) box(g, 0.25, h, 0.25, C.timber, px, h / 2 + 0.4, d / 2);
      box(g, w + 0.3, 0.25, 0.25, C.timber, 0, h + 0.25, d / 2);
      const roofColor = variant === 'forge' ? C.terracotta : C.roof;
      const roof = box(g, w + 1, 0.28, d * 0.7, roofColor, 0, h + 0.62, -1.35);
      roof.rotation.x = -0.19;
      for (let i = 0; i < 10; i++) {
        const seam = box(g, 0.06, 0.08, d * 0.7, C.roofLight, -w / 2 - 0.2 + i * (w + 0.4) / 9, h + 0.82, -1.35);
        seam.rotation.x = -0.19;
      }
      box(g, 2.2, 1.5, 0.10, C.window, 1.6, 2.8, -2.63);
      for (const dx of [-0.6,0,0.6]) box(g, 0.07, 1.4, 0.12, C.trim, 1.6 + dx, 2.8, -2.55);
      box(g, 2.2, 0.07, 0.12, C.trim, 1.6, 2.8, -2.55);
      if (variant === 'library') {
        for (let row = 0; row < 3; row++) {
          box(g, 2.4, 0.15, 0.8, C.timber, -1.7, 1.2 + row * 0.9, -2);
          for (let j = 0; j < 7; j++) box(g, 0.19, 0.46 + (j % 3) * 0.1, 0.43, [C.roof,C.terracotta,C.gold][j%3], -2.65 + j * 0.3, 1.55 + row * 0.9, -2);
        }
        desk(g, -0.6, 0.7, 'read');
      } else if (variant === 'studio') {
        for (const px of [-1.9, 1.7]) {
          beam(g, [px - 0.5, 0.5, 0.8], [px, 3.5, 0.4], 0.08, C.timber);
          beam(g, [px + 0.5, 0.5, 0.8], [px, 3.5, 0.4], 0.08, C.timber);
          box(g, 1.7, 1.9, 0.12, C.cream, px, 2.4, 0.52);
          cylinder(g, 0.44, 0.03, C.gold, px + 0.3, 2.7, 0.61).rotation.x = Math.PI / 2;
          box(g, 1.5, 0.55, 0.04, C.leaf, px, 1.85, 0.62);
        }
      } else {
        desk(g, -1.7, 0.1);
        if (variant === 'forge') {
          round(g, 1.7, 2.4, 1.5, C.metal, 1.8, 1.65, 0, 0.18);
          for (let j = 0; j < 4; j++) {
            box(g, 1.4, 0.27, 0.05, C.ink, 1.8, 0.9 + j * 0.47, 0.78);
            sphere(g, 0.055, C.gold, 2.25, 0.9 + j * 0.47, 0.82);
          }
          cylinder(g, 0.38, 2.0, C.metal, 2.4, 5.3, -1.8);
        } else desk(g, 1.55, 0.1);
      }
      planter(g, -w / 2 - 0.4, 4, 2.4);
      const st = { group: g, x, z: z + 4.5, workZ: z + 1.5, activity: ZONES[zone].activity };
      stations.set(zone, st);
      pickables.push({ target: { kind: 'station', zone }, x, z, y: 2, radius: 5.8 });
      label(ZONES[zone].label, x, 7.2, z - 1.5);
    }
    room('workshop', -25, 3, 'code');
    room('forge', -15, 22, 'forge');
    room('library', -15, -32, 'library');
    room('studio', 0, 3, 'studio');
    // Open meeting pergola.
    const hall = new T.Group(); hall.position.set(-10, 0.1, -15); staticRoot.add(hall);
    round(hall, 9, 0.3, 7, C.trim, 0, 0.15, 0, 0.25);
    for (const x of [-3.7,3.7]) for (const z of [-2.7,2.7]) box(hall, 0.2, 4.6, 0.2, C.timber, x, 2.3, z);
    for (let i = 0; i < 8; i++) box(hall, 8.6, 0.16, 0.28, C.timberLight, 0, 4.7, -3 + i * 0.85);
    round(hall, 4.5, 0.25, 2.5, C.wall, 0, 1.65, 0, 0.3);
    for (const x of [-1.5,0,1.5]) for (const z of [-2,2]) {
      round(hall, 0.8, 0.25, 0.8, C.roof, x, 0.85, z);
      cylinder(hall, 0.15, 0.8, C.timber, x, 0.4, z);
    }
    box(hall, 3.3, 1.8, 0.16, C.cream, 0, 2.4, -2.4);
    for (let i = 0; i < 5; i++) box(hall, 0.4, 0.5, 0.02, i % 2 ? C.gold : C.coral, -1 + i * 0.5, 2.4 + (i % 2) * 0.4, -2.3);
    stations.set('hall', { x:-10,z:-10.5,workZ:-13.5,activity:'正在整理计划' });
    label(stationName('hall'), -10, 6.5, -17);
    pickables.push({ target:{kind:'station',zone:'hall'},x:-10,z:-15,y:2,radius:5 });

    // Lookout with a telescope, and a coastal lighthouse with a balcony.
    function tower(zone, x, z, lighthouse = false) {
      const g = new T.Group(); g.position.set(x, 0.1, z); staticRoot.add(g);
      if (lighthouse) {
        cylinder(g, 2.2, 0.4, C.trim, 0, 0.2, 0);
        cylinder(g, 1.65, 8.5, C.wall, 0, 4.7, 0, 1.3);
        for (const y of [3,6]) cylinder(g, 1.65 - y * 0.035, 0.85, C.terracotta, 0, y, 0);
        cylinder(g, 2.1, 0.22, C.roof, 0, 9, 0);
        cylinder(g, 1.15, 1.8, C.window, 0, 10, 0);
        cylinder(g, 1.75, 0.45, C.roof, 0, 11.1, 0, 0.1);
        for (let i=0;i<12;i++) cylinder(g,0.05,0.85,C.metal,1.85*Math.cos(i*Math.PI/6),9.55,1.85*Math.sin(i*Math.PI/6));
        const torus=geometry('balcony',()=>new T.TorusGeometry(1.85,0.045,6,36));
        const rail=mesh(g,torus,C.metal,0,10,0);rail.rotation.x=Math.PI/2;
        round(g,0.7,1.5,0.12,C.timber,0,1.2,1.65);
      } else {
        for (const x of [-1.7,1.7]) for (const z of [-1.7,1.7]) box(g,0.23,5,0.23,C.timber,x,2.5,z);
        box(g,4.3,0.24,4.3,C.timberLight,0,5.1,0);
        for(let i=0;i<9;i++) box(g,2,0.15,0.5,C.trim,0,0.25+i*0.55,5-i*0.48);
        const scope=cylinder(g,0.38,2.3,C.metal,0,6.8,0,0.28);scope.rotation.z=-1.05;
        cylinder(g,0.11,1.8,C.timberLight,0,6,0);
        for(const x of [-2,2]) beam(g,[x,5.8,-2],[x,5.8,2],0.07,C.timber);
      }
      stations.set(zone,{x,z:z+5,workZ:z+4,activity:ZONES[zone].activity});
      pickables.push({target:{kind:'station',zone},x,z,y:4,radius:4});
      label(ZONES[zone].label,x,lighthouse?12.8:9,z);
    }
    tower('tower',-33,-18);tower('lighthouse',39,-24,true);

    // Dock, moored boat and departure supplies.
    for(let i=0;i<16;i++) box(staticRoot,5.2,0.2,0.58,C.timberLight,-38,0.1,21+i*0.65);
    for(const x of [-40.3,-35.7]) for(const z of [24,29,31]) cylinder(staticRoot,0.14,3.5,C.timber,x,-0.3,z);
    for(const [x,z] of [[-42,23],[-41,21],[-43,21]]) round(staticRoot,1.2,1.2,1.2,C.timberLight,x,0.7,z);
    stations.set('dock',{x:-38,z:25,workZ:25,activity:'等待任务'});
    label(stationName('dock'),-38,3.5,24);
    pickables.push({target:{kind:'station',zone:'dock'},x:-38,z:25,y:0,radius:4});
    const boat = new T.Group(); scene.add(boat);
    round(boat,2.4,0.6,5.3,C.terracotta,0,0,0,0.4);
    round(boat,1.95,0.2,4.5,C.timberLight,0,0.35,0,0.2);
    for(const z of [-1,0.8]) box(boat,2.0,0.13,0.45,C.wall,0,0.55,z);
    beam(boat,[-1.6,0.5,0.9],[1.6,0.5,-0.9],0.05,C.timber);
    boat.position.set(-35,-1.5,33);boat.rotation.y=-0.35;

    // The living bank: a cafe, vegetable beds, cabins, reading nook and public benches.
    const cafe = new T.Group(); cafe.position.set(29,0,23);staticRoot.add(cafe);
    round(cafe,6.7,0.3,5.5,C.trim,0,0.15,0,0.3);
    box(cafe,5.6,3.5,0.3,C.wall,0,1.95,-2);
    round(cafe,5.6,1.45,1.1,C.timberLight,0,1.1,0);
    for(let i=0;i<7;i++) box(cafe,0.48,0.14,3.7,i%2?C.wall:C.terracotta,-2.6+i*0.86,3.75,-0.2).rotation.x=-0.09;
    for(const x of [-2.7,2.7]) box(cafe,0.15,3.7,0.15,C.timber,x,1.85,1.65);
    round(cafe,0.8,0.8,0.7,C.metal,-1,2.2,-0.9);
    for(const x of [-1,0,1]) cylinder(cafe,0.12,0.25,C.cream,x,1.95,0);
    label('河畔咖啡',29,5.7,22);
    for(const [x,z] of [[26,18],[33,18]]) {
      cylinder(staticRoot,1.0,0.18,C.wall,x,1.5,z);
      cylinder(staticRoot,0.13,1.4,C.metal,x,0.7,z);
      for(const dx of [-1.4,1.4]) {cylinder(staticRoot,0.45,0.18,C.roof,x+dx,0.8,z);cylinder(staticRoot,0.11,0.75,C.timber,x+dx,0.38,z);}
    }
    for(let i=0;i<4;i++) for(let j=0;j<3;j++) {
      box(staticRoot,2.3,0.24,1.2,C.soil,33+i*2.8,0.3,-5+j*1.9);
      for(let k=0;k<3;k++) sphere(staticRoot,0.3,C.leafDark,32.3+i*2.8+k*0.6,0.65,-5+j*1.9,1,0.6,1);
    }
    label('生活庭院',36,3.5,-5);
    bench(20,-19,-Math.PI/2);bench(40,14,-0.2);bench(-36,6,Math.PI/2);
    for(const [x,z] of [[19,-23],[18,-15],[19,10],[25,27],[43,11],[-31,12],[-5,17],[-22,-22]]) lamp(x,z);
    for(const [x,z,s,gold] of [
      [-43,-26,1.1],[-35,-33,1.2],[-26,-35,0.8],[-41,-7,1.4],[-43,1,0.95],
      [-44,12,1.1],[-29,29,1.1],[-24,32,0.9],[-4,28,1.15],[-3,-30,1],
      [21,-29,1.2],[27,-31,0.95],[43,-13,1.1],[46,-9,0.9],[48,6,1.1],
      [45,22,1.3],[37,29,0.9],[18,25,0.8],[31,10,0.8,true],[-4,-20,0.7,true]
    ]) tree(x,z,s,gold);
    for(let i=0;i<80;i++) {
      const x=random()*98-48,z=random()*70-35;
      if((x < -38 || x > 44 || z < -36) && !(x>3&&x<17)){
        sphere(staticRoot,0.25+random()*0.45,C.rock,x,0.3,z,1.3,0.65,1);
        if(i%3===0) sphere(staticRoot,0.13,C.flower,x+0.7,0.3,z);
      }
    }
    for(const [x,z] of [[-31,1],[-19,27],[-3,7],[25,12],[30,26]]) planter(staticRoot,x,z,2.8);
    // Short meadow tufts and flower beds break up broad surfaces around the public places.
    for (const [cx,cz,count] of [[-40,-7,24],[-36,-30,20],[-29,28,22],[-6,27,16],[21,-28,16],[44,22,24],[43,-11,18]]) {
      for (let i=0;i<count;i++) {
        const angle=random()*Math.PI*2, radius=1+random()*3.6;
        const x=cx+Math.cos(angle)*radius,z=cz+Math.sin(angle)*radius;
        for(const tilt of [-0.22,0.2]) {
          const blade=box(staticRoot,0.055,0.24+random()*0.2,0.075,C.leafLight,x,0.25,z);
          blade.rotation.z=tilt;
        }
        if(i%4===0)sphere(staticRoot,0.11,i%8?C.flower:C.coral,x,0.55,z);
      }
    }
    label('工作街区',-25,0.7,-10,true);
    label('生活庭院',29,0.7,12,true);

    // Capability buildings are a small, persistent neighbourhood on the same bank.
    const homeRoot = new T.Group(); scene.add(homeRoot);
    let homeSignature = '', homeData = null;
    function setHome(data) {
      homeData=data;
      const signature=JSON.stringify((data?.buildings||[]).map(b=>[b.id,b.name,b.level]));
      if(signature===homeSignature)return;
      homeSignature=signature;
      homeRoot.clear();
      for(let i=pickables.length-1;i>=0;i--)if(pickables[i].home)pickables.splice(i,1);
      (data?.buildings||[]).slice(0,6).forEach((b,i)=>{
        const x=24+(i%3)*7,z=-7-Math.floor(i/3)*8;
        const g=new T.Group();g.position.set(x,0.2,z);homeRoot.add(g);
        round(g,4.8,0.25,4.8,C.trim,0,0.1,0);
        round(g,4,2.5,3.3,C.wall,0,1.5,0);
        const roof=box(g,4.6,0.22,4.1,b.kind==='mcp'?C.roof:C.terracotta,0,2.95,0);
        roof.rotation.z=0.07;
        round(g,1.4,1.2,0.04,C.window,-0.7,1.7,1.68,0.03);
        box(g,0.8,1.8,0.05,C.timber,1.1,1.3,1.68);
        for(let j=0;j<Math.min(4,b.level||1);j++)box(g,0.12,0.24,0.04,C.gold,-0.65+j*0.3,2.5,1.7);
        planter(g,-1,2.5,1.8);
        pickables.push({home:true,target:{kind:'building',id:b.id,buildingKind:b.kind,name:b.name,level:b.level},x,z,y:1.5,radius:3});
      });
      renderer.shadowMap.needsUpdate=true;
    }

    // Merge repeated static meshes into batches with one draw call per geometry/material.
    staticRoot.updateMatrixWorld(true);
    const batches=new Map();
    staticRoot.traverse(o=>{
      if(!o.isMesh)return;
      const key=o.geometry.uuid+':'+o.material.uuid+':'+o.receiveShadow;
      if(!batches.has(key))batches.set(key,{geometry:o.geometry,material:o.material,receive:o.receiveShadow,cast:o.castShadow,matrices:[]});
      batches.get(key).matrices.push(o.matrixWorld.clone());
    });
    staticRoot.clear();
    for(const b of batches.values()){
      const m=new T.InstancedMesh(b.geometry,b.material,b.matrices.length);
      b.matrices.forEach((matrix,i)=>m.setMatrixAt(i,matrix));
      m.castShadow=b.cast;m.receiveShadow=b.receive;m.computeBoundingSphere();staticRoot.add(m);
    }
    renderer.shadowMap.needsUpdate=true;

    const indicators = new Map();
    for (const [zone, station] of stations) {
      const bulb = sphere(scene, 0.21, C.gold, station.x + 3.8, 1.2, station.z - 0.5);
      bulb.material = material(C.gold, true); bulb.visible = false;
      indicators.set(zone, bulb);
    }
    const taskMarks = [];
    for (let i=0;i<6;i++) {
      const mark = box(scene, 0.32, 0.32, 0.06, C.roof, -11.3+i*0.52, 3.0, -17.22);
      mark.visible = false; taskMarks.push(mark);
    }
    const attention = label('需要关注', -33, 10, -18);
    attention.visible = false;
    labels.splice(labels.findIndex(item => item.sprite === attention), 1);

    // Residents: articulated little field robots. Screen, antenna, backpack and props give each a role.
    function makeCharacter(actor) {
      const g=new T.Group();scene.add(g);
      const color=actor.kind==='main'?C.terracotta:[C.roof,C.gold,0x78938c,0x8993a0][Math.floor(seed(actor.id)*4)];
      const torso=round(g,0.85,0.85,0.6,color,0,1.15,0,0.17);
      round(g,0.55,0.45,0.14,C.wall,0,1.17,0.35,0.05);
      const head=new T.Group();g.add(head);head.position.y=1.97;
      round(head,1.2,0.83,0.78,C.wall,0,0,0,0.2);
      round(head,0.94,0.48,0.07,C.ink,0,-0.02,0.42,0.12);
      const eyes=[];
      for(const x of [-0.23,0.23]) eyes.push(round(head,0.10,0.18,0.035,C.cream,x,0,0.47,0.04));
      cylinder(head,0.035,0.25,C.metal,0,0.52,0);
      sphere(head,0.10,color,0,0.71,0);
      round(g,0.64,0.62,0.24,C.timberLight,0,1.22,-0.42,0.1);
      const arms=[],legs=[];
      for(const side of [-1,1]){
        const a=new T.Group();g.add(a);a.position.set(side*0.55,1.53,0);
        round(a,0.23,0.58,0.25,color,0,-0.23,0,0.09);
        sphere(a,0.15,C.wall,0,-0.54,0);arms.push(a);
        const leg=new T.Group();g.add(leg);leg.position.set(side*0.23,0.79,0);
        round(leg,0.25,0.49,0.27,C.metal,0,-0.23,0,0.07);
        round(leg,0.32,0.18,0.49,C.ink,0,-0.47,0.08,0.07);legs.push(leg);
      }
      const book=new T.Group();g.add(book);
      const left=box(book,0.43,0.055,0.55,C.cream,-0.21,0,0);left.rotation.z=0.2;
      const right=box(book,0.43,0.055,0.55,C.cream,0.21,0,0);right.rotation.z=-0.2;
      book.position.set(0,1.2,0.7);book.visible=false;
      const cup=cylinder(g,0.14,0.29,C.cream,0.6,1.7,0.6);cup.visible=false;
      const shadowGeo=geometry('shadow',()=>new T.CircleGeometry(0.7,24));
      const shadowMat=new T.MeshBasicMaterial({color:0x304b40,transparent:true,opacity:0.13,depthWrite:false});
      materials.set('shadow'+actor.id,shadowMat);
      const shadow=new T.Mesh(shadowGeo,shadowMat);shadow.rotation.x=-Math.PI/2;shadow.position.y=0.06;g.add(shadow);
      g.scale.setScalar(1.55);
      const record={id:actor.id,group:g,head,eyes,torso,arms,legs,book,cup,actor,phase:seed(actor.id)*12,route:[],destination:'',activity:'',pose:'idle',currentZone:'dock',lifeIndex:Math.floor(seed(actor.id)*LIFE.length),nextLife:0,settled:false};
      g.position.set(-38,0.2,25);
      record.restorePosition = Date.now() - (actor.startedAt || Date.now()) > 5000;
      characters.set(actor.id,record);return record;
    }
    // All cross-bank movement goes through an actual bridge. Roads connect station entrances.
    const nodes=[
      [-38,25],[-32,13],[-18,12],[-6,12],[-5,-6],[-29,-6],[-29,-11],[-21,-23],
      [2,-12],[10,-12],[22,-12],[23,0],[21,16],[10,16],[2,16],[30,16],
      [41,16],[36,-19],[-11,-23]
    ];
    const edges=[[0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,7],[7,18],[4,8],[8,9],[9,10],[10,11],[11,12],[12,13],[13,14],[14,3],[12,15],[15,16],[10,17]];
    const graph = Object.fromEntries(nodes.map((_, i) => [i, {}]));
    for (const [a, b] of edges) {
      const distance = Math.hypot(nodes[a][0] - nodes[b][0], nodes[a][1] - nodes[b][1]);
      graph[a][b] = distance; graph[b][a] = distance;
    }
    function routeBetween(start,end){
      const nearest=p=>nodes.reduce((best,n,i)=>Math.hypot(n[0]-p.x,n[1]-p.z)<Math.hypot(nodes[best][0]-p.x,nodes[best][1]-p.z)?i:best,0);
      const path=window.YanWorldPath.find_path(graph,nearest(start),nearest(end))
        .map(index=>({x:nodes[index][0],z:nodes[index][1]}));
      path.push({x:end.x,z:end.z});return path;
    }
    function setDestination(c,key,end,activity,pose){
      if(c.destination===key)return;
      c.destination=key;c.activity=activity;c.pose=pose;
      if(c.restorePosition){c.group.position.set(end.x,0.22,end.z);c.restorePosition=false;c.route=[];c.settled=true;return;}
      c.route=routeBetween(c.group.position,end);c.settled=false;
    }
    function syncActors(actors,dt){
      const seen=new Set();
      actors.forEach((a,i)=>{
        seen.add(a.id);const c=characters.get(a.id)||makeCharacter(a);c.actor=a;c.group.visible=true;
        const isWorking=['working','work','walk','running'].includes(a.state);
        const current=stations.get(a.zone)||stations.get('workshop');
        const occupants=actors.slice(0,i).filter(other=>other.zone===a.zone&&['working','work','walk','running'].includes(other.state)).length;
        const slot=occupants%2===0?-1.6:1.6;
        if(isWorking){
          const pose=['library','tower'].includes(a.zone)?'read':a.zone==='hall'?'meet':a.zone==='studio'?'paint':'type';
        const end={x:current.x+(a.zone==='library'&&occupants===0?-0.6:slot),z:current.workZ+Math.floor(occupants/2)*3.0};
          setDestination(c,'work:'+a.zone+':'+slot,end,current.activity,pose);
          c.currentZone=a.zone;
        }else if(a.state==='error'){
          setDestination(c,'error',{x:current.x+slot,z:current.z},'等待处理问题','idle');
        }else{
          if(time>c.nextLife&&c.route.length===0){c.lifeIndex=(c.lifeIndex+1)%LIFE.length;c.nextLife=time+22+seed(a.id)*13;}
          const life=LIFE[c.lifeIndex];
          setDestination(c,'life:'+c.lifeIndex,{x:life.x+slot,z:life.z},life.activity,life.pose);
        }
        let walking=c.route.length>0;
        if(reducedMotion&&walking){const end=c.route.at(-1);c.group.position.set(end.x,0.2,end.z);c.route=[];walking=false;}
        if(walking&&dt>0){
          let remaining=dt*4.2;
          while(remaining>0&&c.route.length){
            const end=c.route[0],dx=end.x-c.group.position.x,dz=end.z-c.group.position.z,dist=Math.hypot(dx,dz);
            if(dist<0.04){c.route.shift();continue;}
            const step=Math.min(dist,remaining);
            c.group.position.x+=dx/dist*step;c.group.position.z+=dz/dist*step;
            c.group.rotation.y=Math.atan2(dx,dz);remaining-=step;
            if(step===dist)c.route.shift();
          }
        }
        const t=reducedMotion?0:time+c.phase,swing=walking?Math.sin(t*10)*0.6:0;
        c.legs[0].rotation.x=swing;c.legs[1].rotation.x=-swing;
        c.arms[0].rotation.x=-swing;c.arms[1].rotation.x=swing;
        c.book.visible=!walking&&c.pose==='read';c.cup.visible=!walking&&c.pose==='coffee';
        let elevation=0.22;
        const p=c.group.position;
        if(p.x>1.5&&p.x<18.5&&(Math.abs(p.z+12)<2||Math.abs(p.z-16)<2))elevation+=Math.sin((p.x-1.5)/17*Math.PI)*0.65;
        c.group.position.y=elevation+(walking?Math.abs(Math.sin(t*10))*0.06:0);
        if(!walking){
          if(!c.settled&&!isWorking)c.nextLife=time+22+seed(a.id)*13;
          c.settled=true;c.group.rotation.y=c.pose==='type'?Math.PI:c.pose==='read'?0.3:0;
          if(c.pose==='type'){c.arms[0].rotation.x=-1.05+Math.sin(t*11)*0.08;c.arms[1].rotation.x=-1.05+Math.cos(t*11)*0.08;}
          if(c.pose==='read'){c.arms.forEach(a=>a.rotation.x=-0.7);c.head.rotation.x=0.12;}
          else c.head.rotation.x=0;
          if(c.pose==='paint'){c.arms[1].rotation.x=-0.9+Math.sin(t*2)*0.32;}
          if(c.pose==='coffee'){c.arms[1].rotation.x=-0.95;c.cup.position.y=1.65+Math.sin(t*0.8)*0.1;}
          if(c.pose==='sit'){c.legs.forEach(l=>l.rotation.x=-1);c.group.position.y=elevation+0.18;}
          if(c.pose==='meet')c.head.rotation.y=Math.sin(t*0.5)*0.2;
          if(a.state==='celebrate'&&!reducedMotion){c.arms.forEach((arm,j)=>arm.rotation.z=(j?1:-1)*2.3);c.group.position.y+=Math.abs(Math.sin(t*5))*0.15;}
          else c.arms.forEach(arm=>arm.rotation.z=0);
        }
        const blink=!reducedMotion&&(t%4.7)<0.12;
        c.eyes.forEach(e=>e.scale.y=blink?0.18:1);
      });
      for(const [id,c] of characters){if(!seen.has(id)){c.group.visible=false;if(followId===id)followId='';}}
    }

    // Small environmental motion keeps an empty world alive without inventing agents or progress.
    for(let i=0;i<5;i++){
      const g=new T.Group();scene.add(g);
      const wings=[];
      for(const side of [-1,1]){const wing=box(g,0.6,0.04,0.18,C.cream,side*0.3,0,0);wing.castShadow=false;wings.push(wing);}
      birds.push({g,wings,phase:i*1.25});
    }
    function emit(zone,color){
      if(reducedMotion||effects.length>10)return;
      const st=stations.get(zone)||stations.get('workshop');
      const ring=new T.Mesh(geometry('ring',()=>new T.RingGeometry(1.1,1.24,40)),new T.MeshBasicMaterial({color,transparent:true,opacity:0.6,side:T.DoubleSide,depthWrite:false}));
      ring.rotation.x=-Math.PI/2;ring.position.set(st.x,0.25,st.z);scene.add(ring);effects.push({mesh:ring,age:0});
    }
    function setScene(name){
      const next=previews[name]?name:'overview';if(sceneName===next)return;
      sceneName=next;followId='';const [x,z,span]=previews[next];Object.assign(goal,{x,z,span,yaw:0.40,pitch:0.86});
    }
    function setDayPhase(phase){
      const next=phase==='night'?'night':'day';if(day===next)return;day=next;
      const night=day==='night';
      hemi.intensity=night?1.4:2.1;sun.intensity=night?0.85:2.8;sun.color.set(night?0xb4d5df:0xffe7be);
      scene.background.set(night?0x526f71:C.paper);scene.fog.color.copy(scene.background);
      material(C.cream).emissive.set(night?C.cream:0);material(C.cream).emissiveIntensity=night?0.9:0;
    }
    function moveCamera(dt){
      if(followId){const c=characters.get(followId);if(c?.group.visible){goal.x=c.group.position.x;goal.z=c.group.position.z;goal.span=32;}}
      const smooth=reducedMotion?1:1-Math.exp(-Math.max(dt,0.001)*6);
      for(const k of Object.keys(view))view[k]+=(goal[k]-view[k])*smooth;
      const aspect=width/height,span=view.span*Math.max(1,0.9/aspect);
      camera.left=-span*aspect/2;camera.right=span*aspect/2;camera.top=span/2;camera.bottom=-span/2;
      const x=view.x,z=view.z;
      camera.position.set(x+Math.sin(view.yaw)*100*Math.cos(view.pitch),100*Math.sin(view.pitch),z+Math.cos(view.yaw)*100*Math.cos(view.pitch));
      camera.lookAt(x,0,z);camera.updateProjectionMatrix();camera.updateMatrixWorld();
    }
    function resize(w,h,dpr){
      width=Math.max(1,w);height=Math.max(1,h);renderer.setPixelRatio(Math.min(dpr||1,1.75));renderer.setSize(width,height,false);moveCamera(1);
    }
    function focusAgent(id){if(!characters.has(id))return false;followId=id;return true;}
    function focusZone(zone){const st=stations.get(zone);if(!st)return;followId='';Object.assign(goal,{x:st.x,z:st.z,span:35});}
    function reset(){followId='';sceneName='overview';Object.assign(goal,{x:0,z:0,span:106,yaw:0.4,pitch:0.86});}
    function zoom(factor){followId='';goal.span=T.MathUtils.clamp(goal.span*factor,24,170);}
    function project(x,y,z){
      vector.set(x,y,z).project(camera);
      return {x:(vector.x*0.5+0.5)*width,y:(-vector.y*0.5+0.5)*height,visible:Math.abs(vector.x)<1&&Math.abs(vector.y)<1&&vector.z<1};
    }
    function pickAt(clientX,clientY){
      const rect=canvas.getBoundingClientRect(),px=clientX-rect.left,py=clientY-rect.top;
      let found=null,best=Infinity;
      for(const c of characters.values()){
        if(!c.group.visible)continue;
        const p=project(c.group.position.x,2.2,c.group.position.z),distance=Math.hypot(p.x-px,p.y-py);
        if(p.visible&&distance<22&&distance<best){found={kind:'agent',id:c.id};best=distance;}
      }
      if(found)return found;
      for(const p of pickables){
        const screen=project(p.x,p.y,p.z),distance=Math.hypot(screen.x-px,screen.y-py);
        if(screen.visible&&distance<p.radius*height/view.span&&distance<best){found=p.target;best=distance;}
      }
      return found;
    }
    let pointer=null;
    function pointerDown(e){
      if(e.button>2||e.button===1)return;
      followId='';pointer={id:e.pointerId,x:e.clientX,y:e.clientY,moved:0,orbit:e.button===2||e.shiftKey};
      canvas.setPointerCapture(e.pointerId);
    }
    function pointerMove(e){
      if(pointer&&e.pointerId===pointer.id){
        const dx=e.clientX-pointer.x,dy=e.clientY-pointer.y;pointer.moved+=Math.abs(dx)+Math.abs(dy);pointer.x=e.clientX;pointer.y=e.clientY;
        if(pointer.orbit){goal.yaw-=dx*0.006;goal.pitch=T.MathUtils.clamp(goal.pitch+dy*0.004,0.5,1.25);}
        else{
          const scale=view.span/height;
          goal.x=T.MathUtils.clamp(goal.x-dx*scale*Math.cos(view.yaw)-dy*scale*Math.sin(view.yaw),-80,80);
          goal.z=T.MathUtils.clamp(goal.z+dx*scale*Math.sin(view.yaw)-dy*scale*Math.cos(view.yaw),-65,65);
        }
        options.onHover?.(null,0,0);
      }else{
        const target=pickAt(e.clientX,e.clientY);canvas.style.cursor=target?'pointer':'grab';options.onHover?.(target,e.clientX,e.clientY);
      }
    }
    function pointerUp(e){
      if(!pointer||pointer.id!==e.pointerId)return;
      const clicked=pointer.moved<5&&!pointer.orbit;pointer=null;
      if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);
      if(clicked)options.onClick?.(pickAt(e.clientX,e.clientY));
    }
    function pointerCancel(){pointer=null;}
    function wheel(e){e.preventDefault();zoom(Math.exp(T.MathUtils.clamp(e.deltaY,-150,150)*0.0015));}
    function context(e){e.preventDefault();}
    function keydown(e){
      if(e.key==='Home'){e.preventDefault();reset();}
      if(e.key==='+'||e.key==='='){e.preventDefault();zoom(0.85);}
      if(e.key==='-'){e.preventDefault();zoom(1.15);}
      const delta={ArrowLeft:[-4,0],ArrowRight:[4,0],ArrowUp:[0,-4],ArrowDown:[0,4]}[e.key];
      if(delta){e.preventDefault();followId='';goal.x+=delta[0];goal.z+=delta[1];}
    }
    function onMotion(e){reducedMotion=e.matches;}
    function contextLost(event) { event.preventDefault(); options.onAvailability?.(false); }
    function contextRestored() { renderer.shadowMap.needsUpdate = true; options.onAvailability?.(true); }
    const listeners={pointerdown:pointerDown,pointermove:pointerMove,pointerup:pointerUp,pointercancel:pointerCancel,lostpointercapture:pointerCancel,wheel,contextmenu:context,dblclick:reset,keydown,webglcontextlost:contextLost,webglcontextrestored:contextRestored};
    for(const [type,handler] of Object.entries(listeners))canvas.addEventListener(type,handler,type==='wheel'?{passive:false}:undefined);
    motionQuery.addEventListener('change',onMotion);

    function render(actors,activeZones,delta){
      if(disposed)return;
      const dt=Math.min(0.05,delta||0);
      time+=dt;syncActors(actors,dt);
      for (const [zone, bulb] of indicators) {
        bulb.visible = activeZones.has(zone) || actors.some(a=>a.zone===zone&&['working','work','running'].includes(a.state));
      }
      attention.visible = storm;
      moveCamera(Math.min(0.05,delta||0.016));
      if(!reducedMotion){
        boat.position.y=-1.48+Math.sin(time*0.9)*0.065;
        boat.rotation.z=Math.sin(time*0.7)*0.025;
        ripples.forEach((r,i)=>{r.position.x+=dt*0.08;if(r.position.x>80)r.position.x=-80;r.scale.x=0.7+Math.sin(time*0.5+i)*0.25;});
        birds.forEach(({g,wings,phase})=>{
          const t=time*0.06+phase;g.position.set(Math.cos(t)*43,13+Math.sin(t*2)*2,Math.sin(t)*32);
          g.rotation.y=-t;wings[0].rotation.z=Math.sin(time*3+phase)*0.35;wings[1].rotation.z=-wings[0].rotation.z;
        });
      }
      for(let i=effects.length-1;i>=0;i--){
        const e=effects[i];e.age+=dt;e.mesh.scale.setScalar(1+e.age*2);e.mesh.material.opacity=Math.max(0,0.45-e.age*0.3);
        if(e.age>1.5){scene.remove(e.mesh);e.mesh.material.dispose();effects.splice(i,1);}
      }
      for(const {sprite,major} of labels){
        sprite.visible=major?view.span>75:view.span<95;
        const scale=major?1:Math.min(1,view.span/60);
        sprite.scale.set(12.8*scale,2.4*scale,1);
      }
      renderer.render(scene,camera);
      if (pixelRequests.length) {
        const gl = renderer.getContext(), w = canvas.width, h = canvas.height;
        const pixels = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        const colors = new Set(); let opaque = 0;
        for (let i = 0; i < pixels.length; i += 4 * 113) {
          colors.add((pixels[i] >> 4) + ':' + (pixels[i+1] >> 4) + ':' + (pixels[i+2] >> 4));
          if (pixels[i+3]) opaque++;
        }
        const report = {colors:colors.size, opaque, width:w, height:h, contextLost:gl.isContextLost()};
        pixelRequests.splice(0).forEach(resolve => resolve(report));
      }
    }
    function stats(){
      return {mode:'webgl',objects:scene.children.length,characters:[...characters.values()].filter(c=>c.group.visible).length,triangles:renderer.info.render.triangles,calls:renderer.info.render.calls,
        camera:{...view},followId,reducedMotion,continuousWorld:true,
        places:pickables.filter(p=>p.target.kind==='station').map(p=>({zone:p.target.zone,name:stationName(p.target.zone),...project(p.x,p.y,p.z)})),
        projected:[...characters.values()].filter(c=>c.group.visible).map(c=>({id:c.id,...project(c.group.position.x,2.3,c.group.position.z),inFront:true,activity:c.route.length?'正在前往目的地':c.activity,pose:c.route.length?'walk':c.pose,position:{x:c.group.position.x,z:c.group.position.z},route:c.route.length}))};
    }
    function dispose(){
      disposed=true;
      for(const [type,handler] of Object.entries(listeners))canvas.removeEventListener(type,handler);
      motionQuery.removeEventListener('change',onMotion);
      effects.forEach(e=>e.mesh.material.dispose());
      pixelRequests.splice(0).forEach(resolve=>resolve({contextLost:true,colors:0}));
      geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());
      scene.clear();renderer.dispose();
    }
    return {render,resize,dispose,stats,pickAt,setScene,setDayPhase,setHome,focusAgent,focusZone,reset,zoom,
      stopFollowing:()=>{followId='';},
      samplePixels:()=>new Promise(resolve=>pixelRequests.push(resolve)),
      setTodos:todos=>{
        taskMarks.forEach((mark,i)=>{
          const todo=todos?.[i];mark.visible=!!todo;
          if(todo)mark.material=material(todo.status==='completed'?C.leafDark:C.gold);
        });
      },setStorm:active=>{storm=!!active;},
      emitSparks:zone=>emit(zone,C.gold),emitBoat:()=>emit('dock',C.roof),
      emitBeam:()=>emit('lighthouse',C.gold),emitConfetti:()=>emit('hall',C.gold)};
  }
  window.YanWorkGuiScene={create,stationName};
})();
