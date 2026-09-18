// Skill catalog data comes from the main process. Keep only the ordered UI
// categories here so the renderer cannot drift into a second catalog.
const SKILL_TAG_LABELS = Object.freeze({
  'code-assist': '代码辅助',
  'ui-beautify': 'UI美化',
  'web-design': '网页设计',
  'agent-rules': 'Agent规则',
  'office-assist': '办公辅助'
});

const SKILL_GROUP_DESCRIPTIONS = Object.freeze({
  'code-assist': '编写、理解、审阅与维护代码库',
  'ui-beautify': '动效、交互和界面质量提升',
  'web-design': '网页结构、视觉语言与组件实现',
  'agent-rules': '搜索、提示词与 Agent 工作规范',
  'office-assist': '文档、演示、图表与媒体制作'
});

const SKILL_MARKET = [];
