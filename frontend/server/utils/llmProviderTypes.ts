/**
 * LLM provider 描述。
 *
 * 单独成文件是为了打断循环依赖：`llmBuyer.ts` 要调用 `imageJudge.ts` 做视觉质检，
 * 而 `imageJudge.ts` 需要 provider 的类型 —— 类型若定义在 llmBuyer 里就成环了。
 */
export interface LlmProvider {
  /** 日志里用的可读名（用模型名），同时是熔断器的分组键。 */
  label: string
  baseUrl: string
  apiKey: string
  model: string
  /**
   * 该出口是否支持 DeepSeek 的服务端联网工具 `deepseek_web_search`。
   *
   * 只在官方直连时为 true：中转站不转发这类内置能力，标准 function calling
   * 那条老路（Tavily 代搜）仍然保留给它。
   */
  nativeWebSearch?: boolean
}
