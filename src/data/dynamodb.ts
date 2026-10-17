import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { config } from '../config';
import type { Post, AppConfig } from './types';

const STATUS_INDEX = 'status-createdAt-index';
const APP_CONFIG_KEY = 'app';
const DEFAULT_APP_CONFIG: AppConfig = { themeLookback: 2 };

let docClient: DynamoDBDocumentClient | null = null;

function getClient(): DynamoDBDocumentClient {
  if (!docClient) {
    docClient = DynamoDBDocumentClient.from(
      new DynamoDBClient({ region: config.awsRegion }),
      { marshallOptions: { removeUndefinedValues: true } },
    );
  }
  return docClient;
}

export async function readPosts(status?: Post['status']): Promise<Post[]> {
  const client = getClient();
  const items: Post[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const result = status
      ? await client.send(
          new QueryCommand({
            TableName: config.dynamoTablePosts,
            IndexName: STATUS_INDEX,
            KeyConditionExpression: '#s = :status',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: { ':status': status },
            ScanIndexForward: false,
            ExclusiveStartKey: lastKey,
          }),
        )
      : await client.send(
          new ScanCommand({
            TableName: config.dynamoTablePosts,
            ExclusiveStartKey: lastKey,
          }),
        );
    items.push(...((result.Items ?? []) as Post[]));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  return items;
}

export async function readPost(id: string): Promise<Post | null> {
  const result = await getClient().send(
    new GetCommand({ TableName: config.dynamoTablePosts, Key: { id } }),
  );
  return (result.Item as Post | undefined) ?? null;
}

export async function getCurrentDraft(): Promise<Post | null> {
  const result = await getClient().send(
    new QueryCommand({
      TableName: config.dynamoTablePosts,
      IndexName: STATUS_INDEX,
      KeyConditionExpression: '#s = :status',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':status': 'draft' },
      ScanIndexForward: false,
      Limit: 1,
    }),
  );
  return (result.Items?.[0] as Post | undefined) ?? null;
}

export async function writePost(post: Post): Promise<void> {
  await getClient().send(
    new PutCommand({ TableName: config.dynamoTablePosts, Item: post }),
  );
}

export async function updatePost(id: string, updates: Partial<Post>): Promise<void> {
  const entries = Object.entries(updates).filter(
    ([key, value]) => key !== 'id' && value !== undefined,
  );
  if (entries.length === 0) return;

  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const sets: string[] = [];

  entries.forEach(([key, value], i) => {
    names[`#k${i}`] = key;
    values[`:v${i}`] = value;
    sets.push(`#k${i} = :v${i}`);
  });

  await getClient().send(
    new UpdateCommand({
      TableName: config.dynamoTablePosts,
      Key: { id },
      UpdateExpression: `SET ${sets.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }),
  );
}

export async function readAppConfig(): Promise<AppConfig> {
  const result = await getClient().send(
    new GetCommand({
      TableName: config.dynamoTableConfig,
      Key: { key: APP_CONFIG_KEY },
    }),
  );
  const value = result.Item?.value as AppConfig | undefined;
  return value ?? { ...DEFAULT_APP_CONFIG };
}

export async function writeAppConfig(appConfig: AppConfig): Promise<void> {
  await getClient().send(
    new PutCommand({
      TableName: config.dynamoTableConfig,
      Item: { key: APP_CONFIG_KEY, value: appConfig },
    }),
  );
}
