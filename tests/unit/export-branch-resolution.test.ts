import { describe, expect, it } from "vitest";

import {
  resolveDefaultBranch,
  getBranchRef,
} from "@/features/projects/inngest/export-to-github";

describe("Export to GitHub - Branch Resolution", () => {
  describe("resolveDefaultBranch", () => {
    it("returns 'main' when branch is undefined or null", () => {
      expect(resolveDefaultBranch(undefined)).toBe("main");
      expect(resolveDefaultBranch(null)).toBe("main");
    });

    it("returns 'main' when branch is empty string or only whitespace", () => {
      expect(resolveDefaultBranch("")).toBe("main");
      expect(resolveDefaultBranch("   ")).toBe("main");
    });

    it("returns the exact branch name when provided", () => {
      expect(resolveDefaultBranch("main")).toBe("main");
      expect(resolveDefaultBranch("master")).toBe("master");
      expect(resolveDefaultBranch("develop")).toBe("develop");
      expect(resolveDefaultBranch("trunk")).toBe("trunk");
    });

    it("trims whitespace from branch name", () => {
      expect(resolveDefaultBranch("  master  ")).toBe("master");
      expect(resolveDefaultBranch(" release/v1.0 ")).toBe("release/v1.0");
    });
  });

  describe("getBranchRef", () => {
    it("formats a plain branch name into a heads/ ref", () => {
      expect(getBranchRef("main")).toBe("heads/main");
      expect(getBranchRef("master")).toBe("heads/master");
      expect(getBranchRef("develop")).toBe("heads/develop");
    });

    it("strips heads/ if already present to avoid duplication", () => {
      expect(getBranchRef("heads/main")).toBe("heads/main");
      expect(getBranchRef("heads/master")).toBe("heads/master");
    });

    it("strips refs/heads/ if full ref is passed", () => {
      expect(getBranchRef("refs/heads/main")).toBe("heads/main");
      expect(getBranchRef("refs/heads/trunk")).toBe("heads/trunk");
    });
  });
});
