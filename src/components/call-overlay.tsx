'use client'

// Full-screen P2P call UI: incoming ring, outgoing "calling", and the active
// call with local preview + remote feed. All streams are attached device to
// device via WebRTC — nothing routes through our servers.

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { usePathname } from 'next/navigation'
import { Phone, PhoneOff, Video, VideoOff, Mic, MicOff, MessageCircle, ChevronDown, Maximize2 } from 'lucide-react'
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
  const [controlsVisible, setControlsVisible] = useState(true)
  const [minimized, setMinimized] = useState(false)
  const hideTimer = useRef<number | undefined>(undefined)
  const pathname = usePathname()

  // Auto-hide controls after ~8s of inactivity, like WhatsApp. Reset when a
  // new call becomes active so the controls always start visible.
  useEffect(() => {
    if (status === 'active') { showControls(); resetMinimized() }
  }, [status])

  useEffect(() => () => window.clearTimeout(hideTimer.current), [])

  function showControls() {
    setControlsVisible(true)
    window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => setControlsVisible(false), 8000)
  }

  function resetMinimized() { setMinimized(false) }
  function minimizePip() { setMinimized(true) }

  // Movable double-click-resizable floating call window.
  const [pipPos, setPipPos] = useState<{ x: number; y: number } | null>(null)
  const [pipSizeLevel, setPipSizeLevel] = useState(0)
  const dragRef = useRef<{ dx: number; dy: number } | null>(null)
  const PIP_SCALES = [1, 2, 4]
  const PIP_BASE = { w: 160, h: 104 }
  const pipScale = PIP_SCALES[pipSizeLevel % PIP_SCALES.length]
  const pipW = Math.round(PIP_BASE.w * pipScale)
  const pipH = Math.round(PIP_BASE.h * pipScale)

  // Double-click cycles the size: small -> double -> double again -> back to
  // small (loops). The scale list above makes each step a doubling.
  function stepPipSize() { setPipSizeLevel((l) => (l + 1) % PIP_SCALES.length) }
  function expandPip() { setMinimized(false) }

  function onPipPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    const left = pipPos ? pipPos.x : e.currentTarget.getBoundingClientRect().left
    const top = pipPos ? pipPos.y : e.currentTarget.getBoundingClientRect().top
    dragRef.current = { dx: e.clientX - left, dy: e.clientY - top }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  function onPipPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return
    let x = e.clientX - dragRef.current.dx
    let y = e.clientY - dragRef.current.dy
    x = Math.max(4, Math.min(window.innerWidth - pipW - 4, x))
    y = Math.max(4, Math.min(window.innerHeight - pipH - 4, y))
    setPipPos({ x, y })
  }
  function onPipPointerUp() { dragRef.current = null }

  // When the user navigates away from the call's conversation (e.g. browser
  // back) while in a full-screen call, auto-minimize to the floating window so
  // they can keep roaming the site with the call still running. This only fires
  // on an actual pathname change — not when the user later manually expands the
  // PiP (that must stay maximized).
  const lastPathRef = useRef<string | null>(null)
  useEffect(() => {
    if (lastPathRef.current === pathname) return
    lastPathRef.current = pathname
    if (status !== 'active') return
    if (!conversationId) return
    if (pathname && pathname.startsWith(`/chat/${conversationId}`)) return
    window.setTimeout(minimizePip, 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  // Moving the mouse or touching the screen reveals the controls.
  function wake() {
    if (!controlsVisible) setControlsVisible(true)
    window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => setControlsVisible(false), 8000)
  }

  // Tapping the video background toggles the controls on/off.
  function toggleOnTap() {
    if (controlsVisible) {
      setControlsVisible(false)
      window.clearTimeout(hideTimer.current)
    } else {
      showControls()
    }
  }

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
  }, [status, mode, localStream, minimized])

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
  }, [status, mode, remoteStream, minimized])

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
    const remoteHasVideo = (remoteStream?.getVideoTracks() ?? []).length > 0
    const localHasVideo = (localStream?.getVideoTracks() ?? []).length > 0
    const videoCall = remoteHasVideo || (videoEnabled && localHasVideo)

    // WhatsApp-style minimized floating call window — movable by dragging the
    // video, double-click to cycle size (small -> double -> double -> back to
    // small), and a maximize button for full-screen. The call keeps running
    // (audio element stays mounted) while the user roams the site.
    if (minimized) {
      return (
        <div
          style={pipPos ? { left: pipPos.x, top: pipPos.y, width: pipW, height: pipH } : { width: pipW, height: pipH }}
          className={`fixed z-[60] flex overflow-hidden rounded-2xl border border-white/10 bg-slate-900/95 shadow-2xl ${pipPos ? '' : 'bottom-4 right-4'}`}
        >
          <div
            className="relative h-full flex-1 cursor-move touch-none"
            onPointerDown={onPipPointerDown}
            onPointerMove={onPipPointerMove}
            onPointerUp={onPipPointerUp}
            onDoubleClick={stepPipSize}
          >
            {remoteHasVideo ? (
              <video ref={remoteVideoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-slate-800">
                <span className="text-4xl font-bold text-slate-200">{otherName?.[0]?.toUpperCase() ?? '?'}</span>
              </div>
            )}
            <span className="pointer-events-none absolute bottom-1 left-1 flex items-center rounded bg-black/60 px-1.5 py-0.5 text-white">
              {muted ? <MicOff size={11} /> : <Mic size={11} />}
            </span>
          </div>
          <div className="flex w-14 flex-col items-center justify-center gap-3 bg-slate-900/90 p-1.5">
            <button onClick={expandPip} aria-label="Maximize" title="Maximize"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-700 text-white transition hover:bg-slate-600">
              <Maximize2 size={16} />
            </button>
            <button onClick={onToggleMute} aria-label={muted ? 'Unmute' : 'Mute'} title={muted ? 'Unmute' : 'Mute'}
              className={`flex h-10 w-10 items-center justify-center rounded-full text-white transition hover:bg-slate-600 ${muted ? 'bg-red-500 hover:bg-red-400' : 'bg-slate-700'}`}>
              {muted ? <MicOff size={16} /> : <Mic size={16} />}
            </button>
            <button onClick={onToggleVideo} aria-label="Toggle camera" title="Camera"
              className={`flex h-10 w-10 items-center justify-center rounded-full text-white transition hover:bg-slate-600 ${localHasVideo && videoEnabled ? 'bg-slate-700 hover:bg-slate-600' : 'bg-slate-600/70'}`}>
              {localHasVideo && videoEnabled ? <Video size={16} /> : <VideoOff size={16} />}
            </button>
            <button onClick={onEnd} aria-label="End call" title="End call"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500 text-white transition hover:bg-red-400">
              <PhoneOff size={16} />
            </button>
          </div>
          <audio ref={remoteAudioRef} autoPlay playsInline hidden />
        </div>
      )
    }

    return (
      <div className="fixed inset-0 z-50 flex overflow-hidden bg-slate-950 text-white">
        {/* Call area (shrinks when the chat panel is open on desktop) */}
        <div
          className={`relative flex h-full flex-col overflow-hidden ${showChat ? 'flex-1' : 'w-full'}`}
          onMouseMove={wake}
          onTouchStart={wake}
        >
          {/* Remote video (full screen) or avatar for audio; tap toggles controls */}
          <div className="relative min-h-0 flex-1 cursor-default" onClick={toggleOnTap}>
            {remoteHasVideo ? (
              <video ref={remoteVideoRef} autoPlay playsInline muted={false} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center bg-slate-950">
                <div className="flex flex-col items-center">
                  <div className="flex h-28 w-28 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-violet-500 text-5xl font-bold">
                    {otherName?.[0]?.toUpperCase() ?? '?'}
                  </div>
                  <p className="mt-4 text-lg font-semibold">{otherName}</p>
                  <p className="text-sm text-slate-400">On a {videoCall ? 'video' : 'voice'} call</p>
                </div>
              </div>
            )}

            {/* Local preview (PiP) for video */}
            {videoEnabled && localHasVideo && (
              <div className="absolute right-3 top-3 z-10 h-36 w-24 overflow-hidden rounded-2xl border-2 border-white/20 shadow-lg sm:h-44 sm:w-32">
                <video ref={localVideoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
              </div>
            )}

            {error && (
              <p className="absolute inset-x-0 top-20 z-10 mx-4 rounded-xl bg-red-950/70 px-4 py-2 text-center text-sm text-red-200">{error}</p>
            )}

            {/* Controls overlay — fades out after inactivity, like WhatsApp */}
            <div
              onClick={(e) => e.stopPropagation()}
              onMouseMove={wake}
              className={`absolute inset-x-0 bottom-0 z-20 flex items-center justify-center gap-6 border-t border-white/10 bg-slate-950/80 px-4 py-6 backdrop-blur transition-opacity duration-300 ${
                controlsVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
              }`}
            >
              <ControlButton label={muted ? 'Unmute' : 'Mute'} active={muted} onClick={onToggleMute}>
                {muted ? <MicOff size={24} /> : <Mic size={24} />}
              </ControlButton>
              <ControlButton
                label={localHasVideo && videoEnabled ? 'Turn off camera' : 'Turn on camera'}
                active={localHasVideo && !videoEnabled}
                onClick={onToggleVideo}
              >
                {localHasVideo && videoEnabled ? <Video size={24} /> : <VideoOff size={24} />}
              </ControlButton>
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
                onClick={() => setMinimized(true)}
                aria-label="Minimize call"
                title="Minimize"
                className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-700/70 text-white shadow-lg transition hover:bg-slate-600"
              >
                <ChevronDown size={26} />
              </button>
              <button
                onClick={onEnd}
                aria-label="End call"
                className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500 text-white shadow-lg transition hover:bg-red-400"
              >
                <PhoneOff size={26} />
              </button>
            </div>
          </div>
          <audio ref={remoteAudioRef} autoPlay playsInline hidden />
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
