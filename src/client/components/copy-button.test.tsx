import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CopyButton } from "./copy-button.tsx";

afterEach(() => {
  cleanup();
});

// happy-dom ships a stub `navigator.clipboard.writeText` on the prototype.
// We install a configurable own-property override here so each test can
// swap the implementation in via `clipboard.writeText` without juggling
// property descriptors (and without tripping biome's `no-delete` rule).
const clipboard: { writeText: (text: string) => Promise<void> } = {
  writeText: async () => {},
};
Object.defineProperty(navigator, "clipboard", {
  value: clipboard,
  configurable: true,
  writable: true,
});

beforeEach(() => {
  clipboard.writeText = async () => {};
});

describe("<CopyButton>", () => {
  it("renders an idle 'copy' button on first mount", () => {
    render(<CopyButton content="hello" />);
    expect(screen.getByRole("button", { name: /^copy$/i })).toBeDefined();
  });

  it("writes the content to the clipboard and shows 'copied' on click", async () => {
    const writeText = mock(async (_text: string) => {});
    clipboard.writeText = writeText;

    render(<CopyButton content={"# Title\n\nBody."} feedbackMs={20} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^copy$/i }));
      // Let the writeText promise resolve so the success branch runs.
      await Promise.resolve();
    });

    expect(writeText.mock.calls).toEqual([["# Title\n\nBody."]]);
    expect(screen.getByRole("button", { name: /^copied$/i })).toBeDefined();
  });

  it("reverts the label back to 'copy' once the feedback window elapses", async () => {
    render(<CopyButton content="hello" feedbackMs={20} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^copy$/i }));
      await Promise.resolve();
    });
    expect(screen.getByRole("button", { name: /^copied$/i })).toBeDefined();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^copy$/i })).toBeDefined();
    });
  });

  it("surfaces an inline error message when the clipboard write rejects", async () => {
    clipboard.writeText = async () => {
      throw new Error("clipboard denied");
    };

    render(<CopyButton content="hello" feedbackMs={20} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^copy$/i }));
      await Promise.resolve();
    });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("clipboard denied");
    // Label stays on "copy" so the user can retry immediately.
    expect(screen.getByRole("button", { name: /^copy$/i })).toBeDefined();
  });

  it("stringifies non-Error rejections so the message is still readable", async () => {
    clipboard.writeText = async () => {
      throw "nope";
    };

    render(<CopyButton content="hello" feedbackMs={20} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^copy$/i }));
      await Promise.resolve();
    });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("nope");
  });
});
