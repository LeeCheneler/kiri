import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { Prose } from "./prose.tsx";

describe("<Prose>", () => {
  it("renders body content", () => {
    render(
      <Prose>
        <p>readable body copy</p>
      </Prose>,
    );
    expect(screen.getByText(/readable body copy/i)).toBeDefined();
  });
});
