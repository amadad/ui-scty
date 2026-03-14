import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { z } from "zod";

const primitiveValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const chartPointSchema = z.object({
  label: z.string().min(1),
  value: z.number(),
});

const cardProps = z.object({
  title: z.string().min(1).optional(),
}).strict();

const metricProps = z.object({
  label: z.string().min(1),
  value: z.union([z.string(), z.number()]),
  format: z.enum(["string", "number", "percent", "currency"]).optional(),
  delta: z.union([z.string(), z.number()]).optional(),
}).strict();

const chartProps = z.object({
  title: z.string().min(1).optional(),
  data: z.array(chartPointSchema).min(1),
  color: z.string().min(1).optional(),
}).strict();

const tableProps = z.object({
  columns: z.array(z.string().min(1)).min(1),
  rows: z.array(z.record(z.string(), primitiveValueSchema)).min(1),
}).strict();

const textProps = z.object({
  content: z.string(),
  size: z.enum(["xs", "sm", "base", "lg", "xl"]).optional(),
  weight: z.enum(["regular", "medium", "semibold", "bold"]).optional(),
}).strict();

const badgeProps = z.object({
  label: z.string().min(1),
  variant: z.enum(["neutral", "accent", "success", "warning"]).optional(),
}).strict();

const progressProps = z.object({
  label: z.string().min(1).optional(),
  value: z.number().min(0).max(100),
  color: z.string().min(1).optional(),
}).strict();

const gridProps = z.object({
  columns: z.number().int().min(1).max(4),
}).strict();

const sectionProps = z.object({
  title: z.string().min(1).optional(),
  subtitle: z.string().min(1).optional(),
}).strict();

type Definition = {
  description: string;
  props: z.ZodObject<any>;
  allowsChildren: boolean;
  promptShape: string;
};

export const componentDefinitions = {
  Card: {
    description: "A card container with an optional title and nested child components.",
    props: cardProps,
    allowsChildren: true,
    promptShape: "{ title?: string, children?: Component[] }",
  },
  Metric: {
    description: "A KPI block showing a label, value, optional format, and optional delta.",
    props: metricProps,
    allowsChildren: false,
    promptShape: "{ label: string, value: string | number, format?: string, delta?: string | number }",
  },
  BarChart: {
    description: "A compact bar chart with labeled numeric data points.",
    props: chartProps,
    allowsChildren: false,
    promptShape: "{ title?: string, data: [{ label: string, value: number }], color?: string }",
  },
  LineChart: {
    description: "A compact line chart with labeled numeric data points.",
    props: chartProps,
    allowsChildren: false,
    promptShape: "{ title?: string, data: [{ label: string, value: number }], color?: string }",
  },
  Table: {
    description: "A table with named columns and object rows keyed by those column labels.",
    props: tableProps,
    allowsChildren: false,
    promptShape: "{ columns: string[], rows: [{ [columnLabel: string]: string | number | boolean | null }] }",
  },
  Text: {
    description: "Body copy or supporting text with optional size and weight variants.",
    props: textProps,
    allowsChildren: false,
    promptShape: "{ content: string, size?: xs | sm | base | lg | xl, weight?: regular | medium | semibold | bold }",
  },
  Badge: {
    description: "A compact status badge.",
    props: badgeProps,
    allowsChildren: false,
    promptShape: "{ label: string, variant?: neutral | accent | success | warning }",
  },
  Progress: {
    description: "A labeled progress bar showing a value between 0 and 100.",
    props: progressProps,
    allowsChildren: false,
    promptShape: "{ label?: string, value: number, color?: string }",
  },
  Grid: {
    description: "A multi-column layout container for child components.",
    props: gridProps,
    allowsChildren: true,
    promptShape: "{ columns: number, children?: Component[] }",
  },
  Section: {
    description: "A section wrapper with optional title, subtitle, and child components.",
    props: sectionProps,
    allowsChildren: true,
    promptShape: "{ title?: string, subtitle?: string, children?: Component[] }",
  },
} as const satisfies Record<string, Definition>;

export type ComponentName = keyof typeof componentDefinitions;

export const catalog = defineCatalog(schema, {
  components: {
    Card: { description: componentDefinitions.Card.description, props: componentDefinitions.Card.props },
    Metric: { description: componentDefinitions.Metric.description, props: componentDefinitions.Metric.props },
    BarChart: { description: componentDefinitions.BarChart.description, props: componentDefinitions.BarChart.props },
    LineChart: { description: componentDefinitions.LineChart.description, props: componentDefinitions.LineChart.props },
    Table: { description: componentDefinitions.Table.description, props: componentDefinitions.Table.props },
    Text: { description: componentDefinitions.Text.description, props: componentDefinitions.Text.props },
    Badge: { description: componentDefinitions.Badge.description, props: componentDefinitions.Badge.props },
    Progress: { description: componentDefinitions.Progress.description, props: componentDefinitions.Progress.props },
    Grid: { description: componentDefinitions.Grid.description, props: componentDefinitions.Grid.props },
    Section: { description: componentDefinitions.Section.description, props: componentDefinitions.Section.props },
  },
  actions: {},
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateComponentPayload(type: ComponentName, payload: unknown, path: string): Record<string, unknown> {
  if (!isRecord(payload)) {
    throw new Error(`${path} must be an object`);
  }

  const { children: _children, ...props } = payload;
  const parsed = componentDefinitions[type].props.safeParse(props);
  if (!parsed.success) {
    const issue = parsed.error.issues.map((item) => `${item.path.join(".") || "(root)"} ${item.message}`).join("; ");
    throw new Error(`${path} is invalid: ${issue}`);
  }

  return parsed.data;
}

export function componentAllowsChildren(type: ComponentName): boolean {
  return componentDefinitions[type].allowsChildren;
}

export function buildCatalogPrompt(): string {
  return Object.entries(componentDefinitions)
    .map(([name, definition]) => `- ${name}: ${definition.description}\n  Props: ${definition.promptShape}`)
    .join("\n");
}
