import type { NextConfig } from "next";

const API_URL = process.env.BACKEND_URL || "http://pythonwhitelistbot.railway.internal:8080";

const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    return [
      // Proxy all API calls to the Python backend
      { source: "/api/:path*", destination: `${API_URL}/api/:path*` },
      // Proxy auth routes (login, callback, logout)
      { source: "/login", destination: `${API_URL}/login` },
      { source: "/callback", destination: `${API_URL}/callback` },
      { source: "/logout", destination: `${API_URL}/logout` },
      // Proxy whitelist file serving
      { source: "/wl/:path*", destination: `${API_URL}/wl/:path*` },
      // Proxy health check
      { source: "/healthz", destination: `${API_URL}/healthz` },
    ];
  },
};

export default nextConfig;
