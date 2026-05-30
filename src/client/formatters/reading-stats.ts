const WORDS_PER_MINUTE = 200;
const WORD_TOKEN = /[\p{L}\p{N}]/u;
const NUMBER_FORMAT = new Intl.NumberFormat("en");

/** Display-ready reading metadata derived from an article's markdown body. */
export interface ReadingStats {
  /** Word count with its unit, e.g. "1,240 words" (or "1 word"). */
  words: string;
  /** Estimated reading time, e.g. "6 min read"; never below "1 min read". */
  readingTime: string;
}

/**
 * Derive a body's word count and estimated reading time from its markdown
 * source. Words are whitespace-separated tokens carrying at least one letter
 * or digit, so markdown punctuation (`#`, `-`, `**`) doesn't inflate the
 * count. Reading time estimates at 200 words per minute, rounded up and
 * floored at one minute so even a terse note still reads as "1 min read".
 */
export const readingStats = (markdown: string): ReadingStats => {
  const count = markdown.split(/\s+/).filter((token) => WORD_TOKEN.test(token)).length;
  const minutes = Math.max(1, Math.ceil(count / WORDS_PER_MINUTE));
  return {
    words: `${NUMBER_FORMAT.format(count)} ${count === 1 ? "word" : "words"}`,
    readingTime: `${minutes} min read`,
  };
};
