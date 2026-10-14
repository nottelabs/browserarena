import { cacheLife } from "next/cache";
import type { MetadataRoute } from "next";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  "use cache";
  cacheLife("days");
  const lastModified = new Date();
  const baseUrl = "https://browserarena.ai";

  return [
    { url: `${baseUrl}/proxies`, changeFrequency: "daily", priority: 0.9 },
    {
      url: baseUrl,
      lastModified,
      changeFrequency: "daily",
      priority: 1.0,
    },
    // Variant pages for different percentile views (helps search engines
    // understand that these are meaningful distinct views of the data)
    {
      url: `${baseUrl}/faq`,
      lastModified,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${baseUrl}?percentile=median`,
      lastModified,
      changeFrequency: "daily",
      priority: 0.9,
    },
    {
      url: `${baseUrl}?percentile=p90`,
      lastModified,
      changeFrequency: "daily",
      priority: 0.8,
    },
    {
      url: `${baseUrl}?percentile=p95`,
      lastModified,
      changeFrequency: "daily",
      priority: 0.8,
    },
    {
      url: `${baseUrl}?percentile=p99`,
      lastModified,
      changeFrequency: "daily",
      priority: 0.7,
    },
    {
      url: `${baseUrl}/throughput`,
      lastModified,
      changeFrequency: "daily",
      priority: 0.9,
    },
  ];
}
