import { sendJson } from "../utils/http.mjs";
import { getBuildInfo } from "../utils/build-info.mjs";

export function handleHealth(_request, response) {
  sendJson(response, 200, { ok: true, build: getBuildInfo() });
}
