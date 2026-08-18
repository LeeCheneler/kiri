import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { useState } from "react";
import { server } from "../../../../tests/setup/msw.ts";
import { createQueryClient } from "../../state/query-client.ts";
import { TidyDraft } from "./tidy-draft.tsx";
import { useTidyDraft } from "./use-tidy-draft.ts";

const modelsWith = (utility?: string) =>
  http.get("*/api/models", () => HttpResponse.json({ models: [], failures: [], utility }));

// A composer stand-in: the controlled draft the real composer owns, with the
// tidy controls bound to it the way the chat page binds them.
function Harness({ initial = "" }: { initial?: string }) {
  const [draft, setDraft] = useState(initial);
  const state = useTidyDraft({ value: draft, onChange: setDraft });
  return (
    <>
      <textarea aria-label="Draft" value={draft} onChange={(e) => setDraft(e.target.value)} />
      <TidyDraft state={state} empty={draft.trim() === ""} />
    </>
  );
}

const renderHarness = (initial?: string) =>
  render(
    <QueryClientProvider client={createQueryClient()}>
      <Harness initial={initial} />
    </QueryClientProvider>,
  );

const draftBox = () => screen.getByLabelText("Draft") as HTMLTextAreaElement;

describe("<TidyDraft>", () => {
  it("renders nothing when no utility model is configured", async () => {
    server.use(modelsWith(undefined));
    renderHarness("so um postgres");

    // Give the models query a chance to settle before asserting absence.
    await waitFor(() => expect(screen.queryByRole("button", { name: "tidy" })).toBeNull());
    expect(screen.queryByRole("button", { name: "tidy" })).toBeNull();
  });

  it("offers tidy once the listing reports a utility model, disabled on an empty draft", async () => {
    server.use(modelsWith("local:tiny"));
    renderHarness("");

    const button = await screen.findByRole("button", { name: "tidy" });
    expect(button.hasAttribute("disabled")).toBe(true);
  });

  it("replaces the draft with the tidied text and offers undo until the draft is edited", async () => {
    server.use(
      modelsWith("local:tiny"),
      http.post("*/api/tidy", async ({ request }) => {
        const { text } = (await request.json()) as { text: string };
        return HttpResponse.json({ text: text.toUpperCase() });
      }),
    );
    const user = userEvent.setup();
    renderHarness("so um postgres");

    await user.click(await screen.findByRole("button", { name: "tidy" }));

    await waitFor(() => expect(draftBox().value).toBe("SO UM POSTGRES"));
    expect(screen.queryByRole("button", { name: "tidying…" })).toBeNull();
    expect(screen.getByRole("button", { name: "undo tidy" })).toBeDefined();

    await user.type(draftBox(), "!");
    expect(screen.queryByRole("button", { name: "undo tidy" })).toBeNull();

    // Editing back to the tidied text re-offers undo: it's the draft that gates it.
    await user.type(draftBox(), "{backspace}");
    expect(screen.getByRole("button", { name: "undo tidy" })).toBeDefined();
  });

  it("undo restores the pre-tidy draft", async () => {
    server.use(
      modelsWith("local:tiny"),
      http.post("*/api/tidy", () => HttpResponse.json({ text: "Tidied." })),
    );
    const user = userEvent.setup();
    renderHarness("so um postgres");

    await user.click(await screen.findByRole("button", { name: "tidy" }));
    await user.click(await screen.findByRole("button", { name: "undo tidy" }));

    expect(draftBox().value).toBe("so um postgres");
    expect(screen.queryByRole("button", { name: "undo tidy" })).toBeNull();
  });

  it("shows tidying while in flight and drops a result the draft outran", async () => {
    let release: () => void = () => {};
    server.use(
      modelsWith("local:tiny"),
      http.post("*/api/tidy", async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return HttpResponse.json({ text: "Tidied." });
      }),
    );
    const user = userEvent.setup();
    renderHarness("so um postgres");

    await user.click(await screen.findByRole("button", { name: "tidy" }));
    expect(await screen.findByRole("button", { name: "tidying…" })).toBeDefined();

    // Typing while the tidy is in flight — the late result must not clobber it.
    await user.type(draftBox(), " and redis");
    release();

    await waitFor(() => expect(screen.queryByRole("button", { name: "tidying…" })).toBeNull());
    expect(draftBox().value).toBe("so um postgres and redis");
    expect(screen.queryByRole("button", { name: "undo tidy" })).toBeNull();
  });

  it("surfaces a failed tidy inline and clears it on the next attempt", async () => {
    let fail = true;
    server.use(
      modelsWith("local:tiny"),
      http.post("*/api/tidy", () =>
        fail
          ? HttpResponse.json({ error: "no utility model configured" }, { status: 400 })
          : HttpResponse.json({ text: "Tidied." }),
      ),
    );
    const user = userEvent.setup();
    renderHarness("so um postgres");

    await user.click(await screen.findByRole("button", { name: "tidy" }));
    expect((await screen.findByRole("alert")).textContent).toBe("no utility model configured");
    expect(draftBox().value).toBe("so um postgres");

    fail = false;
    await user.click(screen.getByRole("button", { name: "tidy" }));
    await waitFor(() => expect(draftBox().value).toBe("Tidied."));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
