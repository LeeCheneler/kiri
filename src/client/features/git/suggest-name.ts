// Two short, unambiguous word lists. Kept deliberately plain — the suggestion
// only has to be typeable, memorable, and unlikely to collide with the last one
// you made; anything meaningful about the work belongs in the branch name.
const ADJECTIVES = [
  "amber",
  "brisk",
  "calm",
  "clever",
  "eager",
  "gentle",
  "keen",
  "lucky",
  "mellow",
  "nimble",
  "quiet",
  "rapid",
  "silver",
  "spry",
  "swift",
  "tidy",
  "vivid",
  "warm",
];

const NOUNS = [
  "badger",
  "beacon",
  "cedar",
  "comet",
  "ember",
  "falcon",
  "harbour",
  "heron",
  "lantern",
  "meadow",
  "otter",
  "pebble",
  "quarry",
  "raven",
  "ridge",
  "thistle",
  "willow",
  "wren",
];

const pick = (words: readonly string[]): string => words[Math.floor(Math.random() * words.length)];

/**
 * A short adjective-noun suggestion for a new worktree's directory name, such as
 * `swift-otter`. Pre-fills the create form so the field is never empty; it is
 * only a starting point and is meant to be overwritten when a name would read
 * better.
 */
export const suggestWorktreeName = (): string => `${pick(ADJECTIVES)}-${pick(NOUNS)}`;
