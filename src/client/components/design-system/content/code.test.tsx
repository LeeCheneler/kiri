import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { Code, CodeBlock } from "./code.tsx";

describe("<Code>", () => {
  it("renders the inline code token", () => {
    render(<Code>--color-accent</Code>);
    expect(screen.getByText("--color-accent")).toBeDefined();
  });
});

describe("<CodeBlock>", () => {
  it("renders the fenced snippet", () => {
    render(<CodeBlock>const answer = 42;</CodeBlock>);
    expect(screen.getByText(/const answer = 42;/)).toBeDefined();
  });
});
