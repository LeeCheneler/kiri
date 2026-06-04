import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SchemaSpec } from "./schema-spec.tsx";

describe("<SchemaSpec>", () => {
  it("shows an empty state when there is no schema", () => {
    render(<SchemaSpec steps={[]} />);
    expect(screen.getByText(/no schema/i)).toBeDefined();
  });

  it("lists steps, publishes, and the summariser in order", () => {
    render(
      <SchemaSpec
        steps={[{ sh: "echo one" }, { use: "claude-code" }]}
        publish={[{ slug: "digest", name: "Digest", use: "publish-bundle" }]}
        summarize={{ use: "summary-bundle" }}
      />,
    );
    // Phase markers name each disclosure: Step NN, Publish NN, and the summariser.
    expect(screen.getByText("Step 01")).toBeDefined();
    expect(screen.getByText("Step 02")).toBeDefined();
    expect(screen.getByText("Publish 01")).toBeDefined();
    expect(screen.getByText("Summariser")).toBeDefined();
    // Entry labels surface in the collapsed summaries: steps fall back to their
    // reference, while a publish row shows its resolved name (not the bundle).
    expect(screen.getByText("claude-code")).toBeDefined();
    expect(screen.getByText("Digest")).toBeDefined();
    expect(screen.getByText("summary-bundle")).toBeDefined();
  });

  it("titles a step row by its name when one is declared", () => {
    render(<SchemaSpec steps={[{ sh: "echo one\necho two", name: "Warm the cache" }]} />);
    expect(screen.getByText("Warm the cache")).toBeDefined();
    // The script's first line no longer surfaces as the row title.
    expect(screen.queryByText("echo one")).toBeNull();
  });

  it("reveals an entry's config when its disclosure is expanded", async () => {
    const user = userEvent.setup();
    render(<SchemaSpec steps={[{ sh: "echo hi", description: "does a thing" }]} />);
    // Config is hidden until the row is expanded.
    expect(screen.queryByText("does a thing")).toBeNull();
    await user.click(screen.getByRole("button", { name: /echo hi/i }));
    expect(screen.getByText("does a thing")).toBeDefined();
  });

  it("shows a publish's resolved name and slug when expanded", async () => {
    const user = userEvent.setup();
    render(
      <SchemaSpec
        steps={[{ sh: "echo" }]}
        publish={[{ slug: "digest", name: "Weekly Digest", use: "publish-bundle" }]}
      />,
    );
    await user.click(screen.getByRole("button", { name: /publish 01/i }));
    expect(screen.getByRole("heading", { name: "Weekly Digest" })).toBeDefined();
    expect(screen.getByText("digest")).toBeDefined();
  });
});
