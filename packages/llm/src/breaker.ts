// 熔断器：连续 N 次失败后开路（直接走降级），冷却期后半开重试一次。
export class CircuitBreaker {
  private consecutiveFailures = 0;
  private openedAt = 0;

  constructor(
    private readonly threshold = 3,
    private readonly cooldownMs = 120_000,
  ) {}

  get isOpen(): boolean {
    if (this.consecutiveFailures < this.threshold) return false;
    // 半开：冷却期过后放行一次
    return Date.now() - this.openedAt < this.cooldownMs;
  }

  recordSuccess() {
    this.consecutiveFailures = 0;
  }

  recordFailure() {
    this.consecutiveFailures++;
    if (this.consecutiveFailures === this.threshold) this.openedAt = Date.now();
  }

  stats() {
    return { consecutiveFailures: this.consecutiveFailures, open: this.isOpen };
  }
}
