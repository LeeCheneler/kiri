import type { ArticleSummary } from "../../api.ts";
import { Eyebrow } from "../../design-system/content/eyebrow.tsx";
import { HeadlineLink } from "../../design-system/content/headline-link.tsx";
import { useRun } from "../../state/runs.ts";

/**
 * The run detail right rail: the run's invocation inputs and the articles it
 * published. Reads the same shared run query the page body uses (no second
 * fetch) and renders nothing until it resolves — and nothing at all for a run
 * with no inputs and no articles, so the rail stays empty rather than showing
 * bare headings.
 */
export function RunAside({ id }: { id: string }) {
  const detail = useRun(id).data?.run;
  if (!detail) return null;

  const { inputs } = detail;
  const showInputs = inputs !== null && Object.keys(inputs).length > 0;
  const showArticles = detail.articles.length > 0;
  if (!showInputs && !showArticles) return null;

  return (
    <div className="divide-y divide-rule">
      {showInputs && inputs ? <InputsSection inputs={inputs} /> : null}
      {showArticles ? <PublishedSection runId={detail.id} articles={detail.articles} /> : null}
    </div>
  );
}

// Each rail section carries its own vertical rhythm; the divide-y on the
// container draws the hairline between adjacent ones, and the first/last reset
// keeps the outer edges flush.
const SECTION_CLASS = "py-6 first:pt-0 last:pb-0";

function InputsSection({ inputs }: { inputs: Record<string, string> }) {
  return (
    <section className={SECTION_CLASS}>
      <Eyebrow tone="muted">Inputs</Eyebrow>
      <dl className="mt-3 space-y-3">
        {Object.entries(inputs).map(([name, value]) => (
          <div key={name}>
            <dt className="font-mono text-xs text-ink-muted">{name}</dt>
            <dd className="mt-0.5 font-mono text-sm break-words whitespace-pre-wrap text-ink">
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function PublishedSection({ runId, articles }: { runId: string; articles: ArticleSummary[] }) {
  return (
    <section className={SECTION_CLASS}>
      <Eyebrow tone="muted">Published</Eyebrow>
      <ul className="mt-3 space-y-4 text-base">
        {articles.map((article) => (
          <li key={article.slug}>
            <Eyebrow tone="muted">{article.slug}</Eyebrow>
            <HeadlineLink href={`/runs/${runId}/published/${article.slug}`}>
              {article.heading ?? article.name}
            </HeadlineLink>
          </li>
        ))}
      </ul>
    </section>
  );
}
