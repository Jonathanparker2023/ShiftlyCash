import { describe, expect, it } from "vitest";

import { mobileCashflowSizeClass } from "@/lib/dashboard/cellText";

describe("mobileCashflowSizeClass", () => {
  it("leaves short figures at the default size", () => {
    expect(mobileCashflowSizeClass("+42")).toBe("text-xs");
    expect(mobileCashflowSizeClass("-118")).toBe("text-xs");
  });

  it("steps down for a four-figure day", () => {
    // The regression: "+1,432" is 6 characters and used to be elided to dots.
    expect(mobileCashflowSizeClass("1,432")).toBe("text-[11px]");
    expect(mobileCashflowSizeClass("+1,432")).toBe("text-[10px]");
    expect(mobileCashflowSizeClass("-1,432")).toBe("text-[10px]");
  });

  it("steps down again for five figures", () => {
    expect(mobileCashflowSizeClass("+12,345")).toBe("text-[9px]");
    expect(mobileCashflowSizeClass("-12,345")).toBe("text-[9px]");
  });

  it("never returns a class that would clip -- there is no truncate step", () => {
    for (const text of ["", "0", "+1", "-999", "1,000", "+10,000", "-100,000"]) {
      expect(mobileCashflowSizeClass(text)).toMatch(/^text-(xs|\[\d+px\])$/);
    }
  });
});
