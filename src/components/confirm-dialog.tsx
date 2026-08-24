'use client'

export function ConfirmDialog({
  open, title, message, confirmLabel = 'Confirm', onConfirm, onCancel,
}: {
  open: boolean
  title: string
  message?: string
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onCancel}>
      <div role="dialog" aria-modal="true" className="w-full max-w-sm rounded-3xl border border-slate-700 bg-slate-900 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold">{title}</h2>
        {message && <p className="mt-2 text-sm leading-relaxed text-slate-400">{message}</p>}
        <div className="mt-6 flex gap-3">
          <button onClick={onCancel} className="flex-1 rounded-xl border border-slate-700 px-4 py-3 text-sm font-semibold text-slate-300 transition hover:border-slate-500 hover:text-white">
            Cancel
          </button>
          <button onClick={onConfirm} className="flex-1 rounded-xl bg-red-500 px-4 py-3 text-sm font-bold text-white transition hover:bg-red-400">
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
