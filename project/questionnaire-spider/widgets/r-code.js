// R script shown in the "R code" modal: the same chart drawn with the fmsb package.
export const R_CODE = `# install.packages(c("fmsb", "scales"))   # once
library(fmsb)

# ── 1. Data: one row per person, one column per question ──────────────────
people <- data.frame(
  row.names      = c("Alex", "Bo", "Chen", "Dana", "Eli"),
  Clarity        = c(4,   3,   5,   2.5, 4),
  Usefulness     = c(3.5, 4,   4.5, 3,   4),
  \`Ease of use\`  = c(4.5, 3,   4,   3.5, 3),
  Responsiveness = c(3,   4.5, 4,   3,   3.5),
  Value          = c(4,   3.5, 4.5, 2.5, 4),
  Overall        = c(4,   3.5, 4.5, 3,   3.5),
  check.names = FALSE
)

# Or paste from Excel (header row, Name in the first column):
# raw    <- read.delim("clipboard", check.names = FALSE)
# people <- data.frame(raw[-1], row.names = raw[[1]], check.names = FALSE)

# ── 2. Settings ───────────────────────────────────────────────────────────
best     <- 5      # best possible answer
axis_min <- 0
axis_max <- 5

# ── 3. Build the radar data frame ─────────────────────────────────────────
df <- rbind(
  max = axis_max,
  min = axis_min,                                    # fmsb needs these two rows first
  people,
  \`Best possible\` = best,
  Average         = round(colMeans(people, na.rm = TRUE), 2)
)

n          <- nrow(people)
person_col <- c("#0f766e", "#a1562f", "#5b5f8a", "#8a4f6b",
                "#3f7a9e", "#9a8a2f", "#6b4f9a", "#2f8a6f")
cols  <- c(rep_len(person_col, n), "#c98a3b", "#5b5f8a")
ltys  <- c(rep(1, n), 2, 3)          # solid people, dashed best, dotted average
lwds  <- c(rep(2, n), 2, 2.5)
fills <- c(scales::alpha(cols[seq_len(n)], 0.13), NA, NA)   # shading for people only

# ── 4. Plot ───────────────────────────────────────────────────────────────
op <- par(mar = c(5, 1, 1, 1))
radarchart(df,
           axistype = 1,
           seg      = (axis_max - axis_min) / 0.5,   # a ring every 0.5
           caxislabels = seq(axis_min, axis_max, by = 0.5),
           pcol = cols, pfcol = fills, plty = ltys, plwd = lwds,
           cglcol = "grey80", cglty = 1, axislabcol = "grey40",
           vlcex = 0.9)
legend("bottom", inset = c(0, -0.12), xpd = TRUE,
       legend = rownames(df)[-(1:2)], col = cols,
       lty = ltys, lwd = lwds, ncol = 4, bty = "n")
par(op)

# ── 5. Optional: save as PNG ──────────────────────────────────────────────
# png("questionnaire_spider.png", width = 1000, height = 1000, res = 150)
# (repeat the radarchart() and legend() calls above), then dev.off()
`;
