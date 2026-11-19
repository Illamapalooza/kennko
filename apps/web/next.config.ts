import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The shared packages ship TypeScript source, so Next compiles it with the app.
  transpilePackages: ["@kennko/core", "@kennko/cats"],
};

export default nextConfig;
