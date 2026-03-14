import { createRenderer } from "@json-render/react";
import yaml from "js-yaml";
import type { CSSProperties, ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { buildCatalogPrompt, catalog, componentAllowsChildren, componentDefinitions, type ComponentName, validateComponentPayload } from "./catalog";

type PrimitiveValue = string | number | boolean | null;

type JsonRenderSpec = {
  root: string;
  elements: Record<string, {
    type: string;
    props: Record<string, unknown>;
    children?: string[];
  }>;
};

export interface NormalizedNode {
  type: ComponentName;
  props: Record<string, unknown>;
  children: NormalizedNode[];
}

export interface PreparedSpec {
  spec: JsonRenderSpec | null;
  error: string | null;
  nodes: NormalizedNode[];
  yaml: string;
}

export const DEFAULT_WIDGET_SPEC = `- Section:
    title: "Caregiver Snapshot"
    subtitle: "Daily staffing and service delivery pulse"
    children:
      - Grid:
          columns: 3
          children:
            - Metric:
                label: "Hours staffed"
                value: 42
                format: number
                delta: "+6%"
            - Metric:
                label: "Visits completed"
                value: 87
                format: number
                delta: "+11%"
            - Metric:
                label: "Escalations"
                value: 2
                format: number
                delta: "-1"
      - Grid:
          columns: 2
          children:
            - LineChart:
                title: "Weekly completion trend"
                data:
                  - { label: "Mon", value: 68 }
                  - { label: "Tue", value: 71 }
                  - { label: "Wed", value: 73 }
                  - { label: "Thu", value: 78 }
                  - { label: "Fri", value: 82 }
            - Card:
                title: "Notes"
                children:
                  - Badge:
                      label: "On track"
                      variant: success
                  - Text:
                      content: "Coverage remains healthy across the morning and evening shifts."
                      size: base
                      weight: regular
      - Table:
          columns: ["Caregiver", "Status", "Region"]
          rows:
            - { Caregiver: "Taylor Reed", Status: "Active", Region: "North" }
            - { Caregiver: "Jordan Kim", Status: "Float", Region: "West" }
            - { Caregiver: "Riley Morgan", Status: "Escalated", Region: "East" }`;

export const catalogPrompt = buildCatalogPrompt();

const JsonRenderWidget = createRenderer(catalog, {
  Card: ({ element, children }) => (
    <article className="jr-card">
      {element.props.title ? <h3 className="jr-card-title">{String(element.props.title)}</h3> : null}
      <div className="jr-stack">{children}</div>
    </article>
  ),
  Metric: ({ element }) => (
    <article className="jr-card jr-metric">
      <span className="jr-eyebrow">{String(element.props.label)}</span>
      <strong className="jr-metric-value">{formatMetricValue(element.props.value, element.props.format)}</strong>
      {element.props.delta !== undefined ? <span className={`jr-delta ${deltaClass(element.props.delta)}`}>{formatDelta(element.props.delta)}</span> : null}
    </article>
  ),
  BarChart: ({ element }) => <BarChart {...coerceChartProps(element.props)} />,
  LineChart: ({ element }) => <LineChart {...coerceChartProps(element.props)} />,
  Table: ({ element }) => <DataTable columns={coerceColumns(element.props.columns)} rows={coerceRows(element.props.rows)} />,
  Text: ({ element }) => (
    <p className="jr-text" data-size={String(element.props.size ?? "base")} data-weight={String(element.props.weight ?? "regular")}>
      {String(element.props.content)}
    </p>
  ),
  Badge: ({ element }) => (
    <span className="jr-badge" data-variant={String(element.props.variant ?? "neutral")}>
      {String(element.props.label)}
    </span>
  ),
  Progress: ({ element }) => (
    <article className="jr-card jr-progress-card">
      {element.props.label ? (
        <div className="jr-progress-header">
          <span className="jr-eyebrow">{String(element.props.label)}</span>
          <span className="jr-progress-value">{Math.round(Number(element.props.value))}%</span>
        </div>
      ) : null}
      <div className="jr-progress-track">
        <div
          className="jr-progress-fill"
          style={{
            width: `${Math.max(0, Math.min(100, Number(element.props.value)))}%`,
            background: element.props.color ? String(element.props.color) : undefined,
          }}
        />
      </div>
    </article>
  ),
  Grid: ({ element, children }) => (
    <section
      className="jr-grid"
      style={{ "--grid-columns": String(element.props.columns) } as CSSProperties}
    >
      {children}
    </section>
  ),
  Section: ({ element, children }) => (
    <section className="jr-section">
      {element.props.title || element.props.subtitle ? (
        <header className="jr-section-header">
          {element.props.title ? <h2 className="jr-section-title">{String(element.props.title)}</h2> : null}
          {element.props.subtitle ? <p className="jr-section-subtitle">{String(element.props.subtitle)}</p> : null}
        </header>
      ) : null}
      <div className="jr-stack">{children}</div>
    </section>
  ),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function coerceColumns(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function coerceRows(value: unknown): Array<Record<string, PrimitiveValue>> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isRecord) as Array<Record<string, PrimitiveValue>>;
}

function coerceChartProps(props: Record<string, unknown>): {
  title?: string;
  color?: string;
  data: Array<{ label: string; value: number }>;
} {
  return {
    title: props.title ? String(props.title) : undefined,
    color: props.color ? String(props.color) : undefined,
    data: Array.isArray(props.data)
      ? props.data
          .filter(isRecord)
          .map((item) => ({ label: String(item.label), value: Number(item.value) }))
      : [],
  };
}

function formatMetricValue(value: unknown, format: unknown): string {
  const numeric = Number(value);
  const formatName = String(format ?? "string");
  if (!Number.isNaN(numeric)) {
    if (formatName === "currency") {
      return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(numeric);
    }
    if (formatName === "percent") {
      return `${numeric}%`;
    }
    if (formatName === "number") {
      return new Intl.NumberFormat("en-US").format(numeric);
    }
  }
  return String(value ?? "");
}

function deltaClass(value: unknown): string {
  const text = String(value ?? "");
  if (text.startsWith("-")) {
    return "is-negative";
  }
  if (text.startsWith("+")) {
    return "is-positive";
  }
  const numeric = Number(text);
  if (Number.isNaN(numeric)) {
    return "is-neutral";
  }
  if (numeric < 0) {
    return "is-negative";
  }
  if (numeric > 0) {
    return "is-positive";
  }
  return "is-neutral";
}

function formatDelta(value: unknown): string {
  const text = String(value ?? "");
  if (text.startsWith("+") || text.startsWith("-")) {
    return text;
  }
  const numeric = Number(text);
  if (Number.isNaN(numeric)) {
    return text;
  }
  return `${numeric > 0 ? "+" : ""}${numeric}`;
}

function normalizeNode(value: unknown, path: string): NormalizedNode {
  if (!isRecord(value)) {
    throw new Error(`${path} must be a YAML mapping`);
  }

  const entries = Object.entries(value);
  if (entries.length !== 1) {
    throw new Error(`${path} must contain exactly one component name`);
  }

  const [typeName, payload] = entries[0];
  if (!(typeName in componentDefinitions)) {
    throw new Error(`${path} references unknown component "${typeName}"`);
  }

  const type = typeName as ComponentName;
  const rawPayload = payload ?? {};
  const props = validateComponentPayload(type, rawPayload, path);
  const childValue = isRecord(rawPayload) ? rawPayload.children : undefined;

  if (childValue !== undefined && !componentAllowsChildren(type)) {
    throw new Error(`${path}.${type}.children is not allowed`);
  }

  const children = childValue === undefined
    ? []
    : normalizeNodes(childValue, `${path}.${type}.children`);

  return { type, props, children };
}

function normalizeNodes(value: unknown, path: string): NormalizedNode[] {
  if (!Array.isArray(value)) {
    throw new Error(`${path} must be an array of components`);
  }
  return value.map((item, index) => normalizeNode(item, `${path}[${index}]`));
}

function parseYamlDocument(rawSpec?: string | null): unknown {
  const source = rawSpec && rawSpec.trim() ? rawSpec : DEFAULT_WIDGET_SPEC;
  return yaml.load(source);
}

function buildJsonRenderSpec(nodes: NormalizedNode[]): JsonRenderSpec | null {
  if (nodes.length === 0) {
    return null;
  }

  const elements: JsonRenderSpec["elements"] = {};
  let sequence = 0;
  const rootNode = nodes.length === 1
    ? nodes[0]
    : { type: "Section" as const, props: {}, children: nodes };

  const register = (node: NormalizedNode): string => {
    sequence += 1;
    const key = `${node.type.toLowerCase()}-${sequence}`;
    const children = node.children.map(register);
    elements[key] = {
      type: node.type,
      props: node.props,
      children,
    };
    return key;
  };

  return {
    root: register(rootNode),
    elements,
  };
}

function RenderError({ message, yamlSource }: { message: string; yamlSource: string }): ReactNode {
  return (
    <div className="jr-error">
      <strong>Invalid widget spec</strong>
      <p>{message}</p>
      <pre>{yamlSource}</pre>
    </div>
  );
}

function BarChart({ title, data, color }: { title?: string; data: Array<{ label: string; value: number }>; color?: string }): ReactNode {
  const max = Math.max(...data.map((item) => item.value), 1);
  return (
    <article className="jr-card jr-chart">
      {title ? <h3 className="jr-card-title">{title}</h3> : null}
      <div className="jr-bar-chart">
        {data.map((item) => (
          <div className="jr-bar-group" key={item.label}>
            <div className="jr-bar-track">
              <div
                className="jr-bar"
                style={{
                  height: `${(item.value / max) * 100}%`,
                  background: color,
                }}
              />
            </div>
            <span className="jr-chart-label">{item.label}</span>
          </div>
        ))}
      </div>
    </article>
  );
}

function LineChart({ title, data, color }: { title?: string; data: Array<{ label: string; value: number }>; color?: string }): ReactNode {
  const width = 340;
  const height = 150;
  const padding = 18;
  const max = Math.max(...data.map((item) => item.value), 1);
  const min = Math.min(...data.map((item) => item.value), 0);
  const spread = Math.max(max - min, 1);
  const points = data.map((item, index) => {
    const x = padding + (index / Math.max(data.length - 1, 1)) * (width - padding * 2);
    const y = height - padding - ((item.value - min) / spread) * (height - padding * 2);
    return `${x},${y}`;
  }).join(" ");

  return (
    <article className="jr-card jr-chart">
      {title ? <h3 className="jr-card-title">{title}</h3> : null}
      <svg className="jr-line-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title ?? "Line chart"}>
        <polyline className="jr-line-grid" points={`${padding},${height - padding} ${width - padding},${height - padding}`} />
        <polyline
          className="jr-line-path"
          points={points}
          style={{ stroke: color ?? undefined }}
        />
        {data.map((item, index) => {
          const x = padding + (index / Math.max(data.length - 1, 1)) * (width - padding * 2);
          const y = height - padding - ((item.value - min) / spread) * (height - padding * 2);
          return <circle className="jr-line-dot" key={item.label} cx={x} cy={y} r="4" style={{ fill: color ?? undefined }} />;
        })}
      </svg>
      <div className="jr-line-labels">
        {data.map((item) => <span key={item.label}>{item.label}</span>)}
      </div>
    </article>
  );
}

function DataTable({ columns, rows }: { columns: string[]; rows: Array<Record<string, PrimitiveValue>> }): ReactNode {
  return (
    <article className="jr-card jr-table-card">
      <div className="jr-table-wrap">
        <table className="jr-table">
          <thead>
            <tr>
              {columns.map((column) => <th key={column}>{column}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                {columns.map((column) => <td key={column}>{String(row[column] ?? "—")}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}

export function prepareWidgetSpec(rawSpec?: string | null): PreparedSpec {
  const yamlSource = rawSpec && rawSpec.trim() ? rawSpec : DEFAULT_WIDGET_SPEC;

  try {
    const document = parseYamlDocument(rawSpec);
    const nodes = normalizeNodes(document, "spec");
    return {
      spec: buildJsonRenderSpec(nodes),
      error: null,
      nodes,
      yaml: yamlSource,
    };
  } catch (error) {
    return {
      spec: null,
      error: error instanceof Error ? error.message : "Unknown spec error",
      nodes: [],
      yaml: yamlSource,
    };
  }
}

export function WidgetSurface({ specString }: { specString?: string | null }): ReactNode {
  const prepared = prepareWidgetSpec(specString);
  if (prepared.error || !prepared.spec) {
    return <>{RenderError({ message: prepared.error ?? "Spec missing", yamlSource: prepared.yaml })}</>;
  }
  return <JsonRenderWidget spec={prepared.spec} />;
}

export function renderSpecToHtml(specString?: string | null): string {
  return renderToString(<WidgetSurface specString={specString} />);
}
