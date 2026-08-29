'use client'

// Wrapper that embeds the full chat room beside the active call on desktop
// (WhatsApp Web style). The chat page is reused as-is; the voice/video call
// buttons are disabled since a call is already in progress.

import { X } from 'lucide-react'
import { ChatRoom } from '@/app/chat/[conversationId]/page'

export function CallChatPanel({ conversationId, otherName, onClose }: {
  conversationId: string
  otherName: string
  onClose: () => void
}) {
  return (
    <div className="relative h-full w-full overflow-hidden bg-slate-950">
      <ChatRoom conversationId={conversationId} suppressCalls />
      <button
        onClick={onClose}
        aria-label="Close chat"
        title={`Close chat with ${otherName}`}
        className="absolute right-2 top-2 z-40 flex h-9 w-9 items-center justify-center rounded-full bg-slate-900/80 text-slate-300 shadow-lg backdrop-blur transition hover:bg-slate-700 hover:text-white"
      >
        <X size={18} />
      </button>
    </div>
  )
}
