import { describe, expect, test } from 'bun:test';
import { stripHtml } from '../src/presentation/details/strip-html.ts';

describe('stripHtml', () => {
  test('keeps text content but drops tags, links, images, and comments', () => {
    expect(
      stripHtml(
        [
          'Intro <img alt="Logo" src="https://x/logo.svg"> text',
          '',
          '| Scanner | Findings |',
          '|:--|--:|',
          '| <a><picture><source media="(prefers-color-scheme: dark)" srcset="https://x/dark.svg"><img align="top" alt="Vulnerability Finding" title="Vulnerability Finding" src="https://x/light.svg"></picture></a>&ensp;Vulnerabilities | 2 <a><img alt="Medium" src="https://x/medium.svg"></a>&emsp;1 <img alt=Low src="https://x/low.svg" /> |',
          '',
          '<img alt="After table" src="https://x/after.svg">',
          '<a href="https://app.wiz.io/findings" target="_blank">View scan details in Wiz</a>',
          '<!-- WizScan-0e16b247-ScanResult -->',
        ].join('\n')
      )
    ).toBe(
      [
        'Intro  text',
        '',
        '| Scanner | Findings |',
        '|:--|--:|',
        '| Vulnerability Finding Vulnerabilities | 2 Medium 1 Low |',
        '',
        '',
        'View scan details in Wiz',
        '',
      ].join('\n')
    );
  });

  test('removes a comment that wraps a table', () => {
    expect(
      stripHtml(
        'Intro\n\n<!--\n| Before | After |\n|--|--|\n| <img alt="old"> | x |\n-->\n\nRest'
      )
    ).toBe('Intro\n\n\n\nRest');
  });

  test('escapes Markdown punctuation in table image alt text', () => {
    expect(stripHtml("a | b\n--|--\n<img alt='x | *y*'> | z")).toBe(
      'a | b\n--|--\nx \\| \\*y\\* | z'
    );
  });

  test('removes multi-line tags and comments and blanks lines left empty', () => {
    expect(
      stripHtml(
        '<details>\n  <summary>Review notes</summary>\n\nBody <img\n  src="x.png"\n  alt="shot"> text\n<!--\nhidden\n-->\n</details>'
      )
    ).toBe('\n  Review notes\n\nBody  text\n\n');
  });

  test('decodes spacing and symbol references but keeps Markdown punctuation encoded', () => {
    expect(stripHtml('a&nbsp;&ensp;&#169;&#x2713;&#65; &unknown;')).toBe(
      'a  ©✓A &unknown;'
    );
    const literal =
      '| a | b |\n|--|--|\n| x &#124; y | z |\n\nEscaped &#42;not italic&#42; &amp; &lt;div&gt;\n\n&gt; not a quote';
    expect(stripHtml(literal)).toBe(literal);
  });

  test('leaves fenced and inline code unchanged', () => {
    const body = [
      'Use `<Widget size="lg" />` or ``a ` <b> ``.',
      '',
      '```tsx',
      '<div>&amp;</div>',
      '<!-- keep -->',
      '```',
      '',
      '~~~~',
      '```',
      '<span>still code</span>',
      '~~~~',
      '<b>after</b>',
    ].join('\n');
    expect(stripHtml(body)).toBe(body.replace('<b>after</b>', 'after'));
  });

  test('keeps prose that only resembles a tag', () => {
    for (const body of [
      'Supports a <b and c\n\n> quoted reply\n\nnext para',
      'Version <v20 maps a -> b',
      'Split <img\n\nsrc="x">',
    ]) {
      expect(stripHtml(body)).toBe(body);
    }
  });

  test('keeps autolinks and comparisons that are not tags', () => {
    const body =
      'See <https://example.com> or <me@example.com>; a < b and c > d.';
    expect(stripHtml(body)).toBe(body);
  });
});
