import { sendJson } from "../utils/http.mjs";
import { getBuildInfo } from "../utils/build-info.mjs";

export function handleHealth(_request, response) {
  sendJson(response, 200, {
    ok: true,
    build: getBuildInfo(),
    capabilities: {
      showcaseReplay: true,
      liveResearch: Boolean(process.env.OPENAI_API_KEY),
      acceptsBrowserApiKeys: false,
      selfHostRecommended: !process.env.OPENAI_API_KEY
    }
  });
}
