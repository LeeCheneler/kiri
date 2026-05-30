import { describe, expect, it } from "bun:test";
import { act, render, screen } from "@testing-library/react";
import { flushAsync } from "../../../../tests/setup/flush-async.ts";
import { ArticleToc } from "./article-toc.tsx";

// Render the TOC alongside a fake <main> body that owns the section headings —
// production-ish layout where the TOC reads headings from the live document.
// The TOC sits outside <main> so it isn't caught by its own observer scope.
const renderWithBody = (sections: Array<{ ordinal: string; label: string }>) =>
  render(
    <>
      <main>
        {sections.map((s) => (
          <h3 key={s.ordinal} id={`section-${s.ordinal}`}>
            <span aria-hidden="true">§ {s.ordinal}</span>
            {s.label}
          </h3>
        ))}
      </main>
      <ArticleToc />
    </>,
  );

describe("<ArticleToc>", () => {
  it("renders nothing when there is no <main> to read from", () => {
    const { container } = render(<ArticleToc />);
    expect(container.querySelector("nav")).toBeNull();
  });

  it("renders nothing when the document has no section anchors", () => {
    const { container } = render(
      <>
        <main>
          <p>no headings here</p>
        </main>
        <ArticleToc />
      </>,
    );
    expect(container.querySelector("nav")).toBeNull();
  });

  it("renders one TOC link per section heading, eyebrow stripped from the label", () => {
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
    // The `§ NN` eyebrow is dropped — the label is just the prose title (the
    // ordinal renders as its own column inside the link).
    expect(links[0].textContent).toContain("What stood out");
    expect(links[0].textContent).not.toContain("§");
  });

  it("picks up sections added to <main> after mount", async () => {
    const { container } = render(
      <>
        <main />
        <ArticleToc />
      </>,
    );
    expect(container.querySelector("nav")).toBeNull();

    // Append the heading the way React would once an article fetch resolves —
    // the MutationObserver re-collects.
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

  it("re-syncs the labels when a section's title changes in place", async () => {
    const { container } = renderWithBody([{ ordinal: "01", label: "Draft title" }]);
    expect(screen.getByRole("link", { name: /draft title/i })).toBeDefined();

    // Same heading count, different label — the unchanged-set short-circuit
    // must not swallow it.
    await act(async () => {
      const heading = container.querySelector("#section-01");
      if (heading === null) throw new Error("section-01 not in DOM");
      heading.textContent = "§ 01Final title";
      await flushAsync();
    });

    expect(screen.getByRole("link", { name: /final title/i })).toBeDefined();
    expect(screen.queryByRole("link", { name: /draft title/i })).toBeNull();
  });

  it("ignores mutations under <main> that leave the heading set unchanged", async () => {
    const { container } = renderWithBody([{ ordinal: "01", label: "Stable" }]);
    expect(screen.getAllByRole("link")).toHaveLength(1);

    // A non-heading mutation — e.g. a lazy chart mounting after the headings
    // already exist — fires the observer, but the TOC must stay put rather
    // than rebuild from an identical heading set.
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
