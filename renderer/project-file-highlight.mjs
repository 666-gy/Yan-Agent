import { createHighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import javascript from 'shiki/langs/javascript.mjs';
import typescript from 'shiki/langs/typescript.mjs';
import tsx from 'shiki/langs/tsx.mjs';
import jsx from 'shiki/langs/jsx.mjs';
import json from 'shiki/langs/json.mjs';
import python from 'shiki/langs/python.mjs';
import css from 'shiki/langs/css.mjs';
import html from 'shiki/langs/html.mjs';
import shell from 'shiki/langs/shellscript.mjs';
import yaml from 'shiki/langs/yaml.mjs';
import dark from 'shiki/themes/dark-plus.mjs';
import light from 'shiki/themes/light-plus.mjs';

let highlighter;
const languages = { js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx', ts: 'typescript', tsx: 'tsx', json: 'json', py: 'python', css: 'css', html: 'html', htm: 'html', sh: 'shellscript', yml: 'yaml', yaml: 'yaml' };
globalThis.YanFileHighlight = async (content, path) => {
  const lang = languages[path.split('.').pop().toLowerCase()];
  if (!lang || content.length > 200000) return null;
  highlighter ||= createHighlighterCore({ themes: [dark, light], langs: [javascript, typescript, jsx, tsx, json, python, css, html, shell, yaml], engine: createJavaScriptRegexEngine() });
  return (await highlighter).codeToTokens(content, { lang, themes: { dark: 'dark-plus', light: 'light-plus' } }).tokens;
};
