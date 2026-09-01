// Renders validated JSON chart blocks with ECharts. The model provides data,
// never executable JavaScript, and ECharts loads only when a chart appears.

import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { CustomRenderer, CustomRendererProps } from 'streamdown';
import { z } from 'zod';
import { PartStreamingContext } from './partStreaming';
import { usePanelI18n } from './i18n';

type EChartsCore = typeof import('echarts/core');
type EChartsInstance = ReturnType<EChartsCore['init']>;

// Keep validation in step with the chart modules registered below.
const chartSpecSchema = z.looseObject({
  series: z
    .array(z.looseObject({ type: z.enum(['bar', 'line', 'pie', 'scatter']) }))
    .min(1),
});

type ChartSpec = z.infer<typeof chartSpecSchema>;

type ParseResult =
  | { ok: true; option: ChartSpec }
  | { ok: false; error: string };

function containsExternalResource(value: unknown): boolean {
  if (typeof value === 'string') {
    return /^(?:image:|https?:)?\/\//i.test(value.trim());
  }
  if (Array.isArray(value)) return value.some(containsExternalResource);
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some(
      containsExternalResource,
    );
  }
  return false;
}

function parseChartSpec(code: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(code);
  } catch {
    return { ok: false, error: 'not valid JSON' };
  }
  // Chart options may contain image URLs even though the block is pure JSON.
  // Keep chart rendering local by rejecting every external resource reference.
  if (containsExternalResource(raw)) {
    return { ok: false, error: 'external resources are not allowed' };
  }
  const result = chartSpecSchema.safeParse(raw);
  if (!result.success) {
    return {
      ok: false,
      error:
        'must be a JSON object with a non-empty series array (bar / line / pie / scatter)',
    };
  }
  return { ok: true, option: result.data };
}

let echartsPromise: Promise<EChartsCore> | null = null;

// Load only the ECharts modules accepted by the schema.
const loadECharts = (): Promise<EChartsCore> =>
  (echartsPromise ??= Promise.all([
    import('echarts/core'),
    import('echarts/charts'),
    import('echarts/components'),
    import('echarts/renderers'),
  ]).then(([core, charts, components, renderers]) => {
    core.use([
      charts.BarChart,
      charts.LineChart,
      charts.PieChart,
      charts.ScatterChart,
      components.GridComponent,
      components.TooltipComponent,
      components.LegendComponent,
      components.TitleComponent,
      components.DatasetComponent,
      components.DataZoomComponent,
      components.MarkLineComponent,
      components.MarkPointComponent,
      renderers.CanvasRenderer,
    ]);
    return core;
  }));

const isDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;

function ChartBlock({ code, isIncomplete }: CustomRendererProps) {
  const { messages } = usePanelI18n();
  const hostRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  // Wait for streaming to end because the Markdown parser closes open fences.
  const streaming = useContext(PartStreamingContext);
  const parsed = useMemo<ParseResult | null>(
    () => (isIncomplete || streaming ? null : parseChartSpec(code)),
    [code, isIncomplete, streaming],
  );

  useEffect(() => {
    if (!parsed?.ok) return;
    let disposed = false;
    let chart: EChartsInstance | null = null;
    let observer: ResizeObserver | null = null;
    void loadECharts().then((echarts) => {
      if (disposed || !hostRef.current) return;
      chart = echarts.init(hostRef.current, isDark() ? 'dark' : undefined);
      chart.setOption({
        backgroundColor: 'transparent',
        textStyle: { fontFamily: 'inherit' },
        ...parsed.option,
      } as Parameters<EChartsInstance['setOption']>[0]);
      observer = new ResizeObserver(() => chart?.resize());
      observer.observe(hostRef.current);
      setReady(true);
    });
    return () => {
      disposed = true;
      observer?.disconnect();
      chart?.dispose();
    };
  }, [parsed]);

  if (isIncomplete || streaming || !parsed) {
    return (
      <pre className="chart-fallback">
        <code>{code}</code>
      </pre>
    );
  }
  if (!parsed.ok) {
    return (
      <div className="chart-invalid">
        <div className="chart-note">{messages.invalidChart(parsed.error)}</div>
        <pre className="chart-fallback">
          <code>{code}</code>
        </pre>
      </div>
    );
  }
  return (
    <div className="chart-block" data-streamdown="chart-block">
      {/* Keep the frame's height stable from the start so the log doesn't jump
          when the (lazy) ECharts chunk finishes loading. */}
      <div ref={hostRef} className="chart-canvas" aria-hidden={!ready} />
    </div>
  );
}

/** Streamdown renderer for fenced chart blocks. */
export const chartRenderer: CustomRenderer = {
  language: 'chart',
  component: ChartBlock,
};
