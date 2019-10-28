const { execPath } = require('process')
const { serialize, deserialize } = require('v8')
const { promisify } = require('util')
const { write } = require('fs')

const execa = require('execa')
const getStream = require('get-stream')

const { getOutputStream, writeProcessOutput, writeProcessError } = require('../log/stream')

const CHILD_MAIN_PATH = `${__dirname}/child/main.js`

const pWrite = promisify(write)

// Execute a plugin specific event handler.
// Information messages are:
//   - passed as arguments to the child process
//   - retrieved from std3
// We fire plugins through a child process so that:
//  - each plugin is sandboxed, e.g. cannot access/modify its parent `process`
//    (for both security and safety reasons)
//  - logs can be buffered which allows manipulating them for log shipping,
//    secrets redacting and parallel plugins
const executePlugin = async function(eventName, message, { baseDir }) {
  const messageString = serializeMessage(message)

  // `process.execPath` is 'node'.
  // See https://github.com/netlify/build/issues/387 for explanations on why
  // we need this instead of simply using 'node'.
  const childProcess = execa(execPath, [CHILD_MAIN_PATH, eventName, messageString], {
    cwd: baseDir,
    stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
    preferLocal: true,
    all: true,
  })
  const all = getOutputStream(childProcess)

  try {
    const [output, responseString] = await Promise.all([
      getStream(all),
      getStream(childProcess.stdio[RESPONSE_FD]),
      childProcess,
    ])
    writeProcessOutput(output)

    const response = parseMessage(responseString)
    return { response, output }
  } catch (error) {
    writeProcessError(error)
    // Fix the error message produced by Execa
    error.message = error.message.replace(NODE_ARGS_REGEXP, '')
    throw error
  }
}

// We don't want to report `process.argv` as it's not useful and might contain
// confidential information (such as the API token)
const NODE_ARGS_REGEXP = /: .*/

// Retrieve information passed from parent process to plugin child process
const getMessageFromParent = function() {
  const [eventName, messageString] = process.argv.slice(2)
  // Ensure plugins do not access `messageString` since it might contain
  // secret information such as the API token
  process.argv = process.argv.slice(0, 1)

  const message = parseMessage(messageString)
  return { eventName, message }
}

// Pass information from plugin child process to parent process
const sendMessageToParent = async function(response) {
  const responseString = serializeMessage(response)
  await pWrite(RESPONSE_FD, responseString)
}

const RESPONSE_FD = 3

// Serialize/parse with `v8` which allows us to pass more types than JSON allows
const serializeMessage = function(message) {
  const buffer = serialize(message)
  const messageString = buffer.toString('hex')
  return messageString
}

const parseMessage = function(messageString) {
  const buffer = Buffer.from(messageString, 'hex')
  const message = deserialize(buffer)
  return message
}

module.exports = { executePlugin, getMessageFromParent, sendMessageToParent }
