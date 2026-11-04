import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import { getResourceText } from '../data/s3-resources';

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
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await client.messages.create({
      model: config.claudeModel,
      max_tokens: 1024,
      system: promptTemplate,
      messages: [{
        role: 'user',
        content: attempt === 0
          ? userMessage
          : `${userMessage}\n\nRevision required: Keep the one-sentence legacy acknowledgment of Ray's photography, but rephrase it with a different sentence structure. Do not reuse the formula "Ray had a gift for..." or "Ray had a way of...".`,
      }],
    });

    const textBlock = response.content.find(block => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No text content in Claude API response');
    }
    if (!REPETITIVE_RAY_PHRASE.test(textBlock.text)) return textBlock.text;
  }
  throw new Error('Caption generation repeated a prohibited Ray-gift phrase after retry');
}
