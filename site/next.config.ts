import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Firestore's REST serializer identifies Long values by constructor name.
  // Keep its Node dependency graph intact instead of minifying those classes.
  serverExternalPackages: ["@google-cloud/firestore"],
};

export default nextConfig;
