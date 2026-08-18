import type { Metadata } from 'next'
import { JsonLd } from '@/components/seo/JsonLd'

export const metadata: Metadata = {
  title: { default: 'ShahZap — Anonymous Random Chat With People Worldwide', template: '%s | ShahZap' },
  description: 'Meet someone new through privacy-first random chat, intelligent matching, interests, and automatic translation.',
  alternates: { canonical: '/' },
  openGraph: { title: 'ShahZap — Anonymous Random Chat With People Worldwide', description: 'Meet someone new through privacy-first random chat, intelligent matching, interests, and automatic translation.', url: '/', siteName: 'ShahZap', type: 'website' },
  twitter: { card: 'summary_large_image', title: 'ShahZap — Anonymous Random Chat With People Worldwide', description: 'Meet someone new through privacy-first random chat and meaningful connections.' },
}

export default function PublicLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const website = { '@context': 'https://schema.org', '@type': 'WebSite', name: 'ShahZap', url: 'https://shahzap.com/' }
  const app = { '@context': 'https://schema.org', '@type': 'WebApplication', name: 'ShahZap', applicationCategory: 'SocialNetworkingApplication', operatingSystem: 'Web', url: 'https://shahzap.com/' }
  return <><JsonLd data={website} /><JsonLd data={app} />{children}</>
}
