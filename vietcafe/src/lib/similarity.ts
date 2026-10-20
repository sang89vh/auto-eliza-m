/**
 * Prompt de-duplication. Two prompts that share most of their meaningful words
 * would produce near-identical Suno tracks, so Step 2 regenerates above a
 * threshold of 0.8.
 */

const STOPWORDS = new Set([
  'a', 'an', 'and', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by',
  'from', 'into', 'over', 'under', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'as', 'that', 'this', 'these', 'those', 'it', 'its', 'or', 'but',
  'not', 'no', 'so', 'very', 'more', 'most', 'some', 'any', 'each', 'both',
  'than', 'then', 'there', 'here', 'while', 'up', 'down', 'out', 'off',
]);

export function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
      .split(/\s+/)
      .map((word) => word.trim())
      .filter((word) => word.length > 1 && !STOPWORDS.has(word)),
  );
}

export function jaccard(a: string, b: string): number {
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const word of setA) {
    if (setB.has(word)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export interface SimilarityHit {
  score: number;
  against: string;
}

/** The closest existing prompt, or null if `existing` is empty. */
export function maxSimilarity(candidate: string, existing: string[]): SimilarityHit | null {
  let best: SimilarityHit | null = null;
  for (const other of existing) {
    const score = jaccard(candidate, other);
    if (!best || score > best.score) best = { score, against: other };
  }
  return best;
}
