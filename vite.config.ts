import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'
import createAliasMap from './createAliasMap'
import ViteRestart from 'vite-plugin-restart'

/**
 * Example usage of `createAliasMap`:
 *
 * createAliasMap([
 *   {
 *     sourcePath: './src/components',
 *     watchExtensions: ['.ts', '.tsx', '.js', '.jsx'],
 *     prefix: '@components',
 *     ignored: [regex, glob, string]
 *   },
 *   ...
 * ])
 *
 * `vite-plugin-restart` is being used to restart the server any time changes
 * are detected in `tsconfig.paths.json`. Changes will happen whenever a file
 * matching the `extensions` option is added or deleted anywhere in the
 * `sourcePath` directory. This allows users to add components _anywhere_ in the
 * `sourcePath` folder and require it directly without specifying its location.
 */
export default defineConfig(async () => {
  const alias = await createAliasMap([
    {sourcePath: './src', extensions: ['.ts', '.tsx', '.js', '.jsx']},
  ])

  return {
    plugins: [
      react(),
      // @ts-ignore - Doesn't look like `vite-plugin-restart` exports correctly.
      ViteRestart.default({restart: ['tsconfig.paths.json']}),
    ],
    resolve: {alias},
    clearScreen: false,
    server: {open: true},
  }
})
