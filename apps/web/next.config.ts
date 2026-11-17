import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The shared package ships TypeScript source, so Next compiles it with the app.
  transpilePackages: ["@kennko/core"],
};

export default nextConfig;
