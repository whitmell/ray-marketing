import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import { getResourceText } from '../data/s3-resources';
import { captionFormatErrors } from './caption-format';

let client: Anthropic | null = null;
const REPETITIVE_RAY_PHRASE =
  /\bRay\s+(?:had|has)\s+a\s+(?:gift\s+for|way\s+of)\b/i;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: config.anthropicApiKey });
  }
  return client;
}

export async function generateCaption(
  title: string,
  description: string,
  faaUrl: string
): Promise<string> {
  const userMessage = [
    `Photo Title:\n${title}`,
    `Image Description:\n${description}`,
    `FineArtAmerica Link:\n${faaUrl}`,
  ].join('\n\n');

  const promptTemplate = await getResourceText('caption-prompt.md');
  const client = getClient();
  let issues: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await client.messages.create({
      model: config.claudeModel,
      max_tokens: 1024,
      system: promptTemplate,
      messages: [{
        role: 'user',
        content: attempt === 0
          ? userMessage
          : `${userMessage}\n\nRevision required:\n${issues.join('\n')}`,
      }],
    });

    const textBlock = response.content.find(block => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No text content in Claude API response');
    }
    issues = captionFormatErrors(textBlock.text, title);
    if (REPETITIVE_RAY_PHRASE.test(textBlock.text)) {
      issues.push('Keep the one-sentence legacy acknowledgment, but do not use "Ray had a gift for..." or "Ray had a way of...".');
    }
    if (issues.length === 0) return textBlock.text;
  }
  throw new Error(`Caption generation failed validation after retry: ${issues.join(' ')}`);
}
