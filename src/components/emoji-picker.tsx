'use client'

import { useState } from 'react'

/*
 * Free forever "premium" emoji board — vibe-first Gen-Z packs, classic
 * smileys/gestures/hearts/fun, animals, sports and the whole world's
 * flags. Buttons swallow pointerdown so tapping never dismisses keyboard.
 */

// Every ISO-3166 flag, generated from codes so no sequence can be mistyped.
const FLAG_CODES = [
  'ad', 'ae', 'af', 'ag', 'ai', 'al', 'am', 'ao', 'aq', 'ar', 'as', 'at', 'au', 'aw', 'ax', 'az',
  'bb', 'bd', 'be', 'bf', 'bg', 'bh', 'bi', 'bj', 'bl', 'bm', 'bn', 'bo', 'br', 'bs', 'bt', 'bv', 'bw', 'by', 'bz',
  'ca', 'cc', 'cd', 'cf', 'cg', 'ch', 'ci', 'ck', 'cl', 'cm', 'cn', 'co', 'cr', 'cu', 'cv', 'cw', 'cx', 'cy', 'cz',
  'de', 'dj', 'dk', 'dm', 'do', 'dz', 'ec', 'ee', 'eg', 'eh', 'er', 'es', 'et', 'fi', 'fj', 'fk', 'fm', 'fo', 'fr',
  'ga', 'gb', 'gd', 'ge', 'gf', 'gg', 'gh', 'gi', 'gl', 'gm', 'gn', 'gp', 'gq', 'gr', 'gs', 'gt', 'gu', 'gw', 'gy',
  'hk', 'hm', 'hn', 'hr', 'ht', 'hu', 'ic', 'id', 'ie', 'im', 'in', 'io', 'iq', 'ir', 'is', 'it', 'je', 'jm', 'jo', 'jp',
  'ke', 'kg', 'kh', 'ki', 'km', 'kn', 'kp', 'kr', 'kw', 'ky', 'kz', 'la', 'lb', 'lc', 'li', 'lk', 'lr', 'ls', 'lt', 'lu', 'lv', 'ly',
  'ma', 'mc', 'md', 'me', 'mf', 'mg', 'mh', 'mk', 'ml', 'mm', 'mn', 'mo', 'mp', 'mq', 'mr', 'ms', 'mt', 'mu', 'mv', 'mw', 'mx', 'my', 'mz',
  'na', 'nc', 'ne', 'nf', 'ng', 'ni', 'nl', 'no', 'np', 'nr', 'nu', 'nz', 'om', 'pa', 'pe', 'pf', 'pg', 'ph', 'pk', 'pl', 'pm', 'pn', 'pr', 'ps', 'pt', 'pw', 'py',
  'qa', 're', 'ro', 'rs', 'ru', 'rw', 'sa', 'sb', 'sc', 'sd', 'se', 'sg', 'sh', 'si', 'sj', 'sk', 'sl', 'sm', 'sn', 'so', 'sr', 'ss', 'st', 'sv', 'sx', 'sy', 'sz',
  'tc', 'td', 'tf', 'tg', 'th', 'tj', 'tk', 'tl', 'tm', 'tn', 'to', 'tr', 'tt', 'tv', 'tw', 'tz', 'ua', 'ug', 'um', 'un', 'us', 'uy', 'uz',
  'va', 'vc', 've', 'vg', 'vi', 'vn', 'vu', 'wf', 'ws', 'ye', 'yt', 'za', 'zm', 'zw',
]
const COUNTRY_FLAGS = FLAG_CODES.map(
  (c) => String.fromCodePoint(...[...c.toUpperCase()].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65)),
)

const CATEGORIES: { id: string; label: string; items: string[] }[] = [
  {
    id: 'genz',
    label: '🔥 Gen-Z',
    items: ['💀', '🤡', '🔥', '✨', '😭', '💅', '🫶', '🫡', '🗿', '🧿', '🌚', '🌝', '🌛', '🌜', '🌙', '😈', '😩', '🥵', '🥶', '😌', '💯', '👀', '🤌', '🚩', '💀💀', '😭😭', '🔥🔥', '💅✨', '👀👀', '🤙', '🙃', '🫠', '🫥', '😵‍💫'],
  },
  {
    id: 'playful',
    label: '😏 Playful',
    items: ['😏', '😉', '😜', '🤭', '😳', '😈', '🔥', '🍑', '🍒', '🌶️', '💦', '👄', '💋', '🫦', '❤️‍🔥', '😌', '🫣', '🙈', '😇', '💃', '🕺', '🍸', '🍷', '🥂', '🌹', '🛁', '🕯️', '🧸', '💍', '🎭'],
  },
  {
    id: 'soft_aesthetic',
    label: '🎀 Soft/Cute',
    items: ['✨', '🫶', '🎀', '🧸', '🌸', '🍰', '🩰', '🐈‍⬛', '☁️', '🎧', '⭐', '🍀'],
  },
  {
    id: 'gossip_tea',
    label: '☕ The Tea',
    items: ['🍵', '👀', '🗣️', '🤭', '🤫', '💅', '🍿', '📝', '👂', '🤔', '🚨', '👀👀'],
  },
  {
    id: 'existential_dread',
    label: '🫥 Doom Scroll',
    items: ['🫥', '🫠', '😵‍💫', '💀', '😭', '📉', '🌪️', '🖤', '🏚️', '🌧️', '🚬', '🤡'],
  },
  {
    id: 'corporate_irony',
    label: '💼 Corporate/Work',
    items: ['🫠', '💀', '🫡', '🤡', '🚩', '🤝', '📈', '☕', '😭', '🚨', '🙃', '💨'],
  },
  {
    id: 'gamer_rage',
    label: '🎮 Gamer/Hype',
    items: ['🔥', '💀', '💯', '👾', '🐐', '😤', '🤬', '🛑', '🥶', '👑', '🤝', '📉'],
  },
  {
    id: 'smileys',
    label: '😀 Smileys',
    items: ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😙', '🥲', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '😮‍💨', '🤥', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🥴', '😵', '🤯', '🤠', '🥳', '🥸', '😎', '🤓', '🧐', '😕', '😟', '🙁', '😯', '😦', '😧', '😮', '😲', '🥺', '😢', '😭', '😱', '😖', '😞', '😤', '😠', '😡', '🤬', '👻', '👽', '🤖', '💩'],
  },
  {
    id: 'gestures',
    label: '👍 Gestures',
    items: ['👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '✍️', '💪', '🦾', '🫵', '🫱', '🫲'],
  },
  {
    id: 'hearts',
    label: '❤️ Hearts',
    items: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '♥️', '💌', '🫀', '🫂', '💋'],
  },
  {
    id: 'fun',
    label: '🎉 Fun',
    items: ['🎉', '🎊', '🎁', '🌟', '⚡', '🔮', '🎮', '🍿', '🎧', '🎸', '📸', '💻', '🚀', '🏆', '🥇', '💎', '💸', '🍕', '🍔', '🌮', '☕', '🍩', '🍦', '🍫', '🎂', '🥟', '🍜', '🍣', '🥗', '🍉', '🥑', '🍄'],
  },
  {
    id: 'animals',
    label: '🐼 Animals',
    items: ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🐔', '🐧', '🐦', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗', '🐴', '🦄', '🐝', '🐛', '🦋', '🐌', '🐞', '🐜', '🐢', '🐍', '🦖', '🐙', '🦑', '🦐', '🐬', '🐳', '🐟', '🦈', '🐊', '🐘', '🦒', '🦓', '🐎', '🐄', '🌵', '🌴', '🌲', '🌸', '🌺', '🌻', '🌷', '🍀'],
  },
  {
    id: 'sports',
    label: '⚽ Sports',
    items: ['⚽', '🏀', '🏈', '⚾', '🎾', '🏐', '🏉', '🥏', '🎱', '🏓', '🏸', '🥊', '🥋', '⛳', '🏹', '🎣', '🤿', '🎿', '🛷', '🥌', '🏂', '🏋️', '🤸', '⛹️', '🤺', '🏇', '🧘', '🏄', '🏊', '🚴', '🚵', '🛹', '🛼', '🏃', '🏅', '🎖️', '🥇', '🥈', '🥉', '🏆'],
  },
  {
    id: 'flags',
    label: '🏳️ Flags',
    items: ['🏁', '🚩', '🏳️', '🏴', '🏴‍☠️', '🏳️‍🌈', '🏳️‍⚧️', '🏴󠁧󠁢󠁥󠁮󠁧󠁿', '🏴󠁧󠁢󠁳󠁣󠁴󠁿', '🏴󠁧󠁢󠁷󠁬󠁳󠁿', ...COUNTRY_FLAGS],
  },
  {
    id: 'emoticons',
    label: '(͡° ͜ʖ ͡°) Emoticons',
    items: ['¯\\_(ツ)_/¯', '(͡° ͜ʖ ͡°)', 'ಠ_ಠ', '(☞ﾟヮﾟ)☞', '☜(ﾟヮﾟ☜)', '^_^', '^-^', '^o^', '(•‿•)', '(︶︹︺)', '(T_T)', '(ಥ﹏ಥ)', 'ヽ(°〇°)ﾉ', '┌(・。・)┘♪', '(╯°□°）╯︵ ┻━┻', '┬─┬ ノ( ゜-゜ノ)', '(づ｡◕‿‿◕｡)づ', '(>‿◠)✌', '(¬‿¬)', '(=^･ω･^=)', 'ʕ•ᴥ•ʔ', '(◍•ᴗ•◍)❤', 'ヾ(≧▽≦*)o', '~(˘▾˘~)', 'ᕕ( ᐛ )ᕗ', '(⌐■_■)', 'ʕ•̀ω•́ʔ✧', "(ง'̀-'́)ง", 'ᕦᕤ', '( ͡ᵔ ͜ʖ ͡ᵔ )', '(◔◡◔)', '(•_•) ( •_•)>⌐■-■ (⌐■_■)', '٩(◕‿◕)۶', '(っ˘̩╭╮˘̩)っ', 'ヽ(´▽`)/', '(⊙_⊙)'],
  },
]

export function EmojiPicker({ onPick }: { onPick: (item: string) => void }) {
  const [cat, setCat] = useState(CATEGORIES[0].id)
  const active = CATEGORIES.find((c) => c.id === cat) ?? CATEGORIES[0]
  const isKaomoji = active.id === 'emoticons'
  return (
    <div className="mb-2 overflow-hidden rounded-2xl border border-slate-700 bg-slate-950 shadow-xl shadow-black/40">
      <div className="flex items-center gap-1 overflow-x-auto border-b border-slate-800 px-1.5 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {CATEGORIES.map((c) => (
          <button key={c.id} type="button"
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => setCat(c.id)}
            className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold transition ${c.id === cat ? 'bg-cyan-400/15 text-cyan-200 ring-1 ring-cyan-400/40' : 'text-slate-400 hover:text-white'}`}>
            {c.label}
          </button>
        ))}
      </div>
      {isKaomoji ? (
        // Text faces get roomy two-column cards — no cramming.
        <div className="grid max-h-44 grid-cols-2 gap-1.5 overflow-y-auto p-2 sm:grid-cols-3">
          {active.items.map((item, i) => (
            <button key={`${item}-${i}`} type="button"
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => onPick(item)}
              title={item}
              className="flex min-h-[38px] items-center justify-center rounded-xl bg-slate-900/70 px-2.5 py-2 text-center text-xs leading-relaxed text-slate-200 ring-1 ring-slate-800 transition hover:bg-slate-800 hover:text-white active:scale-95">
              <span className="[overflow-wrap:anywhere]">{item}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="grid max-h-44 grid-cols-8 gap-0.5 overflow-y-auto p-1.5 sm:grid-cols-10">
          {active.items.map((item, i) => (
            <button key={`${item}-${i}`} type="button"
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => onPick(item)}
              title={item}
              className={`flex h-9 items-center justify-center rounded-lg transition hover:bg-slate-800 active:scale-90 ${item.length > 3 ? 'px-0.5 text-[11px] leading-none text-slate-200' : 'text-xl'}`}>
              {item}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
