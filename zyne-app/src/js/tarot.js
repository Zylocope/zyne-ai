// ─────────────────────────────────────────────────────────────
//  TAROT — a one-card morning draw, and a line to sit with.
//
//  The deck follows the traditional 78-card structure with the
//  court renamed Daughter / Son / Mother / Father, the way The
//  Wild Unknown does. Everything else here is written for this
//  app: the imagery and keywords are ours, so nothing is copied
//  from a published deck or its guidebook. The essence we're
//  after is that deck's, not its words — animals and bare
//  nature, plainly said, no fortune-telling voice.
//
//  Same DSL shape as feed sources and focus sounds:
//    Name | image | keywords
// ─────────────────────────────────────────────────────────────

const DECK = `
# ── Major Arcana ──
The Fool | a pup at the cliff edge, tail up, no map | beginning, trust, the leap
The Magician | a fox with everything it needs laid out in the grass | will, focus, tools in hand
The High Priestess | an owl between two dark trees | intuition, silence, knowing before proof
The Empress | a doe in a field gone wild with growth | abundance, care, things ripening
The Emperor | a ram on bare rock, horns set | order, boundary, the rule you keep
The Hierophant | an old stag standing in a still grove | tradition, teaching, what was handed down
The Lovers | two swans, their necks one line | union, choice, meeting fully
The Chariot | a horse pulling hard in one direction | drive, control, momentum held
Strength | a lion lying down, letting a hand come near | gentleness outlasting force
The Hermit | a moth alone with one lamp | solitude, search, your own small light
Wheel of Fortune | a snake turning to meet its own tail | cycles, turning, what comes around
Justice | a heron standing perfectly still in water | balance, truth, consequence
The Hanged Man | a bat asleep upside down | surrender, pause, the other angle
Death | a stag's skull with moss already on it | ending, clearing, what grows after
Temperance | a crane pouring water between two stones | blending, patience, right measure
The Devil | a goat chained by something it could step over | appetite, attachment, the loop you chose
The Tower | a struck tree splitting open | collapse, shock, sudden truth
The Star | a spider spinning under a night sky | hope, repair, quiet faith
The Moon | a wolf calling at its own reflection | dream, fear, what isn't clear yet
The Sun | a sunflower turning its whole head | clarity, gladness, being seen
Judgement | a bird bursting up out of the underbrush | reckoning, calling, waking
The World | a whale circling the whole ocean | completion, wholeness, coming round

# ── Wands — fire, will, the thing you burn for ──
Ace of Wands | a green branch pushing up through ash | spark, raw start, appetite
Two of Wands | two sticks crossed, a hand on each | choosing a direction
Three of Wands | smoke rising where you can't yet see fire | waiting on what you started
Four of Wands | a shelter made of four branches | home, steadiness, small celebration
Five of Wands | five snakes tangled in one nest | friction, noise, wants competing
Six of Wands | a bird lands on the highest branch | recognition, a win others see
Seven of Wands | one stick held against the slope | defending your ground
Eight of Wands | sparks carried fast on the wind | speed, message, all at once
Nine of Wands | a scarred branch still standing | tired, wary, not done
Ten of Wands | an armful of sticks blocking the view | carrying more than the task needs
Daughter of Wands | a small flame that won't be put out | curiosity, first heat
Son of Wands | a horse running through dry grass | rush, adventure, heat without aim
Mother of Wands | a snake warm in full sun | sure of herself, magnetic
Father of Wands | a wildfire that knows where to stop | vision, command, will with edges

# ── Cups — water, feeling, what moves through you ──
Ace of Cups | a spring opening in bare rock | feeling arrives, and it's offered
Two of Cups | two fish circling each other | meeting, mutual, a bond made
Three of Cups | three swans on one pond | friends, gladness, shared
Four of Cups | a full cup ignored on the bank | flatness, restlessness, look again
Five of Cups | spilled water sinking into sand | grief, and what is still standing
Six of Cups | an old den remembered | memory, sweetness, who you were
Seven of Cups | many reflections, one real moon | options, glamour, dreaming
Eight of Cups | footprints leading away from the water | walking away toward something truer
Nine of Cups | belly full, sun warm | contentment, a wish met
Ten of Cups | a whole flock landing together | belonging, overflow, people
Daughter of Cups | a fish that surfaces to look | tender, open, first feeling
Son of Cups | a swan bringing something in its beak | offering, romance, going to someone
Mother of Cups | deep still water, all the way down | empathy, holding, depth
Father of Cups | the sea, calm on the surface | steady heart, feeling that doesn't rule you

# ── Swords — air, mind, the truth you say out loud ──
Ace of Swords | one feather cutting the air | clarity, truth, the first clean cut
Two of Swords | a bird on a branch with its eyes closed | stalemate, refusing to look
Three of Swords | three feathers through a cloud | hurt, honest pain, the thing said
Four of Swords | a bird resting inside a hollow | rest, retreat, repair
Five of Swords | feathers scattered after a fight | winning badly, counting the cost
Six of Swords | crossing dark water toward a low shore | moving on, quieter than before
Seven of Swords | taking a feather, moving quiet | cunning, half-truth, the shortcut
Eight of Swords | bound wings, an open door behind | trapped by your own thinking
Nine of Swords | awake in the dark, wings up | dread, night mind, worse than daylight
Ten of Swords | every feather spent | it already ended, and you're still here
Daughter of Swords | a small bird watching everything | alert, curious, learning fast
Son of Swords | a hawk diving straight down | fast, blunt, forward
Mother of Swords | a raven that misses nothing | clear sight, honest, unsentimental
Father of Swords | an eagle over the whole field | judgment, principle, cold clarity

# ── Pentacles — earth, body, work, the ground under it ──
Ace of Pentacles | one seed in dark soil | an offer with weight, a real start
Two of Pentacles | two stones balanced on a log | juggling, adjusting, keeping both
Three of Pentacles | three hands on the same beam | craft, building it together
Four of Pentacles | a squirrel holding everything it found | holding tight, control, fear of less
Five of Pentacles | two shapes in the snow, light past the wall | lack, cold, help nearer than it looks
Six of Pentacles | grain shared from an open hand | giving, receiving, the ratio between
Seven of Pentacles | a slow tree, half grown | patience, tending, not yet
Eight of Pentacles | the same cut, over and over | practice, repetition, skill earned
Nine of Pentacles | a deer alone in a full garden | ease you paid for yourself
Ten of Pentacles | a whole herd on old land | legacy, security, roots
Daughter of Pentacles | a fawn learning the ground | student, beginner, steady
Son of Pentacles | an ox pulling a straight line | reliable, plodding, finished
Mother of Pentacles | a bear in an abundant season | nurture, resource, practical warmth
Father of Pentacles | an old stag, the herd behind him | provision, mastery, quiet wealth
`

// Lines to sit with. Short, attributed, mostly old — proverbs and
// aphorisms rather than advice.
const LINES = `
Creativity takes courage. — Henri Matisse
Success is liking yourself, liking what you do, and liking how you do it. — Maya Angelou
We suffer more in imagination than in reality. — Seneca
The obstacle is the way. — Marcus Aurelius
Waste no more time arguing what a good person should be. Be one. — Marcus Aurelius
A journey of a thousand miles begins with a single step. — Lao Tzu
He who knows others is wise; he who knows himself is enlightened. — Lao Tzu
Nature does not hurry, yet everything is accomplished. — Lao Tzu
Fall seven times, stand up eight. — Japanese proverb
The best time to plant a tree was twenty years ago. The second best is now. — Proverb
Slowly, slowly, the egg learns to walk. — West African proverb
Smooth seas never made a skilled sailor. — Proverb
When the roots are deep, there is no reason to fear the wind. — Proverb
A river cuts through rock not by power but by persistence. — Proverb
Rivers do not drink their own water; trees do not eat their own fruit. — Proverb
Know thyself. — Inscribed at Delphi
The unexamined life is not worth living. — Socrates
I know that I know nothing. — Socrates
We are what we repeatedly do. Excellence, then, is a habit. — Aristotle
Very little is needed to make a happy life. — Marcus Aurelius
Begin at once to live. — Seneca
Luck is what happens when preparation meets opportunity. — Seneca
It is not that we have little time, but that we waste much of it. — Seneca
No man ever steps in the same river twice. — Heraclitus
Character is destiny. — Heraclitus
The wound is the place where the light enters you. — Rumi
What you seek is seeking you. — Rumi
Do not be satisfied with the stories that came before you. — Rumi
Whatever you can do, or dream you can, begin it. — Goethe
Simplicity is the ultimate sophistication. — Leonardo da Vinci
The two most important days in your life are the day you are born and the day you find out why. — Mark Twain
Comparison is the thief of joy. — Theodore Roosevelt
It does not matter how slowly you go as long as you do not stop. — Confucius
The man who moves a mountain begins by carrying away small stones. — Confucius
Our greatest glory is not in never falling, but in rising every time we fall. — Confucius
`

function lines(text) {
  return text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
}

// Name | image | keywords  →  {name, image, keys, suit}
export function parseDeck(text = DECK) {
  return lines(text).map(l => {
    const [name, image, keys] = l.split('|').map(p => (p || '').trim())
    const m = /\bof (Wands|Cups|Swords|Pentacles)$/.exec(name)
    return { name, image, keys, suit: m ? m[1].toLowerCase() : 'major' }
  })
}

// "Text — Author"  →  {text, who}
export function parseLines(text = LINES) {
  return lines(text).map(l => {
    const i = l.lastIndexOf('—')
    return i < 0 ? { text: l, who: '' } : { text: l.slice(0, i).trim(), who: l.slice(i + 1).trim() }
  })
}

export const CARDS = parseDeck()
export const READINGS = parseLines()

export const drawIndex = () => Math.floor(Math.random() * CARDS.length)
export const randomLine = () => READINGS[Math.floor(Math.random() * READINGS.length)]
