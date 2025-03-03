import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'
import { Low } from 'lowdb'
import { JSONFile } from 'lowdb/node'
import { sendNotificationForSavedAnalysis } from './utils/slack'
import type { SECFilingState } from './types/sec_state'
import type { SECDocumentAnalysis } from './types/sec_analysis'

dotenv.config()

const DATA_DIR = process.env.DATA_DIR || './data'
const ANALYSIS_DIR = path.join(DATA_DIR, 'analysis')

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

const getAllFilesRecursively = (dir: string, fileList: string[] = []): string[] => {
  const files = fs.readdirSync(dir)
  
  files.forEach((file) => {
    const filePath = path.join(dir, file)
    
    if (fs.statSync(filePath).isDirectory()) {
      getAllFilesRecursively(filePath, fileList)
    } else if (filePath.endsWith('.analysis.json')) {
      fileList.push(filePath)
    }
  })
  
  return fileList
}

const sendNotificationsForPertinentFindings = async (
  db: Low<SECFilingState>, 
  daysBack: number = 7
): Promise<void> => {
  console.log(`Checking for pertinent SEC filings from the last ${daysBack} days...`)
  
  if (!fs.existsSync(ANALYSIS_DIR)) {
    console.error(`Analysis directory not found: ${ANALYSIS_DIR}`)
    return
  }
  
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - daysBack)
  
  const analysisFiles = getAllFilesRecursively(ANALYSIS_DIR)
  console.log(`Found ${analysisFiles.length} analysis files`)
  
  const pertinentFindings: { filingId: string; analysisPath: string; analysisDate: Date }[] = []
  
  for (const analysisPath of analysisFiles) {
    try {
      const analysis: SECDocumentAnalysis = JSON.parse(fs.readFileSync(analysisPath, 'utf-8'))
      
      if (!('error' in analysis) && (analysis.isPertinent || analysis.isCryptoRelated)) {
        const analysisDate = new Date(analysis.analysisDate)
        
        if (analysisDate >= cutoffDate) {
          let foundFilingId: string | null = null
          
          if (db.data) {
            for (const [filingId, filing] of Object.entries(db.data.lastProcessedFilings)) {
              if (filing.analyzedDocuments?.some((doc) => doc.analysisFilePath === analysisPath)) {
                foundFilingId = filingId
                break
              }
            }
          }
          
          if (foundFilingId) {
            pertinentFindings.push({
              filingId: foundFilingId,
              analysisPath,
              analysisDate
            })
          }
        }
      }
    } catch (error) {
      console.error(`Error processing analysis file ${analysisPath}:`, error)
    }
  }
  
  console.log(`Found ${pertinentFindings.length} pertinent findings to notify about`)
  
  pertinentFindings.sort((a, b) => b.analysisDate.getTime() - a.analysisDate.getTime())
  
  for (const finding of pertinentFindings) {
    console.log(`Sending notification for filing ID: ${finding.filingId}`)
    await sendNotificationForSavedAnalysis(finding.filingId, finding.analysisPath, db)
  }
}

const main = async (): Promise<void> => {
  try {
    const db = await initializeDB()
    
    const daysBack = process.argv[2] ? parseInt(process.argv[2], 10) : 7
    
    await sendNotificationsForPertinentFindings(db, daysBack)
    
    console.log('Slack notification process completed')
  } catch (error) {
    console.error('Error in Slack notification process:', error)
    process.exit(1)
  }
}

main() 