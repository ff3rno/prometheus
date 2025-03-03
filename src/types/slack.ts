export type SlackMessagePayload = {
  channel: string
  text: string
  blocks?: SlackBlock[]
}

export type SlackBlock = {
  type: string
  text?: SlackText
  fields?: SlackText[]
  elements?: SlackElement[]
}

export type SlackText = {
  type: string
  text: string
}

export type SlackElement = {
  type: string
  text?: SlackText
}

export type SlackResponse = {
  ok: boolean
  channel: string
  ts: string
  message?: {
    text: string
  }
  error?: string
} 