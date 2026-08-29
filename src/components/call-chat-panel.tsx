'use client'

// Wrapper that embeds the full chat room beside the active call on desktop
// (WhatsApp Web style). The chat page is reused as-is; the voice/video call
// buttons are disabled since a call is already in progress.

import { ChatRoom } from '@/app/chat/[conversationId]/page'

export function CallChatPanel({ conversationId }: {
  conversationId: string
  otherName?: string
  onClose?: () => void
}) {
  return (
    <div className="relative h-full w-full overflow-hidden bg-slate-950">
      <ChatRoom conversationId={conversationId} suppressCalls />
    </div>
  )
}
