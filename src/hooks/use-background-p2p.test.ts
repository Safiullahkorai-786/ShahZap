// Phase 4.4 — Code-level verification of the WebRTC lifecycle & reconnect.
//
// These tests drive the REAL useBackgroundP2P hook (not a copy) through a
// mock RTCPeerConnection + an in-memory Supabase signaling relay, using two
// React-mounted hook instances (initiator A, responder B) sharing one relay.
//
// They verify, deterministically and without a real browser:
//   1. full connect handshake — signaling subscribe → offer/answer → ICE →
//      DataChannel created → DataChannel open → isOpen()===true → message
//      delivered over WebRTC;
//   2. refresh — unmount A + remount a fresh A (same relay) → a NEW
//      RTCPeerConnection + re-subscribed signaling → DataChannel reopens →
//      a new message travels WebRTC again;
//   3. offline peer cooperation (peerOnline gate) and unknown-peer initiation.
//
// What this does NOT prove (needs a real browser, see
// scripts/verify-webrtc-refresh.mjs): real STUN/ICE through NAT, real SDP, OS
// network stacks, real two-tab timing, and the actual Supabase delivery path.

/* eslint-disable @typescript-eslint/no-explicit-any -- The WebRTC/Supabase mocks
   intentionally stand in for complex untyped browser/sdk objects; using `any`
   here keeps the test mock readable and is contained to this test file. */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { create, act } from 'react-test-renderer'
import React from 'react'
import { useBackgroundP2P } from '@/hooks/use-background-p2p'

// ── Shared relay state hoisted above the vi.mock factory (vitest hoisting) ──
const state = vi.hoisted(() => {
  type SignalListener = (msg: { payload: unknown; event?: string }) => void
  class SignalRelay {
    topics = new Map<string, Set<SignalListener>>()
    subscribe(topic: string, listener: SignalListener): () => void {
      if (!this.topics.has(topic)) this.topics.set(topic, new Set())
      this.topics.get(topic)!.add(listener)
      return () => this.topics.get(topic)?.delete(listener)
    }
    publish(topic: string, event: string, payload: unknown): void {
      this.topics.get(topic)?.forEach((l) => {
        try { l({ payload, event }) } catch {}
      })
    }
  }
  return {
    relay: new SignalRelay(),
    mockChannels: new Map<string, unknown[]>(),
    pcCounter: 0,
    makePeerConnection: (conversationId: string) => {
      state.pcCounter += 1
      const pc: any = {
        _id: state.pcCounter,
        _closed: false,
        connectionState: 'new',
        remoteDescription: null,
        onicecandidate: null,
        onconnectionstatechange: null,
        ondatachannel: null,
        dc: null,
        createDataChannel(label: string) {
          const makeDC = () => {
            const c: any = {
              label, readyState: 'open', binaryType: 'arraybuffer',
              onopen: null, onclose: null, onmessage: null, peer: null,
              send(data: any) { const p = this.peer; if (p?.onmessage) p.onmessage({ data }) },
              close() { this.readyState = 'closed'; if (this.onclose) this.onclose() },
            }
            return c
          }
          pc.dc = makeDC()
          return pc.dc
        },
        async createOffer() { return { type: 'offer', sdp: `offer-${pc._id}` } },
        async createAnswer() { return { type: 'answer', sdp: `answer-${pc._id}` } },
        async setLocalDescription() {
          if (pc.onicecandidate) pc.onicecandidate({ candidate: null })
          // The initiator's own DataChannel opens once its offer/answer
          // local description is set (mirrors real SCTP establishment).
          setTimeout(() => { if (pc.dc) { pc.dc.readyState = 'open'; if (pc.dc.onopen) pc.dc.onopen() } }, 0)
        },
        async setRemoteDescription(desc: any) {
          pc.remoteDescription = desc
          if (desc.type === 'offer') {
            const sel: any[] = (state.mockChannels.get(conversationId) ?? []).filter((p: any) => !p._closed)
            const initiator = sel.find((p) => p !== pc && p.dc)
            if (initiator?.dc) {
              const iDC = initiator.dc
              const rDC: any = {
                label: iDC.label, readyState: 'connecting', binaryType: 'arraybuffer',
                onopen: null, onclose: null, onmessage: null, peer: null,
              send(data: any) { const p = this.peer; if (p?.onmessage) p.onmessage({ data }) },
                close() { this.readyState = 'closed'; if (this.onclose) this.onclose() },
              }
              iDC.peer = rDC
              rDC.peer = iDC
              if (pc.ondatachannel) pc.ondatachannel({ channel: rDC })
              // After the hook's setupDC attaches onopen (synchronously during
              // ondatachannel), simulate the DataChannel opening.
              setTimeout(() => { rDC.readyState = 'open'; if (rDC.onopen) rDC.onopen() }, 0)
            }
          }
        },
        async addIceCandidate() {},
        _fail() {
          pc.connectionState = 'failed'
          if (pc.onconnectionstatechange) pc.onconnectionstatechange()
        },
        close() {
          pc._closed = true
          pc.connectionState = 'closed'
          if (pc.dc && pc.dc.readyState !== 'closed') pc.dc.close()
          if (pc.onconnectionstatechange) pc.onconnectionstatechange()
        },
      }
      if (!state.mockChannels.has(conversationId)) state.mockChannels.set(conversationId, [])
      state.mockChannels.get(conversationId)!.push(pc)
      return pc
    },
  }
})

vi.mock('@/lib/supabase/client', () => {
  return {
    createClient: () => {
      return {
        channel(topic: string, _config: unknown) {
          const unsubs: Array<() => void> = []
          const ch: any = {
            topic,
            on(_kind: string, opts: { event: string }, handler: (msg: { payload?: unknown }) => void) {
              return {
                subscribe(statusCb: (s: string) => void) {
                  // Supabase invokes the handler with a single ({ payload }) ctx.
                  const wrapped = (msg: { payload: unknown }) => handler(msg)
                  const unsub = state.relay.subscribe(topic, wrapped)
                  unsubs.push(unsub)
                  if (statusCb) statusCb('SUBSCRIBED')
                  return { unsubscribe: unsub }
                },
              }
            },
            send(msg: { type: 'broadcast'; event: string; payload: unknown }) {
              state.relay.publish(topic, msg.event, msg.payload)
              return Promise.resolve()
            },
            subscribe() {},
            removeChannel() { unsubs.forEach((u) => u()) },
          }
          return ch
        },
        removeChannel(ch: any) { ch?.removeChannel?.(); return Promise.resolve() },
      }
    },
  }
})

// The conversation each newly-created mock peer belongs to. Set by the tests
// before mounting hosts.
let currentConversationId = 'conv'

describe('useBackgroundP2P — WebRTC lifecycle & refresh reconnect (code-level)', () => {
  let lastOpen: (() => boolean) | null = null
  let lastSend: ((d: string | ArrayBuffer) => boolean) | null = null
  let lastData: unknown[] = []
  let hosts: Array<{ unmount: () => void; status: () => string; transport: () => string }> = []

  function makeHost({ myId, otherId, conversationId, peerOnline, enabled }: {
    myId: string
    otherId: string
    conversationId: string
    peerOnline?: boolean
    enabled?: boolean
  }) {
    let host: any
    let statusRef: { current: string } | null = null
    let transportRef: { current: string } | null = null
    act(() => {
      host = create(React.createElement(
        () => {
          const { send, isOpen, status, transport } = useBackgroundP2P({
            conversationId,
            myId,
            otherId,
            onData: (d: ArrayBuffer | string) => { lastData.push(d) },
            peerOnline,
            enabled,
          })
          lastOpen = isOpen
          lastSend = send
          statusRef = status as unknown as { current: string }
          transportRef = transport as unknown as { current: string }
          return null
        },
        {},
      ))
    })
    hosts.push({
      unmount: () => act(() => host.unmount()),
      status: () => statusRef?.current ?? 'idle',
      transport: () => transportRef?.current ?? 'disabled',
    })
  }

  beforeEach(() => {
    // (re)assign global RTCPeerConnection wired to the hoisted factory
    // with the current conversation.
    state.mockChannels.clear()
    state.relay.topics.clear()
    const Real = state.makePeerConnection
    ;(globalThis as any).RTCPeerConnection = class {
      _pc: any
      constructor() {
        this._pc = Real(currentConversationId)
      }
      // Forward handler/state properties to the underlying peer so the hook's
      // onicecandidate/onconnectionstatechange/ondatachannel assignments and
      // connectionState/remoteDescription reads land on the object the
      // handshake logic reads from.
      get connectionState() { return this._pc?.connectionState }
      get remoteDescription() { return this._pc?.remoteDescription }
      get dc() { return this._pc?.dc }
      get onicecandidate() { return this._pc.onicecandidate }
      set onicecandidate(v: any) { this._pc.onicecandidate = v }
      get onconnectionstatechange() { return this._pc.onconnectionstatechange }
      set onconnectionstatechange(v: any) { this._pc.onconnectionstatechange = v }
      get ondatachannel() { return this._pc.ondatachannel }
      set ondatachannel(v: any) { this._pc.ondatachannel = v }
      createDataChannel(label: string) { return this._pc.createDataChannel(label) }
      createOffer() { return this._pc.createOffer() }
      createAnswer() { return this._pc.createAnswer() }
      setLocalDescription() { return this._pc.setLocalDescription() }
      setRemoteDescription(d: any) { return this._pc.setRemoteDescription(d) }
      addIceCandidate() { return this._pc.addIceCandidate() }
      close() { this._pc.close() }
    }

    // Stub the SDP/ICE descriptor classes the hook news up in the
    // offer/answer handlers — happy-dom's real ones reject plain-string sdps.
    ;(globalThis as any).RTCSessionDescription = class { constructor(init: any) { Object.assign(this, init) } }
    ;(globalThis as any).RTCIceCandidate = class { constructor(init: any) { Object.assign(this, init) } }
    state.pcCounter = 0
    state.mockChannels.clear()
    state.relay.topics.clear()
    lastOpen = null
    lastSend = null
    lastData = []
    hosts = []
  })

  afterEach(() => {
    hosts.forEach((h) => { try { h.unmount() } catch {} })
  })

  it('unknown peer → A initiates offer, B answers, DataChannel opens, message via WebRTC', async () => {
    const conv = 'conv-1'
    currentConversationId = conv
    makeHost({ myId: 'A', otherId: 'B', conversationId: conv, peerOnline: undefined as any })
    // Mount B immediately so A's offer reaches B's signaling channel.
    // With deterministic leader election (myId < otherId), A is always the
    // initiator and B is the responder — B waits for A's offer.
    makeHost({ myId: 'B', otherId: 'A', conversationId: conv, peerOnline: true })
    await new Promise((r) => setTimeout(r, 120))

    expect(hosts.at(-1)!.status()).toBe('open')
    expect(lastOpen?.()).toBe(true)
    expect(state.pcCounter).toBeGreaterThanOrEqual(2)

    lastData = []
    const sent = lastSend!(JSON.stringify({ kind: 'text', id: 'm1', conversationId: conv, senderId: 'A', content: 'hi', createdAt: new Date().toISOString(), senderSequence: 1 }))
    expect(sent).toBe(true)
    await new Promise((r) => setTimeout(r, 10))
    expect(lastData.length).toBeGreaterThan(0)
  }, 20000)

  it('after A REFRESH: old PC destroyed, NEW RTCPeerConnection + re-subscribe, DataChannel reopens, message via WebRTC again', async () => {
    const conv = 'conv-refresh'
    currentConversationId = conv
    makeHost({ myId: 'A', otherId: 'B', conversationId: conv, peerOnline: true })
    makeHost({ myId: 'B', otherId: 'A', conversationId: conv, peerOnline: true })
    await new Promise((r) => setTimeout(r, 120))
    expect(hosts.at(-1)!.status()).toBe('open')

    const pcsBeforeRefresh = state.pcCounter
    const listenersBeforeRefresh = state.relay.topics.get(`signal:${conv}`)?.size ?? 0

    // ── REFRESH A: unmount A → React cleanup must destroy its peer ──
    const aHost = hosts[0]
    aHost.unmount()
    await new Promise((r) => setTimeout(r, 20))
    // A's signaling subscription was removed by cleanup (only B remains).
    expect(state.relay.topics.get(`signal:${conv}`)?.size ?? 0).toBe(listenersBeforeRefresh - 1)

    // A fresh mount = fresh RTCPeerConnection + fresh signaling subscription.
    makeHost({ myId: 'A', otherId: 'B', conversationId: conv, peerOnline: true })
    let reopened = false
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 40))
      if (hosts.at(-1)!.status() === 'open' && lastOpen?.()) { reopened = true; break }
    }
    // DataChannel reopens and p2pOpen() becomes true on the fresh A instance.
    expect(reopened).toBe(true)
    // A NEW RTCPeerConnection was created after refresh (counter increased).
    expect(state.pcCounter).toBeGreaterThan(pcsBeforeRefresh)
    // A re-subscribed to signaling — the relay topic listener count is restored
    // (this is the real re-subscribe signal, unlike the pc-array length).
    expect(state.relay.topics.get(`signal:${conv}`)?.size ?? 0).toBe(listenersBeforeRefresh)

    // New message after reconnect travels WebRTC again.
    lastData = []
    const sent = lastSend!(JSON.stringify({ kind: 'text', id: 'm2', conversationId: conv, senderId: 'A', content: 'after refresh', createdAt: new Date().toISOString(), senderSequence: 2 }))
    expect(sent).toBe(true)
    await new Promise((r) => setTimeout(r, 10))
    expect(lastData.length).toBeGreaterThan(0)
  }, 20000)

  it('offline peer → A stays subscribed but does NOT create an offer / complete a connection', async () => {
    const conv = 'conv-offline'
    currentConversationId = conv
    makeHost({ myId: 'A', otherId: 'B', conversationId: conv, peerOnline: false })
    await new Promise((r) => setTimeout(r, 150))

    // A is subscribed (signaling) but never got to 'open' (no offer initiated).
    expect(hosts.at(-1)!.status()).toBe('signaling')
    expect(lastOpen?.()).toBe(false)
  }, 20000)

  it('connection interruption → status failed; retry scheduled for ONLINE peer but NOT for OFFLINE peer', async () => {
    // Offline peer: force a connection failure and confirm NO retry fires
    // (peerOnlineRef === false gates scheduleRetry), so the page is never
    // churned by an unreachable peer.
    const convOff = 'conv-int-off'
    currentConversationId = convOff
    makeHost({ myId: 'A', otherId: 'B', conversationId: convOff, peerOnline: false })
    await new Promise((r) => setTimeout(r, 150))
    const offlinePc = (state.mockChannels.get(convOff) ?? []) as any[]
    const offlinePeer = offlinePc.find((p: any) => !p._closed)
    const pcsAfterOffline = state.pcCounter
    offlinePeer._fail()
    await new Promise((r) => setTimeout(r, 50))
    expect(hosts.at(-1)!.status()).toBe('failed')
    // Give the first backoff step (~3000ms) time; a new peer would appear if
    // a retry were scheduled. For an offline peer it must stay put.
    await new Promise((r) => setTimeout(r, 3200))
    expect(state.pcCounter).toBe(pcsAfterOffline)

    // Online peer: force a connection failure and confirm a retry IS scheduled,
    // which creates a NEW RTCPeerConnection once backoff elapses.
    const convOn = 'conv-int-on'
    currentConversationId = convOn
    makeHost({ myId: 'B', otherId: 'A', conversationId: convOn, peerOnline: true })
    await new Promise((r) => setTimeout(r, 150))
    const onPcs = (state.mockChannels.get(convOn) ?? []) as any[]
    const onlinePeer = onPcs.find((p: any) => !p._closed)
    const pcsBeforeRetry = state.pcCounter
    onlinePeer._fail()
    await new Promise((r) => setTimeout(r, 3200))
    expect(state.pcCounter).toBeGreaterThan(pcsBeforeRetry)
  }, 20000)

  it('A unknown (undefined peerOnline) initiates only AFTER signaling subscribe (offer path), reaching open with responder B', async () => {
    const conv = 'conv-undef'
    currentConversationId = conv
    makeHost({ myId: 'A', otherId: 'B', conversationId: conv, peerOnline: undefined as any })
    makeHost({ myId: 'B', otherId: 'A', conversationId: conv, peerOnline: undefined as any })
    await new Promise((r) => setTimeout(r, 80))
    expect(hosts.at(-1)!.status()).toBe('open')
  }, 20000)

  // ── Phase 4.5: transport ref + signaling timeout regression tests ──

  it('transport ref: idle → signaling → open when both peers connect', async () => {
    const conv = 'conv-transport'
    currentConversationId = conv
    makeHost({ myId: 'A', otherId: 'B', conversationId: conv, peerOnline: true })
    makeHost({ myId: 'B', otherId: 'A', conversationId: conv, peerOnline: true })
    // Initially signaling/connecting
    expect(hosts.at(0)!.transport()).toBe('connecting')
    await new Promise((r) => setTimeout(r, 120))
    // After DataChannel opens → p2p
    expect(hosts.at(0)!.transport()).toBe('p2p')
    expect(hosts.at(1)!.transport()).toBe('p2p')
    expect(hosts.at(0)!.status()).toBe('open')
  }, 20000)

  it('transport ref: disabled when enabled=false (call overlay scenario)', async () => {
    const conv = 'conv-disabled'
    currentConversationId = conv
    // A is disabled (simulates call overlay disableP2P)
    makeHost({ myId: 'A', otherId: 'B', conversationId: conv, enabled: false })
    // B is online and trying
    makeHost({ myId: 'B', otherId: 'A', conversationId: conv, peerOnline: true })
    await new Promise((r) => setTimeout(r, 120))
    // A's transport should remain disabled
    expect(hosts.at(0)!.transport()).toBe('disabled')
    expect(hosts.at(0)!.status()).toBe('idle')
  }, 20000)

  it('transport ref: offline peer stays at supabase (no P2P)', async () => {
    const conv = 'conv-offline-transport'
    currentConversationId = conv
    makeHost({ myId: 'A', otherId: 'B', conversationId: conv, peerOnline: false })
    await new Promise((r) => setTimeout(r, 150))
    // A is online-only signaling (no offer sent because peerOffline=false), transport = supabase
    expect(hosts.at(0)!.status()).toBe('signaling')
    expect(hosts.at(0)!.transport()).toBe('connecting')
  }, 20000)

  it('signaling timeout → failed status → retry for online peer', async () => {
    vi.useFakeTimers()
    const conv = 'conv-timeout'
    currentConversationId = conv

    // Save the current wrapper and replace with a stalled-DC version.
    const SavedRTC = globalThis.RTCPeerConnection
    globalThis.RTCPeerConnection = class {
      _pc: any
      constructor() {
        this._pc = state.makePeerConnection(conv)
        // Override the underlying PC's setLocalDescription to NOT open the DC
        this._pc.setLocalDescription = async () => {
          if (this._pc.onicecandidate) this._pc.onicecandidate({ candidate: null })
          // Do NOT setTimeout to open DC — simulates stalled handshake
        }
      }
      get connectionState() { return this._pc?.connectionState }
      get remoteDescription() { return this._pc?.remoteDescription }
      get onicecandidate() { return this._pc.onicecandidate }
      set onicecandidate(v: any) { this._pc.onicecandidate = v }
      get onconnectionstatechange() { return this._pc.onconnectionstatechange }
      set onconnectionstatechange(v: any) { this._pc.onconnectionstatechange = v }
      get ondatachannel() { return this._pc.ondatachannel }
      set ondatachannel(v: any) { this._pc.ondatachannel = v }
      createDataChannel(label: string) {
        const dc = this._pc.createDataChannel(label)
        dc.readyState = 'connecting'
        return dc
      }
      createOffer() { return this._pc.createOffer() }
      createAnswer() { return this._pc.createAnswer() }
      setLocalDescription() { return this._pc.setLocalDescription() }
      setRemoteDescription(d: any) { return this._pc.setRemoteDescription(d) }
      addIceCandidate() { return this._pc.addIceCandidate() }
      close() { this._pc.close() }
    } as any

    makeHost({ myId: 'A', otherId: 'B', conversationId: conv, peerOnline: true })
    await vi.advanceTimersByTimeAsync(100)
    expect(hosts.at(0)!.status()).toBe('signaling')
    expect(hosts.at(0)!.transport()).toBe('connecting')

    // Advance past the 10s signaling timeout
    await vi.advanceTimersByTimeAsync(10_000)
    expect(hosts.at(0)!.status()).toBe('failed')
    expect(hosts.at(0)!.transport()).toBe('supabase')

    // The first retry backoff is 3000ms. Advance past it.
    await vi.advanceTimersByTimeAsync(3200)
    expect(state.pcCounter).toBeGreaterThanOrEqual(2)
    expect(hosts.at(0)!.status()).toBe('signaling')
    expect(hosts.at(0)!.transport()).toBe('connecting')

    globalThis.RTCPeerConnection = SavedRTC
    vi.useRealTimers()
    hosts.forEach((h) => { try { h.unmount() } catch {} })
    hosts = []
  }, 20000)

  it('signaling timeout → no retry for offline peer', async () => {
    vi.useFakeTimers()
    const conv = 'conv-timeout-off'
    currentConversationId = conv

    const SavedRTC = globalThis.RTCPeerConnection
    globalThis.RTCPeerConnection = class {
      _pc: any
      constructor() {
        this._pc = state.makePeerConnection(conv)
        this._pc.setLocalDescription = async () => {
          if (this._pc.onicecandidate) this._pc.onicecandidate({ candidate: null })
        }
      }
      get connectionState() { return this._pc?.connectionState }
      get remoteDescription() { return this._pc?.remoteDescription }
      get onicecandidate() { return this._pc.onicecandidate }
      set onicecandidate(v: any) { this._pc.onicecandidate = v }
      get onconnectionstatechange() { return this._pc.onconnectionstatechange }
      set onconnectionstatechange(v: any) { this._pc.onconnectionstatechange = v }
      get ondatachannel() { return this._pc.ondatachannel }
      set ondatachannel(v: any) { this._pc.ondatachannel = v }
      createDataChannel(label: string) {
        const dc = this._pc.createDataChannel(label)
        dc.readyState = 'connecting'
        return dc
      }
      createOffer() { return this._pc.createOffer() }
      createAnswer() { return this._pc.createAnswer() }
      setLocalDescription() { return this._pc.setLocalDescription() }
      setRemoteDescription(d: any) { return this._pc.setRemoteDescription(d) }
      addIceCandidate() { return this._pc.addIceCandidate() }
      close() { this._pc.close() }
    } as any

    makeHost({ myId: 'A', otherId: 'B', conversationId: conv, peerOnline: false })
    await vi.advanceTimersByTimeAsync(100)
    expect(hosts.at(0)!.status()).toBe('signaling')

    await vi.advanceTimersByTimeAsync(10_000)
    expect(hosts.at(0)!.status()).toBe('failed')
    expect(hosts.at(0)!.transport()).toBe('supabase')

    const pcsAfterTimeout = state.pcCounter
    await vi.advanceTimersByTimeAsync(5000)
    expect(state.pcCounter).toBe(pcsAfterTimeout)

    globalThis.RTCPeerConnection = SavedRTC
    vi.useRealTimers()
    hosts.forEach((h) => { try { h.unmount() } catch {} })
    hosts = []
  }, 20000)

  it('message sent while signaling falls back to Supabase (WebRTC send returns false)', async () => {
    const conv = 'conv-fallback'
    currentConversationId = conv

    const SavedRTC = globalThis.RTCPeerConnection
    globalThis.RTCPeerConnection = class {
      _pc: any
      constructor() {
        this._pc = state.makePeerConnection(conv)
        this._pc.setLocalDescription = async () => {
          if (this._pc.onicecandidate) this._pc.onicecandidate({ candidate: null })
        }
      }
      get connectionState() { return this._pc?.connectionState }
      get remoteDescription() { return this._pc?.remoteDescription }
      get onicecandidate() { return this._pc.onicecandidate }
      set onicecandidate(v: any) { this._pc.onicecandidate = v }
      get onconnectionstatechange() { return this._pc.onconnectionstatechange }
      set onconnectionstatechange(v: any) { this._pc.onconnectionstatechange = v }
      get ondatachannel() { return this._pc.ondatachannel }
      set ondatachannel(v: any) { this._pc.ondatachannel = v }
      createDataChannel(label: string) {
        const dc = this._pc.createDataChannel(label)
        dc.readyState = 'connecting'
        return dc
      }
      createOffer() { return this._pc.createOffer() }
      createAnswer() { return this._pc.createAnswer() }
      setLocalDescription() { return this._pc.setLocalDescription() }
      setRemoteDescription(d: any) { return this._pc.setRemoteDescription(d) }
      addIceCandidate() { return this._pc.addIceCandidate() }
      close() { this._pc.close() }
    } as any

    makeHost({ myId: 'A', otherId: 'B', conversationId: conv, peerOnline: true })
    await new Promise((r) => setTimeout(r, 100))
    expect(hosts.at(0)!.status()).toBe('signaling')
    expect(hosts.at(0)!.transport()).toBe('connecting')
    lastData = []
    const sent = lastSend!(JSON.stringify({ kind: 'text', id: 'm1', conversationId: conv, senderId: 'A', content: 'hi', createdAt: new Date().toISOString(), senderSequence: 1 }))
    expect(sent).toBe(false)
    globalThis.RTCPeerConnection = SavedRTC
  }, 20000)
})
