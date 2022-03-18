import path from 'path'
import chokidar from 'chokidar'
import {writeFile, readFile} from 'fs/promises'
import {fileURLToPath} from 'url'
import chalk from 'chalk'

import type {Matcher} from 'anymatch'
import type {AliasOptions} from 'vite'

const DIR_NAME = path.dirname(fileURLToPath(import.meta.url))
const INITIALIZED_FLAG = '__VITE_APP_ALIAS_MAP_INITIALIZED__'
const TS_PATHS_CONFIG_LOCATION = path.resolve(DIR_NAME, 'tsconfig.paths.json')
const getIsInitialized = () => !!process.env[INITIALIZED_FLAG]

type CreateAliasInputType = {
  sourcePath: string // Relative path.
  extensions: string[] // Example: ['.ts', '.tsx', '.js', '.jsx']
  prefix?: string // Example: '@components'
  ignored?: Matcher
}
type FileMapType = Record<string, string[]>
type TsConfigPathsType = {
  compilerOptions: {
    paths: Record<string, [string]>
  }
}
type CreateViteAliasMapReturnType = {find: string; replacement: string}
type DuplicateModulesType = Array<[string, string[]]>

/**
 * Creates and returns the alias map consumed by `vite.config.js` with the side
 * effect of creating the `compilerOptions.paths` data for `tsconfig.json`.
 *
 * Vite will restart the app (re-requiring this module) if the Vite config or
 * TypeScript config files are changed. Therefore, this module relies on a flag
 * set on `process.env` to know whether this is the first time it's being run.
 * If it's not the first run, it will reconstruct the alias map from
 * `tsconfig.paths.json`. If it is the first run, it will start from scratch.
 */
export default async function createAliasMap(
  arr: CreateAliasInputType[]
): Promise<AliasOptions> {
  const aliasArray = arr.map(({sourcePath, ...rest}) => {
    // Transform the `sourcePath` to be an absolute path.
    return {sourcePath: path.resolve(DIR_NAME, sourcePath), ...rest}
  })

  /**
   * keys:
   * The "from" value used for importing.
   * Example - `import x from '@components/x'
   *
   * value:
   * An absolute path resolving to the actual module
   *
   * Shape:
   * {"@components/App": <absolutePath>, ...}
   */
  let fileMap: FileMapType = {}

  return new Promise(resolve => {
    if (getIsInitialized()) {
      readFile(TS_PATHS_CONFIG_LOCATION).then(res => {
        const tsconfigPathsFileContents = res.toString('utf8')
        fileMap = tsConfigPathsToFileMap(tsconfigPathsFileContents)
        const aliasMap = createViteAliasMap(fileMap)

        resolve(aliasMap)
      })
    } else {
      const pathsToWatch: string[] = []
      const ignoredArr: Matcher = [/vite-env.d.ts/]
      aliasArray.forEach(({sourcePath, extensions, ignored}) => {
        const globExtensions = extensions.map(ext => `*${ext}`).join('|')
        pathsToWatch.push(
          path.resolve(DIR_NAME, `${sourcePath}/**/(${globExtensions})`)
        )

        if (ignored) {
          Array.isArray(ignored)
            ? ignoredArr.push(...ignored)
            : ignoredArr.push(ignored)
        }
      })

      chokidar
        .watch(pathsToWatch, {ignored: ignoredArr})
        .on('add', absoluteFilePath => {
          processWatcherEvent('add', absoluteFilePath, fileMap, aliasArray)
        })
        .on('unlink', relativeFilePath => {
          processWatcherEvent('unlink', relativeFilePath, fileMap, aliasArray)
        })
        .on('ready', () => {
          const aliasMap = createViteAliasMap(fileMap)

          writeTsConfigPathsJSON(fileMap).then(() => {
            // A flag signifying the alias map has been initialized.
            process.env[INITIALIZED_FLAG] = Date.now().toString()
            resolve(aliasMap)
          })
        })
    }
  })
}

/**
 * Takes in a `fileMap` and creates the actual `aliasMap` that gets consumed
 * by `vite.config.js` with te side effect of warning in the console if any
 * duplicate modules have been found.
 */
function createViteAliasMap(
  fileMap: FileMapType
): CreateViteAliasMapReturnType[] {
  const duplicates: DuplicateModulesType = []
  const aliasMap = Object.entries(fileMap).map(([find, replacements]) => {
    /**
     * It's possible that two files with the same name end up getting mapped to
     * the same replacement (`compilerOptions.paths[key]` for
     * tsconfig.paths.json). We naively go with the first value we have and warn
     * in the console about what we found.
     */
    const replacement = replacements[0]
    if (replacements.length > 1) duplicates.push([find, replacements])

    return {find, replacement}
  })

  logMultipleModuleWarnings(duplicates)
  return aliasMap
}

/**
 * Returns the path prefix for importing modules, such as '@components', which
 * would look like:
 *
 * import MyComponent from '@components/MyComponent'
 */
function getImportPrefix(
  absoluteFilePath: string,
  arr: CreateAliasInputType[]
): string | undefined {
  return arr.find(item => absoluteFilePath.startsWith(item.sourcePath))?.prefix
}

/**
 * Responds to Chokidar's 'add' and 'unlink' events and updates `fileMap`
 * accordingly, triggering the creation of `tsConfig.paths.json`.
 */
async function processWatcherEvent(
  evt: 'add' | 'unlink',
  absoluteFilePath: string,
  fileMap: FileMapType,
  aliasArray: CreateAliasInputType[]
): Promise<void> {
  const componentPathPrefix = getImportPrefix(absoluteFilePath, aliasArray)
  const fileName = path.parse(absoluteFilePath).name
  const mapKey = componentPathPrefix
    ? `${componentPathPrefix}${path.sep}${fileName}`
    : fileName

  if (evt === 'add') {
    fileMap[mapKey] = [...(fileMap[mapKey] ?? []), absoluteFilePath]
  }
  if (evt === 'unlink') {
    fileMap[mapKey] = fileMap[mapKey].filter(val => val !== absoluteFilePath)
    if (!fileMap[mapKey].length) delete fileMap[mapKey]
  }

  return writeTsConfigPathsJSON(fileMap)
}

/**
 * Creates `tsConfig.paths.json`.
 *
 * Example file contents:
 * {
 *   "compilerOptions": {
 *     "paths": {
 *       "@components/App": ["./src/App.tsx"],
 *       "@components/App": ["./src/components/a/Test.tsx"],
 *       ...
 *     }
 *   }
 * }
 */
function writeTsConfigPathsJSON(fileMap: FileMapType): Promise<void> {
  // Sort the names so the results are easier to digest for humans.
  const importNames = Object.keys(fileMap).sort((a, b) => {
    const name1 = a.toLocaleLowerCase()
    const name2 = b.toLowerCase()
    return name1 > name2 ? 1 : name1 < name2 ? -1 : 0
  })
  const paths = importNames.map((name, i) => {
    const isLastIndex = i === importNames.length - 1
    const comma = isLastIndex ? '' : ','
    const values = fileMap[name]

    if (values.length > 1) {
      const relativePathsQuoted = values.map(pathStr => {
        return `".${path.sep}${path.relative(DIR_NAME, pathStr)}"`
      })
      return `      "${name}": [${relativePathsQuoted.join(', ')}]${comma}`
    }

    const relativePath = path.relative(DIR_NAME, values[0])
    return `      "${name}": [".${path.sep}${relativePath}"]${comma}`
  })
  const contents = [
    '{',
    '  "compilerOptions": {',
    '    "paths": {',
    ...paths,
    '    }',
    '  }',
    '}',
    '',
  ].join('\n')

  return writeFile(TS_PATHS_CONFIG_LOCATION, contents, {encoding: 'utf8'})
}

/**
 * Converts a `tsconfig.paths.json` object into a `fileMap`.
 */
function tsConfigPathsToFileMap(str: string): FileMapType {
  const json = JSON.parse(str) as TsConfigPathsType
  const pathsObj = json.compilerOptions.paths

  return Object.entries(pathsObj).reduce(
    (fileMap, [mapKey, relativeFilePaths]) => {
      fileMap[mapKey] = relativeFilePaths.map(relativeFilePath => {
        return path.resolve(DIR_NAME, relativeFilePath)
      })
      return fileMap
    },
    {} as FileMapType
  )
}

/**
 * Logs a stylish warning in the console when modules with the same name but
 * different paths are found. The first one will be used.
 */
function logMultipleModuleWarnings(duplicates: DuplicateModulesType): void {
  console.warn()
  const textArr: string[] = []

  duplicates.forEach(([name, absolutePaths]) => {
    const cyanNum = chalk.cyan.bold(absolutePaths.length)
    const cyanName = chalk.cyan.bold(name)
    const yellowMsg = chalk.yellow('paths are associated with the module')
    const yellowColon = chalk.yellow(':')
    textArr.push(`${cyanNum} ${yellowMsg} ${cyanName}${yellowColon}`)

    absolutePaths.forEach((absolutePath, i) => {
      const relativePath = path.relative(DIR_NAME, absolutePath)
      const suffix = i === 0 ? '(← using)' : ''
      textArr.push(`  ${chalk.green(relativePath)}${suffix}`)
    })
    textArr.push('')
  })

  const maxLength = getMaxLengthNoAnsi(textArr)
  const header = ' *** MULTIPLE MODULES FOUND *** '
  const title = chalk.black.bgYellow(header)
  const padStart = Math.floor((maxLength - header.length) / 2)
  const padEnd = Math.ceil((maxLength - header.length) / 2)
  textArr.unshift('')
  textArr.unshift(`${' '.repeat(padStart)}${title}${' '.repeat(padEnd)}`)
  textArr.unshift('')

  frameText(textArr).forEach(line => console.warn(line))
  console.warn()
}

/**
 * Puts a yellow border around text and logs it to the console.
 */
function frameText(textArr: string[]): string[] {
  const maxLength = getMaxLengthNoAnsi(textArr)
  const h = chalk.yellow('─')
  const tl = chalk.yellow('╭')
  const tr = chalk.yellow('╮')
  const bl = chalk.yellow('╰')
  const br = chalk.yellow('╯')
  const v = chalk.yellow('│')
  const topBorder = `${tl}${h.repeat(maxLength + 2)}${tr}`
  const bottomBorder = `${bl}${h.repeat(maxLength + 2)}${br}`
  const content = textArr.map(msg => {
    const originalLength = removeAnsiChars(msg).length
    const repeatLength = maxLength - originalLength
    const padding = ' '.repeat(repeatLength)

    return `${v} ${msg}${padding} ${v}`
  })

  return [topBorder, ...content, bottomBorder]
}

/**
 * https://stackoverflow.com/a/25245824
 * Remove ANSI color characters (this is a bold cyan "hello"):
 * '\u001b[1m\u001b[36mhello\u001b[39m\u001b[22m'.replace(/\u001b\[.*?m/g, '')
 */
function removeAnsiChars(text: string): string {
  return text.replace(/\u001b\[.*?m/g, '')
}

/**
 * Gets the length of the longest string in an array of strings, ignoring ansi
 * characters.
 */
function getMaxLengthNoAnsi(textArr: string[]): number {
  return textArr.reduce((len, line) => {
    return Math.max(len, removeAnsiChars(line).length)
  }, 0)
}
