// Whitespace inside inline code or a tag may wrap lines but never crosses a
// blank line, matching CommonMark inline code and raw HTML.
const tick = '`';
const space = String.raw`(?:[ \t]|\n(?![ \t]*(?:\n|$)))`;
const quoted = (quote: string) =>
  String.raw`${quote}(?:[^${quote}\n]|\n(?![ \t]*(?:\n|$)))*${quote}`;
const attribute = String.raw`${space}+[A-Za-z_:][\w.:-]*(?:${space}*=${space}*(?:[^\s"'=<>${tick}]+|${quoted("'")}|${quoted('"')}))?`;
const inlineCode = String.raw`(?<!${tick})(${tick}+)(?!${tick})(?:[^\n]|\n(?![ \t]*(?:\n|$)))*?(?<!${tick})\1(?!${tick})`;
const comment = String.raw`<!--[\s\S]*?-->`;
const openingTag = String.raw`<[A-Za-z][A-Za-z0-9-]*(?:${attribute})*${space}*\/?>`;
const closingTag = String.raw`<\/[A-Za-z][A-Za-z0-9-]*${space}*>`;
const reference = String.raw`&(?:#\d{1,7}|#[xX][\da-fA-F]{1,6}|[A-Za-z]+);`;

// Matching inline code, comments, tags, and character references in one pass
// keeps inline code untouched and never rescans decoded text.
const htmlPattern = new RegExp(
  [inlineCode, comment, openingTag, closingTag, reference].join('|'),
  'g'
);

const fencePattern = /^[ \t]*(`{3,}|~{3,})/;
const delimiterRowPattern =
  /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const tagNamePattern = /^<([A-Za-z][A-Za-z0-9-]*)/;
const attributePattern =
  /([A-Za-z_:][\w.:-]*)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g;
const markdownPunctuationPattern = /[!-/:-@[-`{-~]/;

const namedCharacters = new Map([
  ['nbsp', ' '],
  ['ensp', ' '],
  ['emsp', ' '],
  ['thinsp', ' '],
  ['ndash', '–'],
  ['mdash', '—'],
  ['hellip', '…'],
  ['middot', '·'],
  ['bull', '•'],
  ['rarr', '→'],
  ['larr', '←'],
  ['copy', '©'],
  ['reg', '®'],
  ['trade', '™'],
]);

/**
 * Removes HTML comments and tags from a GitHub-authored body while keeping
 * their text content. Images in table rows keep their alt text, since tables
 * such as scan summaries label values with images. Fenced and inline code stay
 * unchanged.
 */
export function stripHtml(body: string): string {
  const output: string[] = [];
  let prose: string[] = [];
  let fence: string | undefined;
  const flushProse = () => {
    if (prose.length > 0) output.push(stripProse(prose));
    prose = [];
  };
  for (const line of body.split('\n')) {
    const marker = fencePattern.exec(line)?.[1];
    if (fence === undefined) {
      if (marker === undefined) {
        prose.push(line);
        continue;
      }
      flushProse();
      fence = marker;
    } else if (
      marker?.[0] === fence[0] &&
      marker.length >= fence.length &&
      line.trim() === marker
    ) {
      fence = undefined;
    }
    output.push(line);
  }
  flushProse();
  return output.join('\n');
}

// One pass over all prose lets comments, inline code, and multi-line tags span
// table boundaries. Only image handling depends on the line a match starts on.
function stripProse(lines: readonly string[]): string {
  const tableRows = findTableRows(lines);
  const lineStarts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineStarts.push(offset);
    offset += line.length + 1;
  }
  const isTableRow = (position: number) =>
    tableRows[lineStarts.findLastIndex((start) => start <= position)] ?? false;
  return lines
    .join('\n')
    .replace(htmlPattern, (match, _tick: unknown, position: number) =>
      match.startsWith('`')
        ? match
        : match.startsWith('&')
          ? decodeCharacter(match)
          : isTableRow(position)
            ? imageAlt(match)
            : ''
    )
    .replace(/^[ \t]+$/gm, '');
}

// A table is a header row containing a pipe, a delimiter row, and the rows
// that follow until a blank line.
function findTableRows(lines: readonly string[]): readonly boolean[] {
  const rows = lines.map(() => false);
  for (let index = 1; index < lines.length; index++) {
    const header = lines[index - 1] ?? '';
    const delimiter = lines[index] ?? '';
    if (
      rows[index - 1] === true ||
      !header.includes('|') ||
      !delimiter.includes('|') ||
      !delimiterRowPattern.test(delimiter)
    )
      continue;
    rows[index - 1] = true;
    for (let row = index; row < lines.length; row++) {
      if ((lines[row] ?? '').trim() === '') break;
      rows[row] = true;
    }
  }
  return rows;
}

// Alt text is escaped so that a pipe or emphasis marker stays literal inside
// the table cell.
function imageAlt(tag: string): string {
  const name = tagNamePattern.exec(tag)?.[1];
  if (name?.toLowerCase() !== 'img') return '';
  for (const attribute of tag
    .slice(name.length + 1)
    .matchAll(attributePattern)) {
    if (attribute[1].toLowerCase() !== 'alt') continue;
    const value = (attribute.at(2) ?? '').replace(/^(["'])([\s\S]*)\1$/, '$2');
    return [...value]
      .map((character) =>
        markdownPunctuationPattern.test(character)
          ? `\\${character}`
          : character
      )
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return '';
}

// ASCII punctuation stays encoded: decoding `&#124;` or `&#42;` before Markdown
// parsing would turn literal text into table cells, emphasis, or quotes.
function decodeCharacter(reference: string): string {
  const name = reference.slice(1, -1);
  if (!name.startsWith('#')) return namedCharacters.get(name) ?? reference;
  const codePoint =
    name[1] === 'x' || name[1] === 'X'
      ? Number.parseInt(name.slice(2), 16)
      : Number.parseInt(name.slice(1), 10);
  if (codePoint <= 0 || codePoint > 0x10ffff) return reference;
  const character = String.fromCodePoint(codePoint);
  return markdownPunctuationPattern.test(character) ? reference : character;
}
