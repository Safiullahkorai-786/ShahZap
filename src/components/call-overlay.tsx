'use client'

// Full-screen P2P call UI: incoming ring, outgoing "calling", and the active
// call with local preview + remote feed. All streams are attached device to
// device via WebRTC — nothing routes through our servers.

import { useEffect, useRef, useState } from 'react'
import { Phone, PhoneOff, Video, VideoOff, Mic, MicOff, MessageCircle } from 'lucide-react'
import { CallChatPanel } from '@/components/call-chat-panel'

type Status = 'idle' | 'outgoing' | 'incoming' | 'active' | 'ended'

export function CallOverlay(props: {
  open: boolean
  status: Status
  mode: 'audio' | 'video'
  muted: boolean
  videoEnabled: boolean
  error: string
  otherName: string
  conversationId?: string
  localStream: MediaStream | null
  remoteStream: MediaStream | null
  onAccept: () => void
  onReject: () => void
  onEnd: () => void
  onToggleMute: () => void
  onToggleVideo: () => void
}) {
  const {
    open, status, mode, muted, videoEnabled, error, otherName,
    localStream, remoteStream, onAccept, onReject, onEnd, onToggleMute, onToggleVideo,
    conversationId,
  } = props

  const [chatOpen, setChatOpen] = useState(false)

  const localVideoRef = useRef<HTMLVideoElement | null>(null)
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null)
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null)

  // Attach local preview whenever the local stream (re)appears.
  useEffect(() => {
    const v = localVideoRef.current
    if (!v) return
    if (localStream && v.srcObject !== localStream) v.srcObject = localStream
    else if (!localStream && v.srcObject) { v.pause(); v.srcObject = null }
    // Clear srcObject on unmount so mobile browsers release the capture
    // device even if the call ends by closing/tearing down the overlay.
    return () => { if (v) { v.pause(); v.srcObject = null } }
  }, [status, mode, localStream])

  // Attach remote video/audio whenever the remote stream (re)appears, so a
  // track arriving a beat after the UI is shown still lights up the feed.
  // Release the srcObject when the stream is gone so the indicator clears.
  useEffect(() => {
    const rv = remoteVideoRef.current
    const ra = remoteAudioRef.current
    if (remoteStream) {
      if (rv && rv.srcObject !== remoteStream) rv.srcObject = remoteStream
      if (ra && ra.srcObject !== remoteStream) ra.srcObject = remoteStream
    } else {
      if (rv && rv.srcObject) { rv.pause(); rv.srcObject = null }
      if (ra && ra.srcObject) { ra.pause(); ra.srcObject = null }
    }
    return () => {
      if (rv) { rv.pause(); rv.srcObject = null }
      if (ra) { ra.pause(); ra.srcObject = null }
    }
  }, [status, mode, remoteStream])

  if (!open) return null

  const isVideo = mode === 'video'

  // ── Incoming / outgoing ring screens ──────────────────────────────────
  if (status === 'incoming') {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-950/90 px-6 text-center backdrop-blur">
        <div className="mb-8 flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-violet-500 text-4xl font-bold">
          {otherName?.[0]?.toUpperCase() ?? '?'}
        </div>
        <p className="text-lg font-semibold text-white">{otherName}</p>
        <p className="mt-1 text-sm text-slate-400">{isVideo ? 'Incoming video call…' : 'Incoming audio call…'}</p>
        <div className="mt-10 flex items-center gap-10">
          <button
            onClick={onReject}
            aria-label="Decline call"
            className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500 text-white shadow-lg transition hover:bg-red-400"
          >
            <PhoneOff size={26} />
          </button>
          <button
            onClick={onAccept}
            aria-label="Accept call"
            className="flex h-16 w-16 animate-pulse items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg transition hover:bg-emerald-400"
          >
            <Phone size={26} className="-scale-x-100" />
          </button>
        </div>
      </div>
    )
  }

  if (status === 'outgoing') {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-950/90 px-6 text-center backdrop-blur">
        <div className="mb-8 flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-violet-500 text-4xl font-bold">
          {otherName?.[0]?.toUpperCase() ?? '?'}
        </div>
        <p className="text-lg font-semibold text-white">{otherName}</p>
        <p className="mt-1 flex items-center gap-2 text-sm text-slate-400">
          <span className="h-2 w-2 animate-ping rounded-full bg-cyan-400" />
          {isVideo ? 'Calling…' : 'Calling…'}
        </p>
        <button
          onClick={onEnd}
          aria-label="Cancel call"
          className="mt-10 flex h-16 w-16 items-center justify-center rounded-full bg-red-500 text-white shadow-lg transition hover:bg-red-400"
        >
          <PhoneOff size={26} />
        </button>
      </div>
    )
  }

  // ── Active call ───────────────────────────────────────────────────────
  if (status === 'active') {
    const showChat = chatOpen && !!conversationId
    return (
      <div className="fixed inset-0 z-50 flex overflow-hidden bg-slate-950 text-white">
        {/* Call area (shrinks when the chat panel is open on desktop) */}
        <div className={`relative flex h-full flex-col overflow-hidden ${showChat ? 'flex-1' : 'w-full'}`}>
          {/* Remote video (full screen) or avatar for audio */}
          {isVideo && videoEnabled ? (
            <video ref={remoteVideoRef} autoPlay playsInline muted={false} className="h-full w-full flex-1 object-cover" />
          ) : (
            <div className="flex flex-1 items-center justify-center bg-slate-950">
              <div className="flex flex-col items-center">
                <div className="flex h-28 w-28 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-violet-500 text-5xl font-bold">
                  {otherName?.[0]?.toUpperCase() ?? '?'}
                </div>
                <p className="mt-4 text-lg font-semibold">{otherName}</p>
                <p className="text-sm text-slate-400">On a {isVideo ? 'video' : 'voice'} call</p>
              </div>
            </div>
          )}
          <audio ref={remoteAudioRef} autoPlay playsInline hidden />

          {/* Local preview (PiP) for video */}
          {isVideo && videoEnabled && (
            <div className="absolute right-3 top-3 h-36 w-24 overflow-hidden rounded-2xl border-2 border-white/20 shadow-lg sm:h-44 sm:w-32">
              <video ref={localVideoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
            </div>
          )}

          {error && (
            <p className="absolute inset-x-0 top-20 z-10 mx-4 rounded-xl bg-red-950/70 px-4 py-2 text-center text-sm text-red-200">{error}</p>
          )}

          {/* Controls */}
          <div className="z-10 flex items-center justify-center gap-6 border-t border-white/10 bg-slate-950/80 px-4 py-6 backdrop-blur">
            <ControlButton label={muted ? 'Unmute' : 'Mute'} active={muted} onClick={onToggleMute}>
              {muted ? <MicOff size={24} /> : <Mic size={24} />}
            </ControlButton>
            {isVideo && (
              <ControlButton label={videoEnabled ? 'Turn off camera' : 'Turn on camera'} active={!videoEnabled} onClick={onToggleVideo}>
                {videoEnabled ? <Video size={24} /> : <VideoOff size={24} />}
              </ControlButton>
            )}
            {conversationId && (
              <button
                onClick={() => setChatOpen((open) => !open)}
                aria-label="Open chat"
                title={`Chat with ${otherName}`}
                className={`hidden h-16 w-16 items-center justify-center rounded-full shadow-lg transition lg:flex ${
                  showChat ? 'bg-cyan-500 text-slate-950 hover:bg-cyan-400' : 'bg-slate-700/70 text-white hover:bg-slate-600'
                }`}
              >
                <MessageCircle size={26} />
              </button>
            )}
            <button
              onClick={onEnd}
              aria-label="End call"
              className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500 text-white shadow-lg transition hover:bg-red-400"
            >
              <PhoneOff size={26} />
            </button>
          </div>
        </div>

        {/* Chat panel — WhatsApp Web style, right-hand side, desktop only */}
        {showChat && conversationId && (
          <div className="hidden h-full w-[26rem] shrink-0 lg:block">
            <CallChatPanel conversationId={conversationId} otherName={otherName} onClose={() => setChatOpen(false)} />
          </div>
        )}
      </div>
    )
  }

  // Silent error banner while idle (e.g. permission denied)
  if (error) {
    return (
      <div className="fixed inset-x-0 top-20 z-50 mx-auto max-w-sm rounded-xl bg-red-950/80 px-4 py-3 text-center text-sm text-red-200 shadow-2xl">
        {error}
      </div>
    )
  }

  return null
}

function ControlButton({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex h-14 w-14 items-center justify-center rounded-full transition ${active ? 'bg-red-500 text-white hover:bg-red-400' : 'bg-white/10 text-white hover:bg-white/20'}`}
    >
      {children}
    </button>
  )
}
