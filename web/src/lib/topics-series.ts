import rawSeries from '../data/topics-series.json' with { type: 'json' }
import rawAudio from '../data/topics-audio-manifest.json' with { type: 'json' }
import { createMonthlyCatalog, monthlyBook } from './monthly-series.ts'
import type { MonthlyEpisode } from './monthly-series.ts'
import type { Language } from './schema.ts'

// Thoughts & Topics reuses the reviewed long-form series contract: the same episode
// and recording schemas, the same bilingual requirement, and the same player.
// Only the catalog and its labels differ from the dated monthly series.
export const topicsCatalog = createMonthlyCatalog(rawSeries, rawAudio)
export const topicsEpisodes = topicsCatalog.episodes
export const topicsChapters = topicsCatalog.chapters

export function topicsBook(episode: MonthlyEpisode, language: Language) {
  return monthlyBook(episode, language, topicsCatalog)
}
