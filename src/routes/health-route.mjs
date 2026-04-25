import { sendJson } from "../utils/http.mjs";

export function handleHealth(_request, response) {
  sendJson(response, 200, { ok: true });
}

