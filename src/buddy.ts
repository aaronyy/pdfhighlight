export type Mood =
  | 'hi'
  | 'smile'
  | 'love'
  | 'peace'
  | 'cool'
  | 'sleepy'
  | 'surprised'
  | 'annoyed'
  | 'yum'
  | 'working'
  | 'thinking'
  | 'fighting'
  | 'shy'
  | 'noodles'
  | 'angry'
  | 'cozy'

const TOUR: Mood[] = [
  'hi',
  'smile',
  'love',
  'peace',
  'cool',
  'sleepy',
  'surprised',
  'annoyed',
  'yum',
  'working',
  'thinking',
  'fighting',
  'shy',
  'noodles',
  'angry',
  'cozy',
]

const LINES: Record<Mood, string[]> = {
  hi: ['hi! drop a paper on me', 'hey! open a PDF and let’s mark it up'],
  smile: ['nice highlight', 'that line is going in the notes'],
  love: ['margin note. cute', 'writing in the margins. i love that'],
  peace: ['underline. chill pick', 'underlined. we come in peace'],
  cool: ['strike. ice cold', 'yeah that sentence is cancelled'],
  sleepy: ['still there?', 'i can nap on this methods section'],
  surprised: ['ooh a PDF', 'wait. that actually loaded'],
  annoyed: ['ok deleted', 'fine. that mark is gone'],
  yum: ['pink is a snack', 'this color tastes like boba'],
  working: ['opening the paper…', 'rendering pages. one sec'],
  thinking: ['hm. new tool', 'custom RGB. science'],
  fighting: ['downloaded. we did it', 'annotated PDF. fighting!'],
  shy: ['don’t look at my note', 'i just moved that a little'],
  noodles: ['five marks. lunch break?', 'this paper is a whole bowl'],
  angry: ['nothing to download yet', 'open a PDF first!!'],
  cozy: ['i live here now', 'hoodie mode. keep highlighting'],
}

const PRESET_MOOD: Record<string, Mood> = {
  Yellow: 'smile',
  Green: 'noodles',
  Blue: 'cool',
  Pink: 'yum',
  Purple: 'love',
}

export class Buddy {
  private root: HTMLElement
  private faces: [HTMLImageElement, HTMLImageElement]
  private front = 0
  private bubble: HTMLElement
  private mood: Mood | null = null
  private tourAt = 0
  private idleTimer = 0
  private longIdleTimer = 0

  constructor(host: HTMLElement) {
    this.root = document.createElement('aside')
    this.root.className = 'buddy'
    this.root.innerHTML = `
      <div class="buddy-bubble" data-bubble>hi! drop a paper on me</div>
      <button type="button" class="buddy-sticker" title="An. Click to cycle faces.">
        <span class="buddy-faces">
          <img alt="" width="168" height="168" />
          <img alt="" width="168" height="168" />
        </span>
        <span class="buddy-tag">An</span>
      </button>
    `
    host.append(this.root)
    const imgs = [...this.root.querySelectorAll('img')]
    this.faces = [imgs[0], imgs[1]]
    this.bubble = this.root.querySelector('[data-bubble]')!
    this.root.querySelector('button')!.addEventListener('click', () => this.tour())
    for (const mood of TOUR) {
      const preload = new Image()
      preload.src = srcFor(mood)
    }
    this.set('hi')
    this.armIdle()
    document.addEventListener('pointerdown', () => this.armIdle(), { passive: true })
  }

  set(mood: Mood, line?: string): void {
    this.bubble.textContent = line ?? pick(LINES[mood])
    this.root.dataset.mood = mood
    this.armIdle()
    if (this.mood === mood) return
    this.mood = mood
    const incoming = this.faces[1 - this.front]
    const outgoing = this.faces[this.front]
    incoming.alt = mood
    incoming.src = srcFor(mood)
    const reveal = () => {
      incoming.classList.add('show')
      outgoing.classList.remove('show')
    }
    if (incoming.complete) reveal()
    else void incoming.decode().then(reveal).catch(reveal)
    this.front = 1 - this.front
  }

  greet(hasDoc: boolean): void {
    this.set(hasDoc ? 'cozy' : 'hi', hasDoc ? 'welcome back. your marks are here' : undefined)
  }

  opening(): void {
    this.set('working')
  }

  opened(): void {
    this.set('surprised', 'paper’s in. highlight away')
  }

  tool(tool: string): void {
    if (tool === 'highlight') this.set('thinking', 'highlighter ready')
    else if (tool === 'underline') this.set('peace')
    else if (tool === 'strikethrough') this.set('cool')
    else this.set('shy', 'click the page to leave a note')
  }

  color(name?: string): void {
    if (name && PRESET_MOOD[name]) this.set(PRESET_MOOD[name], colorLine(name))
    else this.set('thinking', 'new color. let’s go')
  }

  marked(kind: string, total: number): void {
    if (total >= 5 && kind === 'highlight') {
      this.set('noodles')
      return
    }
    if (kind === 'highlight') this.set('smile')
    else if (kind === 'underline') this.set('peace')
    else if (kind === 'strikethrough') this.set('cool')
    else this.set('love')
  }

  selected(): void {
    this.set('shy', 'tap delete if that one’s out')
  }

  moved(): void {
    this.set('shy')
  }

  deleted(): void {
    this.set('annoyed')
  }

  cleared(): void {
    this.set('annoyed', 'blank page. kinda relaxing')
  }

  zoomed(percent: number): void {
    this.set('thinking', `${percent}% · pinch of zoom`)
  }

  downloading(): void {
    this.set('fighting')
  }

  nothingToDownload(): void {
    this.set('angry')
  }

  private tour(): void {
    const mood = TOUR[this.tourAt % TOUR.length]
    this.tourAt += 1
    this.set(mood, `${mood} · ${this.tourAt}/${TOUR.length}`)
  }

  private armIdle(): void {
    window.clearTimeout(this.idleTimer)
    window.clearTimeout(this.longIdleTimer)
    this.idleTimer = window.setTimeout(() => this.set('sleepy'), 22000)
    this.longIdleTimer = window.setTimeout(() => this.set('cozy'), 50000)
  }
}

function srcFor(mood: Mood): string {
  return `${import.meta.env.BASE_URL}buddy/${mood}.png`
}

function pick(lines: string[]): string {
  return lines[Math.floor(Math.random() * lines.length)]
}

function colorLine(name: string): string {
  if (name === 'Pink') return 'pink. yum'
  if (name === 'Purple') return 'purple. i’m blushing'
  if (name === 'Blue') return 'blue is cool actually'
  if (name === 'Green') return 'green. kinda noodle-y'
  return 'classic yellow. chef’s kiss'
}
