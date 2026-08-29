/*
 * Per-category notification preferences.
 *
 * Each category maps one or more notification `kind`s (as written to the
 * notifications table by the DB triggers) to a single user-facing toggle.
 * Stored in localStorage under "shahzap:notif-prefs", mirroring how the
 * sound engine persists its own prefs. Used by the notification bell
 * (badge + list) and the global sound listener so disabled categories
 * are neither surfaced nor heard.
 */

export type NotifCategory = 'message' | 'friend_request' | 'block' | 'unfriend' | 'delete_chat'

export type NotifPrefs = Record<NotifCategory, boolean>

const KEY = 'shahzap:notif-prefs'

const CATEGORIES: NotifCategory[] = ['message', 'friend_request', 'block', 'unfriend', 'delete_chat']

const DEFAULTS: NotifPrefs = {
  message: true,
  friend_request: true,
  block: true,
  unfriend: true,
  delete_chat: true,
}

const KIND_TO_CATEGORY: Record<string, NotifCategory> = {
  message: 'message',
  friend_request: 'friend_request',
  accept: 'friend_request',
  reject: 'friend_request',
  withdraw: 'friend_request',
  blocked: 'block',
  unblocked: 'block',
  unfriend: 'unfriend',
  delete_chat: 'delete_chat',
}

export function kindToCategory(kind: string | null | undefined): NotifCategory | null {
  if (!kind) return null
  return KIND_TO_CATEGORY[kind] ?? null
}

export function defaultNotifPrefs(): NotifPrefs {
  return { ...DEFAULTS }
}

export function getNotifPrefs(): NotifPrefs {
  if (typeof window === 'undefined') return defaultNotifPrefs()
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return defaultNotifPrefs()
    const p = JSON.parse(raw) as Partial<NotifPrefs>
    const next = defaultNotifPrefs()
    for (const c of CATEGORIES) {
      if (typeof p[c] === 'boolean') next[c] = p[c] as boolean
    }
    return next
  } catch {
    return defaultNotifPrefs()
  }
}

export function setNotifPrefs(prefs: NotifPrefs): NotifPrefs {
  try { window.localStorage.setItem(KEY, JSON.stringify(prefs)) } catch {}
  return prefs
}

/** True when the given notification kind should be surfaced per prefs. */
export function notifCategoryEnabled(kind: string | null | undefined): boolean {
  const cat = kindToCategory(kind)
  if (!cat) return true
  return getNotifPrefs()[cat]
}
