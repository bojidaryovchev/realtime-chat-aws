// Re-export Prisma client and types
export { prisma } from "./client.js";
export { PrismaClient, Prisma } from "../prisma/generated/prisma/client.js";
export * from "../prisma/generated/prisma/enums.js";

// Export the type of the instantiated prisma client for proper type inference
import { prisma } from "./client.js";
export type PrismaClientInstance = typeof prisma;
