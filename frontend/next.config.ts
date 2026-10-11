import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    let backendUrl = process.env.BACKEND_URL;
    if (!backendUrl || backendUrl.includes('[SENSITIVE]') || backendUrl.trim() === '') {
      backendUrl = 'https://trivial-footprint-empirical.ngrok-free.dev';
    }
    // Ensure it starts with http:// or https:// to prevent Vercel build error
    if (!backendUrl.startsWith('http://') && !backendUrl.startsWith('https://')) {
      backendUrl = 'https://' + backendUrl;
    }
    // Remove trailing slash if any
    backendUrl = backendUrl.replace(/\/$/, '');
    
    return [
      {
        source: '/api/:path*',
        destination: `${backendUrl}/api/:path*`, // Proxy to Backend
      },
    ]
  },
};

export default nextConfig;
