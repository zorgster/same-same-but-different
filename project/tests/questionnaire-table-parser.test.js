import { describe, it, expect } from "vitest";
import { splitPastedText, parseRows, averageFor } from "../questionnaire-spider/parsers/table-parser";

describe("questionnaire table parser", () => {
  it("parses tab-separated paste with decimal commas", () => {
    const { questions, people } = parseRows(splitPastedText("Name\tQ1\tQ2\nAnn\t4,5\t3\nBob\t2\t"));
    expect(questions).toEqual(["Q1", "Q2"]);
    expect(people[0].values).toEqual([4.5, 3]);
    expect(people[1].values).toEqual([2, null]);
  });

  it("averages ignoring blanks", () => {
    const { people } = parseRows(splitPastedText("N\tQ\nA\t4\nB\t\nC\t3"));
    expect(averageFor(people, 0)).toBe(3.5);
  });

  it("rejects header-only input", () => {
    expect(() => parseRows(splitPastedText("Name\tQ1"))).toThrow();
  });
});
