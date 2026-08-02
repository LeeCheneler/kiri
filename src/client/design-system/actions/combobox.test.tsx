import { describe, expect, it, mock } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Combobox } from "./combobox.tsx";

const OPTIONS = ["alpha", "beta", "gamma", "delta"];

const renderCombobox = (props: Partial<Parameters<typeof Combobox>[0]> = {}) => {
  const onChange = mock((_value: string) => {});
  render(<Combobox label="Fruit" options={OPTIONS} value="alpha" onChange={onChange} {...props} />);
  return { onChange };
};

describe("<Combobox>", () => {
  it("shows the committed value while closed", () => {
    renderCombobox({ value: "gamma" });
    expect((screen.getByRole("combobox", { name: "Fruit" }) as HTMLInputElement).value).toBe(
      "gamma",
    );
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("opens the full list on focus", async () => {
    const user = userEvent.setup();
    renderCombobox();
    await user.click(screen.getByRole("combobox", { name: "Fruit" }));
    expect(screen.getByRole("listbox")).toBeDefined();
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(OPTIONS);
  });

  it("filters the options as you type", async () => {
    const user = userEvent.setup();
    renderCombobox();
    const input = screen.getByRole("combobox", { name: "Fruit" });
    await user.click(input);
    await user.type(input, "l");
    // case-insensitive substring: alpha and delta carry an "l"; beta and gamma don't.
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["alpha", "delta"]);
  });

  it("commits the option clicked", async () => {
    const user = userEvent.setup();
    const { onChange } = renderCombobox();
    const input = screen.getByRole("combobox", { name: "Fruit" });
    await user.click(input);
    await user.click(screen.getByRole("option", { name: "gamma" }));
    expect(onChange.mock.calls).toEqual([["gamma"]]);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("commits the highlighted option on Enter, walking the list with the arrows", async () => {
    const user = userEvent.setup();
    const { onChange } = renderCombobox();
    const input = screen.getByRole("combobox", { name: "Fruit" });
    await user.click(input);
    // alpha (current) is highlighted on open; down twice → gamma, up once → beta.
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowUp}{Enter}");
    expect(onChange.mock.calls).toEqual([["beta"]]);
  });

  it("opens from the keyboard when closed", async () => {
    const user = userEvent.setup();
    renderCombobox();
    const input = screen.getByRole("combobox", { name: "Fruit" });
    input.focus();
    // Focus alone opens it; blur and reopen via ArrowUp to exercise the closed path.
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("listbox")).toBeDefined();
  });

  it("clamps the highlight when the filter shrinks the list", async () => {
    const user = userEvent.setup();
    const { onChange } = renderCombobox();
    const input = screen.getByRole("combobox", { name: "Fruit" });
    await user.click(input);
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}"); // highlight delta (index 3)
    await user.type(input, "be"); // filters to just "beta" — highlight clamps onto it
    await user.keyboard("{Enter}");
    expect(onChange.mock.calls).toEqual([["beta"]]);
  });

  it("shows an empty state and commits nothing when nothing matches", async () => {
    const user = userEvent.setup();
    const { onChange } = renderCombobox();
    const input = screen.getByRole("combobox", { name: "Fruit" });
    await user.click(input);
    await user.type(input, "zzz");
    expect(screen.queryByRole("option")).toBeNull();
    expect(screen.getByText("No matches")).toBeDefined();
    await user.keyboard("{Enter}");
    expect(onChange.mock.calls).toEqual([]);
    expect(screen.getByRole("listbox")).toBeDefined();
  });

  it("Escape closes without changing the value", async () => {
    const user = userEvent.setup();
    const { onChange } = renderCombobox();
    const input = screen.getByRole("combobox", { name: "Fruit" });
    await user.click(input);
    await user.type(input, "ga");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onChange.mock.calls).toEqual([]);
    // reverts to the committed value, not the abandoned query.
    expect((input as HTMLInputElement).value).toBe("alpha");
  });

  it("a click outside closes the list", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <Combobox label="Fruit" options={OPTIONS} value="alpha" onChange={() => {}} />
        <button type="button">elsewhere</button>
      </div>,
    );
    await user.click(screen.getByRole("combobox", { name: "Fruit" }));
    expect(screen.getByRole("listbox")).toBeDefined();
    await user.click(screen.getByRole("button", { name: "elsewhere" }));
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("does nothing on keydown while disabled", async () => {
    const user = userEvent.setup();
    renderCombobox({ disabled: true });
    const input = screen.getByRole("combobox", { name: "Fruit" });
    expect((input as HTMLInputElement).disabled).toBe(true);
    input.focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("opens and commits even when the value is not among the options", async () => {
    const user = userEvent.setup();
    const { onChange } = renderCombobox({ value: "legacy:model" });
    const input = screen.getByRole("combobox", { name: "Fruit" });
    expect((input as HTMLInputElement).value).toBe("legacy:model");
    await user.click(input);
    await user.click(screen.getByRole("option", { name: "alpha" }));
    expect(onChange.mock.calls).toEqual([["alpha"]]);
  });

  it("renders a label associated with the control", () => {
    renderCombobox({ label: "Model" });
    expect(screen.getByRole("combobox", { name: "Model" })).toBeDefined();
  });

  it("renders the bare control without a label", () => {
    render(<Combobox options={OPTIONS} value="alpha" onChange={() => {}} />);
    expect(screen.getByRole("combobox")).toBeDefined();
    expect(screen.queryByText("Fruit")).toBeNull();
  });

  it("wires the description as the field's accessible description", () => {
    renderCombobox({ description: "Pick a fruit." });
    const input = screen.getByRole("combobox", { name: "Fruit" });
    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)?.textContent).toBe("Pick a fruit.");
  });

  it("marks required fields via aria-required", () => {
    renderCombobox({ required: true });
    expect(screen.getByRole("combobox", { name: "Fruit" }).getAttribute("aria-required")).toBe(
      "true",
    );
  });

  describe("with { value, label } options", () => {
    const ITEMS = [
      { value: "granny-smith", label: "Granny Smith" },
      { value: "blood-orange", label: "Blood Orange" },
    ];

    it("shows the selected option's label, not its value, while closed", () => {
      render(<Combobox label="Variety" options={ITEMS} value="blood-orange" onChange={() => {}} />);
      expect((screen.getByRole("combobox", { name: "Variety" }) as HTMLInputElement).value).toBe(
        "Blood Orange",
      );
    });

    it("renders and filters by the labels", async () => {
      const user = userEvent.setup();
      render(<Combobox label="Variety" options={ITEMS} value="blood-orange" onChange={() => {}} />);
      const input = screen.getByRole("combobox", { name: "Variety" });
      await user.click(input);
      expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
        "Granny Smith",
        "Blood Orange",
      ]);
      await user.type(input, "smit");
      expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Granny Smith"]);
    });

    it("commits the chosen option's value, not its label", async () => {
      const user = userEvent.setup();
      const onChange = mock((_value: string) => {});
      render(<Combobox label="Variety" options={ITEMS} value="blood-orange" onChange={onChange} />);
      await user.click(screen.getByRole("combobox", { name: "Variety" }));
      await user.click(screen.getByRole("option", { name: "Granny Smith" }));
      expect(onChange.mock.calls).toEqual([["granny-smith"]]);
    });
  });

  describe("with grouped options", () => {
    const GROUPS = [
      { label: "Pinned", options: [{ value: "beta", label: "pinned — beta" }] },
      { options: ["alpha", "beta", "gamma"] },
    ];

    it("lists every group's options and heads a labelled group", async () => {
      const user = userEvent.setup();
      render(<Combobox label="Fruit" options={GROUPS} value="alpha" onChange={() => {}} />);
      await user.click(screen.getByRole("combobox", { name: "Fruit" }));
      expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
        "pinned — beta",
        "alpha",
        "beta",
        "gamma",
      ]);
      expect(screen.getByText("Pinned")).toBeDefined();
    });

    it("walks the flattened list across groups and commits the chosen value", async () => {
      const user = userEvent.setup();
      const onChange = mock((_value: string) => {});
      render(<Combobox label="Fruit" options={GROUPS} value="beta" onChange={onChange} />);
      await user.click(screen.getByRole("combobox", { name: "Fruit" }));
      // "beta" appears in both groups; the pinned entry (first match) opens
      // highlighted, and one step down lands on the second group's first option.
      await user.keyboard("{ArrowDown}{Enter}");
      expect(onChange.mock.calls).toEqual([["alpha"]]);
    });

    it("hides a group the filter empties, heading and all", async () => {
      const user = userEvent.setup();
      render(<Combobox label="Fruit" options={GROUPS} value="alpha" onChange={() => {}} />);
      const input = screen.getByRole("combobox", { name: "Fruit" });
      await user.click(input);
      await user.type(input, "gam");
      expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["gamma"]);
      expect(screen.queryByText("Pinned")).toBeNull();
    });

    it("shows the first matching option's label for the committed value while closed", () => {
      render(<Combobox label="Fruit" options={GROUPS} value="beta" onChange={() => {}} />);
      expect((screen.getByRole("combobox", { name: "Fruit" }) as HTMLInputElement).value).toBe(
        "pinned — beta",
      );
    });
  });
});
