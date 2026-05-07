import { Suspense, useEffect, useState } from "react";
import { APPS } from "./apps-config.jsx";
import { COLORS, styles } from "./styles/menu-app-styles.jsx";
import { useNavigate, useParams, useLocation } from "react-router-dom";

const CONTACT = {
  owner: "Oliver Slay, Ph.D.",
  githubDiscussions:
    "https://github.com/zorgster/same-same-but-different/discussions",
  discordInvite: "#",
};

function getStatusMeta(status) {
  const normalized = String(status || "soon").toLowerCase();

  if (normalized === "live") {
    return {
      label: "Live",
      style: { background: COLORS.accentSoft, color: COLORS.accent },
    };
  }

  if (normalized === "beta") {
    return {
      label: "Beta",
      style: { background: COLORS.betaBg, color: COLORS.betaText },
    };
  }

  if (normalized === "experimental") {
    return {
      label: "Experimental",
      style: {
        background: COLORS.experimentalBg,
        color: COLORS.experimentalText,
      },
    };
  }

  if (normalized === "affiliate") {
    return {
      label: "Affiliate",
      style: {
        background: COLORS.affiliateBg,
        color: COLORS.affiliateText,
      },
    };
  }

  if (normalized === "soon") {
    return {
      label: "Soon",
      style: { background: COLORS.soonBg, color: COLORS.soonText },
    };
  }

  return {
    label: normalized
      ? normalized.replace(/\b\w/g, (char) => char.toUpperCase())
      : "Soon",
    style: {
      background: COLORS.defaultBadgeBg,
      color: COLORS.defaultBadgeText,
    },
  };
}

export default function MenuAppLauncher() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();

  const currentYear = new Date().getFullYear();
  const allApps = APPS.flatMap((section) => section.apps || []);

  const pathSegments = location.pathname.split("/").filter(Boolean);
  const toolIdFromPath = pathSegments[0];
  const activeApp = allApps.find((app) => app.id === toolIdFromPath);
  const ActiveComponent = activeApp?.component;

  const handleOpenTool = (toolId) => {
    navigate(`/${toolId}`);
  };

  const handleBackToPortal = () => {
    navigate(`/`);
  };

  if (ActiveComponent) {
    return (
      <div style={styles.page}>
        <div style={styles.topbar}>
          <button style={styles.backButton} onClick={handleBackToPortal}>
            Back to portal
          </button>
          <div style={styles.topbarTitle}>{activeApp.name}</div>
          <div style={styles.topbarSubtitle}>SameSameButDifferent</div>
        </div>
        <div style={styles.toolFrame}>
          <Suspense
            fallback={
              <div style={styles.loadingFrame}>Loading {activeApp.name}...</div>
            }
          >
            <ActiveComponent />
          </Suspense>
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
                const statusMeta = getStatusMeta(app.status);
                const isClickable =
                  Boolean(app.component) || statusMeta.label === "Affiliate";
                return (
                  <article
                    key={app.id}
                    style={{
                      ...styles.card,
                      ...(!isClickable ? styles.cardSoon : {}),
                    }}
                    onClick={() => {
                      if (app.component) handleOpenTool(app.id);
                      if (statusMeta.label === "Affiliate") {
                        window.open(app.affiliateLink, "_blank");
                      }
                    }}
                  >
                    <span
                      style={{ ...styles.statusBadge, ...statusMeta.style }}
                    >
                      {statusMeta.label}
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
          <p style={styles.footerText}>
            This website does not use cookies. No tracking or storage
            technologies are employed. All files are processed on your device.
          </p>
          <br />
          <div style={styles.footerText}>
            (c) {currentYear} SameSameButDifferent. Created, designed, and
            maintained by {CONTACT.owner}.
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
          </div>
        </footer>
      </main>
    </div>
  );
}
