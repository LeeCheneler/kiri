import cliReference from "./content/cli-reference.md?raw";
import gettingStarted from "./content/getting-started.md?raw";
import kiriYamlReference from "./content/kiri-yaml-reference.md?raw";
import llmProviders from "./content/llm-providers.md?raw";
import overview from "./content/overview.md?raw";
import projectsAndMemories from "./content/projects-and-memories.md?raw";
import recipes from "./content/recipes.md?raw";
import sessionReference from "./content/session-reference.md?raw";
import sessions from "./content/sessions.md?raw";
import troubleshooting from "./content/troubleshooting.md?raw";
import trustAndSecurity from "./content/trust-and-security.md?raw";
import workflowAuthoring from "./content/workflow-authoring.md?raw";
import workflowReference from "./content/workflow-reference.md?raw";
import workflows from "./content/workflows.md?raw";
import workingWithFiles from "./content/working-with-files.md?raw";

/** The left-rail section a documentation page is grouped under. */
export type DocsSection = "Start" | "Guides" | "Reference";

/** A single documentation page: its url slug, nav label, section, and markdown body. */
export type DocsPage = {
  slug: string;
  title: string;
  section: DocsSection;
  content: string;
};

/** The slug of the docs landing page — the one served at `/docs`. */
export const DOCS_INDEX_SLUG = "overview";

/**
 * The documentation table of contents, in reading order. The single source of
 * truth for the docs routes and the left-rail navigation, where consecutive
 * pages sharing a `section` render as one titled group. The first entry is the
 * landing page served at `/docs`; the rest live at `/docs/<slug>`.
 */
export const DOCS_PAGES: DocsPage[] = [
  { slug: "overview", title: "Start here", section: "Start", content: overview },
  { slug: "getting-started", title: "Quickstart", section: "Start", content: gettingStarted },
  { slug: "sessions", title: "Have a conversation", section: "Guides", content: sessions },
  {
    slug: "working-with-files",
    title: "Work with files",
    section: "Guides",
    content: workingWithFiles,
  },
  {
    slug: "projects-and-memories",
    title: "Projects & memories",
    section: "Guides",
    content: projectsAndMemories,
  },
  { slug: "workflows", title: "Create a workflow", section: "Guides", content: workflows },
  {
    slug: "session-reference",
    title: "Session reference",
    section: "Reference",
    content: sessionReference,
  },
  {
    slug: "workflow-authoring",
    title: "Workflow authoring",
    section: "Reference",
    content: workflowAuthoring,
  },
  {
    slug: "llm-providers",
    title: "Models & providers",
    section: "Reference",
    content: llmProviders,
  },
  { slug: "recipes", title: "Workflow recipes", section: "Reference", content: recipes },
  {
    slug: "kiri-yaml",
    title: "kiri.yaml",
    section: "Reference",
    content: kiriYamlReference,
  },
  {
    slug: "workflow-reference",
    title: "Workflow reference",
    section: "Reference",
    content: workflowReference,
  },
  { slug: "cli-reference", title: "CLI", section: "Reference", content: cliReference },
  {
    slug: "trust-and-security",
    title: "Trust & security",
    section: "Reference",
    content: trustAndSecurity,
  },
  {
    slug: "troubleshooting",
    title: "Troubleshooting",
    section: "Reference",
    content: troubleshooting,
  },
];

/** The url path for a docs page: `/docs` for the landing page, `/docs/<slug>` otherwise. */
export const docsHref = (slug: string): string =>
  slug === DOCS_INDEX_SLUG ? "/docs" : `/docs/${slug}`;

/** Look up a docs page by slug, or `undefined` if no page owns it. */
export const getDocsPage = (slug: string): DocsPage | undefined =>
  DOCS_PAGES.find((page) => page.slug === slug);
