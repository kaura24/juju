<script lang="ts">
  import "./layout.css";
  import { page } from "$app/stores";
  import { resolve } from "$app/paths";
  import { version } from "$app/environment";

  // package.json에서 버전 가져오기
  import pkgJson from "../../package.json";
  const appVersion = pkgJson.version;

  let { children } = $props();
</script>

<svelte:head>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link
    rel="preconnect"
    href="https://fonts.gstatic.com"
    crossorigin="anonymous"
  />
  <link
    href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700;800&display=swap"
    rel="stylesheet"
  />
</svelte:head>

<div class="app">
  <nav class="navbar">
    <a href={resolve("/")} class="brand">
      <span class="logo">📊</span>
      <span class="name">JuJu</span>
      <span class="version">v{appVersion}</span>
    </a>
    <div class="nav-links">
      <a href={resolve("/")} class:active={$page.url.pathname === "/"}>홈</a>
      <a
        href={resolve("/hitl")}
        class:active={$page.url.pathname.startsWith("/hitl")}>HITL</a
      >
    </div>
  </nav>

  <div class="content">
    {@render children()}
  </div>

  <footer class="footer">
    <p>주주명부 AI 분석 시스템 • GPT-4o 기반 (v{appVersion})</p>
  </footer>
</div>

<style>
  .app {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }

  .navbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 2rem;
    background: rgba(10, 10, 20, 0.8);
    backdrop-filter: blur(10px);
    border-bottom: 1px solid #2d2d44;
    position: sticky;
    top: 0;
    z-index: 100;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    text-decoration: none;
    color: #e2e8f0;
    font-weight: 700;
    font-size: 1.25rem;
  }

  .brand .logo {
    font-size: 1.5rem;
  }

  .version {
    font-size: 0.75rem;
    color: #a0aec0;
    margin-left: 0.2rem;
    font-weight: 400;
    align-self: flex-end;
    margin-bottom: 3px;
  }

  .nav-links {
    display: flex;
    gap: 1.5rem;
  }

  .nav-links a {
    color: #a0aec0;
    text-decoration: none;
    font-weight: 500;
    font-size: 0.875rem;
    padding: 0.5rem 1rem;
    border-radius: 8px;
    transition: all 0.2s ease;
    position: relative;
  }

  /* Active Tab Style (UX Pattern v3.4) */
  .nav-links a.active {
    color: #ffffff;
    font-weight: 700;
  }

  .nav-links a.active::after {
    content: "";
    position: absolute;
    bottom: 0;
    left: 1rem;
    right: 1rem;
    height: 3px;
    background: var(--fluent-accent); /* Royal Blue */
    border-radius: 3px 3px 0 0;
    box-shadow: 0 -2px 6px rgba(59, 130, 246, 0.5); /* Glow */
  }

  .nav-links a:hover {
    color: #e2e8f0;
    background: rgba(255, 255, 255, 0.05); /* Lighter hover for dark theme */
  }

  .content {
    flex: 1;
    padding: 2rem 1rem;
  }

  .footer {
    text-align: center;
    padding: 2rem;
    color: #4a5568;
    font-size: 0.875rem;
    border-top: 1px solid #2d2d44;
  }

  .footer p {
    margin: 0;
  }
</style>
