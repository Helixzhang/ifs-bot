const url =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vR2lRCG0MSWtxU5RjumfRTzJ4enUs-cWc69hhgkOuI3ds79RF1_pJJ8wGN9Dhj2rLqWha_QR-LLFG4j/pubhtml?gid=1674745482&single=true&headers=false&widget=false&chrome=false";

const response = await fetch(url, {
  redirect: "follow",
  headers: { "user-agent": "Mozilla/5.0" },
});

const html = await response.text();

const decodeHtml = (value) =>
  value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, " ")
    .trim();

const table = html.match(/<table\b[\s\S]*?<\/table>/i)?.[0] ?? "";
const rows = [...table.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)]
  .map(([row]) =>
    [...row.matchAll(/<t[dh]\b[\s\S]*?<\/t[dh]>/gi)].map(([cell]) =>
      decodeHtml(cell),
    ),
  )
  .filter((cells) => cells.length >= 2 && cells[0] !== "Location");

const data = rows.map(([number, location, status]) => ({
  location: location ?? number,
  status: status ?? "",
})).filter(({ location }) => location && location !== "Location");

console.log(JSON.stringify(data, null, 2));
