'use client'

// Full-screen P2P call UI: incoming ring, outgoing "calling", and the active
// call with local preview + remote feed. All streams are attached device to
// device via WebRTC — nothing routes through our servers.

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Phone, PhoneOff, Video, VideoOff, Mic, MicOff, MessageCircle, Minimize2, Maximize2, User } from 'lucide-react'
import { CallChatPanel } from '@/components/call-chat-panel'
import { createClient } from '@/lib/supabase/client'

type Status = 'idle' | 'outgoing' | 'incoming' | 'active' | 'ended'

export function CallOverlay(props: {
  open: boolean
  status: Status
  mode: 'audio' | 'video'
  muted: boolean
  remoteMuted: boolean
  remoteVideoOn: boolean
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
  onMinimizedChange: (minimized: boolean) => void
}) {
  const {
    open, status, mode, muted, remoteMuted, remoteVideoOn, videoEnabled, error, otherName,
    localStream, remoteStream, onAccept, onReject, onEnd, onToggleMute, onToggleVideo,
    conversationId, onMinimizedChange,
  } = props

  const [chatOpen, setChatOpen] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [minimized, setMinimized] = useState(false)
  const [unread, setUnread] = useState(0)
  const [callSeconds, setCallSeconds] = useState(0)
  const hideTimer = useRef<number | undefined>(undefined)
  const pathname = usePathname()
  const router = useRouter()

  // Call timer: count up while the call is active, reset when it ends. Use a
  // start timestamp so the displayed duration stays accurate across re-renders.
  const callStartedAt = useRef<number | null>(null)
  useEffect(() => {
    if (status === 'active') {
      if (callStartedAt.current === null) callStartedAt.current = Date.now()
      const id = window.setInterval(() => {
        const base = callStartedAt.current ?? Date.now()
        setCallSeconds(Math.floor((Date.now() - base) / 1000))
      }, 1000)
      return () => window.clearInterval(id)
    }
    callStartedAt.current = null
    setCallSeconds(0)
  }, [status])

  function formatCallTime(total: number) {
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    const s = total % 60
    const mm = String(m).padStart(2, '0')
    const ss = String(s).padStart(2, '0')
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
  }

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

  // Double-click cycles the size: small -> double -> (desktop only) again ->
  // back to small (loops). On mobile the third (quadruple) step makes the PiP
  // too big, so it only cycles between small and double there.
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640
  function stepPipSize() {
    const max = isMobile ? 2 : PIP_SCALES.length
    setPipSizeLevel((l) => (l + 1) % max)
  }
  function expandPip() { setMinimized(false) }

  // Open the full DM page with the person we're calling. The call is minimized
  // to the floating window so you can chat while it keeps running.
  function goToDm() {
    if (!conversationId) return
    setChatOpen(false)
    setMinimized(true)
    router.push(`/chat/${conversationId}`)
  }

  // Chat button in the controls bar: on mobile it opens the full DM page; on
  // desktop (widescreen) it toggles the side chat panel beside the call.
  function onChatClick() {
    if (!conversationId) return
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      goToDm()
    } else {
      setChatOpen((open) => !open)
    }
  }

  // Live unread-message badge for the chat button, so you can see when the
  // person on the call is texting you. Based on the friends-page logic: count
  // inbound messages without read_at, grow (+1) on each new inbound message,
  // and reset to 0 once those messages are actually read.
  const uidRef = useRef<string | null>(null)
  const convRef = useRef<string | undefined>(conversationId)
  convRef.current = conversationId
  useEffect(() => {
    const supabase = createClient()
    let alive = true
    let channel: { unsubscribe: () => void } | null = null

    async function recompute(uid = uidRef.current) {
      if (!uid || alive === false) return
      const conv = convRef.current
      if (!conv) return
      const { count } = await supabase.from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('conversation_id', conv)
        .neq('sender_id', uid)
        .is('read_at', null)
      if (alive) setUnread(count ?? 0)
    }

    async function setup() {
      let uid = uidRef.current
      if (!uid) {
        const { data: us } = await supabase.auth.getUser()
        uid = us?.user?.id ?? null
        uidRef.current = uid
      }
      if (!alive) return
      if (!uid) { setUnread(0); return }
      const conv = convRef.current
      if (!conv) { setUnread(0); return }
      await recompute(uid)

      // Subscribe only after the current user id is known so we never mistake
      // our own outbound messages for unread inbound ones.
      channel = supabase
        .channel('call-chat-unread')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
          const msg = payload.new as { conversation_id: string; sender_id: string; read_at: string | null }
          if (!alive || msg.conversation_id !== convRef.current) return
          if (msg.sender_id === uidRef.current) return
          if (msg.read_at) { void recompute(); return }
          setUnread((c) => Math.min(c + 1, 99))
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, (payload) => {
          const msg = payload.new as { conversation_id: string; sender_id: string; read_at: string | null }
          const old = payload.old as { read_at?: string | null } | null
          if (!alive || msg.conversation_id !== convRef.current) return
          if (msg.sender_id === uidRef.current) return
          // Only reconcile when this message actually got read (read_at set).
          // Ignore incidental delivery-timestamp updates so the badge doesn't
          // flash back to a stale count.
          if (old && !old.read_at && msg.read_at) void recompute()
        })
        .subscribe()
    }

    void setup()
    return () => { alive = false; channel?.unsubscribe() }
  }, [conversationId])

  // A new message has arrived from the person we're on a call with (unread went
  // up) — fade the call controls back in so the user notices the chat is there.
  const prevUnreadRef = useRef(0)
  useEffect(() => {
    if (unread > prevUnreadRef.current) showControls()
    prevUnreadRef.current = unread
  }, [unread])

  // Report whether the call is minimized so the DM/other pages know whether the
  // full-screen call is currently covering the chat (to gate auto read-marking).
  useEffect(() => {
    onMinimizedChange(minimized)
  }, [minimized, onMinimizedChange])

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

  // WhatsApp-style self/remote swap: tapping the small preview card swaps what
  // is shown big (remote) vs. small (self). The small card is also draggable.
  const [previewSwapped, setPreviewSwapped] = useState(false)
  const [prevPos, setPrevPos] = useState<{ x: number; y: number } | null>(null)
  const prevDragRef = useRef<{ dx: number; dy: number } | null>(null)
  const prevW = 96
  const prevH = 136
  function onPrevPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    const left = prevPos ? prevPos.x : e.currentTarget.getBoundingClientRect().left
    const top = prevPos ? prevPos.y : e.currentTarget.getBoundingClientRect().top
    prevDragRef.current = { dx: e.clientX - left, dy: e.clientY - top }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  function onPrevPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!prevDragRef.current) return
    let x = e.clientX - prevDragRef.current.dx
    let y = e.clientY - prevDragRef.current.dy
    x = Math.max(4, Math.min(window.innerWidth - prevW - 4, x))
    y = Math.max(4, Math.min(window.innerHeight - prevH - 4, y))
    setPrevPos({ x, y })
  }
  function onPrevPointerUp() { prevDragRef.current = null }

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
  }, [status, mode, localStream, minimized, previewSwapped])

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
  }, [status, mode, remoteStream, minimized, previewSwapped])

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
    // Only treat the remote as having video if the peer has SIGNALLED their
    // camera is on (remoteVideoOn) AND we actually hold a live (not ended)
    // video track. The explicit signal is authoritative so that when the peer
    // turns their camera off we reliably drop to the avatar even if browser
    // track-removal events (onremovetrack/onended) are flaky.
    const remoteHasVideo = remoteVideoOn && (remoteStream?.getVideoTracks().filter((t) => t.readyState !== 'ended').length ?? 0) > 0
    const localHasVideo = (localStream?.getVideoTracks().filter((t) => t.readyState !== 'ended') ?? []).length > 0
    const selfCamOn = videoEnabled && localHasVideo
    const videoCall = remoteHasVideo || selfCamOn

    // WhatsApp-style swap: previewSwapped exchanges which person is big (main)
    // vs. small (preview). Default: other person big, self small.
    const mainIsSelf = previewSwapped
    const showMainVideo = mainIsSelf ? selfCamOn : remoteHasVideo
    const showPrevVideo = mainIsSelf ? remoteHasVideo : selfCamOn

    // WhatsApp-style minimized floating call window — movable by dragging the
    // video, double-click to cycle size (small -> double -> double -> back to
    // small), and a maximize button for full-screen. The call keeps running
    // (audio element stays mounted) while the user roams the site.
    if (minimized) {
      return (
        <div
          style={pipPos ? { left: pipPos.x, top: pipPos.y, width: pipW, height: pipH } : { width: pipW, height: pipH }}
          className={`fixed z-[60] flex overflow-hidden rounded-2xl border border-white/10 bg-slate-900/95 shadow-2xl ${pipPos ? '' : 'right-4 top-16'}`}
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
            <span className="pointer-events-none absolute bottom-1 left-1 flex items-center gap-1.5 rounded bg-black/60 px-1.5 py-0.5 text-white">
              <span className="text-[11px] font-semibold tabular-nums">{formatCallTime(callSeconds)}</span>
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
        >
          {/* Main content — other person by default, self after tapping the
              preview (WhatsApp-style swap). Tap toggles the controls. */}
          <div className="relative min-h-0 flex-1 cursor-default" onClick={toggleOnTap}>
            {showMainVideo ? (
              <div className="relative h-full w-full">
                <video
                  ref={mainIsSelf ? localVideoRef : remoteVideoRef}
                  autoPlay playsInline muted={mainIsSelf}
                  className="h-full w-full object-cover"
                />
              </div>
            ) : (
              <div className="flex h-full items-center justify-center bg-slate-950">
                <div className="flex flex-col items-center">
                  {/* Active call ring + mic status, themed with the accent */}
                  <div className="relative">
                    <span aria-hidden className={`absolute -inset-2 rounded-full opacity-70 ${(mainIsSelf ? muted : remoteMuted) ? 'bg-red-500/20' : ''}`} style={{ boxShadow: `0 0 0 3px var(--a1, #22d3ee), 0 0 35px var(--a1, #22d3ee)` }} />
                    <div className="flex h-28 w-28 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-violet-500 text-5xl font-bold">
                      {mainIsSelf ? <User size={44} /> : (otherName?.[0]?.toUpperCase() ?? '?')}
                    </div>
                    {(mainIsSelf ? muted : remoteMuted) && (
                      <span className="absolute -bottom-1 -right-1 flex h-9 w-9 items-center justify-center rounded-full bg-red-500 text-white shadow-lg">
                        <MicOff size={18} />
                      </span>
                    )}
                  </div>
                  <p className="mt-5 text-lg font-semibold">{mainIsSelf ? 'You' : otherName}</p>
                  <p className="flex items-center gap-2 text-sm text-slate-400">
                    <span className="h-2 w-2 animate-pulse rounded-full" style={{ background: 'var(--a1, #22d3ee)' }} />
                    {(mainIsSelf ? muted : remoteMuted) ? 'Mic muted' : 'On a ' + (videoCall ? 'video' : 'voice') + ' call'}
                  </p>
                </div>
              </div>
            )}

            {/* Call duration — top center, always visible during an active call */}
            <div className="pointer-events-none absolute left-1/2 top-3 z-20 flex -translate-x-1/2 flex-col items-center gap-1.5">
              <span className="rounded-full bg-black/55 px-3 py-1 text-sm font-semibold tabular-nums text-white backdrop-blur">
                {formatCallTime(callSeconds)}
              </span>
              {videoCall && (mainIsSelf ? muted : remoteMuted) && (
                <span className="flex items-center gap-1.5 rounded-full bg-red-500/90 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur">
                  <MicOff size={13} />
                  {mainIsSelf ? 'Your mic is muted' : 'Mic muted'}
                </span>
              )}
            </div>

            {/* Small preview card — draggable; shows the other person after a
                swap. Tap it to swap who is shown big vs. small. */}
            <div
              onPointerDown={onPrevPointerDown}
              onPointerMove={onPrevPointerMove}
              onPointerUp={onPrevPointerUp}
              onDoubleClick={() => setPreviewSwapped((v) => !v)}
              onClick={(e) => { e.stopPropagation(); setPreviewSwapped((v) => !v) }}
              style={prevPos ? { left: prevPos.x, top: prevPos.y } : undefined}
              className={`absolute right-3 top-3 z-10 h-[136px] w-24 cursor-grab touch-none overflow-hidden rounded-2xl border-2 border-white/20 shadow-lg active:cursor-grabbing ${
                prevPos ? '' : ''
              }`}
            >
              {showPrevVideo ? (
                <video
                  ref={mainIsSelf ? remoteVideoRef : localVideoRef}
                  autoPlay playsInline muted
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-slate-800 px-1.5 py-2">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-violet-500 font-bold text-white">
                    {mainIsSelf ? (otherName?.[0]?.toUpperCase() ?? '?') : <User size={20} />}
                  </div>
                  <span className="max-w-full truncate text-[11px] font-semibold leading-tight text-slate-200">
                    {mainIsSelf ? (otherName || '…') : 'You'}
                  </span>
                  {mainIsSelf ? (
                    remoteMuted && (
                      <span className="flex items-center gap-0.5 text-[10px] text-red-400">
                        <MicOff size={9} /> Mic off
                      </span>
                    )
                  ) : muted ? (
                    <span className="flex items-center gap-0.5 text-[10px] text-red-400">
                      <MicOff size={9} /> Mic off
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-400">On a call</span>
                  )}
                </div>
              )}
            </div>

            {error && (
              <p className="absolute inset-x-0 top-20 z-10 mx-4 rounded-xl bg-red-950/70 px-4 py-2 text-center text-sm text-red-200">{error}</p>
            )}

            {/* Minimize call — top-left corner, always visible */}
            <div className="absolute left-3 top-3 z-20 flex items-center gap-2">
              <button
                onClick={() => setMinimized(true)}
                aria-label="Minimize call"
                title="Minimize"
                className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-800/80 text-white shadow-lg backdrop-blur transition hover:bg-slate-700"
              >
                <Minimize2 size={20} />
              </button>
            </div>

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
                  onClick={onChatClick}
                  aria-label="Open chat"
                  title={`Chat with ${otherName}`}
                  className={`relative flex h-16 w-16 items-center justify-center rounded-full shadow-lg transition ${
                    chatOpen ? 'bg-cyan-500 text-slate-950 hover:bg-cyan-400' : 'bg-slate-700/70 text-white hover:bg-slate-600'
                  }`}
                >
                  <MessageCircle size={26} />
                  {unread > 0 && (
                    <span className="pointer-events-none absolute -right-1 -top-1 flex h-6 min-w-[1.5rem] items-center justify-center rounded-full px-1.5 text-xs font-bold text-slate-950 shadow" style={{ background: 'var(--a1, #e5e7eb)' }}>
                      {unread > 99 ? '99+' : unread}
                    </span>
                  )}
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
          <audio ref={remoteAudioRef} autoPlay playsInline hidden />
        </div>

        {/* Chat panel — WhatsApp Web style, right-hand side, desktop only */}
        {showChat && conversationId && (
          <div className="hidden h-full w-[26rem] shrink-0 lg:block">
            <CallChatPanel conversationId={conversationId} />
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
