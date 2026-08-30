'use client'

// Global WebRTC P2P call engine.
//
// Unlike a per-conversation hook, this engine always listens on the current
// user's OWN signaling channel (`call:user:<myId>`) so an inbound call is
// received on ANY page — not just inside the DM. Once a target (peer) is set,
// the engine also subscribes to the peer's channel (`call:user:<otherId>`),
// and all signaling for that call is exchanged on the peer's channel. This
// lets a caller (who is in the chat) and a callee (who may be anywhere on the
// app, or an OS push that routed them back) rendezvous even when the callee
// was never on the DM page.
//
// Media correctness: remote/local streams are surfaced via React STATE, not
// refs. Each new inbound track replaces the stream object reference (copying
// prior tracks) so the media <video>/<audio> elements re-attach `srcObject`
// and never show a stale "black" feed even when the peer's camera/audio
// arrives a moment after the call overlay appears.

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { CallMode, CallStatus, SignalMessage } from '@/lib/call'
import { ICE_SERVERS, RING_MS, CALL_TIMEOUT_MS } from '@/lib/call'
import type { RingKind } from '@/lib/notification-sound'

export type { CallMode }

export type CallTarget = { conversationId: string; otherId: string }

const SESSION_TOKEN = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

type ChannelLike = ReturnType<ReturnType<typeof createClient>['channel']>

export function useCallEngine(opts: {
  myId: string | null
  ringSound?: (kind: RingKind) => void
  stopRingingSound?: () => void
  onIncoming?: (target: CallTarget, mode: CallMode) => void
  onCallFinish?: (info: {
    conversationId: string
    otherId: string
    mode: CallMode
    callStatus: 'answered' | 'missed' | 'outgoing_unanswered'
    durationSeconds: number
  }) => void
}) {
  const { myId, ringSound, stopRingingSound, onIncoming, onCallFinish } = opts

  const [status, setStatus] = useState<CallStatus>('idle')
  const [mode, setMode] = useState<CallMode>('audio')
  const [muted, setMuted] = useState(false)
  const [remoteMuted, setRemoteMuted] = useState(false)
  const [remoteVideoOn, setRemoteVideoOn] = useState(false)
  const [videoEnabled, setVideoEnabled] = useState(true)
  const [error, setError] = useState('')
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [target, setTarget] = useState<CallTarget | null>(null)

  const pcRef = useRef<RTCPeerConnection | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const inChRef = useRef<ChannelLike | null>(null)
  const outChRef = useRef<ChannelLike | null>(null)
  const outTopicRef = useRef<string | null>(null)
  const outReadyRef = useRef(false)
  const pendingOutRef = useRef<SignalMessage[]>([])
  const tokenRef = useRef<string | null>(null)
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([])
  const pendingOfferRef = useRef<RTCSessionDescriptionInit | null>(null)
  const statusRef = useRef<CallStatus>('idle')
  const ringTimerRef = useRef<number | undefined>(undefined)
  const myIdRef = useRef<string | null>(null)
  useEffect(() => { myIdRef.current = myId }, [myId])
  const targetRef = useRef<CallTarget | null>(null)

  // Call-log bookkeeping: whether WE placed the call (the caller inserts the
  // single log row both sides see), when it went active, and whether either
  // side ever had video on (audio calls that were upgraded count as video).
  const wasCallerRef = useRef(false)
  const didStartIncomingRef = useRef(false)
  const callActiveStartRef = useRef<number | null>(null)
  const callSawVideoRef = useRef(false)
  const didReachActiveRef = useRef(false)

  function updateStatus(s: CallStatus) {
    statusRef.current = s
    setStatus(s)
    if (s === 'active') {
      didReachActiveRef.current = true
      if (callActiveStartRef.current === null) callActiveStartRef.current = Date.now()
    }
  }
  function playRing(kind: RingKind) { try { ringSound?.(kind) } catch {} }
  function stopRing() { try { stopRingingSound?.() } catch {} }

  // Fire the call-log callback once per finished call, on the caller side only.
  function emitCallFinish() {
    const target = targetRef.current
    const myId = myIdRef.current
    const cb = onCallFinish
    if (!wasCallerRef.current || !cb || !target || !target.conversationId || !myId) return
    const duration = callActiveStartRef.current
      ? Math.max(0, Math.floor((Date.now() - callActiveStartRef.current) / 1000))
      : 0
    const callStatus: 'answered' | 'missed' | 'outgoing_unanswered' =
      didReachActiveRef.current ? 'answered'
      : (statusRef.current === 'incoming' || didStartIncomingRef.current) ? 'missed'
      : 'outgoing_unanswered'
    const mode: CallMode = callSawVideoRef.current ? 'video' : 'audio'
    cb({ conversationId: target.conversationId, otherId: target.otherId, mode, callStatus, durationSeconds: duration })
  }

  function resetCallLogRefs() {
    wasCallerRef.current = false
    didStartIncomingRef.current = false
    didReachActiveRef.current = false
    callActiveStartRef.current = null
    callSawVideoRef.current = false
  }

  // Realtime broadcast handler, shared by our inbound channel and any outbound
  // peer channel. Uses refs + functional setters so stale closures are safe.
  function handler({ payload }: { payload: unknown }) {
    const sig = payload as SignalMessage & { from?: string }
    if (!sig.from || sig.from === myIdRef.current) return

    switch (sig.type) {
      case 'call': {
        if (!sig.token) return
        if (statusRef.current !== 'idle') {
          // Busy: reject on the caller's channel so they stop ringing right away.
          ensureOutbound({ conversationId: '', otherId: sig.from })
          send({ type: 'reject', token: sig.token })
          return
        }
        tokenRef.current = sig.token
        setMode(sig.mode)
        const peer: CallTarget = {
          conversationId: sig.conversationId ?? targetRef.current?.conversationId ?? '',
          otherId: sig.from,
        }
        if (!peer.conversationId) return
        targetRef.current = peer
        setTarget(peer)
        didStartIncomingRef.current = true
        ensureOutbound(peer) // so we can answer / decline / send ICE back
        updateStatus('incoming')
        onIncoming?.(peer, sig.mode)
        playRing('incoming')
        ringTimerRef.current = window.setTimeout(() => {
          if (statusRef.current === 'incoming') rejectCall()
        }, RING_MS)
        break
      }
      case 'accept': {
        if (sig.token !== tokenRef.current) return
        stopRing()
        updateStatus('active')
        break
      }
      case 'reject':
      case 'cancel': {
        if (sig.token !== tokenRef.current) return
        setError('The call was declined.')
        teardownPeer()
        updateStatus('idle')
        break
      }
      case 'hangup': {
        if (sig.token && sig.token !== tokenRef.current) return
        teardownPeer()
        updateStatus('idle')
        break
      }
      case 'offer': {
        if (sig.token !== tokenRef.current) return
        if (statusRef.current === 'active') {
          // Mid-call renegotiation (e.g. the peer turned their camera on/off):
          // apply it, rebuild the remote feed from the receiver tracks (so a
          // re-added video track reliably shows up), and answer right away.
          const pc = pcRef.current
          if (pc) {
            void pc.setRemoteDescription(new RTCSessionDescription(sig.sdp))
              .then(async () => {
                await flushPendingIce(pc)
                const answer = await pc.createAnswer()
                await pc.setLocalDescription(answer)
                send({ type: 'answer', sdp: answer, token: tokenRef.current ?? '' })
              }).catch(() => {})
          }
        } else {
          pendingOfferRef.current = sig.sdp
        }
        break
      }
      case 'answer': {
        if (sig.token !== tokenRef.current) return
        const pc = pcRef.current
        if (pc) {
          void pc.setRemoteDescription(new RTCSessionDescription(sig.sdp))
            .then(() => flushPendingIce(pc)).catch(() => {})
        }
        break
      }
      case 'ice': {
        if (sig.token !== tokenRef.current) return
        const pc = pcRef.current
        if (pc && pc.remoteDescription) {
          void pc.addIceCandidate(new RTCIceCandidate(sig.candidate)).catch(() => {})
        } else {
          pendingIceRef.current.push(sig.candidate)
        }
        break
      }
      case 'mute': {
        if (sig.token !== tokenRef.current) return
        setRemoteMuted(sig.muted)
        break
      }
      case 'video': {
        if (sig.token !== tokenRef.current) return
        setRemoteVideoOn(sig.on)
        break
      }
      default:
        break
    }
  }

  function flushPendingOut() {
    const me = myIdRef.current
    const ch = outChRef.current
    if (!ch || !outReadyRef.current || !me) return
    const pending = pendingOutRef.current.splice(0)
    for (const s of pending) void ch.send({ type: 'broadcast', event: 'call', payload: { ...s, from: me } })
  }

  // Send a signaling message on the peer's channel. Realtime broadcasts can only
  // be delivered once we are SUBSCRIBED to that channel, so if it isn't ready yet
  // the signal is buffered and flushed as soon as the channel connects. This is
  // what makes the caller's very first 'call'/'offer' reliably reach the callee.
  function send(signal: SignalMessage) {
    const me = myIdRef.current
    if (!me) return
    if (outChRef.current && outReadyRef.current) {
      void outChRef.current.send({ type: 'broadcast', event: 'call', payload: { ...signal, from: me } })
    } else {
      pendingOutRef.current.push(signal)
    }
  }

  // Subscribe to the peer's channel so we can broadcast signaling to them.
  // Idempotent per topic; tears down any previous outbound channel.
  function ensureOutbound(peer: CallTarget) {
    const supabase = createClient()
    const topic = `call:user:${peer.otherId}`
    if (outChRef.current && outTopicRef.current === topic) return outChRef.current
    if (outChRef.current) void supabase.removeChannel(outChRef.current)
    const ch = supabase.channel(topic, { config: { broadcast: { self: false } } })
    outChRef.current = ch
    outTopicRef.current = topic
    outReadyRef.current = false
    ch.on('broadcast', { event: 'call' }, handler).subscribe((status) => {
      if (status === 'SUBSCRIBED') { outReadyRef.current = true; flushPendingOut() }
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') { outReadyRef.current = false }
    })
    return ch
  }

  function teardownPeer() {
    emitCallFinish()
    resetCallLogRefs()
    stopRing()
    window.clearTimeout(ringTimerRef.current)
    ringTimerRef.current = undefined
    const pc = pcRef.current
    if (pc) {
      pc.onicecandidate = null
      pc.ontrack = null
      pc.onconnectionstatechange = null
      pc.close()
      pcRef.current = null
    }
    if (localStreamRef.current) { localStreamRef.current.getTracks().forEach((tk) => tk.stop()); localStreamRef.current = null }
    setLocalStream((prev) => { if (prev) prev.getTracks().forEach((tk) => tk.stop()); return null })
    setRemoteStream((prev) => { if (prev) prev.getTracks().forEach((tk) => tk.stop()); return null })
    pendingIceRef.current = []
    pendingOfferRef.current = null
    tokenRef.current = null
    setVideoEnabled(true)
    setMuted(false)
    setRemoteMuted(false)
    setRemoteVideoOn(false)
  }

  function createPeer(): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    pc.onicecandidate = (ev) => {
      if (ev.candidate && tokenRef.current) {
        send({ type: 'ice', candidate: ev.candidate.toJSON(), token: tokenRef.current })
      }
    }
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState
      if (s === 'connected') { stopRing(); updateStatus('active') }
      if (s === 'failed' || s === 'disconnected' || s === 'closed') {
        teardownPeer()
        updateStatus('ended')
      }
    }
    pc.ontrack = (ev) => {
      // Use the exact track for this event, NOT ev.streams[0].getTracks():
      // audio and video share one msid stream here, so the stream's getTracks
      // would return BOTH on a renegotiation and re-add (duplicate) existing
      // tracks. We must add/update only the specific track that arrived.
      const tk = ev.track
      if (!tk) return
      // The peer removed (stopped) a track mid-call (e.g. turned video off);
      // drop it from the remote stream so the UI switches back to audio.
      if (tk.readyState === 'ended') {
        setRemoteStream((prev) => {
          if (!prev) return prev
          const has = prev.getTracks().some((t) => t.id === tk.id)
          if (!has) return prev
          return new MediaStream(prev.getTracks().filter((t) => t.id !== tk.id))
        })
        return
      }
      setRemoteStream((prev) => {
        const next = new MediaStream()
        if (prev) prev.getTracks().forEach((t) => next.addTrack(t))
        const has = next.getTracks().some((t) => t.id === tk.id)
        if (!has) next.addTrack(tk)
        return next
      })
      if (tk.kind === 'video') { setRemoteVideoOn(true); callSawVideoRef.current = true }
      // If this remote track is later removed (e.g. the peer turns video off),
      // drop it from the remote stream so the UI switches back to audio.
      tk.onended = () => {
        setRemoteStream((prev) => {
          if (!prev) return prev
          const has = prev.getTracks().some((t) => t.id === tk.id)
          if (!has) return prev
          return new MediaStream(prev.getTracks().filter((t) => t.id !== tk.id))
        })
        if (tk.kind === 'video') setRemoteVideoOn(false)
      }
      updateStatus('active')
    }
    // When the peer removes a track (e.g. `pc.removeTrack` + renegotiate to
    // turn their camera off), ontrack does NOT fire and the receiving track's
    // readyState stays "live" but frozen. Handle this event explicitly so the
    // UI actually falls back to the avatar instead of showing a frozen frame.
    ;(pc as unknown as { onremovetrack: (ev: MediaStreamTrackEvent) => void }).onremovetrack = (ev) => {
      const tk = ev.track
      if (!tk) return
      setRemoteStream((prev) => {
        if (!prev) return prev
        const has = prev.getTracks().some((t) => t.id === tk.id)
        if (!has) return prev
        return new MediaStream(prev.getTracks().filter((t) => t.id !== tk.id))
      })
      if (tk.kind === 'video') setRemoteVideoOn(false)
    }
    pcRef.current = pc
    return pc
  }

  async function getLocalStream(mediaMode: CallMode): Promise<MediaStream> {
    if (!localStreamRef.current) {
      localStreamRef.current = await navigator.mediaDevices.getUserMedia({
        video: mediaMode === 'video',
        audio: true,
      })
      setLocalStream(localStreamRef.current)
    } else if (mediaMode === 'video' && localStreamRef.current.getVideoTracks().length === 0) {
      const v = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      v.getVideoTracks().forEach((tk) => localStreamRef.current!.addTrack(tk))
      setLocalStream(new MediaStream(localStreamRef.current.getTracks()))
    }
    return localStreamRef.current
  }

  function attachLocal(pc: RTCPeerConnection, stream: MediaStream) {
    stream.getTracks().forEach((tk) => pc.addTrack(tk, stream))
  }

  // Attach a video track to the peer connection for the first time or after
  // a toggle-off.  Because we use replaceTrack(null) on turn-off (not
  // removeTrack), the sender + transceiver stay alive.  We can simply
  // replaceTrack(vt) on the existing sender to re-activate video cleanly.
  async function attachVideoToPeer(pc: RTCPeerConnection, vt: MediaStreamTrack, stream: MediaStream) {
    const videoSender = pc.getSenders().find((s) => s.track?.kind === 'video' || (!s.track && pc.getTransceivers().some((t) => t.sender === s && (t.receiver?.track?.kind === 'video' || t.sender?.track?.kind === 'video'))))
    if (videoSender) {
      await videoSender.replaceTrack(vt)
    } else {
      pc.addTrack(vt, stream)
    }
  }

  // Offer a mid-call renegotiation (used when turning the camera on/off mid-call).
  // Waits for the connection to return to a stable signaling state first so the
  // new offer isn't rejected (InvalidStateError) and the re-added track actually
  // lands — renegotiating while another negotiation is in flight is what caused
  // the remote video to drop out (black screen) after toggling the camera.
  async function renegotiate() {
    const pc = pcRef.current
    if (!pc) return
    try {
      if (pc.signalingState !== 'stable') {
        await new Promise<void>((resolve) => {
          const deadline = Date.now() + 4000
          const poll = () => {
            if (pc.signalingState === 'stable') return resolve()
            if (Date.now() >= deadline) return resolve()
            setTimeout(poll, 40)
          }
          poll()
        })
      }
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      send({ type: 'offer', sdp: offer, token: tokenRef.current ?? '' })
    } catch {
      // best-effort: a failed renegotiation should never kill the call
    }
  }

  async function flushPendingIce(pc: RTCPeerConnection) {
    for (const c of pendingIceRef.current.splice(0)) {
      try { await pc.addIceCandidate(new RTCIceCandidate(c)) } catch {}
    }
  }

  // ── Public actions ────────────────────────────────────────────────────
  const startCall = useCallback(async (mediaMode: CallMode, t?: CallTarget) => {
    const me = myIdRef.current
    const peer = t || targetRef.current
    if (!me || !peer) return
    if (statusRef.current !== 'idle') return
    setError('')
    let stream: MediaStream
    try {
      stream = await getLocalStream(mediaMode)
    } catch {
      setError(mediaMode === 'video'
        ? 'Could not access the camera/microphone. Please allow access in site settings.'
        : 'Could not access the microphone. Please allow access in site settings.')
      return
    }
    targetRef.current = peer
    setTarget(peer)
    setMode(mediaMode)
    resetCallLogRefs()
    wasCallerRef.current = true
    ensureOutbound(peer) // establish the peer channel BEFORE sending so the
    // initial 'call'/'offer' reach the callee (buffered until subscribed).
    const token = SESSION_TOKEN()
    tokenRef.current = token
    const pc = createPeer()
    attachLocal(pc, stream)
    updateStatus('outgoing')
    playRing('outgoing')
    send({ type: 'call', mode: mediaMode, token, conversationId: peer.conversationId })
    // Create an incoming-call notification for the callee so they get an
    // in-app accept/decline banner (visible tab) and an OS push (away tab).
    try {
      const supa = createClient()
      void supa.rpc('create_call_notification', { p_conversation_id: peer.conversationId, p_mode: mediaMode })
    } catch {}
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    send({ type: 'offer', sdp: offer, token })
    ringTimerRef.current = window.setTimeout(() => {
      if (statusRef.current === 'outgoing') {
        send({ type: 'cancel', token: tokenRef.current ?? '' })
        teardownPeer()
        updateStatus('idle')
      }
    }, CALL_TIMEOUT_MS)
  }, [])

  const acceptCall = useCallback(async () => {
    if (statusRef.current !== 'incoming') return
    setError('')
    const mediaMode = mode
    let stream: MediaStream
    try {
      stream = await getLocalStream(mediaMode)
    } catch {
      send({ type: 'reject', token: tokenRef.current ?? '' })
      setError(mediaMode === 'video'
        ? 'Could not access the camera/microphone. Please allow access.'
        : 'Could not access the microphone. Please allow access.')
      teardownPeer()
      updateStatus('idle')
      return
    }
    stopRing()
    const pc = createPeer()
    attachLocal(pc, stream)
    updateStatus('active')
    send({ type: 'accept', token: tokenRef.current ?? '' })
    const offer = pendingOfferRef.current
    if (offer) {
      await pc.setRemoteDescription(new RTCSessionDescription(offer)).catch(() => {})
    }
    await flushPendingIce(pc)
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    send({ type: 'answer', sdp: answer, token: tokenRef.current ?? '' })
  }, [mode])

  const rejectCall = useCallback(() => {
    send({ type: 'reject', token: tokenRef.current ?? '' })
    teardownPeer()
    updateStatus('idle')
  }, [])

  const endCall = useCallback(() => {
    send({ type: 'hangup', token: tokenRef.current ?? '' })
    teardownPeer()
    updateStatus('idle')
  }, [])

  const toggleMute = useCallback(() => {
    if (!localStreamRef.current) return
    const audioTracks = localStreamRef.current.getAudioTracks()
    const currentlyMuted = audioTracks.length === 0 || audioTracks.every((tk) => !tk.enabled)
    const next = !currentlyMuted
    audioTracks.forEach((tk) => { tk.enabled = !next })
    setMuted(next)
    // Tell the other person whether we're muted so they can see it on their
    // side (e.g. a "mic off" indicator next to our video/avatar).
    send({ type: 'mute', muted: next, token: tokenRef.current ?? '' })
  }, [])

  const toggleVideo = useCallback(async () => {
    const stream = localStreamRef.current
    if (!stream) return
    const pc = pcRef.current
    const vids = stream.getVideoTracks()

    // No camera yet (audio call) — acquire one and attach it so the call
    // becomes a video call for both sides.
    if (vids.length === 0) {
      try {
        const v = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        const vt = v.getVideoTracks()[0]
        if (!vt) return
        stream.addTrack(vt)
        callSawVideoRef.current = true
        setVideoEnabled(true)
        setLocalStream(new MediaStream(stream.getTracks()))
        if (pc) { await attachVideoToPeer(pc, vt, stream); await renegotiate() }
        send({ type: 'video', on: true, token: tokenRef.current ?? '' })
      } catch {
        setError('Could not access the camera. Please allow access in site settings.')
      }
      return
    }

    // Toggle the avatar overlay on/off.  The video track stays alive the
    // entire time — we never stop, remove, or renegotiate it.  The remote
    // side just hides the video behind their avatar when they receive the
    // "off" signal, and reveals it again on "on".  This avoids all the WebRTC
    // transceiver / renegotiation bugs that cause a black screen.
    const next = !videoEnabled
    setVideoEnabled(next)
    send({ type: 'video', on: next, token: tokenRef.current ?? '' })
  }, [videoEnabled])

  // ── Inbound signaling channel ─────────────────────────────────────────
  // Always listen on our own channel for inbound calls. The outbound peer
  // channel is managed on-demand by ensureOutbound() (called from startCall and
  // the inbound 'call' handler), so the caller's first signals always reach the
  // callee instead of being dropped while a re-subscription races.
  useEffect(() => {
    if (!myId) return
    const supabase = createClient()
    const inCh = supabase.channel(`call:user:${myId}`, { config: { broadcast: { self: false } } })
    inChRef.current = inCh
    inCh.on('broadcast', { event: 'call' }, handler).subscribe()

    return () => {
      window.clearTimeout(ringTimerRef.current)
      ringTimerRef.current = undefined
      teardownPeer()
      updateStatus('idle')
      if (outChRef.current) void supabase.removeChannel(outChRef.current)
      outChRef.current = null
      outTopicRef.current = null
      outReadyRef.current = false
      if (inChRef.current) void supabase.removeChannel(inChRef.current)
      inChRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myId])

  return {
    status,
    mode,
    muted,
    remoteMuted,
    remoteVideoOn,
    videoEnabled,
    error,
    localStream,
    remoteStream,
    target,
    startCall,
    acceptCall,
    rejectCall,
    endCall,
    toggleMute,
    toggleVideo,
    clearError: () => setError(''),
  }
}
