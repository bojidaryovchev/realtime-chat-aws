/**
 * Environment variable helpers with type safety.
 */

/**
 * Get an environment variable with optional default.
 */
export function getEnv(key: string, defaultValue?: string): string | undefined {
  return process.env[key] ?? defaultValue;
}

/**
 * Get a required environment variable. Throws if not set.
 */
export function requireEnv(key: string): string {
  const value = process.env[key];
  if (value === undefined || value === "") {
    throw new Error(`Required environment variable ${key} is not set`);
  }
  return value;
}

/**
 * Get an environment variable as a number.
 */
export function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (value === undefined || value === "") {
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    console.warn(`Environment variable ${key}="${value}" is not a valid number, using default: ${defaultValue}`);
    return defaultValue;
  }
  return parsed;
}

/**
 * Get an environment variable as a boolean.
 * Treats "true", "1", "yes" as true (case-insensitive).
 */
export function getEnvBoolean(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (value === undefined || value === "") {
    return defaultValue;
  }
  return ["true", "1", "yes"].includes(value.toLowerCase());
}
