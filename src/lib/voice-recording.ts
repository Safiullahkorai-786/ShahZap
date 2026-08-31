'use client'

// Voice note recording module.
// Uses MediaRecorder API to capture audio, returns a Blob ready for transfer.

export type VoiceRecording = {
  blob: Blob
  durationMs: number
  mimeType: string
}

let mediaRecorder: MediaRecorder | null = null
let audioChunks: Blob[] = []
let startTime = 0

export async function startRecording(): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  // Prefer webm/opus for small file size, fall back to whatever is available
  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm'
  mediaRecorder = new MediaRecorder(stream, { mimeType })
  audioChunks = []
  startTime = Date.now()
  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) audioChunks.push(e.data)
  }
  mediaRecorder.start(100) // collect data every 100ms for progress
}

export function stopRecording(): Promise<VoiceRecording> {
  return new Promise((resolve, reject) => {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
      reject(new Error('No active recording'))
      return
    }
    mediaRecorder.onstop = () => {
      const durationMs = Date.now() - startTime
      const blob = new Blob(audioChunks, { type: mediaRecorder!.mimeType })
      const result: VoiceRecording = { blob, durationMs, mimeType: mediaRecorder!.mimeType }
      // Cleanup
      mediaRecorder!.stream.getTracks().forEach((t) => t.stop())
      mediaRecorder = null
      audioChunks = []
      resolve(result)
    }
    mediaRecorder.stop()
  })
}

export function isRecording(): boolean {
  return mediaRecorder?.state === 'recording'
}

export function cancelRecording(): void {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stream.getTracks().forEach((t) => t.stop())
    mediaRecorder = null
    audioChunks = []
  }
}
