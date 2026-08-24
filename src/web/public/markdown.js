export function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text ?? '';
  return div.innerHTML;
}

function isBlockStart(line) {
  const trimmed = line.trim();
  return (
    /^#{1,6}\s/.test(line) ||
    trimmed.startsWith('|') ||
    /^(\*{3,}|-{3,}|_{3,})\s*$/.test(trimmed) ||
    line.startsWith('>') ||
    /^(\s*)[-*+]\s+/.test(line) ||
    /^\d+\.\s+/.test(line)
  );
}

function sanitizeUrl(url) {
  const trimmed = (url || '').trim();
  if (/^https?:\/\//i.test(trimmed)) return escapeHtml(trimmed);
  return '#';
}

function renderInline(text) {
  let s = escapeHtml(text);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__(.+?)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*([^*]|$)/g, '$1<em>$2</em>$3');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) =>
    `<a href="${sanitizeUrl(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`
  );
  s = s.replace(/@([a-zA-Z0-9_-]+)/g, '<span class="mention">@$1</span>');
  return s;
}

function renderTable(lines) {
  const parseRow = (line) =>
    line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((cell) => cell.trim());

  if (lines.length < 1) return '';

  const headers = parseRow(lines[0]);
  const dividerIdx = lines.length > 1 && /^\|[\s\-:|]+\|$/.test(lines[1].trim()) ? 1 : 0;
  const bodyStart = dividerIdx ? 2 : 1;

  let html = '<table><thead><tr>';
  headers.forEach((h) => {
    html += `<th>${renderInline(h)}</th>`;
  });
  html += '</tr></thead><tbody>';

  for (let i = bodyStart; i < lines.length; i++) {
    const cells = parseRow(lines[i]);
    html += '<tr>';
    cells.forEach((cell) => {
      html += `<td>${renderInline(cell)}</td>`;
    });
    html += '</tr>';
  }

  return `${html}</tbody></table>`;
}

export function markdownToHtml(content) {
  if (!content) return '';

  const codeBlocks = [];
  let src = String(content).replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const idx = codeBlocks.length;
    const langClass = lang ? ` class="language-${escapeHtml(lang)}"` : '';
    codeBlocks.push(`<pre><code${langClass}>${escapeHtml(code.replace(/\n$/, ''))}</code></pre>`);
    return `\x00CODEBLOCK${idx}\x00`;
  });

  const lines = src.split('\n');
  const htmlParts = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim().startsWith('|') && line.includes('|')) {
      const tableLines = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i]);
        i += 1;
      }
      htmlParts.push(renderTable(tableLines));
      continue;
    }

    if (/^(\*{3,}|-{3,}|_{3,})\s*$/.test(line.trim())) {
      htmlParts.push('<hr>');
      i += 1;
      continue;
    }

    const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headerMatch) {
      const level = headerMatch[1].length;
      htmlParts.push(`<h${level}>${renderInline(headerMatch[2])}</h${level}>`);
      i += 1;
      continue;
    }

    if (line.startsWith('>')) {
      const quoteLines = [];
      while (i < lines.length && lines[i].startsWith('>')) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''));
        i += 1;
      }
      htmlParts.push(`<blockquote>${quoteLines.map((l) => renderInline(l)).join('<br>')}</blockquote>`);
      continue;
    }

    if (/^(\s*)[-*+]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^(\s*)[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^(\s*)[-*+]\s+/, ''));
        i += 1;
      }
      htmlParts.push(`<ul>${items.map((it) => `<li>${renderInline(it)}</li>`).join('')}</ul>`);
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ''));
        i += 1;
      }
      htmlParts.push(`<ol>${items.map((it) => `<li>${renderInline(it)}</li>`).join('')}</ol>`);
      continue;
    }

    if (!line.trim()) {
      i += 1;
      continue;
    }

    const paraLines = [];
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) {
      paraLines.push(lines[i]);
      i += 1;
    }
    if (paraLines.length) {
      htmlParts.push(`<p>${paraLines.map((l) => renderInline(l)).join('<br>')}</p>`);
    }
  }

  let html = htmlParts.join('\n');
  codeBlocks.forEach((block, idx) => {
    html = html.replace(`\x00CODEBLOCK${idx}\x00`, block);
  });

  return html;
}

export function renderMarkdown(element, content) {
  if (!element) return;
  element.classList.add('markdown-body');
  element.innerHTML = markdownToHtml(content);
}

export function renderMarkdownPreview(element, content) {
  if (!element) return;
  element.classList.add('markdown-body', 'markdown-preview');
  element.innerHTML = markdownToHtml(content);
}
