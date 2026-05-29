import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { Table } from "./table.tsx";

describe("<Table>", () => {
  it("renders the table with its cells", () => {
    render(
      <Table>
        <thead>
          <tr>
            <th>Step</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>publish</td>
            <td>ok</td>
          </tr>
        </tbody>
      </Table>,
    );
    expect(screen.getByRole("table")).toBeDefined();
    expect(screen.getByText("publish")).toBeDefined();
  });
});
