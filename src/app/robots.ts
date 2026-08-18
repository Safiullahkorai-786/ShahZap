import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/app', '/chat', '/matching', '/friends', '/profile', '/progression', '/rewards', '/premium', '/admin', '/api/'] }],
    sitemap: 'https://shahzap.com/sitemap.xml',
  }
}
