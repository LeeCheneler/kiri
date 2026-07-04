import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { ArticlesSpec } from "./articles-spec.tsx";

describe("<ArticlesSpec>", () => {
  it("shows an empty state when nothing is published", () => {
    render(<ArticlesSpec entries={[]} />);
    expect(screen.getByText(/publishes no articles/i)).toBeDefined();
  });

  it("lists each publish with its name, description, and slug", () => {
    render(
      <ArticlesSpec
        entries={[
          {
            slug: "digest",
            name: "Weekly Digest",
            description: "A weekly roundup",
            use: "publish-bundle",
          },
        ]}
      />,
    );
    expect(screen.getByRole("heading", { name: "Weekly Digest" })).toBeDefined();
    expect(screen.getByText("A weekly roundup")).toBeDefined();
    expect(screen.getByText("digest")).toBeDefined();
    // Implementation detail (the bundle reference) stays in the Schema tab.
    expect(screen.queryByText("publish-bundle")).toBeNull();
  });
});
