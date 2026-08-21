import type { ArticleFeedEntry, ArticleProducer } from "../../api.ts";
import { HeadlineLink } from "../../design-system/content/headline-link.tsx";
import { InlineLink } from "../../design-system/content/inline-link.tsx";
import { Meta } from "../../design-system/content/meta.tsx";
import { EdgedBlock } from "../../design-system/feedback/edged-block.tsx";
import { formatRelativeTime } from "../../formatters/format-time.ts";

// An article's URL nests under whichever container owns it, and each producer
// kind has its own path — so both the article and its container are addressed
// from the same pair.
const containerPath = (producer: ArticleProducer): string =>
  producer.kind === "run"
    ? `/runs/${encodeURIComponent(producer.id)}`
    : producer.kind === "session"
      ? `/sessions/${encodeURIComponent(producer.id)}`
      : `/projects/${encodeURIComponent(producer.id)}`;

/**
 * One article in the articles feed, as an entry in its own right rather than a
 * line beneath whatever produced it. Where run and session rows carry a status
 * edge, an article has no lifecycle to report — so it takes the accent edge
 * instead, marking it as something the system wrote rather than something it
 * did. An accent `article` kind marker leads the mono byline, followed by a
 * link to the container the article lives in (a workflow's run, a session, or
 * a project) and its relative age; the heading below links through to the
 * article itself, falling back to its name when the body has none.
 * `context="scoped"` renders the row inside its own container's page (a
 * project's corpus index): the kind marker and container link drop from the
 * byline — the page already establishes both — leaving the age, while the
 * accent edge and row anatomy stay identical to the feed's.
 * `now` is injectable so tests render deterministic relative times; production
 * omits it.
 */
export function ArticleRow({
  article,
  now,
  context = "feed",
}: {
  article: ArticleFeedEntry;
  now?: Date;
  context?: "feed" | "scoped";
}) {
  const container = containerPath(article.producer);
  return (
    <EdgedBlock>
      <Meta>
        {context === "feed" ? (
          <>
            <span className="text-accent uppercase">article</span>
            {/* Wrapped so Meta's middot attaches to the span rather than joining
                the link's underline and hit area, as run rows do. */}
            <span>
              <InlineLink href={container}>{article.producer.label}</InlineLink>
            </span>
          </>
        ) : null}
        <span>{formatRelativeTime(article.createdAt, now)}</span>
      </Meta>
      <div className="mt-1 text-base">
        <HeadlineLink href={`${container}/articles/${encodeURIComponent(article.slug)}`}>
          {article.heading ?? article.name}
        </HeadlineLink>
      </div>
    </EdgedBlock>
  );
}
