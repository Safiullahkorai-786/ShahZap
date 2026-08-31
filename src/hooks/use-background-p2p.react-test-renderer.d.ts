// Minimal ambient types for react-test-renderer, used only by the WebRTC hook
// tests. The package ships without bundled types (and @types/react-test-renderer
// is deprecated), so we declare just the surface these tests use.
declare module 'react-test-renderer' {
  export function create(element: React.ReactElement): any
  export function act(callback: () => void | Promise<void>): void | Promise<void>
}
