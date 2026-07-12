import { describe, expect, it } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FullWidthImage, PreviewableImage } from "./image-thumb.tsx";

const part = {
  type: "file" as const,
  mediaType: "image/png",
  filename: "shot.png",
  url: "data:image/png;base64,AAAA",
};

describe("<PreviewableImage>", () => {
  it("opens a full-size preview on click and closes it on a backdrop click", async () => {
    const user = userEvent.setup();
    render(<PreviewableImage part={part} />);

    // Just the thumbnail until it's opened.
    expect(screen.getAllByAltText("shot.png")).toHaveLength(1);
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(screen.getByRole("button"));

    // The modal adds a second, full-size copy of the image.
    expect(screen.getByRole("dialog")).toBeDefined();
    expect(screen.getAllByAltText("shot.png")).toHaveLength(2);

    // A backdrop click lands on the dialog element itself and closes it.
    await user.click(screen.getByRole("dialog"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("<FullWidthImage>", () => {
  it("opens a full-resolution preview on click and closes it again", async () => {
    const user = userEvent.setup();
    render(<FullWidthImage part={part} />);

    expect(screen.getAllByAltText("shot.png")).toHaveLength(1);
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(screen.getByRole("button"));

    expect(screen.getByRole("dialog")).toBeDefined();
    expect(screen.getAllByAltText("shot.png")).toHaveLength(2);

    await user.click(screen.getByRole("dialog"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
