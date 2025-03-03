import axios from 'axios'
import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs'
import { SlackMessagePayload, SlackResponse, SlackText, SlackBlock } from '../types/slack'
import { SECDocumentAnalysis } from '../types/sec_analysis'
import { SECFiling } from '../types/sec'

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

  const fileStats = fs.statSync(filePath)
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
  db: any
): Promise<void> => {
  if (!fs.existsSync(analysisFilePath)) {
    console.error(`Analysis file not found: ${analysisFilePath}`)
    return
  }

  try {
    const analysis: SECDocumentAnalysis = JSON.parse(fs.readFileSync(analysisFilePath, 'utf-8'))
    
    if ('error' in analysis) {
      console.error(`Cannot send notification for analysis with error: ${analysis.error}`)
      return
    }
    
    if (!db.data?.lastProcessedFilings?.[filingId]) {
      console.error(`Filing data not found for ID: ${filingId}`)
      return
    }
    
    const filing: SECFiling = db.data.lastProcessedFilings[filingId]
    
    await sendSlackNotification(filing, analysis, analysisFilePath)
    console.log(`Sent Slack notification for filing ${filingId}`)
  } catch (error) {
    console.error(`Failed to send notification for saved analysis: ${error}`)
  }
} 