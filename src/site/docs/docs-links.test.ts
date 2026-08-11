import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { headingSlug } from "../../client/design-system/content/markdown.tsx";

const CONTENT_DIR = join(import.meta.dir, "content");

// The heading ids a rendered docs page exposes: every authored heading,
// slugged, with repeats suffixed — mirroring the Markdown renderer.
const headingSlugsOf = (markdown: string): Set<string> => {
  const slugs = new Set<string>();
  const counts = new Map<string, number>();
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const heading = line.match(/^#{1,6}\s+(.*)/);
    if (heading === null) continue;
    const base = headingSlug(heading[1]) || "section";
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    slugs.add(count === 0 ? base : `${base}-${count}`);
  }
  return slugs;
};

const ANCHOR_LINK = /\]\((?:\/docs\/([a-z0-9-]+))?#([A-Za-z0-9%-]+)\)/g;

describe("docs anchor links", () => {
  const files = readdirSync(CONTENT_DIR).filter((file) => file.endsWith(".md"));
  const pages = new Map<string, { markdown: string; slugs: Set<string> }>();
  for (const file of files) {
    const markdown = readFileSync(join(CONTENT_DIR, file), "utf8");
    pages.set(file.slice(0, -3), { markdown, slugs: headingSlugsOf(markdown) });
  }

  it("resolves every authored #anchor to a heading on its target page", () => {
    const dead: string[] = [];
    for (const [slug, page] of pages) {
      for (const match of page.markdown.matchAll(ANCHOR_LINK)) {
        const targetPage = match[1] ?? slug;
        const anchor = match[2];
        const target = pages.get(targetPage);
        if (target === undefined || !target.slugs.has(anchor)) {
          dead.push(`${slug}.md links to /docs/${targetPage}#${anchor}`);
        }
      }
    }
    expect(dead).toEqual([]);
  });
});
