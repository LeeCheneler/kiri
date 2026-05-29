import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { Card } from "./card.tsx";

describe("<Card>", () => {
  it("renders its content", () => {
    render(
      <Card>
        <p>boxed content</p>
      </Card>,
    );
    expect(screen.getByText(/boxed content/i)).toBeDefined();
  });
});
