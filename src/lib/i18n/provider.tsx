'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { createClient } from '@/lib/supabase/client'
import { en, getDictionary, isRtl } from './dictionaries'

const LS_KEY = 'shahzap:interface_language'

type I18nContextValue = {
  /** Look up a dot-path key, e.g. t('settings.appearance.title'). */
  t: (path: string) => string
  /** Current interface language code (e.g. 'en', 'ur', 'ar', 'hi'). */
  lang: string
  dir: 'ltr' | 'rtl'
  /** Persists the choice locally and to the profile, and re-renders the UI. */
  setLang: (lang: string) => void
  /** True once the initial language has been resolved from storage/profile. */
  ready: boolean
}

const I18nContext = createContext<I18nContextValue | null>(null)

function getPath(obj: unknown, path: string): string | undefined {
  let cur: unknown = obj
  for (const part of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return typeof cur === 'string' ? cur : undefined
}

function readStored(): string {
  try {
    const v = window.localStorage.getItem(LS_KEY)
    return v && getDictionary(v) ? v : 'en'
  } catch {
    return 'en'
  }
}

function useClient() {
  return useMemo(() => {
    const supabase = createClient()
    return {
      user: () => supabase.auth.getUser(),
      profileLang: async (userId: string) => {
        const { data } = await supabase
          .from('profiles')
          .select('interface_language')
          .eq('id', userId)
          .maybeSingle()
        return (data as { interface_language?: string | null } | null)?.interface_language ?? undefined
      },
      persist: async (next: string) => {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return
        await supabase.from('profiles').update({ interface_language: next }).eq('id', user.id)
      },
    }
  }, [])
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const supabase = useClient()
  const [lang, setLangState] = useState<string>(() => (typeof window === 'undefined' ? 'en' : readStored()))
  const [ready, setReady] = useState(false)

  useEffect(() => {
    document.documentElement.setAttribute('dir', isRtl(lang) ? 'rtl' : 'ltr')
    document.documentElement.setAttribute('lang', lang)
  }, [lang])

  // Reconcile with the saved profile language on mount.
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const { data: { user } } = await supabase.user()
        if (!user) return
        const p = await supabase.profileLang(user.id)
        if (active && p && p !== lang) setLangState(p)
      } finally {
        if (active) setReady(true)
      }
    })()
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setLang = useCallback(
    (next: string) => {
      if (!getDictionary(next)) return
      setLangState(next)
      try { window.localStorage.setItem(LS_KEY, next) } catch { /* ignore */ }
      void supabase.persist(next)
    },
    [supabase],
  )

  const dict = getDictionary(lang)
  const t = useCallback(
    (path: string) => getPath(dict, path) ?? getPath(en, path) ?? path,
    [dict],
  )

  return (
    <I18nContext.Provider value={{ t, lang, dir: isRtl(lang) ? 'rtl' : 'ltr', setLang, ready }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used within <I18nProvider>')
  return ctx
}

/** Client-side wrapper mounted once at the root layout. */
export function ClientProviders({ children }: { children: ReactNode }) {
  return <I18nProvider>{children}</I18nProvider>
}
