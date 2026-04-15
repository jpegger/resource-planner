import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /** Emit `.next/standalone` for slim production Docker images (`Dockerfile`). */
  output: "standalone",
  /** Keep Prisma / adapter on the server runtime (helps Docker + runtime DATABASE_URL). */
  serverExternalPackages: ["@prisma/client", "prisma", "@prisma/adapter-pg"],
};

export default nextConfig;
