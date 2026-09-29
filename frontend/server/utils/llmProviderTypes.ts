/**
 * LLM provider 描述。
 *
 * 单独成文件是为了打断循环依赖：`llmBuyer.ts` 要调用 `imageJudge.ts` 做视觉质检，
 * 而 `imageJudge.ts` 需要 provider 的类型 —— 类型若定义在 llmBuyer 里就成环了。
 */
export interface LlmProvider {
  /** 日志里用的可读名（用模型名）。 */
  label: string
  baseUrl: string
  apiKey: string
  model: string
}
