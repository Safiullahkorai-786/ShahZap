'use client'

import { useState } from 'react'
import OnlineMembers from '@/components/online-members'
import OnlineMessages from '@/components/online-messages'
import type { OnlineMember } from '@/components/online-members'

type Tab = 'online' | 'messages'

function TabButton({ label, active, onClick, badge }: { label: string; active: boolean; onClick: () => void; badge?: number }) {
  return (
    <button onClick={onClick}
      className={`relative flex-1 py-2.5 text-center text-sm font-semibold transition ${active ? 'text-cyan-300' : 'text-slate-500 hover:text-slate-300'}`}>
      <span className="inline-flex items-center gap-1.5">
        {label}
        {!!badge && badge > 0 && (
          <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-cyan-400 px-1 text-[9px] font-bold text-slate-950">
            {badge > 9 ? '9+' : badge}
          </span>
        )}
      </span>
      {active && <span className="absolute bottom-0 left-1/4 right-1/4 h-0.5 rounded-full bg-cyan-400" />}
    </button>
  )
}

export default function OnlineTabs({ members }: { members: OnlineMember[] }) {
  const [tab, setTab] = useState<Tab>('online')
  const [messagesUnread, setMessagesUnread] = useState(0)

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-10 pt-4 lg:max-w-3xl">
      <div className="flex border-b border-slate-800">
        <TabButton label="Online" active={tab === 'online'} onClick={() => setTab('online')} />
        <TabButton label="Messages" active={tab === 'messages'} onClick={() => setTab('messages')} badge={messagesUnread} />
      </div>

      {tab === 'online' && (
        <div className="mt-2">
          <OnlineMembers members={members} />
        </div>
      )}

      <div className={tab === 'messages' ? 'mt-2' : 'hidden'}>
        <p className="px-1 pt-2 text-xs text-slate-500">Chats with people you are not friends with yet.</p>
        <OnlineMessages onUnreadChange={setMessagesUnread} />
      </div>
    </div>
  )
}
