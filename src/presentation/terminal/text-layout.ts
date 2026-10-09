const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function centeredStatusLines(
  message: string,
  renderedWidth: number
): { key: number; text: string }[] {
  const width = Math.max(1, renderedWidth);
  const lines: { key: number; text: string }[] = [];
  for (const part of message.split('\n')) {
    let line = '';
    let column = 0;
    for (const { segment } of graphemes.segment(part)) {
      const glyphWidth = Bun.stringWidth(segment === '\t' ? '  ' : segment);
      if (column > 0 && column + glyphWidth > width) {
        lines.push({ key: lines.length, text: line });
        line = '';
        column = 0;
      }
      line += segment;
      column += glyphWidth;
    }
    lines.push({ key: lines.length, text: line });
  }
  return lines;
}

export function charWrappedRows(
  message: string,
  renderedWidth: number
): number {
  const width = Math.max(renderedWidth, 1);
  return message.split('\n').reduce((total, line) => {
    let rows = 1;
    let column = 0;
    for (const { segment } of graphemes.segment(line)) {
      const glyphWidth = Bun.stringWidth(segment === '\t' ? '  ' : segment);
      if (column > 0 && column + glyphWidth > width) {
        rows += 1;
        column = 0;
      }
      column += glyphWidth;
    }
    return total + rows;
  }, 0);
}

export function renderedRows(message: string, renderedWidth: number): number {
  const width = Math.max(renderedWidth, 1);
  return message.split('\n').reduce((total, line) => {
    const opentuiWidth = Bun.stringWidth(line.replaceAll('\t', '  '));
    return total + Math.max(Math.ceil(opentuiWidth / width), 1);
  }, 0);
}

export function requiresFailureOverlay(
  message: string,
  renderedWidth: number,
  availableRows: number
): boolean {
  return renderedRows(message, renderedWidth) > Math.max(availableRows, 0);
}
