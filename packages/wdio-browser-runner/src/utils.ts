import fs from 'node:fs/promises'
import path from 'node:path'

import { createRequire } from 'node:module'

import getPort from 'get-port'
import { WebSocketServer, WebSocket } from 'ws'
import { esbuildCommonjs } from '@originjs/vite-plugin-commonjs'
import { NodeGlobalsPolyfillPlugin } from '@esbuild-plugins/node-globals-polyfill'
import logger from '@wdio/logger'
import type { InlineConfig } from 'vite'
import type { Browser } from 'webdriverio'

import { testrunner } from './plugins/testrunner.js'
import { EVENTS, PRESET_DEPENDENCIES, BROWSER_POOL } from './constants.js'
import type { Environment, FrameworkPreset } from './types'

const log = logger('@wdio/browser-runner')

export async function getTemplate (options: WebdriverIO.BrowserRunnerOptions, env: Environment, spec: string) {
    const root = options.rootDir || process.cwd()
    const require = createRequire(path.join(root, 'node_modules'))
    const listeners = Object.entries(EVENTS).map(([mochaEvent, wdioEvent]) => (
        /*js*/`runner.on('${mochaEvent}', (payload) => {
            window.__wdioEvents__.push(formatMessage({ type: '${wdioEvent}', payload, err: payload.err }))
        })`
    )).join('\n')

    let vueDeps = ''
    if (options.preset === 'vue') {
        try {
            const vueDir = path.dirname(require.resolve('vue'))
            const vueScript = (await fs.readFile(path.join(vueDir, 'dist', 'vue.global.prod.js'), 'utf-8')).toString()
            vueDeps += /*html*/`
            <script type="module">
                ${vueScript}
                window.Vue = Vue
            </script>`
            const vueCompilerDir = path.dirname(require.resolve('@vue/compiler-dom'))
            const vueCompilerScript = (await fs.readFile(path.join(vueCompilerDir, 'dist', 'compiler-dom.global.prod.js'), 'utf-8')).toString()
            vueDeps += /*html*/`
            <script type="module">
                ${vueCompilerScript}
                window.VueCompilerDOM = VueCompilerDOM
            </script>`
        } catch (err: any) {
            throw new Error(
                `Fail to set-up Vue environment: ${err.message}\n\n` +
                'Make sure you have "vue" and "@vue/compiler-dom" installed as dependencies!'
            )
        }
    }

    return /* html */`
    <!doctype html>
    <html>
        <head>
            <title>WebdriverIO Browser Test</title>
            <link rel="stylesheet" href="https://unpkg.com/mocha@10.0.0/mocha.css">
            <script type="module">
                window.__wdioErrors__ = []
                window.__wdioSessionId__ = ${JSON.stringify(env.sessionId)}
                window.__wdioSessionCapabilities__ = ${JSON.stringify(env.capabilities)}
                addEventListener('error', (ev) => window.__wdioErrors__.push({
                    filename: ev.filename,
                    message: ev.message
                }))
            </script>
            ${vueDeps}
            <script type="module">
            import Mocha from 'https://esm.sh/mocha@10.0.0'
            const mocha = Mocha.setup(${JSON.stringify(env.args || {})})
            </script>
        </head>
        <body>
            <div id="mocha"></div>
            <script async type="module">
                import { formatMessage } from '@wdio/mocha-framework/common'
                import '${spec}'

                window.__wdioEvents__ = []
                console.log('[WDIO] Start Mocha testsuite')
                const runner = mocha.run((failures) => {
                    window.__wdioFailures__ = failures
                })
                ${listeners}
            </script>
        </body>
    </html>`
}

export async function getErrorTemplate (filename: string, error: Error) {
    return /*html*/`
        <pre>${error.stack}</pre>
        <script type="module">
            window.__wdioErrors__ = [{
                filename: "${filename}",
                message: \`${error.message}\`
            }]
        </script>
    `
}

async function userfriendlyImport (preset: FrameworkPreset, pkg?: string) {
    if (!pkg) {
        return {}
    }

    try {
        return await import(pkg)
    } catch (err: any) {
        throw new Error(
            `Couldn't load preset "${preset}" given important dependency ("${pkg}") is not installed.\n` +
            `Please run:\n\n\tnpm install ${pkg}\n\tor\n\tyarn add --dev ${pkg}`
        )
    }
}

export async function getViteConfig (options: WebdriverIO.BrowserRunnerOptions, root: string, port: number) {
    /**
     * user provided vite config
     */
    if (options.viteConfig) {
        return Object.assign({}, options.viteConfig, {
            plugins: [
                testrunner(options),
                ...(options.viteConfig.plugins || [])
            ]
        })
    }

    const wsPort = await getPort()
    const wss = new WebSocketServer({ port: wsPort })
    wss.on('connection', (ws) => ws.on('message', handleBrowserCommand(ws)))

    const config: Partial<InlineConfig> = {
        configFile: false,
        root,
        server: {
            port,
            host: 'localhost',
            proxy: {
                '/ws': {
                    target: `ws://localhost:${wsPort}`,
                    ws: true
                }
            }
        },
        plugins: [testrunner(options)],
        optimizeDeps: {
            esbuildOptions: {
                // Node.js global to browser globalThis
                define: {
                    global: 'globalThis',
                },
                // Enable esbuild polyfill plugins
                plugins: [
                    NodeGlobalsPolyfillPlugin({
                        process: true,
                        buffer: true
                    }),
                    esbuildCommonjs(['@testing-library/vue'])
                ],
            },
        }
    }

    if (options.preset) {
        const [pkg, importProp, opts] = PRESET_DEPENDENCIES[options.preset] || []
        const plugin = (await userfriendlyImport(options.preset, pkg))[importProp || 'default']
        if (plugin) {
            config.plugins!.push(plugin(opts))
        }
    }

    return config
}

function handleBrowserCommand (ws: WebSocket) {
    return async (data: Buffer) => {
        log.info(`Received browser message: ${data}`)
        try {
            const payload = JSON.parse(data.toString())
            const cid = payload.cid
            if (typeof cid !== 'number') {
                return ws.send(JSON.stringify({
                    id: payload.id,
                    error: `No "cid" property passed into command message with id "${payload.id}"`
                }))
            }

            const browser = await BROWSER_POOL.get(payload.cid) as Browser<'async'> | undefined
            if (!browser) {
                return ws.send(JSON.stringify({
                    id: payload.id,
                    error: `Couldn't find browser with cid "${payload.cid}"`
                }))
            }

            const result = await (browser[payload.commandName as keyof typeof browser] as Function)(...payload.args)
            const resultMsg = JSON.stringify({ id: payload.id, result })
            log.info(`Return command result: ${resultMsg}`)
            return ws.send(resultMsg)
        } catch (err: any) {
            log.error(`Failed handling command: ${err.message}`)
            return ws.send(JSON.stringify({ error: `Failed handling command message: ${err.message}` }))
        }
    }
}