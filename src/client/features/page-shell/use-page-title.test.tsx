import { describe, expect, it } from "bun:test";
import { render } from "@testing-library/react";
import { StrictMode } from "react";
import { usePageTitle } from "./use-page-title.ts";

function Page({ title }: { title: string }) {
  usePageTitle(title);
  return null;
}

describe("usePageTitle", () => {
  it.each(["Connect to Kiri", "Kiri"])("replaces the entry title %s", (initialTitle) => {
    document.title = initialTitle;
    const view = render(
      <StrictMode>
        <Page title="Activity" />
      </StrictMode>,
    );

    expect(document.title).toBe("Activity · Kiri");
    view.rerender(
      <StrictMode>
        <Page title="Projects" />
      </StrictMode>,
    );
    expect(document.title).toBe("Projects · Kiri");

    view.unmount();
    expect(document.title).toBe("Kiri");
  });
});
