import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import { getResourceText } from '../data/s3-resources';

let client: Anthropic | null = null;
let promptTemplate: string | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: config.anthropicApiKey });
  }
  return client;
}

async function getPromptTemplate(): Promise<string> {
  if (!promptTemplate) {
    promptTemplate = await getResourceText('caption-prompt.md');
  }
  return promptTemplate;
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

  const response = await getClient().messages.create({
    model: config.claudeModel,
    max_tokens: 1024,
    system: await getPromptTemplate(),
    messages: [{ role: 'user', content: userMessage }],
  });

  const textBlock = response.content.find(block => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text content in Claude API response');
  }
  return textBlock.text;
}
