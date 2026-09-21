import { monthlyBook, monthlyEpisodes } from './monthly-series.ts'
import type { MonthlyEpisode } from './monthly-series.ts'
import { monthlyLabels } from './monthly-labels.ts'
import { topicsBook, topicsEpisodes } from './topics-series.ts'
import { topicsLabels } from './topics-labels.ts'
import type { Language } from './schema.ts'

/** Both long-form series share one reviewed player, transcript view and source panel.
 * A series only supplies its own catalog, labels and dated-badge behaviour.
 */
export type SeriesConfig = {
  episodes: readonly MonthlyEpisode[]
  book: (episode: MonthlyEpisode, language: Language) => ReturnType<typeof monthlyBook>
  labels: typeof monthlyLabels | typeof topicsLabels
  dated: boolean
}

export const monthlySeries: SeriesConfig = { episodes: monthlyEpisodes, book: monthlyBook, labels: monthlyLabels, dated: true }
export const topicsSeries: SeriesConfig = { episodes: topicsEpisodes, book: topicsBook, labels: topicsLabels, dated: false }
