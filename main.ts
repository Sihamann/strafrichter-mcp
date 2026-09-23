import {
  createMcpHandler,
  McpServer,
} from "npm:@modelcontextprotocol/server@2.0.0"

import * as z from "npm:zod@4"

import {
  DOMParser,
} from "jsr:@b-fuze/deno-dom@0.1.56"


const HRR_BASE = "https://007.sihamann.deno.net"
const RIS_BASE = "https://testphase.rechtsinformationen.bund.de"
const BURHOFF_BASE = "https://009.sihamann.deno.net"
const BURHOFF_BLOG_BASE = "https://blog.burhoff.de"


function buildUrl(
  base: string,
  path: string,
): URL {
  return new URL(
    path.replace(/^\/+/, ""),
    base.endsWith("/") ? base : `${base}/`,
  )
}


async function getJson(
  base: string,
  path: string,
  params: Record<string, string | number | boolean | undefined> = {},
): Promise<any> {
  const url = buildUrl(base, path)

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value))
    }
  }

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(30000),
  })

  const text = await response.text()

  let data: any

  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(
      `Ungültige JSON-Antwort von ${url.toString()}: ${text.slice(0, 1500)}`,
    )
  }

  if (!response.ok) {
    const detail =
      typeof data?.detail === "string"
        ? data.detail
        : typeof data?.error === "string"
          ? data.error
          : JSON.stringify(data)

    throw new Error(
      `HTTP ${response.status} von ${url.toString()}: ${String(detail).slice(0, 1800)}`,
    )
  }

  return data
}


async function getText(
  url: string,
  accept = "text/html,application/xhtml+xml",
): Promise<string> {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: accept,
      "User-Agent": "Strafrichter-MCP/1.0",
    },
    signal: AbortSignal.timeout(30000),
  })

  const text = await response.text()

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} von ${url}: ${text.slice(0, 1200)}`,
    )
  }

  return text
}


function toolResult(
  data: unknown,
) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  }
}


function toolError(
  error: unknown,
) {
  return {
    content: [
      {
        type: "text" as const,
        text: `Fehler: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`,
      },
    ],
    isError: true,
  }
}


function cleanText(
  value: string,
): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}


function parseHtml(
  html: string,
) {
  const dom = new DOMParser().parseFromString(
    html,
    "text/html",
  )

  if (!dom) {
    throw new Error(
      "HTML konnte nicht geparst werden.",
    )
  }

  return dom
}


// ======================================================
// RIS / BVERFG
// ======================================================

function stripMarkTags(
  value: string,
): string {
  return value
    .replace(/<\/?mark>/gi, "")
    .trim()
}


function extractRisDecision(
  entry: any,
) {
  const item = entry?.item ?? entry

  const matches =
    Array.isArray(entry?.textMatches)
      ? entry.textMatches
      : []

  const snippet =
    matches
      .map(
        (match: any) =>
          stripMarkTags(
            String(match?.text ?? ""),
          ),
      )
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 3000)

  const documentNumber =
    String(item?.documentNumber ?? "")

  return {
    documentNumber,
    ecli:
      item?.ecli ?? null,
    headline:
      item?.headline ?? null,
    titleLine:
      item?.titleLine ?? null,
    date:
      item?.decisionDate ?? null,
    fileNumbers:
      Array.isArray(item?.fileNumbers)
        ? item.fileNumbers
        : [],
    court:
      item?.courtName ??
      item?.courtType ??
      null,
    decisionType:
      item?.documentType ?? null,
    judicialBody:
      item?.judicialBody ?? null,
    location:
      item?.location ?? null,
    snippet,
    htmlPath:
      documentNumber
        ? `/v1/case-law/${encodeURIComponent(documentNumber)}.html`
        : null,
    xmlPath:
      documentNumber
        ? `/v1/case-law/${encodeURIComponent(documentNumber)}.xml`
        : null,
    source:
      "Rechtsinformationen des Bundes",
    sourceStatus:
      "Amtliche Primärquelle",
  }
}


async function searchBverfgRis(
  query: string | undefined,
  aktenzeichen: string | undefined,
  maxPages: number,
  fromDate: string | undefined,
  toDate: string | undefined,
) {
  const results: any[] = []
  const pageSize = 25

  let pageIndex = 0
  let pagesFetched = 0
  let totalItems: number | null = null
  let hasMore = false

  while (pageIndex < maxPages) {
    const data = await getJson(
      RIS_BASE,
      "/v1/case-law",
      {
        searchTerm:
          query?.trim() || undefined,
        fileNumber:
          aktenzeichen?.trim() || undefined,
        court:
          "BVerfG",
        dateFrom:
          fromDate,
        dateTo:
          toDate,
        size:
          pageSize,
        pageIndex,
      },
    )

    pagesFetched++

    if (
      typeof data?.totalItems ===
      "number"
    ) {
      totalItems = data.totalItems
    }

    const member =
      Array.isArray(data?.member)
        ? data.member
        : []

    for (const entry of member) {
      results.push(
        extractRisDecision(entry),
      )
    }

    hasMore =
      Boolean(data?.view?.next) ||
      (
        typeof totalItems === "number" &&
        (pageIndex + 1) * pageSize < totalItems
      )

    if (!hasMore) {
      break
    }

    pageIndex++
  }

  return {
    ok: true,
    query:
      query ?? null,
    aktenzeichen:
      aktenzeichen ?? null,
    court:
      "BVerfG",
    fromDate:
      fromDate ?? null,
    toDate:
      toDate ?? null,
    source:
      RIS_BASE,
    sourceStatus:
      "Amtliche Primärquelle",
    totalItems,
    pagesFetched,
    resultsCount:
      results.length,
    hasMore,
    results,
    note:
      "Die Suche erfolgt direkt über die API Rechtsinformationen des Bundes. Für tragende Aussagen den Volltext mit get_bverfg_decision abrufen.",
  }
}


function normalizeRisDocumentNumber(
  value: string,
): string {
  const trimmed = value.trim()

  if (
    /^[A-Za-z0-9._-]+$/
      .test(trimmed)
  ) {
    return trimmed
  }

  let pathname = ""

  try {
    pathname =
      new URL(trimmed, RIS_BASE)
        .pathname
  } catch {
    throw new Error(
      "Ungültige documentNumber oder RIS-URL.",
    )
  }

  const match =
    pathname.match(
      /\/v1\/case-law\/([^/]+?)(?:\.html|\.xml)?$/,
    )

  if (!match) {
    throw new Error(
      "Aus der angegebenen RIS-URL konnte keine documentNumber ermittelt werden.",
    )
  }

  return decodeURIComponent(match[1])
}


async function fetchRisDecisionHtml(
  documentNumberInput: string,
  maxCharacters: number,
) {
  const documentNumber =
    normalizeRisDocumentNumber(
      documentNumberInput,
    )

  const url =
    `${RIS_BASE}/v1/case-law/` +
    `${encodeURIComponent(documentNumber)}.html`

  const html =
    await getText(url)

  const dom =
    parseHtml(html)

  dom
    .querySelectorAll(
      "script,style,nav,footer,form,aside",
    )
    .forEach(
      (node: any) =>
        node.remove(),
    )

  const title =
    cleanText(
      dom.querySelector("title")
        ?.textContent ??
      dom.querySelector("h1")
        ?.textContent ??
      "",
    )

  const fullText =
    cleanText(
      dom.body?.textContent ??
      "",
    )

  return {
    ok: true,
    documentNumber,
    title,
    url,
    text:
      fullText.length > maxCharacters
        ? fullText.slice(0, maxCharacters)
        : fullText,
    totalCharacters:
      fullText.length,
    truncated:
      fullText.length > maxCharacters,
    source:
      "Rechtsinformationen des Bundes",
    sourceStatus:
      "Amtliche Primärquelle",
  }
}


// ======================================================
// BURHOFF BLOG
// ======================================================

function absoluteBurhoffBlogUrl(
  value: string,
): string {
  const url =
    new URL(
      value,
      BURHOFF_BLOG_BASE,
    )

  if (
    url.hostname !==
    "blog.burhoff.de"
  ) {
    throw new Error(
      "Nur URLs von blog.burhoff.de sind zulässig.",
    )
  }

  return url.toString()
}


async function searchBurhoffBlog(
  query: string,
  maxPages: number,
  maxResults: number,
) {
  const results: any[] = []
  const seen = new Set<string>()

  let pagesFetched = 0
  let hasMore = false
  let page = 1

  while (page <= maxPages) {
    const url =
      new URL(
        page === 1
          ? "/"
          : `/page/${page}/`,
        BURHOFF_BLOG_BASE,
      )

    url.searchParams.set(
      "s",
      query,
    )

    const html =
      await getText(
        url.toString(),
      )

    const dom =
      parseHtml(html)

    pagesFetched++

    const articles =
      Array.from(
        dom.querySelectorAll(
          "article",
        ),
      ) as any[]

    for (const article of articles) {
      const titleLink =
        article.querySelector(
          ".entry-title a, h1 a, h2 a, h3 a",
        )

      const href =
        titleLink?.getAttribute("href")

      if (!href) {
        continue
      }

      let articleUrl: string

      try {
        articleUrl =
          absoluteBurhoffBlogUrl(href)
      } catch {
        continue
      }

      if (seen.has(articleUrl)) {
        continue
      }

      seen.add(articleUrl)

      const time =
        article.querySelector("time")

      const excerptNode =
        article.querySelector(
          ".entry-summary, .entry-content",
        )

      results.push({
        title:
          cleanText(
            titleLink?.textContent ?? "",
          ),
        url:
          articleUrl,
        date:
          time?.getAttribute("datetime") ??
          cleanText(
            time?.textContent ?? "",
          ),
        author:
          cleanText(
            article
              .querySelector(
                ".author, .byline",
              )
              ?.textContent ??
            "",
          ),
        snippet:
          cleanText(
            excerptNode?.textContent ??
            "",
          )
            .slice(0, 1200),
        source:
          "Burhoff online Blog",
        sourceStatus:
          "Sekundärquelle",
      })

      if (
        results.length >=
        maxResults
      ) {
        break
      }
    }

    hasMore =
      Boolean(
        dom.querySelector(
          ".nav-next a, a.next, .next.page-numbers",
        ),
      )

    if (
      results.length >= maxResults ||
      !hasMore
    ) {
      break
    }

    page++
  }

  return {
    ok: true,
    query,
    source:
      BURHOFF_BLOG_BASE,
    sourceStatus:
      "Sekundärquelle",
    pagesFetched,
    resultsCount:
      results.length,
    hasMore,
    results,
  }
}


async function getBurhoffBlogArticle(
  inputUrl: string,
  maxCharacters: number,
) {
  const url =
    absoluteBurhoffBlogUrl(
      inputUrl,
    )

  const html =
    await getText(url)

  const dom =
    parseHtml(html)

  dom
    .querySelectorAll(
      "script,style,nav,footer,form,aside,.comments-area,.sharedaddy,.jp-relatedposts",
    )
    .forEach(
      (node: any) =>
        node.remove(),
    )

  const article =
    dom.querySelector("article") ??
    dom.body

  if (!article) {
    throw new Error(
      "Beitrag konnte nicht erkannt werden.",
    )
  }

  const title =
    cleanText(
      article
        .querySelector(
          ".entry-title, h1",
        )
        ?.textContent ??
      dom.querySelector("title")
        ?.textContent ??
      "",
    )

  const time =
    article.querySelector("time")

  const content =
    article.querySelector(
      ".entry-content",
    ) ??
    article

  const fullText =
    cleanText(
      content.textContent ?? "",
    )

  return {
    ok: true,
    url,
    title,
    date:
      time?.getAttribute("datetime") ??
      cleanText(
        time?.textContent ?? "",
      ),
    author:
      cleanText(
        article
          .querySelector(
            ".author, .byline",
          )
          ?.textContent ??
        "",
      ),
    text:
      fullText.length > maxCharacters
        ? fullText.slice(0, maxCharacters)
        : fullText,
    totalCharacters:
      fullText.length,
    truncated:
      fullText.length > maxCharacters,
    source:
      "Burhoff online Blog",
    sourceStatus:
      "Sekundärquelle",
    warning:
      "Der Burhoff-Blog ist eine private Sekundärquelle. Tragende Rechtsaussagen und zitierte Entscheidungen sind anhand von Gesetz und verifizierten Primärquellen gegenzuprüfen.",
  }
}


// ======================================================
// MCP SERVER
// ======================================================

const handler =
  createMcpHandler(
    () => {
      const server =
        new McpServer(
          {
            name:
              "strafrichter-mcp",
            version:
              "0.4.0",
          },
          {
            instructions: `
Dieser MCP-Server bündelt lesende Recherchequellen für deutsches
Strafrecht, Strafprozessrecht, Ordnungswidrigkeitenrecht und
angrenzende Rechtsgebiete.

HRR-Strafrecht ist eine fachwissenschaftliche Sekundärquelle.

BVerfG-Entscheidungen werden direkt über die API
Rechtsinformationen des Bundes recherchiert. Diese Quelle ist
für die dort bereitgestellten amtlichen Entscheidungstexte als
Primärquelle zu behandeln. Suchtreffer ersetzen keinen Volltextabruf.

Burhoff-Rechtsprechung ist eine private juristische Recherchequelle.

Der Burhoff online Blog ist eine private fachliche Sekundärquelle.

Upstream-Fehler dürfen nicht als leere Trefferliste interpretiert werden.
Alle Tools sind ausschließlich lesend.
            `.trim(),
          },
        )


      // 1
      server.registerTool(
        "health_hrr_strafrecht",
        {
          description:
            "Prüft, ob der HRR-Strafrecht-Deno-Proxy erreichbar ist.",
          inputSchema:
            z.object({}),
          annotations: {
            readOnlyHint: true,
            idempotentHint: true,
            openWorldHint: true,
          },
        },
        async () => {
          try {
            return toolResult(
              await getJson(
                HRR_BASE,
                "/health",
              ),
            )
          } catch (error) {
            return toolError(error)
          }
        },
      )


      // 2
      server.registerTool(
        "search_hrr_articles",
        {
          description:
            "Durchsucht das HRR-Strafrecht-Aufsatzarchiv. HRR ist eine Sekundärquelle.",
          inputSchema:
            z.object({
              query:
                z.string()
                  .min(2)
                  .max(500),
              includeReviews:
                z.boolean()
                  .default(false),
              mode:
                z.enum([
                  "standard",
                  "exact",
                ])
                  .default("standard"),
              maxPages:
                z.number()
                  .int()
                  .min(1)
                  .max(5)
                  .default(2),
            }),
          annotations: {
            readOnlyHint: true,
            idempotentHint: true,
            openWorldHint: true,
          },
        },
        async ({
          query,
          includeReviews,
          mode,
          maxPages,
        }) => {
          try {
            return toolResult(
              await getJson(
                HRR_BASE,
                "/search",
                {
                  query,
                  includeReviews,
                  mode,
                  maxPages,
                },
              ),
            )
          } catch (error) {
            return toolError(error)
          }
        },
      )


      // 3
      server.registerTool(
        "get_hrr_article",
        {
          description:
            "Ruft einen einzelnen HRR-Beitrag ab. Bei truncated=true ist der Text unvollständig.",
          inputSchema:
            z.object({
              url:
                z.string()
                  .min(5)
                  .max(2000),
              maxCharacters:
                z.number()
                  .int()
                  .min(1000)
                  .max(60000)
                  .default(20000),
            }),
          annotations: {
            readOnlyHint: true,
            idempotentHint: true,
            openWorldHint: true,
          },
        },
        async ({
          url,
          maxCharacters,
        }) => {
          try {
            return toolResult(
              await getJson(
                HRR_BASE,
                "/article",
                {
                  url,
                  maxCharacters,
                },
              ),
            )
          } catch (error) {
            return toolError(error)
          }
        },
      )


      // 4
      server.registerTool(
        "health_bverfg",
        {
          description:
            "Prüft die BVerfG-Recherche über Rechtsinformationen des Bundes.",
          inputSchema:
            z.object({}),
          annotations: {
            readOnlyHint: true,
            idempotentHint: true,
            openWorldHint: true,
          },
        },
        async () => {
          try {
            const data =
              await getJson(
                RIS_BASE,
                "/v1/case-law",
                {
                  court:
                    "BVerfG",
                  size:
                    1,
                  pageIndex:
                    0,
                },
              )

            return toolResult({
              ok: true,
              service:
                "Rechtsinformationen des Bundes",
              court:
                "BVerfG",
              totalItems:
                data?.totalItems ?? null,
              source:
                RIS_BASE,
              sourceStatus:
                "Amtliche Primärquelle",
            })
          } catch (error) {
            return toolError(error)
          }
        },
      )


      // 5
      server.registerTool(
        "search_bverfg_decisions",
        {
          description:
            "Sucht BVerfG-Entscheidungen direkt über Rechtsinformationen des Bundes. Relevante Treffer anschließend im Volltext abrufen.",
          inputSchema:
            z.object({
              query:
                z.string()
                  .max(500)
                  .optional(),
              aktenzeichen:
                z.string()
                  .max(200)
                  .optional(),
              maxPages:
                z.number()
                  .int()
                  .min(1)
                  .max(5)
                  .default(1),
              fromDate:
                z.string()
                  .regex(
                    /^\d{4}-\d{2}-\d{2}$/,
                    "Erwartet YYYY-MM-DD",
                  )
                  .optional(),
              toDate:
                z.string()
                  .regex(
                    /^\d{4}-\d{2}-\d{2}$/,
                    "Erwartet YYYY-MM-DD",
                  )
                  .optional(),
            })
              .refine(
                (value) =>
                  Boolean(
                    value.query?.trim() ||
                    value.aktenzeichen?.trim(),
                  ),
                {
                  message:
                    "Mindestens query oder aktenzeichen muss befüllt sein.",
                },
              ),
          annotations: {
            readOnlyHint: true,
            idempotentHint: true,
            openWorldHint: true,
          },
        },
        async ({
          query,
          aktenzeichen,
          maxPages,
          fromDate,
          toDate,
        }) => {
          try {
            return toolResult(
              await searchBverfgRis(
                query,
                aktenzeichen,
                maxPages,
                fromDate,
                toDate,
              ),
            )
          } catch (error) {
            return toolError(error)
          }
        },
      )


      // 6
      server.registerTool(
        "get_bverfg_decision",
        {
          description:
            "Ruft den amtlichen Volltext einer BVerfG-Entscheidung aus Rechtsinformationen des Bundes ab. Erwartet die documentNumber aus einem Suchtreffer, z.B. KVRE427931801.",
          inputSchema:
            z.object({
              documentNumber:
                z.string()
                  .min(3)
                  .max(500),
              maxCharacters:
                z.number()
                  .int()
                  .min(1000)
                  .max(80000)
                  .default(30000),
            }),
          annotations: {
            readOnlyHint: true,
            idempotentHint: true,
            openWorldHint: true,
          },
        },
        async ({
          documentNumber,
          maxCharacters,
        }) => {
          try {
            return toolResult(
              await fetchRisDecisionHtml(
                documentNumber,
                maxCharacters,
              ),
            )
          } catch (error) {
            return toolError(error)
          }
        },
      )


      // 7
      server.registerTool(
        "health_burhoff",
        {
          description:
            "Prüft, ob der Burhoff-Rechtsprechungsproxy erreichbar ist.",
          inputSchema:
            z.object({}),
          annotations: {
            readOnlyHint: true,
            idempotentHint: true,
            openWorldHint: true,
          },
        },
        async () => {
          try {
            return toolResult(
              await getJson(
                BURHOFF_BASE,
                "/health",
              ),
            )
          } catch (error) {
            return toolError(error)
          }
        },
      )


      // 8
      server.registerTool(
        "search_burhoff_decisions",
        {
          description:
            "Durchsucht Burhoff-Rechtsprechungsindexseiten. Burhoff ist eine private Recherchequelle.",
          inputSchema:
            z.object({
              query:
                z.string()
                  .min(2)
                  .max(500),
              sources:
                z.string()
                  .default("all"),
              mode:
                z.enum([
                  "all",
                  "any",
                  "or",
                  "literal",
                ])
                  .default("all"),
              maxResults:
                z.number()
                  .int()
                  .min(1)
                  .max(100)
                  .default(25),
              maxSourcePages:
                z.number()
                  .int()
                  .min(1)
                  .max(80)
                  .default(35),
              includeFullText:
                z.boolean()
                  .default(false),
              maxFullTextCharacters:
                z.number()
                  .int()
                  .min(1000)
                  .max(30000)
                  .default(6000),
            }),
          annotations: {
            readOnlyHint: true,
            idempotentHint: true,
            openWorldHint: true,
          },
        },
        async ({
          query,
          sources,
          mode,
          maxResults,
          maxSourcePages,
          includeFullText,
          maxFullTextCharacters,
        }) => {
          try {
            return toolResult(
              await getJson(
                BURHOFF_BASE,
                "/search",
                {
                  query,
                  sources,
                  mode,
                  maxResults,
                  maxSourcePages,
                  includeFullText,
                  maxFullTextCharacters,
                },
              ),
            )
          } catch (error) {
            return toolError(error)
          }
        },
      )


      // 9
      server.registerTool(
        "get_burhoff_document",
        {
          description:
            "Ruft ein einzelnes Burhoff-Dokument aus einem Suchtreffer ab.",
          inputSchema:
            z.object({
              url:
                z.string()
                  .min(5)
                  .max(3000),
              maxCharacters:
                z.number()
                  .int()
                  .min(1000)
                  .max(80000)
                  .default(30000),
            }),
          annotations: {
            readOnlyHint: true,
            idempotentHint: true,
            openWorldHint: true,
          },
        },
        async ({
          url,
          maxCharacters,
        }) => {
          try {
            return toolResult(
              await getJson(
                BURHOFF_BASE,
                "/document",
                {
                  url,
                  maxCharacters,
                },
              ),
            )
          } catch (error) {
            return toolError(error)
          }
        },
      )


      // 10
      server.registerTool(
        "health_burhoff_blog",
        {
          description:
            "Prüft, ob der Burhoff online Blog direkt erreichbar ist.",
          inputSchema:
            z.object({}),
          annotations: {
            readOnlyHint: true,
            idempotentHint: true,
            openWorldHint: true,
          },
        },
        async () => {
          try {
            const html =
              await getText(
                `${BURHOFF_BLOG_BASE}/`,
              )

            return toolResult({
              ok: true,
              service:
                "Burhoff online Blog",
              source:
                BURHOFF_BLOG_BASE,
              reachable:
                html.length > 0,
            })
          } catch (error) {
            return toolError(error)
          }
        },
      )


      // 11
      server.registerTool(
        "search_burhoff_blog",
        {
          description:
            "Durchsucht den Burhoff online Blog. Der Blog ist eine private Sekundärquelle.",
          inputSchema:
            z.object({
              query:
                z.string()
                  .min(2)
                  .max(500),
              maxPages:
                z.number()
                  .int()
                  .min(1)
                  .max(5)
                  .default(2),
              maxResults:
                z.number()
                  .int()
                  .min(1)
                  .max(50)
                  .default(20),
            }),
          annotations: {
            readOnlyHint: true,
            idempotentHint: true,
            openWorldHint: true,
          },
        },
        async ({
          query,
          maxPages,
          maxResults,
        }) => {
          try {
            return toolResult(
              await searchBurhoffBlog(
                query,
                maxPages,
                maxResults,
              ),
            )
          } catch (error) {
            return toolError(error)
          }
        },
      )


      // 12
      server.registerTool(
        "get_burhoff_blog_article",
        {
          description:
            "Ruft einen einzelnen Beitrag aus dem Burhoff online Blog ab.",
          inputSchema:
            z.object({
              url:
                z.string()
                  .min(5)
                  .max(3000),
              maxCharacters:
                z.number()
                  .int()
                  .min(1000)
                  .max(60000)
                  .default(20000),
            }),
          annotations: {
            readOnlyHint: true,
            idempotentHint: true,
            openWorldHint: true,
          },
        },
        async ({
          url,
          maxCharacters,
        }) => {
          try {
            return toolResult(
              await getBurhoffBlogArticle(
                url,
                maxCharacters,
              ),
            )
          } catch (error) {
            return toolError(error)
          }
        },
      )


      return server
    },
  )


export default handler
