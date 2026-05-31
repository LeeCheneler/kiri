import { describe, expect, it, mock } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InvokeModal } from "./invoke-modal.tsx";

const noop = () => {};
const resolve = async () => {};

describe("<InvokeModal>", () => {
  it("renders a field per declared input", () => {
    render(
      <InvokeModal
        workflowName="pr-review"
        inputs={[
          { name: "pr_number", required: true },
          { name: "depth", options: ["shallow", "deep"] },
        ]}
        onSubmit={resolve}
        onCancel={noop}
      />,
    );
    expect(screen.getByRole("textbox", { name: /pr_number/i })).toBeDefined();
    expect(screen.getByRole("combobox", { name: /depth/i })).toBeDefined();
  });

  it("gates submit until every required input is filled", async () => {
    const user = userEvent.setup();
    render(
      <InvokeModal
        workflowName="pr-review"
        inputs={[{ name: "pr_number", required: true }]}
        onSubmit={resolve}
        onCancel={noop}
      />,
    );
    const submit = screen.getByRole("button", { name: /run →/i });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByRole("textbox", { name: /pr_number/i }), "42");
    expect((submit as HTMLButtonElement).disabled).toBe(false);
  });

  it("forwards the collected values, including defaulted inputs", async () => {
    const user = userEvent.setup();
    const onSubmit = mock(async (_values: Record<string, string>) => {});
    render(
      <InvokeModal
        workflowName="pr-review"
        inputs={[
          { name: "pr_number", required: true },
          { name: "owner", default: "kiri" },
        ]}
        onSubmit={onSubmit}
        onCancel={noop}
      />,
    );
    await user.type(screen.getByRole("textbox", { name: /pr_number/i }), "42");
    await user.click(screen.getByRole("button", { name: /run →/i }));
    expect(onSubmit.mock.calls).toEqual([[{ pr_number: "42", owner: "kiri" }]]);
  });

  it("constrains a picklist input to its options and seeds the first", async () => {
    const user = userEvent.setup();
    const onSubmit = mock(async (_values: Record<string, string>) => {});
    render(
      <InvokeModal
        workflowName="brief"
        inputs={[{ name: "depth", options: ["shallow", "deep"] }]}
        onSubmit={onSubmit}
        onCancel={noop}
      />,
    );
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["shallow", "deep"]);
    await user.click(screen.getByRole("button", { name: /run →/i }));
    expect(onSubmit.mock.calls).toEqual([[{ depth: "shallow" }]]);
  });

  it("forwards a changed picklist value", async () => {
    const user = userEvent.setup();
    const onSubmit = mock(async (_values: Record<string, string>) => {});
    render(
      <InvokeModal
        workflowName="brief"
        inputs={[{ name: "depth", options: ["shallow", "deep"] }]}
        onSubmit={onSubmit}
        onCancel={noop}
      />,
    );
    await user.selectOptions(screen.getByRole("combobox", { name: /depth/i }), "deep");
    await user.click(screen.getByRole("button", { name: /run →/i }));
    expect(onSubmit.mock.calls).toEqual([[{ depth: "deep" }]]);
  });

  it("calls onCancel from the cancel action", async () => {
    const user = userEvent.setup();
    const onCancel = mock(noop);
    render(
      <InvokeModal
        workflowName="brief"
        inputs={[{ name: "topic" }]}
        onSubmit={resolve}
        onCancel={onCancel}
      />,
    );
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("keeps the dialog open and shows the error when the run fails", async () => {
    const user = userEvent.setup();
    const onSubmit = mock(async () => {
      throw new Error("boom");
    });
    render(
      <InvokeModal
        workflowName="brief"
        inputs={[{ name: "topic", default: "chips" }]}
        onSubmit={onSubmit}
        onCancel={noop}
      />,
    );
    await user.click(screen.getByRole("button", { name: /run →/i }));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/boom/);
    });
    expect(screen.getByRole("dialog")).toBeDefined();
  });

  it("pre-fills from initialValues and falls back to declared defaults", async () => {
    const user = userEvent.setup();
    const onSubmit = mock(async (_values: Record<string, string>) => {});
    render(
      <InvokeModal
        workflowName="pr-review"
        inputs={[
          { name: "pr_number", required: true },
          { name: "branch", default: "main" },
        ]}
        initialValues={{ pr_number: "42" }}
        onSubmit={onSubmit}
        onCancel={noop}
      />,
    );
    expect((screen.getByRole("textbox", { name: /pr_number/i }) as HTMLInputElement).value).toBe(
      "42",
    );
    // `branch` isn't in initialValues, so it falls back to its declared default.
    expect((screen.getByRole("textbox", { name: /branch/i }) as HTMLInputElement).value).toBe(
      "main",
    );
    await user.click(screen.getByRole("button", { name: /run →/i }));
    expect(onSubmit.mock.calls).toEqual([[{ pr_number: "42", branch: "main" }]]);
  });

  it("renders a notice above the fields when provided", () => {
    render(
      <InvokeModal
        workflowName="pr-review"
        inputs={[{ name: "topic" }]}
        notice="The previous attempt's steps and traces will be cleared."
        onSubmit={resolve}
        onCancel={noop}
      />,
    );
    expect(screen.getByRole("note").textContent).toMatch(/previous attempt/i);
  });
});
