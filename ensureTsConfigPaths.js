/**
 * Create New App provides a way to directly import _any_ module by name
 * regardless of where it is located in your project's directory structure.
 * In order to ensure TypeScript can locate the modules, an alias map is needed.
 * The alias map for TypeScript is found in `tsconfig.paths.json`.
 *
 * To start the Vite server successfully, we both need to ensure that
 * `tsconfig.paths.json` exists and that it is a JSON parsable file so that
 * `createAliasMap.js` can take care of writing the complete contents.
 *
 * ---
 *
 * https://github.com/TypeStrong/ts-node/issues/1007 (configuration section)
 * https://github.com/TypeStrong/ts-node#tsconfig (ts-node CLI options)
 *
 * - ts-node/esm is needed instead of ts-node because we're using ESM.
 * - We need to tell it _not_ to use tsconfig.json
 * - It does _not_ parse cli arguments.
 * - We need to use env variable instead.
 */
import {writeFileSync} from 'fs'
import path from 'path'

const fullPath = `${process.cwd()}${path.sep}tsconfig.paths.json`

writeFileSync(fullPath, '{}\n', 'utf-8')
