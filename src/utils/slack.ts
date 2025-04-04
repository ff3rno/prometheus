import axios from 'axios'
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { SlackMessagePayload, SlackResponse, SlackBlock } from '../types/slack'
import { SECDocumentAnalysis } from '../types/sec_analysis'
import { SECFiling } from '../types/sec'
import { Database } from '../types/database'

dotenv.config()

const SLACK_TOKEN = process.env.SLACK_AUTH_TOKEN || ''
const SLACK_CHANNEL = process.env.SLACK_SEC_MONITOR_CHANNEL || '#sec-monitor'

export const sendSlackNotification = async (
  filing: SECFiling,
  analysis: SECDocumentAnalysis,
  filePath: string
): Promise<void> => {
  if (!SLACK_TOKEN) {
    console.error('Slack token not configured, skipping notification')
    return
  }

  const { title, id, updated, summary } = filing
  const { 
    isPertinent, 
    isCryptoRelated, 
    keyInsights, 
    riskFactors, 
    potentialImpact, 
    relevantTickers, 
    confidence 
  } = analysis

  if (!isPertinent && !isCryptoRelated) {
    return
  }

  // Validate and normalize filePath for security
  const normalizedPath = path.normalize(filePath)
  const fileStats = fs.statSync(normalizedPath)
  const fileCreatedAt = new Date(fileStats.birthtime).toISOString()

  const headerBlock: SlackBlock = {
    type: 'header',
    text: {
      type: 'plain_text',
      text: `SEC Filing Alert: ${title}`
    }
  }

  const filingInfoBlock: SlackBlock = {
    type: 'section',
    fields: [
      {
        type: 'mrkdwn',
        text: `*Filing ID:*\n${id}`
      },
      {
        type: 'mrkdwn',
        text: `*Updated:*\n${updated}`
      },
      {
        type: 'mrkdwn',
        text: `*Pertinent:*\n${isPertinent ? '✅' : '❌'}`
      },
      {
        type: 'mrkdwn',
        text: `*Crypto-Related:*\n${isCryptoRelated ? '✅' : '❌'}`
      }
    ]
  }

  const filingDetailsBlock: SlackBlock = {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*Summary:*\n${JSON.stringify(summary)}`
    }
  }

  const blocks: SlackBlock[] = [
    headerBlock,
    filingInfoBlock,
    filingDetailsBlock
  ]

  if (keyInsights.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Key Insights:*\n• ${keyInsights.join('\n• ')}`
      }
    })
  }

  if (riskFactors.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Risk Factors:*\n• ${riskFactors.join('\n• ')}`
      }
    })
  }

  if (potentialImpact) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Potential Impact:*\n${potentialImpact}`
      }
    })
  }

  if (relevantTickers.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Relevant Tickers:*\n${relevantTickers.join(', ')}`
      }
    })
  }

  blocks.push({
    type: 'section',
    fields: [
      {
        type: 'mrkdwn',
        text: `*Confidence:*\n${(confidence * 100).toFixed(1)}%`
      },
      {
        type: 'mrkdwn',
        text: `*Analysis Saved:*\n${fileCreatedAt}`
      }
    ]
  })

  blocks.push({
    type: 'divider'
  })

  const payload: SlackMessagePayload = {
    channel: SLACK_CHANNEL,
    text: `SEC Filing Alert: ${title}`,
    blocks
  }

  try {
    const response = await axios.post<SlackResponse>(
      'https://slack.com/api/chat.postMessage',
      payload,
      {
        headers: {
          'Authorization': `Bearer ${SLACK_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    )

    const { ok, error } = response.data
    
    if (!ok) {
      console.error(`Slack API error: ${error}`)
    }
  } catch (error) {
    console.error('Failed to send Slack notification:', error)
  }
}

export const sendNotificationForSavedAnalysis = async (
  filingId: string, 
  analysisFilePath: string, 
  db: Database
): Promise<void> => {
  // Validate and normalize path for security
  const normalizedPath = path.normalize(analysisFilePath)
  if (!fs.existsSync(normalizedPath)) {
    console.error(`Analysis file not found: ${normalizedPath}`)
    return
  }

  try {
    const analysisContent = fs.readFileSync(normalizedPath, 'utf-8')
    const analysis = JSON.parse(analysisContent) as SECDocumentAnalysis
    
    if ('error' in analysis) {
      console.error(`Cannot send notification for analysis with error: ${String(analysis.error)}`)
      return
    }
    
    // Check if the key exists in the database and has the correct structure
    const lastProcessedFilings = db.data?.lastProcessedFilings
    if (!lastProcessedFilings || typeof lastProcessedFilings !== 'object') {
      console.error('Invalid database structure: lastProcessedFilings not found or invalid')
      return
    }
    
    const filing = lastProcessedFilings[filingId] as SECFiling | undefined
    if (!filing) {
      console.error(`Filing data not found for ID: ${filingId}`)
      return
    }
    
    await sendSlackNotification(filing, analysis, normalizedPath)
    console.log(`Sent Slack notification for filing ${filingId}`)
  } catch (error) {
    console.error(`Failed to send notification for saved analysis: ${String(error)}`)
  }
} 