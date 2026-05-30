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
        publish={[{ name: "digest", title: "Digest", use: "publish-bundle" }]}
        summarize={{ use: "summary-bundle" }}
      />,
    );
    // Phase markers name each disclosure: Step NN, Publish NN, and the summariser.
    expect(screen.getByText("Step 01")).toBeDefined();
    expect(screen.getByText("Step 02")).toBeDefined();
    expect(screen.getByText("Publish 01")).toBeDefined();
    expect(screen.getByText("Summariser")).toBeDefined();
    // Entry titles surface in the collapsed summaries.
    expect(screen.getByText("claude-code")).toBeDefined();
    expect(screen.getByText("publish-bundle")).toBeDefined();
    expect(screen.getByText("summary-bundle")).toBeDefined();
  });

  it("reveals an entry's config when its disclosure is expanded", async () => {
    const user = userEvent.setup();
    render(<SchemaSpec steps={[{ sh: "echo hi", description: "does a thing" }]} />);
    // Config is hidden until the row is expanded.
    expect(screen.queryByText("does a thing")).toBeNull();
    await user.click(screen.getByRole("button", { name: /echo hi/i }));
    expect(screen.getByText("does a thing")).toBeDefined();
  });

  it("shows a publish's resolved title and name when expanded", async () => {
    const user = userEvent.setup();
    render(
      <SchemaSpec
        steps={[{ sh: "echo" }]}
        publish={[{ name: "digest", title: "Weekly Digest", use: "publish-bundle" }]}
      />,
    );
    await user.click(screen.getByRole("button", { name: /publish 01/i }));
    expect(screen.getByRole("heading", { name: "Weekly Digest" })).toBeDefined();
    expect(screen.getByText("digest")).toBeDefined();
  });
});
