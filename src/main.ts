import EventEmitter from 'node:events'
import net from 'node:net'
import type { Writable } from 'node:stream'

const args = process.argv.slice(2)

let i = 0
while (i < args.length) {
	const eqidx = args[i].indexOf('=')
	if (eqidx !== -1) {
		const left = args[i].substring(0, eqidx)
		const right = args[i].substring(eqidx + 1)
		args[i] = left
		args.splice(i + 1, 0, right)
		i++
	}
	i++
}

function printHelp(w: Writable) {
	w.write(`Usage: ${process.argv[1]} [options]\n`)
	w.write(`Options:\n`)
	w.write(`  -u, --use <client|server>  Run as either the client or server (default: client) (USE)\n`)
	w.write(`  -h, --host <host>          Host to connect to (default: 127.0.0.1) (HOST)\n`)
	w.write(`  -p, --port <port>          Port to connect to (default: 3001) (PORT)\n`)
}

let optUse = process.env.USE || 'client'
let optHost = process.env.HOST || '127.0.0.1'
let optPort = process.env.PORT || '3001'

i = 0
while (i < args.length) {
	switch (args[i]) {
		case '-h':
		case '--host': {
			if (i + 1 > args.length) {
				process.stderr.write("Missing value for --host\n")
				process.exit(1)
			}
			i++
			optHost = args[i].trim()
			break;
		}
		case '-p':
		case '--port': {
			if (i + 1 > args.length) {
				process.stderr.write("Missing value for --port\n")
				process.exit(1)
			}
			i++
			optPort = args[i]
			break;
		}
		case '-u':
		case '--use': {
			if (i + 1 > args.length) {
				process.stderr.write("Missing value for --use\n")
				process.exit(1)
			}
			i++
			switch (args[i]) {
				case 'client':
					optUse = 'client'
					break
				case 'server':
					optUse = 'server'
					break
				default:
					process.stderr.write("Invalid value for --use\n")
					process.exit(1)
			}
			break
		}
		case '--help': {
			printHelp(process.stdout)
			process.exit(0)
		}
		default: {
			process.stderr.write(`Unknown option: ${args[i]}\n`)
			process.exit(1)
		}
	}
	i++
}

let errors: string[] = []
if (!optUse) {
	errors.push("Missing --use option\n")
}

if (errors.length) {
	for (let i = 0, len = errors.length; i < len; i++) {
		process.stderr.write(errors[i])
	}
	process.exit(1)
}

switch (optUse) {
	case 'client': {
		const host = optHost
		const port = parseInt(optPort, 10)
		if (isNaN(port)) {
			process.stderr.write(`Invalid port: ${optPort}\n`)
			process.exit(1)
		}
		runClient(host, port)
		break
	}
	case 'server': {
		const host = optHost
		const port = parseInt(optPort, 10)
		if (isNaN(port)) {
			process.stderr.write(`Invalid port: ${optPort}\n`)
			process.exit(1)
		}
		runServer(host, port)
		break
	}
	default: {
		process.stderr.write(`Something went wrong: unhandled optUse: ${optUse}`)
		process.exit(1)
	}
}


function runServer(host: string, port: number) {
	function log(message: string) {
		process.stdout.write(`[\x1b[32mserver\x1b[0m] ${message}\n`)
	}

	log("Running server")

	const server = net.createServer()
	const conns = new Map<number, Conn>()

	let sockerIdSeq = 0

	interface Conn extends net.Socket {
		id: number
		linebuf: string
	}

	function broadcast(message: string) {
		log(`Broadcasting to ${conns.size}: ${JSON.stringify(message)} (${message.length})`)
		const line = `${message}\n`
		for (const conn of conns.values()) {
			conn.write(line)
		}
	}

	function onConnClose(this: Conn, hadError: boolean) {
		conns.delete(this.id)
		broadcast(`${this.id} has left`)
		log(`Connection closed  \x1b[32mconn\x1b[0m=${this.id}  \x1b[32mhadError\x1b[0m=${hadError}`)
	}

	function onConnData(this: Conn, data: string) {
		log(`Recv: ${JSON.stringify(data)}`)
		for (let i = 0, len = data.length; i < len; i++) {
			const char = data[i]
			if (char === '\n') {
				// broadcast
				const line = this.linebuf
				broadcast(line)
				this.linebuf = ''
			} else {
				this.linebuf = this.linebuf + char
			}
		}
	}
	function onConnError(err: Error) {
		log(`Connection error  \x1b[32merr\x1b[0m=${err.message}`)
	}

	function onServerConnection(this: net.Server, conn: Conn) {
		const id = (sockerIdSeq += 1)
		broadcast(`${id} has joined`)
		conn.id = id
		conn.linebuf = ''
		conn.setEncoding('utf8')
		conns.set(id, conn)
		conn.on("close", onConnClose);
		conn.on("data", onConnData);
		conn.on("error", onConnError)
	}
	function onServerClose(this: net.Server) {
		clearTimeout(serverListeningTimeout)
		log("Server closed")
		process.exit(1)
	}
	function onServerError(this: net.Server, err: Error) {
		log(`Server error   \x1b[32merr\x1b[0m=${err.message}`)
	}
	function onServerListeningTimeout(this: net.Server) {
		log("Server listening timeout")
		process.exit(1)
	}
	function onServerListening() {
		clearTimeout(serverListeningTimeout)
		log("Server listening")
	}

	server.on("connection", onServerConnection);
	server.on("close", onServerClose);
	server.on("error", onServerError)
	server.on("listening", onServerListening)
	const serverListeningTimeout = setTimeout(onServerListeningTimeout, 1_000, server)

	server.listen(port, host)
}

function runClient(host: string, port: number) {
	let DEBUG = false

	process.stdin.setRawMode(true)
	process.stdin.setEncoding('utf8')

	function log(msg: string) {
		clear()
		process.stdout.write(`${msg}\n`)
		process.stdout.write(`> ${currentLine}`)
	}

	function logevent(msg: string) {
		log(`[\x1b[32mevent\x1b[0m] ${msg}`)
	}

	function clear() {
		process.stdout.write('\x1b[2K') // Clear entire current line
		process.stdout.write('\x1b[0G') // Move to beginning of line
		const rows = Math.ceil((currentLine.length + 2) / process.stdout.columns)
		for (let i = 1; i < rows; i++) {
			process.stdout.write('\x1b[1A\x1b[K') // delete row
		}
	}

	function debug(msg: string) {
		if (DEBUG) {
			log(`[\x1b[34mdebug\x1b[0m] ${msg}`)
		}
	}

	function prompt() {
		process.stdout.write(`> ${currentLine}`)
	}

	function exit(number: number) {
		process.exit(number)
	}

	let currentLine = ''

	const sendBuffer: string[] = []
	const sendEmitter = new EventEmitter()
	function send(message: string) {
		sendBuffer.push(message)
		sendEmitter.emit('send')
	}
	let connectRetryIdx = 0
	const connectRetryTimeouts = [500, 1_000, 2_000, 5_000, 10_000]
	let isSending = false
	function connect() {
		logevent(`Connecting to server  \x1b[32mHOST\x1b[0m=${host}  \x1b[32mPORT=\x1b[0m=${port}  \x1b[32mattempt\x1b[0m=${connectRetryIdx + 1}`)
		const socket = net.connect(port, host)
		socket.setEncoding('utf8')
		function onSocketConnect(this: net.Socket) {
			connectRetryIdx = 0
			clearTimeout(socketConnectTimeout)
			logevent(`\x1b[32msocket_connected\x1b[0m`)
			onSendMessage()
		}
		function onSocketData(this: net.Socket, data: string) {
			for (let i = 0, lines = data.split('\n'), len = lines.length; i < len - 1; i++) {
				logevent(`Broadcast: ${JSON.stringify(lines[i])}`)
			}
		}
		function onSocketError(this: net.Socket, err: Error) {
			logevent(`\x1b[31msocket_error\x1b[0m  \x1b[32merr\x1b[0m=${err.message}`)
		}
		function onSocketClose(this: net.Socket, hadError: boolean) {
			const reconnectTimeoutMs = connectRetryTimeouts[connectRetryIdx]
			connectRetryIdx = Math.min(connectRetryIdx + 1, connectRetryTimeouts.length - 1)

			clearTimeout(socketConnectTimeout)
			logevent(`\x1b[31msocket_closed\x1b[0m  \x1b[32mhadError\x1b[0m=${hadError}  \x1b[32mretrying\x1b[0m=${reconnectTimeoutMs}ms`)

			sendEmitter.off('send', onSendMessage)
			setTimeout(connect, reconnectTimeoutMs)
		}
		function onSocketConnectTimeout(_: net.Socket) {
			logevent(`\x1b[31msocket_connect_timeout\x1b[0m`)
			socket.destroy(new Error('Connect timeout'))
		}
		function onSendMessage() {
			if (isSending) return
			if (!sendBuffer.length) return
			isSending = true
			const msg = sendBuffer[0];
			socket.write(`${msg}\n`, function(err?: Error) {
				if (err) {
					logevent(`\x1b[31msend_message_failed\x1b[0m  \x1b[32merr\x1b[0m=${err.message}\n`)
					return
				}
				sendBuffer.shift()
				isSending = false
				if (!socket.closed) {
					onSendMessage()
				}
			})
		}

		const socketConnectTimeout = setTimeout(onSocketConnectTimeout, 5_000, socket)
		socket.on('connect', onSocketConnect);
		socket.on('data', onSocketData)
		socket.on('error', onSocketError)
		socket.on('close', onSocketClose)
		sendEmitter.on('send', onSendMessage)
	}

	connect()

	function onStdinData(this: NodeJS.ReadStream, char: string) {
		//// (Note: char may be multiple chars)
		switch (char) {
			case '\u0003': // Ctrl-C (SIGINT)
				debug("CTRL-C")
				exit(0)
				break
			case '\u0004': // Ctrl-D (EOF)
				debug("CTRL-D")
				exit(0)
				break
			case '\u001a': // ? CTRL-Z (SIGSTOP)
				debug('CTRL-Z')
				break
			case '\u0013': // ? CTRL-S (stop scroll)
				debug('CTRL-S')
				break
			case '\u0011': // ? CTRL-Q (Start scroll)
				debug('CTRL-Q')
				break
			case '\u007f': // Backspace (Delete the character before the cursor)
			case '\u0008':
				debug('Backspace')
				clear()
				currentLine = currentLine.slice(0, -1)
				prompt()
				break
			case '\r': // Enter
			case '\n':
				if (currentLine.length === 0) {
					// Empty
					debug('ENTER (EMPTY)')
				} else if (/^\s*$/.test(currentLine)) {
					// Only whitespace
					debug('ENTER (WHITESPACE)')
				} else {
					debug('ENTER')
					const line = currentLine.replace(/^\s+|\s+$/g, '')

					let handled = false;
					if (line.startsWith('/')) {
						const [cmd, ...args] = line.replace(/\s+/g, ' ').split(' ')
						switch (cmd) {
							case '/debug': {
								switch (args[0]?.trim()) {
									case 'on': DEBUG = true; break;
									case 'off': DEBUG = false; break;
									default: DEBUG = !DEBUG; break;
								}
								log(`DEBUG: ${DEBUG}`)
								handled = true
								break;
							}
							case '/exit': {
								log('EXIT')
								clear()
								prompt()
								process.exit(0)
							}
						}
					}
					if (!handled) {
						// log(`sent: ${line}`)
						send(line)
					}
					clear()
					currentLine = ''
					prompt()
				}
				break
			case '\u0009': // Tab
				debug('TAB')
				break
			case '\u001b': // Escape (a string after escape indicates something!)
				debug('^[')
				break
			case '\u001b\u005b\u0041': // Up
				debug(`UP`)
				break;
			case '\u001b\u005b\u0042': // Down
				debug(`DOWN`)
				break;
			case '\u001b\u005b\u0043': // Right
				debug(`RIGHT`)
				break;
			case '\u001b\u005b\u0044': // Left
				debug(`LEFT`)
				break;
			default: // Maybe a character, maybe not. Add it to the string anyway.
				if (char.startsWith('\u001b')) {
					debug(`ESCAPE SEQUENCE: ${JSON.stringify(char)} (${char.split('').map(c => c.charCodeAt(0)).join(',')})`)
				} else {
					clear()
					currentLine = currentLine + char
					debug(`Character: ${JSON.stringify(char)} (${char.split('').map(c => c.charCodeAt(0)).join(',')}) line: ${JSON.stringify(currentLine)} (${currentLine.length})`)
					prompt()
				}
				break
		}
	}

	process.stdin.on("data", onStdinData)
}

