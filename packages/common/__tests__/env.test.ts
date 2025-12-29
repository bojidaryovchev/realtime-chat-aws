import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getEnv, getEnvBoolean, getEnvNumber, requireEnv } from "../src/env.js";

describe("Environment Utilities", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("getEnv", () => {
    it("should return the environment variable value when set", () => {
      process.env.TEST_VAR = "test-value";
      expect(getEnv("TEST_VAR")).toBe("test-value");
    });

    it("should return undefined when not set and no default", () => {
      delete process.env.TEST_VAR;
      expect(getEnv("TEST_VAR")).toBeUndefined();
    });

    it("should return default when not set", () => {
      delete process.env.TEST_VAR;
      expect(getEnv("TEST_VAR", "default")).toBe("default");
    });
  });

  describe("requireEnv", () => {
    it("should return value when set", () => {
      process.env.REQUIRED_VAR = "required-value";
      expect(requireEnv("REQUIRED_VAR")).toBe("required-value");
    });

    it("should throw when not set", () => {
      delete process.env.REQUIRED_VAR;
      expect(() => requireEnv("REQUIRED_VAR")).toThrow("Required environment variable REQUIRED_VAR is not set");
    });

    it("should throw when empty string", () => {
      process.env.REQUIRED_VAR = "";
      expect(() => requireEnv("REQUIRED_VAR")).toThrow("Required environment variable REQUIRED_VAR is not set");
    });
  });

  describe("getEnvNumber", () => {
    it("should parse valid number", () => {
      process.env.NUM_VAR = "42";
      expect(getEnvNumber("NUM_VAR", 0)).toBe(42);
    });

    it("should return default when not set", () => {
      delete process.env.NUM_VAR;
      expect(getEnvNumber("NUM_VAR", 10)).toBe(10);
    });

    it("should return default for invalid number", () => {
      process.env.NUM_VAR = "not-a-number";
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      expect(getEnvNumber("NUM_VAR", 10)).toBe(10);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe("getEnvBoolean", () => {
    it.each(["true", "TRUE", "1", "yes", "YES"])("should return true for '%s'", (value) => {
      process.env.BOOL_VAR = value;
      expect(getEnvBoolean("BOOL_VAR", false)).toBe(true);
    });

    it.each(["false", "0", "no", "anything"])("should return false for '%s'", (value) => {
      process.env.BOOL_VAR = value;
      expect(getEnvBoolean("BOOL_VAR", false)).toBe(false);
    });

    it("should return default when not set", () => {
      delete process.env.BOOL_VAR;
      expect(getEnvBoolean("BOOL_VAR", true)).toBe(true);
      expect(getEnvBoolean("BOOL_VAR", false)).toBe(false);
    });
  });
});
