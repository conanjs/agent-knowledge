---
schema: deep-dive/v1
topic: ai-agents
status: draft
applies-to: ["MCP specification 2026-07-28 (current) and 2025-11-25 (legacy)", "@modelcontextprotocol/sdk 1.32.2, @modelcontextprotocol/server 2.4.0", "sources read 2026-11-21"]
last-updated: 2026-11-22
synthesized-into: []
tags: [mcp, model-context-protocol, json-rpc, transports, oauth, security]
---

# Model Context Protocol (MCP): a sourced deep dive

## Summary
**TL;DR:** MCP connects an LLM application (the host) to servers that expose tools, resources and prompts, over JSON-RPC 2.0. The current spec revision, 2026-07-28, removed the `initialize` handshake and protocol-level sessions: every request carries its own protocol version and capabilities. The legacy revision, 2025-11-25, still has the handshake, and both are deployed.
**Use this when:** you build or debug an MCP client or server, pick a transport (stdio or Streamable HTTP), set up OAuth for a remote server, or need to know what changed between the two spec revisions.
**Depth:** roles and message base, lifecycle in both revisions, the primitives (tools, resources, prompts, elicitation, sampling, roots), transports, authorization, security and trust, what 6 local SDK experiments showed, and the gaps left unverified.

**How this doc was made, and its known errors.** One agent wrote it in a single pass from a plain prompt on 2026-11-21. It is kept as a draft so it can be compared with other ways of researching a topic later. The ✅ marks are that agent's own checks: no second agent or script verified them. A blind check of 15 random statements against the cited pages found 13 correct and 2 errors, not yet fixed in the body:
- Section 3.5, step 9: the 403 `insufficient_scope` response is a SHOULD in the spec, but the doc says MUST.
- Section 3.5, Scope: "established security best practices" lost the word "security".

The check first counted a third error: `list_changed` arriving on the HTTP GET stream (section 1.6, step 5, and section 3.4). A recheck on 2026-11-22 found the channel right and the check wrong. Those rows describe the 2025-11-25 era, and its transports page says the server MAY send JSON-RPC requests and notifications on the stream a client opens with HTTP GET ✅[4]. The same recheck found a citation gap in the section 1.6 row: the method name `notifications/tools/list_changed` is on the 2025-11-25 security best-practices page ([4a-sess]), not on the lifecycle or transports pages that the row cites.

Read every claim here as unconfirmed until it is checked against its source.

Researched 2026-11-21. Marking: ✅ = checked against the cited source, ⚠️ = not verified. Footnote numbers point to the source list at the end.

**Read this first: there are two protocol "eras", and the current spec is the new one.**
The current spec revision is **2026-07-28** ✅[1][2]. It removed the `initialize` handshake and protocol-level sessions ✅[3]. The previous revision, **2025-11-25**, is what most older tutorials describe, and it still has the handshake ✅[4]. A reader who wants to run an MCP session today must know both, because servers and clients of both eras are deployed and the spec defines how they interoperate ✅[5]. This document describes the current era first and the legacy era beside it.

Plain-English analogy used below: the legacy protocol is a phone call (dial, say hello, agree on language, talk, hang up). The 2026-07-28 protocol is a stream of self-addressed letters (every letter says which language it is written in and what the sender can read, so any clerk can answer it with no memory of earlier letters).

---

## 1. Q1: Architecture and lifecycle

### 1.1 Roles

- **Host**: the LLM application. It creates and manages client instances, enforces security policy and consent, and coordinates the LLM ✅[6].
- **Client**: a connector created by the host. Each client talks to exactly one server (1:1) ✅[6]. In 2026-07-28 the client attaches protocol version and capabilities to every request ✅[6].
- **Server**: a process or remote service that exposes resources, tools and prompts, and may ask the client for input ✅[6].
- Design principle: servers should not be able to read the whole conversation or "see into" other servers; the host keeps full history and controls cross-server interaction ✅[6].

Example: an IDE (host) starts two clients, one for a Git server (local subprocess) and one for a ticketing server (remote HTTPS). Neither server sees the other.

### 1.2 Message base: JSON-RPC 2.0

All messages follow JSON-RPC 2.0 and are UTF-8 ✅[7][8]. Three kinds:

| Kind | Required fields | MCP-specific rules |
|---|---|---|
| Request | `jsonrpc:"2.0"`, `id`, `method`, optional `params` | `id` is a string or integer, must not be `null`, must not repeat while another request with that id is unanswered ✅[7] |
| Response | same `id`, and `result` or `error` | `error.code` is an integer; in 2026-07-28 every `result` must carry `resultType` (`"complete"` or `"input_required"`); an absent `resultType` from an older server is treated as `"complete"` ✅[7] |
| Notification | `method`, optional `params`, no `id` | the receiver must not reply ✅[7] |

2026-07-28 error codes reserved by the spec: `-32020` HeaderMismatch, `-32021` MissingRequiredClientCapability, `-32022` UnsupportedProtocolVersion ✅[7]. Tool and resource schemas default to JSON Schema 2020-12 ✅[7].

### 1.3 Which spec version is current

- Versions are date strings `YYYY-MM-DD` marking the last backwards-incompatible change ✅[1].
- The versioning page names **2026-07-28** as current ✅[1]. The spec repo's releases page lists 2026-07-28 as "Latest" (release candidate 2026-07-28-RC came earlier), then 2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05 ✅[9]. The releases page shows day and month only; the years are inferred from the tag names ⚠️.
- Revision states: Draft, Current, Final ✅[1]. Draft changes are out of scope here.
- The official TypeScript SDK v2 (npm `@modelcontextprotocol/server` and `/client`, version 2.4.0 on 2026-11-21) says it implements the 2026-07-28 spec ✅[10][E5]. The v1 package `@modelcontextprotocol/sdk` (1.32.2) still speaks 2025-11-25 ✅[E1].

### 1.4 Legacy lifecycle (2025-11-25 and earlier): initialize, operate, shutdown

Three phases ✅[4]:

1. **Initialization.** The client must send `initialize` with `protocolVersion`, `capabilities`, `clientInfo`. The server must answer with its own `protocolVersion`, `capabilities`, `serverInfo` (and optional `instructions`). Then the client must send `notifications/initialized` ✅[4].
   - Before the server answers, the client should send nothing but pings; before `initialized`, the server should send nothing but pings and logging ✅[4].
2. **Version negotiation.** The client sends a version it supports (should be its latest). If the server supports it, it must reply with the same version; otherwise it must reply with another version it supports (should be its latest). If the client cannot use that version it should disconnect ✅[4].
3. **Capability negotiation.** Client capabilities: `roots`, `sampling`, `elicitation`, `tasks`, `experimental`. Server capabilities: `prompts`, `resources`, `tools`, `logging`, `completions`, `tasks`, `experimental`. Sub-flags: `listChanged`, `subscribe` (resources only). Both sides must use only capabilities that were negotiated ✅[4].
4. **Shutdown.** No shutdown message exists. On stdio the client closes the server's stdin, waits, then sends SIGTERM, then SIGKILL if needed. On HTTP, closing the connection(s) ends it ✅[4].
5. **Timeouts.** Implementations should time out every request and then send a cancellation notification; progress may reset the clock but a maximum timeout should always apply ✅[4].

Observed on the wire (experiment E1, TypeScript SDK 1.32.2 server over stdio, one JSON object per line):

```
-> {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"raw","version":"0"}}}
<- {"result":{"protocolVersion":"2025-11-25","capabilities":{"tools":{"listChanged":true}},"serverInfo":{"name":"demo-server","version":"1.0.0"}},"jsonrpc":"2.0","id":1}
-> {"jsonrpc":"2.0","method":"notifications/initialized"}
-> {"jsonrpc":"2.0","id":2,"method":"tools/list"}
<- {"result":{"tools":[{"name":"add","description":"Add two numbers","inputSchema":{...a,b numbers...},"execution":{"taskSupport":"forbidden"}}]},"jsonrpc":"2.0","id":2}
-> {"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"add","arguments":{"a":2,"b":3}}}
<- {"result":{"content":[{"type":"text","text":"5"}]},"jsonrpc":"2.0","id":3}
(client closes stdin)  server exited code=0 signal=null  (13 ms later)
```

Version negotiation (experiment E2): the same server was sent `protocolVersion:"1.0.0"` and answered `"protocolVersion":"2025-11-25"`, matching the "respond with another supported version" rule ✅[4][E2].

### 1.5 Current lifecycle (2026-07-28): no handshake

- "There is no negotiation handshake." Every request carries its protocol version, and the server accepts or rejects each request on its own ✅[5].
- Every request carries these `_meta` keys ✅[7]:
  - `io.modelcontextprotocol/protocolVersion` (required)
  - `io.modelcontextprotocol/clientCapabilities` (required)
  - `io.modelcontextprotocol/clientInfo` (optional, but clients should send it)
  A request missing a required key is rejected with `-32602`, and with HTTP 400 on HTTP ✅[7].
- A server that does not support the requested version must answer `UnsupportedProtocolVersionError` (code `-32022`) listing `data.supported`; the client should retry with a mutually supported version ✅[5].
- A server that needs a client capability the request did not declare must return `-32021` with `data.requiredCapabilities` ✅[7].
- Servers must implement `server/discover`, which returns `supportedVersions`, `capabilities`, optional `instructions` and `_meta["io.modelcontextprotocol/serverInfo"]`. Clients may call it first, but are not required to ✅[11].
- Servers must not rely on earlier requests on the same connection for context (statelessness). State that spans requests must be an explicit identifier the client passes on each request ✅[7].
- An open connection (for example a stdio process) is not a conversation or session ✅[7].
- Shutdown on stdio: close the server's stdin, wait, then force-terminate if needed; servers should exit when stdin closes ✅[12]. On HTTP there is nothing to shut down: each request is its own POST ✅[13].
- Extensions (for example Tasks `io.modelcontextprotocol/tasks`, MCP Apps) are negotiated through an `extensions` map in capabilities ✅[5].

**Same session, modern era (experiment E4, SDK 2.4.0, `serveStdio`):**

```
-> {"jsonrpc":"2.0","id":1,"method":"server/discover","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientInfo":{"name":"raw","version":"0"},"io.modelcontextprotocol/clientCapabilities":{}}}}
<- {"result":{"supportedVersions":["2026-07-28"],"capabilities":{"tools":{"listChanged":true}},"resultType":"complete","ttlMs":0,"cacheScope":"private","_meta":{"io.modelcontextprotocol/serverInfo":{"name":"demo-server-v2","version":"1.0.0"}}},"jsonrpc":"2.0","id":1}
-> tools/list (same _meta)      <- {"result":{"tools":[{"name":"add",...}],"resultType":"complete","ttlMs":0,"cacheScope":"private",...},"id":2}
-> tools/call add {a:2,b:3}      <- {"result":{"content":[{"type":"text","text":"5"}],"resultType":"complete",...},"id":3}
-> tools/list with params:{}     <- {"error":{"code":-32602,"message":"Request is missing the required _meta envelope for protocol revision 2026-07-28 (...)"},"id":5}
-> initialize (legacy)           <- {"error":{"code":-32022,"message":"Unsupported protocol version: 2025-11-25","data":{"supported":["2026-07-28"],"requested":"2025-11-25"}},"id":6}
```

✅[E4]. The missing-`_meta` error and the `-32022` shape match the spec ✅[7][5].

### 1.6 End-to-end session in six steps

| Step | Legacy (2025-11-25) | Current (2026-07-28) |
|---|---|---|
| 1. Start | stdio: spawn subprocess. HTTP: open the MCP endpoint | same |
| 2. Negotiate | `initialize` request, response, `notifications/initialized` ✅[4] | optional `server/discover`; version and capabilities ride in each request's `_meta` ✅[11][7] |
| 3. List tools | `tools/list` ✅[14] | `tools/list` plus `_meta`; result has `ttlMs` and `cacheScope` ✅[14] |
| 4. Call a tool | `tools/call` | `tools/call` plus `_meta`; result has `resultType` ✅[14] |
| 5. React to changes | `notifications/tools/list_changed`, delivered on a GET stream or the open connection ✅[4][13] | open `subscriptions/listen` with `toolsListChanged:true`; server acks with `notifications/subscriptions/acknowledged` ✅[14][15] |
| 6. Shut down | stdio: close stdin, SIGTERM, SIGKILL. HTTP: close connection, optionally `DELETE` with the session id ✅[4][16] | stdio: close stdin, then force. HTTP: nothing to do ✅[12][13] |

---

## 2. Q2: Primitives

### 2.1 Server primitives (who controls them)

Each is gated by a capability the server declares (`tools`, `resources`, `prompts`) ✅[14][17][18]. In 2026-07-28 the declaration is returned by `server/discover` ✅[18].

| Primitive | Controlled by | Methods | Notifications |
|---|---|---|---|
| **Tools**: functions the model can run | the model ("model-controlled") ✅[14] | `tools/list` (paginated, cacheable), `tools/call` ✅[14] | `notifications/tools/list_changed` ✅[14] |
| **Resources**: data identified by URI | the application ("application-driven") ✅[17] | `resources/list`, `resources/read`, `resources/templates/list` ✅[17] | `notifications/resources/list_changed`, `notifications/resources/updated` ✅[17] |
| **Prompts**: user-selected templates | the user ("user-controlled"), for example slash commands ✅[18] | `prompts/list`, `prompts/get` ✅[18] | `notifications/prompts/list_changed` ✅[18] |

Details worth knowing:

- **Tool definition**: `name`, optional `title`, `description`, `inputSchema` (JSON Schema object, never `null`), optional `outputSchema`, optional `annotations`, optional `icons` ✅[14]. Names should be 1 to 128 characters from `A-Za-z0-9_-.` ✅[14].
- **Tool result**: `content` blocks (`text`, `image`, `audio`, `resource_link`, embedded `resource`) and optional `structuredContent` (any JSON value in 2026-07-28; if `outputSchema` exists the server must conform) ✅[14].
- **Two error channels**: protocol errors (unknown tool, malformed request) are JSON-RPC errors; tool execution errors (bad date, API failure) come back as a normal result with `isError: true` so the model can self-correct ✅[14].
- **Resource contents** are `text` or base64 `blob`. A missing resource is error `-32602` in 2026-07-28 (it was `-32002` before; clients should still accept `-32002`) ✅[17][3].
- **Prompt messages** have `role` (`user` or `assistant`) and content (text, image, audio, resource link, embedded resource) ✅[18].
- **Pagination and cache hints** (2026-07-28): list results carry `nextCursor`, `ttlMs`, `cacheScope` (`public` or `private`) ✅[14][3].
- **Lists must not vary per connection.** They may vary with the authorization presented on the request ✅[14].
- **Stateful tools** use an explicit handle (for example a `basket_id` returned by `create_basket` and passed to `add_item`), because there is no session ✅[14].
- Standard utilities: completion (`completion/complete` for prompt and template arguments), pagination, progress, cancellation ✅[17][18][5]. The exact method name `completion/complete` is ⚠️ not re-checked on a spec page in this run.
- Tool annotation hint names (read-only, destructive, and so on): ⚠️ not checked. What is checked is that annotations exist and are untrusted (section 4).

### 2.2 Client primitives

| Primitive | Method | 2025-11-25 status | 2026-07-28 status |
|---|---|---|---|
| **Elicitation**: server asks the user for input | `elicitation/create`, modes `form` and `url`; response `action` is `accept`, `decline` or `cancel` ✅[19] | active; also had `notifications/elicitation/complete` ✅[3] | active; that notification and `elicitationId` removed ✅[3] |
| **Sampling**: server asks the client's LLM for a completion | `sampling/createMessage`; optional `tools`/`toolChoice` when the client declares `sampling.tools` ✅[20] | active | **deprecated** (SEP-2577) ✅[20][21] |
| **Roots**: client tells server which file-URI directories matter | `roots/list`; `notifications/roots/list_changed` (legacy) ✅[22][3] | active | **deprecated**; `notifications/roots/list_changed` removed ✅[22][3] |

Roots are informational, not access control: "The protocol does not enforce that servers stay within roots" ✅[22].

**How server-to-client requests work now: Multi Round-Trip Requests (MRTR).** In 2026-07-28 a server must not send its own JSON-RPC request to the client. Instead it answers a client request with `resultType: "input_required"`, an `inputRequests` map (each value an `elicitation/create`, `sampling/createMessage` or `roots/list` request) and optionally an opaque `requestState`. The client gathers the input and retries the original request with a new `id`, `inputResponses` and the echoed `requestState` ✅[23]. Only `tools/call`, `resources/read` and `prompts/get` may return `input_required` ✅[23].

Worked example (2026-07-28, from the spec): `tools/call` id 2 returns an `input_required` result asking for a GitHub username via form elicitation; the client retries `tools/call` as id 3 with `inputResponses: {"github_login":{"action":"accept","content":{"name":"octocat"}}}` and the same `requestState` ✅[14][23].

Legacy equivalent: the server sent `elicitation/create` as its own request on the open connection or SSE stream, and the client replied with a JSON-RPC response ✅[13][4].

**Subscriptions (2026-07-28).** `subscriptions/listen` is a long-lived request whose response is an open stream of notifications. The client's `notifications` filter has `toolsListChanged`, `promptsListChanged`, `resourcesListChanged`, `resourceSubscriptions` (list of URIs). The server's first message must be `notifications/subscriptions/acknowledged`, and every later notification carries `io.modelcontextprotocol/subscriptionId` (the request id) in `_meta`. It replaces `resources/subscribe`/`unsubscribe` and the HTTP GET stream ✅[15][3].

**Other methods removed in 2026-07-28**: `ping`, `logging/setLevel`, `notifications/roots/list_changed`; the log level is now per-request `_meta` key `io.modelcontextprotocol/logLevel`. Logging is deprecated ✅[3][21]. Tasks moved out of core into the extension `io.modelcontextprotocol/tasks` ✅[3].

---

## 3. Q3: Transports and authorization

### 3.1 The standard transports

A transport is a "binding": it defines framing and delivery, not meaning; protocol semantics are the same on every transport ✅[24]. Two standard transports ✅[24][4]:

**stdio.** The client launches the server as a subprocess; messages are newline-delimited JSON-RPC on stdin/stdout and must not contain embedded newlines; the server may log to stderr and must write nothing else to stdout ✅[12][4]. Clients should support stdio whenever possible (2025-11-25 text) ✅[4]. In 2026-07-28 the server must not write JSON-RPC requests to stdout, cancellation is a `notifications/cancelled` message, and if the process dies the client should restart it and retry ✅[12].

Framing experiment (E1/E3): each message above was exactly one line, with the SDK server logging "server: ready" only on stderr ✅[E1][E3].

**Streamable HTTP.** One MCP endpoint (for example `https://example.com/mcp`). ✅[13][4]

| Aspect | 2025-11-25 | 2026-07-28 |
|---|---|---|
| Client to server | every message is a new HTTP POST with `Accept: application/json, text/event-stream`; body is one request, notification or response ✅[4] | POST of a single request or notification; clients must not POST responses; must send `MCP-Protocol-Version`, `Mcp-Method` (and `Mcp-Name` for `tools/call`, `resources/read`, `prompts/get`) ✅[13] |
| Server reply to a request | `application/json` or `text/event-stream` ✅[4] | same ✅[13] |
| Notification accepted | 202, no body ✅[4] | 202, no body ✅[13] |
| Server-to-client channel | optional GET SSE stream; server may send requests on streams ✅[4] | GET removed (405); no independent server requests; use MRTR and `subscriptions/listen` ✅[13] |
| Sessions | optional `MCP-Session-Id`; 400 without it; 404 when ended; client `DELETE` to end ✅[4] | none; a server should ignore an incoming `Mcp-Session-Id` ✅[13] |
| Resumability | SSE event ids and `Last-Event-ID` ✅[4] | not supported; a broken stream loses the request and the client re-sends it with a new id ✅[13][3] |
| Cancellation | explicit `notifications/cancelled`; a dropped connection is not a cancel ✅[4] | closing the response stream is the cancel ✅[13] |
| Origin check | server must validate `Origin`, 403 if invalid; local servers should bind to 127.0.0.1 ✅[4] | same ✅[13] |
| Header/body check | version header on later requests; 400 on unsupported version ✅[4] | headers are mirrored from the body; mismatch must be rejected with 400 and `-32020` ✅[13] |
| Custom headers | none | tool parameters marked `x-mcp-header` become `Mcp-Param-{Name}` headers; clients must support it ✅[13][14] |

**Experiment E5 (SDK 2.4.0 `createMcpHandler`, requests built with the Fetch API, no network):**

| Request | Result |
|---|---|
| `server/discover` with correct headers | 200 `application/json`, `supportedVersions:["2026-07-28"]` |
| `tools/call add 2+3` with `Mcp-Method`/`Mcp-Name` | 200 JSON, text `5`, `resultType:"complete"` |
| version `1900-01-01` in header and `_meta` | 400, `-32022`, `data.supported:["2026-07-28"]` |
| `Mcp-Name: other` but body name `add` | 400, `-32020` HeaderMismatch |
| missing `Mcp-Method` header | 400, `-32020` |
| `GET` on the endpoint | 405 |
| legacy `initialize` with no envelope | 200 (SSE) with a 2025-11-25 `InitializeResult` (SDK's default stateless legacy fallback) |

✅[E5]. The first six rows match the spec text ✅[13]. The last row is SDK behavior (dual-era fallback), which the spec permits for dual-era servers ✅[5].

**Experiment E6 (SDK 1.32.2, legacy sessions over real HTTP on 127.0.0.1):** `initialize` returned an `mcp-session-id` header (a UUID); `notifications/initialized` with the id returned 202; a request without the id returned 400 "Mcp-Session-Id header is required"; `DELETE` with the id returned 200; a later request with the same id returned 404 "Session not found" ✅[E6]. This matches the 2025-11-25 session rules ✅[4].

### 3.2 What became of HTTP+SSE

- HTTP+SSE is the transport of the 2024-11-05 revision. Streamable HTTP was introduced in 2025-03-26 as its replacement ✅[13].
- It is formally **Deprecated** (registry, SEP-2596): deprecated since 2025-03-26, new implementations should not adopt it, migrate to Streamable HTTP ✅[21][13]. It is "eligible for removal in a future revision"; the registry says earliest removal is "Three months after SEP-2596 reaches Final" ✅[21]. No feature has been removed yet ✅[21].
- Backward-compat probe (both eras): POST a request to the URL; if it fails with 400, 404 or 405 (and in 2026-07-28 the body is not a recognized modern JSON-RPC error), GET the URL expecting an SSE stream whose first event is `endpoint`; if so, use the old transport ✅[4][13].

### 3.3 Era detection for clients that must support both

- stdio: send `server/discover` first. A `DiscoverResult` or a recognized modern error means modern; any other error or a timeout means legacy, so fall back to `initialize`. Do not key the fallback to one error code ✅[12].
- HTTP: send a modern request; on a 400, read the body; a recognized modern error means modern (retry), anything else means legacy ✅[13].
- Cache the answer per process (stdio) or origin (HTTP) ✅[5].
- Compatibility matrix highlights: modern client against legacy server fails; legacy client against modern-only server fails; dual-era implementations on either side work ✅[5].

### 3.4 Choosing a transport

| Situation | Choose | Why |
|---|---|---|
| Server runs on the user's machine, launched by the host | stdio | no network surface; spec says local servers should use stdio to limit access to the client ✅[25]; credentials come from the environment, not OAuth ✅[26] |
| Shared or remote server, many users | Streamable HTTP + OAuth | single endpoint, works through ordinary HTTP infrastructure; load balancers can route on `Mcp-Method`/`Mcp-Name` headers ✅[13] |
| Local HTTP server | Streamable HTTP bound to 127.0.0.1, validate `Origin`, require a token ✅[13][25] | stops DNS rebinding and other local processes |
| Existing HTTP+SSE server | keep old endpoints only for old clients, add Streamable HTTP ✅[13] | deprecated |
| Need server push of tool-list changes | `subscriptions/listen` (2026-07-28) or GET stream (legacy) ✅[15][4] | |

### 3.5 Authorization for HTTP servers (2026-07-28)

Scope. Authorization is optional. HTTP implementations should follow the spec; stdio implementations should not, and should read credentials from the environment ✅[26]. Alternative transports must follow established best practice for their protocol ✅[26].

Roles. The MCP server is an OAuth 2.1 **resource server**; the MCP client is an OAuth 2.1 **client**; the **authorization server** issues tokens and may be separate from the MCP server ✅[26].

Flow (steps are normative unless marked) ✅[26][27][28]:

1. Client calls the MCP endpoint with no token. Server returns `401` with `WWW-Authenticate: Bearer resource_metadata="..."` (and optionally `scope="..."`).
2. Client fetches the Protected Resource Metadata (RFC 9728), which must list at least one entry in `authorization_servers`. Servers must support either the header or the well-known URI (`/.well-known/oauth-protected-resource[/path]`); clients must support both, header first ✅[27].
3. Client discovers authorization server metadata, trying RFC 8414 and OpenID Connect well-known URLs in a fixed priority order, and must reject metadata whose `issuer` differs from the issuer used to build the URL ✅[27].
4. Client obtains a client id. Priority for clients that support all: pre-registered credentials, then **Client ID Metadata Documents** (an HTTPS URL as `client_id`, if the server advertises `client_id_metadata_document_supported`), then **Dynamic Client Registration**, then prompt the user ✅[28]. Dynamic Client Registration is deprecated in 2026-07-28 ✅[21][28].
5. Client runs authorization code flow with **PKCE** (`S256`); it must verify the server advertises `code_challenge_methods_supported` and refuse to continue otherwise ✅[29].
6. Both authorization and token requests must include the RFC 8707 `resource` parameter naming the MCP server's canonical URI, whether or not the authorization server supports it ✅[26].
7. Client records the authorization server `issuer` before redirecting and checks the `iss` parameter on the response (RFC 9207) before sending the code anywhere ✅[26].
8. Client sends `Authorization: Bearer <token>` on every HTTP request; tokens must not go in the query string ✅[26].
9. Server must validate the token and that it was issued for this server as audience; invalid or expired gives `401`; insufficient scope gives `403` with `error="insufficient_scope"` and a `scope` listing what the operation needs ✅[26].
10. Step-up: the client unions previously requested scopes with the challenged scopes, re-authorizes, and retries a limited number of times ✅[26].

Scope selection at first authorization: use the `scope` from the `WWW-Authenticate` header if present; otherwise all `scopes_supported` from the resource metadata; otherwise omit `scope` ✅[26].

Refresh tokens: clients must keep them confidential and must not assume they will be issued; servers should not put `offline_access` in their challenges or `scopes_supported` ✅[26].

Not in the spec text I read: `.well-known` paths for the 2025-11-25 revision and differences from 2025-11-25 authorization (for example Dynamic Client Registration was not deprecated, no `iss` check). The 2026-07-28 changelog confirms the `iss` addition and the DCR deprecation ✅[3]; other 2025-11-25 authorization details are ⚠️ not re-verified.

### 3.6 Choosing an auth setup

| Deployment | Setup | Spec basis |
|---|---|---|
| Local stdio server | no OAuth; pass secrets by environment variable or config | ✅[26] |
| Public or enterprise remote server, unknown clients | OAuth 2.1 + PKCE + Protected Resource Metadata + `resource` parameter; accept Client ID Metadata Documents; keep Dynamic Client Registration only for old authorization servers | ✅[26][28] |
| Known client and server relationship | pre-registered client id | ✅[28] |
| Server calls third-party APIs for the user | server runs its own OAuth client to the third party (URL-mode elicitation to get the user there); never forward the MCP token | ✅[19][30] |
| Server acts as an OAuth proxy with a static client id to a third party | per-client consent before forwarding, exact `redirect_uri` match, `state` checks | ✅[30] |
| Local HTTP server | bind 127.0.0.1, validate `Origin`, require a token or use a Unix socket | ✅[13][25] |

---

## 4. Q4: Security and trust

### 4.1 The spec's trust principles

Quoted principles (same text in 2025-11-25 and 2026-07-28; 2025-11-25 adds a fourth on sampling) ✅[4a][31]:

- **User consent and control**: users must explicitly consent to and understand all data access and operations.
- **Data privacy**: hosts must obtain explicit consent before exposing user data to servers, and must not transmit resource data elsewhere without consent.
- **Tool safety**: tools represent arbitrary code execution; "descriptions of tool behavior such as annotations should be considered untrusted, unless obtained from a trusted server"; hosts must obtain explicit consent before invoking any tool.
- **Sampling controls** (2025-11-25): users must approve sampling requests and control the prompt and what the server sees.

The spec states MCP cannot enforce these at protocol level; implementors "SHOULD" build consent flows ✅[4a][31].

Strength of the wording matters. The principles use lowercase "must". The normative tools page uses **SHOULD**: "there SHOULD always be a human in the loop with the ability to deny tool invocations", with UI that shows exposed tools, visual indicators on invocation, and confirmation prompts ✅[14]. The one hard requirement on tool metadata: "clients MUST consider tool annotations to be untrusted unless they come from trusted servers" ✅[14].

### 4.2 Requirements by actor (2026-07-28)

Tools ✅[14]: servers must validate inputs, enforce access control, rate limit and sanitize outputs. Clients should confirm sensitive operations, show tool inputs before the call (to avoid exfiltration), validate results before passing to the LLM, apply timeouts, and log usage.

Resources ✅[17]: servers must validate URIs and sanitize `file://` paths against traversal.

Elicitation ✅[19]:
- Servers must not request passwords, API keys, tokens or payment credentials in form mode; use URL mode instead.
- Clients must show which server is asking, offer decline/cancel, and for URL mode show the full URL and obtain consent before opening it; must not pre-fetch the URL; must open it in a way the client and LLM cannot inspect.
- Servers must not put sensitive data or pre-authenticated links in the URL, and must verify that the user who opens the URL is the user who started the request (phishing defence).

Sampling (deprecated) ✅[20]: human in the loop "SHOULD" be present; clients should let users review and edit prompts and responses.

Multi round-trip state ✅[23]: `requestState` is attacker-controlled input. If it affects authorization, resource access or business logic, servers must protect its integrity (for example HMAC or AEAD) and reject failures; they should bind it to the principal, a short expiry and the originating request. Servers that need once-only use must enforce it themselves.

Icons and schemas ✅[7]: icon URIs must be HTTPS or `data:`, fetched without credentials; clients must not auto-dereference `$ref` to a network URI.

Header trust ✅[13]: `Mcp-*` headers must match the body, otherwise 400 (prevents routing on a different truth than the one executed). `clientInfo`/`serverInfo` are self-reported and must not be used for security decisions ✅[7][11].

### 4.3 Token passthrough

Definition: an MCP server accepts tokens it was not issued and passes them to a downstream API ✅[30]. The spec forbids it: "MCP servers MUST NOT accept any tokens that were not explicitly issued for the MCP server" ✅[30]. The authorization page adds that servers "MUST NOT accept or transit any other tokens" and that clients must not send tokens issued by a different authorization server ✅[26]. If the server calls an upstream API it uses a separate token from the upstream authorization server ✅[29].

Why: bypasses rate limits and audience controls, breaks audit trails, breaks trust boundaries, makes later security hardening harder ✅[30]. Mechanism that enforces it: RFC 8707 `resource` at issuance plus audience validation at the server ✅[26][29].

### 4.4 Confused deputy

Applies to an **MCP proxy server** that fronts a third-party API with one static client id and lets MCP clients register dynamically. If the third party sets a consent cookie after the first approval, an attacker who dynamically registers a client with an attacker `redirect_uri` can send a crafted link; the cookie skips consent and the code goes to the attacker ✅[30]. All four conditions must hold (static client id, dynamic registration, consent cookie, no per-client consent) ✅[30].

Mandatory mitigations ("MUST") for proxies ✅[30]:
- per-user registry of approved `client_id`s, checked before going to the third party;
- MCP-owned consent page that names the client, lists scopes, shows the `redirect_uri`, has CSRF protection and anti-framing headers;
- consent cookies with `__Host-` prefix, `Secure`, `HttpOnly`, `SameSite=Lax`, signed, bound to the `client_id`;
- exact-string `redirect_uri` match;
- random single-use `state`, stored only after consent approval.

Related attacks with required mitigations: mix-up (verify `iss`; PKCE alone does not stop it) ✅[30][26]; SSRF through metadata URLs (clients should require HTTPS and block private ranges, and use an egress proxy on servers) ✅[30]; localhost redirect impersonation (authorization servers must display the redirect host) ✅[29][30]; dangerous authorization URLs (`javascript:`, shell-opening must be rejected) ✅[30]; local-server one-click install (client must show the exact command and get approval) ✅[30].

### 4.5 Session handling

**2026-07-28: there are no protocol sessions.** The security page renames the risk "state handle hijacking": a server-minted handle (cart id) is an ordinary tool argument. Servers that authorize must verify every inbound request, must not treat possession of a handle as authentication, should use cryptographically random handles, and should bind handles to the user derived from the verified token (for example key `<user_id>:<handle>`) ✅[30]. The tools page adds: a handle on an authenticated server "is a name, not a capability"; validate authorization on every call; state the retention policy in the creating tool's description ✅[14].

**2025-11-25 sessions.** Session id is optional; if used it should be globally unique and cryptographically secure, visible ASCII only, sent as `MCP-Session-Id` on every later request; server answers 400 without it, 404 after termination; a client that gets 404 must start over with a fresh `initialize`; clients should `DELETE` when done ✅[4]. Security requirements: servers that authorize must verify all inbound requests and "MUST NOT use sessions for authentication"; session ids must be secure and non-deterministic; session ids should be bound to user data ✅[4a-sess]. Attack variants: session-hijack prompt injection across multiple servers sharing an event queue, and impersonation by a guessed id ✅[4a-sess]. Experiment E6 shows the 400/404 behavior ✅[E6].

---

## 5. What the experiments showed that the spec text does not say

- **SDK 2.4.0 on stdio accepted an unsupported version.** With the stdio entry `serveStdio`, a `tools/list` carrying `_meta` protocolVersion `1900-01-01` returned a normal tool list instead of `-32022` (E4). The spec says a server must reject an unsupported version ✅[5]. The HTTP entry did reject it correctly (E5). Treat this as an SDK deviation observed once, with version 2.4.0; cause not investigated ⚠️.
- **`McpServer` + `StdioServerTransport` in SDK 2.4.0 is the legacy path.** `server/discover` returned `-32601` Method not found (E3); the modern path needs `serveStdio` (E4) ✅[E3][E4].
- v1 SDK has no `server/discover`; its `initialize` negotiated an unknown version down to 2025-11-25 (E2) ✅.

---

## 6. Reproducing the experiments

All files are in `/private/tmp/claude-501/-Users-vinh-doq-workspace-agent-config/0f496f54-9627-4c89-b661-835fb6ca2fda/scratchpad/plain/`. Node v24.22.1.

_Kept note (2026-11-21): the experiment folders and outputs lived in a temporary session folder and were not kept; the table records what each one showed._

| Id | Files | Package | What it shows |
|---|---|---|---|
| E1 | `exp-v1/server.mjs`, `exp-v1/raw-client.mjs`, output `exp1-v1-stdio-raw.txt` | `@modelcontextprotocol/sdk@1.32.2` | legacy handshake, tools list/call, stdin-close shutdown (exit 0 in 13 ms) |
| E2 | `exp-v1/neg.mjs`, `exp2-v1-version-negotiation.txt` | same | server counters unknown version with 2025-11-25 |
| E3 | `exp-v2/server.mjs`, `exp-v2/raw-client.mjs`, `exp3-v2-stdio-raw.txt` | `@modelcontextprotocol/server@2.4.0` | `McpServer`+`StdioServerTransport` is legacy; no `server/discover` |
| E4 | `exp-v2/server-modern.mjs`, `exp-v2/raw-client-modern.mjs`, `exp4-v2-stdio-modern.txt` | same | modern stdio: `server/discover`, per-request `_meta`, `-32602`, `-32022` |
| E5 | `exp-v2/http-test.mjs`, `exp5-v2-http-handler.txt` | same | modern HTTP rules and legacy fallback |
| E6 | `exp-v1/http-server.mjs`, `exp-v1/http-run.sh`, `exp6-v1-http-session.txt` | `@modelcontextprotocol/sdk@1.32.2` | legacy `Mcp-Session-Id`, 400, 202, DELETE, 404 |

Limits: single runs, loopback only, no authorization flow executed. The OAuth flow in section 3.5 is from spec text only (no experiment).

---

## 7. Gaps and unverified items

- ⚠️ Tool annotation field names and meanings (`readOnlyHint` and similar). Not fetched; only "annotations are untrusted" is verified.
- ⚠️ `completion/complete` method name and the `logging/setLevel` details for 2025-11-25 were taken from the changelog or memory, not from their own pages.
- ⚠️ Year of the GitHub release dates (the page shows only day and month).
- ⚠️ Full 2025-11-25 authorization details (only the 2026-07-28 text and the changelog were read).
- ⚠️ The `Tasks` extension, `Skills over MCP` and `MCP Apps` were only identified by name, not read.
- ⚠️ All web page text came through a fetch tool that converts pages to Markdown and runs a small model over them; quoted passages should be re-checked against the live page before being copied into normative documents. Code experiments are not subject to this limitation.
- Out of scope per the brief and not covered: how Claude Code, Codex or Copilot load servers; third-party server catalogs and the MCP Registry; draft or proposed changes.

---

## References

All fetched 2026-11-21.

- [1] https://modelcontextprotocol.io/specification/versioning
- [2] https://modelcontextprotocol.io/specification/2026-07-28 (overview and key details)
- [3] https://modelcontextprotocol.io/specification/2026-07-28/changelog
- [4] https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle and https://modelcontextprotocol.io/specification/2025-11-25/basic/transports ([4a] = https://modelcontextprotocol.io/specification/2025-11-25 for the security principles; [4a-sess] = https://modelcontextprotocol.io/specification/2025-11-25/basic/security_best_practices, Session Hijacking)
- [5] https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning (page titled "Versioning and Compatibility", fetched via `/latest/basic/lifecycle`)
- [6] https://modelcontextprotocol.io/specification/2026-07-28/architecture
- [7] https://modelcontextprotocol.io/specification/2026-07-28/basic/index
- [8] https://modelcontextprotocol.io/specification/2026-07-28/basic/transports (UTF-8 requirement)
- [9] https://github.com/modelcontextprotocol/modelcontextprotocol/releases
- [10] https://github.com/modelcontextprotocol/typescript-sdk and the packaged README in `@modelcontextprotocol/server@2.4.0`
- [11] https://modelcontextprotocol.io/specification/2026-07-28/server/discover
- [12] https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio
- [13] https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http
- [14] https://modelcontextprotocol.io/specification/2026-07-28/server/tools
- [15] https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/subscriptions
- [16] see [4] (HTTP DELETE of the session)
- [17] https://modelcontextprotocol.io/specification/2026-07-28/server/resources
- [18] https://modelcontextprotocol.io/specification/2026-07-28/server/prompts
- [19] https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation
- [20] https://modelcontextprotocol.io/specification/2026-07-28/client/sampling
- [21] https://modelcontextprotocol.io/specification/2026-07-28/deprecated
- [22] https://modelcontextprotocol.io/specification/2026-07-28/client/roots
- [23] https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr
- [24] https://modelcontextprotocol.io/specification/2026-07-28/basic/transports (overview page, fetched as `/latest/basic/transports`)
- [25] https://modelcontextprotocol.io/specification/2026-07-28/basic/security_best_practices (fetched as `/latest/basic/security_best_practices`), Local MCP Server Compromise
- [26] https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization (fetched as `/latest/basic/authorization`)
- [27] https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/authorization-server-discovery
- [28] https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration
- [29] https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations
- [30] https://modelcontextprotocol.io/specification/2026-07-28/basic/security_best_practices (same page as [25])
- [31] https://modelcontextprotocol.io/specification/2026-07-28 (Security and Trust & Safety section)
- [E1]-[E6] local experiments, section 6.

## Related

- `agent-plugins-and-mcp-loading.md` — how Claude Code, Codex and Copilot load MCP servers and what they cost per turn (out of scope here).
