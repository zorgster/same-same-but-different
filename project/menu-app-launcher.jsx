import { useState } from "react";
import { APPS } from "./apps-config.jsx";

const COLORS = {
  bg: "#f5f7fb",
  surface: "#ffffff",
  border: "#d8deea",
  text: "#1f2937",
  muted: "#5f6b7a",
  accent: "#0f766e",
  accentSoft: "#ccfbf1",
  soonBg: "#eef2ff",
  soonText: "#4f46e5",
};

const CONTACT = {
  owner: "TexiGene",
  githubDiscussions: "https://github.com/zorgster/same-same-but-different/discussions",
  discordInvite: "#",
};

const styles = {
  page: {
    minHeight: "100vh",
    background: COLORS.bg,
    fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
    color: COLORS.text,
  },
  topbar: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "14px 20px",
    background: COLORS.surface,
    borderBottom: `1px solid ${COLORS.border}`,
    position: "sticky",
    top: 0,
    zIndex: 10,
  },
  topbarTitle: {
    fontSize: 15,
    fontWeight: 700,
    color: COLORS.text,
  },
  topbarSubtitle: {
    marginLeft: "auto",
    fontSize: 12,
    color: COLORS.muted,
  },
  home: {
    maxWidth: 940,
    margin: "0 auto",
    padding: "28px 20px 36px",
  },
  footer: {
    marginTop: 24,
    paddingTop: 16,
    borderTop: `1px solid ${COLORS.border}`,
    display: "flex",
    gap: 12,
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
  },
  footerText: {
    fontSize: 12,
    color: COLORS.muted,
  },
  footerLinks: {
    display: "flex",
    gap: 10,
    alignItems: "center",
    flexWrap: "wrap",
  },
  footerLink: {
    fontSize: 12,
    color: COLORS.accent,
    fontWeight: 600,
    textDecoration: "none",
  },
  sectionTitle: {
    fontSize: 12,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: COLORS.muted,
    marginBottom: 12,
    fontWeight: 700,
  },
  sectionBlock: {
    marginBottom: 20,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))",
    gap: 12,
  },
  card: {
    background: COLORS.surface,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 12,
    padding: 14,
    cursor: "pointer",
  },
  cardSoon: {
    opacity: 0.75,
    cursor: "default",
  },
  cardName: {
    fontSize: 15,
    fontWeight: 700,
    marginBottom: 4,
  },
  cardDesc: {
    fontSize: 12,
    color: COLORS.muted,
    lineHeight: 1.5,
  },
  badgeLive: {
    display: "inline-block",
    background: COLORS.accentSoft,
    color: COLORS.accent,
    fontSize: 10,
    fontWeight: 700,
    borderRadius: 999,
    padding: "2px 8px",
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },
  badgeSoon: {
    display: "inline-block",
    background: COLORS.soonBg,
    color: COLORS.soonText,
    fontSize: 10,
    fontWeight: 700,
    borderRadius: 999,
    padding: "2px 8px",
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },
  toolFrame: {
    minHeight: "calc(100vh - 52px)",
  },
  backButton: {
    border: `1px solid ${COLORS.border}`,
    background: COLORS.surface,
    borderRadius: 8,
    padding: "6px 10px",
    color: COLORS.text,
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 600,
  },
};

export default function MenuAppLauncher() {
  const [activeTool, setActiveTool] = useState(null);
  const currentYear = new Date().getFullYear();
  const allApps = APPS.flatMap((section) => section.apps || []);
  const activeApp = allApps.find((app) => app.id === activeTool);
  const ActiveComponent = activeApp?.component;

  if (ActiveComponent) {
    return (
      <div style={styles.page}>
        <div style={styles.topbar}>
          <button style={styles.backButton} onClick={() => setActiveTool(null)}>
            Back to portal
          </button>
          <div style={styles.topbarTitle}>{activeApp.name}</div>
          <div style={styles.topbarSubtitle}>SameSameButDifferent</div>
        </div>
        <div style={styles.toolFrame}>
          <ActiveComponent />
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.topbar}>
        <div style={styles.topbarTitle}>SameSameButDifferent</div>
        <div style={styles.topbarSubtitle}>SSBD - Data Validation Portal</div>
      </div>
      <main style={styles.home}>
        {APPS.map((section) => (
          <section key={section.id} style={styles.sectionBlock}>
            <div style={styles.sectionTitle}>{section.title}</div>
            <div style={styles.grid}>
              {(section.apps || []).map((app) => {
                const isLive = app.status === "live";
                return (
                  <article
                    key={app.id}
                    style={{ ...styles.card, ...(isLive ? {} : styles.cardSoon) }}
                    onClick={() => {
                      if (app.component) setActiveTool(app.id);
                    }}
                  >
                    <span style={isLive ? styles.badgeLive : styles.badgeSoon}>
                      {isLive ? "Live" : "Soon"}
                    </span>
                    <div style={styles.cardName}>{app.name}</div>
                    <div style={styles.cardDesc}>{app.desc}</div>
                  </article>
                );
              })}
            </div>
          </section>
        ))}

        <footer style={styles.footer}>
          <div style={styles.footerText}>
            (c) {currentYear} SameSameButDifferent. Created, designed, and maintained by {CONTACT.owner}.
          </div>
          <div style={styles.footerLinks}>
            <span style={styles.footerText}>Public contact:</span>
            <a
              href={CONTACT.githubDiscussions}
              target="_blank"
              rel="noreferrer"
              style={styles.footerLink}
            >
              GitHub Discussions
            </a>
            <a
              href={CONTACT.discordInvite}
              target="_blank"
              rel="noreferrer"
              style={styles.footerLink}
            >
              Discord
            </a>
          </div>
        </footer>
      </main>
    </div>
  );
}
