import { Signale } from 'signale'
import WS from 'ws'

const BITMEX_WS_API_URL = 'wss://ws.bitmex.com/realtime'

const getLogger = (scope: string) => new Signale({ scope: `prometheus:${scope}` })

const l = getLogger('main')
const run = async () => {
  const ws = new WS(BITMEX_WS_API_URL)

  ws.on('open', () => {
    l.info('ws open')

    ws.send(JSON.stringify({
      op: 'subscribe',
      args: ['trade:XBTUSD']
    }))
  })

  ws.on('error', (err: string) => {
    l.info(`ws error: ${err}`)
  })

  ws.on('message', (data: Buffer) => {
    l.star(data.toString())
  })
}

run().catch((err: any): void => {
  l.error(err?.message ?? err)
})