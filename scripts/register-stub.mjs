/**
 * 本地回归用的解析桩注册：把 `@deepseek-ai/dsh-tools` 指到 scripts/dsh-tools-stub.mjs。
 * 用 registerHooks（同步钩子）而不是已弃用的 module.register。
 * 真实运行时该 peer 由 Host 提供，脚本只关心"注册了哪些工具/技能"。
 */
import { registerHooks } from 'node:module'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/dsh-tools') {
      return { url: new URL('./dsh-tools-stub.mjs', import.meta.url).href, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})
