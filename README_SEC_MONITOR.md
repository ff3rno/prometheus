# SEC Filing Monitor with OpenAI Analysis

This system automatically monitors SEC filings through the SEC's RSS feed, downloads the filings and their associated documents, and uses OpenAI to analyze the content for trading/investing relevance.

## Features

- Monitors the SEC EDGAR RSS feed for new filings
- Downloads filing HTML and associated documents (PDFs, HTML, etc.)
- Uses OpenAI API to analyze documents and generate structured information
- Sends Slack notifications for pertinent or crypto-related filings
- Extracts key insights such as:
  - Summary of document contents
  - Pertinence for trading/investing decisions
  - Crypto-related content
  - Key insights and risk factors
  - Relevant tickers and potential market impact
- Prevents redundant processing of documents
- Rate-limited API calls to both SEC and OpenAI

## Setup

1. Ensure you have Node.js installed
2. Install dependencies: `npm install`
3. Create a `.env` file with the following variables:

```
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-4o 
DATA_DIR=./data
SLACK_AUTH_TOKEN=your_slack_token
SLACK_SEC_MONITOR_CHANNEL=#your-channel-name
```

## Running

To start the SEC monitor:

```bash
npm run build
node dist/main_sec_monitor.js
```

## Data Structure

The system stores data in the following directories:

- `data/downloads`: Raw HTML filings from the SEC feed
- `data/archives`: Documents extracted from the filings
- `data/analysis`: JSON files containing OpenAI's analysis of each document

## Analysis Format

Each analysis JSON file contains the following structure:

```json
{
  "summary": "A concise summary of the document contents",
  "isPertinent": true/false,
  "isCryptoRelated": true/false,
  "keyInsights": ["Insight 1", "Insight 2", ...],
  "riskFactors": ["Risk 1", "Risk 2", ...],
  "potentialImpact": "Assessment of potential market impact",
  "relevantTickers": ["TICKER1", "TICKER2", ...],
  "confidence": 0.95,
  "analysisDate": "2023-06-01T12:34:56.789Z"
}
```

## Slack Integration

The system can send notifications to a Slack channel when pertinent or crypto-related filings are detected. To enable this feature:

1. Create a Slack app with the following permissions:
   - `chat:write`
   - `files:write`
2. Add your Slack app to the desired channel
3. Set the required environment variables in your `.env` file:
   - `SLACK_AUTH_TOKEN`: Your Slack bot token
   - `SLACK_SEC_MONITOR_CHANNEL`: The channel to post notifications to (default: `#sec-monitor`)

Notifications include:
- Filing details (company, title, date)
- Analysis summary
- Key insights
- Risk factors (if any)
- Potential market impact
- Relevant tickers

## Customization

You can customize the analysis by modifying the `analyzeDocument` function in `src/main_sec_monitor.ts`. This includes:

- Changing the prompt to OpenAI
- Adding or removing fields from the structured output
- Modifying the confidence thresholds

## Rate Limiting

The system includes rate limiting to respect both SEC and OpenAI API rate limits:
- SEC Feed: 10 requests per minute
- SEC Documents: 60 requests per minute
- OpenAI Analysis: Configured to 2 concurrent requests with a 1-second delay between requests

## License

MIT 