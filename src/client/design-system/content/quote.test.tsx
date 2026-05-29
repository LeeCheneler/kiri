import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { Quote } from "./quote.tsx";

describe("<Quote>", () => {
  it("renders the quoted passage", () => {
    render(<Quote>words from elsewhere</Quote>);
    expect(screen.getByText(/words from elsewhere/i)).toBeDefined();
  });
});
