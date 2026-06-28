import { describe, expect, it, mock } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UIMessage } from "ai";
import { createQueryClient } from "../../state/query-client.ts";
import { wrapAttachedFile } from "./attachments.ts";
import { ChatMessage, type ResubmitHandler } from "./chat-message.tsx";

const message = (role: "user" | "assistant", parts: unknown[]): UIMessage =>
  ({ id: "m1", role, parts }) as UIMessage;

const renderMessage = (
  msg: UIMessage,
  { busy = false, onResubmit = () => {} }: { busy?: boolean; onResubmit?: ResubmitHandler } = {},
) => render(<ChatMessage message={msg} busy={busy} onResubmit={onResubmit} />);

const editField = () =>
  screen.queryByRole("textbox", { name: "Edit message" }) as HTMLTextAreaElement | null;
const editButton = () => screen.getByRole("button", { name: "edit" });

describe("<ChatMessage>", () => {
  it("renders a user message verbatim with its image attachments", () => {
    renderMessage(
      message("user", [
        {
          type: "file",
          mediaType: "image/png",
          filename: "shot.png",
          url: "data:image/png;base64,AA",
        },
        { type: "text", text: "look at this" },
      ]),
    );

    expect(screen.getByText("You")).toBeDefined();
    expect(screen.getByText("look at this")).toBeDefined();
    expect(screen.getByAltText("shot.png")).toBeDefined();
  });

  it("renders an attached text file as a previewable tile, not as raw message text", () => {
    renderMessage(
      message("user", [
        { type: "text", text: wrapAttachedFile("notes.md", "# secret stuff") },
        { type: "text", text: "what do you think?" },
      ]),
    );

    expect(screen.getByText("notes.md")).toBeDefined();
    expect(screen.getByText("what do you think?")).toBeDefined();
    // The wrapped contents are not dumped into the transcript.
    expect(screen.queryByText(/secret stuff/)).toBeNull();
  });

  it("renders assistant prose as markdown", () => {
    renderMessage(message("assistant", [{ type: "text", text: "Hello there" }]));
    expect(screen.getByText("Assistant")).toBeDefined();
    expect(screen.getByText("Hello there")).toBeDefined();
  });

  it("interleaves tool calls with the assistant's prose, in order", () => {
    renderMessage(
      message("assistant", [
        // A step boundary and an empty text part both render nothing, sat
        // between the parts that do.
        { type: "step-start" },
        { type: "text", text: "Let me look that up." },
        {
          type: "tool-create_issue",
          toolCallId: "c1",
          state: "output-available",
          input: { query: "kiri release" },
          output: { id: 1 },
        },
        { type: "text", text: "" },
        { type: "text", text: "Here is what I found." },
      ]),
    );

    expect(screen.getByText("Let me look that up.")).toBeDefined();
    expect(screen.getByText("Here is what I found.")).toBeDefined();
    expect(screen.getByText("Create issue")).toBeDefined();
    expect(screen.getByText("kiri release")).toBeDefined();
  });

  it("renders nothing for an assistant turn with no content yet", () => {
    const { container } = renderMessage(message("assistant", []));
    expect(container.innerHTML).toBe("");
  });

  it("renders a still-streaming child-session call as a plain tool block, not the box", () => {
    // The box get-or-creates the child and drives it with the call's `task`.
    // Mounting it before the input has finished streaming would capture a partial
    // task, so a streaming call must render as an ordinary tool block until the
    // input settles. (Wrapped in a query client so the box, if wrongly mounted,
    // renders rather than throwing — making the regression a clean assertion.)
    const { container } = render(
      <QueryClientProvider client={createQueryClient()}>
        <ChatMessage
          message={message("assistant", [
            {
              type: "tool-investigate",
              toolCallId: "inv1",
              state: "input-streaming",
              input: { task: "best lo" },
            },
          ])}
          busy={false}
          onResubmit={() => {}}
          childSession={{
            toolNames: ["investigate"],
            parentSessionId: "parent",
            onReport: () => {},
          }}
        />
      </QueryClientProvider>,
    );

    expect(container.querySelector('[data-tool="child-session"]')).toBeNull();
    expect(container.querySelector('[data-tool="investigate"]')).not.toBeNull();
  });

  it("edits a user message and resends the new text", async () => {
    const onResubmit = mock((_id: string, _parts: UIMessage["parts"]) => {});
    renderMessage(message("user", [{ type: "text", text: "original" }]), { onResubmit });

    await userEvent.click(editButton());
    const field = editField();
    expect(field?.value).toBe("original");

    await userEvent.clear(field as HTMLTextAreaElement);
    await userEvent.type(field as HTMLTextAreaElement, "edited{Enter}");

    expect(onResubmit.mock.calls).toEqual([["m1", [{ type: "text", text: "edited" }]]]);
  });

  it("preserves image attachments when resending an edited message", async () => {
    const onResubmit = mock((_id: string, _parts: UIMessage["parts"]) => {});
    const image = {
      type: "file" as const,
      mediaType: "image/png",
      filename: "shot.png",
      url: "data:image/png;base64,AA",
    };
    renderMessage(message("user", [image, { type: "text", text: "look" }]), { onResubmit });

    await userEvent.click(editButton());
    // The seeded image previews in the editor.
    expect(screen.getByAltText("shot.png")).toBeDefined();
    await userEvent.clear(editField() as HTMLTextAreaElement);
    await userEvent.type(editField() as HTMLTextAreaElement, "look again{Enter}");

    expect(onResubmit.mock.calls).toEqual([["m1", [image, { type: "text", text: "look again" }]]]);
  });

  it("preserves attached text files when resending an edited message", async () => {
    const onResubmit = mock((_id: string, _parts: UIMessage["parts"]) => {});
    const attached = { type: "text" as const, text: wrapAttachedFile("notes.md", "stuff") };
    renderMessage(message("user", [attached, { type: "text", text: "thoughts?" }]), { onResubmit });

    await userEvent.click(editButton());
    // The seeded file previews in the editor as a chip.
    expect(screen.getByText("notes.md")).toBeDefined();
    await userEvent.clear(editField() as HTMLTextAreaElement);
    await userEvent.type(editField() as HTMLTextAreaElement, "new thoughts{Enter}");

    expect(onResubmit.mock.calls).toEqual([
      ["m1", [attached, { type: "text", text: "new thoughts" }]],
    ]);
  });

  it("cancels editing on Escape without resending", async () => {
    const onResubmit = mock((_id: string, _parts: UIMessage["parts"]) => {});
    renderMessage(message("user", [{ type: "text", text: "original" }]), { onResubmit });

    await userEvent.click(editButton());
    await userEvent.type(editField() as HTMLTextAreaElement, " more{Escape}");

    expect(onResubmit.mock.calls).toHaveLength(0);
    // The editor closes and the original text is shown again.
    expect(editField()).toBeNull();
    expect(screen.getByText("original")).toBeDefined();
  });

  it("does not resend an edit cleared to empty with no attachments", async () => {
    const onResubmit = mock((_id: string, _parts: UIMessage["parts"]) => {});
    renderMessage(message("user", [{ type: "text", text: "original" }]), { onResubmit });

    await userEvent.click(editButton());
    await userEvent.clear(editField() as HTMLTextAreaElement);
    await userEvent.type(editField() as HTMLTextAreaElement, "{Enter}");

    expect(onResubmit.mock.calls).toHaveLength(0);
    // Nothing to send, so the editor stays open.
    expect(editField()).not.toBeNull();
  });

  it("disables the edit control while a turn is in flight", () => {
    renderMessage(message("user", [{ type: "text", text: "x" }]), { busy: true });
    expect((editButton() as HTMLButtonElement).disabled).toBe(true);
  });
});
