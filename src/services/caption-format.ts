const MARKDOWN_PATTERNS = [
  /\*\*[^*\n]+\*\*|__[^_\n]+__/,
  /(?<!\w)\*[^*\n]+\*(?!\w)|(?<!\w)_[^_\n]+_(?!\w)/,
  /`[^`\n]+`|```/,
  /!?\[[^\]\n]+\]\([^)]+\)/,
  /^\s{0,3}(?:#{1,6}\s+|>\s+|[-*+]\s+|\d+[.)]\s+)/m,
  /^\s{0,3}(?:[-*_]\s*){3,}$/m,
];

export function captionFormatErrors(caption: string, title: string): string[] {
  const errors: string[] = [];
  if (caption.split(/\r?\n/, 1)[0].trim() !== `"${title}"`) {
    errors.push('The first line must be the exact photo title enclosed in double quotes.');
  }
  if (MARKDOWN_PATTERNS.some(pattern => pattern.test(caption))) {
    errors.push('Use plain text without Markdown formatting.');
  }
  return errors;
}
