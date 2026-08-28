'use client'

import { useEffect, useState } from 'react'

const CHANNEL_NAME = 'shahzap-site-visibility'
const STORAGE_KEY = 'shahzap:site-active'
const ACTIVE_TTL_MS = 5000
const HEARTBEAT_MS = 2000
const GRACE_MS = 400

function readActive(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return false
    const { ts } = JSON.parse(raw)
    return Date.now() - ts < ACTIVE_TTL_MS
  } catch {
    return false
  }
}

function writeActive(active: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ts: active ? Date.now() : 0 }))
  } catch {}
}

let bc: BroadcastChannel | null = null
if (typeof window !== 'undefined') {
  try {
    bc = new BroadcastChannel(CHANNEL_NAME)
  } catch {}
}

export function useSiteActive(): boolean {
  const [active, setActive] = useState(() => readActive())

  useEffect(() => {
    let graceTimer: number | undefined
    let iv: number | undefined

    const mark = (a: boolean) => {
      writeActive(a)
      setActive(a)
      bc?.postMessage({ type: 'visibility', active: a })
    }

    // While this tab is visible, keep a fresh heartbeat so other tabs (and a
    // fresh chat-page mount) always read an up-to-date "active" timestamp.
    const beat = () => {
      if (document.visibilityState === 'visible') {
        writeActive(true)
        setActive(true)
      }
    }
    iv = window.setInterval(beat, HEARTBEAT_MS)

    const onVis = () => {
      if (document.visibilityState === 'visible') {
        mark(true)
      } else {
        // Tab left the screen: give another tab a moment to refresh its
        // heartbeat before this tab decides the whole site went inactive.
        window.clearTimeout(graceTimer)
        graceTimer = window.setTimeout(() => setActive(readActive()), GRACE_MS)
      }
    }

    const onFocus = () => mark(true)
    const onBlur = () => {
      if (document.visibilityState === 'hidden') {
        window.clearTimeout(graceTimer)
        graceTimer = window.setTimeout(() => setActive(readActive()), GRACE_MS)
      }
    }

    const onMessage = (e: MessageEvent) => {
      const d = e.data
      if (!d || !d.type) return
      if (d.type === 'visibility') {
        if (d.active === true) {
          writeActive(true)
          setActive(true)
        } else if (document.visibilityState !== 'visible') {
          // Another tab went hidden; only downgrade if this tab is also hidden.
          setActive(readActive())
        }
      }
    }

    // Do NOT force active here: the initial value comes from the persisted
    // heartbeat freshness (readActive). If the site was recently active we
    // start active; if it's been idle (tabs closed), we start inactive and the
    // beat() below flips it back on the moment this tab is visible + online.

    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    bc?.addEventListener('message', onMessage)

    return () => {
      window.clearTimeout(graceTimer)
      if (iv) window.clearInterval(iv)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
      bc?.removeEventListener('message', onMessage)
    }
  }, [])

  return active
}