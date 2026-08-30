'use client'

// Persistent background P2P DataChannel for file transfer.
// Establishes a dedicated RTCPeerConnection on page mount using Supabase
// broadcast signaling. Stays open continuously — survives call start/end.
// Files route through this pipe regardless of whether a voice/video call
// is active.

import { useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ICE_SERVERS } from '@/lib/call'

type Status = 'idle' | 'signaling' | 'connecting' | 'open' | 'failed'

export function useBackgroundP2P(opts: {
  conversationId: string | null
  myId: string | null
  onData: (data: ArrayBuffer | string) => void
}) {
  const { conversationId, myId, onData } = opts
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const dcRef = useRef<RTCDataChannel | null>(null)
  const chRef = useRef<ReturnType<ReturnType<typeof createClient>['channel']> | null>(null)
  const statusRef = useRef<Status>('idle')
  const tokenRef = useRef<string | null>(null)
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([])
  const isInitiatorRef = useRef(false)
  const onDataRef = useRef(onData)
  const retryTimerRef = useRef<number | undefined>(undefined)

  useEffect(() => { onDataRef.current = onData }, [onData])

  const send = useCallback((data: string | ArrayBuffer) => {
    const dc = dcRef.current
    if (!dc || dc.readyState !== 'open') return false
    if (typeof data === 'string') dc.send(data)
    else dc.send(data)
    return true
  }, [])

  const isOpen = useCallback(() => dcRef.current?.readyState === 'open', [])

  useEffect(() => {
    if (!conversationId || !myId) return
    let active = true
    const supabase = createClient()
    const topic = `signal:${conversationId}`
    const ch = supabase.channel(topic, { config: { broadcast: { self: false } } })
    chRef.current = ch

    const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    tokenRef.current = token

    function createPC() {
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
      pc.onicecandidate = (ev) => {
        if (ev.candidate && active) {
          void ch.send({ type: 'broadcast', event: 'signal', payload: { type: 'ice', candidate: ev.candidate.toJSON(), token: tokenRef.current, from: myId } })
        }
      }
      pc.onconnectionstatechange = () => {
        const s = pc.connectionState
        if (s === 'connected') statusRef.current = 'connecting'
        if (s === 'failed' || s === 'disconnected' || s === 'closed') {
          statusRef.current = 'failed'
          cleanup()
          if (active) retryTimerRef.current = window.setTimeout(() => { if (active) void start() }, 3000)
        }
      }
      // Responder side: handle incoming DataChannel from the initiator.
      pc.ondatachannel = (ev) => { setupDC(ev.channel) }
      pcRef.current = pc
      return pc
    }

    function setupDC(dc: RTCDataChannel) {
      dc.binaryType = 'arraybuffer'
      dc.onmessage = (ev) => onDataRef.current(ev.data)
      dc.onopen = () => { statusRef.current = 'open' }
      dc.onclose = () => { statusRef.current = 'idle' }
      dcRef.current = dc
    }

    async function start() {
      if (!active) return
      statusRef.current = 'signaling'
      if (pcRef.current) { try { pcRef.current.close() } catch {} pcRef.current = null }
      if (dcRef.current) { try { dcRef.current.close() } catch {} dcRef.current = null }

      const pc = createPC()

      // Only the peer with the earlier creation timestamp initiates.
      // The other peer waits for an offer and becomes the responder.
      const iAmInitiator = Date.now() <= parseInt(token.split('-')[0], 36)

      if (iAmInitiator) {
        const dc = pc.createDataChannel('shahzap-files', { ordered: true })
        setupDC(dc)
        isInitiatorRef.current = true
      }

      ch.on('broadcast', { event: 'signal' }, async ({ payload }) => {
        if (!active) return
        const p = payload as { type: string; token: string; from: string; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }
        if (p.from === myId) return
        if (p.type === 'offer' && p.sdp) {
          tokenRef.current = p.token
          isInitiatorRef.current = false
          if (dcRef.current) { try { dcRef.current.close() } catch {} dcRef.current = null }
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(p.sdp))
            for (const c of pendingIceRef.current) { try { await pc.addIceCandidate(new RTCIceCandidate(c)) } catch {} }
            pendingIceRef.current = []
            const answer = await pc.createAnswer()
            await pc.setLocalDescription(answer)
            void ch.send({ type: 'broadcast', event: 'signal', payload: { type: 'answer', sdp: answer, token: p.token, from: myId } })
          } catch {}
          return
        }
        if (p.token !== tokenRef.current) return
        if (p.type === 'answer' && p.sdp) {
          try { await pc.setRemoteDescription(new RTCSessionDescription(p.sdp)) } catch {}
          for (const c of pendingIceRef.current) { try { await pc.addIceCandidate(new RTCIceCandidate(c)) } catch {} }
          pendingIceRef.current = []
        } else if (p.type === 'ice' && p.candidate) {
          if (pc.remoteDescription) {
            try { await pc.addIceCandidate(new RTCIceCandidate(p.candidate)) } catch {}
          } else {
            pendingIceRef.current.push(p.candidate)
          }
        }
      }).subscribe((status) => {
        if (status !== 'SUBSCRIBED' || !iAmInitiator) return
        void (async () => {
          try {
            const offer = await pc.createOffer()
            await pc.setLocalDescription(offer)
            void ch.send({ type: 'broadcast', event: 'signal', payload: { type: 'offer', sdp: offer, token, from: myId } })
          } catch {}
        })()
      })
    }

    function cleanup() {
      if (dcRef.current) { try { dcRef.current.close() } catch {} dcRef.current = null }
      if (pcRef.current) {
        pcRef.current.onicecandidate = null
        pcRef.current.onconnectionstatechange = null
        try { pcRef.current.close() } catch {}
        pcRef.current = null
      }
      if (chRef.current) { void supabase.removeChannel(chRef.current); chRef.current = null }
      if (retryTimerRef.current) { window.clearTimeout(retryTimerRef.current); retryTimerRef.current = undefined }
    }

    void start()

    return () => { active = false; cleanup() }
  }, [conversationId, myId])

  return { send, isOpen, status: statusRef }
}
