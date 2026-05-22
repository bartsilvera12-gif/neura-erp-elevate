import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Dominios externos permitidos para next/image.
    // Sin esto el optimizador devuelve 400 a cualquier URL externa,
    // bloqueando las imágenes del bucket público de Supabase Storage.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "api.neura.com.py",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
};

export default nextConfig;
