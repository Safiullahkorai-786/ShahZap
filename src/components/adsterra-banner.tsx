'use client'

/*
 * Adsterra display banner (account 3436789, website 6001372).
 *
 * Loads the per-size banner keys from /api/ads/config once (cached
 * module-wide), then injects the matching invoke script. Renders nothing
 * when a size is not configured, so it is safe to mount anywhere.
 *
 * Keep placements minimal by design — a few slots only.
 */

import { useEffect, useRef, useState } from 'react'

export type BannerSize = '728x90' | '300x250' | '160x600'

const SIZES: Record<BannerSize, { width: number; height: number }> = {
  '728x90': { width: 728, height: 90 },
  '300x250': { width: 300, height: 250 },
  '160x600': { width: 160, height: 600 },
}

type AdsConfig = { enabled: boolean; rewarded: boolean; banners: Record<BannerSize, string> }

let configPromise: Promise<AdsConfig | null> | null = null

function loadConfig(): Promise<AdsConfig | null> {
  if (!configPromise) {
    configPromise = fetch('/api/ads/config')
      .then((res) => res.json() as Promise<AdsConfig>)
      .catch(() => null)
  }
  return configPromise
}

export function AdsterraBanner({ size = '728x90', className = '' }: { size?: BannerSize; className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [key, setKey] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void loadConfig().then((config) => {
      if (active) setKey(config?.banners?.[size] ?? '')
    })
    return () => {
      active = false
    }
  }, [size])

  useEffect(() => {
    const container = containerRef.current
    if (!key || !container) return
    const { width, height } = SIZES[size]

    ;(window as unknown as Record<string, unknown>).atOptions = {
      key,
      format: 'iframe',
      height,
      width,
      params: {},
    }

    container.innerHTML = ''
    const invoke = document.createElement('script')
    invoke.type = 'text/javascript'
    invoke.src = `https://www.highrevenueformat.com/${encodeURIComponent(key)}/invoke.js`
    container.appendChild(invoke)

    return () => {
      container.innerHTML = ''
      delete (window as unknown as Record<string, unknown>).atOptions
    }
  }, [key, size])

  if (!key) return null
  const { width, height } = SIZES[size]
  return (
    <div
      ref={containerRef}
      aria-label="Sponsored"
      className={`mx-auto overflow-hidden ${className}`}
      style={{ width: '100%', maxWidth: width, height }}
    />
  )
}

// Shared hook for components that need to know whether rewarded ads are live.
export function useRewardedAdsEnabled(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  useEffect(() => {
    let active = true
    void loadConfig().then((config) => {
      if (active) setEnabled(config ? config.enabled && config.rewarded : false)
    })
    return () => {
      active = false
    }
  }, [])
  return enabled
}
