import type { SECFiling } from './sec'
import type { SECAnalysisResult } from './sec_analysis'

export type ProcessedFiling = SECFiling & {
  processedAt: string
  analyzedDocuments?: SECAnalysisResult[]
}

export type SECFilingState = {
  lastProcessedFilings: Record<string, ProcessedFiling>
  lastUpdated: string
} 