export function Shimmer({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  return <div aria-hidden className={`shimmer ${className}`} style={style} />
}
