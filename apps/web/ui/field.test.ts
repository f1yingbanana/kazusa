// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { TextField } from "./field";

afterEach(cleanup);

describe("TextField", () => {
  it("names its input, and says what it's for", () => {
    render(
      createElement(TextField, {
        label: "Id",
        value: "aoba-utsumi",
        readOnly: true,
        description: "Links use it.",
      }),
    );
    const input = screen.getByRole("textbox", { name: "Id" });
    expect(input.getAttribute("aria-invalid")).toBeNull();
    expect(screen.getByText("Links use it.")).toBeTruthy();
  });

  it("shows what's wrong in place of the description", () => {
    render(
      createElement(TextField, {
        label: "Id",
        value: "Aoba",
        readOnly: true,
        description: "Links use it.",
        error: "Use lowercase a–z.",
      }),
    );
    const input = screen.getByRole("textbox", { name: "Id" });
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Use lowercase a–z.")).toBeTruthy();
    expect(screen.queryByText("Links use it.")).toBeNull();
  });
});
