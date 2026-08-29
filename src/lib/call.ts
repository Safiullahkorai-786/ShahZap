// Shared types + constants for the P2P Voice/Video call feature.
//
// Calls use WebRTC Peer-to-Peer. Media flows device-to-device (DTLS-SRTP
// encrypted) and never touches our servers. Supabase Realtime is used purely
// as a lightweight signaling bus to exchange the initial SDP offer/answer and
// ICE candidates before the P2P connection is established.

export type CallMode = 'audio' | 'video'

export type CallStatus = 'idle' | 'outgoing' | 'incoming' | 'active' | 'ended'

export type SignalMessage =
  | { type: 'call'; mode: CallMode; token: string; conversationId?: string }
  | { type: 'accept'; token: string }
  | { type: 'reject'; token: string }
  | { type: 'cancel'; token: string }
  | { type: 'hangup'; token: string }
  | { type: 'offer'; sdp: RTCSessionDescriptionInit; token: string }
  | { type: 'answer'; sdp: RTCSessionDescriptionInit; token: string }
  | { type: 'ice'; candidate: RTCIceCandidateInit; token: string }
  | { type: 'mute'; muted: boolean; token: string }
  | { type: 'video'; on: boolean; token: string }

// Free public STUN servers for NAT discovery. Server overhead stays ~zero
// because all media flows P2P and STUN is a lightweight, stateless lookup.
export const ICE_SERVERS: RTCConfiguration['iceServers'] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
]

export const RING_MS = 30_000
export const CALL_TIMEOUT_MS = 30_000
