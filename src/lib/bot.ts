export const ZAP_BOT_PROFILE_ID = '6b275e80-98e2-4e09-96b2-cb50a4a64461'
export const ZAP_GUIDE_PROFILE_ID = '5ec6df08-8aa6-4328-a388-42ec172bdd47'

export type BotPersona = {
  id: string
  name: string
  role: string
}

const PERSONAS: BotPersona[] = [
  { id: ZAP_BOT_PROFILE_ID, name: '⚡ ZapBot', role: 'practice partner' },
  { id: ZAP_GUIDE_PROFILE_ID, name: '🧭 ZapGuide', role: 'ShahZap expert · ask me anything' },
]

export function isBotProfile(profileId: string | null | undefined): boolean {
  return profileId === ZAP_BOT_PROFILE_ID || profileId === ZAP_GUIDE_PROFILE_ID
}

export function getBotPersona(profileId: string | null | undefined): BotPersona | null {
  return PERSONAS.find((p) => p.id === profileId) ?? null
}
