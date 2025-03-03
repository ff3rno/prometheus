import axios from 'axios'
import { XMLParser } from 'fast-xml-parser'
import { Low } from 'lowdb'
import { JSONFile } from 'lowdb/node'
import * as path from 'path'
import * as fs from 'fs'
import * as dotenv from 'dotenv'
import Bottleneck from 'bottleneck'
import * as cheerio from 'cheerio'
import OpenAI from 'openai'
import type { SECFeedResponse, SECFiling } from './types/sec'
import type { SECFilingState } from './types/sec_state'
import type { SECDownloadResult, SECDownloadError } from './types/sec_downloads'
import type { SECArchiveResult, SECArchiveError, ContentType } from './types/sec_archives'
import type { SECDocumentAnalysis, SECAnalysisResult, SECAnalysisError } from './types/sec_analysis'
import { sendSlackNotification } from './utils/slack'

dotenv.config()

const SEC_FEED_URL: string = 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&CIK=&type=&company=&dateb=&owner=include&start=0&count=40&output=atom'
const POLL_INTERVAL_MS: number = 60000
const DATA_DIR: string = process.env.DATA_DIR || path.join(process.cwd(), 'data')
const DOWNLOADS_DIR: string = path.join(DATA_DIR, 'downloads')
const USER_AGENT: string = 'Datsusara SEC Filing Monitor (ff3rno@gmail.com)'
const ARCHIVES_DIR: string = path.join(DATA_DIR, 'archives')
const ANALYSIS_DIR: string = path.join(DATA_DIR, 'analysis')
const SEC_BASE_URL: string = 'https://www.sec.gov'
const OPENAI_API_KEY: string = process.env.OPENAI_API_KEY || ''
const OPENAI_MODEL: string = process.env.OPENAI_MODEL || 'gpt-4o'

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY
})

const parser: XMLParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: ''
})

const feedLimiter: Bottleneck = new Bottleneck({
  minTime: 2000,
  maxConcurrent: 1,
  reservoir: 10,
  reservoirRefreshAmount: 10,
  reservoirRefreshInterval: 60 * 1000
})

const filingLimiter: Bottleneck = new Bottleneck({
  minTime: 100,
  maxConcurrent: 2,
  reservoir: 60,
  reservoirRefreshAmount: 60,
  reservoirRefreshInterval: 60 * 1000
})

// Create analysis limiter to manage OpenAI API rate limits
const analysisLimiter: Bottleneck = new Bottleneck({
  minTime: 1000,
  maxConcurrent: 2
})

filingLimiter.on('error', (error: Error) => {
  console.error('Filing rate limiter error:', error)
})

analysisLimiter.on('error', (error: Error) => {
  console.error('Analysis rate limiter error:', error)
})

const initializeDB = async (): Promise<Low<SECFilingState>> => {
  const dbPath: string = path.join(DATA_DIR, 'sec_filings.json')

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }

  const adapter = new JSONFile<SECFilingState>(dbPath)
  const db = new Low<SECFilingState>(adapter, {
    lastProcessedFilings: {},
    lastUpdated: new Date().toISOString()
  })

  await db.read()

  if (db.data === null) {
    db.data = {
      lastProcessedFilings: {},
      lastUpdated: new Date().toISOString()
    }
    await db.write()
  }

  return db
}

const fetchSECFilings = async (): Promise<SECFiling[]> => {
  const { data: xmlData } = await feedLimiter.schedule(() => axios.get<string>(SEC_FEED_URL, {
    headers: {
      'User-Agent': USER_AGENT
    }
  }))
  const { feed: { entry: filings } } = parser.parse(xmlData) as SECFeedResponse
  return filings
}

const downloadFiling = async (filing: SECFiling): Promise<SECDownloadResult> => {
  const { id, link } = filing
  const { href } = link
  const downloadPath: string = path.join(DOWNLOADS_DIR, `${id}.html`)

  if (!fs.existsSync(DOWNLOADS_DIR)) {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true })
  }

  const { data: filingContent } = await filingLimiter.schedule(() => axios.get<string>(href, {
    headers: {
      'User-Agent': USER_AGENT
    }
  }))

  fs.writeFileSync(downloadPath, filingContent)
  const { size } = fs.statSync(downloadPath)

  return {
    filePath: downloadPath,
    size,
    downloadedAt: new Date().toISOString()
  }
}

const extractArchiveLinks = (filingHtml: string): string[] => {
  const $ = cheerio.load(filingHtml)
  const archiveLinks: string[] = []
  
  $('.tableFile tr td a').each((_, element) => {
    const href = $(element).attr('href')
    const linkText = $(element).text().trim().toLowerCase()
    
    if (href && href.startsWith('/Archives')) {
      const contentType = getContentTypeFromExtension(href)
      
      // Skip unknown content types
      if (contentType !== 'unknown') {
        archiveLinks.push(`${SEC_BASE_URL}${href}`)
      }
    }
  })
  
  return archiveLinks
}

const getContentTypeFromExtension = (url: string): ContentType => {
  const extension = url.split('.').pop()?.toLowerCase() || ''
  
  const extensionMap: Record<string, ContentType> = {
    'pdf': 'pdf',
    'htm': 'html',
    'html': 'html',
    'xml': 'xml',
    'xbrl': 'xbrl',
    'txt': 'txt',
    'json': 'json',
    'csv': 'csv',
    'md': 'md'
  }
  
  return extensionMap[extension] || 'unknown'
}

const determineResponseType = (contentType: ContentType): 'arraybuffer' | 'text' => {
  return contentType === 'pdf' ? 'arraybuffer' : 'text'
}

const downloadArchive = async (archiveUrl: string, filingId: string): Promise<SECArchiveResult> => {
  const urlParts: string[] = archiveUrl.split('/')
  const fileName: string = urlParts[urlParts.length - 1]
  const archivePath: string = path.join(ARCHIVES_DIR, `${filingId}_${fileName}`)
  const contentType: ContentType = getContentTypeFromExtension(archiveUrl)
  const responseType = determineResponseType(contentType)
  
  if (!fs.existsSync(ARCHIVES_DIR)) {
    fs.mkdirSync(ARCHIVES_DIR, { recursive: true })
  }
  
  const response = await filingLimiter.schedule(() => axios.get(archiveUrl, {
    headers: {
      'User-Agent': USER_AGENT
    },
    responseType
  }))
  
  const archiveContent = response.data
  
  if (typeof archiveContent === 'string') {
    fs.writeFileSync(archivePath, archiveContent, 'utf-8')
  } else {
    fs.writeFileSync(archivePath, Buffer.from(archiveContent))
  }
  
  const { size } = fs.statSync(archivePath)
  
  return {
    archiveUrl,
    filePath: archivePath,
    size,
    contentType,
    downloadedAt: new Date().toISOString()
  }
}

const analyzeDocument = async (archiveResult: SECArchiveResult, filingId: string, filing?: SECFiling): Promise<SECAnalysisResult> => {
  const { archiveUrl, filePath, contentType } = archiveResult
  const fileName: string = path.basename(filePath)
  const analysisFilePath: string = path.join(ANALYSIS_DIR, `${fileName}.analysis.json`)
  
  // Check if analysis already exists to prevent redundant processing
  if (fs.existsSync(analysisFilePath)) {
    const existingAnalysis = JSON.parse(fs.readFileSync(analysisFilePath, 'utf-8'))
    
    return {
      filingId,
      archiveUrl,
      archiveFilePath: filePath,
      analysisFilePath,
      contentType,
      analysisDate: existingAnalysis.analysisDate
    }
  }
  
  // Make sure analysis directory exists
  if (!fs.existsSync(ANALYSIS_DIR)) {
    fs.mkdirSync(ANALYSIS_DIR, { recursive: true })
  }
  
  // Read the file content
  let fileContent: string
  
  if (contentType === 'pdf') {
    // For PDFs, we'd ideally use a PDF parsing library
    // This is simplified for now, assuming we can't read PDFs directly
    fileContent = `[PDF Document: ${fileName}] - Content cannot be directly extracted. Please implement PDF parsing.`
  } else {
    fileContent = fs.readFileSync(filePath, 'utf-8')
  }
  
  // Truncate content if it's too large
  const maxContentLength = 100000
  if (fileContent.length > maxContentLength) {
    fileContent = fileContent.substring(0, maxContentLength) + '... [content truncated]'
  }
  
  try {
    // Call OpenAI API with structured output format
    const response = await analysisLimiter.schedule(() => 
      openai.chat.completions.create({
        model: OPENAI_MODEL,
        messages: [
          {
            role: 'system',
            content: 'You are a financial analyst assistant specialized in analyzing SEC filings and related documents. Extract the most relevant information for traders and investors.'
          },
          {
            role: 'user',
            content: `Analyze the following document from an SEC filing and extract key information relevant for trading and investing decisions. The document is of type ${contentType}.\n\n${fileContent}`
          }
        ],
        functions: [
          {
            name: 'analyzeDocument',
            description: 'Analyze an SEC document for investment relevance',
            parameters: {
              type: 'object',
              properties: {
                summary: {
                  type: 'string',
                  description: 'A concise summary of the document contents'
                },
                isPertinent: {
                  type: 'boolean',
                  description: 'Whether this document contains information valuable for trading/investing decisions'
                },
                isCryptoRelated: {
                  type: 'boolean',
                  description: 'Whether this document mentions or relates to cryptocurrency, blockchain, or digital assets'
                },
                keyInsights: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Key insights extracted from the document'
                },
                riskFactors: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Risk factors mentioned in the document'
                },
                potentialImpact: {
                  type: 'string',
                  description: 'Assessment of potential market impact'
                },
                relevantTickers: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Stock symbols/tickers relevant to this document'
                },
                confidence: {
                  type: 'number',
                  description: 'Confidence level in the analysis (0-1)'
                }
              },
              required: ['summary', 'isPertinent', 'isCryptoRelated']
            }
          }
        ],
        function_call: { name: 'analyzeDocument' }
      })
    )
    
    // Extract the analysis from the response
    const functionCall = response.choices[0]?.message?.function_call
    
    if (functionCall && functionCall.name === 'analyzeDocument' && functionCall.arguments) {
      const analysis: SECDocumentAnalysis = {
        ...JSON.parse(functionCall.arguments),
        analysisDate: new Date().toISOString()
      }
      
      // Save analysis to file
      fs.writeFileSync(analysisFilePath, JSON.stringify(analysis, null, 2))
      
      // Send Slack notification if filing information is provided
      if (filing && (analysis.isPertinent || analysis.isCryptoRelated)) {
        await sendSlackNotification(filing, analysis, analysisFilePath)
      }
      
      return {
        filingId,
        archiveUrl,
        archiveFilePath: filePath,
        analysisFilePath,
        contentType,
        analysisDate: analysis.analysisDate
      }
    } else {
      throw new Error('Failed to get structured output from OpenAI')
    }
  } catch (error) {
    const analysisError: SECAnalysisError = {
      error: error instanceof Error ? error.message : 'Unknown error',
      filingId,
      archiveUrl,
      archiveFilePath: filePath,
      attemptedAt: new Date().toISOString()
    }
    
    console.error('Failed to analyze document:', analysisError)
    
    // Still return a result but with error information
    fs.writeFileSync(
      analysisFilePath, 
      JSON.stringify({
        error: analysisError.error,
        attemptedAt: analysisError.attemptedAt
      }, null, 2)
    )
    
    return {
      filingId,
      archiveUrl,
      archiveFilePath: filePath,
      analysisFilePath,
      contentType,
      analysisDate: new Date().toISOString()
    }
  }
}

const processFiling = async (filing: SECFiling, db: Low<SECFilingState>): Promise<void> => {
  const { id, updated, title, link, summary, category } = filing
  const { term, label } = category

  if (!db.data) return

  const isNewFiling: boolean = !db.data.lastProcessedFilings[id]

  if (isNewFiling) {
    console.log(`New filing: ${title}`)
    console.log(`Type: ${term} (${label})`)
    console.log(`Link: ${link.href}`)
    console.log(`Summary: ${JSON.stringify(summary)}`)

    try {
      const downloadResult: SECDownloadResult = await downloadFiling(filing)
      console.log(`Downloaded filing to: ${downloadResult.filePath} (${downloadResult.size} bytes)`)
      
      // Extract and download archive links
      const filingContent: string = fs.readFileSync(downloadResult.filePath, 'utf-8')
      const archiveLinks: string[] = extractArchiveLinks(filingContent)
      
      if (archiveLinks.length > 0) {
        console.log(`Found ${archiveLinks.length} document links in filing ${id}`)
        
        const archiveResults: SECArchiveResult[] = await Promise.all(
          archiveLinks.map((archiveUrl: string) => downloadArchive(archiveUrl, id))
        )
        
        // Process archives with OpenAI
        console.log(`Analyzing ${archiveResults.length} documents with OpenAI...`)
        const analysisResults: SECAnalysisResult[] = await Promise.all(
          archiveResults.map((archiveResult: SECArchiveResult) => analyzeDocument(archiveResult, id, filing))
        )
        
        for (const [index, result] of archiveResults.entries()) {
          const { archiveUrl, filePath, size, contentType } = result
          const analysisResult = analysisResults[index]
          console.log(`Downloaded ${contentType.toUpperCase()} document from ${archiveUrl} to: ${filePath} (${size} bytes)`)
          console.log(`Analysis saved to: ${analysisResult.analysisFilePath}`)
          
          // Read the analysis to display pertinence information
          try {
            const analysis: SECDocumentAnalysis = JSON.parse(fs.readFileSync(analysisResult.analysisFilePath, 'utf-8'))
            if (!('error' in analysis)) {
              console.log(`  - Pertinent for investors: ${analysis.isPertinent ? 'YES' : 'NO'}`)
              console.log(`  - Crypto-related: ${analysis.isCryptoRelated ? 'YES' : 'NO'}`)
              console.log(`  - Summary: ${analysis.summary.substring(0, 100)}...`)
            }
          } catch (error) {
            console.error(`Failed to read analysis for ${filePath}:`, error)
          }
        }
        
        // Store analysis results in the database
        db.data.lastProcessedFilings[id] = {
          ...filing,
          processedAt: new Date().toISOString(),
          analyzedDocuments: analysisResults
        }
      } else {
        console.log(`No supported document links found in filing ${id}`)
        
        // Store filing in database without analysis results
        db.data.lastProcessedFilings[id] = {
          ...filing,
          processedAt: new Date().toISOString()
        }
      }
    } catch (error) {
      const downloadError: SECDownloadError = {
        error: error instanceof Error ? error.message : 'Unknown error',
        filingId: id,
        attemptedAt: new Date().toISOString()
      }

      console.error('Failed to download filing:', downloadError)
      
      // Still store the filing but mark it as errored
      db.data.lastProcessedFilings[id] = {
        ...filing,
        processedAt: new Date().toISOString()
      }
    }

    console.log('---')
  }
}

const isMarketHours = (): boolean => {
  const now: Date = new Date()
  const options: Intl.DateTimeFormatOptions = { 
    timeZone: 'America/New_York',
    weekday: 'long',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false
  }
  
  const etFormatter: Intl.DateTimeFormat = new Intl.DateTimeFormat('en-US', options)
  const etDateParts: Intl.DateTimeFormatPart[] = etFormatter.formatToParts(now)
  
  // Extract weekday and hour
  const weekdayPart: Intl.DateTimeFormatPart | undefined = etDateParts.find((part: Intl.DateTimeFormatPart) => part.type === 'weekday')
  const hourPart: Intl.DateTimeFormatPart | undefined = etDateParts.find((part: Intl.DateTimeFormatPart) => part.type === 'hour')
  
  if (!weekdayPart || !hourPart) {
    return false
  }
  
  const weekday: string = weekdayPart.value
  const hour: number = parseInt(hourPart.value, 10)
  
  // Check if it's Monday-Friday and between 6am-10pm ET
  const isWeekday: boolean = !['Saturday', 'Sunday'].includes(weekday)
  const isBusinessHours: boolean = hour >= 6 && hour < 22 // 6am to 10pm ET
  
  return isWeekday && isBusinessHours
}

const pollSECFeed = async (db: Low<SECFilingState>): Promise<void> => {
  // Check if it's market hours before proceeding
  if (!isMarketHours()) {
    console.log('Outside of market hours (6am-10pm ET, Mon-Fri). Skipping poll.')
    return
  }

  try {
    const filings: SECFiling[] = await fetchSECFilings()
    await Promise.all(filings.map((filing: SECFiling) => processFiling(filing, db)))

    if (db.data) {
      db.data.lastUpdated = new Date().toISOString()
      await db.write()
    }
  } catch (error) {
    console.error('Error polling SEC feed:', error)
  }
}

const main = async (): Promise<void> => {
  console.log('Starting SEC filing monitor...')
  console.log(`Using data directory: ${DATA_DIR}`)

  const db: Low<SECFilingState> = await initializeDB()
  await pollSECFeed(db)
  setInterval(() => pollSECFeed(db), POLL_INTERVAL_MS)
}

main().catch((error: Error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
