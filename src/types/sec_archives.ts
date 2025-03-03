export type ContentType = 
  | 'pdf' 
  | 'html' 
  | 'xml' 
  | 'json' 
  | 'txt' 
  | 'csv' 
  | 'md' 
  | 'xbrl'
  | 'unknown'

export type SECArchiveResult = {
  archiveUrl: string
  filePath: string
  size: number
  contentType: ContentType
  downloadedAt: string
}

export type SECArchiveError = {
  error: string
  archiveUrl: string
  filingId: string
  attemptedAt: string
} 