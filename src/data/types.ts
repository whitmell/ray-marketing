export type ThemeCategory =
  | 'lighthouse'
  | 'sunset-sunrise'
  | 'beach-dunes'
  | 'wildlife'
  | 'ocean-waves'
  | 'winter-weather'
  | 'marsh-wetland'
  | 'aerial'
  | 'pier-dock'
  | 'night-sky'
  | 'architecture'
  | 'forest-trees'
  | 'general';

export interface DescriptionEntry {
  title: string;
  description: string;
  tags: string[];
  source: string;
  model: string;
}

export interface UploadEntry {
  uploadedAt: string;
  title: string;
  status: string;
  faaUrl: string;
  sizes: Array<{ size: string; width: number; height: number; markup: number }>;
}

export interface PhotoCandidate {
  filename: string;
  title: string;
  description: string;
  tags: string[];
  faaUrl: string;
  primaryTheme: ThemeCategory;
  uploadedAt: string;
}

export interface PublishRecord {
  platform: 'facebook' | 'instagram';
  publishedAt: string;
  platformPostId: string;
}

export interface Post {
  id: string;
  photoFilename: string;
  caption: string | null;
  status: 'draft' | 'posted' | 'discarded';
  primaryTheme: ThemeCategory;
  createdAt: string;
  postedAt: string | null;
  imageUrl: string | null;
  publishedTo: PublishRecord[];
  candidates: ScoringCandidate[];
}

export interface PostView extends Post {
  photoTitle: string;
  photoDescription: string;
  photoTags: string[];
  faaUrl: string;
}

export interface CompositionScore {
  composition: number;
  analysis: string;
  provider: string;
  model: string;
}

export interface ColorTonalScore {
  color: number;
  tonalQuality: number;
  analysis: string;
  provider: string;
  model: string;
}

export interface ArtisticImpactScore {
  subject: number;
  artisticImpact: number;
  analysis: string;
  provider: string;
  model: string;
}

export interface CriticScores {
  composition: CompositionScore | null;
  colorTonal: ColorTonalScore | null;
  artisticImpact: ArtisticImpactScore | null;
}

export interface CuratorRanking {
  rank: 1 | 3 | 5;
  reasoning: string;
}

export interface ScoringCandidate {
  filename: string;
  title: string;
  primaryTheme: ThemeCategory;
  criticScores: CriticScores;
  curatorRanking: CuratorRanking | null;
  selected: boolean;
}

export type PhotoCandidateSummary = Omit<PhotoCandidate, 'description'>;

export interface AppConfig {
  themeLookback: number;
}
