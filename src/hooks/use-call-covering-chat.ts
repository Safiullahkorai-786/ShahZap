'use client'
import { useContext } from 'react'
import { CallContext } from '@/components/call-provider'

/** Returns true when the call overlay is covering the chat (active, not minimized). */
export function useCallCoveringChat() {
  const ctx = useContext(CallContext)
  return ctx?.coveringChat ?? false
}
