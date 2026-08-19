import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/app', '/chat', '/matching', '/friends', '/profile', '/progression', '/rewards', '/premium', '/admin', '/api/'] }],
    sitemap: `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://shahzap.safiullahkorai.com'}/sitemap.xml`,
  }
}
