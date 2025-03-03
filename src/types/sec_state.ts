import type { SECFiling } from './sec'

export type ProcessedFiling = SECFiling & {
  processedAt: string
}

export type SECFilingState = {
  lastProcessedFilings: Record<string, ProcessedFiling>
  lastUpdated: string
} 