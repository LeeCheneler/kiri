import { beforeEach, describe, expect, it } from "bun:test";
import { act, render, screen } from "@testing-library/react";
import { FakeIntersectionObserver } from "../../../../tests/setup/fake-intersection-observer.ts";
import { Toc, type TocEntry } from "./toc.tsx";

const ENTRIES: TocEntry[] = [
  { id: "intro", label: "Intro", ordinal: "01" },
  { id: "body", label: "Body", ordinal: "02" },
  { id: "end", label: "End", ordinal: "03" },
];

// Render the TOC alongside the section elements it tracks, so its
// scroll-spy can resolve each entry's anchor off the live document.
const renderToc = (entries: TocEntry[] = ENTRIES, heading?: string) =>
  render(
    <>
      {entries.map((entry) => (
        <section key={entry.id} id={entry.id}>
          {entry.label}
        </section>
      ))}
      <Toc entries={entries} heading={heading} />
    </>,
  );

// Drive the scroll-spy as if one section crossed the active-zone threshold.
const fire = (id: string, isIntersecting: boolean) => {
  const observer = FakeIntersectionObserver.latest();
  if (observer === undefined) throw new Error("no observer");
  const target = document.getElementById(id);
  if (target === null) throw new Error(`#${id} not in DOM`);
  observer.callback(
    [
      {
        target,
        isIntersecting,
        intersectionRatio: isIntersecting ? 1 : 0,
        boundingClientRect: target.getBoundingClientRect(),
        intersectionRect: target.getBoundingClientRect(),
        rootBounds: null,
        time: 0,
      } as IntersectionObserverEntry,
    ],
    observer as unknown as IntersectionObserver,
  );
};

beforeEach(() => {
  FakeIntersectionObserver.reset();
  window.location.hash = "";
});

describe("<Toc>", () => {
  it("renders nothing when there are no entries", () => {
    const { container } = renderToc([]);
    expect(container.querySelector("nav")).toBeNull();
  });

  it("renders a labelled nav with a link and ordinal per entry, first active by default", () => {
    renderToc();
    expect(screen.getByRole("navigation", { name: "Contents" })).toBeDefined();
    expect(screen.getAllByRole("link").map((l) => l.getAttribute("href"))).toEqual([
      "#intro",
      "#body",
      "#end",
    ]);
    expect(screen.getByText("02")).toBeDefined();
    expect(screen.getByRole("link", { name: /intro/i }).getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("link", { name: /body/i }).getAttribute("aria-current")).toBeNull();
  });

  it("labels the nav with a custom heading", () => {
    renderToc(ENTRIES, "In this article");
    expect(screen.getByRole("navigation", { name: "In this article" })).toBeDefined();
  });

  it("scrolls to the entry named by the URL fragment on mount", () => {
    const scrolled: string[] = [];
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) {
      scrolled.push(this.id);
    };
    window.location.hash = "#body";
    renderToc();
    HTMLElement.prototype.scrollIntoView = original;
    expect(scrolled).toContain("body");
  });

  it("moves the active marker as a section enters and leaves the active zone", async () => {
    renderToc();
    await act(async () => {
      fire("body", true);
    });
    expect(screen.getByRole("link", { name: /body/i }).getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("link", { name: /intro/i }).getAttribute("aria-current")).toBeNull();

    // Once it leaves the zone the in-view set empties; with nothing else
    // intersecting, the last marker simply stays put.
    await act(async () => {
      fire("body", false);
    });
    expect(screen.getByRole("link", { name: /body/i }).getAttribute("aria-current")).toBe("true");
  });
});
