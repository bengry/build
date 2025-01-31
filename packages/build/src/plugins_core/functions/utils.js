'use strict'

const { stat } = require('fs')
const { relative } = require('path')
const { promisify } = require('util')

const { listFunctions } = require('@netlify/zip-it-and-ship-it')

const pStat = promisify(stat)

const { addErrorInfo } = require('../../error/info')

const getFunctionPaths = async function (functionsSrc) {
  if (functionsSrc === undefined) {
    return []
  }

  const functions = await listFunctions(functionsSrc)
  return functions.map(({ mainFile }) => relative(functionsSrc, mainFile))
}

const getUserAndInternalFunctions = ({
  functionsSrc,
  functionsSrcExists,
  internalFunctionsSrc,
  internalFunctionsSrcExists,
}) => {
  const paths = [
    functionsSrcExists ? functionsSrc : undefined,
    internalFunctionsSrcExists ? internalFunctionsSrc : undefined,
  ]

  return Promise.all(paths.map((path) => path && getFunctionPaths(path)))
}

// Returns `true` if the functions directory exists and is valid. Returns
// `false` if it doesn't exist. Throws an error if it's invalid or can't
// be accessed.
const validateFunctionsSrc = async function ({ functionsSrc, relativeFunctionsSrc }) {
  if (functionsSrc === undefined) {
    return false
  }

  try {
    const stats = await pStat(functionsSrc)

    if (stats.isDirectory()) {
      return true
    }

    const error = new Error(
      `The Netlify Functions setting should target a directory, not a regular file: ${relativeFunctionsSrc}`,
    )

    addErrorInfo(error, { type: 'resolveConfig' })

    throw error
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false
    }

    throw error
  }
}

module.exports = { getUserAndInternalFunctions, validateFunctionsSrc }
