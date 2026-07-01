const linkStyle = {
  display: "block",
  fontFamily: "'DM Sans',sans-serif",
  fontSize: "0.875rem",
  color: "#8891AA",
  fontWeight: 300,
  marginBottom: "0.65rem",
  textDecoration: "none",
};

const colTitle = {
  fontFamily: "'JetBrains Mono',monospace",
  fontSize: "0.6rem",
  letterSpacing: "0.1em",
  textTransform: "uppercase" as const,
  color: "#F4F5FA",
  marginBottom: "1.25rem",
};

function Links({ items }: { items: string[] }) {
  return items.map((item) => (
    <a key={item} href="#" style={linkStyle} onMouseEnter={(event) => { event.currentTarget.style.color = "#F4F5FA"; }} onMouseLeave={(event) => { event.currentTarget.style.color = "#8891AA"; }}>
      {item}
    </a>
  ));
}

export default function Footer() {
  return (
    <footer style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "4rem 4rem 2.5rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: "4rem", marginBottom: "3rem" }}>
          <div>
            <div style={{ fontFamily: "'Outfit', sans-serif", fontStyle: "italic", fontSize: "1.2rem", color: "#F4F5FA", textShadow: "0 0 30px rgba(75,142,240,0.3)", marginBottom: "0.5rem" }}>ealana</div>
            <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: "0.82rem" }}>
              <span style={{ color: "#4B8EF0" }}>Discover</span>
              <span style={{ color: "#3D4460" }}> · </span>
              <span style={{ color: "#34D17A" }}>Memory</span>
              <span style={{ color: "#3D4460" }}> · </span>
              <span style={{ color: "#F5C842" }}>Flow</span>
            </div>
            <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: "0.82rem", color: "#3D4460", maxWidth: 200, lineHeight: 1.65, marginTop: "0.75rem" }}>The Neural OS for Talent.</div>
          </div>
          <div>
            <div style={colTitle}>Product</div>
            <Links items={["Features", "How it works", "Pricing", "Browse Jobs"]} />
          </div>
          <div>
            <div style={colTitle}>Company</div>
            <Links items={["Book a demo", "Contact", "Blog"]} />
          </div>
          <div>
            <div style={colTitle}>Legal</div>
            <Links items={["Privacy Policy", "Terms", "Cookies"]} />
          </div>
        </div>
        <div style={{ marginTop: "2.5rem", paddingTop: "1.5rem", borderTop: "1px solid rgba(255,255,255,0.06)", display: "flex", justifyContent: "space-between" }}>
          <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: "0.78rem", color: "#3D4460" }}>© 2026 ealana. All rights reserved.</span>
          <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: "0.78rem", color: "#3D4460" }}>Made in India 🇮🇳</span>
        </div>
      </div>
    </footer>
  );
}

