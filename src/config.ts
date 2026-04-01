import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export const config = {
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  claudeModel: process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
  port: parseInt(process.env.PORT || '3000', 10),
  pipelineCron: process.env.PIPELINE_CRON || '0 9 * * 1',
  timezone: process.env.TIMEZONE || 'America/New_York',
  resourcesPath: path.resolve(process.env.RESOURCES_PATH || './resources'),
  dataPath: path.resolve(process.env.DATA_PATH || './data'),
  themeLookback: parseInt(process.env.THEME_LOOKBACK || '2', 10),

  // Scoring LLMs
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
  ollamaModel: process.env.OLLAMA_MODEL || 'llama3.2',

  // S3
  awsRegion: process.env.AWS_REGION || 'us-east-1',
  s3Bucket: process.env.S3_BUCKET || '',
  photosPath: path.resolve(process.env.PHOTOS_PATH || './photos'),

  // Meta Graph API
  metaPageAccessToken: process.env.META_PAGE_ACCESS_TOKEN || '',
  facebookPageId: process.env.FACEBOOK_PAGE_ID || '',
  instagramUserId: process.env.INSTAGRAM_USER_ID || '',
  metaApiVersion: process.env.META_API_VERSION || 'v21.0',
};
