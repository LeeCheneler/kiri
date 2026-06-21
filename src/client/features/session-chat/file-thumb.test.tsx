import { describe, expect, it } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FileThumb, PreviewableFile } from "./file-thumb.tsx";

describe("<FileThumb>", () => {
  it("names the file, with the full name on hover", () => {
    render(<FileThumb filename="notes.md" />);
    expect(screen.getByText("notes.md")).toBeDefined();
    expect(screen.getByTitle("notes.md")).toBeDefined();
  });
});

describe("<PreviewableFile>", () => {
  it("opens the file contents in a modal on click and closes on a backdrop click", async () => {
    const user = userEvent.setup();
    render(<PreviewableFile filename="notes.md" content="# secret stuff" />);

    // The contents stay hidden until the tile is opened.
    expect(screen.queryByText("# secret stuff")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(screen.getByRole("button"));

    expect(screen.getByRole("dialog")).toBeDefined();
    expect(screen.getByText("# secret stuff")).toBeDefined();

    // A backdrop click lands on the dialog element itself and closes it.
    await user.click(screen.getByRole("dialog"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
