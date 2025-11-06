import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enabled strict type checking and linting for production quality
  eslint: {
    ignoreDuringBuilds: false,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  // PRODUCTION OPTIMIZATIONS
  poweredByHeader: false,
  compress: true,
  reactStrictMode: true,
  
  // Performance optimizations
  swcMinify: true, // Use SWC for faster minification
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production' ? {
      exclude: ['error', 'warn'], // Keep error and warn logs
    } : false,
  },
  
  // Image optimization
  images: {
    formats: ['image/webp', 'image/avif'],
    deviceSizes: [640, 750, 828, 1080, 1200],
    imageSizes: [16, 32, 48, 64, 96],
  },
  
  // Output optimization for smaller builds
  output: 'standalone',
  
  // Experimental features for better performance
  experimental: {
    optimizeCss: true,
    optimizePackageImports: ['react-icons', 'lucide-react'],
  },
};

export default nextConfig;
