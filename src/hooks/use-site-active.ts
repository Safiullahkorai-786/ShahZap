'use client'

import { useEffect, useState } from 'react'

const CHANNEL_NAME = 'shahzap-site-visibility'
const STORAGE_KEY = 'shahzap:site-active'
const ACTIVE_TTL_MS = 5000

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
  const [active, setActive] = useState(false)

  useEffect(() => {
    const update = () => setActive(readActive())
    update()

    const onVis = () => {
      const nowVisible = document.visibilityState === 'visible'
      writeActive(nowVisible)
      setActive(nowVisible)
      bc?.postMessage({ type: 'visibility', active: nowVisible })
    }

    const onFocus = () => {
      writeActive(true)
      setActive(true)
      bc?.postMessage({ type: 'visibility', active: true })
    }

    const onBlur = () => {
      if (document.visibilityState === 'hidden') {
        writeActive(false)
        setActive(false)
        bc?.postMessage({ type: 'visibility', active: false })
      }
    }

    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'visibility' && typeof e.data.active === 'boolean') {
        setActive(e.data.active)
      }
    }

    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    bc?.addEventListener('message', onMessage)

    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
      bc?.removeEventListener('message', onMessage)
    }
  }, [])

  return active
}