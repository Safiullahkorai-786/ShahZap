type SupabaseError = {
  message?: string | null
  code?: string | null
  details?: string | null
  hint?: string | null
}

function rawMessage(error: unknown): string {
  if (!error) return ''
  if (typeof error === 'string') return error
  const candidate = error as SupabaseError
  return candidate.message ?? ''
}

function errorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return ''
  return (error as SupabaseError).code ?? ''
}

export function friendlyError(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (!error) return fallback
  const raw = rawMessage(error)
  const code = errorCode(error)

  if (/friend_requests_pending_unique/i.test(raw)) {
    return "You've already sent a friend request to this member."
  }
  if (code === '23505' || /duplicate key|unique constraint/i.test(raw)) {
    return 'That already exists.'
  }
  if (code === '23514' && /friend_requests|sender_id/i.test(raw)) {
    return "You can't send a friend request to yourself."
  }
  if (code === '23503' || /violates foreign key/i.test(raw)) {
    return 'That member is no longer available.'
  }
  if (code === '42501' || /row-level security|permission denied/i.test(raw)) {
    return "You don't have permission to do that."
  }
  if (code === 'P0001') {
    return raw || fallback
  }
  if (/jwt|expired token|invalid claim/i.test(raw)) {
    return 'Your session expired. Please sign in again.'
  }
  if (/failed to fetch|networkerror|fetch failed|load failed|network request failed/i.test(raw)) {
    return 'Connection problem. Please check your internet and try again.'
  }
  if (/relation .* does not exist|schema cache|could not find the table/i.test(raw)) {
    return 'This feature is temporarily unavailable. Please try again later.'
  }
  return fallback
}
