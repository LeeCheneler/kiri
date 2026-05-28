import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { act, cleanup, render, screen } from "@testing-library/react";
import { FakeIntersectionObserver } from "../../../tests/setup/fake-intersection-observer.ts";
import { flushAsync } from "../../../tests/setup/flush-async.ts";
import { ArticleAside } from "./article-aside.tsx";

beforeEach(() => {
  FakeIntersectionObserver.reset();
});

afterEach(() => cleanup());

// Render the aside alongside a fake <main> body that owns the section
// headings — production-ish layout where the aside reads headings from
// the live document. The aside sits outside <main> so it doesn't get
// caught by its own MutationObserver scope.
const renderWithBody = (sections: Array<{ ordinal: string; label: string }>) => {
  const result = render(
    <>
      <main>
        {sections.map((s) => (
          <h3 key={s.ordinal} id={`section-${s.ordinal}`}>
            <span aria-hidden="true">§ {s.ordinal}</span>
            {s.label}
          </h3>
        ))}
      </main>
      <ArticleAside />
    </>,
  );
  return result;
};

describe("<ArticleAside>", () => {
  it("renders nothing when the document has no section anchors", () => {
    const { container } = render(
      <>
        <main>
          <p>no headings here</p>
        </main>
        <ArticleAside />
      </>,
    );
    expect(container.querySelector("nav")).toBeNull();
  });

  it("renders one TOC link per section heading in document order", () => {
    renderWithBody([
      { ordinal: "01", label: "What stood out" },
      { ordinal: "02", label: "Top stories" },
      { ordinal: "03", label: "Quick takes" },
    ]);

    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "#section-01",
      "#section-02",
      "#section-03",
    ]);
    // Each link surfaces the heading's prose text with the `§ NN`
    // eyebrow stripped — the ordinal is rendered as a separate column.
    expect(links[0].textContent).toContain("What stood out");
    expect(links[1].textContent).toContain("Top stories");
    expect(links[2].textContent).toContain("Quick takes");
  });

  it("marks the first entry as active before the user scrolls", () => {
    renderWithBody([
      { ordinal: "01", label: "Intro" },
      { ordinal: "02", label: "Body" },
    ]);
    const first = screen.getByRole("link", { name: /intro/i });
    const second = screen.getByRole("link", { name: /body/i });
    expect(first.getAttribute("aria-current")).toBe("true");
    expect(second.getAttribute("aria-current")).toBeNull();
  });

  it("updates the active entry when the IntersectionObserver fires", async () => {
    renderWithBody([
      { ordinal: "01", label: "Intro" },
      { ordinal: "02", label: "Body" },
      { ordinal: "03", label: "End" },
    ]);

    const observer = FakeIntersectionObserver.latest();
    expect(observer).toBeDefined();

    // Simulate scrolling past the intro: the second section enters the
    // active zone — the observer's intersecting set now includes it.
    const second = document.getElementById("section-02");
    if (second === null) throw new Error("section-02 not in DOM");
    await act(async () => {
      observer?.callback(
        [
          {
            target: second,
            isIntersecting: true,
            intersectionRatio: 1,
            boundingClientRect: second.getBoundingClientRect(),
            intersectionRect: second.getBoundingClientRect(),
            rootBounds: null,
            time: 0,
          } as IntersectionObserverEntry,
        ],
        observer as unknown as IntersectionObserver,
      );
    });

    expect(screen.getByRole("link", { name: /body/i }).getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("link", { name: /intro/i }).getAttribute("aria-current")).toBeNull();
  });

  it("keeps the topmost intersecting section active when several are visible", async () => {
    renderWithBody([
      { ordinal: "01", label: "First" },
      { ordinal: "02", label: "Second" },
      { ordinal: "03", label: "Third" },
    ]);

    const observer = FakeIntersectionObserver.latest();
    expect(observer).toBeDefined();

    // Both second and third are intersecting; first is not. The active
    // entry should be the topmost intersecting in document order.
    await act(async () => {
      observer?.callback(
        ["section-02", "section-03"].map(
          (id) =>
            ({
              target: document.getElementById(id),
              isIntersecting: true,
              intersectionRatio: 1,
              boundingClientRect: new DOMRect(),
              intersectionRect: new DOMRect(),
              rootBounds: null,
              time: 0,
            }) as unknown as IntersectionObserverEntry,
        ),
        observer as unknown as IntersectionObserver,
      );
    });

    expect(screen.getByRole("link", { name: /^02 second$/i }).getAttribute("aria-current")).toBe(
      "true",
    );
  });

  it("picks up sections added to <main> after mount", async () => {
    const { container } = render(
      <>
        <main />
        <ArticleAside />
      </>,
    );

    expect(container.querySelector("nav")).toBeNull();

    // Append the heading the way React would once an article fetch
    // resolves — the MutationObserver re-collects.
    await act(async () => {
      const main = container.querySelector("main");
      if (main === null) throw new Error("main not in DOM");
      const h = document.createElement("h3");
      h.id = "section-01";
      h.textContent = "§ 01Late Arrival";
      main.appendChild(h);
      await flushAsync();
    });

    expect(screen.getByRole("link", { name: /late arrival/i }).getAttribute("href")).toBe(
      "#section-01",
    );
  });

  it("ignores mutations under <main> that leave the heading set unchanged", async () => {
    const { container } = renderWithBody([{ ordinal: "01", label: "Stable" }]);
    expect(screen.getAllByRole("link")).toHaveLength(1);

    // A non-heading mutation — e.g. a lazy chart mounting into the body
    // after the headings already exist — fires the observer, but the TOC
    // must stay put rather than rebuild from an identical heading set.
    await act(async () => {
      const main = container.querySelector("main");
      if (main === null) throw new Error("main not in DOM");
      main.appendChild(document.createElement("p"));
      await flushAsync();
    });

    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("link", { name: /stable/i }).getAttribute("href")).toBe("#section-01");
  });
});
