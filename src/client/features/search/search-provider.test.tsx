import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { createQueryClient } from "../../state/query-client.ts";
import { SearchProvider, useSearchOverlay } from "./search-provider.tsx";
import { SearchTrigger } from "./search-trigger.tsx";

const renderProvider = (children: React.ReactNode = <SearchTrigger />) => {
  const { hook } = memoryLocation({ path: "/" });
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <Router hook={hook}>
        <SearchProvider>{children}</SearchProvider>
      </Router>
    </QueryClientProvider>,
  );
};

const overlay = () => screen.queryByRole("dialog");

describe("<SearchProvider>", () => {
  it("opens the overlay from the trigger", async () => {
    renderProvider();
    expect(overlay()).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /search/i }));
    expect(overlay()).not.toBeNull();
    expect(screen.getByRole("textbox", { name: "Search" })).toBeDefined();
  });

  it("toggles the overlay with the keyboard shortcut, either modifier", async () => {
    renderProvider(<p>page content</p>);

    await userEvent.keyboard("{Meta>}k{/Meta}");
    expect(overlay()).not.toBeNull();

    await userEvent.keyboard("{Meta>}k{/Meta}");
    expect(overlay()).toBeNull();

    await userEvent.keyboard("{Control>}k{/Control}");
    expect(overlay()).not.toBeNull();
  });

  it("closes the overlay when it cancels (Escape)", async () => {
    renderProvider();
    await userEvent.keyboard("{Meta>}k{/Meta}");
    const dialog = overlay() as HTMLElement;

    // happy-dom doesn't model Escape firing the dialog's `cancel` event, so
    // dispatch it directly — the same seam the Modal tests use.
    dialog.dispatchEvent(new Event("cancel", { bubbles: false, cancelable: true }));
    expect(overlay()).toBeNull();
  });

  it("throws when useSearchOverlay is used outside the provider", () => {
    const Naked = () => {
      useSearchOverlay();
      return null;
    };
    expect(() => render(<Naked />)).toThrow(/inside <SearchProvider>/);
  });
});
