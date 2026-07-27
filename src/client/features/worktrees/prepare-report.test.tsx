import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { PrepareReport } from "./prepare-report.tsx";

describe("<PrepareReport>", () => {
  it("tags each step with how it went", () => {
    render(
      <PrepareReport
        report={{
          status: "ok",
          steps: [
            { name: "env: symlink", status: "ok" },
            { name: "install: bun (.)", status: "ok" },
          ],
        }}
      />,
    );
    expect(screen.getByText("env: symlink")).toBeDefined();
    expect(screen.getAllByText("ok")).toHaveLength(2);
  });

  it("shows a failed step's reason and whatever it printed", () => {
    render(
      <PrepareReport
        report={{
          status: "failed",
          steps: [
            { name: "env: copy", status: "ok" },
            {
              name: "postCreate: mise trust",
              status: "failed",
              error: "exited with code 3",
              stdout: "trusting config",
              stderr: "no mise on PATH",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("failed")).toBeDefined();
    expect(screen.getByText("exited with code 3")).toBeDefined();
    expect(screen.getByText("trusting config")).toBeDefined();
    expect(screen.getByText("no mise on PATH")).toBeDefined();
  });
});
