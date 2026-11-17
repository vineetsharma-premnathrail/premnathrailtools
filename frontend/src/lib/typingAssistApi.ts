// Typing assist API (backend: app/modules/typing_assist, router prefix /typing-assist).
//
//   GET /typing-assist/vocabulary            words + word pairs the signed-in user may see (text only)
//   GET /typing-assist/similar?kind=&q=&limit=   records whose name looks like `q`
//
// Both calls run in the background (no progress bar, no screen block): they fire
// while a person types and must never get in the way.
import { apiClient } from './api'

export type SimilarKind = 'item' | 'vendor' | 'organization' | 'machine'

export interface VocabularyResponse {
  words: [string, number][]
  bigrams: [string, string, number][]
  sources: string[]
}

export interface SimilarMatch {
  id: number
  /** Signed record link; added beside `id` by the API when the request goes through apiClient. */
  id_ref?: string
  code: string | null
  name: string
  /** 0..1 */
  score: number
}

export interface SimilarResponse {
  kind: SimilarKind
  query: string
  matches: SimilarMatch[]
}

export const typingAssistApi = {
  vocabulary: async (): Promise<VocabularyResponse> => {
    const { data } = await apiClient.get<VocabularyResponse>('/typing-assist/vocabulary', { background: true })
    return {
      words: Array.isArray(data?.words) ? data.words : [],
      bigrams: Array.isArray(data?.bigrams) ? data.bigrams : [],
      sources: Array.isArray(data?.sources) ? data.sources : [],
    }
  },

  /** Throws on 403 (no view permission) like any API call; callers treat that as "no hint". */
  similar: async (kind: SimilarKind, q: string, limit = 5, signal?: AbortSignal): Promise<SimilarResponse> => {
    const { data } = await apiClient.get<SimilarResponse>('/typing-assist/similar', {
      params: { kind, q, limit },
      background: true,
      signal,
    })
    return { kind: data.kind, query: data.query, matches: Array.isArray(data.matches) ? data.matches : [] }
  },
}
