/**
 * Security analytics tools for Cloudflare zone traffic analysis.
 * Tagged with "security" - only available to security-tagged agents.
 */

import { tool } from "agent-hub";
import * as z from "zod";

// ============================================================
// Cloudflare Analytics Helpers (inlined)
// ============================================================

type TopNRow = { metric: string; count: number };
type CFAndFilter = Record<string, any>;

const CF_GQL_ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";

const GET_CUSTOM_TOPN_TEMPLATE = `
query GetCustomTopN($zoneTag: string, $filter: httpRequestsAdaptiveGroupsFilter_InputObject, $limit: int) {
  viewer {
    scope: zones(filter: {zoneTag: $zoneTag}) {
      total: httpRequestsAdaptiveGroups(filter: $filter, limit: 1) { count __typename }
      topN: httpRequestsAdaptiveGroups(filter: $filter, limit: $limit, orderBy: [count_DESC]) {
        count
        dimensions { metric: DIMENSION_PLACEHOLDER __typename }
        __typename
      }
      __typename
    }
    __typename
  }
}
`;

const GET_CUSTOM_STAT = `
query GetCustomStat($zoneTag: string, $filter: httpRequestsAdaptiveGroupsFilter_InputObject, $prevFilter: httpRequestsAdaptiveGroupsFilter_InputObject) {
  viewer {
    scope: zones(filter: {zoneTag: $zoneTag}) {
      total: httpRequestsAdaptiveGroups(filter: $filter, limit: 1) { count __typename }
      previously: httpRequestsAdaptiveGroups(filter: $prevFilter, limit: 1) { count __typename }
      sparkline: httpRequestsAdaptiveGroups(filter: $filter, limit: 5000, orderBy: [datetimeHour_ASC]) {
        count
        dimensions { ts: datetimeHour __typename }
        __typename
      }
      __typename
    }
    __typename
  }
}
`;

function iso(dt: Date): string {
  return dt.toISOString().replace(/\.\d{3}Z$/, "Z");
}

async function sleep(seconds: number) {
  await new Promise((r) => setTimeout(r, seconds * 1000));
}

function buildFilter(opts: {
  start: Date;
  end: Date;
  andFilters?: CFAndFilter[];
  extra?: Record<string, any>;
}) {
  const flt: Record<string, any> = {
    datetime_geq: iso(opts.start),
    datetime_lt: iso(opts.end)
  };
  if (opts.andFilters?.length) flt.AND = opts.andFilters;
  if (opts.extra) Object.assign(flt, opts.extra);
  return flt;
}

async function executeGql<T = any>(args: {
  query: string;
  variables: Record<string, any>;
  apiToken: string;
  retries?: number;
  backoffBase?: number;
}): Promise<T> {
  const { query, variables, apiToken, retries = 3, backoffBase = 0.5 } = args;
  const payload = JSON.stringify({ query, variables });

  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(CF_GQL_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json"
      },
      body: payload
    });

    if (res.status === 200) {
      const data = await res.json<any>();
      if (data?.errors?.length) {
        throw new Error(`GraphQL error: ${JSON.stringify(data.errors[0])}`);
      }
      return data;
    }

    if ([429, 500, 502, 503, 504].includes(res.status) && attempt < retries) {
      const retryAfter = res.headers.get("Retry-After");
      const delay = retryAfter
        ? Number.parseFloat(retryAfter)
        : backoffBase * 2 ** attempt;
      await sleep(Number.isFinite(delay) ? delay : backoffBase);
      continue;
    }

    let detail: any;
    try {
      detail = await res.json();
    } catch {
      detail = await res.text();
    }
    throw new Error(
      `GraphQL HTTP ${res.status}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`
    );
  }

  throw new Error("Unreachable");
}

function injectDimension(q: string, dimension: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(dimension)) {
    throw new Error(`Invalid dimension: ${dimension}`);
  }
  return q.replace("DIMENSION_PLACEHOLDER", dimension);
}

function fmtNumber(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

function simplifyGrowth(current: number, previous: number) {
  const delta = current - previous;
  const pct = previous ? (delta / previous) * 100 : current ? 100 : 0;
  return { delta, pct };
}

function topnToText(rows: TopNRow[], total?: number, maxRows = 15): string {
  const lines: string[] = [];
  if (typeof total === "number") lines.push(`Total: ${fmtNumber(total)}`);
  lines.push(`Top ${Math.min(maxRows, rows.length)}:`);
  for (let i = 0; i < Math.min(maxRows, rows.length); i++) {
    const r = rows[i];
    const cnt = r?.count ?? 0;
    const metric = String(r?.metric ?? "");
    const share = total ? ` (${((cnt / total) * 100).toFixed(2)}%)` : "";
    lines.push(`${i + 1}) ${metric} — ${fmtNumber(cnt)}${share}`);
  }
  return lines.join("\n");
}

function timeseriesToText(
  total: number,
  previous: number,
  sparkline: { ts: string; count: number }[],
  limitPoints = 48
): string {
  const chg = simplifyGrowth(total, previous);
  const lines: string[] = [
    `Total (current): ${fmtNumber(total)}`,
    `Total (previous): ${fmtNumber(previous)}`,
    `Change: ${chg.delta >= 0 ? "+" : ""}${fmtNumber(chg.delta)} (${chg.pct.toFixed(2)}%)`,
    "Trend (hourly):"
  ];
  const start = Math.max(0, sparkline.length - limitPoints);
  for (let i = start; i < sparkline.length; i++) {
    const dp = sparkline[i];
    lines.push(`${dp.ts} — ${fmtNumber(dp.count)}`);
  }
  return lines.join("\n");
}

async function getCustomTopN(args: {
  apiToken: string;
  zoneTag: string;
  start: Date;
  end: Date;
  dimension?: string;
  limit?: number;
  andFilters?: CFAndFilter[];
  extraFilterFields?: Record<string, any>;
}): Promise<{ total: number; topN: TopNRow[] }> {
  const {
    apiToken,
    zoneTag,
    start,
    end,
    dimension = "clientIP",
    limit = 15,
    andFilters,
    extraFilterFields
  } = args;

  const filter = buildFilter({
    start,
    end,
    andFilters,
    extra: extraFilterFields
  });
  const query = injectDimension(GET_CUSTOM_TOPN_TEMPLATE, dimension);
  const variables = { zoneTag, filter, limit: Number(limit) };

  const data = await executeGql<any>({ query, variables, apiToken });
  const scope = data?.data?.viewer?.scope?.[0] ?? {};

  const total = scope?.total?.[0]?.count ?? 0;
  const rows: TopNRow[] = [];
  for (const r of scope?.topN ?? []) {
    rows.push({ metric: r?.dimensions?.metric ?? "", count: r?.count ?? 0 });
  }
  return { total, topN: rows };
}

async function getCustomStatTimeseries(args: {
  apiToken: string;
  zoneTag: string;
  start: Date;
  end: Date;
  prevStart?: Date;
  prevEnd?: Date;
  andFilters?: CFAndFilter[];
  extraFilterFields?: Record<string, any>;
}): Promise<{
  total: number;
  previous: number;
  sparkline: { ts: string; count: number }[];
}> {
  const {
    apiToken,
    zoneTag,
    start,
    end,
    prevStart,
    prevEnd,
    andFilters,
    extraFilterFields
  } = args;

  let pStart = prevStart;
  let pEnd = prevEnd;
  if (!pStart || !pEnd) {
    const durationMs = end.getTime() - start.getTime();
    pEnd = new Date(start.getTime());
    pStart = new Date(start.getTime() - durationMs);
  }

  const currFilter = buildFilter({
    start,
    end,
    andFilters,
    extra: extraFilterFields
  });
  const prevFilter = buildFilter({
    start: pStart!,
    end: pEnd!,
    andFilters,
    extra: extraFilterFields
  });
  const variables = { zoneTag, filter: currFilter, prevFilter };

  const data = await executeGql<any>({
    query: GET_CUSTOM_STAT,
    variables,
    apiToken
  });
  const scope = data?.data?.viewer?.scope?.[0] ?? {};
  const total = scope?.total?.[0]?.count ?? 0;
  const previous = scope?.previously?.[0]?.count ?? 0;

  const sparkline: { ts: string; count: number }[] = [];
  for (const r of scope?.sparkline ?? []) {
    sparkline.push({ ts: r?.dimensions?.ts, count: r?.count ?? 0 });
  }

  return { total, previous, sparkline };
}

async function getCustomTopNText(args: {
  apiToken: string;
  zoneTag: string;
  start: Date;
  end: Date;
  dimension?: string;
  limit?: number;
  andFilters?: CFAndFilter[];
  extraFilterFields?: Record<string, any>;
  maxRows?: number;
}): Promise<string> {
  const { total, topN } = await getCustomTopN(args);
  return topnToText(topN, total, args.maxRows ?? args.limit ?? 15);
}

async function getCustomStatTimeseriesText(args: {
  apiToken: string;
  zoneTag: string;
  start: Date;
  end: Date;
  prevStart?: Date;
  prevEnd?: Date;
  andFilters?: CFAndFilter[];
  extraFilterFields?: Record<string, any>;
  limitPoints?: number;
}): Promise<string> {
  const res = await getCustomStatTimeseries(args);
  return timeseriesToText(
    res.total,
    res.previous,
    res.sparkline,
    args.limitPoints ?? 1000
  );
}

const validDimension = (d: string) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(d);

// ============================================================
// Tool: get_topn_text
// ============================================================

const GetTopNTextParams = z
  .object({
    zoneTag: z.string().describe("Zone tag for Cloudflare Analytics."),
    dimension: z
      .string()
      .regex(/^[A-Za-z0-9_]+$/)
      .describe(
        "Dimension name (alphanumeric/underscore). Example: clientIP, clientCountryName, edgeResponseStatus, clientASN, host, path, userAgent."
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(15)
      .describe("How many rows to return (1-50)."),
    startISO: z.string().describe("Start time (ISO8601)."),
    endISO: z.string().describe("End time (ISO8601)."),
    andFilters: z
      .array(z.record(z.any()))
      .optional()
      .describe(
        "Optional array of AND filter objects to narrow the query. " +
          "Each object is one filter condition on a valid analytics field " +
          "(e.g., [{ edgeResponseStatus: 403 }] or [{ clientCountryName: 'US' }]). "
      ),
    maxRows: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe("Optional cap on shown rows (defaults to limit).")
  })
  .strict();

export const getTopNTextTool = tool({
  name: "get_topn_text",
  description:
    "Return a formatted Top-N table from Cloudflare Analytics for a chosen dimension (e.g., clientIP, clientCountryName, edgeResponseStatus, userAgent, clientASN, host, path, method). Use this to pivot quickly.",
  inputSchema: GetTopNTextParams,
  varHints: [
    { name: "CF_TOKEN", required: true, description: "Cloudflare API token with Analytics read permissions" }
  ],
  execute: async (
    { dimension, limit, startISO, endISO, maxRows, zoneTag, andFilters },
    ctx
  ) => {
    if (!validDimension(dimension))
      throw new Error(`Invalid dimension: ${dimension}`);

    const token = ctx.agent.vars.CF_TOKEN;
    
    if (!token) throw new Error("Cloudflare API token not found. Stop execution and report error to user immediately.");

    return await getCustomTopNText({
      apiToken: token as string,
      zoneTag,
      start: new Date(startISO),
      end: new Date(endISO),
      dimension,
      limit: limit ?? 15,
      andFilters: [{ requestSource: "eyeball" }, ...(andFilters ?? [])],
      maxRows
    });
  }
});

// ============================================================
// Tool: get_timeseries_text
// ============================================================

const GetTimeseriesTextParams = z
  .object({
    zoneTag: z.string().describe("Zone tag for Cloudflare Analytics."),
    startISO: z.string().describe("Start time (ISO8601)."),
    endISO: z.string().describe("End time (ISO8601)."),
    prevStartISO: z
      .string()
      .optional()
      .describe(
        "Previous window start (ISO8601). Defaults to same duration before startISO."
      ),
    prevEndISO: z
      .string()
      .optional()
      .describe("Previous window end (ISO8601). Defaults to startISO."),
    limitPoints: z
      .number()
      .int()
      .min(10)
      .max(5000)
      .default(500)
      .describe("Max points in formatted output."),
    andFilters: z
      .array(z.record(z.any()))
      .optional()
      .describe(
        "Optional array of AND filter objects to narrow the query. " +
          "Each object is one filter condition on a valid analytics field " +
          "(e.g., [{ edgeResponseStatus: 403 }] or [{ clientCountryName: 'US' }]). "
      )
  })
  .strict();

export const getTimeseriesTextTool = tool({
  name: "get_timeseries_text",
  description:
    "Return a formatted timeseries (current vs previous window) for request counts from Cloudflare Analytics. Use this to confirm spikes, dips, or diurnal patterns.",
  inputSchema: GetTimeseriesTextParams,
  varHints: [
    { name: "CF_TOKEN", required: true, description: "Cloudflare API token with Analytics read permissions" }
  ],
  execute: async (
    {
      startISO,
      endISO,
      prevStartISO,
      prevEndISO,
      limitPoints,
      zoneTag,
      andFilters
    },
    ctx
  ) => {
    const token = ctx.agent.vars.CF_TOKEN;
    
    if (!token) throw new Error("Cloudflare API token not found. Stop execution and report error to user immediately.");

    return await getCustomStatTimeseriesText({
      apiToken: token as string,
      zoneTag,
      start: new Date(startISO),
      end: new Date(endISO),
      prevStart: prevStartISO ? new Date(prevStartISO) : undefined,
      prevEnd: prevEndISO ? new Date(prevEndISO) : undefined,
      andFilters: [{ requestSource: "eyeball" }, ...(andFilters ?? [])],
      limitPoints: limitPoints ?? 500
    });
  }
});
