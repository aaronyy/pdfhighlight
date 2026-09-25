export type Mood =
  | 'good_morning'
  | 'hug'
  | 'kiss'
  | 'chill'
  | 'cuddle'
  | 'omg'
  | 'side_eye'
  | 'cool'
  | 'work_mode'
  | 'sleepy'
  | 'peace'
  | 'coffee_time'
  | 'my_baby'
  | 'grumpy'
  | 'love_you'
  | 'blanket'

const TOUR: Mood[] = [
  'good_morning',
  'hug',
  'kiss',
  'chill',
  'cuddle',
  'omg',
  'side_eye',
  'cool',
  'work_mode',
  'sleepy',
  'peace',
  'coffee_time',
  'my_baby',
  'grumpy',
  'love_you',
  'blanket',
]

const LINES: Record<Mood, string[]> = {
  good_morning: ['good morning. drop a paper on me', 'hey. open a PDF and let’s mark it up'],
  hug: ['welcome back. your marks are here', 'got you. keep going'],
  kiss: ['nice highlight', 'that line is going in the notes'],
  chill: ['underline. chill pick', 'chill. we can mark this slowly'],
  cuddle: ['margin note. stay close', 'writing in the margins. cute'],
  omg: ['omg. a PDF', 'wait. that actually loaded'],
  side_eye: ['hm. looking at this bit', 'side eye. that mark is suspicious'],
  cool: ['strike. ice cold', 'yeah that sentence is cancelled'],
  work_mode: ['work mode. opening the paper', 'rendering pages. one sec'],
  sleepy: ['still there?', 'zzz. i can nap on this methods section'],
  peace: ['underlined. peace', 'peace. that line stays'],
  coffee_time: ['five marks. coffee break?', 'this paper is a whole cup'],
  my_baby: ['don’t look. i just moved that', 'scooted it. my baby'],
  grumpy: ['ok deleted', 'fine. that mark is gone'],
  love_you: ['downloaded. love you', 'annotated PDF. we did it'],
  blanket: ['blanket mode. keep highlighting', 'i live here now'],
}

export class Buddy {
  private root: HTMLElement
  private faces: [HTMLImageElement, HTMLImageElement]
  private front = 0
  private bubble: HTMLElement
  private mood: Mood | null = null
  private idleTimer = 0
  private longIdleTimer = 0

  constructor(host: HTMLElement) {
    this.root = document.createElement('aside')
    this.root.className = 'buddy'
    this.root.innerHTML = `
      <div class="buddy-bubble" data-bubble>good morning. drop a paper on me</div>
      <button type="button" class="buddy-sticker" title="An. Click to cycle stickers.">
        <span class="buddy-faces">
          <img alt="" width="88" height="88" />
          <img alt="" width="88" height="88" />
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
    this.set('good_morning')
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
    incoming.alt = label(mood)
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
    this.set(hasDoc ? 'hug' : 'good_morning', hasDoc ? 'welcome back. your marks are here' : undefined)
  }

  opening(): void {
    this.set('work_mode')
  }

  opened(): void {
    this.set('omg', 'omg. paper’s in. highlight away')
  }

  tool(tool: string): void {
    if (tool === 'highlight') this.set('side_eye', 'highlighter ready')
    else if (tool === 'underline') this.set('chill')
    else if (tool === 'strikethrough') this.set('cool')
    else this.set('my_baby', 'click the page. this note’s my baby')
  }

  marked(kind: string, total: number): void {
    if (total >= 5 && kind === 'highlight') {
      this.set('coffee_time')
      return
    }
    if (kind === 'highlight') this.set('kiss')
    else if (kind === 'underline') this.set('peace')
    else if (kind === 'strikethrough') this.set('cool')
    else this.set('cuddle')
  }

  selected(): void {
    this.set('side_eye', 'tap delete if that one’s out')
  }

  moved(): void {
    this.set('my_baby')
  }

  deleted(): void {
    this.set('grumpy')
  }

  cleared(): void {
    this.set('grumpy', 'undone. as you were')
  }

  zoomed(percent: number): void {
    this.set('side_eye', `${percent}% · pinch of zoom`)
  }

  downloading(): void {
    this.set('love_you')
  }

  nothingToDownload(): void {
    this.set('grumpy', pick(['nothing to download yet', 'open a PDF first!!']))
  }

  private tour(): void {
    const from = this.mood ? TOUR.indexOf(this.mood) : -1
    const index = (from + 1) % TOUR.length
    const mood = TOUR[index]
    this.set(mood, `${label(mood)} · ${index + 1}/${TOUR.length}`)
  }

  private armIdle(): void {
    window.clearTimeout(this.idleTimer)
    window.clearTimeout(this.longIdleTimer)
    this.idleTimer = window.setTimeout(() => this.set('sleepy'), 22000)
    this.longIdleTimer = window.setTimeout(() => this.set('blanket'), 50000)
  }
}

function srcFor(mood: Mood): string {
  return `${import.meta.env.BASE_URL}buddy/${mood}.png`
}

function label(mood: Mood): string {
  return mood.replaceAll('_', ' ')
}

function pick(lines: string[]): string {
  return lines[Math.floor(Math.random() * lines.length)]
}
