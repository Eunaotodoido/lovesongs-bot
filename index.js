import express from 'express'
import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import QRCode from 'qrcode'
import { mkdirSync } from 'fs'

const SESSION_PATH = process.env.SESSION_PATH || './session'
const PORT = process.env.PORT || 3000
const API_KEY = process.env.API_KEY || 'LoveSongs@2025entd'
const GROUP_JID = process.env.GROUP_JID || ''

try { mkdirSync(SESSION_PATH, { recursive: true }) } catch {}

const app = express()
app.use(express.json())

let sock = null
let currentQR = null
let connectionState = 'disconnected'
let reconnectAttempts = 0

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH)
    const { version } = await fetchLatestBaileysVersion()

  sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: true,
        browser: ['LoveSongs', 'Chrome', '1.0.0'],
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update

                 if (qr) {
                         currentQR = await QRCode.toDataURL(qr)
                         connectionState = 'qr_ready'
                         console.log('QR code gerado — acesse /qr para escanear')
                 }

                 if (connection === 'close') {
                         connectionState = 'disconnected'
                         currentQR = null
                         const shouldReconnect = lastDisconnect?.error instanceof Boom
                           ? lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut
                                   : true

          if (shouldReconnect) {
                    reconnectAttempts++
                    const delay = Math.min(3000 * reconnectAttempts, 30000)
                    console.log(`Reconectando em ${delay}ms (tentativa ${reconnectAttempts})...`)
                    setTimeout(connectToWhatsApp, delay)
          } else {
                    console.log('Desconectado permanentemente (logout)')
          }
                 }

                 if (connection === 'open') {
                         connectionState = 'connected'
                         currentQR = null
                         reconnectAttempts = 0
                         console.log('WhatsApp conectado!')
                 }
  })
}

function authMiddleware(req, res, next) {
    const key = req.headers['x-api-key'] || req.query.apikey
    if (key !== API_KEY) return res.status(401).json({ error: 'Unauthorized' })
    next()
}

app.get('/health', (req, res) => {
    res.json({ status: 'ok', connection: connectionState, group_jid: GROUP_JID })
})

app.get('/qr', authMiddleware, (req, res) => {
    if (connectionState === 'connected') return res.json({ status: 'already_connected' })
    if (!currentQR) return res.json({ status: 'waiting_for_qr', message: 'QR ainda nao gerado, tente novamente' })
    res.json({ status: 'qr_ready', qr: currentQR })
})

app.get('/state', authMiddleware, (req, res) => {
    res.json({ state: connectionState })
})

app.post('/send', authMiddleware, async (req, res) => {
    const { number, text } = req.body
    if (!number || !text) return res.status(400).json({ error: 'number e text sao obrigatorios' })
    if (connectionState !== 'connected') return res.status(503).json({ error: 'WhatsApp nao conectado' })
    try {
          const jid = number.includes('@') ? number : `${number}@s.whatsapp.net`
          await sock.sendMessage(jid, { text })
          res.json({ success: true, to: jid })
    } catch (err) {
          res.status(500).json({ error: err.message })
    }
})

app.post('/send-to-group', authMiddleware, async (req, res) => {
    const { text, jid } = req.body
    const targetJid = jid || GROUP_JID
    if (!text) return res.status(400).json({ error: 'text e obrigatorio' })
    if (!targetJid) return res.status(400).json({ error: 'GROUP_JID nao configurado' })
    if (connectionState !== 'connected') return res.status(503).json({ error: 'WhatsApp nao conectado' })
    try {
          await sock.sendMessage(targetJid, { text })
          res.json({ success: true, to: targetJid })
    } catch (err) {
          res.status(500).json({ error: err.message })
    }
})

app.listen(PORT, () => {
    console.log(`LoveSongs Bot rodando na porta ${PORT}`)
    connectToWhatsApp()
})
