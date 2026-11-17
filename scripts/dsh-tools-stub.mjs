/** `@deepseek-ai/dsh-tools` 的极小桩：check-skill.mjs 只关心"注册了什么"。 */
export function defineTool(definition) {
  return { ...definition, __stub: true }
}
