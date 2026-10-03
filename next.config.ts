import type { NextConfig } from "next";
const config: NextConfig = {
  productionBrowserSourceMaps: true,
  experimental: { serverSourceMaps: true },
  poweredByHeader: false,
};
export default config;
