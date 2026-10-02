/**
 * LLM provider 描述。
 *
 * 单独成文件是为了打断循环依赖：`llmBuyer.ts` 要调用 `imageJudge.ts` 做视觉质检，
 * 而 `imageJudge.ts` 需要 provider 的类型 —— 类型若定义在 llmBuyer 里就成环了。
 */
export interface LlmProvider {
  /** 日志里用的可读名（用模型名）。也是熔断器的分组键，两条线路不能同名。 */
  label: string
  baseUrl: string
  apiKey: string
  model: string
  /**
   * 该线路单次调用的时间上限（毫秒）。留空则用全局 `LLM_TIMEOUT_MS`。
   *
   * 两条线路的合理取值可以差很多：跨境中转站抖动大、要留足；国内直连快且稳，
   * 给同样的 40s 只会让「它其实早就挂了」这件事晚 40s 才被发现。
   */
  timeoutMs?: number
}
