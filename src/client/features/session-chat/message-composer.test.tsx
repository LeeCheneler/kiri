import { describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UIMessage } from "ai";
import { useState } from "react";
import { MessageComposer } from "./message-composer.tsx";

// A stateful host so the controlled textarea behaves as it does in the app.
function Harness({
  onSubmit,
  busy = false,
}: {
  onSubmit: (parts: UIMessage["parts"]) => void;
  busy?: boolean;
}) {
  const [value, setValue] = useState("");
  return (
    <MessageComposer
      value={value}
      onChange={setValue}
      onSubmit={onSubmit}
      busy={busy}
      label="Message"
    />
  );
}

const composer = (onSubmit: (parts: UIMessage["parts"]) => void, busy = false) =>
  render(<Harness onSubmit={onSubmit} busy={busy} />);

const textbox = () => screen.getByRole("textbox", { name: "Message" });
const fileInput = (container: HTMLElement) =>
  container.querySelector('input[type="file"]') as HTMLInputElement;
const pngFile = (name: string, bytes: BlobPart = "img") =>
  new File([bytes], name, { type: "image/png" });

describe("<MessageComposer>", () => {
  it("submits the typed text as a single text part on Enter", async () => {
    const onSubmit = mock((_parts: UIMessage["parts"]) => {});
    composer(onSubmit);

    await userEvent.type(textbox(), "Hello there{Enter}");

    expect(onSubmit.mock.calls).toEqual([[[{ type: "text", text: "Hello there" }]]]);
  });

  it("inserts a newline on Shift+Enter instead of submitting", async () => {
    const onSubmit = mock((_parts: UIMessage["parts"]) => {});
    composer(onSubmit);

    await userEvent.type(textbox(), "Hello");
    await userEvent.keyboard("{Shift>}{Enter}{/Shift}");

    expect(onSubmit.mock.calls).toHaveLength(0);
  });

  it("ignores Enter on an empty composer", async () => {
    const onSubmit = mock((_parts: UIMessage["parts"]) => {});
    composer(onSubmit);

    await userEvent.click(textbox());
    await userEvent.keyboard("{Enter}");

    expect(onSubmit.mock.calls).toHaveLength(0);
  });

  it("stages an uploaded image and submits it as a leading file part before the text", async () => {
    const onSubmit = mock((_parts: UIMessage["parts"]) => {});
    const { container } = composer(onSubmit);

    await userEvent.upload(fileInput(container), pngFile("shot.png"));
    // The staged image previews before sending.
    expect(await screen.findByAltText("shot.png")).toBeDefined();

    await userEvent.type(textbox(), "what is this?{Enter}");

    const parts = onSubmit.mock.calls[0]?.[0] ?? [];
    expect(parts[0]).toMatchObject({ type: "file", mediaType: "image/png" });
    expect(parts.at(-1)).toEqual({ type: "text", text: "what is this?" });
  });

  it("submits an image-only message with no text", async () => {
    const onSubmit = mock((_parts: UIMessage["parts"]) => {});
    const { container } = composer(onSubmit);

    await userEvent.upload(fileInput(container), pngFile("only.png"));
    await screen.findByAltText("only.png");
    await userEvent.click(textbox());
    await userEvent.keyboard("{Enter}");

    const parts = onSubmit.mock.calls[0]?.[0] ?? [];
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ type: "file" });
  });

  it("clears staged images after a submit", async () => {
    const onSubmit = mock((_parts: UIMessage["parts"]) => {});
    const { container } = composer(onSubmit);

    await userEvent.upload(fileInput(container), pngFile("gone.png"));
    await screen.findByAltText("gone.png");
    await userEvent.type(textbox(), "ok{Enter}");

    await waitFor(() => expect(screen.queryByAltText("gone.png")).toBeNull());
  });

  it("stages an image pasted into the textarea", async () => {
    const onSubmit = mock((_parts: UIMessage["parts"]) => {});
    composer(onSubmit);

    fireEvent.paste(textbox(), { clipboardData: { files: [pngFile("pasted.png")] } });

    expect(await screen.findByAltText("pasted.png")).toBeDefined();
  });

  it("removes a staged image", async () => {
    const onSubmit = mock((_parts: UIMessage["parts"]) => {});
    const { container } = composer(onSubmit);

    await userEvent.upload(fileInput(container), pngFile("drop-me.png"));
    await screen.findByAltText("drop-me.png");
    await userEvent.click(screen.getByRole("button", { name: /remove image/i }));

    await waitFor(() => expect(screen.queryByAltText("drop-me.png")).toBeNull());
  });

  it("rejects an oversize image with an inline error and does not stage it", async () => {
    const onSubmit = mock((_parts: UIMessage["parts"]) => {});
    const { container } = composer(onSubmit);

    const tooBig = pngFile("huge.png", new Uint8Array(10 * 1024 * 1024 + 1));
    await userEvent.upload(fileInput(container), tooBig);

    expect(await screen.findByText(/must be under 10 MB/i)).toBeDefined();
    expect(screen.queryByAltText("huge.png")).toBeNull();
  });

  it("opens the file picker from the add image button", async () => {
    const onSubmit = mock((_parts: UIMessage["parts"]) => {});
    const { container } = composer(onSubmit);

    let clicked = false;
    fileInput(container).click = () => {
      clicked = true;
    };
    await userEvent.click(screen.getByRole("button", { name: /add image/i }));

    expect(clicked).toBe(true);
  });

  it("disables the textarea and the add image button while busy", () => {
    const onSubmit = mock((_parts: UIMessage["parts"]) => {});
    composer(onSubmit, true);

    expect((textbox() as HTMLTextAreaElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /add image/i }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
