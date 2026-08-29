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
}) {
  const { myId, ringSound, stopRingingSound, onIncoming } = opts

  const [status, setStatus] = useState<CallStatus>('idle')
  const [mode, setMode] = useState<CallMode>('audio')
  const [muted, setMuted] = useState(false)
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

  function updateStatus(s: CallStatus) { statusRef.current = s; setStatus(s) }
  function playRing(kind: RingKind) { try { ringSound?.(kind) } catch {} }
  function stopRing() { try { stopRingingSound?.() } catch {} }

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
        pendingOfferRef.current = sig.sdp
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
      const incoming = ev.streams[0]
        ? (ev.streams[0].getTracks() ?? [])
        : ev.track ? [ev.track] : []
      if (!incoming.length) return
      setRemoteStream((prev) => {
        const next = new MediaStream()
        if (prev) prev.getTracks().forEach((tk) => next.addTrack(tk))
        incoming.forEach((tk) => next.addTrack(tk))
        return next
      })
      updateStatus('active')
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
    setMuted((m) => {
      const next = !m
      localStreamRef.current!.getAudioTracks().forEach((tk) => { tk.enabled = !next })
      return next
    })
  }, [])

  const toggleVideo = useCallback(() => {
    if (!localStreamRef.current) return
    setVideoEnabled((v) => {
      const next = !v
      localStreamRef.current!.getVideoTracks().forEach((tk) => { tk.enabled = next })
      return next
    })
  }, [])

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
