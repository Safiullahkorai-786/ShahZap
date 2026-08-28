'use client'

import { ChevronLeft, Home, Radar, Radio, Users, Settings, Zap, Gift, Crown, UserRound, ShieldCheck } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { NotificationBell } from '@/components/notification-bell'

// Icons are resolved INSIDE this client component by name. Passing actual
// icon components as props breaks whenever a SERVER component renders this
// header ("Functions cannot be passed directly to Client Components").
const ICONS: Record<string, LucideIcon> = {
  home: Home,
  radar: Radar,
  radio: Radio,
  users: Users,
  settings: Settings,
  zap: Zap,
  gift: Gift,
  crown: Crown,
  user: UserRound,
  shield: ShieldCheck,
}

export type AppHeaderIcon = keyof typeof ICONS

export function AppHeader({
  title,
  icon,
  back = '/app',
}: {
  title: string
  icon: AppHeaderIcon
  back?: string
}) {
  const router = useRouter()
  const Icon = ICONS[icon] ?? Radio
  return (
    <header className="app-chrome sticky top-0 z-30 border-b">
      <div className="mx-auto flex max-w-3xl items-center gap-1 px-3 py-2">
        <button
          onClick={() => router.push(back)}
          aria-label="Back"
          className="flex h-8 w-8 flex-none items-center justify-center rounded-full text-slate-300 transition hover:bg-slate-800 hover:text-white"
        >
          <ChevronLeft size={20} />
        </button>
        <span className="flex flex-none items-center text-cyan-300">
          <Icon size={30} strokeWidth={2} />
        </span>
        <h1 className="flex-1 truncate px-0.5 text-lg font-semibold">{title}</h1>
        <NotificationBell />
      </div>
    </header>
  )
}
