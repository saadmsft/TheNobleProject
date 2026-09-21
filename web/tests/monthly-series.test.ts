import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createMonthlyCatalog, monthlyBook, monthlyCatalog, newMonthlyEpisodeId } from '../src/lib/monthly-series.ts'
import { audiobookPosition } from '../src/lib/audiobooks.ts'
import { buildListeningQueue, createListeningCatalog, createListeningEngine, validateListeningData } from '../src/lib/listening.ts'
import { isMonthlyChapter, spokenStoryText, storyAudioManifestSchema } from '../src/lib/story-audio.ts'
import { parseRoute, routeUrl } from '../src/lib/route.ts'
import { normalizeSearch } from '../src/lib/search.ts'
import { narrations } from '../src/lib/library.ts'
import { storyEpisodes } from '../src/lib/stories.ts'
import { createReadingStore } from '../src/lib/reading.ts'
import { validateMp3 } from '../scripts/audio/core.ts'
import { monthlyFixture } from './fixtures/monthly-fixture.ts'
import { listeningFixture, ListeningFakeMedia, ListeningMemoryStorage } from './fixtures/listening-fixture.ts'

const empty = { version: 1, tracks: [] }
test('monthly publication is explicit, complete, source-linked and isolated from drafts', () => {
  const { series, audio } = monthlyFixture()
  const valid = createMonthlyCatalog(series, audio)
  assert.equal(monthlyBook(valid.episodes[0], 'en', valid).duration, 900)
  assert.equal(monthlyBook(valid.episodes[0], 'ur', valid).duration, 900)
  assert.deepEqual(createMonthlyCatalog({ version: 1, episodes: [] }, empty).episodes, [])
  for (const status of ['draft', 'approved', 'scheduled']) {
    assert.throws(() => createMonthlyCatalog({ ...series, episodes: [{ ...series.episodes[0], status }] }, audio))
  }
  assert.throws(() => createMonthlyCatalog(series, empty), /requires English and Urdu/)
  assert.throws(() => createMonthlyCatalog({ version: 1, episodes: [] }, audio), /orphan/)
  assert.throws(() => createMonthlyCatalog({ ...series, episodes: [...series.episodes, ...series.episodes] }, audio), /Duplicate/)
  const badSource = structuredClone(series)
  badSource.episodes[0].chapters[0].sourceIds = ['missing']
  assert.throws(() => createMonthlyCatalog(badSource, audio))
  const badParent = structuredClone(series)
  badParent.episodes[0].chapters[0].monthlyEpisodeId = 'another'
  assert.throws(() => createMonthlyCatalog(badParent, audio))
  const badLink = structuredClone(series)
  badLink.episodes[0].sources[0].url = 'https://sunnah.com.evil.invalid/'
  assert.throws(() => createMonthlyCatalog(badLink, audio))
  assert.equal(storyAudioManifestSchema.safeParse(audio).success, false, 'existing short-story duration limit stays unchanged')
})

test('monthly chapter queues resume long positions, advance, round-trip backups and reject mixing', async () => {
  const fixture = monthlyFixture()
  const publication = createMonthlyCatalog(fixture.series, fixture.audio)
  const rows = [...narrations, ...storyEpisodes, ...publication.chapters]
  const catalog = createListeningCatalog(rows, empty, empty, publication.manifest)
  const storage = new ListeningMemoryStorage()
  const engine = createListeningEngine({ rows, manifest: empty, monthlyManifest: publication.manifest, storage: () => storage })
  const media = new ListeningFakeMedia()
  engine.bindAudio(media)
  const input = { shelf: 'life' as const, topic: 'all' as const, title: publication.episodes[0].title, entryIds: publication.chapters.map((chapter) => chapter.id) }
  assert.ok(engine.startQueue(input, 'en').ok)
  media.metadata(450)
  await Promise.resolve()
  engine.seek(420)
  engine.pause()
  assert.equal(engine.getSnapshot().currentNarration, null)
  assert.ok(isMonthlyChapter(engine.getSnapshot().currentStory!))
  assert.ok(validateListeningData(engine.getSnapshot().data, catalog).ok)
  const book = monthlyBook(publication.episodes[0], 'en', publication)
  assert.equal(audiobookPosition(book, engine.getSnapshot().data).seconds, 420)
  const reloaded = createListeningEngine({ rows, manifest: empty, monthlyManifest: publication.manifest, storage: () => storage })
  assert.equal(reloaded.getSnapshot().playing, false)
  assert.equal(audiobookPosition(book, reloaded.getSnapshot().data).hasResume, true)
  const reading = createReadingStore(() => storage, new Set(narrations.map((row) => row.id)), engine)
  const backup = reading.exportBackup([])
  assert.ok(backup.ok)
  assert.ok(reading.prepareImport(backup.value, []).ok)
  assert.equal(buildListeningQueue(catalog, input, 'ar').ok, false)
  assert.equal(buildListeningQueue(catalog, { ...input, entryIds: [input.entryIds[0], storyEpisodes[0].id] }, 'en').ok, false)
  assert.equal(buildListeningQueue(catalog, { ...input, entryIds: [input.entryIds[0], narrations[0].id] }, 'en').ok, false)
  const other = { ...publication.chapters[1], monthlyEpisodeId: 'other' }
  const mixed = createListeningCatalog([publication.chapters[0], other], empty, empty, publication.manifest)
  assert.equal(buildListeningQueue(mixed, input, 'en').ok, false)
  engine.play()
  media.end()
  assert.equal(engine.getSnapshot().currentStory?.id, input.entryIds[1])
  media.metadata(450)
  await Promise.resolve()
  media.end()
  assert.equal(audiobookPosition(book, engine.getSnapshot().data, engine.getSnapshot()).atEnd, true)
  assert.equal(audiobookPosition(book, engine.getSnapshot().data).entryId, input.entryIds[0])
  engine.dismiss()
})

test('monthly routes preserve episode and language but never leak episode state to other views', () => {
  const base = new URL('https://thenobleproject.org/?view=monthly&episode=before-birth&lang=ur')
  const route = parseRoute(base)
  assert.equal(route.view, 'monthly')
  assert.equal(route.shelf, 'all')
  assert.equal(route.episode, 'before-birth')
  assert.deepEqual(parseRoute(routeUrl(base, route)), route)
  assert.equal(routeUrl(base, { ...route, view: 'audiobooks' }).searchParams.has('episode'), false)
  assert.equal(parseRoute(new URL('https://thenobleproject.org/?view=monthly&episode=../draft')).episode, undefined)
})

test('all published monthly audio retains exact assets, scripts and measured durations', () => {
  const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
  const normalized = (text: string) => normalizeSearch(text).replaceAll(' ', '')
  for (const chapter of monthlyCatalog.chapters) {
    assert.ok(!narrations.some((row) => row.id === chapter.id))
    assert.ok(!storyEpisodes.some((row) => row.id === chapter.id))
    for (const language of ['en', 'ur'] as const) {
      const track = monthlyCatalog.tracks.get(`${chapter.id}:${language}`)!
      assert.equal(track.scriptHash, sha(spokenStoryText(chapter.text[language])))
      assert.equal(track.transcriptHash, sha(track.transcript))
      assert.equal(normalized(track.transcript), normalized(spokenStoryText(chapter.text[language])))
      const bytes = readFileSync(new URL(`../public/${track.asset}`, import.meta.url))
      assert.equal(bytes.length, track.byteLength)
      assert.equal(sha(bytes), track.sha256)
      assert.equal(validateMp3(bytes, 128, 'monthly'), track.durationSeconds)
      if (track.durationSeconds >= 590) assert.throws(() => validateMp3(bytes, 128), /invalid/)
      const sections = chapter.sections?.[language]
      if (sections) {
        assert.equal(normalized(sections.map((section) => section.text).join(' ')), normalized(chapter.text[language]))
        const episode = monthlyCatalog.episodes.find((item) => item.id === chapter.monthlyEpisodeId)!
        for (const section of sections) {
          for (const id of section.sourceIds) {
            const source = episode.sources.find((item) => item.id === id)!
            assert.ok(!source.languages || source.languages.includes(language))
          }
        }
      }
    }
  }
})

test('NEW badge applies only to the latest release for exactly thirty days, never future dates', () => {
  const episodes = [{ id: 'older', publishedOn: '2026-09-01' }, { id: 'latest', publishedOn: '2026-09-13' }]
  assert.equal(newMonthlyEpisodeId(episodes, Date.parse('2026-09-12T23:59:59Z')), undefined)
  assert.equal(newMonthlyEpisodeId(episodes, Date.parse('2026-09-13T00:00:00Z')), 'latest')
  assert.equal(newMonthlyEpisodeId(episodes, Date.parse('2026-10-12T23:59:59Z')), 'latest')
  assert.equal(newMonthlyEpisodeId(episodes, Date.parse('2026-10-13T00:00:00Z')), undefined)
  assert.equal(newMonthlyEpisodeId([], Date.now()), undefined)
})

test('published long recordings retain listening positions beyond ten minutes without widening report limits', async () => {
  const rows = [...narrations, ...monthlyCatalog.chapters]
  const storage = new ListeningMemoryStorage()
  const engine = createListeningEngine({ rows, manifest: empty, monthlyManifest: monthlyCatalog.manifest, storage: () => storage })
  const catalog = createListeningCatalog(rows, empty, empty, monthlyCatalog.manifest)
  const episode = monthlyCatalog.episodes.find((item) => item.id === 'monthly-life-001')!
  assert.ok(episode)
  const track = monthlyBook(episode, 'ur').chapters[0].track
  const media = new ListeningFakeMedia()
  engine.bindAudio(media)
  engine.startQueue({ shelf: 'life', topic: 'all', title: episode.title, entryIds: episode.chapters.map((chapter) => chapter.id) }, 'ur')
  media.metadata(track.durationSeconds)
  await Promise.resolve()
  engine.seek(650)
  engine.pause()
  const data = engine.getSnapshot().data
  assert.equal(data.positions.at(-1)?.time, 650)
  assert.ok(validateListeningData(data, catalog).ok)
  assert.equal(validateListeningData({ ...data, positions: [{ ...data.positions[0], time: 1801 }] }, catalog).ok, false)
  const reloaded = createListeningEngine({ rows, manifest: empty, monthlyManifest: monthlyCatalog.manifest, storage: () => storage })
  assert.equal(reloaded.getSnapshot().data.positions.at(-1)?.time, 650)
  assert.equal(reloaded.getSnapshot().playing, false)
  const legacy = listeningFixture()
  const legacyTrack = legacy.manifest.tracks[0]
  const legacyCatalog = createListeningCatalog(legacy.rows, legacy.manifest)
  assert.equal(validateListeningData({ version: 1, rate: 1, language: legacyTrack.language, queue: null,
    positions: [{ entryId: legacyTrack.entryId, language: legacyTrack.language, cacheKey: legacyTrack.cacheKey,
      sha256: legacyTrack.sha256, time: 650, completed: false }] }, legacyCatalog).ok, false)
})

test('the second episode publishes complete parallel editions without disturbing the first release', () => {
  const [latest, first] = monthlyCatalog.episodes
  assert.equal(latest.id, 'monthly-life-002')
  assert.equal(first.id, 'monthly-life-001')
  assert.equal(newMonthlyEpisodeId(monthlyCatalog.episodes, Date.parse('2026-09-21T00:00:00Z')), 'monthly-life-002')
  assert.equal(monthlyCatalog.tracks.get('story-monthly-life-001-recording:en')!.sha256,
    '32d3a0244c600c8b45fdc5439093acef6906b20ba048c2acd5a835e1efbeb6bd')
  assert.equal(monthlyCatalog.tracks.get('story-monthly-life-001-recording:ur')!.sha256,
    'dae4328ab0c068add013d9dff823473a07146b45de278ec5728e1afedcf15a08')
  const chapter = latest.chapters[0]
  assert.equal(chapter.sections!.en.length, chapter.sections!.ur.length, 'both editions narrate the same sections')
  assert.equal(latest.editionLabels!.en.en, 'English · full edition')
  assert.equal(latest.editionLabels!.ur.en, 'Urdu · full edition')
  for (const language of ['en', 'ur'] as const) {
    const track = monthlyCatalog.tracks.get(`${chapter.id}:${language}`)!
    assert.ok(track.durationSeconds > 0 && track.durationSeconds < 900)
    assert.ok(chapter.sections![language].every((section) => section.startSeconds < track.durationSeconds))
  }
  const framing = latest.sources.filter((source) => new URL(source.url).origin === 'https://www.britannica.com')
  assert.equal(framing.length, 1, 'reference framing is cited explicitly and separately')
  assert.ok(framing[0].reference.includes('not a graded hadith'))
  assert.ok(latest.sources.filter((source) => source.id !== framing[0].id)
    .every((source) => ['https://sunnah.com', 'https://quran.com'].includes(new URL(source.url).origin)))
  const { series, audio } = monthlyFixture()
  const lookalike = structuredClone(series)
  lookalike.episodes[0].sources[0].url = 'https://www.britannica.com.evil.invalid/'
  assert.throws(() => createMonthlyCatalog(lookalike, audio))
})
