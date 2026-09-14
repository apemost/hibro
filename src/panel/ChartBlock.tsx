// Renders validated JSON chart blocks with Chart.js. The model provides data,
// never executable JavaScript, and Chart.js loads only when a chart appears.

import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ChartConfiguration, Point } from 'chart.js';
import type { CustomRenderer, CustomRendererProps } from 'streamdown';
import { z } from 'zod';
import { PartStreamingContext } from './partStreaming';
import { usePanelI18n } from './i18n';

const chartTypeSchema = z.enum(['bar', 'line', 'pie', 'scatter']);
const finiteNumberSchema = z.number().finite();
const scalarDatumSchema = z.union([finiteNumberSchema, z.null()]);
const pointDatumSchema = z.tuple([finiteNumberSchema, finiteNumberSchema]);
const datumSchema = z.union([scalarDatumSchema, pointDatumSchema]);

const datasetSchema = z
  .object({
    type: chartTypeSchema.optional(),
    label: z.string().trim().min(1).max(160).optional(),
    data: z.array(datumSchema).min(1),
  })
  .strict();

const chartSpecSchema = z
  .object({
    type: chartTypeSchema,
    labels: z.array(z.string()).min(1).optional(),
    datasets: z.array(datasetSchema).min(1),
    title: z.string().trim().min(1).max(160).optional(),
    showLegend: z.boolean().optional(),
    xTitle: z.string().trim().min(1).max(80).optional(),
    yTitle: z.string().trim().min(1).max(80).optional(),
    stacked: z.boolean().optional(),
  })
  .strict()
  .superRefine((spec, context) => {
    for (const [index, dataset] of spec.datasets.entries()) {
      const type = dataset.type ?? spec.type;
      if (
        type !== spec.type &&
        !(
          (type === 'bar' || type === 'line') &&
          (spec.type === 'bar' || spec.type === 'line')
        )
      ) {
        context.addIssue({
          code: 'custom',
          path: ['datasets', index, 'type'],
          message: 'only bar and line datasets may be mixed',
        });
      }

      if (type === 'scatter') {
        if (!dataset.data.every(Array.isArray)) {
          context.addIssue({
            code: 'custom',
            path: ['datasets', index, 'data'],
            message: 'scatter data must contain [x, y] pairs',
          });
        }
        continue;
      }

      if (!spec.labels || spec.labels.length !== dataset.data.length) {
        context.addIssue({
          code: 'custom',
          path: ['datasets', index, 'data'],
          message: 'labels and scalar data must have the same length',
        });
      }
      if (!dataset.data.every((datum) => !Array.isArray(datum))) {
        context.addIssue({
          code: 'custom',
          path: ['datasets', index, 'data'],
          message: 'bar, line, and pie data must contain numbers or null',
        });
      }
    }
  });

type SupportedChartType = z.infer<typeof chartTypeSchema>;
type ChartSpec = z.infer<typeof chartSpecSchema>;
type ChartJsDatum = number | Point | null;
type ChartJsConfiguration = ChartConfiguration<
  SupportedChartType,
  ChartJsDatum[],
  string
>;
type ChartJsRuntime = typeof import('./chartJsRuntime');
type ChartJsInstance = InstanceType<ChartJsRuntime['Chart']>;
type ChartTheme = 'light' | 'dark';

type ParseResult = { ok: true; spec: ChartSpec } | { ok: false; error: string };

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

function parseHibroChartSpec(code: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(code);
  } catch {
    return { ok: false, error: 'not valid JSON' };
  }
  // Keep chart rendering local even if a future Chart.js option accepts URLs.
  if (containsExternalResource(raw)) {
    return { ok: false, error: 'external resources are not allowed' };
  }

  const current = chartSpecSchema.safeParse(raw);
  if (current.success) {
    return { ok: true, spec: current.data };
  }
  return {
    ok: false,
    error:
      'must be a supported chart with a type and non-empty datasets array (bar / line / pie / scatter)',
  };
}

let chartJsPromise: Promise<ChartJsRuntime> | null = null;

const loadChartJs = (): Promise<ChartJsRuntime> =>
  (chartJsPromise ??= import('./chartJsRuntime'));

const chartPalette = [
  { border: '#2563eb', fill: 'rgba(37, 99, 235, 0.45)' },
  { border: '#0d9488', fill: 'rgba(13, 148, 136, 0.45)' },
  { border: '#d97706', fill: 'rgba(217, 119, 6, 0.45)' },
  { border: '#dc2626', fill: 'rgba(220, 38, 38, 0.45)' },
  { border: '#7c3aed', fill: 'rgba(124, 58, 237, 0.45)' },
  { border: '#0891b2', fill: 'rgba(8, 145, 178, 0.45)' },
];

function chartOptions(
  spec: ChartSpec,
  theme: ChartTheme,
): NonNullable<ChartJsConfiguration['options']> {
  const textColor = theme === 'dark' ? '#e5e7eb' : '#374151';
  const gridColor =
    theme === 'dark' ? 'rgba(148, 163, 184, 0.2)' : 'rgba(100, 116, 139, 0.18)';
  const cartesian = spec.type !== 'pie';

  return {
    responsive: true,
    maintainAspectRatio: false,
    color: textColor,
    scales: cartesian
      ? {
          x: {
            stacked: spec.stacked,
            grid: { color: gridColor },
            ticks: { color: textColor },
            title: {
              color: textColor,
              display: Boolean(spec.xTitle),
              text: spec.xTitle,
            },
          },
          y: {
            stacked: spec.stacked,
            grid: { color: gridColor },
            ticks: { color: textColor },
            title: {
              color: textColor,
              display: Boolean(spec.yTitle),
              text: spec.yTitle,
            },
          },
        }
      : undefined,
    plugins: {
      legend: {
        display: spec.showLegend ?? true,
        labels: { color: textColor },
      },
      title: {
        color: textColor,
        display: Boolean(spec.title),
        text: spec.title,
      },
    },
  };
}

function toChartJsConfiguration(
  spec: ChartSpec,
  theme: ChartTheme,
): ChartJsConfiguration {
  const datasets: ChartJsConfiguration['data']['datasets'] = spec.datasets.map(
    (dataset, index) => {
      const type = dataset.type ?? spec.type;
      const color = chartPalette[index % chartPalette.length];
      const data: ChartJsDatum[] = dataset.data.map((datum) =>
        Array.isArray(datum) ? { x: datum[0], y: datum[1] } : datum,
      );
      const pieColors = dataset.data.map(
        (_, dataIndex) => chartPalette[dataIndex % chartPalette.length].fill,
      );
      const pieBorders = dataset.data.map(
        (_, dataIndex) => chartPalette[dataIndex % chartPalette.length].border,
      );
      return {
        type,
        label: dataset.label,
        data,
        borderColor: type === 'pie' ? pieBorders : color.border,
        backgroundColor: type === 'pie' ? pieColors : color.fill,
        borderWidth: type === 'line' ? 2 : 1,
      } as ChartJsConfiguration['data']['datasets'][number];
    },
  );

  return {
    type: spec.type,
    data: {
      labels: spec.labels,
      datasets,
    },
    options: chartOptions(spec, theme),
  };
}

function ChartBlock({ code, isIncomplete }: CustomRendererProps) {
  const { messages } = usePanelI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [renderedTheme, setRenderedTheme] = useState<ChartTheme | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  // Wait for streaming to end because the Markdown parser closes open fences.
  const streaming = useContext(PartStreamingContext);
  const parsed = useMemo<ParseResult | null>(
    () => (isIncomplete || streaming ? null : parseHibroChartSpec(code)),
    [code, isIncomplete, streaming],
  );

  useEffect(() => {
    if (!parsed?.ok) return;
    let disposed = false;
    let chart: ChartJsInstance | null = null;
    const colorScheme = window.matchMedia('(prefers-color-scheme: dark)');
    const currentTheme = (): ChartTheme =>
      colorScheme.matches ? 'dark' : 'light';
    const handleThemeChange = () => {
      if (!chart || disposed) return;
      const theme = currentTheme();
      chart.options = chartOptions(parsed.spec, theme);
      chart.update('none');
      setRenderedTheme(theme);
    };
    setReady(false);
    setRenderedTheme(null);
    setRenderError(null);
    colorScheme.addEventListener('change', handleThemeChange);
    void loadChartJs()
      .then((chartJs) => {
        if (disposed || !canvasRef.current) return;
        const theme = currentTheme();
        chart = new chartJs.Chart(
          canvasRef.current,
          toChartJsConfiguration(parsed.spec, theme),
        );
        setRenderedTheme(theme);
        setReady(true);
      })
      .catch(() => {
        if (!disposed) setRenderError('renderer failed to initialize');
      });
    return () => {
      disposed = true;
      colorScheme.removeEventListener('change', handleThemeChange);
      chart?.destroy();
    };
  }, [parsed]);

  if (isIncomplete || streaming || !parsed) {
    return (
      <pre className="chart-fallback">
        <code>{code}</code>
      </pre>
    );
  }
  if (!parsed.ok || renderError) {
    const error = renderError ?? (parsed.ok ? '' : parsed.error);
    return (
      <div className="chart-invalid">
        <div className="chart-note">{messages.invalidChart(error)}</div>
        <pre className="chart-fallback">
          <code>{code}</code>
        </pre>
      </div>
    );
  }
  return (
    <div
      className="chart-block"
      data-streamdown="chart-block"
      data-chart-ready={ready}
      data-chart-theme={renderedTheme ?? undefined}
    >
      {/* Keep the frame's height stable while the lazy Chart.js chunk loads. */}
      <div className="chart-canvas">
        <canvas ref={canvasRef} aria-hidden={!ready} />
      </div>
    </div>
  );
}

/** Streamdown renderer for fenced chart blocks. */
export const chartRenderer: CustomRenderer = {
  language: 'chart',
  component: ChartBlock,
};
