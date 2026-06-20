import agenticSessions from "./content/agentic-sessions.md?raw";
import cliReference from "./content/cli-reference.md?raw";
import examples from "./content/examples.md?raw";
import gettingStarted from "./content/getting-started.md?raw";
import llmProviders from "./content/llm-providers.md?raw";
import overview from "./content/overview.md?raw";
import troubleshooting from "./content/troubleshooting.md?raw";
import trustAndSecurity from "./content/trust-and-security.md?raw";
import workflows from "./content/workflows.md?raw";

/** A single documentation page: its url slug, nav label, and markdown body. */
export type DocsPage = {
  slug: string;
  title: string;
  content: string;
};

/** The slug of the docs landing page — the one served at `/docs`. */
export const DOCS_INDEX_SLUG = "overview";

/**
 * The documentation table of contents, in reading order. The single source of
 * truth for the docs routes, the left-rail navigation, and the prerender list.
 * The first entry is the landing page served at `/docs`; the rest live at
 * `/docs/<slug>`.
 */
export const DOCS_PAGES: DocsPage[] = [
  { slug: "overview", title: "Overview", content: overview },
  { slug: "getting-started", title: "Getting started", content: gettingStarted },
  { slug: "workflows", title: "Workflows", content: workflows },
  { slug: "llm-providers", title: "LLM providers", content: llmProviders },
  { slug: "agentic-sessions", title: "Agentic sessions", content: agenticSessions },
  { slug: "cli-reference", title: "CLI reference", content: cliReference },
  { slug: "examples", title: "Examples", content: examples },
  { slug: "trust-and-security", title: "Trust & security", content: trustAndSecurity },
  { slug: "troubleshooting", title: "Troubleshooting", content: troubleshooting },
];

/** The url path for a docs page: `/docs` for the landing page, `/docs/<slug>` otherwise. */
export const docsHref = (slug: string): string =>
  slug === DOCS_INDEX_SLUG ? "/docs" : `/docs/${slug}`;

/** Look up a docs page by slug, or `undefined` if no page owns it. */
export const getDocsPage = (slug: string): DocsPage | undefined =>
  DOCS_PAGES.find((page) => page.slug === slug);
