import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAuth0Config } from "../src/server.js";

describe("Auth0 Configuration", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("getAuth0Config", () => {
    it("should return config when both env vars are set", () => {
      process.env.AUTH0_DOMAIN = "test.auth0.com";
      process.env.AUTH0_AUDIENCE = "https://api.test.com";

      const config = getAuth0Config();

      expect(config).toEqual({
        domain: "test.auth0.com",
        audience: "https://api.test.com",
      });
    });

    it("should throw error when AUTH0_DOMAIN is not set", () => {
      delete process.env.AUTH0_DOMAIN;
      process.env.AUTH0_AUDIENCE = "https://api.test.com";

      expect(() => getAuth0Config()).toThrow("AUTH0_DOMAIN environment variable is not set");
    });

    it("should throw error when AUTH0_AUDIENCE is not set", () => {
      process.env.AUTH0_DOMAIN = "test.auth0.com";
      delete process.env.AUTH0_AUDIENCE;

      expect(() => getAuth0Config()).toThrow("AUTH0_AUDIENCE environment variable is not set");
    });

    it("should throw error when both env vars are not set", () => {
      delete process.env.AUTH0_DOMAIN;
      delete process.env.AUTH0_AUDIENCE;

      expect(() => getAuth0Config()).toThrow("AUTH0_DOMAIN environment variable is not set");
    });
  });
});
