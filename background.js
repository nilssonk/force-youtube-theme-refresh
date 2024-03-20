/*
MIT License

Copyright (c) 2023 Kim Nilsson

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

let do_log = (_) => {};

browser.management.getSelf().then((info) => {
  if (info.installType == "development") {
    do_log = console.log;
  }
});

const watch_urls = ["*://*.youtube.com/watch?*"];
const player_urls = ["*://*.youtube.com/*/player?*"];

const watch_hook = (details) => {
  if (details.type != "main_frame" || details.method != "GET") {
    return;
  }

  do_log("Watch hook: " + details.originUrl + " => " + details.url);

  // Prevent back-and-forth URL rewriting
  if (sessionStorage.getItem(details.requestId)) {
    do_log("Page already seen before, skipping");
    return;
  }
  sessionStorage.setItem(details.requestId, true);

  // Append theme refresh to query string
  const new_url = new URL(details.url);
  const params = new URLSearchParams(new_url.search);
  if (params.has("themeRefresh")) {
    do_log("URL already has themeRefresh, skipping");
    return;
  }

  params.append("themeRefresh", "1");
  new_url.search = params;

  return { redirectUrl: new_url.href };
};

browser.webRequest.onBeforeRequest.addListener(
  watch_hook,
  {
    urls: watch_urls,
  },
  ["blocking"]
);

const player_hook = (details) => {
  if (details.method != "POST") {
    return;
  }

  do_log("Player hook: " + details.originUrl + " => " + details.url);

  // Extract JSON payload
  const raw = details.requestBody.raw[0].bytes;
  const data = new Uint8Array(raw);
  const enc = new TextDecoder("utf-8");
  const request = JSON.parse(enc.decode(data));
  do_log(request);

  const context = request["playbackContext"]["contentPlaybackContext"];
  const video_id = request["videoId"];

  // Autoplay is probably always bad
  if (context["autoplay"]) {
    do_log("Detected autoplay, skipping");
    return;
  }

  // Don't redirect on hover preview
  if (context["autonav"]) {
    do_log("Detected hover preview, skipping");
    return;
  }

  // Skip certain pages by matching against referer prefix
  const referer = new URL(context["referer"]);
  const skipped_prefixes = [
    ["embed", "/embed"],
    ["watch", "/watch"],
    ["channel", "/@"],
  ];
  for (const [name, prefix] of skipped_prefixes) {
    if (referer.pathname.startsWith(prefix)) {
      do_log(`Referer (${referer.href}) is ${name} page, skipping`);
      return;
    }
  }

  // Redirect the requesting tab to the proper watch URL
  const params = new URLSearchParams(details.search);
  params.append("v", video_id);
  params.append("themeRefresh", "1");
  const redirect_url = new URL(details.url);
  redirect_url.pathname = "/watch";
  redirect_url.search = params;

  browser.tabs.update(details.tabId, {
    url: redirect_url.href,
  });

  return { cancel: true };
};

browser.webRequest.onBeforeRequest.addListener(
  player_hook,
  {
    urls: player_urls,
  },
  ["blocking", "requestBody"]
);
