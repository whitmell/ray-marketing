import type { ThemeCategory } from '../data/types';

const THEME_TAG_MAP: Record<Exclude<ThemeCategory, 'general'>, string[]> = {
  'lighthouse': [
    'lighthouse', 'bodie island lighthouse', 'hatteras lighthouse',
    'currituck lighthouse', 'ocracoke lighthouse', 'beacon', 'light station',
    'cape hatteras', 'cape lookout',
  ],
  'sunset-sunrise': [
    'sunset', 'sunrise', 'golden hour', 'golden light',
    'dawn', 'dusk', 'twilight',
  ],
  'beach-dunes': [
    'beach', 'sand', 'sandy beach', 'beach scene', 'dunes',
    'dune', 'shoreline', 'seashore', 'beachgoers',
  ],
  'wildlife': [
    'wildlife', 'bird', 'horse', 'wild horse', 'deer',
    'pelican', 'heron', 'egret', 'swan', 'duck', 'geese',
    'cormorant', 'osprey', 'crab', 'fish', 'dolphin', 'turtle',
  ],
  'ocean-waves': [
    'ocean waves', 'waves', 'wave', 'surf', 'crashing waves',
    'breaker', 'tide', 'tidal', 'sea foam',
  ],
  'winter-weather': [
    'winter', 'snow', 'frost', 'ice', 'frozen',
    'storm', 'fog', 'misty', 'overcast', 'cold',
  ],
  'marsh-wetland': [
    'marsh', 'creek', 'swamp', 'wetland', 'bog',
    'sound', 'estuary', 'pamlico',
  ],
  'aerial': [
    'aerial', 'aerial view', 'drone', 'birds eye',
    'overhead', 'from above',
  ],
  'pier-dock': [
    'pier', 'dock', 'boardwalk', 'fishing pier', 'jetty',
    'wharf', 'nags head pier', 'jennettes pier',
  ],
  'night-sky': [
    'night sky', 'milky way', 'stars', 'night', 'moon',
    'astrophotography', 'long exposure', 'star trails',
  ],
  'architecture': [
    'architecture', 'building', 'house', 'cottage', 'church',
    'bridge', 'historic', 'hotel', 'restaurant',
  ],
  'forest-trees': [
    'tree', 'trees', 'forest', 'maritime forest', 'live oak',
    'woods', 'woodland', 'canopy',
  ],
};

// More specific themes break ties first
const THEME_PRIORITY: ThemeCategory[] = [
  'lighthouse', 'wildlife', 'night-sky', 'aerial', 'pier-dock',
  'architecture', 'winter-weather', 'marsh-wetland', 'forest-trees',
  'sunset-sunrise', 'beach-dunes', 'ocean-waves', 'general',
];

export function classifyTheme(tags: string[]): ThemeCategory {
  const lowerTags = tags.map(t => t.toLowerCase());
  const scores: Partial<Record<ThemeCategory, number>> = {};

  for (const [theme, keywords] of Object.entries(THEME_TAG_MAP)) {
    let score = 0;
    for (const keyword of keywords) {
      if (lowerTags.some(tag => tag.includes(keyword) || keyword.includes(tag))) {
        score++;
      }
    }
    if (score > 0) {
      scores[theme as ThemeCategory] = score;
    }
  }

  if (Object.keys(scores).length === 0) return 'general';

  const maxScore = Math.max(...Object.values(scores) as number[]);
  const topThemes = Object.entries(scores)
    .filter(([, s]) => s === maxScore)
    .map(([t]) => t as ThemeCategory);

  if (topThemes.length === 1) return topThemes[0];

  // Break ties by priority
  for (const theme of THEME_PRIORITY) {
    if (topThemes.includes(theme)) return theme;
  }

  return 'general';
}
