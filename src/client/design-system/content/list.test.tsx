import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { List } from "./list.tsx";

describe("<List>", () => {
  it("renders a bulleted list by default", () => {
    render(
      <List>
        <li>first item</li>
      </List>,
    );
    expect(screen.getByText("first item")).toBeDefined();
    expect(screen.getByRole("list").tagName).toBe("UL");
  });

  it("renders a numbered list when ordered", () => {
    render(
      <List ordered>
        <li>step one</li>
      </List>,
    );
    expect(screen.getByText("step one")).toBeDefined();
    expect(screen.getByRole("list").tagName).toBe("OL");
  });
});
