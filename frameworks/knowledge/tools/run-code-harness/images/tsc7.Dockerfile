# Probe image for runtime tsc7 (frameworks/knowledge/research-agent.design.md §3.6): the TypeScript 7.0.2 compiler on Node 24.22.1.
# Built once with network access; probes then run in it with --network none.
FROM node:24.22.1-alpine
RUN npm install -g --no-fund --no-audit typescript@7.0.2 && tsc --version
