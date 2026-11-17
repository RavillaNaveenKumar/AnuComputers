import { describe, expect, it } from "vitest";
import {
  isTabVisible,
  resolveEffectiveFieldCapabilities,
  resolveEffectiveObjectCapabilities,
  resolveFieldCapabilities,
  resolveObjectCapabilities,
} from "./crm-profile-permissions";

describe("resolveFieldCapabilities", () => {
  it("fails closed when no profile field grant exists", () => {
    expect(resolveFieldCapabilities(null)).toEqual({ canRead: false, canEdit: false });
  });

  describe("additive permission-set grants", () => {
    it("adds object grants without removing Profile permissions", () => {
      expect(resolveEffectiveObjectCapabilities(
        { canCreate: false, canRead: true, canEdit: false, canDelete: false, viewAll: false, modifyAll: false },
        [{ canCreate: false, canRead: false, canEdit: false, canDelete: true, viewAll: false, modifyAll: false }],
      )).toEqual({ canCreate: false, canRead: true, canEdit: false, canDelete: true });
    });

    it("adds field access and preserves auto-number read-only behavior", () => {
      expect(resolveEffectiveFieldCapabilities(
        { visible: true, editable: false },
        [{ canRead: false, canEdit: true }],
      )).toEqual({ canRead: true, canEdit: true });
      expect(resolveEffectiveFieldCapabilities(
        null,
        [{ canRead: false, canEdit: true }],
        true,
      )).toEqual({ canRead: true, canEdit: false });
    });

    it("does not allow a permission set to unhide a Profile-hidden tab", () => {
      expect(isTabVisible("HIDDEN", ["DEFAULT_ON"])).toBe(false);
      expect(isTabVisible("DEFAULT_OFF", ["DEFAULT_ON"])).toBe(true);
    });
  });

  describe("resolveObjectCapabilities", () => {
    it("fails closed when no profile object grant exists", () => {
      expect(resolveObjectCapabilities(null)).toEqual({ canCreate: false, canRead: false, canEdit: false, canDelete: false });
    });

    it("applies View All and Modify All as Salesforce-style grants", () => {
      const base = { canCreate: false, canRead: false, canEdit: false, canDelete: false, viewAll: true, modifyAll: false };
      expect(resolveObjectCapabilities(base)).toEqual({ canCreate: false, canRead: true, canEdit: false, canDelete: false });
      expect(resolveObjectCapabilities({ ...base, viewAll: false, modifyAll: true })).toEqual({ canCreate: true, canRead: true, canEdit: true, canDelete: true });
    });
  });

  it("does not allow editing a hidden field", () => {
    expect(resolveFieldCapabilities({ visible: false, editable: true })).toEqual({ canRead: false, canEdit: false });
  });

  it("keeps visible read-only fields readable but not editable", () => {
    expect(resolveFieldCapabilities({ visible: true, editable: false })).toEqual({ canRead: true, canEdit: false });
  });

  it("keeps auto-number fields read-only even when a grant is editable", () => {
    expect(resolveFieldCapabilities({ visible: true, editable: true }, true)).toEqual({ canRead: true, canEdit: false });
  });
});
