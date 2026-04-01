import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config';
import type {
  PhotoCandidate,
  ScoringCandidate,
  CompositionScore,
  ColorTonalScore,
  ArtisticImpactScore,
  CuratorRanking,
  CriticScores,
} from '../data/types';

// --- Lazy clients ---

let anthropicClient: Anthropic | null = null;
let openaiClient: OpenAI | null = null;
let geminiClient: GoogleGenerativeAI | null = null;

function getAnthropic(): Anthropic {
  if (!anthropicClient) anthropicClient = new Anthropic({ apiKey: config.anthropicApiKey });
  return anthropicClient;
}

function getOpenAI(): OpenAI {
  if (!openaiClient) openaiClient = new OpenAI({ apiKey: config.openaiApiKey });
  return openaiClient;
}

function getGemini(): GoogleGenerativeAI {
  if (!geminiClient) geminiClient = new GoogleGenerativeAI(config.geminiApiKey);
  return geminiClient;
}

// --- Image loading ---

const MAX_IMAGE_DIMENSION = 1024;
const IMAGE_QUALITY = 80;

async function loadImageBase64(filename: string): Promise<{ base64: string; mimeType: string }> {
  const filePath = path.join(config.photosPath, filename);
  const resized = await sharp(filePath)
    .resize(MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: IMAGE_QUALITY })
    .toBuffer();
  return { base64: resized.toString('base64'), mimeType: 'image/jpeg' };
}

function parseJSON<T>(text: string): T {
  const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  return JSON.parse(cleaned) as T;
}

// ============================================================
// Agent 1 — Composition Critic (Gemini)
// ============================================================

const COMPOSITION_PROMPT = `You are a fine art photography composition critic.
Your job is to evaluate the visual structure of a nature photograph intended for large framed wall prints or gallery display.
Focus ONLY on composition.
Evaluate:
* balance and distribution of visual weight
* leading lines and visual flow through the frame
* foreground / midground / background depth
* use of negative space
* subject placement and framing
* whether the composition feels intentional and harmonious
Prefer compositions that:
* feel calm, balanced, and refined
* guide the viewer's eye naturally
* remain interesting during prolonged viewing
Avoid rewarding:
* cluttered frames
* awkward cropping
* distracting elements that break visual flow
Score:
composition: 1–10
Respond ONLY with JSON:
{ "composition": <1-10>, "analysis": "<one concise sentence>" }`;

async function evaluateComposition(photo: PhotoCandidate): Promise<CompositionScore> {
  const image = await loadImageBase64(photo.filename);
  const model = getGemini().getGenerativeModel({ model: config.geminiModel });

  const result = await model.generateContent({
    contents: [{
      role: 'user',
      parts: [
        { text: COMPOSITION_PROMPT + `\n\nPhoto: "${photo.title}"` },
        { inlineData: { mimeType: image.mimeType, data: image.base64 } },
      ],
    }],
  });

  const raw = parseJSON<{ composition: number; analysis: string }>(result.response.text());
  return { ...raw, provider: 'gemini', model: config.geminiModel };
}

// ============================================================
// Agent 2 — Color & Tonal Critic (Ollama)
// ============================================================

const COLOR_TONAL_PROMPT = `You are a fine art photography critic specializing in color theory and tonal quality for large-format prints.
Focus ONLY on color and tonal qualities.
Evaluate:
* harmony of the color palette
* tonal range from shadows to highlights
* subtle gradation and atmospheric depth
* natural and believable colors
* emotional mood created by color
Prefer images with:
* refined, cohesive palettes
* subtle tonal transitions
* natural-looking colors suitable for gallery prints
Avoid favoring images with:
* oversaturation
* aggressive HDR processing
* excessive sharpening or contrast
Score:
color: 1–10 tonalQuality: 1–10
Respond ONLY with JSON:
{ "color": <1-10>, "tonalQuality": <1-10>, "analysis": "<one concise sentence>" }`;

async function evaluateColorTonal(photo: PhotoCandidate): Promise<ColorTonalScore> {
  const image = await loadImageBase64(photo.filename);

  const response = await getAnthropic().messages.create({
    model: config.claudeModel,
    max_tokens: 512,
    system: COLOR_TONAL_PROMPT,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: image.mimeType as 'image/jpeg', data: image.base64 } },
        { type: 'text', text: `Photo: "${photo.title}"` },
      ],
    }],
  });

  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') throw new Error('No text in Anthropic color/tonal response');
  const raw = parseJSON<{ color: number; tonalQuality: number; analysis: string }>(textBlock.text);
  return { ...raw, provider: 'anthropic', model: config.claudeModel };
}

// ============================================================
// Agent 3 — Artistic Impact Critic (OpenAI)
// ============================================================

const ARTISTIC_IMPACT_PROMPT = `You are a fine art photography critic evaluating the artistic impact of a nature photograph intended for framed wall art.
Focus ONLY on artistic qualities.
Evaluate:
* emotional resonance
* sense of place or atmosphere
* uniqueness or poetic quality
* timelessness
* ability to evoke contemplation, calm, or wonder
Prefer photographs that:
* reward slow viewing
* feel like a finished artistic statement
* could stand alone as a gallery piece
Avoid rewarding images that rely mainly on:
* novelty or gimmicks
* heavy editing
* social-media-style visual punch
Score:
subject: 1–10 artisticImpact: 1–10
Respond ONLY with JSON:
{ "subject": <1-10>, "artisticImpact": <1-10>, "analysis": "<one concise sentence>" }`;

async function evaluateArtisticImpact(photo: PhotoCandidate): Promise<ArtisticImpactScore> {
  const image = await loadImageBase64(photo.filename);

  const response = await getOpenAI().chat.completions.create({
    model: config.openaiModel,
    max_completion_tokens: 512,
    messages: [
      { role: 'system', content: ARTISTIC_IMPACT_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: `Photo: "${photo.title}"` },
          { type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.base64}`, detail: 'low' } },
        ],
      },
    ],
  });

  const text = response.choices[0]?.message?.content;
  if (!text) throw new Error('No text in OpenAI response');
  const raw = parseJSON<{ subject: number; artisticImpact: number; analysis: string }>(text);
  return { ...raw, provider: 'openai', model: config.openaiModel };
}

// ============================================================
// Agent 4 — Gallery Curator / Final Ranker (Anthropic)
// ============================================================

const CURATOR_PROMPT = `You are a gallery curator selecting photographs for fine art print sales.
You will receive three photographs and evaluations from three critics:
* composition critic
* color & tonal critic
* artistic impact critic
Your task is to determine which image is most suitable for large framed wall art.
Rank the three photographs:
5 = strongest gallery piece 3 = good but less compelling 1 = weakest of the three
Each image MUST receive a different rank.
When deciding, prioritize:
1. composition
2. emotional resonance
3. color harmony and tonal quality
Favor photographs that feel timeless, contemplative, and gallery-worthy.
Respond ONLY with JSON:
[
  { "rank": <1|3|5>, "reasoning": "<one concise sentence>" },
  { "rank": <1|3|5>, "reasoning": "<one concise sentence>" },
  { "rank": <1|3|5>, "reasoning": "<one concise sentence>" }
]`;

async function curatorRank(
  photos: PhotoCandidate[],
  allCriticScores: CriticScores[]
): Promise<CuratorRanking[]> {
  const images = await Promise.all(photos.map(p => loadImageBase64(p.filename)));
  const content: Anthropic.Messages.ContentBlockParam[] = [];

  photos.forEach((photo, i) => {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: images[i].mimeType as 'image/jpeg', data: images[i].base64 },
    });

    const cs = allCriticScores[i];
    const criticSummary = [
      `Photo ${i + 1}: "${photo.title}"`,
      cs.composition
        ? `  Composition Critic: ${cs.composition.composition}/10 — "${cs.composition.analysis}"`
        : `  Composition Critic: unavailable`,
      cs.colorTonal
        ? `  Color & Tonal Critic: color ${cs.colorTonal.color}/10, tonal ${cs.colorTonal.tonalQuality}/10 — "${cs.colorTonal.analysis}"`
        : `  Color & Tonal Critic: unavailable`,
      cs.artisticImpact
        ? `  Artistic Impact Critic: subject ${cs.artisticImpact.subject}/10, impact ${cs.artisticImpact.artisticImpact}/10 — "${cs.artisticImpact.analysis}"`
        : `  Artistic Impact Critic: unavailable`,
    ].join('\n');

    content.push({ type: 'text', text: criticSummary });
  });

  content.push({ type: 'text', text: 'Rank these 3 photographs for gallery selection. Respond with JSON only.' });

  const response = await getAnthropic().messages.create({
    model: config.claudeModel,
    max_tokens: 1024,
    system: CURATOR_PROMPT,
    messages: [{ role: 'user', content }],
  });

  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') throw new Error('No text in Anthropic response');

  const rankings = parseJSON<Array<{ rank: number; reasoning: string }>>(textBlock.text);
  if (rankings.length !== 3) throw new Error(`Expected 3 rankings, got ${rankings.length}`);

  const ranks = rankings.map(r => r.rank).sort((a, b) => a - b);
  if (ranks[0] !== 1 || ranks[1] !== 3 || ranks[2] !== 5) {
    throw new Error(`Invalid curator ranks: ${ranks.join(', ')}`);
  }

  return rankings.map(r => ({ rank: r.rank as 1 | 3 | 5, reasoning: r.reasoning }));
}

// ============================================================
// Orchestrator
// ============================================================

async function evaluatePhoto(photo: PhotoCandidate): Promise<CriticScores> {
  const [composition, colorTonal, artisticImpact] = await Promise.allSettled([
    evaluateComposition(photo),
    evaluateColorTonal(photo),
    evaluateArtisticImpact(photo),
  ]);

  const scores: CriticScores = {
    composition: composition.status === 'fulfilled' ? composition.value : null,
    colorTonal: colorTonal.status === 'fulfilled' ? colorTonal.value : null,
    artisticImpact: artisticImpact.status === 'fulfilled' ? artisticImpact.value : null,
  };

  if (composition.status === 'rejected') {
    console.error(`[Scoring] Composition critic failed for "${photo.title}":`, composition.reason?.message || composition.reason);
  }
  if (colorTonal.status === 'rejected') {
    console.error(`[Scoring] Color/Tonal critic failed for "${photo.title}":`, colorTonal.reason?.message || colorTonal.reason);
  }
  if (artisticImpact.status === 'rejected') {
    console.error(`[Scoring] Artistic Impact critic failed for "${photo.title}":`, artisticImpact.reason?.message || artisticImpact.reason);
  }

  return scores;
}

export async function scorePhotos(photos: PhotoCandidate[]): Promise<ScoringCandidate[]> {
  console.log(`[Scoring] Evaluating ${photos.length} candidates with specialized critics...`);
  console.log(`[Scoring] Composition → Gemini (${config.geminiModel})`);
  console.log(`[Scoring] Color/Tonal → Anthropic (${config.claudeModel})`);
  console.log(`[Scoring] Artistic Impact → OpenAI (${config.openaiModel})`);
  console.log(`[Scoring] Curator → Anthropic (${config.claudeModel})`);

  // Phase 1: All 3 critics evaluate all photos in parallel
  const allCriticScores = await Promise.all(photos.map(p => evaluatePhoto(p)));

  // Phase 2: Curator ranks with all critic evaluations
  let rankings: CuratorRanking[] | null = null;
  try {
    rankings = await curatorRank(photos, allCriticScores);
  } catch (error) {
    console.error('[Scoring] Curator ranking failed:', error instanceof Error ? error.message : error);
  }

  // Build candidates
  const candidates: ScoringCandidate[] = photos.map((photo, i) => ({
    filename: photo.filename,
    title: photo.title,
    primaryTheme: photo.primaryTheme,
    criticScores: allCriticScores[i],
    curatorRanking: rankings ? rankings[i] : null,
    selected: false,
  }));

  // Select the photo ranked 5 by the curator, or fall back to highest critic average
  if (rankings) {
    const bestIdx = rankings.findIndex(r => r.rank === 5);
    if (bestIdx >= 0) candidates[bestIdx].selected = true;
  }

  // Fallback if curator failed: pick by highest average critic score
  if (!candidates.some(c => c.selected)) {
    let bestIdx = 0;
    let bestAvg = -1;
    candidates.forEach((c, i) => {
      const scores: number[] = [];
      if (c.criticScores.composition) scores.push(c.criticScores.composition.composition);
      if (c.criticScores.colorTonal) scores.push(c.criticScores.colorTonal.color, c.criticScores.colorTonal.tonalQuality);
      if (c.criticScores.artisticImpact) scores.push(c.criticScores.artisticImpact.subject, c.criticScores.artisticImpact.artisticImpact);
      const avg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
      if (avg > bestAvg) { bestAvg = avg; bestIdx = i; }
    });
    candidates[bestIdx].selected = true;
    console.log('[Scoring] Used critic average fallback for selection');
  }

  const selectedTitle = candidates.find(c => c.selected)?.title;
  console.log(`[Scoring] Selected: "${selectedTitle}"`);

  return candidates;
}
