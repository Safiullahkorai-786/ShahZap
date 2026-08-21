// OpenNext Cloudflare configuration for ShahZap.
// Uses defineCloudflareConfig() so all required adapter overrides
// (cloudflare-node wrapper, edge converter, fetch proxy, caches, queue)
// are populated correctly for @opennextjs/cloudflare builds.
// Caching defaults to "dummy" — see https://opennext.js.org/cloudflare/caching
// to enable R2 incremental caching once an R2 bucket binding is configured.
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig({});
