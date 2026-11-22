# Probe image for runtime tsc5 (frameworks/knowledge/research-agent.design.md §3.6): the TypeScript 5.9.3 compiler on Node 24.22.1.
# Built once with network access; probes then run in it with --network none.
FROM node:24.22.1-alpine
RUN npm install -g --no-fund --no-audit typescript@5.9.3 && tsc --version
