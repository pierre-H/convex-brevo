import { describe, expect, it } from "vitest";
import { v } from "convex/values";
import { attemptToParse } from "./utils.js";

describe("attemptToParse", () => {
  it("returns success for valid input", () => {
    expect(attemptToParse(v.string(), "ok")).toEqual({
      kind: "success",
      data: "ok",
    });
  });

  it("returns error for invalid input", () => {
    expect(attemptToParse(v.string(), 123).kind).toBe("error");
  });
});
