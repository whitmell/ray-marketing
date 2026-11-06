import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { captionFormatErrors } from '../src/services/caption-format';

const title = 'Elizabeth II & Moonrise';
const valid = `"${title}"\n\nA quiet evening.\n\nhttps://example.com/photo_name\n\n#FineArtPhotography #OuterBanks`;

test('accepts a quoted title, plain URLs, and hashtags', () => {
  assert.deepEqual(captionFormatErrors(valid, title), []);
});

test('requires the exact title on the first line in straight quotes', () => {
  for (const firstLine of [title, `**${title}**`, `"${title}!"`, `“${title}”`]) {
    assert.ok(captionFormatErrors(`${firstLine}\n\nA quiet evening.`, title).length > 0);
  }
});

test('rejects common Markdown without confusing hashtags for headings', () => {
  for (const markdown of [
    '**bold**', '*italic*', '__bold__', '_italic_', '[link](https://example.com)',
    '`code`', '```text\ncode\n```', '# Heading', '- item', '1. item', '> quote', '---',
  ]) {
    assert.ok(captionFormatErrors(`${valid}\n\n${markdown}`, title).includes('Use plain text without Markdown formatting.'), markdown);
  }
});

test('accepts ordinary punctuation and underscores within words and URLs', () => {
  assert.deepEqual(captionFormatErrors(`${valid}\n\nA * on its own and file_name.`, title), []);
});
