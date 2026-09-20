import { withPayload } from '@payloadcms/next/withPayload'
import path from 'path'
import { fileURLToPath } from 'url'

const dirname = path.dirname(fileURLToPath(import.meta.url))

const isProd = process.env.NODE_ENV === 'production'

/**
 * Security headers. Payload provides NO global security-header surface — no CSP,
 * no HSTS, no X-Frame-Options. The only header API in the entire 3.x docs is
 * `upload.modifyResponseHeaders`, which covers only the Payload-served media path.
 * These are therefore 100% ours, and are set BOTH here and at the reverse proxy
 * (defence in depth — a misconfigured proxy must not silently remove them).
 *
 * See MASTER-IMPLEMENTATION-PLAN.md §15 row 38 and §29 step 85.
 */
const baseSecurityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
]

// HSTS is only meaningful over TLS, and setting it on http://localhost pins the
// developer's browser to HTTPS for localhost — a genuinely painful mistake.
const hsts = isProd
  ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }]
  : []

/**
 * CSP for the Admin Panel. Payload's admin is a React app that requires
 * 'unsafe-inline' for its styles and 'unsafe-eval' is deliberately NOT granted.
 * `frame-ancestors 'none'` is the modern replacement for X-Frame-Options; both
 * are sent because not every proxy/CDN honours the newer one.
 */
const adminCsp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Required by Payload's own documented production Dockerfile: `next build`
  // emits .next/standalone/server.js, which is what the container runs.
  output: 'standalone',

  // Never leak the framework version in a response header.
  poweredByHeader: false,

  // The backend serves no public imagery of its own; media is served from the
  // CDN origin. Only the Payload-served local-disk dev path is allowed.
  images: {
    localPatterns: [{ pathname: '/payload-api/media/file/**' }],
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [...baseSecurityHeaders, ...hsts],
      },
      {
        source: '/admin/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: adminCsp },
          // The admin panel must never be cached by an intermediary.
          { key: 'Cache-Control', value: 'no-store, max-age=0' },
        ],
      },
      {
        // Payload's generated REST surface is additionally blocked at the edge
        // (D-110). This header is the in-app half of the same defence.
        source: '/payload-api/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Cache-Control', value: 'no-store, max-age=0' },
        ],
      },
    ]
  },

  webpack: (webpackConfig) => {
    webpackConfig.resolve.extensionAlias = {
      '.cjs': ['.cts', '.cjs'],
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    }
    return webpackConfig
  },

  turbopack: {
    root: path.resolve(dirname),
  },
}

export default withPayload(nextConfig, { devBundleServerPackages: false })
