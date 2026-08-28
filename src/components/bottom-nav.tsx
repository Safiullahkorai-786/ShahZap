'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, Radar, Radio, Users, Settings, UserRound } from 'lucide-react'
import { useUnreadConversations } from '@/hooks/use-unread-conversations'
import { useMatchQueueCount } from '@/hooks/use-match-queue-count'

const TABS = [
  { href: '/app', label: 'Home', icon: Home },
  { href: '/match', label: 'Match', icon: Radar },
  { href: '/online', label: 'Online', icon: Radio },
  { href: '/friends', label: 'Friends', icon: Users, badge: true },
  { href: '/profile', label: 'Profile', icon: UserRound },
  { href: '/settings', label: 'Settings', icon: Settings },
]

export function BottomNav() {
  const pathname = usePathname()
  const unreadConversations = useUnreadConversations()
  const matchQueueCount = useMatchQueueCount()

  // The bar belongs to the logged-in app experience only. Public marketing
  // pages, the start wizard, onboarding, and immersive chats go without it.
  if (
    !pathname ||
    pathname === '/' ||
    pathname === '/start' ||
    pathname.startsWith('/onboarding') ||
    pathname.startsWith('/chat')
  ) {
    return null
  }

  const isActive = (href: string) =>
    href === '/app' ? pathname === '/app' : pathname.startsWith(href)

  return (
    <>
      {/* Reserve space so normal scrolling pages never hide content behind the bar */}
      <div aria-hidden className="h-24" />
      <nav
        aria-label="Primary"
        className="app-chrome app-dock fixed bottom-[calc(env(safe-area-inset-bottom)+14px)] left-1/2 z-40 -translate-x-1/2"
      >
        <div className="flex items-center gap-0.5 px-2 py-1.5">
          {TABS.map(({ href, label, icon: Icon, badge }) => {
            const active = isActive(href)
            const showFriendsBadge = badge && unreadConversations > 0
            const showMatchCount = href === '/match' && matchQueueCount !== null && matchQueueCount > 0
            return (
              <Link
                key={href}
                href={href}
                aria-label={label}
                aria-current={active ? 'page' : undefined}
                className={`relative flex w-[62px] flex-col items-center gap-0.5 rounded-xl py-1.5 text-[8px] font-medium transition ${active ? 'active' : ''}`}
              >
                <span className="relative">
                  <Icon size={21} strokeWidth={active ? 2.4 : 1.9} />
                  {showMatchCount && (
                    <span className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-cyan-400 px-1 text-[7px] font-bold text-slate-950">
                      {matchQueueCount! > 99 ? '99+' : matchQueueCount}
                    </span>
                  )}
                  {showFriendsBadge && (
                    <span className="absolute -right-1.5 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-cyan-400 px-1 text-[7px] font-bold text-slate-950">
                      {unreadConversations > 9 ? '9+' : unreadConversations}
                    </span>
                  )}
                </span>
                <span>{label}</span>
                <span aria-hidden className={`h-0.5 w-7 rounded-full transition-colors ${active ? 'bg-cyan-300' : 'bg-transparent'}`} />
              </Link>
            )
          })}
        </div>
      </nav>
    </>
  )
}
