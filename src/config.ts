export const config = {
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  claudeModel: process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
  themeLookback: parseInt(process.env.THEME_LOOKBACK || '2', 10),

  // Scoring LLMs
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-5.4',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3.5-flash',

  // AWS
  awsRegion: process.env.AWS_REGION || 'us-east-1',
  s3Bucket: process.env.S3_BUCKET || '',
  photosBucket: process.env.PHOTOS_BUCKET || 'ray-faa-images',
  resourcesBucket: process.env.RESOURCES_BUCKET || '',
  dynamoTablePosts: process.env.DYNAMODB_TABLE_POSTS || 'ray-marketing-posts',
  dynamoTableConfig: process.env.DYNAMODB_TABLE_CONFIG || 'ray-marketing-config',
  domainName: process.env.DOMAIN_NAME || '',

  // Meta Graph API
  metaPageAccessToken: process.env.META_PAGE_ACCESS_TOKEN || '',
  facebookPageId: process.env.FACEBOOK_PAGE_ID || '',
  instagramUserId: process.env.INSTAGRAM_USER_ID || '',
  metaApiVersion: process.env.META_API_VERSION || 'v21.0',
};
