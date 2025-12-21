import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  // Path to the Prisma schema file
  schema: "prisma/schema.prisma",

  // Where migrations should be generated and seed script
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },

  // Database connection configuration
  // Uses DATABASE_URL from environment, with fallback for generate command
  datasource: {
    url: process.env.DATABASE_URL || "postgresql://placeholder:placeholder@localhost:5432/placeholder",
  },
});
