<script setup lang="ts">
import { computed, ref } from 'vue';

import { Card, InputNumber, Select, Switch } from 'ant-design-vue';

import { TimeProgress } from '#/components/TimeProgress';

// ============================================================
// 全局可调参数 (顶部控制台)
// ============================================================
const days = ref(5);
const fillDirection = ref<'ltr' | 'rtl'>('ltr');
const mode = ref<'elapsed' | 'remaining'>('remaining');
const refreshInterval = ref(1000);
const variant = ref<'decorative' | 'flat' | 'glossy'>('flat');
const striped = ref(true);

// 各类预制场景的时间端点
const now = Date.now();
const start = computed(() => now);
const end = computed(() => now + days.value * 24 * 60 * 60 * 1000);

// 已过期场景: 结束时间在 5 秒前
const expiredEnd = now - 5000;
// 未开始场景: 开始时间在 1 小时后
const futureStart = now + 60 * 60 * 1000;
const futureEnd = futureStart + 5 * 24 * 60 * 60 * 1000;
// 50% 进度场景: 开始 5 天前, 结束 5 天后
const halfStart = now - 5 * 24 * 60 * 60 * 1000;
const halfEnd = now + 5 * 24 * 60 * 60 * 1000;
</script>

<template>
  <div class="demo-page">
    <header class="demo-header">
      <h1>TimeProgress 组件演示</h1>
      <p class="demo-sub">
        参数化时间进度条 — 区间 / 无限模式, 三种状态, 双方向, 多种文字位置
      </p>
    </header>

    <!-- 全局参数控制台 -->
    <Card title="全局参数 (影响下方区间模式演示)" size="small" class="demo-control">
      <div class="demo-controls">
        <div class="demo-ctrl">
          <span class="demo-ctrl-label">天数</span>
          <InputNumber v-model:value="days" :min="0" :max="3650" />
        </div>
        <div class="demo-ctrl">
          <span class="demo-ctrl-label">填充方向</span>
          <Select
            v-model:value="fillDirection"
            style="width: 120px"
            :options="[
              { label: 'ltr 从左到右', value: 'ltr' },
              { label: 'rtl 从右到左', value: 'rtl' },
            ]"
          />
        </div>
        <div class="demo-ctrl">
          <span class="demo-ctrl-label">数值方向</span>
          <Select
            v-model:value="mode"
            style="width: 160px"
            :options="[
              { label: 'elapsed 已耗 0→100%', value: 'elapsed' },
              { label: 'remaining 剩余 100→0%', value: 'remaining' },
            ]"
          />
        </div>
        <div class="demo-ctrl">
          <span class="demo-ctrl-label">刷新间隔 ms</span>
          <InputNumber v-model:value="refreshInterval" :min="100" :step="100" />
        </div>
        <div class="demo-ctrl">
          <span class="demo-ctrl-label">视觉风格</span>
          <Select
            v-model:value="variant"
            style="width: 160px"
            :options="[
              { label: 'flat 极简平面', value: 'flat' },
              { label: 'glossy 顶部高光', value: 'glossy' },
              { label: 'decorative 立体装饰', value: 'decorative' },
            ]"
          />
        </div>
        <div class="demo-ctrl">
          <span class="demo-ctrl-label">斜条纹</span>
          <Switch v-model:checked="striped" />
        </div>
      </div>
    </Card>

    <!-- 演示卡片网格 -->
    <div class="demo-grid">
      <!-- 1. 默认: 区间 + 下方"剩余" -->
      <Card title="① 默认: 区间 + 下方剩余" size="small">
        <TimeProgress
          :start-time="start"
          :end-time="end"
          :fill-direction="fillDirection"
          :mode="mode"
          :refresh-interval="refreshInterval"
          :variant="variant"
          :striped="striped"
        />
        <pre class="demo-code">{{
          `<TimeProgress
  :start-time="start"
  :end-time="end"
  mode="remaining" />`
        }}</pre>
      </Card>

      <!-- 2. 下方双行 (剩余 + 到期) -->
      <Card title="② 下方剩余 + 到期" size="small">
        <TimeProgress
          :start-time="start"
          :end-time="end"
          :fill-direction="fillDirection"
          :mode="mode"
          :refresh-interval="refreshInterval"
          :variant="variant"
          :striped="striped"
          show-expires
        />
        <pre class="demo-code">show-remaining show-expires</pre>
      </Card>

      <!-- 3. large + 中心倒计时 -->
      <Card title="③ large + 中心倒计时" size="small">
        <TimeProgress
          :start-time="start"
          :end-time="end"
          :fill-direction="fillDirection"
          :mode="mode"
          :refresh-interval="refreshInterval"
          :variant="variant"
          :striped="striped"
          size="large"
          center-text="remaining"
          :show-remaining="false"
          show-expires
        />
        <pre class="demo-code">size="large" center-text="remaining"</pre>
      </Card>

      <!-- 4. 中心显示百分比 -->
      <Card title="④ 中心显示百分比" size="small">
        <TimeProgress
          :start-time="start"
          :end-time="end"
          :fill-direction="fillDirection"
          :mode="mode"
          :refresh-interval="refreshInterval"
          :variant="variant"
          :striped="striped"
          size="large"
          center-text="percent"
          :show-remaining="false"
        />
        <pre class="demo-code">center-text="percent"</pre>
      </Card>

      <!-- 5. small 紧凑 -->
      <Card title="⑤ small 紧凑模式" size="small">
        <TimeProgress
          :start-time="start"
          :end-time="end"
          :fill-direction="fillDirection"
          :mode="mode"
          :refresh-interval="refreshInterval"
          :variant="variant"
          :striped="striped"
          size="small"
          :show-remaining="false"
        />
        <pre class="demo-code">size="small" 不显示文字</pre>
      </Card>

      <!-- 6. 已过期: 红色闪烁 -->
      <Card title="⑥ 已过期 (红色闪烁)" size="small">
        <TimeProgress
          :start-time="start"
          :end-time="expiredEnd"
          mode="remaining"
          size="large"
          center-text="remaining"
          :show-remaining="false"
          show-expires
        />
        <pre class="demo-code">end-time 已过去 → 红色闪烁 + "已过期"</pre>
      </Card>

      <!-- 7. 未开始 -->
      <Card title="⑦ 未开始" size="small">
        <TimeProgress
          :start-time="futureStart"
          :end-time="futureEnd"
          mode="remaining"
          size="large"
          center-text="remaining"
          :show-remaining="false"
          show-expires
        />
        <pre class="demo-code">start-time 在未来 → 灰色 + "未开始"</pre>
      </Card>

      <!-- 8. 无限模式 (indeterminate 往复) -->
      <Card title="⑧ 无限模式 (indeterminate)" size="small">
        <TimeProgress
          :show-remaining="true"
          :show-expires="false"
        />
        <pre class="demo-code">不传 end-time → 一段亮条往复运动</pre>
      </Card>

      <!-- 9. 反向填充 + 已耗模式 -->
      <Card title="⑨ rtl + elapsed 组合" size="small">
        <TimeProgress
          :start-time="start"
          :end-time="end"
          fill-direction="rtl"
          mode="elapsed"
          :refresh-interval="refreshInterval"
          :variant="variant"
          :striped="striped"
          size="large"
          center-text="percent"
          :show-remaining="false"
        />
        <pre class="demo-code">fill-direction="rtl" mode="elapsed"</pre>
      </Card>

      <!-- 10. slot 自定义中心 -->
      <Card title="⑩ slot 自定义中心" size="small">
        <TimeProgress
          :start-time="start"
          :end-time="end"
          mode="remaining"
          size="large"
          :show-remaining="false"
        >
          <template #center>
            <span style="font-weight: 700; letter-spacing: 1px;">
              授权倒计时 ⏱
            </span>
          </template>
        </TimeProgress>
        <pre class="demo-code">slots.center 完全自定义中心内容</pre>
      </Card>

      <!-- 11. slot 自定义下方 -->
      <Card title="⑪ slot 自定义下方" size="small">
        <TimeProgress
          :start-time="start"
          :end-time="end"
          mode="remaining"
        >
          <template #sub>
            <span>📢 续费窗口已开放</span>
            <a href="#" style="font-size: 12px;">立即续费 →</a>
          </template>
        </TimeProgress>
        <pre class="demo-code">slots.sub 替换下方一行</pre>
      </Card>

      <!-- 12. 极简: 只有进度条 -->
      <Card title="⑫ 极简: 仅进度条" size="small">
        <TimeProgress
          :start-time="start"
          :end-time="end"
          mode="remaining"
          :show-remaining="false"
          :show-expires="false"
        />
        <pre class="demo-code">不显示任何文字, 只有进度条</pre>
      </Card>

      <!-- 13. 进度 50% (remaining mode) -->
      <Card title="⑬ 进度 50% (remaining 剩余感)" size="small">
        <TimeProgress
          :start-time="halfStart"
          :end-time="halfEnd"
          mode="remaining"
          size="large"
          center-text="percent"
          :show-remaining="true"
          show-expires
        />
        <pre class="demo-code">已过 5 天 / 共 10 天 → 剩余 50%, 条填一半</pre>
      </Card>

      <!-- 14. 进度 50% (elapsed mode) -->
      <Card title="⑭ 进度 50% (elapsed 已耗感)" size="small">
        <TimeProgress
          :start-time="halfStart"
          :end-time="halfEnd"
          mode="elapsed"
          size="large"
          center-text="percent"
          :show-remaining="true"
          show-expires
        />
        <pre class="demo-code">同样区间, mode=elapsed → 已耗 50%, 条从左填到一半</pre>
      </Card>

      <!-- 15. 进度 50% rtl + elapsed -->
      <Card title="⑮ 进度 50% rtl 反向填充" size="small">
        <TimeProgress
          :start-time="halfStart"
          :end-time="halfEnd"
          fill-direction="rtl"
          mode="elapsed"
          size="large"
          center-text="percent"
          :show-remaining="true"
        />
        <pre class="demo-code">rtl + elapsed: 从右往左填到一半</pre>
      </Card>

      <!-- 16. 风格对比: flat -->
      <Card title="⑯ variant=flat 极简平面" size="small">
        <TimeProgress
          :start-time="halfStart"
          :end-time="halfEnd"
          mode="elapsed"
          variant="flat"
          size="large"
          center-text="percent"
          :show-remaining="false"
        />
        <pre class="demo-code">默认风格, 适合后台管理 (与本页顶部参数无关)</pre>
      </Card>

      <!-- 17. 风格对比: glossy -->
      <Card title="⑰ variant=glossy 顶部高光" size="small">
        <TimeProgress
          :start-time="halfStart"
          :end-time="halfEnd"
          mode="elapsed"
          variant="glossy"
          size="large"
          center-text="percent"
          :show-remaining="false"
        />
        <pre class="demo-code">温和升级, 加顶部白色渐变高光</pre>
      </Card>

      <!-- 18. 风格对比: decorative -->
      <Card title="⑱ variant=decorative 立体装饰" size="small">
        <TimeProgress
          :start-time="halfStart"
          :end-time="halfEnd"
          mode="elapsed"
          variant="decorative"
          size="large"
          center-text="percent"
          :show-remaining="false"
        />
        <pre class="demo-code">描边胶囊 + 强光泽 + 发光</pre>
      </Card>

      <!-- 19. 风格对比: 无条纹纯色 -->
      <Card title="⑲ glossy 无条纹纯色" size="small">
        <TimeProgress
          :start-time="halfStart"
          :end-time="halfEnd"
          mode="elapsed"
          variant="glossy"
          :striped="false"
          size="large"
          center-text="percent"
          :show-remaining="false"
        />
        <pre class="demo-code">striped=false 关闭条纹动画, 仅高光</pre>
      </Card>

      <!-- 20. 风格对比: decorative 无条纹 -->
      <Card title="⑳ decorative 无条纹" size="small">
        <TimeProgress
          :start-time="halfStart"
          :end-time="halfEnd"
          mode="elapsed"
          variant="decorative"
          :striped="false"
          size="large"
          center-text="percent"
          :show-remaining="false"
        />
        <pre class="demo-code">装饰风 + 关闭条纹, 干净光泽款</pre>
      </Card>
    </div>
  </div>
</template>

<style scoped>
.demo-page {
  max-width: 1200px;
  margin: 0 auto;
  padding: 24px;
  background: hsl(var(--background));
  min-height: 100vh;
}

.demo-header h1 {
  margin: 0 0 6px;
  font-size: 22px;
  font-weight: 600;
  color: hsl(var(--foreground));
}

.demo-sub {
  margin: 0 0 20px;
  color: hsl(var(--muted-foreground));
  font-size: 13px;
}

.demo-control {
  margin-bottom: 24px;
}

.demo-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 16px 24px;
}

.demo-ctrl {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.demo-ctrl-label {
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}

.demo-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

@media (max-width: 768px) {
  .demo-grid {
    grid-template-columns: 1fr;
  }
}

.demo-code {
  margin: 12px 0 0;
  padding: 8px 10px;
  background: hsl(var(--muted));
  border-radius: 4px;
  font-size: 11px;
  color: hsl(var(--muted-foreground));
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
