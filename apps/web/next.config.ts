import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // Next generates AGENTS.md and CLAUDE.md files into the workspace by default. The
  // project already documents its own rules in the root CLAUDE.md, so the generated
  // ones are only noise in the diff.
  agentRules: false,
  // The floating dev indicator overlaps the interface and ends up in every screenshot.
  devIndicators: false,
};

export default config;
