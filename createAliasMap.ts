import path from 'path'
import chokidar from 'chokidar'
import {writeFile, readFile} from 'fs/promises'
import {fileURLToPath} from 'url'
import {AliasOptions} from 'vite'
import {Matcher} from 'anymatch'

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
type FileMapType = Record<string, string>
type TsConfigPathsType = {
  compilerOptions: {
    paths: Record<string, [string]>
  }
}

/**
 * Creates and returns the alias map consumed by `vite.config.js` with the side
 * effect of creating the `compilerOptions.paths` data for `tsconfig.json`.
 *
 * Vite will restart the app (re-requiring this module) if the Vite config or
 * TypeScript config files are changed. Therefore, this module relies on a flag
 * set on `process.env` to know whether this is the first time it's being run.
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
            console.log(fileMap)
          })
        })
    }
  })
}

function createViteAliasMap(fileMap: FileMapType) {
  return Object.entries(fileMap).map(([find, replacement]) => {
    return {find, replacement}
  })
}

function getImportPrefix(path: string, arr: CreateAliasInputType[]): string {
  return arr.find(item => path.startsWith(item.sourcePath))?.prefix ?? ''
}

async function processWatcherEvent(
  evt: 'add' | 'unlink',
  absoluteFilePath: string,
  fileMap: FileMapType,
  aliasArray: CreateAliasInputType[]
) {
  const componentPathPrefix = getImportPrefix(absoluteFilePath, aliasArray)
  const fileName = path.parse(absoluteFilePath).name
  const mapKey = componentPathPrefix
    ? `${componentPathPrefix}/${fileName}`
    : fileName

  if (evt === 'add') fileMap[mapKey] = absoluteFilePath
  if (evt === 'unlink') delete fileMap[mapKey]

  return writeTsConfigPathsJSON(fileMap)
}

/**
 * Example `tsConfig.paths.json` contents:
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
    const relativePath = path.relative(DIR_NAME, fileMap[name])

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

function tsConfigPathsToFileMap(str: string): FileMapType {
  const json = JSON.parse(str) as TsConfigPathsType
  const pathsObj = json.compilerOptions.paths

  return Object.entries(pathsObj).reduce(
    (fileMap, [mapKey, [relativeFilePath]]) => {
      fileMap[mapKey] = path.resolve(DIR_NAME, relativeFilePath)
      return fileMap
    },
    {} as FileMapType
  )
}

function getFileNameFromPath(filePath: string): string {
  return path.parse(filePath).name
}
