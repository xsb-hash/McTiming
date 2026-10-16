import type { NextConfig } from "next";
import { parseConfig } from "./src/server/config";

// Fail before building or serving when demo accidentally receives a credential.
parseConfig(process.env);

const nextConfig: NextConfig = {
  poweredByHeader: false,
};

export default nextConfig;
