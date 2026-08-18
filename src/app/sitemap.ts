import type { MetadataRoute } from 'next'

const publicRoutes = ['', '/random-chat', '/anonymous-chat', '/chat-with-strangers', '/gender-chat', '/country-chat', '/translate-chat', '/meet-new-people', '/how-it-works', '/safety', '/privacy', '/faq', '/about', '/blog']

export default function sitemap(): MetadataRoute.Sitemap {
  const base = 'https://shahzap.com'
  return publicRoutes.map((path) => ({ url: `${base}${path}`, changeFrequency: path === '/blog' ? 'weekly' : 'monthly', priority: path === '' ? 1 : 0.7 }))
}
