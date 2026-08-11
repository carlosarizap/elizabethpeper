import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Selenium incluye Selenium Manager como ejecutable nativo. Mantener el
  // paquete fuera del bundle de Next conserva la ruta a ese binario.
  serverExternalPackages: ['selenium-webdriver'],
  eslint: {
    ignoreDuringBuilds: true,
  },
}

export default nextConfig
