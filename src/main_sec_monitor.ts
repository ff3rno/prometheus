import axios from 'axios'
import { XMLParser } from 'fast-xml-parser'
import { Low } from 'lowdb'
import { JSONFile } from 'lowdb/node'
import * as path from 'path'
import * as fs from 'fs'
import * as dotenv from 'dotenv'
import Bottleneck from 'bottleneck'
import type { SECFeedResponse, SECFiling } from './types/sec'
import type { SECFilingState } from './types/sec_state'
import type { SECDownloadResult, SECDownloadError } from './types/sec_downloads'

dotenv.config()

const SEC_FEED_URL: string = 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&CIK=&type=&company=&dateb=&owner=include&start=0&count=40&output=atom'
const POLL_INTERVAL_MS: number = 60000
const DATA_DIR: string = process.env.DATA_DIR || path.join(process.cwd(), 'data')
const DOWNLOADS_DIR: string = path.join(DATA_DIR, 'downloads')
const USER_AGENT: string = 'Datsusara SEC Filing Monitor (ff3rno@gmail.com)'

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

feedLimiter.on('error', (error: Error) => {
  console.error('Feed rate limiter error:', error)
})

filingLimiter.on('error', (error: Error) => {
  console.error('Filing rate limiter error:', error)
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

const processFiling = async (filing: SECFiling, db: Low<SECFilingState>): Promise<void> => {
  const { id, updated, title, link, summary, category } = filing
  const { term, label } = category

  if (!db.data) return

  const isNewFiling: boolean = !db.data.lastProcessedFilings[id]

  if (isNewFiling) {
    console.log(`New filing: ${title}`)
    console.log(`Type: ${term} (${label})`)
    console.log(`Link: ${JSON.stringify(link)}`)
    console.log(`Summary: ${JSON.stringify(summary)}`)

    try {
      const downloadResult: SECDownloadResult = await downloadFiling(filing)
      console.log(`Downloaded filing to: ${downloadResult.filePath} (${downloadResult.size} bytes)`)
    } catch (error) {
      const downloadError: SECDownloadError = {
        error: error instanceof Error ? error.message : 'Unknown error',
        filingId: id,
        attemptedAt: new Date().toISOString()
      }

      console.error('Failed to download filing:', downloadError)
    }

    console.log('---')

    db.data.lastProcessedFilings[id] = {
      ...filing,
      processedAt: new Date().toISOString()
    }
  }
}

const pollSECFeed = async (db: Low<SECFilingState>): Promise<void> => {
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
