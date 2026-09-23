import {
  createMcpHandler,
  McpServer,
} from "npm:@modelcontextprotocol/server@2.0.0"

import * as z from "npm:zod@4"

import {
  DOMParser,
} from "jsr:@b-fuze/deno-dom@0.1.56"


const HRR_BASE = "https://007.sihamann.deno.net"
const BVERFG_BASE = "https://deno10.sihamann.deno.net"
const BURHOFF_BASE = "https://009.sihamann.deno.net"
const BURHOFF_BLOG_BASE = "https://blog.burhoff.de"


function buildUrl(base: string, path: string): URL {
  const normalizedBase =
    base.endsWith("/") ? base : `${base}/`

  const normalizedPath =
    path.replace(/^\/+/, "")

  return new URL(normalizedPath, normalizedBase)
}


async function getJson(
  base: string,
  path: string,
  params: Record<
    string,
    string | number | boolean | undefined
  > = {},
): Promise<any> {
  const url = buildUrl(base, path)

  for (
    const [key, value]
    of Object.entries(params)
  ) {
    if (value !== undefined) {
      url.searchParams.set(
        key,
        String(value),
      )
    }
  }

  const response =
    await fetch(
      url,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        signal:
          AbortSignal.timeout(30000),
      },
    )

  const text =
    await response.text()

  let data: any

  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(
      `Ungültige JSON-Antwort von ${url.toString()}: ` +
      text.slice(0, 1500),
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
      `HTTP ${response.status} von ${url.toString()}: ` +
      String(detail).slice(0, 1800),
    )
  }

  return data
}


function toolResult(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text:
          JSON.stringify(
            data,
            null,
            2,
          ),
      },
    ],
  }
}


function toolError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : String(error)

  return {
    content: [
      {
        type: "text" as const,
        text:
          `Fehler: ${message}`,
      },
    ],
    isError: true,
  }
}


function cleanText(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}


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


async function fetchHtml(
  url: string,
): Promise<string> {
  const response =
    await fetch(
      url,
      {
        method: "GET",
        headers: {
          Accept:
            "text/html,application/xhtml+xml",
          "User-Agent":
            "Strafrichter-MCP/1.0",
        },
        signal:
          AbortSignal.timeout(30000),
      },
    )

  const html =
    await response.text()

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} von ${url}: ` +
      html.slice(0, 1200),
    )
  }

  return html
}


function parseHtml(html: string) {
  const dom =
    new DOMParser()
      .parseFromString(
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


async function searchBurhoffBlog(
  query: string,
  maxPages: number,
  maxResults: number,
) {
  const results: any[] = []
  const seen =
    new Set<string>()

  let pagesFetched = 0
  let hasMore = false
  let page = 1

  while (
    page <= maxPages
  ) {
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
      await fetchHtml(
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

    for (
      const article
      of articles
    ) {
      const titleLink =
        article.querySelector(
          ".entry-title a, h1 a, h2 a, h3 a",
        )

      const href =
        titleLink
          ?.getAttribute(
            "href",
          )

      if (!href) {
        continue
      }

      let articleUrl: string

      try {
        articleUrl =
          absoluteBurhoffBlogUrl(
            href,
          )
      } catch {
        continue
      }

      if (
        seen.has(
          articleUrl,
        )
      ) {
        continue
      }

      seen.add(
        articleUrl,
      )

      const title =
        cleanText(
          titleLink
            ?.textContent ??
          "",
        )

      const time =
        article.querySelector(
          "time",
        )

      const date =
        time?.getAttribute(
          "datetime",
        ) ??
        cleanText(
          time?.textContent ??
          "",
        )

      const author =
        cleanText(
          article
            .querySelector(
              ".author, .byline",
            )
            ?.textContent ??
          "",
        )

      const excerptNode =
        article.querySelector(
          ".entry-summary, .entry-content",
        )

      const snippet =
        cleanText(
          excerptNode
            ?.textContent ??
          "",
        )
          .slice(
            0,
            1200,
          )

      const categories =
        Array.from(
          article.querySelectorAll(
            ".cat-links a, .category a",
          ),
        )
          .map(
            (node: any) =>
              cleanText(
                node.textContent ??
                "",
              ),
          )
          .filter(Boolean)

      results.push({
        title,
        url:
          articleUrl,
        date,
        author,
        categories,
        snippet,
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
      results.length >=
      maxResults
    ) {
      break
    }

    if (!hasMore) {
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
    await fetchHtml(url)

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
    dom.querySelector(
      "article",
    ) ??
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
      dom.querySelector(
        "title",
      )
        ?.textContent ??
      "",
    )

  const time =
    article.querySelector(
      "time",
    )

  const date =
    time?.getAttribute(
      "datetime",
    ) ??
    cleanText(
      time?.textContent ??
      "",
    )

  const author =
    cleanText(
      article
        .querySelector(
          ".author, .byline",
        )
        ?.textContent ??
      "",
    )

  const categories =
    Array.from(
      article.querySelectorAll(
        ".cat-links a, .category a",
      ),
    )
      .map(
        (node: any) =>
          cleanText(
            node.textContent ??
            "",
          ),
      )
      .filter(Boolean)

  const tags =
    Array.from(
      article.querySelectorAll(
        ".tags-links a, .tag-links a",
      ),
    )
      .map(
        (node: any) =>
          cleanText(
            node.textContent ??
            "",
          ),
      )
      .filter(Boolean)

  const content =
    article.querySelector(
      ".entry-content",
    ) ??
    article

  const fullText =
    cleanText(
      content.textContent ??
      "",
    )

  const totalCharacters =
    fullText.length

  const returnedText =
    totalCharacters >
      maxCharacters
      ? fullText.slice(
          0,
          maxCharacters,
        )
      : fullText

  return {
    ok: true,
    url,
    title,
    date,
    author,
    categories,
    tags,
    text:
      returnedText,
    totalCharacters,
    truncated:
      totalCharacters >
      maxCharacters,
    source:
      "Burhoff online Blog",
    sourceStatus:
      "Sekundärquelle",
    warning:
      "Der Burhoff-Blog ist eine private Sekundärquelle. " +
      "Tragende Rechtsaussagen und wiedergegebene Gerichtsentscheidungen " +
      "sind anhand von Gesetz und verifizierten Primärquellen gegenzuprüfen.",
  }
}


const handler =
  createMcpHandler(
    () => {
      const server =
        new McpServer(
          {
            name:
              "strafrichter-mcp",
            version:
              "0.3.0",
          },
          {
            instructions: `
Dieser MCP-Server bündelt lesende Recherchequellen für deutsches
Strafrecht, Strafprozessrecht, Ordnungswidrigkeitenrecht und
angrenzende Rechtsgebiete.

HRR-Strafrecht ist eine fachwissenschaftliche Sekundärquelle.
Tragende Rechtsaussagen sind anhand von Gesetz und belastbaren
Primärquellen gegenzuprüfen.

Der BVerfG-Deno-Proxy ist technischer Transport. Soweit der
zurückgegebene Text von der amtlichen BVerfG-Seite stammt, ist
die zugrunde liegende Entscheidung eine Primärquelle.
Suchtreffer ersetzen keinen Volltextabruf.

Burhoff-Rechtsprechung ist eine private juristische Recherchequelle.
Gerichtsentscheidungen sind soweit möglich anhand einer amtlichen
oder anderweitig verifizierten Primärfundstelle gegenzuprüfen.

Der Burhoff online Blog ist eine private fachliche Sekundärquelle.
Blogbeiträge dürfen zur Recherche, Einordnung und zum Auffinden
zitierter Entscheidungen genutzt werden.

Upstream-Fehler dürfen nicht als leere Trefferliste interpretiert werden.
Alle Tools sind ausschließlich lesend.
            `.trim(),
          },
        )


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


      server.registerTool(
        "health_bverfg",
        {
          description:
            "Prüft, ob der BVerfG-Deno-Proxy erreichbar ist.",
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
                BVERFG_BASE,
                "/health",
              ),
            )
          } catch (error) {
            return toolError(error)
          }
        },
      )


      server.registerTool(
        "search_bverfg_decisions",
        {
          description:
            "Sucht BVerfG-Entscheidungen. Relevante Treffer anschließend im Volltext abrufen.",
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
              await getJson(
                BVERFG_BASE,
                "/search",
                {
                  query,
                  aktenzeichen,
                  maxPages,
                  fromDate,
                  toDate,
                },
              ),
            )
          } catch (error) {
            return toolError(error)
          }
        },
      )


      server.registerTool(
        "get_bverfg_decision",
        {
          description:
            "Ruft eine konkrete BVerfG-Entscheidung anhand der URL aus einem Suchtreffer ab.",
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
                BVERFG_BASE,
                "/decision",
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
              await fetchHtml(
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
