import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { topicsBook, topicsCatalog, topicsChapters, topicsEpisodes } from '../src/lib/topics-series.ts'
import { monthlyChapters } from '../src/lib/monthly-series.ts'
import { isMonthlyChapter, spokenStoryText } from '../src/lib/story-audio.ts'
import { parseRoute, routeUrl } from '../src/lib/route.ts'
import { normalizeSearch } from '../src/lib/search.ts'
import { narrations } from '../src/lib/library.ts'
import { storyEpisodes } from '../src/lib/stories.ts'
import { validateMp3 } from '../scripts/audio/core.ts'

test('Thoughts & Topics publishes a complete bilingual edition with its own identities', () => {
  assert.ok(topicsEpisodes.length >= 1)
  const episode = topicsEpisodes.find((item) => item.id === 'topics-muraqabah-001')!
  assert.ok(episode, 'the first topic is published')
  assert.equal(episode.status, 'published')
  for (const language of ['en', 'ur'] as const) {
    assert.ok(episode.title[language].trim().length > 0)
    assert.ok(episode.summary[language].trim().length > 0)
    assert.ok(episode.editorialNote[language].trim().length > 0)
    assert.ok(topicsBook(episode, language).duration > 0)
  }
  // Topic chapters are a separate identity space from the monthly series and the report library.
  for (const chapter of topicsChapters) {
    assert.ok(isMonthlyChapter(chapter), 'topics chapters use the shared long-form playback contract')
    assert.ok(!monthlyChapters.some((row) => row.id === chapter.id))
    assert.ok(!narrations.some((row) => row.id === chapter.id))
    assert.ok(!storyEpisodes.some((row) => row.id === chapter.id))
    assert.match(chapter.id, /^story-topics-/)
  }
})

test('published topic audio retains exact assets, scripts and measured durations', () => {
  const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
  const normalized = (text: string) => normalizeSearch(text).replaceAll(' ', '')
  for (const chapter of topicsCatalog.chapters) {
    for (const language of ['en', 'ur'] as const) {
      const track = topicsCatalog.tracks.get(`${chapter.id}:${language}`)!
      assert.ok(track, `${chapter.id}:${language} has a recording`)
      assert.equal(track.voice, 'cedar')
      assert.equal(track.renderingProfile, 'gpt-realtime-2.1-2026-07-07-cedar-story-v1')
      assert.equal(track.scriptHash, sha(spokenStoryText(chapter.text[language])))
      assert.equal(track.transcriptHash, sha(track.transcript))
      assert.equal(normalized(track.transcript), normalized(spokenStoryText(chapter.text[language])))
      const bytes = readFileSync(new URL(`../public/${track.asset}`, import.meta.url))
      assert.equal(bytes.length, track.byteLength)
      assert.equal(sha(bytes), track.sha256)
      assert.equal(validateMp3(bytes, 128, 'monthly'), track.durationSeconds)
      const sections = chapter.sections?.[language]
      assert.ok(sections && sections.length > 0, 'each language has chapter markers')
      assert.equal(normalized(sections.map((section) => section.text).join(' ')), normalized(chapter.text[language]))
      assert.equal(sections[0].startSeconds, 0)
      for (const section of sections) {
        assert.ok(section.startSeconds < track.durationSeconds, 'markers fall inside the recording')
        for (const id of section.sourceIds) assert.ok(chapter.sourceIds.includes(id))
      }
    }
  }
})

test('topic routes round-trip and reject unknown or malformed episodes', () => {
  const base = new URL('https://thenobleproject.org/')
  const route = parseRoute(new URL('https://thenobleproject.org/?view=topics&episode=topics-muraqabah-001&lang=ur'))
  assert.equal(route.view, 'topics')
  assert.equal(route.episode, 'topics-muraqabah-001')
  assert.equal(route.shelf, 'all')
  assert.equal(routeUrl(base, route).searchParams.get('episode'), 'topics-muraqabah-001')
  assert.equal(parseRoute(new URL('https://thenobleproject.org/?view=topics&episode=../draft')).episode, undefined)
  // The episode parameter belongs to series views only.
  assert.equal(routeUrl(base, { ...route, view: 'home' }).searchParams.get('episode'), null)
})
