const express = require('express')
const { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys')
const { Boom } = require('@hapi/boom')
const QRCode = require('qrcode')

const app = express()
app.use(express.json())

const SESSION_PATH = process.env.SESSION_PATH || './session'
const PORT = process.env.PORT || 3000
const API_KEY = process.env.API_KEY || 'LoveSongs@2025entd'
const GROUP_JID = process.env.GROUP_JID || ''

let sock = null
let qrBase64 = null
let connectionState = 'disconnected'
let reconnectAttempts = 0

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH)
  const { version } = await fetchLatestBaileysVersion()
  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: true,
    browser: ['LoveSongs', 'Chrome', '120.0.0'],
    syncFullHistory: false,
    getMessage: async () => ({ conversation: '' })
  })
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update
    if (qr) {
      try {
        qrBase64 = await QRCode.toDataURL(qr)
        connectionState = 'qr'
        console.log('[LoveSongs] QR gerado')
      } catch (e) { console.error('[LoveSongs] Erro QR:', e) }
    }
    if (connection === 'close') {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode
      const loggedOut = statusCode === DisconnectReason.loggedOut
      connectionState = 'disconnected'
      qrBase64 = null
      if (!loggedOut) {
        reconnectAttempts++
        const delay = Math.min(3000 * reconnectAttempts, 30000)
        console.log('[LoveSongs] Reconectando em ' + delay + 'ms...')
        setTimeout(connectToWhatsApp, delay)
      }
    }
    if (connection === 'open') {
      connectionState = 'open'
      qrBase64 = null
      reconnectAttempts = 0
      console.log('[LoveSongs] Conectado!')
    }
  })
  sock.ev.on('creds.update', saveCreds)
}

const auth = (req, res, next) => {
  const key = req.headers['apikey'] || req.headers['x-api-key']
  if (key !== API_KEY) return res.status(401).json({ error: 'Unauthorized' })
  next()
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', connection: connectionState, group_jid: GROUP_JID || 'nao configurado' })
})

app.get('/qr', auth, (req, res) => {
  if (connectionState === 'open') return res.json({ status: 'connected' })
  if (!qrBase64) return res.json({ status: connectionState, message: 'QR ainda nao disponivel, aguarde...' })
  res.json({ status: 'qr_ready', base64: qrBase64 })
})

app.get('/state', auth, (req, res) => {
  res.json({ state: connectionState })
})

app.post('/send', auth, async (req, res) => {
  const { number, text } = req.body
  if (!sock || connectionState !== 'open') {
    return res.status(400).json({ error: 'Bot nao conectado', state: connectionState })
  }
  const jid = number || GROUP_JID
  if (!jid) return res.status(400).json({ error: 'Numero ou JID nao fornecido' })
  const targetJid = jid.includes('@') ? jid : jid + '@s.whatsapp.net'
  try {
    await sock.sendMessage(targetJid, { text })
    console.log('[LoveSongs] Mensagem enviada para ' + targetJid)
    res.json({ status: 'sent', to: targetJid })
  } catch (err) {
    console.error('[LoveSongs] Erro ao enviar:', err)
    res.status(500).json({ error: err.message })
  }
})

app.post('/send-to-group', auth, async (req, res) => {
  const { text } = req.body
  if (!sock || connectionState !== 'open') {
    return res.status(400).json({ error: 'Bot nao conectado', state: connectionState })
  }
  if (!GROUP_JID) return res.status(400).json({ error: 'GROUP_JID nao configurado' })
  try {
    await sock.sendMessage(GROUP_JID, { text })
    console.log('[LoveSongs] Mensagem enviada ao grupo ' + GROUP_JID)
    res.json({ status: 'sent', to: GROUP_JID })
  } catch (err) {
    console.error('[LoveSongs] Erro grupo:', err)
    res.status(500).json({ error: err.message })
  }
})

app.listen(PORT, () => {
  console.log('[LoveSongs] Bot rodando na porta ' + PORT)
  connectToWhatsApp()
})