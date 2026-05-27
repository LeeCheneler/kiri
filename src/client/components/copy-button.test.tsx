import { afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CopyButton } from "./copy-button.tsx";

afterEach(() => {
  cleanup();
});

// userEvent.setup() replaces navigator.clipboard with a get-only stub,
// so any clipboard mock must be installed *after* setup runs. This
// helper bundles the order so each test can swap in its own writeText
// without juggling descriptors.
const setupWithClipboard = (writeText: (text: string) => Promise<void>) => {
  const user = userEvent.setup();
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
    writable: true,
  });
  return user;
};

describe("<CopyButton>", () => {
  it("renders an idle 'copy markdown' button on first mount", () => {
    render(<CopyButton content="hello" />);
    expect(screen.getByRole("button", { name: /^copy markdown$/i })).toBeDefined();
  });

  it("writes the content to the clipboard and shows 'copied' on click", async () => {
    const writeText = mock(async (_text: string) => {});
    const user = setupWithClipboard(writeText);

    render(<CopyButton content={"# Title\n\nBody."} feedbackMs={20} />);

    await user.click(screen.getByRole("button", { name: /^copy markdown$/i }));

    expect(writeText.mock.calls).toEqual([["# Title\n\nBody."]]);
    expect(await screen.findByRole("button", { name: /^copied$/i })).toBeDefined();
  });

  it("reverts the label back to 'copy markdown' once the feedback window elapses", async () => {
    const user = setupWithClipboard(async () => {});
    render(<CopyButton content="hello" feedbackMs={20} />);

    await user.click(screen.getByRole("button", { name: /^copy markdown$/i }));
    expect(await screen.findByRole("button", { name: /^copied$/i })).toBeDefined();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^copy markdown$/i })).toBeDefined();
    });
  });

  it("surfaces an inline error message when the clipboard write rejects", async () => {
    const user = setupWithClipboard(async () => {
      throw new Error("clipboard denied");
    });
    render(<CopyButton content="hello" feedbackMs={20} />);

    await user.click(screen.getByRole("button", { name: /^copy markdown$/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("clipboard denied");
    // Label stays on "copy markdown" so the user can retry immediately.
    expect(screen.getByRole("button", { name: /^copy markdown$/i })).toBeDefined();
  });

  it("stringifies non-Error rejections so the message is still readable", async () => {
    const user = setupWithClipboard(async () => {
      throw "nope";
    });
    render(<CopyButton content="hello" feedbackMs={20} />);

    await user.click(screen.getByRole("button", { name: /^copy markdown$/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("nope");
  });
});
