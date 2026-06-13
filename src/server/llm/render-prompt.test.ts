import { describe, expect, it } from "bun:test";
import { renderPrompt } from "./render-prompt.ts";

describe("renderPrompt", () => {
  it("substitutes a known variable", () => {
    expect(renderPrompt("hello {{NAME}}", { NAME: "Lee" })).toBe("hello Lee");
  });

  it("substitutes placeholders across a multi-line template", () => {
    const template = "Summarise {{KIRI_INPUT}}\n\nRun: {{KIRI_RUN_ID}}\nStep: {{KIRI_STEP_INDEX}}";
    const rendered = renderPrompt(template, {
      KIRI_INPUT: "the thing",
      KIRI_RUN_ID: "run-1",
      KIRI_STEP_INDEX: "0",
    });
    expect(rendered).toBe("Summarise the thing\n\nRun: run-1\nStep: 0");
  });

  it("renders unknown variables as empty", () => {
    expect(renderPrompt("before {{MISSING}} after", {})).toBe("before  after");
  });

  it("substitutes multi-line values", () => {
    expect(renderPrompt("ctx: {{BODY}}", { BODY: "line one\nline two" })).toBe(
      "ctx: line one\nline two",
    );
  });

  it("substitutes adjacent placeholders", () => {
    expect(renderPrompt("{{A}}{{B}}", { A: "1", B: "2" })).toBe("12");
  });

  it("substitutes the same placeholder each time it appears", () => {
    expect(renderPrompt("{{A}} and {{A}}", { A: "x" })).toBe("x and x");
  });

  it("does not re-scan substituted values", () => {
    expect(renderPrompt("{{A}}", { A: "{{B}}", B: "nope" })).toBe("{{B}}");
  });

  it("keeps a self-referential value literal", () => {
    expect(renderPrompt("{{A}}", { A: "{{A}}" })).toBe("{{A}}");
  });

  it("does not form placeholders across a substitution boundary", () => {
    expect(renderPrompt("{{A}}FOO}}", { A: "{{", FOO: "x" })).toBe("{{FOO}}");
  });

  it("matches names starting with an underscore", () => {
    expect(renderPrompt("{{_FOO}}", { _FOO: "x" })).toBe("x");
  });

  it("matches names with digits after the first character", () => {
    expect(renderPrompt("{{FOO9}}", { FOO9: "x" })).toBe("x");
  });

  it("leaves names starting with a digit literal", () => {
    expect(renderPrompt("{{9FOO}}", { "9FOO": "x" })).toBe("{{9FOO}}");
  });

  it("leaves lowercase names literal", () => {
    expect(renderPrompt("{{foo}}", { foo: "x" })).toBe("{{foo}}");
  });

  it("leaves non-ASCII uppercase literal", () => {
    expect(renderPrompt("{{ÄÖÜ}}", { ÄÖÜ: "x" })).toBe("{{ÄÖÜ}}");
  });

  it("leaves names containing spaces literal", () => {
    expect(renderPrompt("{{FOO BAR}}", { "FOO BAR": "x" })).toBe("{{FOO BAR}}");
  });

  it("leaves empty braces literal", () => {
    expect(renderPrompt("{{}}", {})).toBe("{{}}");
  });

  it("leaves unclosed placeholders literal", () => {
    expect(renderPrompt("{{FOO", { FOO: "x" })).toBe("{{FOO");
  });

  it("matches the inner placeholder inside extra braces", () => {
    expect(renderPrompt("{{{FOO}}}", { FOO: "x" })).toBe("{x}");
  });
});
