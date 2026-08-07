// Skill catalog data comes from the main process. Keep only the ordered UI
// categories here so the renderer cannot drift into a second catalog.
const SKILL_TAG_LABELS = Object.freeze({
  'code-assist': '代码辅助',
  'ui-beautify': 'UI美化',
  'web-design': '网页设计',
  'agent-rules': 'Agent规则',
  'office-assist': '办公辅助'
});

const SKILL_MARKET = [];
