export type SECLink = {
  rel: string
  type: string
  href: string
}

export type SECCategory = {
  term: string
  label: string
}

export type SECFiling = {
  id: string
  updated: string
  title: string
  link: SECLink
  summary: string
  category: SECCategory
}

export type SECFeedResponse = {
  feed: {
    entry: SECFiling[]
  }
} 