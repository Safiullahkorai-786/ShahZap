// Shared, module-level controller so a call overlay can synchronously focus the
// currently-mounted chat composer (e.g. when the user taps the call's Chat
// button on mobile). The synchronous focus inside the tap gesture is what lets
// iOS reliably raise the on-screen keyboard. Falls back to a sessionStorage
// flag for the fresh-mount case (see the chat page).

let focusedComposer: (() => void) | null = null

export function registerChatComposerFocus(fn: (() => void) | null) {
  focusedComposer = fn
}

export function focusChatComposerNow() {
  try { focusedComposer?.() } catch {}
}
