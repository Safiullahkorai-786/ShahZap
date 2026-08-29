/*
 * Banner notification display preferences.
 *
 * Lets users control how notification banners behave:
 *   • duration — how long a banner stays up (seconds), or 'never' to keep
 *     it until dismissed by swiping / tapping the ✕.
 *   • stack — how multiple banners are laid out:
 *       'single'         one at a time; the next waits for the current
 *                        one to disappear (current default behaviour).
 *       'stack-new-top'  a column; a new banner appears on top of the
 *                        existing ones and pushes them down.
 *       'stack-new-bottom' a column; existing banners stay on top and the
 *                        new banner stacks below them.
 *
 * Stored in localStorage under "shahzap:notif-display".
 */

export type BannerDuration = number | 'never'
export type BannerStackMode = 'single' | 'stack-new-top' | 'stack-new-bottom'

/**
 * How incoming calls are surfaced to the user:
 *   'overlay' — the full-screen ring (accept / decline big buttons), default.
 *   'banner'  — an in-app notification banner with Answer / Decline instead of
 *               the full-screen ring (the active call UI still uses the overlay).
 */
export type CallNotifyStyle = 'overlay' | 'banner'

export type NotifDisplayPrefs = {
  duration: BannerDuration
  stack: BannerStackMode
  /** Master switch for the in-app toast banners (sound/bell unaffected). */
  showBanner: boolean
  callNotify: CallNotifyStyle
}

export const BANNER_DURATIONS: BannerDuration[] = [3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 'never']

export const BANNER_STACK_MODES: BannerStackMode[] = ['single', 'stack-new-top', 'stack-new-bottom']

export const CALL_NOTIFY_STYLES: CallNotifyStyle[] = ['overlay', 'banner']

const KEY = 'shahzap:notif-display'

export function defaultNotifDisplayPrefs(): NotifDisplayPrefs {
  return { duration: 6, stack: 'single', showBanner: true, callNotify: 'overlay' }
}

export function getNotifDisplayPrefs(): NotifDisplayPrefs {
  if (typeof window === 'undefined') return defaultNotifDisplayPrefs()
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return defaultNotifDisplayPrefs()
    const p = JSON.parse(raw) as Partial<NotifDisplayPrefs>
    const next = defaultNotifDisplayPrefs()
    const dur = p.duration
    if (
      dur !== undefined &&
      (dur === 'never' || BANNER_DURATIONS.includes(dur as BannerDuration))
    ) {
      next.duration = dur
    }
    if (BANNER_STACK_MODES.includes(p.stack as BannerStackMode)) {
      next.stack = p.stack as BannerStackMode
    }
    if (typeof p.showBanner === 'boolean') next.showBanner = p.showBanner
    if (CALL_NOTIFY_STYLES.includes(p.callNotify as CallNotifyStyle)) {
      next.callNotify = p.callNotify as CallNotifyStyle
    }
    return next
  } catch {
    return defaultNotifDisplayPrefs()
  }
}

export function setNotifDisplayPrefs(prefs: NotifDisplayPrefs): NotifDisplayPrefs {
  try { window.localStorage.setItem(KEY, JSON.stringify(prefs)) } catch {}
  window.dispatchEvent(new CustomEvent('shahzap:notif-display-change', { detail: prefs }))
  return prefs
}

/** ms to keep a banner up for a duration value; null = stay until dismissed. */
export function durationToMs(duration: BannerDuration): number | null {
  return duration === 'never' ? null : duration * 1000
}