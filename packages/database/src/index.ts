// Re-export Prisma client and types
export { Prisma, PrismaClient } from "../prisma/generated/prisma/client.js";
export * from "../prisma/generated/prisma/enums.js";
export { prisma } from "./client.js";

// Export the type of the instantiated prisma client for proper type inference
import { prisma } from "./client.js";
export type PrismaClientInstance = typeof prisma;
