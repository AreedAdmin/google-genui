import "./src/load-env.js";
import { webSearch } from "./src/agents/linkup.js";

const r = await webSearch(
  "ioredis deprecated constructor options and connection retry/backoff best practices",
);
console.log(
  JSON.stringify(
    {
      hasAnswer: !!r?.answer,
      answerLen: r?.answer?.length ?? 0,
      sourceCount: r?.sources?.length ?? 0,
      sample: r?.answer?.slice(0, 220),
      sources: r?.sources?.slice(0, 3).map((s) => s.url),
    },
    null,
    2,
  ),
);
