'use client'

// Full-screen P2P call UI: incoming ring, outgoing "calling", and the active
// call with local preview + remote feed. All streams are attached device to
// device via WebRTC — nothing routes through our servers.

import { useEffect, useRef } from 'react'
import { Phone, PhoneOff, Video, VideoOff, Mic, MicOff } from 'lucide-react'

type Status = 'idle' | 'outgoing' | 'incoming' | 'active' | 'ended'

export function CallOverlay(props: {
  open: boolean
  status: Status
  mode: 'audio' | 'video'
  muted: boolean
  videoEnabled: boolean
  error: string
  otherName: string
  localStream: React.MutableRefObject<MediaStream | null>
  remoteStream: React.MutableRefObject<MediaStream | null>
  onAccept: () => void
  onReject: () => void
  onEnd: () => void
  onToggleMute: () => void
  onToggleVideo: () => void
}) {
  const {
    open, status, mode, muted, videoEnabled, error, otherName,
    localStream, remoteStream, onAccept, onReject, onEnd, onToggleMute, onToggleVideo,
  } = props

  const localVideoRef = useRef<HTMLVideoElement | null>(null)
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null)
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null)

  // Attach local preview
  useEffect(() => {
    const v = localVideoRef.current
    const s = localStream.current
    if (v && s && v.srcObject !== s) v.srcObject = s
  }, [status, mode, videoEnabled, localStream])

  // Attach remote video/audio
  useEffect(() => {
    const s = remoteStream.current
    if (remoteVideoRef.current && s && remoteVideoRef.current.srcObject !== s) remoteVideoRef.current.srcObject = s
    if (remoteAudioRef.current && s && remoteAudioRef.current.srcObject !== s) remoteAudioRef.current.srcObject = s
  }, [status, remoteStream])

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
    return (
      <div className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-slate-950 text-white">
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
          <button
            onClick={onEnd}
            aria-label="End call"
            className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500 text-white shadow-lg transition hover:bg-red-400"
          >
            <PhoneOff size={26} />
          </button>
        </div>
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
