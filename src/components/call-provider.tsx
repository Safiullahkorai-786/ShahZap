'use client'

// Global call engine provider. Mounted once in the root layout so inbound
// calls ring on ANY page (not just inside the DM). Exposes the engine via
// context for the chat header buttons and renders the full-screen CallOverlay
// (incoming / outgoing / active) globally.
//
// The engine always listens on the current user's own signaling channel, so a
// call from a friend reaches this user no matter which route they're on.

import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveIdentity, type Identity } from '@/lib/identity'
import { useCallEngine, type CallTarget, type CallMode } from '@/hooks/use-call'
import { CallOverlay } from '@/components/call-overlay'
import { playRing, stopRing } from '@/lib/notification-sound'

type CallApi = {
  status: 'idle' | 'outgoing' | 'incoming' | 'active' | 'ended'
  mode: CallMode
  muted: boolean
  remoteMuted: boolean
  remoteVideoOn: boolean
  videoEnabled: boolean
  error: string
  otherName: string
  coveringChat: boolean
  startCall: (mode: CallMode, target: CallTarget) => void
  acceptCall: () => void
  rejectCall: () => void
  endCall: () => void
  toggleMute: () => void
  toggleVideo: () => void
  sendFileData: (data: string | ArrayBuffer) => boolean
  isDataChannelOpen: () => boolean
  clearError: () => void
}

export const CallContext = createContext<CallApi | null>(null)

// Module-level ref for P2P file transfer data callback.
// Shared between CallProvider (which sets it) and useFileTransfer (which reads it).
let onFileDataRef: ((data: ArrayBuffer | string) => void) | null = null

export function useCall(): CallApi {
  const ctx = useContext(CallContext)
  if (!ctx) {
    throw new Error('useCall must be used within <CallProvider>')
  }
  return ctx
}

export function CallProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [userId, setUserId] = useState<string | null>(null)
  const [otherName, setOtherName] = useState('…')
  const [callMinimized, setCallMinimized] = useState(false)
  const incomingRef = useRef<CallTarget | null>(null)

  useEffect(() => {
    let active = true
    const supabase = createClient()
    void supabase.auth.getUser().then(({ data }) => {
      if (active) setUserId(data.user?.id ?? null)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUserId(session?.user?.id ?? null)
    })
    return () => { active = false; sub.subscription.unsubscribe() }
  }, [])

  const engine = useCallEngine({
    myId: userId,
    ringSound: (kind) => playRing(kind),
    stopRingingSound: () => stopRing(),
    onFileData: (data) => onFileDataRef?.(data),
    onIncoming: (target, _mode) => {
      incomingRef.current = target
    },
    onCallFinish: (info) => {
      // The caller inserts the single call-log row both participants see.
      if (!info.conversationId || !userId) return
      const supabase = createClient()
      void supabase.rpc('insert_call_log', {
        p_conversation_id: info.conversationId,
        p_sender_id: userId,
        p_mode: info.mode,
        p_status: info.callStatus,
        p_duration_seconds: info.durationSeconds,
      }).then(() => {}, () => {})
    },
  })

  // Load the caller's display name so the overlay/banner can show it.
  useEffect(() => {
    const peerId = engine.target?.otherId ?? null
    if (!peerId) return
    let active = true
    const supabase = createClient()
    void supabase.from('profiles')
      .select('display_name,gender,gender_visible')
      .eq('id', peerId)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return
        if (data) {
          const id: Identity = resolveIdentity(data as never)
          setOtherName(id.label)
        } else {
          setOtherName('…')
        }
      })
    return () => { active = false }
  }, [engine.target?.otherId])

  // Clear any pending incoming-call notification for a conversation once the
  // caller answers / declines / ends, so it doesn't linger in the bell.
  function resolveCallNotif() {
    const conv = engine.target?.conversationId
    if (!conv) return
    const supabase = createClient()
    void supabase.rpc('resolve_call_notification', { p_conversation_id: conv })
  }

  const api: CallApi = {
    status: engine.status,
    mode: engine.mode,
    muted: engine.muted,
    remoteMuted: engine.remoteMuted,
    remoteVideoOn: engine.remoteVideoOn,
    videoEnabled: engine.videoEnabled,
    error: engine.error,
    otherName,
    coveringChat: engine.status === 'active' && !callMinimized,
    startCall: (mode, target) => void engine.startCall(mode, target),
    acceptCall: () => void engine.acceptCall(),
    rejectCall: () => void engine.rejectCall(),
    endCall: () => void engine.endCall(),
    toggleMute: () => void engine.toggleMute(),
    toggleVideo: () => void engine.toggleVideo(),
    sendFileData: engine.sendFileData,
    isDataChannelOpen: engine.isDataChannelOpen,
    clearError: () => engine.clearError(),
  }

  return (
    <CallContext.Provider value={api}>
      {children}
      <CallOverlay
        open={engine.status !== 'idle' || !!engine.error}
        status={engine.status}
        mode={engine.mode}
        muted={engine.muted}
        remoteMuted={engine.remoteMuted}
        remoteVideoOn={engine.remoteVideoOn}
        videoEnabled={engine.videoEnabled}
        error={engine.error}
        otherName={otherName}
        conversationId={engine.target?.conversationId}
        localStream={engine.localStream}
        remoteStream={engine.remoteStream}
        onMinimizedChange={setCallMinimized}
        onAccept={() => {
          const t = incomingRef.current
          resolveCallNotif()
          if (t) router.push(`/chat/${t.conversationId}?from=call`)
          api.acceptCall()
        }}
        onReject={() => { resolveCallNotif(); api.rejectCall() }}
        onEnd={() => { resolveCallNotif(); api.endCall() }}
        onToggleMute={() => api.toggleMute()}
        onToggleVideo={() => api.toggleVideo()}
        clearError={() => api.clearError()}
      />
    </CallContext.Provider>
  )
}

/**
 * Hook for P2P file transfer. Registers a callback for incoming DataChannel
 * data and exposes send helpers. Use inside the ChatRoom component.
 */
export function useFileTransfer(onData: (data: ArrayBuffer | string) => void) {
  const ctx = useContext(CallContext)
  useEffect(() => { onFileDataRef = onData; return () => { onFileDataRef = null } }, [onData])
  return {
    sendFileData: ctx?.sendFileData ?? (() => false),
    isDataChannelOpen: ctx?.isDataChannelOpen ?? (() => false),
  }
}
