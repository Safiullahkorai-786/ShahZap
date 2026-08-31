'use client'

// Persistent background P2P DataChannel for file transfer AND text messaging.
// Establishes a dedicated RTCPeerConnection on page mount using Supabase
// broadcast signaling. Stays open continuously — survives call start/end.
// Files and text route through this pipe regardless of whether a voice/video
// call is active.
//
// Reconnect reconciliation: when the DataChannel opens, the non-initiator
// (responder) sends a sync-request with its last known sender sequence.
// The initiator replies with a sync-response containing any missing messages.
//
// Presence-aware (Phase 4.3): WebRTC is an optimization, never a requirement.
// The conversation and its UI must remain usable even when the peer is
// offline. When we know the peer is offline we keep the signaling channel
// subscribed (so we can still answer if the peer reaches back to us), but we
// do NOT auto-initiate offers or hammer the connection with retries. P2P is
// only actively attempted while the peer is online (or unknown), which stops
// the previous endless reconnect churn that could degrade the page when a DM
// was opened with an offline recipient.

import { useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ICE_SERVERS } from '@/lib/call'
import { logP2P, logReconcile, p2pDebugEnabled } from '@/lib/p2p-debug'
import type { ChatCapabilities } from '@/lib/file-transfer'

type Status = 'idle' | 'signaling' | 'connecting' | 'open' | 'failed'

// User-facing transport state — what the badge should show.
export type TransportStatus = 'p2p' | 'connecting' | 'supabase' | 'disabled'

// If the WebRTC handshake has not completed within this window, give up and
// let Supabase carry messages.  The hook will still retry in the background
// when the peer is online.
const SIGNALING_TIMEOUT_MS = 10_000

// After this many consecutive signaling failures, stop retrying for this
// session.  The conversation remains fully functional via Supabase.  A page
// refresh resets the counter.
const MAX_SIGNALLING_ATTEMPTS = 3

// Phase B: Local capabilities advertised during sync handshake.
const LOCAL_CAPABILITIES: ChatCapabilities = {
  protocolVersion: 2,
  supportsEvents: true,
}

export function useBackgroundP2P(opts: {
  conversationId: string | null
  myId: string | null
  otherId: string | null
  onData: (data: ArrayBuffer | string) => void
  enabled?: boolean
  // True → peer is online, attempt P2P. False → peer offline, stay responsive
  // to inbound offers but do not initiate/retry. Undefined → unknown, attempt.
  peerOnline?: boolean
  // Dev-only: receives a transition event string whenever the transport status
  // changes, so a page can render a live P2P indicator while testing.
  onStatusChange?: (status: Status) => void
}) {
  const { conversationId, myId, otherId, onData, enabled = true, peerOnline, onStatusChange } = opts
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const dcRef = useRef<RTCDataChannel | null>(null)
  const chRef = useRef<ReturnType<ReturnType<typeof createClient>['channel']> | null>(null)
  const statusRef = useRef<Status>('idle')
  const tokenRef = useRef<string | null>(null)
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([])
  const isInitiatorRef = useRef(false)
  const onDataRef = useRef(onData)
  const retryTimerRef = useRef<number | undefined>(undefined)
  const signalingTimeoutRef = useRef<number | undefined>(undefined)
  const peerOnlineRef = useRef(peerOnline)
  const attemptsRef = useRef(0)
  const onStatusRef = useRef(onStatusChange)
  const transportRef = useRef<TransportStatus>('disabled')

  useEffect(() => { onDataRef.current = onData }, [onData])
  useEffect(() => { peerOnlineRef.current = peerOnline }, [peerOnline])
  useEffect(() => { onStatusRef.current = onStatusChange }, [onStatusChange])

  const setStatus = useCallback((s: Status) => {
    if (statusRef.current !== s) {
      statusRef.current = s
      onStatusRef.current?.(s)
    }
  }, [])

  const send = useCallback((data: string | ArrayBuffer) => {
    // Dev/test-only override (__P2P_DEBUG__ set): when __P2P_FORCE_FALLBACK__ is
    // '1' the WebRTC send is deliberately rejected so the page exercises its
    // Supabase fallback path. Completely inert in production and in normal dev.
    if (p2pDebugEnabled() && typeof window !== 'undefined' && window.localStorage.getItem('__P2P_FORCE_FALLBACK__') === '1') {
      logP2P('send forced to fallback (test)', { conversationId })
      return false
    }
    const dc = dcRef.current
    if (!dc || dc.readyState !== 'open') return false
    if (typeof data === 'string') dc.send(data)
    else dc.send(data)
    return true
  }, [])

  const isOpen = useCallback(() => dcRef.current?.readyState === 'open', [])

  useEffect(() => {
    if (!conversationId || !myId || !otherId || !enabled) {
      transportRef.current = 'disabled'
      return
    }
    let active = true
    const supabase = createClient()
    const topic = `signal:${conversationId}`
    logP2P('initializing', { conversationId, peerOnline: peerOnlineRef.current })

    const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    tokenRef.current = token

    // Deterministic leader election: the peer whose user ID sorts first
    // alphabetically always initiates. Both peers compute the same result.
    const iAmInitiator = myId < otherId

    function clearSignalingTimeout() {
      if (signalingTimeoutRef.current) {
        window.clearTimeout(signalingTimeoutRef.current)
        signalingTimeoutRef.current = undefined
      }
    }

    function updateTransport() {
      if (!enabled) { transportRef.current = 'disabled'; return }
      if (dcRef.current?.readyState === 'open') { transportRef.current = 'p2p'; return }
      const s = statusRef.current
      if (s === 'signaling' || s === 'connecting') { transportRef.current = 'connecting'; return }
      transportRef.current = 'supabase'
    }

    function createPC() {
      logP2P('RTCPeerConnection created', { conversationId })
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
      pc.onicecandidate = (ev) => {
        if (ev.candidate) logP2P('ICE gathering', { candidateIndex: ev.candidate?.sdpMLineIndex })
        if (ev.candidate && active) {
          void chRef.current?.send({ type: 'broadcast', event: 'signal', payload: { type: 'ice', candidate: ev.candidate.toJSON(), token: tokenRef.current, from: myId } })
        }
      }
      pc.onconnectionstatechange = () => {
        const s = pc.connectionState
        logP2P('connectionState', { state: s, conversationId })
        if (s === 'connected') {
          clearSignalingTimeout()
          setStatus('connecting')
          updateTransport()
        }
        if (s === 'failed' || s === 'disconnected' || s === 'closed') {
          clearSignalingTimeout()
          setStatus('failed')
          updateTransport()
          cleanup()
          // Do not retry while the peer is known offline.
          if (active && peerOnlineRef.current !== false) {
            scheduleRetry()
          }
        }
      }
      // Responder side: handle incoming DataChannel from the initiator.
      pc.ondatachannel = (ev) => { setupDC(ev.channel) }
      pcRef.current = pc
      return pc
    }

    function setupDC(dc: RTCDataChannel) {
      logP2P('DataChannel created', { label: dc.label, conversationId })
      dc.binaryType = 'arraybuffer'
      dc.onmessage = (ev) => onDataRef.current(ev.data)
      dc.onopen = () => {
        logP2P('DataChannel open', { conversationId, initiator: isInitiatorRef.current })
        clearSignalingTimeout()
        setStatus('open')
        updateTransport()
        attemptsRef.current = 0
        // Reconnect reconciliation: responder sends sync-request
        // with sender-scoped last known sequences and capabilities
        if (!isInitiatorRef.current && myId) {
          logReconcile('sync-request')
          const syncReq = JSON.stringify({
            kind: 'sync-request',
            senderId: myId,
            lastKnownSequences: {},
            capabilities: LOCAL_CAPABILITIES,
          })
          try { dc.send(syncReq) } catch {}
        }
      }
      dc.onclose = () => { logP2P('DataChannel closed', { conversationId }); setStatus('idle'); updateTransport() }
      dcRef.current = dc
    }

    function scheduleRetry() {
      if (retryTimerRef.current) return
      if (attemptsRef.current >= MAX_SIGNALLING_ATTEMPTS) {
        logP2P('max signaling attempts reached, giving up for this session', { attempts: attemptsRef.current, conversationId })
        return
      }
      // Bounded backoff: cap attempt count and lengthen the interval so an
      // unreachable peer never causes unbounded resource churn.
      const backoff = Math.min(3000 * Math.pow(2, Math.min(attemptsRef.current, 4)), 30000)
      attemptsRef.current += 1
      logP2P('retry scheduled', { backoffMs: backoff, attempt: attemptsRef.current, conversationId })
      retryTimerRef.current = window.setTimeout(() => {
        retryTimerRef.current = undefined
        if (active && peerOnlineRef.current !== false) {
          logP2P('retry attempt', { attempt: attemptsRef.current, conversationId })
          void start()
        }
      }, backoff)
    }

    async function start() {
      if (!active) return
      logP2P('starting', { conversationId, peerOnline: peerOnlineRef.current })
      clearSignalingTimeout()
      setStatus('signaling')
      updateTransport()
      if (pcRef.current) { try { pcRef.current.close() } catch {} pcRef.current = null }
      if (dcRef.current) { try { dcRef.current.close() } catch {} dcRef.current = null }

      // Create a FRESH signaling channel each time.  After cleanup() destroys
      // the old channel, re-using the same instance would throw "join multiple
      // times".  A fresh channel ensures retries work correctly.
      if (chRef.current) { void supabase.removeChannel(chRef.current); chRef.current = null }
      const ch = supabase.channel(topic, { config: { broadcast: { self: false } } })
      chRef.current = ch

      const pc = createPC()

      // If the WebRTC handshake does not complete within the timeout window,
      // give up and let Supabase carry messages.  The hook will retry later
      // if the peer is online.
      signalingTimeoutRef.current = window.setTimeout(() => {
        if (!active) return
        if (statusRef.current === 'signaling') {
          logP2P('signaling timeout', { conversationId })
          setStatus('failed')
          updateTransport()
          cleanup()
          if (peerOnlineRef.current !== false) {
            scheduleRetry()
          }
        }
      }, SIGNALING_TIMEOUT_MS)

      // Presence-aware: do NOT send an offer while the peer is known offline.
      // We create the DataChannel so we are ready to answer if the peer
      // reaches out, but we wait to initiate until the peer is online/unknown.
      if (iAmInitiator && peerOnlineRef.current !== false) {
        logP2P('creating offer (initiator)', { conversationId })
        const dc = pc.createDataChannel('shahzap-files', { ordered: true })
        setupDC(dc)
        isInitiatorRef.current = true
      }

      ch.on('broadcast', { event: 'signal' }, async ({ payload }) => {
        if (!active) return
        const p = payload as { type: string; token: string; from: string; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }
        if (p.from === myId) return
        if (p.type === 'offer' && p.sdp) {
          // A peer reaching out to us (even one previously marked offline) is
          // a valid reason to answer and establish the channel.
          logP2P('offer received', { conversationId })
          tokenRef.current = p.token
          isInitiatorRef.current = false
          if (dcRef.current) { try { dcRef.current.close() } catch {} dcRef.current = null }
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(p.sdp))
            for (const c of pendingIceRef.current) { try { await pc.addIceCandidate(new RTCIceCandidate(c)) } catch {} }
            pendingIceRef.current = []
            const answer = await pc.createAnswer()
            await pc.setLocalDescription(answer)
            logP2P('answer sent', { conversationId })
            void ch.send({ type: 'broadcast', event: 'signal', payload: { type: 'answer', sdp: answer, token: p.token, from: myId } })
          } catch {}
          return
        }
        if (p.token !== tokenRef.current) return
        if (p.type === 'answer' && p.sdp) {
          logP2P('answer received', { conversationId })
          try { await pc.setRemoteDescription(new RTCSessionDescription(p.sdp)) } catch {}
          for (const c of pendingIceRef.current) { try { await pc.addIceCandidate(new RTCIceCandidate(c)) } catch {} }
          pendingIceRef.current = []
        } else if (p.type === 'ice' && p.candidate) {
          logP2P('ICE candidate received', { conversationId })
          if (pc.remoteDescription) {
            try { await pc.addIceCandidate(new RTCIceCandidate(p.candidate)) } catch {}
          } else {
            pendingIceRef.current.push(p.candidate)
          }
        }
      }).subscribe((status) => {
        if (status !== 'SUBSCRIBED') { logP2P('signaling subscribe status', { status }); return }
        logP2P('signaling subscribed', { conversationId, initiator: iAmInitiator, peerOnline: peerOnlineRef.current })
        if (!iAmInitiator) return
        if (peerOnlineRef.current === false) return
        void (async () => {
          try {
            logP2P('creating offer', { conversationId })
            const offer = await pc.createOffer()
            await pc.setLocalDescription(offer)
            logP2P('offer sent', { conversationId })
            void ch.send({ type: 'broadcast', event: 'signal', payload: { type: 'offer', sdp: offer, token, from: myId } })
          } catch {}
        })()
      })
    }

    function cleanup() {
      logP2P('destroyed', { conversationId })
      clearSignalingTimeout()
      if (retryTimerRef.current) { window.clearTimeout(retryTimerRef.current); retryTimerRef.current = undefined }
      if (dcRef.current) {
        dcRef.current.onopen = null
        dcRef.current.onclose = null
        dcRef.current.onmessage = null
        try { dcRef.current.close() } catch {} dcRef.current = null
      }
      if (pcRef.current) {
        pcRef.current.onicecandidate = null
        pcRef.current.onconnectionstatechange = null
        try { pcRef.current.close() } catch {}
        pcRef.current = null
      }
      if (chRef.current) { void supabase.removeChannel(chRef.current); chRef.current = null }
      attemptsRef.current = 0
    }

    void start()

    return () => { active = false; cleanup() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, myId, otherId, enabled])

  return { send, isOpen, status: statusRef, transport: transportRef }
}
