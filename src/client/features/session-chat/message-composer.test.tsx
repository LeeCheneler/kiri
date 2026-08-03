import { describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UIMessage } from "ai";
import { type ReactNode, useState } from "react";
import { type PendingImage, type PendingTextFile, wrapAttachedFile } from "./attachments.ts";
import { MessageComposer } from "./message-composer.tsx";

// A stateful host so the controlled textarea behaves as it does in the app.
function Harness({
  onSubmit,
  onCancel,
  busy = false,
  labelHidden = false,
  submitLabel,
  acceptsImages,
  hint,
  initialImages,
  initialTextFiles,
}: {
  onSubmit: (parts: UIMessage["parts"]) => void;
  onCancel?: () => void;
  busy?: boolean;
  labelHidden?: boolean;
  submitLabel?: string;
  acceptsImages?: boolean;
  hint?: ReactNode;
  initialImages?: PendingImage[];
  initialTextFiles?: PendingTextFile[];
}) {
  const [value, setValue] = useState("");
  return (
    <MessageComposer
      value={value}
      onChange={setValue}
      onSubmit={onSubmit}
      onCancel={onCancel}
      busy={busy}
      label="Message"
      labelHidden={labelHidden}
      submitLabel={submitLabel}
      acceptsImages={acceptsImages}
      hint={hint}
      initialImages={initialImages}
      initialTextFiles={initialTextFiles}
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
const txtFile = (name: string, content: BlobPart = "hello") => new File([content], name);

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

  it("opens the file picker from the add file button", async () => {
    const onSubmit = mock((_parts: UIMessage["parts"]) => {});
    const { container } = composer(onSubmit);

    let clicked = false;
    fileInput(container).click = () => {
      clicked = true;
    };
    await userEvent.click(screen.getByRole("button", { name: /add file/i }));

    expect(clicked).toBe(true);
  });

  it("keeps the field and controls editable while busy but blocks submitting", async () => {
    const onSubmit = mock((_parts: UIMessage["parts"]) => {});
    composer(onSubmit, true);

    // The field and the add-file control stay usable, so the next message can
    // be drafted while a turn is in flight.
    expect((textbox() as HTMLTextAreaElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: /add file/i }) as HTMLButtonElement).disabled).toBe(
      false,
    );

    // …but Enter doesn't send until the turn settles.
    await userEvent.type(textbox(), "drafted ahead{Enter}");
    expect(onSubmit.mock.calls).toHaveLength(0);
  });

  it("fires onCancel on Escape without submitting", async () => {
    const onSubmit = mock((_parts: UIMessage["parts"]) => {});
    const onCancel = mock(() => {});
    render(<Harness onSubmit={onSubmit} onCancel={onCancel} />);

    await userEvent.type(textbox(), "{Escape}");

    expect(onCancel.mock.calls).toHaveLength(1);
    expect(onSubmit.mock.calls).toHaveLength(0);
  });

  it("submits from the send button", async () => {
    const onSubmit = mock((_parts: UIMessage["parts"]) => {});
    composer(onSubmit);

    await userEvent.type(textbox(), "Hello there");
    await userEvent.click(screen.getByRole("button", { name: "send" }));

    expect(onSubmit.mock.calls).toEqual([[[{ type: "text", text: "Hello there" }]]]);
  });

  it("disables the send button while there is nothing to send", async () => {
    const onSubmit = mock((_parts: UIMessage["parts"]) => {});
    composer(onSubmit);

    const send = screen.getByRole("button", { name: "send" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    await userEvent.type(textbox(), "a");
    expect(send.disabled).toBe(false);
  });

  it("disables the send button while busy", async () => {
    const onSubmit = mock((_parts: UIMessage["parts"]) => {});
    composer(onSubmit, true);

    await userEvent.type(textbox(), "drafted ahead");
    expect((screen.getByRole("button", { name: "send" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("names the submit action from submitLabel", () => {
    render(<Harness onSubmit={mock((_parts: UIMessage["parts"]) => {})} submitLabel="resend" />);
    expect(screen.getByRole("button", { name: "resend" })).toBeDefined();
  });

  it("offers a cancel button only when onCancel is given, wired to it", async () => {
    const onSubmit = mock((_parts: UIMessage["parts"]) => {});
    const onCancel = mock(() => {});
    const { unmount } = render(<Harness onSubmit={onSubmit} onCancel={onCancel} />);

    await userEvent.click(screen.getByRole("button", { name: "cancel" }));
    expect(onCancel.mock.calls).toHaveLength(1);

    unmount();
    composer(onSubmit);
    expect(screen.queryByRole("button", { name: "cancel" })).toBeNull();
  });

  it("rejects a picked image with an inline error when the model reads text only", async () => {
    const onSubmit = mock((_parts: UIMessage["parts"]) => {});
    const { container } = render(<Harness onSubmit={onSubmit} acceptsImages={false} />);

    // The picker's accept narrows to text files, so force the upload past it —
    // a real picker can still hand over anything via "All Files".
    await userEvent.upload(fileInput(container), pngFile("photo.png"), { applyAccept: false });

    expect(await screen.findByText(/reads text only/i)).toBeDefined();
    expect(screen.queryByAltText("photo.png")).toBeNull();
  });

  it("rejects a pasted image the same way when the model reads text only", async () => {
    const onSubmit = mock((_parts: UIMessage["parts"]) => {});
    render(<Harness onSubmit={onSubmit} acceptsImages={false} />);

    fireEvent.paste(textbox(), { clipboardData: { files: [pngFile("pasted.png")] } });

    expect(await screen.findByText(/reads text only/i)).toBeDefined();
    expect(screen.queryByAltText("pasted.png")).toBeNull();
  });

  it("still stages text files when the model reads text only", async () => {
    const onSubmit = mock((_parts: UIMessage["parts"]) => {});
    const { container } = render(<Harness onSubmit={onSubmit} acceptsImages={false} />);

    await userEvent.upload(fileInput(container), txtFile("notes.md"));

    expect(await screen.findByText("notes.md")).toBeDefined();
  });

  it("keeps the accessible name but hides the visible label when labelHidden", () => {
    render(<Harness onSubmit={mock((_parts: UIMessage["parts"]) => {})} labelHidden />);
    expect(screen.getByRole("textbox", { name: "Message" })).toBeDefined();
    expect(screen.queryByText("Message")).toBeNull();
  });

  it("renders a trailing key hint", () => {
    render(<Harness onSubmit={mock((_parts: UIMessage["parts"]) => {})} hint="Enter to resend" />);
    expect(screen.getByText("Enter to resend")).toBeDefined();
  });

  it("starts with the seeded images and submits them ahead of the text", async () => {
    const onSubmit = mock((_parts: UIMessage["parts"]) => {});
    const seeded: PendingImage[] = [
      {
        id: "seed-1",
        part: {
          type: "file",
          mediaType: "image/png",
          filename: "seed.png",
          url: "data:image/png;base64,AA",
        },
      },
    ];
    render(<Harness onSubmit={onSubmit} initialImages={seeded} />);

    // The seeded image previews straight away.
    expect(screen.getByAltText("seed.png")).toBeDefined();
    await userEvent.type(textbox(), "describe it{Enter}");

    const parts = onSubmit.mock.calls[0]?.[0] ?? [];
    expect(parts[0]).toEqual(seeded[0].part);
    expect(parts.at(-1)).toEqual({ type: "text", text: "describe it" });
  });

  it("stages a text file as a tile and submits it as a wrapped text part before the text", async () => {
    const onSubmit = mock((_parts: UIMessage["parts"]) => {});
    const { container } = composer(onSubmit);

    await userEvent.upload(fileInput(container), txtFile("notes.md", "# heading"));
    // The staged file previews as a named chip before sending.
    expect(await screen.findByText("notes.md")).toBeDefined();

    await userEvent.type(textbox(), "summarise this{Enter}");

    const parts = onSubmit.mock.calls[0]?.[0] ?? [];
    expect(parts[0]).toEqual({ type: "text", text: wrapAttachedFile("notes.md", "# heading") });
    expect(parts.at(-1)).toEqual({ type: "text", text: "summarise this" });
  });

  it("submits a text-file-only message with no typed text", async () => {
    const onSubmit = mock((_parts: UIMessage["parts"]) => {});
    const { container } = composer(onSubmit);

    await userEvent.upload(fileInput(container), txtFile("only.txt", "body"));
    await screen.findByText("only.txt");
    await userEvent.click(textbox());
    await userEvent.keyboard("{Enter}");

    const parts = onSubmit.mock.calls[0]?.[0] ?? [];
    expect(parts).toEqual([{ type: "text", text: wrapAttachedFile("only.txt", "body") }]);
  });

  it("removes a staged text file", async () => {
    const onSubmit = mock((_parts: UIMessage["parts"]) => {});
    const { container } = composer(onSubmit);

    await userEvent.upload(fileInput(container), txtFile("drop.md", "x"));
    await screen.findByText("drop.md");
    await userEvent.click(screen.getByRole("button", { name: /remove drop\.md/i }));

    await waitFor(() => expect(screen.queryByText("drop.md")).toBeNull());
  });

  it("rejects an oversize text file with an inline error and does not stage it", async () => {
    const onSubmit = mock((_parts: UIMessage["parts"]) => {});
    const { container } = composer(onSubmit);

    const tooBig = txtFile("big.txt", new Uint8Array(256 * 1024 + 1));
    await userEvent.upload(fileInput(container), tooBig);

    expect(await screen.findByText(/must be under 256 KB/i)).toBeDefined();
    expect(screen.queryByText("big.txt")).toBeNull();
  });

  it("starts with seeded text files and submits them ahead of the text", async () => {
    const onSubmit = mock((_parts: UIMessage["parts"]) => {});
    const seeded: PendingTextFile[] = [
      { id: "seed-1", filename: "seed.md", content: "seeded body" },
    ];
    render(<Harness onSubmit={onSubmit} initialTextFiles={seeded} />);

    expect(screen.getByText("seed.md")).toBeDefined();
    await userEvent.type(textbox(), "use it{Enter}");

    const parts = onSubmit.mock.calls[0]?.[0] ?? [];
    expect(parts[0]).toEqual({ type: "text", text: wrapAttachedFile("seed.md", "seeded body") });
    expect(parts.at(-1)).toEqual({ type: "text", text: "use it" });
  });
});
