/*
 * Tab-visibility helpers.
 *
 * "Active on the tab" means the ShahZap tab is the one the user is looking at
 * (document.visibilityState === 'visible'). When the user moves to another
 * tab, minimizes, or leaves the PWA, this becomes false and we resume sending
 * native OS push notifications instead of in-app banners/sounds.
 */

export function isTabVisible(): boolean {
  if (typeof document === 'undefined') return false
  return document.visibilityState === 'visible'
}
