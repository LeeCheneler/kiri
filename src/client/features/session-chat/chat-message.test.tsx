import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import type { UIMessage } from "ai";
import { ChatMessage } from "./chat-message.tsx";

const message = (role: "user" | "assistant", parts: unknown[]): UIMessage =>
  ({ id: "m1", role, parts }) as UIMessage;

describe("<ChatMessage>", () => {
  it("renders a user message verbatim with its image attachments", () => {
    render(
      <ChatMessage
        message={message("user", [
          {
            type: "file",
            mediaType: "image/png",
            filename: "shot.png",
            url: "data:image/png;base64,AA",
          },
          { type: "text", text: "look at this" },
        ])}
      />,
    );

    expect(screen.getByText("You")).toBeDefined();
    expect(screen.getByText("look at this")).toBeDefined();
    expect(screen.getByAltText("shot.png")).toBeDefined();
  });

  it("renders assistant prose as markdown", () => {
    render(<ChatMessage message={message("assistant", [{ type: "text", text: "Hello there" }])} />);
    expect(screen.getByText("Assistant")).toBeDefined();
    expect(screen.getByText("Hello there")).toBeDefined();
  });

  it("interleaves tool calls with the assistant's prose, in order", () => {
    render(
      <ChatMessage
        message={message("assistant", [
          // A step boundary and an empty text part both render nothing, sat
          // between the parts that do.
          { type: "step-start" },
          { type: "text", text: "Let me search." },
          {
            type: "tool-web_search",
            toolCallId: "c1",
            state: "output-available",
            input: { query: "kiri release" },
            output: { results: [] },
          },
          { type: "text", text: "" },
          { type: "text", text: "Here is what I found." },
        ])}
      />,
    );

    expect(screen.getByText("Let me search.")).toBeDefined();
    expect(screen.getByText("Here is what I found.")).toBeDefined();
    // The tool block renders between the two prose parts.
    expect(screen.getByText("Web search")).toBeDefined();
    expect(screen.getByText("kiri release")).toBeDefined();
  });

  it("renders nothing for an assistant turn with no content yet", () => {
    const { container } = render(<ChatMessage message={message("assistant", [])} />);
    expect(container.innerHTML).toBe("");
  });
});
