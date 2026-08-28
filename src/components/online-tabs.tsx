'use client'

import { useState } from 'react'
import OnlineMembers from '@/components/online-members'
import OnlineMessages from '@/components/online-messages'
import type { OnlineMember } from '@/components/online-members'

type Tab = 'online' | 'messages'

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={`relative flex-1 py-2.5 text-center text-sm font-semibold transition ${active ? 'text-cyan-300' : 'text-slate-500 hover:text-slate-300'}`}>
      {label}
      {active && <span className="absolute bottom-0 left-1/4 right-1/4 h-0.5 rounded-full bg-cyan-400" />}
    </button>
  )
}

export default function OnlineTabs({ members }: { members: OnlineMember[] }) {
  const [tab, setTab] = useState<Tab>('online')

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-10 pt-4 lg:max-w-3xl">
      <div className="flex border-b border-slate-800">
        <TabButton label="Online" active={tab === 'online'} onClick={() => setTab('online')} />
        <TabButton label="Messages" active={tab === 'messages'} onClick={() => setTab('messages')} />
      </div>

      {tab === 'online' ? (
        <OnlineMembers members={members} />
      ) : (
        <div className="mt-2">
          <p className="px-1 pt-2 text-xs text-slate-500">Chats with people you are not friends with yet.</p>
          <OnlineMessages />
        </div>
      )}
    </div>
  )
}
