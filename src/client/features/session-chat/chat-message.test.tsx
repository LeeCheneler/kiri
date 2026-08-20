import { describe, expect, it, mock } from "bun:test";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UIMessage } from "ai";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { WikiLinkResolver } from "../../design-system/content/wiki-links.ts";
import { wrapAttachedFile } from "./attachments.ts";
import { ChatMessage, type DeleteMessageHandler, type ResubmitHandler } from "./chat-message.tsx";
import type { ToolDecisionHandler } from "./tool-invocation.tsx";

const message = (role: "user" | "assistant", parts: unknown[]): UIMessage =>
  ({ id: "m1", role, parts }) as UIMessage;

const renderMessage = (
  msg: UIMessage,
  {
    busy = false,
    wikiLinkResolver,
    onResubmit = () => {},
    onDelete = () => {},
    onToolDecision,
  }: {
    busy?: boolean;
    wikiLinkResolver?: WikiLinkResolver;
    onResubmit?: ResubmitHandler;
    onDelete?: DeleteMessageHandler;
    onToolDecision?: ToolDecisionHandler;
  } = {},
) =>
  render(
    // Routed so wiki links (internal hrefs) can render as client-side links.
    <Router hook={memoryLocation({ path: "/" }).hook}>
      <ChatMessage
        message={msg}
        busy={busy}
        wikiLinkResolver={wikiLinkResolver}
        onResubmit={onResubmit}
        onDelete={onDelete}
        onToolDecision={onToolDecision}
      />
    </Router>,
  );

const editField = () =>
  screen.queryByRole("textbox", { name: "Edit message" }) as HTMLTextAreaElement | null;
const editButton = () => screen.getByRole("button", { name: "edit" });
const deleteButton = () => screen.getByRole("button", { name: "delete" });

describe("<ChatMessage>", () => {
  it("renders a woven inbox delivery as the user's interjection inside the assistant turn", () => {
    renderMessage(
      message("assistant", [
        { type: "step-start" },
        { type: "text", text: "Working on it." },
        {
          type: "data-inbox",
          id: "i1",
          data: { source: "user", text: "also check X", queuedAt: 1 },
        },
        { type: "step-start" },
        { type: "text", text: "Checked X too." },
      ]),
    );

    expect(screen.getByText("also check X")).toBeDefined();
    // Labelled as the user speaking, so the transcript still reads as a conversation.
    expect(screen.getByText("You")).toBeDefined();
  });

  it("renders a drained inbox row as an interjection without edit or delete controls", () => {
    renderMessage(
      message("user", [
        {
          type: "data-inbox",
          id: "i1",
          data: { source: "user", text: "queued while idle", queuedAt: 1 },
        },
      ]),
    );

    expect(screen.getByText("queued while idle")).toBeDefined();
    // Not an editable user message: resending it would re-run a conversation
    // it never started.
    expect(screen.queryByRole("button", { name: "edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "delete" })).toBeNull();
  });

  it("renders a delegate call as a plain tool block when no session id is supplied", () => {
    // Without the owning session there is no child lookup — the embedded
    // child-session box needs it, so the call degrades to the ordinary block.
    renderMessage(
      message("assistant", [
        {
          type: "tool-delegate",
          toolCallId: "c1",
          state: "input-available",
          input: { task: "Research pelicans" },
        },
      ]),
    );
    expect(screen.getByText("Delegate")).toBeDefined();
    expect(screen.getByRole("button", { name: /delegate/i })).toBeDefined();
  });

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

  it("links [[slug]] references in assistant prose through the resolver", () => {
    const resolver: WikiLinkResolver = (slug) =>
      slug === "game-engine-choice"
        ? { href: "/projects/p1/articles/game-engine-choice", label: "Game Engine Choice" }
        : null;
    renderMessage(
      message("assistant", [
        { type: "text", text: "This validates [[game-engine-choice]], but [[unknown-doc]] stays." },
      ]),
      { wikiLinkResolver: resolver },
    );

    const link = screen.getByRole("link", { name: "Game Engine Choice" });
    expect(link.getAttribute("href")).toBe("/projects/p1/articles/game-engine-choice");
    // A slug the resolver disowns stays as written.
    expect(screen.getByText(/\[\[unknown-doc\]\] stays/)).toBeDefined();
  });

  it("leaves [[slug]] references literal without a resolver", () => {
    renderMessage(
      message("assistant", [{ type: "text", text: "See [[game-engine-choice]] for the call." }]),
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(/\[\[game-engine-choice\]\]/)).toBeDefined();
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

  it("shows a generated image without expanding anything", () => {
    renderMessage(
      message("assistant", [
        { type: "text", text: "Here you go." },
        {
          type: "tool-generate_image",
          toolCallId: "c1",
          state: "output-available",
          input: { prompt: "a red panda" },
          output: {
            model: "fake:paint",
            mediaType: "image/png",
            image: "data:image/png;base64,AAAA",
          },
        },
      ]),
    );

    const thumb = screen.getByRole("img", { name: "Generated image" }) as HTMLImageElement;
    expect(thumb.src).toBe("data:image/png;base64,AAAA");
  });

  it("folds a run of consecutive tool calls into one chain panel", () => {
    renderMessage(
      message("assistant", [
        { type: "text", text: "Let me dig in." },
        {
          type: "tool-read_file",
          toolCallId: "c1",
          state: "output-available",
          input: { path: "/ws/a.md" },
          output: {},
        },
        { type: "step-start" },
        {
          type: "tool-search",
          toolCallId: "c2",
          state: "output-available",
          input: { query: "kiri" },
          output: {},
        },
        { type: "text", text: "Done." },
      ]),
    );

    expect(screen.getByText("2 tool calls")).toBeDefined();
    // The individual calls sit inside the collapsed panel, not in the transcript.
    expect(screen.queryByText("/ws/a.md")).toBeNull();
    expect(screen.getByText("Let me dig in.")).toBeDefined();
    expect(screen.getByText("Done.")).toBeDefined();
  });

  it("keeps a call awaiting approval out of the fold, its prompt in view", () => {
    renderMessage(
      message("assistant", [
        {
          type: "tool-read_file",
          toolCallId: "c1",
          state: "output-available",
          input: { path: "/ws/a.md" },
          output: {},
        },
        {
          type: "tool-write_file",
          toolCallId: "c2",
          state: "approval-requested",
          input: { path: "/ws/b.md", content: "hi\n" },
          approval: { id: "ap1" },
        },
        {
          type: "tool-read_file",
          toolCallId: "c3",
          state: "output-available",
          input: { path: "/ws/c.md" },
          output: {},
        },
      ]),
      { onToolDecision: () => {} },
    );

    // The prompt needs a verdict, so it renders open rather than folded away —
    // and with no run of consecutive calls left, no chain panel forms.
    expect(screen.getByRole("button", { name: "Allow" })).toBeDefined();
    expect(screen.queryByText(/tool calls/)).toBeNull();
  });

  it("renders nothing for an assistant turn with no content yet", () => {
    const { container } = renderMessage(message("assistant", []));
    expect(container.innerHTML).toBe("");
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

  it("disables the edit and delete controls while a turn is in flight", () => {
    renderMessage(message("user", [{ type: "text", text: "x" }]), { busy: true });
    expect((editButton() as HTMLButtonElement).disabled).toBe(true);
    expect((deleteButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it("deletes a user message once the confirm is accepted", async () => {
    const onDelete = mock((_id: string) => {});
    renderMessage(message("user", [{ type: "text", text: "goodbye" }]), { onDelete });

    await userEvent.click(deleteButton());
    // Nothing happens until the in-app confirm is accepted.
    expect(onDelete.mock.calls).toHaveLength(0);
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /^delete$/i }));

    expect(onDelete.mock.calls).toEqual([["m1"]]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("cancelling the delete confirm leaves the message alone", async () => {
    const onDelete = mock((_id: string) => {});
    renderMessage(message("user", [{ type: "text", text: "keep me" }]), { onDelete });

    await userEvent.click(deleteButton());
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /^cancel$/i }));

    expect(onDelete.mock.calls).toHaveLength(0);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("keep me")).toBeDefined();
  });
});
