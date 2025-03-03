export type SECDocumentAnalysis = {
  summary: string
  isPertinent: boolean
  isCryptoRelated: boolean
  keyInsights: string[]
  riskFactors: string[]
  potentialImpact: string
  relevantTickers: string[]
  confidence: number
  analysisDate: string
}

export type SECAnalysisResult = {
  filingId: string
  archiveUrl: string
  archiveFilePath: string
  analysisFilePath: string
  contentType: string
  analysisDate: string
}

export type SECAnalysisError = {
  error: string
  filingId: string
  archiveUrl: string
  archiveFilePath: string
  attemptedAt: string
} 