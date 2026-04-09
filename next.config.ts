import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: "/test/products", destination: "/investments", permanent: false },
      { source: "/test/products/:id*", destination: "/investments/:id*", permanent: false },
      { source: "/initiatives", destination: "/investments", permanent: false },
      { source: "/initiatives/:path*", destination: "/investments", permanent: false },
      { source: "/api/products", destination: "/api/allocation-entities", permanent: false },
      { source: "/api/products/:path*", destination: "/api/allocation-entities/:path*", permanent: false },
      { source: "/api/test/products-with-budget", destination: "/api/allocation-entities/with-budget", permanent: false },
      { source: "/api/test/products/:id/budget", destination: "/api/allocation-entities/:id/budget", permanent: false },
      { source: "/api/test/resources", destination: "/api/resources", permanent: false },
      {
        source: "/api/test/initiative-allocation-costs",
        destination: "/api/initiative-allocation-costs",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
