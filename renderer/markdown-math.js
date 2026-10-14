/* Extract formulas before Markdown formatting; restore trusted KaTeX HTML last. */
(() => {
  const pattern = /\\\[([\s\S]*?)\\\]|\$\$([\s\S]*?)\$\$|\\\(([\s\S]*?)\\\)|\$(?![\s$])((?:\\.|[^\\$\n])+?)(?<!\s)\$(?!\d)/g;
  const escape = value => String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
  window.YanMarkdownMath = {
    prepare(text) {
      const formulas = [];
      const prepared = String(text).replace(pattern, (raw, bracket, dollars, paren, inline, offset, source) => {
        // An escaped opening delimiter is literal text.
        let backslashes = 0;
        for (let i = offset - 1; i >= 0 && source[i] === '\\'; i--) backslashes++;
        if (backslashes % 2) return raw;
        const displayMode = bracket !== undefined || dollars !== undefined;
        const latex = bracket ?? dollars ?? paren ?? inline;
        let html;
        try {
          if (!window.katex) return raw;
          html = window.katex.renderToString(latex, {
            displayMode, throwOnError: true, trust: false, strict: 'ignore',
            maxExpand: 1000, maxSize: 20
          });
        } catch {
          html = `<span class="yan-math-error" title="公式语法无法解析">${escape(raw)}</span>`;
        }
        formulas.push(`<span class="yan-math${displayMode ? ' yan-math-display' : ''}">${html}</span>`);
        return `\u0000MATH${formulas.length - 1}\u0000`;
      });
      return {
        text: prepared,
        restore: html => html.replace(/\u0000MATH(\d+)\u0000/g, (_, index) => formulas[Number(index)] || '')
      };
    }
  };
})();
