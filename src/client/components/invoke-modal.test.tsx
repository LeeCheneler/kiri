import { afterEach, describe, expect, it, mock } from "bun:test";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { WorkflowInputSummary } from "../api.ts";
import { InvokeModal } from "./invoke-modal.tsx";

afterEach(() => cleanup());

const stubInputs = (overrides: Partial<WorkflowInputSummary>[] = []): WorkflowInputSummary[] => {
  if (overrides.length === 0) return [{ name: "pr_number", required: true }];
  return overrides.map((o) => ({ name: o.name ?? "field", ...o }));
};

const renderModal = (
  props: Partial<{
    workflowName: string;
    inputs: WorkflowInputSummary[];
    initialValues: Record<string, string>;
    notice: string;
    onSubmit: (values: Record<string, string>) => Promise<unknown>;
    onCancel: () => void;
  }> = {},
) => {
  const view = render(
    <InvokeModal
      workflowName={props.workflowName ?? "pr-review"}
      inputs={props.inputs ?? stubInputs()}
      initialValues={props.initialValues}
      notice={props.notice}
      onSubmit={props.onSubmit ?? (() => Promise.resolve({}))}
      onCancel={props.onCancel ?? (() => {})}
    />,
  );
  return { ...view, user: userEvent.setup() };
};

describe("<InvokeModal>", () => {
  describe("structure", () => {
    it("renders as a dialog labelled by its heading", () => {
      renderModal({ workflowName: "pr-review" });
      const dialog = screen.getByRole("dialog");
      const labelledBy = dialog.getAttribute("aria-labelledby");
      expect(labelledBy).not.toBeNull();
      const heading = screen.getByRole("heading", { level: 2 });
      expect(heading.getAttribute("id")).toBe(labelledBy);
      expect(heading.textContent).toMatch(/run pr-review/i);
    });

    it("opens the native dialog as a modal on mount", () => {
      renderModal();
      // showModal() sets the `open` attribute; this is the visible signal
      // that the browser is treating the dialog as modal — inert background,
      // focus trap, Escape-to-cancel — without us hand-rolling any of it.
      expect(screen.getByRole("dialog").hasAttribute("open")).toBe(true);
    });

    it("renders one text field per declared input with the name as its label", () => {
      renderModal({
        inputs: [{ name: "pr_number", required: true }, { name: "owner" }],
      });
      const pr = screen.getByLabelText(/pr_number/i);
      const owner = screen.getByLabelText(/owner/i);
      expect((pr as HTMLInputElement).type).toBe("text");
      expect((owner as HTMLInputElement).type).toBe("text");
    });

    it("renders the description as help text when an input declares one", () => {
      renderModal({
        inputs: [{ name: "pr_number", description: "GitHub PR to review", required: true }],
      });
      expect(screen.getByText(/github pr to review/i)).toBeDefined();
    });

    it("marks required inputs with an accessible indicator", () => {
      renderModal({
        inputs: [{ name: "pr_number", required: true }, { name: "owner" }],
      });
      // aria-required surfaces required state to screen readers; the visible
      // `*` is decorative and labelled "required" for completeness.
      expect(screen.getByLabelText(/pr_number/i).getAttribute("aria-required")).toBe("true");
      expect(screen.getByLabelText(/owner/i).getAttribute("aria-required")).toBeNull();
    });

    it("pre-fills fields with their declared default value", () => {
      renderModal({
        inputs: [
          { name: "branch", default: "main" },
          { name: "owner", default: "kiri" },
        ],
      });
      expect((screen.getByLabelText(/branch/i) as HTMLInputElement).value).toBe("main");
      expect((screen.getByLabelText(/owner/i) as HTMLInputElement).value).toBe("kiri");
    });

    it("leaves fields without a default empty", () => {
      renderModal({ inputs: [{ name: "pr_number", required: true }] });
      expect((screen.getByLabelText(/pr_number/i) as HTMLInputElement).value).toBe("");
    });

    it("uses initialValues to override per-input defaults when supplied", () => {
      renderModal({
        inputs: [
          { name: "pr_number", required: true },
          { name: "branch", default: "main" },
        ],
        initialValues: { pr_number: "42", branch: "release" },
      });
      expect((screen.getByLabelText(/pr_number/i) as HTMLInputElement).value).toBe("42");
      expect((screen.getByLabelText(/branch/i) as HTMLInputElement).value).toBe("release");
    });

    it("falls back to the per-input default for keys missing from initialValues", () => {
      renderModal({
        inputs: [
          { name: "pr_number", required: true },
          { name: "branch", default: "main" },
        ],
        // Only `pr_number` is overridden; `branch` keeps its declared default.
        initialValues: { pr_number: "42" },
      });
      expect((screen.getByLabelText(/pr_number/i) as HTMLInputElement).value).toBe("42");
      expect((screen.getByLabelText(/branch/i) as HTMLInputElement).value).toBe("main");
    });

    it("renders the notice line when supplied", () => {
      renderModal({ notice: "The previous attempt's steps and traces will be cleared." });
      const note = screen.getByRole("note");
      expect(note.textContent).toBe("The previous attempt's steps and traces will be cleared.");
    });

    it("omits the notice line when not supplied", () => {
      renderModal();
      expect(screen.queryByRole("note")).toBeNull();
    });
  });

  describe("focus & dismissal", () => {
    it("auto-focuses the first input on open", () => {
      renderModal({
        inputs: [{ name: "first", required: true }, { name: "second" }],
      });
      expect(document.activeElement).toBe(screen.getByLabelText(/first/i));
    });

    it("routes the native Escape cancel event through onCancel", () => {
      const onCancel = mock(() => {});
      renderModal({ onCancel });
      // Real browsers fire `cancel` on the dialog when the user presses
      // Escape, which we route through onCancel. happy-dom doesn't model
      // that yet, so dispatch the event directly.
      fireEvent(
        screen.getByRole("dialog"),
        new Event("cancel", { bubbles: false, cancelable: true }),
      );
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("calls onCancel when the cancel button is clicked", async () => {
      const onCancel = mock(() => {});
      const { user } = renderModal({ onCancel });
      await user.click(screen.getByRole("button", { name: /cancel/i }));
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("calls onCancel when the user clicks the backdrop outside the dialog card", async () => {
      const onCancel = mock(() => {});
      const { user } = renderModal({ onCancel });
      // Backdrop clicks land on the dialog element itself; userEvent targets
      // the element directly so event.target matches the dialog node.
      await user.click(screen.getByRole("dialog"));
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("does not call onCancel when the click is inside the dialog content", async () => {
      const onCancel = mock(() => {});
      const { user } = renderModal({ onCancel });
      await user.click(screen.getByRole("heading", { level: 2 }));
      expect(onCancel).not.toHaveBeenCalled();
    });
  });

  describe("picklist inputs", () => {
    it("renders a select instead of a text field when options are declared", () => {
      renderModal({
        inputs: [{ name: "env_target", options: ["dev", "staging", "prod"] }],
      });
      const field = screen.getByLabelText(/env_target/i);
      expect(field.tagName).toBe("SELECT");
    });

    it("renders one option per declared value", () => {
      renderModal({
        inputs: [{ name: "env_target", options: ["dev", "staging", "prod"] }],
      });
      const labels = screen
        .getAllByRole("option")
        .map((option) => (option as HTMLOptionElement).value);
      expect(labels).toEqual(["dev", "staging", "prod"]);
    });

    it("pre-selects the declared default when present", () => {
      renderModal({
        inputs: [{ name: "env_target", options: ["dev", "staging", "prod"], default: "staging" }],
      });
      expect((screen.getByLabelText(/env_target/i) as HTMLSelectElement).value).toBe("staging");
    });

    it("pre-selects the first option when no default and no initial value is supplied", () => {
      renderModal({
        inputs: [{ name: "env_target", options: ["dev", "staging", "prod"] }],
      });
      expect((screen.getByLabelText(/env_target/i) as HTMLSelectElement).value).toBe("dev");
    });

    it("uses initialValues to override the declared default on a picklist", () => {
      renderModal({
        inputs: [{ name: "env_target", options: ["dev", "staging", "prod"], default: "staging" }],
        initialValues: { env_target: "prod" },
      });
      expect((screen.getByLabelText(/env_target/i) as HTMLSelectElement).value).toBe("prod");
    });

    it("submits the picklist's selected value", async () => {
      const seen: Record<string, string>[] = [];
      const onSubmit = (values: Record<string, string>) => {
        seen.push(values);
        return Promise.resolve({});
      };
      const { user } = renderModal({
        inputs: [{ name: "env_target", options: ["dev", "staging", "prod"] }],
        onSubmit,
      });

      await user.selectOptions(screen.getByLabelText(/env_target/i), "prod");
      await user.click(screen.getByRole("button", { name: /^run/i }));

      expect(seen).toEqual([{ env_target: "prod" }]);
    });

    it("auto-focuses the picklist when it is the first field", () => {
      renderModal({
        inputs: [{ name: "env_target", options: ["dev", "staging", "prod"] }, { name: "owner" }],
      });
      expect(document.activeElement).toBe(screen.getByLabelText(/env_target/i));
    });
  });

  describe("validation & submit", () => {
    it("disables submit until every required input has a value", async () => {
      const { user } = renderModal({
        inputs: [
          { name: "pr_number", required: true },
          { name: "owner", default: "kiri" },
        ],
      });
      const submit = screen.getByRole("button", { name: /run|running/i });
      expect(submit.hasAttribute("disabled")).toBe(true);

      await user.type(screen.getByLabelText(/pr_number/i), "42");
      expect(submit.hasAttribute("disabled")).toBe(false);
    });

    it("keeps submit enabled when only optional inputs are blank", () => {
      renderModal({
        inputs: [{ name: "owner" }],
      });
      const submit = screen.getByRole("button", { name: /run|running/i });
      expect(submit.hasAttribute("disabled")).toBe(false);
    });

    it("calls onSubmit with the collected values on submit", async () => {
      const seen: Record<string, string>[] = [];
      const onSubmit = (values: Record<string, string>) => {
        seen.push(values);
        return Promise.resolve({});
      };
      const { user } = renderModal({
        inputs: [
          { name: "pr_number", required: true },
          { name: "branch", default: "main" },
        ],
        onSubmit,
      });

      await user.type(screen.getByLabelText(/pr_number/i), "42");
      await user.click(screen.getByRole("button", { name: /^run/i }));

      expect(seen).toEqual([{ pr_number: "42", branch: "main" }]);
    });

    it("shows a running indicator while the submit is in flight", async () => {
      let resolve: ((value: unknown) => void) | undefined;
      const onSubmit = () =>
        new Promise<unknown>((r) => {
          resolve = r;
        });
      const { user } = renderModal({
        inputs: [{ name: "pr_number", required: true }],
        onSubmit,
      });

      await user.type(screen.getByLabelText(/pr_number/i), "42");
      await user.click(screen.getByRole("button", { name: /^run/i }));

      expect(screen.getByRole("button", { name: /running/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /running/i }).hasAttribute("disabled")).toBe(true);

      await act(async () => {
        resolve?.({});
      });
    });

    it("renders the submit error inline near the submit button and stays open", async () => {
      const onSubmit = () => Promise.reject(new Error("workflow not found"));
      const onCancel = mock(() => {});
      const { user } = renderModal({
        inputs: [{ name: "pr_number", required: true }],
        onSubmit,
        onCancel,
      });

      await user.type(screen.getByLabelText(/pr_number/i), "42");
      await user.click(screen.getByRole("button", { name: /^run/i }));

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain("workflow not found");
      // Stays open: cancel was not called and the dialog is still in the DOM.
      expect(onCancel).not.toHaveBeenCalled();
      expect(screen.getByRole("dialog")).toBeDefined();
      // Submit re-enables so the user can retry.
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /^run/i }).hasAttribute("disabled")).toBe(false);
      });
    });

    it("falls back to a generic error message when the rejection is not an Error", async () => {
      const onSubmit = () => Promise.reject("string rejection");
      const { user } = renderModal({
        inputs: [{ name: "pr_number", required: true }],
        onSubmit,
      });

      await user.type(screen.getByLabelText(/pr_number/i), "42");
      await user.click(screen.getByRole("button", { name: /^run/i }));

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toMatch(/trigger failed/i);
    });
  });
});
