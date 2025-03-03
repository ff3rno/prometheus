export type SECDownloadResult = {
  filePath: string
  size: number
  downloadedAt: string
}

export type SECDownloadError = {
  error: string
  filingId: string
  attemptedAt: string
} 